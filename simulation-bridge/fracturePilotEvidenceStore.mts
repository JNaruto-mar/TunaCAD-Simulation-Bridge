import {randomUUID,createHash} from 'node:crypto';
import {readdir,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {openNativeSimulationStorage,openNativeSimulationWorkflowStorage,openExistingNativeSimulationWorkflowStorage,assertNativeWorkflowAllocationAvailable} from './nativeSimulationStorage.mts';
import {validateNativeWorkflowId} from './nativeWorkflowStorageLifecycle.mts';
import type {ElectrostaticHostStorage} from './electrostaticHostStorage.mts';
import {initializeNativeWorkflowClaim} from './nativeWorkflowClaim.mts';
import {createWorkflowOwnerLifecycle,isWorkflowOwnerLifecycle,type WorkflowOwnerLifecycle} from './workflowOwnerLifecycle.mts';
import {bindNativeWorkflowMaintenance} from './workflowMaintenanceBarrier.mts';
import {fractureFailureDiagnostic} from './fractureFailureDiagnostic.mts';
import {readElectrostaticHostJson,writeElectrostaticHostOnce} from './electrostaticHostStorage.mts';
import {withProtectedStorageWrite} from './protectedStorageWriteBoundary.mts';

export type FracturePilotEvidenceEvent={stage:string;outcome:'started'|'passed'|'failed'|'cancelled';
  detail?:string;artifact?:string|Uint8Array;ownerJobId?:string;bindingDigest?:string;runtimePinDigest?:string};
export type RetainFracturePilotEvidence=(event:FracturePilotEvidenceEvent)=>Promise<void>;
type Role='results'|'completion-catalog';
type Port={ready():Promise<void>;list(role:Role):Promise<string[]>;
  read(role:Role,name:string):Promise<any>;write(role:Role,name:string,value:unknown):Promise<void>;remove(role:Role,name:string):Promise<void>};
const chunkBytes=8*1024*1024,maxBytes=128*1024*1024,ttlMs=20*60000;
const prefix=/^fracture-evidence-[a-f0-9-]{36}$/;
const file=/^(fracture-evidence-[a-f0-9-]{36})-(\d{2})\.(json|\d{2}\.chunk\.json)$/;
const hash=(value:Uint8Array|Buffer)=>createHash('sha256').update(new Uint8Array(value)).digest('hex');
function check(ok:unknown,reason='validation'):asserts ok{if(!ok){
  const error=Error('FRACTURE_EVIDENCE_STORAGE_INVALID');
  Object.assign(error,{evidenceDiagnostic:{stage:'evidence-validation',reason}});throw error;
}}

/** Existing root only; no path/configuration or provisioning accepted. The port
 * below is internal test plumbing, never browser input or a provider override. */
async function nativePort():Promise<Port>{
  const owner=await openNativeSimulationStorage({provisionIfMissing:false});return nativeStoragePort(owner.storage);
}
function nativeStoragePort(s:ElectrostaticHostStorage,claim?:{write(role:'results'|'completion-catalog',name:string,data:Uint8Array):Promise<void>}):Port{
  const port:Port={ready:()=>s.assertReady(),list:role=>readdir(s.paths[role]),
    read:(role,name)=>readElectrostaticHostJson(join(s.paths[role],name)),
    write:(role,name,value)=>claim?claim.write(role,name,new TextEncoder().encode(JSON.stringify(value))):writeElectrostaticHostOnce(join(s.paths[role],name),value),
    remove:async(role,name)=>{check(!claim,'claimed-cleanup-forbidden');check(file.test(name));const path=join(s.paths[role],name);
      await withProtectedStorageWrite(path,()=>unlink(path));}};
  return port;
}
export async function openNativeFracturePilotEvidence(){return createWriter(await nativePort(),'native_owner_protected_store');}
type WorkflowScope={workflowId:string;storageIdentity:string};
type WorkflowPort={scope:WorkflowScope;port:Port};
const workflowLocatorSchema='fracture-workflow-evidence/1';
function validateScope(scope:WorkflowScope){
  validateNativeWorkflowId(scope?.workflowId);check(/^sha256:[a-f0-9]{64}$/.test(scope?.storageIdentity),'workflow-storage-identity');
}
export function parseFractureWorkflowEvidenceLocator(locator:string){
  check(typeof locator==='string'&&locator.length<=300,'workflow-locator');
  const parts=locator.split('|');check(parts.length===4&&parts[0]===workflowLocatorSchema,'workflow-locator');
  const scope={workflowId:parts[1],storageIdentity:parts[2]};validateScope(scope);check(prefix.test(parts[3]),'workflow-locator');
  return {...scope,reference:parts[3]};
}
/** Explicit opt-in. Never selects arbitrary roots or falls back to the shared
 * store, and never retries/allocates another namespace if initialization fails. */
export async function openNativeFractureWorkflowEvidence(options:{purpose:'isolated_fracture_pilot_evidence';owner?:WorkflowOwnerLifecycle}){
  check(options?.purpose==='isolated_fracture_pilot_evidence'&&Object.keys(options).every(key=>['purpose','owner'].includes(key)),'workflow-override');
  check(!options.owner||isWorkflowOwnerLifecycle(options.owner),'workflow-owner-invalid');
  const lifecycle=options.owner??createWorkflowOwnerLifecycle();
  await assertNativeWorkflowAllocationAvailable(); // No namespace consumed for setup/pairing.
  return deferWorkflowEvidence(lifecycle,async()=>{
    let storageStage='workflow-allocation';
    try{
    const owner=await openNativeSimulationWorkflowStorage('fracture_evidence'); // One attempt, rechecked under allocation lock.
    storageStage='maintenance-binding';
    bindNativeWorkflowMaintenance(lifecycle,owner);
    storageStage='claim-initialization';
    const claim=await initializeNativeWorkflowClaim(owner,'fracture_evidence',lifecycle.shutdown);
    storageStage='evidence-initialization';
    const writer=await createWorkflowWriter(async()=>({scope:{workflowId:owner.workflowId,storageIdentity:owner.storage.configurationDigest},
      port:nativeStoragePort(owner.storage,claim)}),'native_owner_protected_store',Date.now);
    return {writer,release:async()=>{await claim.release();await owner.budget.release(lifecycle.shutdown);}};
    }catch(error){throw Object.assign(new Error('FRACTURE_STORAGE_INITIALIZATION_FAILED',{cause:error}),{storageStage});}
  },'native_owner_protected_store');
}
type WorkflowWriter=Awaited<ReturnType<typeof createWorkflowWriter>>;
function deferWorkflowEvidence(lifecycle:WorkflowOwnerLifecycle,open:()=>Promise<{writer:WorkflowWriter;release():Promise<void>}>,provenance:string){
  let opening:ReturnType<typeof open>|undefined,opened:Awaited<ReturnType<typeof open>>|undefined,failed=false;
  let firstFailure:ReturnType<typeof fractureFailureDiagnostic>|undefined;
  const flush=async()=>{if(opening)await(await opening).writer.flush();};
  lifecycle.attachStorage({flush,release:async()=>{if(opening)await(await opening).release();}});
  return {
    retain:(event:FracturePilotEvidenceEvent)=>lifecycle.evidence(async()=>{
      // Invalid events must not consume a permanent namespace.
      check(event&&/^[a-z_]{1,48}$/.test(event.stage)&&['started','passed','failed','cancelled'].includes(event.outcome));
      check((event.detail?.length??0)<=32768&&(event.artifact===undefined||typeof event.artifact==='string'||event.artifact instanceof Uint8Array));
      const length=typeof event.artifact==='string'?Buffer.byteLength(event.artifact):event.artifact?.byteLength??0;
      check(length<=64*1024*1024);
      if(!opening)opening=Promise.resolve().then(open).then(value=>{opened=value;return value;});
      try{await(await opening).writer.retain(event);}catch(error){failed=true;firstFailure??=fractureFailureDiagnostic(error);throw error;}
    }),flush,
    summary:()=>({...opened?.writer.summary(),reference:opened?.writer.summary().reference??'',provenance,
      namespaceAllocated:opened?true:opening?null:false,allocationStarted:!!opening,retentionFailure:failed||opened?.writer.summary().retentionFailure===true,
      ...(firstFailure?{failure:firstFailure}:{}),
      engineeringUsePermitted:false}),ownerLifecycle:lifecycle,closeUnused:()=>lifecycle.closeUnused(),
  };
}
/** Constructor-only controlled fixture. Same deferred orchestration, no native
 * handles, real authentication, protected storage or provenance conversion. */
export async function createControlledDeferredFractureWorkflowEvidence(options:{purpose:'controlled_deferred_fracture_workflow_fixture';owner:WorkflowOwnerLifecycle;
  preflight():Promise<void>;open():Promise<{scope:WorkflowScope;port:Port;release():Promise<void>}>},now:()=>number=Date.now){
  check(options?.purpose==='controlled_deferred_fracture_workflow_fixture'&&isWorkflowOwnerLifecycle(options.owner),'workflow-owner-invalid');
  await options.preflight();return deferWorkflowEvidence(options.owner,async()=>{
    const opened=await options.open();
    return {writer:await createWorkflowWriter(async()=>opened,'controlled_storage_fixture',now),release:opened.release};
  },'controlled_storage_fixture');
}
/** Simulated storage only. Native readers reject its controlled provenance. */
export async function createControlledFractureWorkflowEvidence(options:{purpose:'controlled_fracture_workflow_fixture';create():Promise<WorkflowPort>},now:()=>number=Date.now){
  check(options?.purpose==='controlled_fracture_workflow_fixture','workflow-override');
  return createWorkflowWriter(options.create,'controlled_storage_fixture',now);
}
async function createWorkflowWriter(create:()=>Promise<WorkflowPort>,provenance:string,now:()=>number){
  const opened=await create(),scope=Object.freeze({...opened.scope});validateScope(scope);await opened.port.ready();
  // A newly owned workflow must be empty. No shared-store cleanup or migration.
  check((await opened.port.list('results')).length===0&&(await opened.port.list('completion-catalog')).length===0,'workflow-not-empty');
  const writer=await createWriter(opened.port,provenance,now);
  return {...writer,summary(){const summary=writer.summary();return {...summary,
    reference:[workflowLocatorSchema,scope.workflowId,scope.storageIdentity,summary.reference].join('|'),
    storageScope:provenance==='native_owner_protected_store'?'isolated_native_workflow':'isolated_controlled_workflow',
    retention:'20-minute logical expiry; exact-workflow diagnostics only; namespace remains within the bounded retained-workflow policy'};}};
}
/** Read-only normal-owner diagnostic. Never purges, provisions, reserves,
 * creates a job or dispatches a provider; no paths or record contents returned. */
export async function inspectNativeFracturePilotEvidence(){return inspectEvidence(await nativePort(),Date.now);}
export async function inspectControlledFracturePilotEvidence(port:Port,now:()=>number=Date.now){return inspectEvidence(port,now);}
async function inspectEvidence(port:Port,now:()=>number){
  await port.ready();let expiredManifests=0,expiredChunks=0;
  const manifests=await port.list('completion-catalog'),chunks=await port.list('results');
  for(const name of manifests){
    if(!file.test(name)||!name.endsWith('.json'))continue;
    const record=await port.read('completion-catalog',name);
    try{validateRecord(record,name);}catch(error){Object.assign(error as object,{evidenceDiagnostic:{stage:'existing-manifest-validation',reason:'invalid-record'}});throw error;}
    if(record.expiresAt>now())continue;
    for(const descriptor of record.chunks){try{await readChunk(port,descriptor);}catch(error){
      Object.assign(error as object,{evidenceDiagnostic:{stage:'expired-manifest-chunk-validation',reason:'invalid-or-unavailable-chunk'}});throw error;}}
    expiredManifests++;
  }
  for(const name of chunks){
    if(!file.test(name)||!name.endsWith('.chunk.json'))continue;
    const c=await port.read('results',name);
    check(c?.schema==='tunacad-fracture-evidence-chunk/1'&&prefix.test(c.reference)&&name.startsWith(c.reference+'-')
      &&Number.isSafeInteger(c.expiresAt)&&typeof c.data==='string'&&c.data.length<=12*1024*1024,'existing-chunk-shape');
    if(c.expiresAt>now())continue;
    check(hash(Buffer.from(c.data,'base64'))===c.sha256,'expired-orphan-chunk-hash');expiredChunks++;
  }
  await port.ready();
  return {schema:'tunacad-fracture-evidence-preflight/1',aclVerification:'PASS',
    resultFiles:chunks.length,manifestFiles:manifests.length,verifiedExpiredChunks:expiredChunks,
    verifiedExpiredManifests:expiredManifests,maximumExistingFiles:16,
    capacityAfterExistingExpiryPolicy:chunks.length-expiredChunks<=16&&manifests.length-expiredManifests<=16?'PASS':'BLOCKED',
    readOnly:true,browserStarted:false,nativeStarted:false,engineeringUsePermitted:false};
}
/** Owner-terminal diagnostics only. These files cannot recover a job, grant
 * approval or become admitted FEM results. No HTTP/browser route exists. */
export async function readNativeFractureDiagnostic(reference:string){
  if(prefix.test(reference))return readRecords(await nativePort(),reference,'native_owner_protected_store',Date.now);
  const locator=parseFractureWorkflowEvidenceLocator(reference);
  const owner=await openExistingNativeSimulationWorkflowStorage(locator.workflowId);
  check(owner.storage.configurationDigest===locator.storageIdentity,'workflow-storage-identity');
  return readRecords(nativeStoragePort(owner.storage),locator.reference,'native_owner_protected_store',Date.now);
}
export async function readControlledFractureWorkflowDiagnostic(port:Port,scope:WorkflowScope,reference:string,now:()=>number=Date.now){
  validateScope(scope);const locator=parseFractureWorkflowEvidenceLocator(reference);
  check(locator.workflowId===scope.workflowId&&locator.storageIdentity===scope.storageIdentity,'workflow-storage-identity');
  return readRecords(port,locator.reference,'controlled_storage_fixture',now);
}
export async function readControlledFractureDiagnostic(port:Port,reference:string,now:()=>number=Date.now){
  return readRecords(port,reference,'controlled_storage_fixture',now);
}
async function readRecords(port:Port,reference:string,provenance:string,now:()=>number){
  check(prefix.test(reference));await port.ready();
  const records=[];
  for(const name of (await port.list('completion-catalog')).filter(n=>file.test(n)&&n.startsWith(reference+'-')).sort()){
    const r=await port.read('completion-catalog',name);validateRecord(r,name);
    check(r.provenance===provenance&&r.expiresAt>now());
    const parts=[];for(const c of r.chunks)parts.push(await readChunk(port,c));
    const bytes=Buffer.concat(parts.map(part=>new Uint8Array(part)));check(bytes.length===r.byteLength&&hash(bytes)===r.sha256);
    records.push({metadata:r.metadata,artifact:new Uint8Array(bytes)});
  }
  check(records.length>0&&records.length<=20);await port.ready();return records;
}
/** Explicit simulated storage: cannot assert Windows ACLs or native provenance. */
export async function createControlledFractureEvidence(port:Port,now:()=>number=Date.now){
  return createWriter(port,'controlled_storage_fixture',now);
}
async function createWriter(port:Port,provenance:string,now:()=>number=Date.now){
  await port.ready();
  // Expired records are inaccessible. Reclaim only this format's authenticated
  // manifest/chunks, never another capability's records or unlisted files.
  for(const name of await port.list('completion-catalog')){
    if(!file.test(name)||!name.endsWith('.json'))continue;
    const r=await port.read('completion-catalog',name);
    try{validateRecord(r,name);}catch(error){
      Object.assign(error as object,{evidenceDiagnostic:{stage:'existing-manifest-validation',reason:'invalid-record'}});throw error;}
    if(r.expiresAt>now())continue;
    for(const c of r.chunks){let bytes:Buffer;try{bytes=await readChunk(port,c);}catch(error){
      Object.assign(error as object,{evidenceDiagnostic:{stage:'expired-manifest-chunk-validation',reason:'invalid-or-unavailable-chunk'}});throw error;}
      check(hash(bytes)===c.sha256,'expired-chunk-hash');}
    await port.ready();
    for(const c of r.chunks)await port.remove('results',c.name);
    await port.remove('completion-catalog',name);
  }
  // A failed write may leave a chunk without a published manifest. Reclaim
  // only independently verified expired chunks in this exact namespace.
  for(const name of await port.list('results')){
    if(!file.test(name)||!name.endsWith('.chunk.json'))continue;
    const c=await port.read('results',name);
    check(c?.schema==='tunacad-fracture-evidence-chunk/1'&&prefix.test(c.reference)&&name.startsWith(c.reference+'-')
      &&Number.isSafeInteger(c.expiresAt)&&typeof c.data==='string'&&c.data.length<=12*1024*1024,'existing-chunk-shape');
    if(c.expiresAt>now())continue;
    check(hash(Buffer.from(c.data,'base64'))===c.sha256,'expired-orphan-chunk-hash');await port.ready();await port.remove('results',name);
  }
  // Reserve conservatively before any native launch. Existing 40-file
  // per-store/per-role bounds and per-file 16 MiB policy are NOT increased.
  const resultFiles=(await port.list('results')).length,manifestFiles=(await port.list('completion-catalog')).length;
  if(resultFiles>16||manifestFiles>16){
    const error=Error('FRACTURE_EVIDENCE_STORAGE_INVALID');
    Object.assign(error,{evidenceDiagnostic:{stage:'evidence-capacity-reservation',reason:'insufficient-free-file-slots',resultFiles,manifestFiles,maximumExistingFiles:16}});
    throw error;
  }
  const reference='fracture-evidence-'+randomUUID(),expiresAt=now()+ttlMs;
  let sequence=0,total=0,poisoned=false,queue:Promise<unknown>=Promise.resolve();
  const retain:RetainFracturePilotEvidence=event=>{
    const task=queue.then(async()=>{
      check(!poisoned&&now()<expiresAt&&sequence<20);
      check(/^[a-z_]{1,48}$/.test(event.stage)&&['started','passed','failed','cancelled'].includes(event.outcome));
      const bytes=typeof event.artifact==='string'?Buffer.from(event.artifact,'utf8'):Buffer.from(event.artifact??new Uint8Array());
      // JSON escaping of the existing 12,000-char native log plus first-error
      // metadata must not accidentally reject otherwise bounded diagnostics.
      check(bytes.length<=64*1024*1024&&total+bytes.length<=maxBytes&&(event.detail?.length??0)<=32768);
      const index=String(sequence++).padStart(2,'0'),chunks:any[]=[];
      await port.ready();
      check((await port.list('results')).length+Math.ceil(bytes.length/chunkBytes)<=40);
      check((await port.list('completion-catalog')).length<40);
      for(let offset=0;offset<bytes.length;offset+=chunkBytes){
        const part=bytes.subarray(offset,offset+chunkBytes),name=`${reference}-${index}.${String(chunks.length).padStart(2,'0')}.chunk.json`;
        const value={schema:'tunacad-fracture-evidence-chunk/1',reference,expiresAt,data:part.toString('base64'),sha256:hash(part)};
        await port.write('results',name,value);
        const descriptor={name,sha256:value.sha256,byteLength:part.length};
        check(hash(await readChunk(port,descriptor))===value.sha256);chunks.push(descriptor);
      }
      total+=bytes.length;
      const {artifact,...metadata}=event;
      const record={schema:'tunacad-fracture-pilot-diagnostic/1',reference,provenance,expiresAt,
        metadata,chunks,byteLength:bytes.length,sha256:hash(bytes)};
      await port.ready(); // Fresh DACL check before publishing the manifest.
      const name=`${reference}-${index}.json`;await port.write('completion-catalog',name,record);
      check(JSON.stringify(await port.read('completion-catalog',name))===JSON.stringify(record));
      await port.ready();
    });
    queue=task.catch(()=>{poisoned=true;});return task;
  };
  return {retain,summary:()=>({reference,provenance,expiresAt,events:sequence,bytes:total,
    retentionFailure:poisoned,retention:'20-minute logical expiry; verified deletion on next owner open',engineeringUsePermitted:false}),
    flush:async()=>{await queue;check(!poisoned);}};
}
function validateRecord(r:any,name:string){
  check(r?.schema==='tunacad-fracture-pilot-diagnostic/1'&&prefix.test(r.reference)
    &&name.startsWith(r.reference+'-')&&Number.isSafeInteger(r.expiresAt)&&Array.isArray(r.chunks)&&r.chunks.length<=8);
  for(const c of r.chunks)check(file.test(c.name)&&c.name.startsWith(name.slice(0,-5)+'.')
    &&/^[a-f0-9]{64}$/.test(c.sha256)&&Number.isSafeInteger(c.byteLength)&&c.byteLength>0&&c.byteLength<=chunkBytes);
}
async function readChunk(port:Port,c:any){
  const r=await port.read('results',c.name);check(r?.schema==='tunacad-fracture-evidence-chunk/1'&&typeof r.data==='string');
  const bytes=Buffer.from(r.data,'base64');check(bytes.length===c.byteLength&&hash(bytes)===c.sha256);return bytes;
}
