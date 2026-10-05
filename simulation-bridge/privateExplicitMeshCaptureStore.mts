import { lstat,open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { digest } from './stableDigest.mts';
import { ElectrostaticHostStorage,readElectrostaticHostJson,writeElectrostaticHostOnce } from './electrostaticHostStorage.mts';
import { privateCapturedMeshRecordSchema,type PrivateExplicitMeshRecord } from './privateExplicitMeshRecord.mts';
import { openPrivateExplicitExportStore } from './privateExplicitExportStore.mts';
import { admitExplicitLinearMesh,parseExplicitMsh22,explicitMeshConfigurationDigest }
  from '../providers/gmsh/ExplicitLinearMesh.mts';
import {parseExplicitStepTopology} from '../providers/gmsh/ExplicitStepTopology.mts';
type TestConfiguration={mode:'controlled_test_fixture';purpose:'private_operator_approval_fixture'};
export const rawDigest=(bytes:Uint8Array|string)=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
export async function verifyPrivateMeshStorageMode(storage:ElectrostaticHostStorage,test?:TestConfiguration){
  if(test&&(test.mode!=='controlled_test_fixture'||test.purpose!=='private_operator_approval_fixture'
    ||Object.keys(test).sort().join(',')!=='mode,purpose'))throw new Error('PRIVATE_MESH_TEST_CONFIGURATION_INVALID');
  const path=join(storage.paths['source-catalog'],'private-operator-fixture.pin.json');
  if(test){const pin=await readElectrostaticHostJson(path,4096);
    if(digest(pin)!==digest({schema:'tunacad-private-operator-fixture-storage/0.1',approvalSource:'controlled_test_fixture',
      storageIdentity:storage.configurationDigest}))throw new Error('PRIVATE_MESH_FIXTURE_LABEL_INVALID');
  }else{try{await lstat(path);throw new Error('PRIVATE_MESH_FIXTURE_STORAGE_FORBIDDEN');}
    catch(error:any){if(error.code!=='ENOENT')throw error;}}
}
export async function readProtectedMeshBytes(path:string){
  const before=await lstat(path);
  if(!before.isFile()||before.isSymbolicLink()||before.size<1||before.size>16*1024*1024)throw new Error('PRIVATE_MESH_BYTES_INVALID');
  const file=await open(path,'r');try{const info=await file.stat();
    if(info.ino!==before.ino||info.size!==before.size)throw new Error('PRIVATE_MESH_BYTES_CHANGED');
    const bytes=await file.readFile(),after=await file.stat();
    if(bytes.length!==before.size||after.mtimeMs!==before.mtimeMs)throw new Error('PRIVATE_MESH_BYTES_CHANGED');return Uint8Array.from(bytes);
  }finally{await file.close();}
}
export async function writeProtectedMeshBytesOnce(path:string,bytes:Uint8Array){
  if(bytes.length>16*1024*1024)throw new Error('PRIVATE_MESH_BYTES_BUDGET');
  let file;try{file=await open(path,'wx',0o600);}catch(error:any){if(error.code!=='EEXIST')throw error;
    if(rawDigest(await readProtectedMeshBytes(path))!==rawDigest(bytes))throw new Error('PRIVATE_MESH_IMMUTABLE_COLLISION');return;}
  try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
}
async function makeArtifact(storage:ElectrostaticHostStorage,receipt:any,text:string,execution:any){
  const exact=receipt.request.model.cad?.mappingMethod==='exact-step-boundary-v1';
  const mesh=parseExplicitMsh22(text,receipt.source.canonicalSourceDigest,receipt.request.model.kind==='single_solid_cad',exact);
  if(exact){
    if(!/^sha256:[a-f0-9]{64}$/.test(execution.cadTopologyDigest)||execution.cadTopologyReadFailure||execution.stepDigest!==receipt.geometry.byteDigest)
      throw Error('PRIVATE_MESH_CAD_TOPOLOGY_BINDING_INVALID');
    const bytes=await readProtectedMeshBytes(join(storage.paths.results,'explicit-cad-topology-'+execution.cadTopologyDigest.slice(7)+'.txt'));
    if(bytes.length!==execution.cadTopologyByteLength||rawDigest(bytes)!==execution.cadTopologyDigest)throw Error('PRIVATE_MESH_CAD_TOPOLOGY_TAMPERED');
    mesh.cadEvidence={topology:parseExplicitStepTopology(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),metadataDigest:execution.cadTopologyDigest,stepByteDigest:execution.stepDigest};
  }
  const admission=admitExplicitLinearMesh(receipt.request,mesh);
  return {schema:'tunacad-private-explicit-c3d4-artifact/1',projectRevision:receipt.source.revision,
    geometryDigest:receipt.source.canonicalSourceDigest,domainId:receipt.source.domainId,requestDigest:receipt.request.requestDigest,
    mesh,admission};
}
export async function verifyCapturedMeshArtifacts(storage:ElectrostaticHostStorage,record:PrivateExplicitMeshRecord,
  artifact:any,test?:TestConfiguration){
  if(record.schema!=='tunacad-private-explicit-protected-mesh/0.2')throw new Error('PRIVATE_MESH_CAPTURE_REQUIRED');
  const c=record.capture;
  if(c.approvalSource!==(test?'controlled_test_fixture':'human'))throw new Error('PRIVATE_MESH_APPROVAL_SOURCE_MISMATCH');
  const exported=await (await openPrivateExplicitExportStore(storage.root,test)).read(record.geometry.exportId,c.exportReceiptDigest);
  if(digest(exported.receipt.source)!==digest(record.source)||digest(exported.receipt.request)!==digest(record.request))
    throw new Error('PRIVATE_MESH_EXPORT_REQUEST_MISMATCH');
  const raw=await readProtectedMeshBytes(join(storage.paths.results,'explicit-raw-'+c.rawMeshDigest.slice(7)+'.msh'));
  if(rawDigest(raw)!==c.rawMeshDigest||raw.length!==c.rawMeshByteLength)throw new Error('PRIVATE_MESH_RAW_TAMPERED');
  const execution=await readElectrostaticHostJson(join(storage.paths.results,'explicit-execution-'+c.executionReceiptDigest.slice(7)+'.json'),128*1024);
  const expected=await makeArtifact(storage,exported.receipt,new TextDecoder('utf-8',{fatal:true}).decode(raw),execution);
  if(digest(expected)!==record.mesh.meshDigest||digest(artifact)!==digest(expected)
    ||expected.mesh.nodes.length!==record.mesh.nodeCount||expected.mesh.elements.length!==record.mesh.elementCount
    ||expected.admission.faceMappingDigest!==record.mesh.faceMappingDigest||expected.admission.validationDigest!==record.mesh.validationDigest)
    throw new Error('PRIVATE_MESH_REVALIDATION_MISMATCH');
  if(!/^[a-f0-9-]{36}$/.test(execution.runId))throw new Error('PRIVATE_MESH_EXECUTION_ID_INVALID');
  const before=await readElectrostaticHostJson(join(storage.paths.results,'gmsh-'+execution.runId+'-before.json'),32768);
  const cleanup=await readElectrostaticHostJson(join(storage.paths.results,'gmsh-'+execution.runId+'-cleanup.json'),4096);
  if(digest(before)!==execution.predispatchDigest||before.studyId!==record.studyId||before.exportId!==record.geometry.exportId
    ||before.executableDigest!==c.gmshExecutableDigest||before.settingsIdentity!==c.providerSettingsIdentity
    ||before.configurationDigest!==c.configurationDigest||before.stepDigest!==record.geometry.byteDigest
    ||before.sourceBindingDigest!==record.geometry.sourceBindingDigest||before.exportReceiptDigest!==c.exportReceiptDigest
    ||digest(before.args)!==digest(execution.invocation.args)||before.executablePath!==execution.invocation.executable
    ||cleanup.schema!=='tunacad-explicit-gmsh-cleanup/1'||cleanup.runId!==execution.runId||cleanup.cleanupConfirmed!==true)
    throw new Error('PRIVATE_MESH_PREDISPATCH_OR_CLEANUP_MISMATCH');
  if(digest(execution)!==c.executionReceiptDigest||execution.schema!=='tunacad-explicit-gmsh-execution/1'
    ||execution.exitCode!==0||execution.rawMeshDigest!==c.rawMeshDigest||execution.rawMeshByteLength!==c.rawMeshByteLength
    ||execution.configurationDigest!==explicitMeshConfigurationDigest(record.request)||c.configurationDigest!==explicitMeshConfigurationDigest(record.request)
    ||execution.settingsIdentity!==c.providerSettingsIdentity||execution.executableDigest!==c.gmshExecutableDigest
    ||execution.studyId!==record.studyId||execution.exportId!==record.geometry.exportId
    ||execution.stepDigest!==record.geometry.byteDigest||execution.sourceBindingDigest!==record.geometry.sourceBindingDigest
    ||execution.stdoutDigest!==rawDigest(execution.stdout)||execution.stderrDigest!==rawDigest(execution.stderr))
    throw new Error('PRIVATE_MESH_EXECUTION_BINDING_MISMATCH');
}

/** Protected host owner: admits authentic raw output, writes immutable artifacts
 * and pin LAST. No caller mesh, configuration digest or conformity claim. */
export async function capturePrivateExplicitMesh(storage:ElectrostaticHostStorage,exportId:string,
  execution:any,text:string,verifyCurrent:()=>Promise<void>,test?:TestConfiguration){
  await storage.assertReady();await verifyPrivateMeshStorageMode(storage,test);
  const exported=await (await openPrivateExplicitExportStore(storage.root,test)).read(exportId);
  const r=exported.receipt,artifact=await makeArtifact(storage,r,text,execution),meshDigest=digest(artifact),eDigest=digest(execution);
  const record=privateCapturedMeshRecordSchema.parse({schema:'tunacad-private-explicit-protected-mesh/0.2',
    studyId:r.studyId,meshRevision:1,storageIdentity:storage.configurationDigest,source:r.source,geometry:r.geometry,request:r.request,
    mesh:{meshId:'gmsh-explicit-'+meshDigest.slice(7,31),meshDigest,exportId,exportByteDigest:r.geometry.byteDigest,
      sourceBindingDigest:digest(r.source),geometryDigest:r.source.canonicalSourceDigest,
      faceMappingDigest:artifact.admission.faceMappingDigest,validationDigest:artifact.admission.validationDigest,
      meshingRuntime:'Gmsh 4.15.2',nodeCount:artifact.mesh.nodes.length,elementCount:artifact.mesh.elements.length,elementFormulation:'C3D4'},
    capture:{schema:'tunacad-private-explicit-gmsh-capture/1',createdAt:new Date().toISOString(),
      approvalSource:test?'controlled_test_fixture':'human',exportReceiptDigest:exported.status.receiptDigest,
      executionReceiptDigest:eDigest,rawMeshDigest:rawDigest(text),rawMeshByteLength:Buffer.byteLength(text),
      gmshExecutableDigest:execution.executableDigest,providerSettingsIdentity:execution.settingsIdentity,configurationDigest:explicitMeshConfigurationDigest(r.request)}});
  await writeProtectedMeshBytesOnce(join(storage.paths.results,'explicit-raw-'+record.capture.rawMeshDigest.slice(7)+'.msh'),new TextEncoder().encode(text));
  await writeElectrostaticHostOnce(join(storage.paths.results,'explicit-execution-'+eDigest.slice(7)+'.json'),execution,128*1024);
  await verifyCapturedMeshArtifacts(storage,record,artifact,test);await verifyCurrent();
  await writeElectrostaticHostOnce(join(storage.paths.results,'explicit-mesh-'+meshDigest.slice(7)+'.json'),artifact);
  const recordDigest=digest(record),lookupDigest=digest({studyId:r.studyId,geometry:r.geometry,source:r.source});
  await writeElectrostaticHostOnce(join(storage.paths.studies,'explicit-mesh-'+recordDigest.slice(7)+'.json'),record,65536);
  await storage.assertReady();await verifyCurrent();
  await writeElectrostaticHostOnce(join(storage.paths['source-catalog'],'explicit-mesh-'+lookupDigest.slice(7)+'.pin.json'),{
    schema:'tunacad-private-explicit-mesh-pin/0.1',lookupDigest,recordDigest,storageIdentity:storage.configurationDigest},4096);
  return record;
}
