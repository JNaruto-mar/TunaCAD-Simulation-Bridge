import {readFreshNativeWorkflowIdentity} from './nativeSimulationStorage.mts';
import {isWorkflowOwnerLifecycle,type WorkflowOwnerLifecycle} from './workflowOwnerLifecycle.mts';
import {validateNativeWorkflowId} from './nativeWorkflowStorageLifecycle.mts';

type Scope={workflowId:string;storageIdentity:string};
type Provenance='native_owner_protected_store'|'controlled_storage_fixture';
type StopOwner=(signal:AbortSignal)=>Promise<void>;
type State='registered'|'waiting'|'acknowledged'|'failed'|'finished';
type Barrier={summary():{state:State;provenance:Provenance;writerCoverage:'registered_owner_only';legacyReuseAuthorized:boolean;engineeringUsePermitted:boolean};
  request(stopOwner:StopOwner,signal?:AbortSignal):Promise<object>;finish(token:object):void};
const owners=new WeakMap<WorkflowOwnerLifecycle,Barrier>();
const acknowledgements=new WeakMap<object,{scope:Scope;provenance:Provenance;valid():boolean}>();
function requireBarrier(ok:unknown,code:string):asserts ok{if(!ok)throw Error('WORKFLOW_MAINTENANCE_'+code);}
function key(scope:Scope){
  validateNativeWorkflowId(scope?.workflowId);
  requireBarrier(/^sha256:[a-f0-9]{64}$/.test(scope?.storageIdentity),'IDENTITY_INVALID');
  return scope.workflowId+'|'+scope.storageIdentity;
}
/** Process-local fencing of registered owners only. NOT cross-process legacy
 * inactivity proof, a storage enrollment API or any simulation approval. */
function coordinator(provenance:Provenance,deadlineMs:number):{attach(input:Scope,owner:WorkflowOwnerLifecycle):Barrier}{
  const entries=new Map<string,{retired():boolean}>();
  return {attach(input:Scope,owner:WorkflowOwnerLifecycle){
    requireBarrier(isWorkflowOwnerLifecycle(owner)&&['starting','running'].includes(owner.summary().phase),'ORIGINAL_OWNER_REQUIRED');
    const scope=Object.freeze({...input}),identity=key(scope);
    // Normal original-owner shutdown needs no maintenance acknowledgement.
    // Retire only its process-local slot; never touch evidence or live proofs.
    for(const [id,entry] of entries)if(entry.retired())entries.delete(id);
    requireBarrier(!entries.has(identity)&&!owners.has(owner),'OWNER_ALREADY_BOUND');
    requireBarrier(entries.size<40,'CAPACITY');
    let state:State='registered';
    const entry={retired:()=>state==='registered'&&owner.summary().phase==='released'};entries.set(identity,entry);
    let acknowledgement:object|undefined,request:Promise<object>|undefined,requestSignal:AbortSignal|undefined;
    const valid=()=>state==='acknowledged'&&entries.get(identity)===entry&&!requestSignal?.aborted
      &&owner.summary().phase==='released'&&owner.summary().everStarted;
    const barrier=Object.freeze({
      summary:()=>({state,provenance,writerCoverage:'registered_owner_only' as const,
        legacyReuseAuthorized:false,engineeringUsePermitted:false}),
      request(stopOwner:StopOwner,signal?:AbortSignal):Promise<object>{
        requireBarrier(!request&&state==='registered','REQUEST_REPLAY');
        requireBarrier(typeof stopOwner==='function'&&!signal?.aborted,'REQUEST_CANCELLED');
        requireBarrier(owner.summary().phase==='running'&&owner.summary().everStarted,'ORIGINAL_OWNER_NOT_RUNNING');
        // Synchronous fence: no new root operation can slip in before shutdown.
        owner.stopAdmission();state='waiting';requestSignal=signal;
        const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
        let remove=()=>{};
        request=(async()=>{
          try{
            await Promise.race([
              Promise.resolve().then(()=>stopOwner(controller.signal)),
              new Promise<never>((_,reject)=>{
                const abort=()=>{controller.abort();reject(Error('WORKFLOW_MAINTENANCE_CANCELLED'));};
                remove=()=>signal?.removeEventListener('abort',abort);
                signal?.addEventListener('abort',abort,{once:true});
                if(signal?.aborted){abort();return;}
                timer=setTimeout(()=>{controller.abort();reject(Error('WORKFLOW_MAINTENANCE_TIMEOUT'));},deadlineMs);
              }),
            ]);
            const settled=owner.summary();
            requireBarrier(!signal?.aborted&&!controller.signal.aborted,'CANCELLED');
            requireBarrier(settled.phase==='released'&&settled.everStarted&&settled.pendingStarts===0
              &&settled.pendingOperations===0&&settled.pendingWrites===0,'SHUTDOWN_UNCONFIRMED');
            state='acknowledged';acknowledgement=Object.freeze({});
            acknowledgements.set(acknowledgement,{scope,provenance,valid});return acknowledgement;
          }catch(error){state='failed';controller.abort();throw error;}
          finally{clearTimeout(timer);remove();}
        })();return request;
      },
      finish(token:object){
        requireBarrier(token===acknowledgement&&valid(),'ACKNOWLEDGEMENT_INVALID');
        // Releases only this in-memory maintenance fence, never protected files.
        state='finished';acknowledgements.delete(token);entries.delete(identity);
      },
    });
    owners.set(owner,barrier);return barrier;
  }};
}
const native=coordinator('native_owner_protected_store',30000);
/** Requires the actual fresh allocation capability before it is consumed for
 * claim enrollment. No native/legacy scope or authentication can be injected. */
export function bindNativeWorkflowMaintenance(owner:WorkflowOwnerLifecycle,freshHandle:unknown){
  return native.attach(readFreshNativeWorkflowIdentity(freshHandle),owner);
}
export function readWorkflowMaintenance(owner:WorkflowOwnerLifecycle){return owners.get(owner);}
/** Separate fixture coordinator; cannot issue native-provenance acknowledgements. */
export function createControlledWorkflowMaintenance(options:{purpose:'controlled_workflow_maintenance_fixture';deadlineMs?:number}){
  requireBarrier(options?.purpose==='controlled_workflow_maintenance_fixture'
    &&Object.keys(options).every(k=>['purpose','deadlineMs'].includes(k)),'FIXTURE_INVALID');
  const deadlineMs=options.deadlineMs??30000;
  requireBarrier(Number.isInteger(deadlineMs)&&deadlineMs>=1&&deadlineMs<=30000,'FIXTURE_INVALID');
  return coordinator('controlled_storage_fixture',deadlineMs);
}
/** Opaque in-process receipt, not a serializable bearer credential. Exact
 * binding and current fence checked each time. Never authorizes legacy reuse. */
export function inspectWorkflowMaintenanceAcknowledgement(token:unknown,expected:Scope){
  key(expected);const proof=typeof token==='object'&&token!==null?acknowledgements.get(token):undefined;
  requireBarrier(proof&&key(proof.scope)===key(expected)&&proof.valid(),'ACKNOWLEDGEMENT_INVALID');
  return Object.freeze({status:'OWNER_QUIESCENCE_CONFIRMED' as const,provenance:proof.provenance,
    writerCoverage:'registered_owner_only' as const,legacyReuseAuthorized:false,engineeringUsePermitted:false});
}
