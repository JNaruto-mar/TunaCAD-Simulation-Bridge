import {randomUUID} from 'node:crypto';
import {WORKFLOW_CAPACITY_POLICY} from './workflowCapacityPolicy.mts';

const workflowPattern=/^workflow-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
/** Retained namespace quota, NOT a simultaneous-job limit. Not configurable. */
export const MAXIMUM_NATIVE_WORKFLOWS=WORKFLOW_CAPACITY_POLICY.maximumWorkflows;
export function workflowCapacityError(count:number){
  return Object.assign(Error('NATIVE_SIMULATION_STORAGE_INVALID: persistent workflow-count bound'),{
    workflowCapacity:{maximumWorkflows:MAXIMUM_NATIVE_WORKFLOWS,retainedWorkflows:count,
      capacityBasis:'retained_namespace_count',recovery:'explicit_review_required'},
  });
}
export function validateNativeWorkflowId(value:string){
  if(typeof value!=='string'||!workflowPattern.test(value))throw Error('NATIVE_SIMULATION_WORKFLOW_ID_INVALID');
}
export function validateNativeWorkflowEntries(entries:string[],phase:'create'|'open'='create'){
  if(!['create','open'].includes(phase)||!Array.isArray(entries)
    ||entries.length>(phase==='create'?MAXIMUM_NATIVE_WORKFLOWS-1:MAXIMUM_NATIVE_WORKFLOWS))throw workflowCapacityError(Array.isArray(entries)?entries.length:0);
  if(entries.some(name=>typeof name!=='string'||!workflowPattern.test(name))||new Set(entries).size!==entries.length)
    throw Error('NATIVE_SIMULATION_STORAGE_INVALID: unexpected workflow entry');
}
/** Sanitized diagnostic only, never owner admission or permission to create. */
export function summarizeNativeWorkflowInventory(entries:string[],unsafeEntries=0){
  const unexpectedEntries=entries.filter(value=>typeof value!=='string'||!workflowPattern.test(value)).length;
  const reason=entries.length>=MAXIMUM_NATIVE_WORKFLOWS?'workflow-capacity-full':unexpectedEntries?'unexpected-workflow-entry':unsafeEntries?'unsafe-workflow-directory':'none';
  return {schema:'tunacad-native-workflow-inventory/1',status:reason==='none'?'READY':'BLOCKED',reason,
    workflowCount:entries.length,maximumWorkflows:MAXIMUM_NATIVE_WORKFLOWS,unexpectedEntries,unsafeEntries,readOnly:true,browserStarted:false,nativeStarted:false};
}
/** Internal control flow, shared by the native adapter and explicitly simulated
 * tests. The backend carries no owner-authentication or approval authority. */
export type NativeWorkflowBackend<T>={
  verifyParent():Promise<void>;
  acquire():Promise<()=>Promise<void>>;
  ensureContainer():Promise<void>;
  list():Promise<string[]>;
  verifyEntry(id:string):Promise<void>;
  create(id:string):Promise<T>;
};
export async function createNativeWorkflowStorage<T>(backend:NativeWorkflowBackend<T>):Promise<T>{
  await backend.verifyParent();
  const release=await backend.acquire();let failed=false,first:unknown;
  try{
    await backend.verifyParent();await backend.ensureContainer();
    const entries=await backend.list();validateNativeWorkflowEntries(entries);
    for(const id of entries)await backend.verifyEntry(id);
    const id='workflow-'+randomUUID();
    // Exactly one attempt. A partial/failed creation is never removed or retried.
    const created=await backend.create(id);
    await backend.verifyParent();
    const after=await backend.list();validateNativeWorkflowEntries(after,'open');
    if(after.length!==entries.length+1||!after.includes(id)||entries.some(previous=>!after.includes(previous)))
      throw Error('NATIVE_SIMULATION_WORKFLOW_INVENTORY_CHANGED');
    await backend.verifyEntry(id);return created;
  }catch(error){failed=true;first=error;throw error;}
  finally{try{await release();}catch(cleanup){
    if(failed)throw new AggregateError([first,cleanup],'NATIVE_SIMULATION_WORKFLOW_CLEANUP_FAILED',{cause:first});
    throw new AggregateError([cleanup],'NATIVE_SIMULATION_WORKFLOW_CLEANUP_FAILED');
  }}
}
