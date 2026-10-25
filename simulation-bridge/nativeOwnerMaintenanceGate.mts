import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {fileURLToPath} from 'node:url';
import {isAbsolute,relative,resolve} from 'node:path';
import {digest} from './stableDigest.mts';
import {registerProtectedStorageWriteRoot,isProtectedStorageWritePath,withProtectedStorageWrite} from './protectedStorageWriteBoundary.mts';
import {nativeStorageReadinessOperation} from './nativeStoragePreflightDiagnostic.mts';

type Mode='writer'|'maintenance';
type Lease={signal:AbortSignal;release():Promise<void>};
type Acquire=(scope:string,mode:Mode,signal?:AbortSignal)=>Promise<Lease>;
type Permit={scope:string;mode:Mode;provenance:string;active:boolean;signal:AbortSignal;children:Set<Promise<unknown>>};
const fail=(code:string):never=>{throw Error('NATIVE_OWNER_MAINTENANCE_'+code);};
const childContext=new AsyncLocalStorage<Permit>();
function createGate(acquire:Acquire,provenance:'native_kernel_mutex'|'controlled_fixture'){
  const local=new AsyncLocalStorage<Permit>();
  const blocked=new Set<string>();
  async function run<T>(scope:string,mode:Mode,action:(signal:AbortSignal)=>Promise<T>,signal?:AbortSignal):Promise<T>{
    if(!/^sha256:[a-f0-9]{64}$/.test(scope))fail('SCOPE_INVALID');
    if(blocked.has(scope))fail('CLEANUP_UNCONFIRMED');
    if(signal?.aborted)fail('CANCELLED');
    const nested=local.getStore();
    if(nested){if(!nested.active||nested.scope!==scope||nested.mode!=='writer'||mode!=='writer'||nested.signal.aborted)fail('ADMISSION_CLOSED');
      return action(nested.signal);}
    // Acquiring/closing the existing OS guard is admission, not a file write.
    // Both helpers retain their own unchanged deadlines. Never exempt action().
    let abandoned=false,offered:Lease|undefined;
    let lease:Lease;
    try{lease=await nativeStorageReadinessOperation('storage_writer_admission',async()=>{
      const value=await acquire(scope,mode,signal);
      if(abandoned){await value.release();fail('CANCELLED');}offered=value;return value;
    });}catch(error){abandoned=true;if(offered)await offered.release();throw error;}
    const abort=new AbortController();
    const cancel=()=>abort.abort();lease.signal.addEventListener('abort',cancel,{once:true});signal?.addEventListener('abort',cancel,{once:true});
    if(lease.signal.aborted||signal?.aborted)abort.abort();
    const permit:Permit={scope,mode,provenance,active:true,signal:abort.signal,children:new Set()};
    let result:T|undefined,first:unknown,failed=false;
    try{
      if(abort.signal.aborted){if(lease.signal.aborted)throw lease.signal.reason;fail('CANCELLED');}
      result=await local.run(permit,()=>childContext.run(permit,()=>action(abort.signal)));
    }catch(error){first=error;failed=true;}
    finally{
      permit.active=false; // Reject detached/stale callbacks before draining.
      const drained=await Promise.allSettled([...permit.children]);
      const childFailure=drained.find(r=>r.status==='rejected');
      if(!failed&&childFailure){first=childFailure.reason;failed=true;}
      if(abort.signal.aborted&&!failed){first=lease.signal.aborted?lease.signal.reason:Error('NATIVE_OWNER_MAINTENANCE_CANCELLED');failed=true;}
      let releasing:Promise<void>|undefined;
      const release=()=>releasing??=lease.release();
      let accountingFailure:unknown;
      try{await nativeStorageReadinessOperation('storage_writer_release',release);}
      catch(error){accountingFailure=error;}
      try{
        // A rejected/expired accounting scope must never prevent OS cleanup.
        await release();
        if(accountingFailure&&!failed){first=accountingFailure;failed=true;}
      }catch(cleanup){blocked.add(scope);
        first=failed?new AggregateError([first,cleanup],'NATIVE_OWNER_MAINTENANCE_CLEANUP_FAILED: '+String(first),{cause:first}):cleanup;failed=true;}
      lease.signal.removeEventListener('abort',cancel);signal?.removeEventListener('abort',cancel);
    }
    if(failed)throw first;return result as T;
  }
  return Object.freeze({
    writer:<T,>(scope:string,action:(signal:AbortSignal)=>Promise<T>,signal?:AbortSignal)=>run(scope,'writer',action,signal),
    maintenance:<T,>(scope:string,action:(summary:Readonly<{coverage:string;shutdownVerified:boolean;recoveryAuthorized:boolean;provenance:string}>,signal:AbortSignal)=>Promise<T>,signal?:AbortSignal)=>
      run(scope,'maintenance',s=>action(Object.freeze({coverage:'participating-critical-sections-only',shutdownVerified:false,recoveryAuthorized:false,provenance}),s),signal),
  });
}
/** Track the actual helper promise (execFile settles after process/output close),
 * not merely successful startup. No permit release while a tracked child waits. */
export function trackOwnerMaintenanceChild<T>(action:()=>Promise<T>):Promise<T>{
  const permit=childContext.getStore();if(!permit)return action();
  if(!permit.active||permit.mode!=='writer'||permit.signal.aborted)fail('ADMISSION_CLOSED');
  if(permit.children.size>=16)fail('CHILD_LIMIT');
  const promise=Promise.resolve().then(action);permit.children.add(promise);
  void promise.catch(()=>{}); // Drain also preserves rejection if caller ignores it.
  return promise;
}
const nativeBlocked=new Set<string>();
async function acquireNative(scope:string,_mode:Mode,signal?:AbortSignal):Promise<Lease>{
  if(process.platform!=='win32')fail('WINDOWS_REQUIRED');
  if(signal?.aborted)fail('CANCELLED');if(nativeBlocked.has(scope))fail('CLEANUP_UNCONFIRMED');
  const id=randomBytes(32).toString('hex'),lost=new AbortController();
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./windowsOwnerMaintenanceGate.ps1',import.meta.url))],
    {windowsHide:true,stdio:['pipe','pipe','pipe']});
  return new Promise((resolveLease,reject)=>{
    let buffer='',state:'starting'|'held'|'releasing'|'failed'|'closed'='starting',released=false,closed=false;
    let endResolve:(()=>void)|undefined,endReject:((e:Error)=>void)|undefined;
    let timer:ReturnType<typeof setTimeout>,cleanupTimer:ReturnType<typeof setTimeout>|undefined;
    const error=(code:string)=>Error('NATIVE_OWNER_MAINTENANCE_'+code);
    const stop=(code:string)=>{
      if(state==='closed'||state==='failed')return;
      const failure=error(code);
      const wasStarting=state==='starting';state='failed';clearTimeout(timer);lost.abort(failure);signal?.removeEventListener('abort',cancel);
      if(code!=='BUSY'&&!(wasStarting&&code==='CANCELLED'))nativeBlocked.add(scope);
      const finish=()=>{clearTimeout(cleanupTimer);
        const finalFailure=closed?failure:new Error('NATIVE_OWNER_MAINTENANCE_CLEANUP_UNCONFIRMED',{cause:failure});
        if(!closed)nativeBlocked.add(scope);
        if(wasStarting)reject(finalFailure);endReject?.(finalFailure);};
      if(closed){finish();return;}
      child.once('close',finish);cleanupTimer=setTimeout(finish,2000);
      try{child.kill();}catch{/* Failed cleanup remains blocked, not authorized. */}
    };
    const cancel=()=>stop('CANCELLED');
    timer=setTimeout(()=>stop('ACQUIRE_TIMEOUT'),10000);
    signal?.addEventListener('abort',cancel,{once:true});
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',(chunk:string)=>{
      buffer+=chunk;if(Buffer.byteLength(buffer)>4096){stop('RESPONSE_LIMIT');return;}
      let position:number;
      while((position=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,position).trim();buffer=buffer.slice(position+1);
        try{
          const row=JSON.parse(line);
          if(row.id!==id)throw error('CORRELATION');
          if(row.type==='rejected'){
            if(Object.keys(row).sort().join(',')!=='id,reason,type')throw error('PROTOCOL');
            const reason=['busy','abandoned','policy','protocol','owner_exit','helper_failed'].includes(row.reason)?row.reason:'helper_failed';
            stop(reason.toUpperCase());return;
          }
          if(row.type==='acquired'&&state==='starting'&&typeof row.fresh==='boolean'&&Object.keys(row).sort().join(',')==='fresh,id,type'){
            clearTimeout(timer);signal?.removeEventListener('abort',cancel);state='held';
            resolveLease({signal:lost.signal,release(){
              if(state!=='held')return Promise.reject(error('RELEASE_UNCONFIRMED'));
              state='releasing';
              return new Promise<void>((done,failed)=>{endResolve=done;endReject=failed;
                timer=setTimeout(()=>stop('RELEASE_TIMEOUT'),2000);
                child.stdin.end(JSON.stringify({type:'release',id})+'\n');});
            }});
          }else if(row.type==='released'&&state==='releasing'&&Object.keys(row).sort().join(',')==='id,type'&&!released){released=true;}
          else throw error('PROTOCOL');
        }catch{stop('PROTOCOL');return;}
      }
    });
    child.stderr.on('data',()=>stop('HELPER_STDERR'));
    child.stdin.on('error',()=>stop('PIPE_FAILED'));child.on('error',()=>stop('STARTUP_FAILED'));
    child.on('close',(code)=>{
      closed=true;if(state==='failed')return;
      if(state==='releasing'&&released&&code===0&&!buffer.trim()){
        clearTimeout(timer);state='closed';endResolve?.();
      }else stop('OWNER_OR_HELPER_EXIT');
    });
    if(signal?.aborted){cancel();return;}
    child.stdin.write(JSON.stringify({id,scope:scope.slice(7),ownerPid:process.pid})+'\n');
  });
}
const native=createGate(acquireNative,'native_kernel_mutex'),roots=new Set<string>();
type Boundary=<T>(action:()=>Promise<T>)=>Promise<T>;
const boundaries=new Map<string,Boundary>();
/** Trusted OS-derived root registration only. Merely registering starts no
 * process and writes no files; read-only inspections remain read-only. */
export function registerNativeOwnerMaintenanceRoot(root:string){
  registerProtectedStorageWriteRoot(root);
  if(!roots.has(resolve(root))&&roots.size>=128)fail('ROOT_LIMIT');roots.add(resolve(root));
}
/** Existing capacity-lock implementation supplies the durable exclusion. The
 * kernel mutex alone cannot retain crash evidence when its last handle closes. */
export function registerNativeOwnerMaintenanceBoundary(root:string,boundary:Boundary){
  if(!roots.has(resolve(root)))fail('UNREGISTERED_ROOT');if(!boundaries.has(resolve(root)))boundaries.set(resolve(root),boundary);
}
export function assertNativeOwnerMaintenanceActive(root:string){
  const p=childContext.getStore();
  if(!p?.active||p.mode!=='maintenance'||p.provenance!=='native_kernel_mutex'||p.scope!==digest(resolve(root).toLowerCase())||p.signal.aborted)fail('MAINTENANCE_CAPABILITY_REQUIRED');
}
/** Recheck immediately before mutations/cleanup after awaited IO. A lost helper
 * must leave the existing durable lock in place, not clear it optimistically. */
export function assertNativeOwnerPermit(path:string,writing=false){
  const scope=scopeFor(path);if(!scope)return;
  const p=childContext.getStore();if(!p?.active||p.provenance!=='native_kernel_mutex'||p.scope!==scope||p.signal.aborted||writing&&p.mode!=='writer')fail('ADMISSION_CLOSED');
}
function scopeFor(path:string){
  for(const root of roots){const suffix=relative(root,resolve(path));if(!suffix||(!suffix.startsWith('..')&&!isAbsolute(suffix)))return digest(root.toLowerCase());}
}
export function withNativeOwnerMutation<T>(path:string,action:()=>Promise<T>):Promise<T>{
  const scope=scopeFor(path);
  const run=()=>scope?native.writer(scope,action):action();
  return isProtectedStorageWritePath(path)?withProtectedStorageWrite(path,run):run(); // Memory-only ports unchanged.
}
/** No live CLI/recovery route: gate proof covers only participating operations,
 * never historical writer shutdown, storage repair or human approvals. */
export function withNativeOwnerMaintenance<T>(root:string,action:Parameters<typeof native.maintenance<T>>[1],signal?:AbortSignal){
  const boundary=boundaries.get(resolve(root));if(!roots.has(resolve(root))||!boundary)return fail('UNREGISTERED_ROOT');
  return native.maintenance(digest(resolve(root).toLowerCase()),(summary,s)=>boundary(()=>action(summary,s)),signal);
}
export function createControlledOwnerMaintenanceGate(options:{purpose:'controlled_owner_maintenance_fixture';acquire:Acquire}){
  if(options.purpose!=='controlled_owner_maintenance_fixture')fail('FIXTURE_INVALID');return createGate(options.acquire,'controlled_fixture');
}

async function verifyIsolated(acquire:Acquire,signal:AbortSignal|undefined,evidence:'windows-kernel-only'|'controlled_fixture'){
  // No root input or registration: cannot select the production/store gate.
  const scope=digest(['isolated-owner-maintenance-probe',randomBytes(32).toString('hex')]);
  let holder:Lease|undefined,contender:Lease|undefined,first:unknown,failed=false;
  try{
    holder=await acquire(scope,'maintenance',signal);
    if(signal?.aborted)fail('CANCELLED');
    let denied=false;
    try{contender=await acquire(scope,'writer',signal);}
    catch(error){if(error instanceof Error&&error.message==='NATIVE_OWNER_MAINTENANCE_BUSY')denied=true;else throw error;}
    if(!denied)fail('ISOLATED_EXCLUSION_FAILED');
    const release=holder;holder=undefined;await release.release();
    if(signal?.aborted)fail('CANCELLED');
    contender=await acquire(scope,'writer',signal);
    const next=contender;contender=undefined;await next.release();
  }catch(error){first=error;failed=true;}
  // Only our isolated helpers; no repeated release attempts or automatic retry.
  for(const lease of [contender,holder])if(lease)try{await lease.release();}catch(cleanup){
    first=failed?new AggregateError([first,cleanup],'NATIVE_OWNER_MAINTENANCE_PROBE_CLEANUP_FAILED',{cause:first}):cleanup;failed=true;
  }
  if(failed)throw first;
  return {status:'PASS',evidence,exclusion:'PASS',releaseAndReacquisition:'PASS',cleanup:'PASS',
    protectedStorageOperations:0,historicalShutdownVerified:false,recoveryAuthorized:false,engineeringUsePermitted:false};
}
/** Owner-invoked kernel probe only. Never touches a storage root, capacity lock,
 * workflow, approval or source. Uses the real helper with a fresh random scope. */
export function verifyIsolatedWindowsOwnerMaintenanceGate(signal?:AbortSignal){return verifyIsolated(acquireNative,signal,'windows-kernel-only');}
export function verifyControlledOwnerMaintenanceProbe(options:{purpose:'controlled_kernel_probe_fixture';acquire:Acquire;signal?:AbortSignal}){
  if(options.purpose!=='controlled_kernel_probe_fixture')fail('FIXTURE_INVALID');
  return verifyIsolated(options.acquire,options.signal,'controlled_fixture');
}
