import * as z from 'zod/v4';
import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { ElectrostaticHostStorage, readElectrostaticHostJson, writeElectrostaticHostOnce } from './electrostaticHostStorage.mts';
import { privateExplicitExportSchema, privateExplicitSourceSchema } from './privateExplicitPreparationContract.mts';
import { explicitDynamicsSchema } from './explicitDynamicsContract.mts';
import { electrostaticStepGeometryDigest } from './electrostaticStepIdentity.mts';
import { digest } from './stableDigest.mts';

const sha=z.string().regex(/^sha256:[a-f0-9]{64}$/),id=z.string().min(1).max(160);
const exportId=z.string().regex(/^export-[a-f0-9-]{36}$/);
export const privateApprovedExportInputSchema=z.object({preparationId:id,studyId:id,
  source:privateExplicitSourceSchema,request:explicitDynamicsSchema,
  geometry:privateExplicitExportSchema.extend({exportId}),
  approval:z.object({approvalId:id,bindingDigest:sha,expiresAt:z.number().int().nonnegative(),
    used:z.literal(true),consumedAt:z.number().int().nonnegative(),
    approvalSource:z.enum(['human','controlled_test_fixture']).optional()}).strict(),
}).strict();
export type PrivateApprovedExportInput=z.infer<typeof privateApprovedExportInputSchema>;
const receiptSchema=privateApprovedExportInputSchema.extend({
  schema:z.literal('tunacad-private-approved-step-export/0.1'),storageIdentity:sha,
  approvalScope:z.literal('geometry_export_only'),unitSystem:z.literal('mm-N-s-MPa-kg'),
  createdAt:z.string().datetime(),
}).strict();
export type PrivateApprovedExportReceipt=z.infer<typeof receiptSchema>;
export interface PrivateApprovedExportStatus {schema:'tunacad-private-approved-step-export/0.1';
  exportId:string;receiptDigest:string;storageIdentity:string;byteDigest:string;byteLength:number;verified:true}
export type PersistPrivateApprovedExport=(input:PrivateApprovedExportInput,bytes:Uint8Array,
  verifyCurrent:()=>Promise<void>)=>Promise<PrivateApprovedExportStatus>;
const maxBytes=16*1024*1024;
const hashBytes=(bytes:Uint8Array)=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
function invalid(detail:string):never {throw new Error('PRIVATE_APPROVED_EXPORT_INVALID: '+detail);}

async function verifyBinding(r:PrivateApprovedExportInput,bytes:Uint8Array){
  const s=r.source,g=r.geometry,q=r.request,{requestDigest,...unsigned}=q;
  if(JSON.stringify(q.model.cad?.monitoringFaces?.map(f=>f.referenceId))!==JSON.stringify(s.monitoringFaces?.map(f=>f.referenceId))
    ||s.monitoringFaces?.some(f=>f.bodyId!==s.bodyId))invalid('monitoring FACE source binding');
  if(bytes.length!==g.byteLength||hashBytes(bytes)!==g.byteDigest
    ||await electrostaticStepGeometryDigest(bytes)!==s.canonicalSourceDigest
    ||digest(s)!==g.sourceBindingDigest||g.canonicalSourceDigest!==s.canonicalSourceDigest
    ||digest(unsigned)!==requestDigest||q.studyId!==r.studyId
    ||q.model.projectRevision!==s.revision||q.model.bodyId!==s.bodyId||q.model.partId!==s.componentId
    ||q.model.domainId!==s.domainId||q.model.geometryDigest!==s.canonicalSourceDigest
    ||q.material.materialId!==s.materialId||q.model.fixedFaceId!==s.fixedFace.referenceId
    ||q.model.loadedFaceId!==s.loadedFace.referenceId||s.fixedFace.bodyId!==s.bodyId||s.loadedFace.bodyId!==s.bodyId
    ||s.fixedFace.referenceId===s.loadedFace.referenceId||s.fixedFace.fingerprint===s.loadedFace.fingerprint
    ||s.unitSystemDigest!==digest('mm-N-s-MPa-kg')||r.approval.consumedAt>=r.approval.expiresAt
    ||r.approval.bindingDigest!==digest({purpose:'geometry_transfer',preparationId:r.preparationId,
      studyId:r.studyId,sourceBindingDigest:g.sourceBindingDigest,requestDigest,
      ...(r.approval.approvalSource==='controlled_test_fixture'?{approvalSource:r.approval.approvalSource}:{})}))invalid('source/request/approval/STEP binding');
}

async function readBytes(path:string){
  const before=await lstat(path);
  if(!before.isFile()||before.isSymbolicLink()||before.size<128||before.size>maxBytes)invalid('STEP shape/budget');
  const handle=await open(path,'r');
  try {
    const info=await handle.stat();if(info.ino!==before.ino||info.size!==before.size)invalid('STEP changed during open');
    const bytes=new Uint8Array(before.size+1);let count=0;
    while(count<bytes.length){const next=await handle.read(bytes,count,bytes.length-count,null);if(!next.bytesRead)break;count+=next.bytesRead;}
    const after=await handle.stat();
    if(count!==before.size||after.size!==before.size||after.mtimeMs!==info.mtimeMs)invalid('STEP changed during read');
    return bytes.slice(0,count);
  }finally{await handle.close();}
}
async function writeBytesOnce(path:string,bytes:Uint8Array){
  let handle;
  try{handle=await open(path,'wx',0o600);}
  catch(error:any){if(error.code!=='EEXIST')throw error;
    const existing=await readBytes(path);
    if(existing.length!==bytes.length||hashBytes(existing)!==hashBytes(bytes))invalid('immutable export collision');return;}
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
}

/** Trusted Node owner only. No arbitrary filename, browser upload or public
 * operation. A pin is published LAST, after byte/receipt verification and live
 * source recheck. Interrupted/unpinned artifacts are never readable as exports. */
export async function openPrivateExplicitExportStore(root:string,testConfiguration?:{
  mode:'controlled_test_fixture';purpose:'private_operator_approval_fixture'
}){
  if(testConfiguration&&(testConfiguration.mode!=='controlled_test_fixture'
    ||testConfiguration.purpose!=='private_operator_approval_fixture'
    ||Object.keys(testConfiguration).sort().join(',')!=='mode,purpose'))invalid('test configuration');
  const approvalSource=testConfiguration?'controlled_test_fixture':'human';
  const storage=await ElectrostaticHostStorage.open(root);
  // A fixture root is permanently labelled; live readers/writers cannot open it
  // or reseal its approvals. No environment variable selects this test mode.
  const fixturePin=join(storage.paths['source-catalog'],'private-operator-fixture.pin.json');
  if(testConfiguration)await writeElectrostaticHostOnce(fixturePin,{
    schema:'tunacad-private-operator-fixture-storage/0.1',approvalSource,storageIdentity:storage.configurationDigest},4096);
  async function verifyStorageMode(){
    if(testConfiguration){const pin=await readElectrostaticHostJson(fixturePin,4096);
      if(digest(pin)!==digest({schema:'tunacad-private-operator-fixture-storage/0.1',approvalSource,
        storageIdentity:storage.configurationDigest}))invalid('fixture storage label changed');}
    else {try {await lstat(fixturePin);invalid('controlled fixture storage forbidden in live mode');}
      catch(error:any){if(error.code!=='ENOENT')throw error;}}
  }
  await verifyStorageMode();
  function verifyApprovalSource(r:PrivateApprovedExportInput){
    if((r.approval.approvalSource??'human')!==approvalSource)invalid('approval source isolation');
  }
  const paths=(value:string)=>{const key=exportId.parse(value);return {
    step:join(storage.paths.results,key+'.step'),receipt:join(storage.paths.studies,key+'.json'),
    pin:join(storage.paths['source-catalog'],key+'.pin.json')};};
  async function read(value:string,expectedDigest?:string){
    await verifyStorageMode();
    await storage.assertReady();const p=paths(value);
    const pin=z.object({schema:z.literal('tunacad-private-approved-step-export-pin/0.1'),
      exportId,receiptDigest:sha,storageIdentity:sha}).strict().parse(await readElectrostaticHostJson(p.pin,4096));
    const receipt=receiptSchema.parse(await readElectrostaticHostJson(p.receipt,128*1024));
    verifyApprovalSource(receipt);
    const receiptDigest=digest(receipt);
    if(pin.exportId!==value||receipt.geometry.exportId!==value||pin.receiptDigest!==receiptDigest
      ||expectedDigest&&receiptDigest!==expectedDigest||pin.storageIdentity!==storage.configurationDigest
      ||receipt.storageIdentity!==storage.configurationDigest)invalid('protected receipt/pin mismatch');
    const bytes=await readBytes(p.step);await verifyBinding(receipt,bytes);await storage.assertReady();
    if(digest(await readElectrostaticHostJson(p.pin,4096))!==digest(pin))invalid('pin changed during read');
    return {receipt,bytes,status:{schema:receipt.schema,exportId:value,receiptDigest,storageIdentity:receipt.storageIdentity,
      byteDigest:receipt.geometry.byteDigest,byteLength:bytes.length,verified:true as const}};
  }
  const persist:PersistPrivateApprovedExport=async(input,raw,verifyCurrent)=>{
    await verifyStorageMode();
    if(!(raw instanceof Uint8Array)||raw.length>maxBytes||typeof verifyCurrent!=='function')invalid('trusted capture dependencies');
    const r=privateApprovedExportInputSchema.parse(structuredClone(input)),bytes=new Uint8Array(raw),p=paths(r.geometry.exportId);
    verifyApprovalSource(r);
    await verifyBinding(r,bytes);await storage.assertReady();await verifyCurrent();
    await writeBytesOnce(p.step,bytes);
    const reread=await readBytes(p.step);if(hashBytes(reread)!==r.geometry.byteDigest)invalid('post-write STEP digest');
    await storage.assertReady();await verifyCurrent();
    const receipt=receiptSchema.parse({...r,schema:'tunacad-private-approved-step-export/0.1',
      storageIdentity:storage.configurationDigest,approvalScope:'geometry_export_only',unitSystem:'mm-N-s-MPa-kg',createdAt:new Date().toISOString()});
    // An ID is never republished with another receipt, even when bytes coincide.
    await writeElectrostaticHostOnce(p.receipt,receipt,128*1024);
    if(digest(await readElectrostaticHostJson(p.receipt,128*1024))!==digest(receipt))invalid('receipt write integrity');
    await storage.assertReady();await verifyCurrent();
    await writeElectrostaticHostOnce(p.pin,{schema:'tunacad-private-approved-step-export-pin/0.1',
      exportId:r.geometry.exportId,receiptDigest:digest(receipt),storageIdentity:storage.configurationDigest},4096);
    // Independent instance and handles, not in-memory bytes or writer state.
    return (await (await openPrivateExplicitExportStore(root,testConfiguration)).read(r.geometry.exportId,digest(receipt))).status;
  };
  return {persist,read};
}
