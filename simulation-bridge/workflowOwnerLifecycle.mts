import {AsyncLocalStorage} from 'node:async_hooks';

type Storage={flush():Promise<void>;release():Promise<void>};
const owners=new WeakSet<object>();
export type WorkflowOwnerLifecycle=ReturnType<typeof createWorkflowOwnerLifecycle>;
export function isWorkflowOwnerLifecycle(value:unknown):value is WorkflowOwnerLifecycle{
  return typeof value==='object'&&value!==null&&owners.has(value);
}
/** Trusted Node owner orchestration only. Not authentication or solver consent.
 * The actual owner must supply its stop/revoke/drain callback to close(). */
export function createWorkflowOwnerLifecycle(){
  let phase:'starting'|'running'|'closing'|'quiescent'|'released'|'failed'='starting';
  let starts=0,operations=0,writes=0,everStarted=false,reserved=false,storage:Storage|undefined,closing:Promise<void>|undefined;
  const context=new AsyncLocalStorage<{active:boolean}>();
  function requireOwner(ok:unknown,code:string):asserts ok{if(!ok)throw Error('WORKFLOW_OWNER_'+code);}
  const shutdown={async confirmQuiescent(signal:AbortSignal){
    requireOwner(!signal.aborted&&phase==='quiescent'&&starts===0&&operations===0&&writes===0,'SHUTDOWN_UNCONFIRMED');
  }};
  function close(stopAndDrain:()=>Promise<void>){
    if(closing)return closing;phase='closing';
    return closing=Promise.resolve().then(async()=>{
      try{
        await stopAndDrain();requireOwner(starts===0&&operations===0,'OPERATIONS_PENDING');
        await storage?.flush();requireOwner(writes===0,'WRITES_PENDING');phase='quiescent';
        await storage?.release();phase='released';
      }catch(error){phase='failed';throw error;}
    });
  }
  function reserveStorage(){
    requireOwner(phase==='starting'&&!reserved&&!storage&&starts===0&&operations===0&&writes===0,'STORAGE_BINDING_INVALID');
    reserved=true;let attached=false;
    return (value:Storage)=>{requireOwner(!attached&&phase==='starting'&&starts===0,'STORAGE_BINDING_INVALID');attached=true;storage=value;};
  }
  const owner={shutdown,
    summary:()=>({phase,pendingStarts:starts,pendingOperations:operations,pendingWrites:writes,everStarted,engineeringUsePermitted:false}),
    reserveStorage,
    stopAdmission(){requireOwner(phase==='running','MAINTENANCE_REJECTED');phase='closing';},
    attachStorage(value:Storage){reserveStorage()(value);},
    beginStartup(){requireOwner(phase==='starting'&&(!reserved||!!storage),'STARTUP_REJECTED');starts++;let done=false;
      return ()=>{requireOwner(!done,'STARTUP_REPLAY');done=true;starts--;};},
    started(){requireOwner(phase==='starting'&&starts===0&&(!reserved||!!storage),'STARTUP_REJECTED');everStarted=true;phase='running';},
    async operation<T>(action:()=>Promise<T>){
      requireOwner(phase==='running','ADMISSION_CLOSED');operations++;const permit={active:true};
      try{return await context.run(permit,action);}finally{permit.active=false;operations--;}
    },
    async evidence<T>(action:()=>Promise<T>){
      requireOwner(phase==='starting'||phase==='running'||phase==='closing'&&context.getStore()?.active===true,'EVIDENCE_ADMISSION_CLOSED');
      writes++;try{return await action();}finally{writes--;}
    },
    close,
    closeUnused(){
      if(closing)return closing;
      requireOwner(!everStarted&&starts===0&&operations===0,'OWNER_SHUTDOWN_REQUIRED');return close(async()=>{});
    },
  };
  owners.add(owner);return Object.freeze(owner);
}
