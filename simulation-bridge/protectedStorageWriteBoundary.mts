import {isAbsolute,relative,resolve} from 'node:path';

const roots=new Set<string>();
const fail=(code:string):never=>{throw Error('PROTECTED_STORAGE_BOUNDARY_'+code);};
/** Trusted host registration for normal owner-policy IO. Registration grants no
 * filesystem rights, authentication, approval, recovery or legacy exclusion. */
export function registerProtectedStorageWriteRoot(path:string){
  if(!isAbsolute(path))fail('ROOT_INVALID');
  const root=resolve(path);if(!roots.has(root)&&roots.size>=1024)fail('ROOT_LIMIT');roots.add(root);
}
export function isProtectedStorageWritePath(path:string){
  const absolute=resolve(path);
  return [...roots].some(root=>{const r=relative(root,absolute);return !r||!r.startsWith('..')&&!isAbsolute(r);});
}
/** Normal owner-policy dispatch, not the paused broker/recovery boundary.
 * The authenticated callers retain fresh ACL/pin/source checks, immutable writes,
 * native allocation locks and capacity guards. Windows still enforces the
 * existing owner DACL; this helper grants no new OS rights. The unfinished
 * broker must not unconditionally disable the previously supported write path.
 * In particular, successful normal IO NEVER proves exclusion of legacy writers
 * or authorizes removal of a crash-left lock. */
export async function withProtectedStorageWrite<T>(path:string,action:()=>Promise<T>):Promise<T>{
  if(!isAbsolute(path)||!isProtectedStorageWritePath(path))fail('UNREGISTERED_ROOT');
  return action();
}
export function protectedStorageBoundaryStatus(){
  return Object.freeze({nativeWrites:'OWNER_POLICY_REQUIRED',osEnforcement:'LEGACY_WRITER_EXCLUSION_NOT_ESTABLISHED',
    nativeRecovery:'DISABLED',engineeringUsePermitted:false});
}
