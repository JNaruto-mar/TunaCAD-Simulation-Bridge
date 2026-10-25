import {AsyncLocalStorage} from 'node:async_hooks';
import {generateKeyPairSync,sign,verify,createPublicKey,type KeyObject} from 'node:crypto';
import {lstat,mkdir,rmdir,opendir,statfs,realpath} from 'node:fs/promises';
import {join,relative,win32,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {ElectrostaticHostStorage,readElectrostaticHostJson,writeElectrostaticHostOnce,verifyNativeProtectedCapacityRecords} from './electrostaticHostStorage.mts';
import {digest,stableSerialize} from './stableDigest.mts';
import {validateNativeWorkflowEntries,validateNativeWorkflowId} from './nativeWorkflowStorageLifecycle.mts';
import {WORKFLOW_CAPACITY_POLICY as P,checkWorkflowCapacity,type CapacityReservation,type CapacitySnapshot} from './workflowCapacityPolicy.mts';
import {registerProtectedCapacityPublication} from './protectedCapacityPublication.mts';
import {withNativeOwnerMutation,registerNativeOwnerMaintenanceBoundary,assertNativeOwnerMaintenanceActive,assertNativeOwnerPermit} from './nativeOwnerMaintenanceGate.mts';
import {withProtectedStorageWrite} from './protectedStorageWriteBoundary.mts';
import {nativeStorageReadinessOperation} from './nativeStoragePreflightDiagnostic.mts';

const pinName='workflow-capacity.pin.json',releaseName='workflow-capacity.release.json';
type Purpose='fracture_evidence'|'private_explicit_owner';
type Shutdown={confirmQuiescent(signal:AbortSignal):Promise<void>};
type Pin={schema:'tunacad-workflow-capacity/1';workflowId:string;parentIdentity:string;storageIdentity:string;
  provenance:string;purpose:Purpose;protectedBytes:number;scratchBytes:number;scratchVolume:string;publicKey:string;signature:string};
type Context={id:string;purpose:Purpose;reservation:CapacityReservation;privateKey:KeyObject;
  publicKey:string;pin?:Pin;released:boolean;closing:boolean;busy:number};
type Transaction={pending:Map<string,CapacityReservation>;uncertain:boolean;metadata:boolean;active:boolean;publishing:boolean};
type CapacityHandle={release(guard:Shutdown):Promise<void>};
const managers=new Map<string,ReturnType<typeof createManager>>(),handles=new Map<string,CapacityHandle>();
const bytes=(value:unknown)=>new TextEncoder().encode(stableSerialize(value));
function requireBudget(ok:unknown,code:string):asserts ok{if(!ok)throw Error('NATIVE_WORKFLOW_CAPACITY_'+code);}
function signed<T extends object>(value:T,key:Context['privateKey']){return {...value,signature:sign(null,bytes(value),key).toString('base64')};}
function signature(value:any,publicKey:string){const {signature:proof,...unsigned}=value;
  try{const key=createPublicKey(publicKey);requireBudget(key.asymmetricKeyType==='ed25519'&&typeof proof==='string'&&proof.length===88
    &&verify(null,bytes(unsigned),key,new Uint8Array(Buffer.from(proof,'base64'))),'RECORD_INVALID');}
  catch{throw Error('NATIVE_WORKFLOW_CAPACITY_RECORD_INVALID');}}
async function volume(path:string){return win32.parse(await realpath(path)).root.toUpperCase();}
async function free(path:string){const s=await statfs(path,{bigint:true});return s.bavail*s.bsize;}
type Stat={isFile():boolean;isDirectory():boolean;isSymbolicLink():boolean;size:number;dev:number;ino:number;mtimeMs:number};
export type ControlledCapacityIO={stat(path:string):Promise<Stat>;mkdir(path:string):Promise<unknown>;rmdir(path:string):Promise<unknown>;
  entries(path:string):AsyncIterable<string>;volume(path:string):Promise<string>;free(path:string):Promise<bigint>;
  verifyRecords(paths:readonly string[]):Promise<void>;
  readJson(path:string,max:number):Promise<any>;writeJson(path:string,value:unknown,max:number):Promise<void>};
const nativeIO:ControlledCapacityIO={stat:path=>lstat(path),mkdir:path=>withProtectedStorageWrite(path,()=>mkdir(path)),
  rmdir:path=>withProtectedStorageWrite(path,()=>rmdir(path)),
  async *entries(path){const d=await opendir(path);for await(const e of d)yield e.name;},volume,free,
  verifyRecords:verifyNativeProtectedCapacityRecords,
  readJson:readElectrostaticHostJson,writeJson:writeElectrostaticHostOnce};
function createManager(parent:Pick<ElectrostaticHostStorage,'root'|'configurationDigest'|'assertReady'>,io:ControlledCapacityIO=nativeIO,provenance='native_owner_capacity'){
  const root=parent.root,lockPath=join(root,'.workflow-creation.lock'),local=new AsyncLocalStorage<Transaction>();
  const contexts=new Map<string,Context>();
  async function snapshot():Promise<CapacitySnapshot>{
    return nativeStorageReadinessOperation('workflow_capacity_verification',async()=>{
    requireBudget(!local.getStore()||local.getStore()!.active,'STALE_TRANSACTION');
    const started=Date.now(),workflowBytes=new Map<string,bigint>();let total=0n,files=0,dirs=0;
    const limit=()=>requireBudget(Date.now()-started<90000,'SCAN_TIMEOUT');
    async function walk(path:string,depth:number):Promise<bigint>{
      limit();requireBudget(depth<=12,'SCAN_DEPTH');const s=await io.stat(path);
      requireBudget(!s.isSymbolicLink(),'UNSAFE_ENTRY');
      if(s.isFile()){requireBudget(++files<=65536&&Number.isSafeInteger(s.size)&&s.size>=0,'SCAN_LIMIT');return BigInt(s.size);}
      requireBudget(s.isDirectory()&&++dirs<=8192,'SCAN_LIMIT');let n=0n;
      for await(const name of io.entries(path)){n+=await walk(join(path,name),depth+1);}
      const after=await io.stat(path);requireBudget(!after.isSymbolicLink()&&after.dev===s.dev&&after.ino===s.ino&&after.mtimeMs===s.mtimeMs,'CHANGED_DURING_SCAN');return n;
    }
    total=await walk(root,0);
    const directory=join(root,'workflows');let ids:string[]=[];
    try{for await(const name of io.entries(directory)){ids.push(name);requireBudget(ids.length<=P.maximumWorkflows,'COUNT');}}
    catch(error:any){if(error.code!=='ENOENT')throw error;}
    validateNativeWorkflowEntries(ids,'open');
    const reservations:CapacityReservation[]=[],protectedRecords:string[]=[],volumes=new Set<string>();const protectedVolume=await io.volume(root);volumes.add(protectedVolume);
    for(const id of ids){
      const path=join(directory,id);workflowBytes.set(id,await walk(path,0));let pin:any;
      try{pin=await io.readJson(join(path,'source-catalog',pinName),16384);}catch(error:any){
        if(error.code==='ENOENT'){requireBudget(!contexts.get(id)?.pin||local.getStore()?.pending.has(id),'RECORD_MISSING');continue;}throw error;}
      requireBudget(pin?.schema==='tunacad-workflow-capacity/1'&&pin.provenance===provenance&&pin.workflowId===id&&pin.parentIdentity===parent.configurationDigest
        &&['fracture_evidence','private_explicit_owner'].includes(pin.purpose)
        &&pin.protectedBytes===Number(pin.purpose==='fracture_evidence'?P.fractureReservationBytes:P.generalReservationBytes)
        &&pin.scratchBytes===Number(P.scratchReservationBytes)&&/^[A-Z]:\\$/.test(pin.scratchVolume)
        &&typeof pin.publicKey==='string'&&pin.publicKey.length<=256,'RECORD_INVALID');
      signature(pin,pin.publicKey);
      protectedRecords.push(path,join(path,'source-catalog'),join(path,'configuration.json'),join(path,'source-catalog',pinName));
      requireBudget(digest(await io.readJson(join(path,'configuration.json'),128*1024))===pin.storageIdentity,'IDENTITY_CHANGED');
      let released=false;
      try{const release=await io.readJson(join(path,'source-catalog',releaseName),16384);
        requireBudget(release.schema==='tunacad-workflow-capacity-release/1'&&release.reservationDigest===digest(pin),'RECORD_INVALID');
        signature(release,pin.publicKey);released=true;protectedRecords.push(join(path,'source-catalog',releaseName));
      }catch(error:any){if(error.code!=='ENOENT')throw error;}
      reservations.push({workflowId:id,protectedBytes:BigInt(pin.protectedBytes),scratchBytes:BigInt(pin.scratchBytes),scratchVolume:pin.scratchVolume,released});
      if(!released)volumes.add(pin.scratchVolume);
    }
    for(const pending of local.getStore()?.pending.values()??[]){
      const old=reservations.findIndex(r=>r.workflowId===pending.workflowId);if(old>=0)reservations.splice(old,1);
      reservations.push(pending);volumes.add(pending.scratchVolume);
    }
    await io.verifyRecords(protectedRecords);limit();
    const freeBytes=new Map<string,bigint>();for(const v of volumes)freeBytes.set(v,await io.free(v));limit();
    return {workflowCount:ids.length,protectedBytes:total,workflowBytes,protectedVolume,freeBytes,reservations};
    });
  }
  async function lockedTransaction<T>(action:()=>Promise<T>):Promise<T>{
    if(local.getStore()){requireBudget(local.getStore()!.active,'STALE_TRANSACTION');return action();}await parent.assertReady();
    assertNativeOwnerPermit(root);
    try{await io.mkdir(lockPath);}catch(error:any){if(error.code==='EEXIST')throw Error('NATIVE_SIMULATION_WORKFLOW_BUSY');throw error;}
    const identity=await io.stat(lockPath),tx:Transaction={pending:new Map(),uncertain:false,metadata:false,active:true,publishing:false};
    let first:unknown;
    try{return await local.run(tx,action);}catch(error){first=error;throw error;}
    finally{
      tx.active=false;
      if(!tx.uncertain){try{const s=await io.stat(lockPath);requireBudget(s.isDirectory()&&!s.isSymbolicLink()&&s.dev===identity.dev&&s.ino===identity.ino,'LOCK_CHANGED');assertNativeOwnerPermit(root);await io.rmdir(lockPath);}
      catch(cleanup){if(first)throw new AggregateError([first,cleanup],'NATIVE_WORKFLOW_CAPACITY_CLEANUP_FAILED',{cause:first});throw cleanup;}}
      // Unknown partial allocation keeps the operational lock. No stale takeover.
    }
  }
  async function transaction<T>(action:()=>Promise<T>):Promise<T>{return withNativeOwnerMutation(root,()=>lockedTransaction(action));}
  async function publication<T>(path:string,size:number,action:()=>Promise<T>):Promise<T>{
    requireBudget(Number.isSafeInteger(size)&&size>=0,'INVALID_WRITE');
    return transaction(async()=>{
      const tx=local.getStore()!;requireBudget(!tx.publishing,'CONCURRENT_PUBLICATION');tx.publishing=true;
      try{
      const suffix=relative(root,path);requireBudget(suffix&&!isAbsolute(suffix)&&!suffix.split(/[\\/]/).includes('..'),'OUTSIDE_ROOT');
      await parent.assertReady();const parts=suffix.split(/[\\/]/);let id:string|undefined;
      if(parts[0]==='workflows'){
        id=parts[1];validateNativeWorkflowId(id);const owner=contexts.get(id);
        requireBudget(owner&&!owner.released&&(!owner.closing||local.getStore()?.metadata&&parts.at(-1)===releaseName),'LEGACY_OR_FOREIGN_WRITE');
        requireBudget(![pinName,releaseName].includes(parts.at(-1)!)||local.getStore()?.metadata,'RESERVED_NAME');
      }
      let existing=0;try{const s=await io.stat(path);requireBudget(s.isFile()&&!s.isSymbolicLink(),'UNSAFE_ENTRY');existing=s.size;}catch(error:any){if(error.code!=='ENOENT')throw error;}
      const delta=existing?0n:BigInt(size);checkWorkflowCapacity(await snapshot(),undefined,{workflowId:id,bytes:delta});
      const owner=id?contexts.get(id):undefined;if(owner)owner.busy++;
      try{const result=await action();checkWorkflowCapacity(await snapshot());await parent.assertReady();return result;}
      finally{if(owner)owner.busy--;}
      }finally{tx.publishing=false;}
    });
  }
  function handle(context:Context,storage:Pick<ElectrostaticHostStorage,'root'|'paths'|'configurationDigest'|'assertReady'>){return Object.freeze({
    async release(guard:Shutdown){
      requireBudget(!context.released&&!context.closing&&context.busy===0&&typeof guard?.confirmQuiescent==='function','SHUTDOWN_UNCONFIRMED');
      context.closing=true; // Close admission synchronously, including failed/late release attempts.
      const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
      try{await Promise.race([guard.confirmQuiescent(abort.signal),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(Error('NATIVE_WORKFLOW_CAPACITY_SHUTDOWN_UNCONFIRMED'));},5000);})]);}
      finally{clearTimeout(timer);}
      requireBudget(!abort.signal.aborted,'SHUTDOWN_UNCONFIRMED');
      await transaction(async()=>{
        requireBudget(context.busy===0&&!context.released&&context.pin,'SHUTDOWN_UNCONFIRMED');await storage.assertReady();
        const tx=local.getStore()!;tx.metadata=true;
        try{await io.writeJson(join(storage.paths['source-catalog'],releaseName),
          signed({schema:'tunacad-workflow-capacity-release/1',reservationDigest:digest(context.pin)},context.privateKey),16384);
          await storage.assertReady();context.released=true;checkWorkflowCapacity(await snapshot());}
        finally{tx.metadata=false;}
      });
    },
  });}
  return {transaction,publication,
    async maintenanceBoundary<T>(action:()=>Promise<T>){assertNativeOwnerMaintenanceActive(root);return lockedTransaction(action);},
    async mutation<T>(path:string,action:()=>Promise<T>){return transaction(async()=>{
      const parts=relative(root,path).split(/[\\/]/);
      requireBudget(parts.length===3&&parts[0]==='workflows'&&parts[2]==='.workflow-use.lock','MUTATION_PATH_INVALID');
      validateNativeWorkflowId(parts[1]);const context=contexts.get(parts[1]);
      requireBudget(context&&!context.released&&!context.closing,'LEGACY_OR_FOREIGN_WRITE');
      const tx=local.getStore()!;requireBudget(!tx.publishing,'CONCURRENT_PUBLICATION');tx.publishing=true;context.busy++;
      try{checkWorkflowCapacity(await snapshot());assertNativeOwnerPermit(root,true);const result=await action();checkWorkflowCapacity(await snapshot());return result;}
      finally{context.busy--;tx.publishing=false;}
    });},
    async preflight(purpose:Purpose='fracture_evidence'){
      requireBudget(['fracture_evidence','private_explicit_owner'].includes(purpose),'PURPOSE_INVALID');
      await parent.assertReady();const s=await snapshot();requireBudget(s.workflowCount<P.maximumWorkflows,'COUNT');
      const v=await io.volume(tmpdir());if(!s.freeBytes.has(v))s.freeBytes.set(v,await io.free(v));
      const protectedBytes=purpose==='fracture_evidence'?P.fractureReservationBytes:P.generalReservationBytes;
      const checked=checkWorkflowCapacity(s,{workflowId:'preflight-only',protectedBytes,scratchBytes:P.scratchReservationBytes,scratchVolume:v,released:false});
      await parent.assertReady();
      return {workflowCount:s.workflowCount,maximumWorkflows:P.maximumWorkflows,purpose,
        protectedReservationBytes:protectedBytes.toString(),scratchReservationBytes:P.scratchReservationBytes.toString(),
        chargedProtectedBytes:checked.chargedProtectedBytes.toString(),protectedBudgetBytes:P.protectedBytes.toString(),
        minimumFreeBytes:P.minimumFreeBytes.toString(),readOnly:true as const,reserved:false as const};},
    async allocate<T extends {storage:Pick<ElectrostaticHostStorage,'root'|'paths'|'configurationDigest'|'assertReady'>}>(id:string,purpose:Purpose,create:()=>Promise<T>){
      requireBudget(local.getStore()?.active&&!local.getStore()?.publishing,'TRANSACTION_REQUIRED');
      requireBudget(['fracture_evidence','private_explicit_owner'].includes(purpose),'PURPOSE_INVALID');validateNativeWorkflowId(id);
      const scratchVolume=await io.volume(tmpdir()),r:CapacityReservation={workflowId:id,protectedBytes:purpose==='fracture_evidence'?P.fractureReservationBytes:P.generalReservationBytes,
        scratchBytes:P.scratchReservationBytes,scratchVolume,released:false};
      const s=await snapshot();if(!s.freeBytes.has(scratchVolume))s.freeBytes.set(scratchVolume,await io.free(scratchVolume));checkWorkflowCapacity(s,r);
      const keys=generateKeyPairSync('ed25519'),context:Context={id,purpose,reservation:r,privateKey:keys.privateKey,publicKey:keys.publicKey.export({type:'spki',format:'pem'}).toString(),released:false,closing:false,busy:0};
      contexts.set(id,context);const tx=local.getStore()!;tx.pending.set(id,r);tx.uncertain=true;
      const owner=await create();const storage=owner.storage;
      context.pin=signed({schema:'tunacad-workflow-capacity/1' as const,provenance,workflowId:id,parentIdentity:parent.configurationDigest,
        storageIdentity:storage.configurationDigest,purpose,protectedBytes:Number(r.protectedBytes),scratchBytes:Number(r.scratchBytes),scratchVolume,publicKey:context.publicKey},context.privateKey);
      tx.metadata=true;
      try{await io.writeJson(join(storage.paths['source-catalog'],pinName),context.pin,16384);await storage.assertReady();}
      finally{tx.metadata=false;}
      tx.pending.delete(id);tx.uncertain=false;const budget=handle(context,storage);if(provenance==='native_owner_capacity')handles.set(storage.root,budget);
      return Object.freeze({...owner,budget});
    },
  };
}
/** Only the canonical native storage constructor calls this with its genuine
 * existing protected parent. No browser paths, quota overrides or test flags. */
export function mountNativeWorkflowCapacity(parent:ElectrostaticHostStorage){
  let manager=managers.get(parent.root);if(!manager){manager=createManager(parent);managers.set(parent.root,manager);
    registerProtectedCapacityPublication(parent.root,manager.publication,manager.mutation);
    registerNativeOwnerMaintenanceBoundary(parent.root,manager.maintenanceBoundary);}
  return manager;
}
export function nativeWorkflowCapacityHandle(root:string){const h=handles.get(root);requireBudget(h,'ORIGINAL_OWNER_REQUIRED');return h;}
/** Same lock/admission/publication/release algorithms with memory-only IO.
 * Cannot register native handles, root guards or native-provenance records. */
export function createControlledNativeWorkflowCapacity(options:{purpose:'controlled_native_capacity_fixture';parent:Pick<ElectrostaticHostStorage,'root'|'configurationDigest'|'assertReady'>;io:ControlledCapacityIO}){
  requireBudget(options?.purpose==='controlled_native_capacity_fixture','FIXTURE_INVALID');
  return createManager(options.parent,options.io,'controlled_capacity_fixture');
}
