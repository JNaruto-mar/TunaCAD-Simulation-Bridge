import {relative,resolve,isAbsolute} from 'node:path';
import {withProtectedStorageWrite} from './protectedStorageWriteBoundary.mts';
type Guard=<T>(path:string,bytes:number,action:()=>Promise<T>)=>Promise<T>;
const roots=new Map<string,Guard>();
const mutations=new Map<string,<T>(path:string,action:()=>Promise<T>)=>Promise<T>>();
/** Trusted native initialization only. No browser/config root override. */
export function registerProtectedCapacityPublication(root:string,guard:Guard,mutation?:<T>(path:string,action:()=>Promise<T>)=>Promise<T>){
  const key=resolve(root);if(!roots.has(key))roots.set(key,guard);
  if(mutation&&!mutations.has(key))mutations.set(key,mutation);
}
/** Narrow native claim-lock mutations use the SAME durable capacity lock. */
export async function withProtectedCapacityMutation<T>(path:string,action:()=>Promise<T>):Promise<T>{
  return withProtectedStorageWrite(path,async()=>{
  for(const [root] of roots){const suffix=relative(root,resolve(path));
    if(!suffix||(!suffix.startsWith('..')&&!isAbsolute(suffix))){
      const guard=mutations.get(root);if(!guard)throw Error('NATIVE_OWNER_MAINTENANCE_MUTATION_UNGUARDED');return guard(path,action);
    }}
  throw Error('NATIVE_OWNER_MAINTENANCE_MUTATION_UNGUARDED');
  });
}
export async function withProtectedCapacityPublication<T>(path:string,bytes:number,action:()=>Promise<T>):Promise<T>{
  if(!Number.isSafeInteger(bytes)||bytes<0)throw Error('NATIVE_WORKFLOW_CAPACITY_INVALID_WRITE');
  return withProtectedStorageWrite(path,async()=>{
  for(const [root,guard] of roots){const suffix=relative(root,resolve(path));
    if(!suffix||(!suffix.startsWith('..')&&!isAbsolute(suffix)))return guard(path,bytes,action);}
  // Independently configured Electrostatics/Optimization stores are not native
  // workflow allocations. They retain their original per-store ACL, immutable
  // record, file-count and size limits. Never fall through for a path inside a
  // mounted workflow root: its guard above must admit or reject the publication.
  // The surrounding normal-owner boundary still rejects unregistered paths.
  return action();
  });
}
