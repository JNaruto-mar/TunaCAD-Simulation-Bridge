import * as z from 'zod/v4';
import {webCryptoDigest} from '../../simulation-bridge/v2ValidationBrowser.mts';
import {electricalDatasetSchema,electricalTriangleSchema,loadElectricalDataset} from '../../simulation-bridge/electrostaticFields.mts';

/** Portable data contract only. No owner/storage reader, transport registration,
 * approval creator or solver capability. Receipt hashes alone are NOT consent. */
const hash=z.string().regex(/^sha256:[a-f0-9]{64}$/),id=z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/),finite=z.number().finite();
const origin=z.object({revision:id,requestDigest:hash,geometryDigest:hash,meshDigest:hash,materialDigest:hash,
  providerId:id,providerVersion:id,runtimeFingerprint:hash,originalResultDigest:hash}).strict();
const node=z.object({nodeId:z.number().int().positive(),face:z.enum(['fixed','loaded','monitor']),displacementMm:finite,
  velocityMmPerS:finite,accelerationMmPerS2:finite,reactionImpulseNs:finite,reactionForceN:finite}).strict();
const explicit=z.object({kind:z.literal('explicit_recorded_face_history'),axis:z.literal('X'),location:z.literal('recorded_FACE_nodes_only'),
  meshCounts:z.object({nodes:z.number().int().min(4).max(100000),elements:z.number().int().min(1).max(50000)}).strict(),
  units:z.object({time:z.literal('s'),displacement:z.literal('mm'),velocity:z.literal('mm/s'),acceleration:z.literal('mm/s^2'),
    impulse:z.literal('N*s'),force:z.literal('N'),energy:z.literal('N*mm'),mass:z.literal('kg')}).strict(),
  monitoringFaces:z.array(z.object({referenceId:id,nodeIds:z.array(z.number().int().positive()).min(1).max(16000)}).strict()).max(8),
  frames:z.array(z.object({timeS:finite.nonnegative(),timestepS:finite.positive(),nodes:z.array(node).min(1).max(16000),
    supportImpulseNs:finite,supportReactionN:finite,kineticEnergyNmm:finite,internalEnergyNmm:finite,externalWorkNmm:finite,
    totalMassKg:finite.positive(),addedMassKg:finite,addedMassChangeKg:finite}).strict()).min(2).max(64)}).strict();
const electrical=z.object({kind:z.literal('single_dielectric_fields'),domainId:id,
  datasets:z.array(z.object({descriptor:electricalDatasetSchema,triangles:z.array(electricalTriangleSchema).min(1).max(64000)}).strict()).length(3)}).strict();
const envelope=z.object({schema:z.literal('tunacad-authorized-portable-result/1'),origin,
  data:z.discriminatedUnion('kind',[explicit,electrical]),payloadDigest:hash,
  exportReceipt:z.object({schema:z.literal('tunacad-owner-export-receipt/1'),issuerFingerprint:hash,receiptId:id,
    scope:z.literal('sanitized_read_only_result_export'),payloadDigest:hash,originDigest:hash,
    signature:z.string().regex(/^[A-Za-z0-9+/=]{32,4096}$/)}).strict(),
  engineeringUsePermitted:z.literal(false)}).strict();
export type AuthorizedPortableResult=z.infer<typeof envelope>;
export interface OwnerExportReceiptVerifier {
  /** Must verify authenticated-owner issuance/trust and the separate export consent.
   * Implementations cannot infer authorization from an imported receipt's claims. */
  verify(receipt:AuthorizedPortableResult['exportReceipt'],expected:{payloadDigest:string;originDigest:string}):Promise<void>;
}
export function portableResultExportRequest(kind:'explicit_recorded_face_history'|'single_dielectric_fields',binding:AuthorizedPortableResult['origin']){
  return {schema:'tunacad-sanitized-result-export-request/1',kind:z.enum(['explicit_recorded_face_history','single_dielectric_fields']).parse(kind),origin:origin.parse(binding),
    scope:'sanitized_read_only_result_export',engineeringUsePermitted:false};
}
export async function validateAuthorizedPortableResult(raw:unknown,ownerVerifier?:OwnerExportReceiptVerifier):Promise<AuthorizedPortableResult>{
  if(!ownerVerifier)throw Error('PORTABLE_RESULT_OWNER_EXPORT_AUTHORIZATION_UNAVAILABLE');
  if(new TextEncoder().encode(JSON.stringify(raw)).length>32*1024*1024)throw Error('PORTABLE_RESULT_SIZE_LIMIT');
  const value=envelope.parse(raw),data=value.data;
  if(data.kind==='explicit_recorded_face_history'){
    const first=data.frames[0].nodes.map(n=>[n.nodeId,n.face]);
    if(new Set(first.map(n=>n[0])).size!==first.length||data.frames.some((f,i)=>i>0&&f.timeS<=data.frames[i-1].timeS||JSON.stringify(f.nodes.map(n=>[n.nodeId,n.face]))!==JSON.stringify(first)))
      throw Error('PORTABLE_RESULT_HISTORY_COVERAGE_INVALID');
    const ids=new Set(first.map(n=>n[0]));
    if(new Set(data.monitoringFaces.map(f=>f.referenceId)).size!==data.monitoringFaces.length||data.monitoringFaces.some(f=>new Set(f.nodeIds).size!==f.nodeIds.length||f.nodeIds.some(n=>!ids.has(n))))
      throw Error('PORTABLE_RESULT_FACE_BINDING_INVALID');
    // Preserve the canonical constant negative mass-subtraction roundoff; never
    // clamp it to zero or admit positive/changed mass scaling.
    const n=data.meshCounts.nodes+data.meshCounts.elements,u=2**-53,m=data.frames[0].totalMassKg,bound=n*u/(1-n*u)*m;
    if(data.frames.some(f=>f.kineticEnergyNmm<0||f.internalEnergyNmm<0||f.totalMassKg!==m||f.addedMassKg>0||
      Math.abs(f.addedMassKg)>bound||f.addedMassKg!==data.frames[0].addedMassKg||f.addedMassChangeKg!==0))throw Error('PORTABLE_RESULT_MASS_HISTORY_INVALID');
  }else{
    const components=new Set<string>();let total=0;
    for(const d of data.datasets){const desc=d.descriptor;components.add(desc.component);total+=d.triangles.length;
      if(desc.domainId!==data.domainId||desc.requestDigest!==value.origin.requestDigest||desc.canonicalSourceDigest!==value.origin.geometryDigest||
        desc.meshDigest!==value.origin.meshDigest||desc.resultDigest!==value.origin.originalResultDigest||desc.totalTriangles!==d.triangles.length||
        await webCryptoDigest(d.triangles)!==desc.datasetDigest)throw Error('PORTABLE_RESULT_FIELD_BINDING_INVALID');
      if(d.triangles.some(t=>(t.vectors!==null)!==desc.vectorsIncluded||new Set(t.nodeIds).size!==3||t.values.some(v=>v<desc.valueRange.minimum||v>desc.valueRange.maximum)))
        throw Error('PORTABLE_RESULT_FIELD_VALUES_INVALID');
      await loadElectricalDataset(desc,async(cursor,limit)=>{const start=Number(cursor),triangles=d.triangles.slice(start,start+limit),end=start+triangles.length;
        return {schema:'tunacad-electrostatic-field-page/0.1',dataset:desc,cursor,nextCursor:end<d.triangles.length?String(end):null,
          triangleOffset:start,triangleCount:triangles.length,triangles,chunkDigest:await webCryptoDigest(triangles)};});
    }
    if(components.size!==3||total>100000)throw Error('PORTABLE_RESULT_FIELD_COVERAGE_INVALID');
  }
  const payloadDigest=await webCryptoDigest({origin:value.origin,data:value.data,engineeringUsePermitted:false}),originDigest=await webCryptoDigest(value.origin);
  if(payloadDigest!==value.payloadDigest||value.exportReceipt.payloadDigest!==payloadDigest||value.exportReceipt.originDigest!==originDigest)
    throw Error('PORTABLE_RESULT_EXPORT_DIGEST_INVALID');
  await ownerVerifier.verify(value.exportReceipt,{payloadDigest,originDigest});
  return structuredClone(value);
}
