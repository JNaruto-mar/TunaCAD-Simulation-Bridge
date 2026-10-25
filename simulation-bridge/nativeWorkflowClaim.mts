import {generateKeyPairSync,createPublicKey,sign,verify,randomBytes} from 'node:crypto';
import {mkdir,lstat,rmdir,readdir,open} from 'node:fs/promises';
import {join} from 'node:path';
import * as z from 'zod/v4';
import {digest,stableSerialize} from './stableDigest.mts';
import {validateNativeWorkflowId} from './nativeWorkflowStorageLifecycle.mts';
import {consumeFreshNativeWorkflowHandle,openExistingNativeSimulationWorkflowStorage,openNativeSimulationStorage} from './nativeSimulationStorage.mts';
import {readElectrostaticHostJson,type ElectrostaticHostStorage} from './electrostaticHostStorage.mts';
import {withProtectedCapacityPublication,withProtectedCapacityMutation} from './protectedCapacityPublication.mts';
import {withNativeOwnerMutation,assertNativeOwnerPermit} from './nativeOwnerMaintenanceGate.mts';

const policyName='workflow-claim-policy.pin.json',journalPattern=/^workflow-claim-(\d{2})\.json$/;
const roles=['studies','source-catalog','results','completion-catalog'] as const;
type Role=typeof roles[number];
type Scope={workflowId:string;storageIdentity:string};
type Provenance='native_owner_protected_store'|'controlled_storage_fixture';
type Purpose='fracture_evidence'|'private_explicit_owner';
const sha=z.string().regex(/^sha256:[a-f0-9]{64}$/);
const scopeSchema=z.object({workflowId:z.string().regex(/^workflow-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/),storageIdentity:sha}).strict();
const purposeSchema=z.enum(['fracture_evidence','private_explicit_owner']);
const provenanceSchema=z.enum(['native_owner_protected_store','controlled_storage_fixture']);
const recordSchema=z.object({schema:z.literal('tunacad-workflow-claim-record/1'),scope:scopeSchema,purpose:purposeSchema,
  provenance:provenanceSchema,kind:z.enum(['claim','release']),sequence:z.number().int().min(0).max(37),previousDigest:sha.nullable(),
  claimId:z.string().regex(/^[a-f0-9]{64}$/),publicKey:z.string().min(80).max(256),at:z.number().int().nonnegative(),
  signature:z.string().regex(/^[A-Za-z0-9+/]{86}==$/),recordDigest:sha}).strict();
type RecordValue=z.infer<typeof recordSchema>;
const pinSchema=z.object({schema:z.literal('tunacad-workflow-claim-policy/1'),scope:scopeSchema,purpose:purposeSchema,
  provenance:provenanceSchema,genesisDigest:sha,protocol:z.literal('exclusive-writer-release/1')}).strict();
type Lock={assertOwned():Promise<void>;close():Promise<void>};
/** Trusted storage-only port. It confers NO source, pairing, job, result or
 * simulation approval authority. Native callers cannot inject this port. */
export type ControlledWorkflowClaimPort={verifyFresh():Promise<void>;lock():Promise<Lock>;
  capacityReleaseSlot?:boolean;
  list(role:Role):Promise<string[]>;read(name:string):Promise<unknown>;
  writeOnce(role:Role,name:string,bytes:Uint8Array):Promise<void>};
export type ReadonlyWorkflowClaimPort=Pick<ControlledWorkflowClaimPort,'verifyFresh'|'list'|'read'>&{lockPresent():Promise<boolean>};
type Shutdown={confirmQuiescent(signal:AbortSignal):Promise<void>};
function requireClaim(ok:unknown,code='INVALID'):asserts ok{if(!ok)throw Error('NATIVE_WORKFLOW_CLAIM_'+code);}
function parse<T>(schema:z.ZodType<T>,value:unknown):T{try{return schema.parse(value);}catch{throw Error('NATIVE_WORKFLOW_CLAIM_JOURNAL_INVALID');}}
function scopeEqual(a:Scope,b:Scope){return a.workflowId===b.workflowId&&a.storageIdentity===b.storageIdentity;}
function bytes(value:unknown){return new TextEncoder().encode(stableSerialize(value));}
function checkSignature(record:RecordValue){
  const {signature,recordDigest,...unsigned}=record;
  requireClaim(digest({...unsigned,signature})===recordDigest,'JOURNAL_INVALID');
  try{const key=createPublicKey(record.publicKey);requireClaim(key.asymmetricKeyType==='ed25519','JOURNAL_INVALID');
    requireClaim(verify(null,bytes(unsigned),key,new Uint8Array(Buffer.from(signature,'base64'))),'JOURNAL_INVALID');
  }catch{throw Error('NATIVE_WORKFLOW_CLAIM_JOURNAL_INVALID');}
}
async function history(port:Pick<ControlledWorkflowClaimPort,'list'|'read'>,scope:Scope,purpose:Purpose,provenance:Provenance){
  const names=await port.list('source-catalog');requireClaim(names.length<=40,'CAPACITY');
  requireClaim(names.includes(policyName),'LEGACY_UNCLAIMABLE');
  const pin=parse(pinSchema,await port.read(policyName));
  requireClaim(scopeEqual(pin.scope,scope)&&pin.purpose===purpose&&pin.provenance===provenance,'BINDING_MISMATCH');
  const journals=names.filter(name=>name.toLowerCase().startsWith('workflow-claim-')&&name!==policyName).sort();
  requireClaim(journals.length>0&&journals.length<=38,'JOURNAL_INVALID');
  let previous:RecordValue|undefined;const claimIds=new Set<string>(),keys=new Set<string>();
  for(let i=0;i<journals.length;i++){
    requireClaim(journals[i]===`workflow-claim-${String(i).padStart(2,'0')}.json`,'JOURNAL_INVALID');
    const record=parse(recordSchema,await port.read(journals[i]));checkSignature(record);
    requireClaim(record.sequence===i&&scopeEqual(record.scope,scope)&&record.purpose===purpose&&record.provenance===provenance,'BINDING_MISMATCH');
    requireClaim(record.previousDigest===(previous?.recordDigest??null)&&record.at>=(previous?.at??0),'JOURNAL_INVALID');
    if(!previous)requireClaim(record.kind==='claim'&&record.recordDigest===pin.genesisDigest,'JOURNAL_INVALID');
    else if(previous.kind==='claim')requireClaim(record.kind==='release'&&record.claimId===previous.claimId&&record.publicKey===previous.publicKey,'JOURNAL_INVALID');
    else requireClaim(record.kind==='claim'&&record.claimId!==previous.claimId&&record.publicKey!==previous.publicKey,'JOURNAL_INVALID');
    if(record.kind==='claim'){
      requireClaim(!claimIds.has(record.claimId)&&!keys.has(record.publicKey),'JOURNAL_INVALID');claimIds.add(record.claimId);keys.add(record.publicKey);
    }
    previous=record;
  }
  return previous!;
}
async function inspectInactivity(port:ReadonlyWorkflowClaimPort,scope:Scope,purpose:Purpose,provenance:Provenance){
  parse(scopeSchema,scope);parse(purposeSchema,purpose);await port.verifyFresh();
  const names=await port.list('source-catalog');requireClaim(names.length<=40,'CAPACITY');
  if(!names.includes(policyName))return {status:'UNKNOWN',reason:'legacy-no-release-proof',reuseAuthorized:false,provenance} as const;
  const first=await history(port,scope,purpose,provenance),locked=await port.lockPresent();
  await port.verifyFresh();const last=await history(port,scope,purpose,provenance);
  if(first.recordDigest!==last.recordDigest||locked||await port.lockPresent()||last.kind!=='release')
    return {status:'UNKNOWN',reason:'active-or-changing-owner',reuseAuthorized:false,provenance} as const;
  return {status:'VERIFIED_RELEASE_SNAPSHOT',reason:'signed-owner-release',reuseAuthorized:false,provenance} as const;
}
export function inspectControlledWorkflowInactivity(port:ReadonlyWorkflowClaimPort,scope:Scope,purpose:Purpose){
  return inspectInactivity(port,scope,purpose,'controlled_storage_fixture');
}
async function roleBudget(port:ControlledWorkflowClaimPort,role:Role,additional:number,reservedRelease=0){
  const names=await port.list(role);requireClaim(names.length+additional+reservedRelease<=40,'CAPACITY');
  return names;
}
async function append(port:ControlledWorkflowClaimPort,record:RecordValue,signal?:AbortSignal){
  const data=bytes(record);requireClaim(data.length<=16384,'CAPACITY');
  await roleBudget(port,'source-catalog',1);
  const name=`workflow-claim-${String(record.sequence).padStart(2,'0')}.json`;
  requireClaim(!signal?.aborted,'RELEASE_CANCELLED');
  await port.writeOnce('source-catalog',name,data);
  requireClaim(digest(await port.read(name))===digest(record),'WRITE_INTEGRITY');
  await port.verifyFresh();
  requireClaim(!signal?.aborted,'RELEASE_CANCELLED');
}
export function validateWorkflowClaimDataBudget(purpose:Purpose,written:number,next:number){
  requireClaim(Number.isSafeInteger(written)&&written>=0&&Number.isSafeInteger(next)&&next>=0&&next<=16*1024*1024,'CAPACITY');
  requireClaim(purpose!=='fracture_evidence'||written+next<=128*1024*1024,'CAPACITY');
}
function signer(scope:Scope,purpose:Purpose,provenance:Provenance,now:()=>number){
  const pair=generateKeyPairSync('ed25519'),publicKey=pair.publicKey.export({type:'spki',format:'pem'}).toString();
  const claimId=randomBytes(32).toString('hex');
  return {record(kind:'claim'|'release',previous?:RecordValue){
    const unsigned={schema:'tunacad-workflow-claim-record/1' as const,scope,purpose,provenance,kind,
      sequence:(previous?.sequence??-1)+1,previousDigest:previous?.recordDigest??null,claimId,publicKey,at:now()};
    const signature=sign(null,bytes(unsigned),pair.privateKey).toString('base64');
    return parse(recordSchema,{...unsigned,signature,recordDigest:digest({...unsigned,signature})});
  }};
}
async function quiescent(guard:Shutdown,signal?:AbortSignal){
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,remove=()=>{};
  try{await Promise.race([Promise.resolve().then(()=>guard.confirmQuiescent(controller.signal)),new Promise<never>((_,reject)=>{
    const abort=()=>{controller.abort();reject(Error('NATIVE_WORKFLOW_CLAIM_RELEASE_CANCELLED'));};
    remove=()=>signal?.removeEventListener('abort',abort);
    if(signal?.aborted)return abort();signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>{controller.abort();reject(Error('NATIVE_WORKFLOW_CLAIM_SHUTDOWN_UNCONFIRMED'));},5000);
  })]);}finally{clearTimeout(timer);remove();}
}
async function openClaim(port:ControlledWorkflowClaimPort,inputScope:Scope,purpose:Purpose,provenance:Provenance,
  fresh:boolean,guard:Shutdown,now:()=>number){
  const scope=Object.freeze(parse(scopeSchema,{...inputScope}));parse(purposeSchema,purpose);
  requireClaim(typeof guard?.confirmQuiescent==='function','SHUTDOWN_GUARD_REQUIRED');
  await port.verifyFresh();const lock=await port.lock();let head:RecordValue;
  const owner=signer(scope,purpose,provenance,now);
  try{
    await lock.assertOwned();await port.verifyFresh();
    if(fresh){
      for(const role of roles){const names=await port.list(role);
        requireClaim(role==='source-catalog'?names.length===(port.capacityReleaseSlot?2:1)&&names.includes('configuration.pin.json')
          &&(!port.capacityReleaseSlot||names.includes('workflow-capacity.pin.json')):names.length===0,'FRESH_REQUIRED');}
      await roleBudget(port,'source-catalog',port.capacityReleaseSlot?4:3); // Both release metadata slots reserved.
      head=owner.record('claim');await append(port,head);
      const pin=parse(pinSchema,{schema:'tunacad-workflow-claim-policy/1',scope,purpose,provenance,genesisDigest:head.recordDigest,protocol:'exclusive-writer-release/1'});
      await port.writeOnce('source-catalog',policyName,bytes(pin));
      requireClaim(digest(await port.read(policyName))===digest(pin),'WRITE_INTEGRITY');
    }else{
      const last=await history(port,scope,purpose,provenance);
      requireClaim(last.kind==='release','ACTIVE_OR_UNKNOWN');
      requireClaim(last.sequence+2<=37,'CAPACITY');await roleBudget(port,'source-catalog',2);
      head=owner.record('claim',last);await append(port,head);
    }
    await port.verifyFresh();requireClaim((await history(port,scope,purpose,provenance)).recordDigest===head.recordDigest,'JOURNAL_INVALID');
  }catch(error){try{await lock.close();}catch(cleanup){throw new AggregateError([error,cleanup],'NATIVE_WORKFLOW_CLAIM_CLEANUP_FAILED',{cause:error});}throw error;}
  let state:'active'|'closing'|'released'|'blocked'='active',writes=0,writing=false,written=0;
  async function current(){await lock.assertOwned();await port.verifyFresh();
    requireClaim((await history(port,scope,purpose,provenance)).recordDigest===head.recordDigest,'STALE_HANDLE');}
  return Object.freeze({
    summary:()=>({state,pendingWrites:writes,provenance,protocol:'exclusive-writer-release/1',engineeringUsePermitted:false}),
    async write(role:Role,name:string,data:Uint8Array){
      requireClaim(state==='active'&&!writing,'NOT_WRITABLE');
      requireClaim(roles.includes(role)&&/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,159}$/.test(name)&&!name.endsWith('.')
        &&!/^workflow-claim-/i.test(name)&&!/^configuration\.pin\.json$/i.test(name)
        &&!/^workflow-capacity[.-]/i.test(name)
        &&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name),'RESERVED_NAME');
      requireClaim(data instanceof Uint8Array,'CAPACITY');validateWorkflowClaimDataBudget(purpose,written,data.length);
      const copy=new Uint8Array(data);writing=true;writes++;
      try{await current();const names=await roleBudget(port,role,1,role==='source-catalog'?(port.capacityReleaseSlot?2:1):0);
        requireClaim(!names.includes(name),'IMMUTABLE_COLLISION');written+=copy.length;await port.writeOnce(role,name,copy);await current();
      }catch(error){state='blocked';throw error;}finally{writing=false;writes--;}
    },
    async release(signal?:AbortSignal){
      requireClaim(state!=='released'&&state!=='closing','RELEASE_REPLAY');
      // No new writes are admitted while shutdown is verified. Expiry is never
      // inactivity proof; failed/cancelled shutdown leaves an unreleased claim.
      state='closing';
      try{requireClaim(writes===0,'WRITES_PENDING');await quiescent(guard,signal);requireClaim(!signal?.aborted,'RELEASE_CANCELLED');
        await current();requireClaim(writes===0,'WRITES_PENDING');requireClaim(!signal?.aborted,'RELEASE_CANCELLED');
        const record=owner.record('release',head);await append(port,record,signal);head=record;
        await lock.assertOwned();await lock.close();state='released';
      }catch(error){state='blocked';throw error;}
    },
  });
}

/** Explicit fixtures cannot issue native-provenance records. No native IO. */
export async function openControlledWorkflowClaim(options:{purpose:'controlled_workflow_claim_fixture';port:ControlledWorkflowClaimPort;
  scope:Scope;workflowPurpose:Purpose;mode:'fresh'|'released';shutdown:Shutdown;now?:()=>number}){
  requireClaim(options?.purpose==='controlled_workflow_claim_fixture'&&['fresh','released'].includes(options.mode),'FIXTURE_CONFIGURATION');
  return openClaim(options.port,options.scope,options.workflowPurpose,'controlled_storage_fixture',options.mode==='fresh',options.shutdown,options.now??Date.now);
}
function nativePort(storage:ElectrostaticHostStorage):ControlledWorkflowClaimPort{
  return {
    capacityReleaseSlot:true,
    verifyFresh:()=>storage.assertReady(),list:role=>readdir(storage.paths[role]),
    read:name=>readElectrostaticHostJson(join(storage.paths['source-catalog'],name),16384),
    async writeOnce(role,name,data){
      return withProtectedCapacityPublication(join(storage.paths[role],name),data.byteLength,async()=>{
      await storage.assertReady();assertNativeOwnerPermit(storage.root,true);const file=await open(join(storage.paths[role],name),'wx',0o600);
      try{await file.writeFile(data);await file.sync();}finally{await file.close();}
      await storage.assertReady();
      });
    },
    async lock(){
      const path=join(storage.root,'.workflow-use.lock');
      return withNativeOwnerMutation(path,()=>withProtectedCapacityMutation(path,async()=>{
      try{await mkdir(path);}catch(error:any){if(error.code==='EEXIST')throw Error('NATIVE_WORKFLOW_CLAIM_BUSY');throw error;}
      const identity=await lstat(path);
      const assertOwned=async()=>{const stat=await lstat(path);requireClaim(stat.isDirectory()&&!stat.isSymbolicLink()
        &&stat.dev===identity.dev&&stat.ino===identity.ino,'LOCK_CHANGED');};
      return {assertOwned,async close(){await withNativeOwnerMutation(path,()=>withProtectedCapacityMutation(path,async()=>{await assertOwned();assertNativeOwnerPermit(path,true);await rmdir(path);}));}};
      }));
    },
  };
}
/** Native enrollment is possible ONLY with an unconsumed fresh creation handle,
 * never an existing/empty namespace or a caller-declared maintenance boolean. */
export async function initializeNativeWorkflowClaim(fresh:unknown,purpose:Purpose,shutdown:Shutdown){
  parse(purposeSchema,purpose);requireClaim(typeof shutdown?.confirmQuiescent==='function','SHUTDOWN_GUARD_REQUIRED');
  const owner=consumeFreshNativeWorkflowHandle(fresh);await owner.storage.assertReady();
  return openClaim(nativePort(owner.storage),{workflowId:owner.workflowId,storageIdentity:owner.storage.configurationDigest},purpose,'native_owner_protected_store',true,shutdown,Date.now);
}
/** Trusted owner-only exact reuse entry point. A legacy namespace has no policy
 * pin and is rejected. This is not a browser/MCP route or simulation approval. */
export async function claimReleasedNativeWorkflow(scope:Scope,purpose:Purpose,shutdown:Shutdown){
  parse(scopeSchema,scope);parse(purposeSchema,purpose);requireClaim(typeof shutdown?.confirmQuiescent==='function','SHUTDOWN_GUARD_REQUIRED');
  validateNativeWorkflowId(scope.workflowId);const owner=await openExistingNativeSimulationWorkflowStorage(scope.workflowId);
  requireClaim(owner.storage.configurationDigest===scope.storageIdentity,'BINDING_MISMATCH');
  return openClaim(nativePort(owner.storage),scope,purpose,'native_owner_protected_store',false,shutdown,Date.now);
}
/** Exact read-only inspection. Snapshot evidence is never claim authority. */
export async function inspectNativeWorkflowInactivity(scope:Scope,purpose:Purpose){
  parse(scopeSchema,scope);parse(purposeSchema,purpose);
  const owner=await openExistingNativeSimulationWorkflowStorage(scope.workflowId);
  requireClaim(owner.storage.configurationDigest===scope.storageIdentity,'BINDING_MISMATCH');
  const storage=owner.storage;
  return inspectInactivity({verifyFresh:()=>storage.assertReady(),list:role=>readdir(storage.paths[role]),
    read:name=>readElectrostaticHostJson(join(storage.paths['source-catalog'],name),16384),
    async lockPresent(){try{await lstat(join(storage.root,'.workflow-use.lock'));return true;}catch(error:any){if(error.code==='ENOENT')return false;throw error;}},
  },scope,purpose,'native_owner_protected_store');
}
/** Bounded legacy review. Missing policy means UNKNOWN, without opening old
 * records, guessing inactivity from timestamps or changing any storage. */
export async function reviewNativeLegacyWorkflowInactivity(purpose:Purpose){
  parse(purposeSchema,purpose);const parent=await openNativeSimulationStorage({provisionIfMissing:false});
  const directory=join(parent.location.root,'workflows');
  const container=await lstat(directory);requireClaim(container.isDirectory()&&!container.isSymbolicLink(),'WORKFLOW_DIRECTORY_INVALID');
  const {validateNativeWorkflowEntries}=await import('./nativeWorkflowStorageLifecycle.mts');
  const entries=await readdir(directory);validateNativeWorkflowEntries(entries,'open');
  const started=Date.now();let checked=0,unknown=0,verified=0,blocked=0;
  for(const workflowId of entries){
    if(Date.now()-started>=120000)break;
    const root=join(directory,workflowId),info=await lstat(root);
    if(!info.isDirectory()||info.isSymbolicLink()){blocked++;checked++;continue;}
    try{await lstat(join(root,'source-catalog',policyName));}catch(error:any){
      if(error.code==='ENOENT'){unknown++;checked++;continue;}throw error;
    }
    try{
      const owner=await openExistingNativeSimulationWorkflowStorage(workflowId);
      const result=await inspectNativeWorkflowInactivity({workflowId,storageIdentity:owner.storage.configurationDigest},purpose);
      if(result.status==='VERIFIED_RELEASE_SNAPSHOT')verified++;else unknown++;
    }catch{blocked++;}
    checked++;
  }
  await parent.storage.assertReady();
  return {schema:'tunacad-workflow-inactivity-review/1',total:entries.length,checked,unknownActivity:unknown,
    verifiedReleaseSnapshots:verified,blocked,complete:checked===entries.length,readOnly:true,reuseAuthorized:false,
    browserStarted:false,nativeStarted:false,engineeringUsePermitted:false};
}
