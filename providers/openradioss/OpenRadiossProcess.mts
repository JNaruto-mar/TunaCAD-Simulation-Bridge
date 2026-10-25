import { execFile } from 'node:child_process';
import {join,basename} from 'node:path';
import { spawnProviderProcess, hasEnforcedProviderProcessQuotas, monitorWorkingDirectory }
  from '../processLifecycle.mts';
import { createPrivateLauncherChannel,createLauncherEventValidator,type LauncherEvent } from './OpenRadiossLauncherTelemetry.mts';
import { requireOwnedTreeReadiness } from './OpenRadiossExecutionReadiness.mts';
export interface OpenRadiossProcessExit {exitCode:number|null; stdout:Buffer; stderr:Buffer; error:string|null; treeTerminated:boolean;
  launcherEvidence?:{events:LauncherEvent[];wrapperPid:number|null;childSolverPid:number|null;provenanceComplete:boolean;ownedTreeComplete:boolean;
    containmentGuarantee?:string;knownChildExitObserved?:boolean}}
export interface OpenRadiossProcessTask {
  /** Historical compatibility: pid is ALWAYS the wrapper, never the solver. */
  pid:number|null; completion:Promise<OpenRadiossProcessExit>; terminateTree():Promise<boolean>;
  wrapperPid?:number|null;
  diagnostics?():{stdout:string;stderr:string;error:string|null;terminationError:string|null;wrapperClosed:boolean;nativeState?:unknown};
}
/** Trusted internal process port; controlled tests inject a mock, never a
 * request option, public bypass, auto-approval flag or solver command string. */
export interface OpenRadiossProcessDriver {
  start(executable:string,args:string[],options:{cwd:string;environment:NodeJS.ProcessEnv;
    beforeCreate?:()=>void;
    telemetry?:{launchId:string;stage:'starter'|'engine';executableSha256:string;inputDigest:string;retain(event:LauncherEvent):Promise<void>}}):OpenRadiossProcessTask|Promise<OpenRadiossProcessTask>;
}
/** Bounded known-PID observation, NOT unknown-descendant enumeration or CIM. */
export async function observeKnownChildExit(pid:number,limitMs=2000){
  const until=Date.now()+limitMs;
  do{try{process.kill(pid,0);}catch(e:any){if(e.code==='ESRCH')return true;return false;}
    if(Date.now()>=until)return false;await new Promise(yes=>setTimeout(yes,20));}while(true);
}
export const nativeOpenRadiossProcessDriver:OpenRadiossProcessDriver={async start(executable,args,options){
  requireOwnedTreeReadiness();
  if(!hasEnforcedProviderProcessQuotas()) throw new Error('OpenRadioss: Windows x64 OS process quotas required');
  if(!options.telemetry)throw new Error('PRIVATE_LAUNCHER_TELEMETRY_REQUIRED');
  const channel=await createPrivateLauncherChannel(options.telemetry.stage,executable,options.telemetry.executableSha256,
    args,options.telemetry.inputDigest,options.telemetry.retain,options.telemetry.launchId);
  let child:ReturnType<typeof spawnProviderProcess>;
  try{options.beforeCreate?.();
    child=spawnProviderProcess(executable,args,{cwd:options.cwd,env:options.environment,windowsHide:true,stdio:['pipe','pipe','pipe']},
    {cpuTimeLimitMs:60000,memoryLimitBytes:1024*1024*1024},{bootstrap:channel.bootstrap()});
    if(!child.pid)throw new Error('Launcher wrapper creation failed');channel.setWrapperPid(child.pid);
  }catch(e){channel.close();throw e;}
  const stdout:Buffer[]=[],stderr:Buffer[]=[]; let captured=0,error:string|null=null,closed=false,pendingLine='';
  let termination:Promise<boolean>|undefined,terminationError:string|null=null;
  let nativeState:unknown=null;
  // One bounded, read-only observation of the already authenticated native PID.
  // Diagnostic only: never used as ownership, completion or cleanup evidence.
  const sample=setTimeout(()=>{
    const events=channel.snapshot(),pid=events.find(e=>e.event==='child_resumed')?.childSolverPid;
    if(closed||!pid||!Number.isSafeInteger(pid))return;
    const script=`$p=Get-Process -Id ${pid} -ErrorAction Stop; if($p.ProcessName -cne '${basename(executable,'.exe').replaceAll("'","''")}'){throw 'Process identity changed'}; $p | Select-Object Id,CPU,WorkingSet64,PrivateMemorySize64,@{N='Threads';E={@($_.Threads | Select-Object Id,ThreadState,@{N='Wait';E={if($_.ThreadState -eq 'Wait'){$_.WaitReason.ToString()}}})}} | ConvertTo-Json -Depth 4 -Compress`;
    execFile(join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:5000,maxBuffer:12000},(error,stdout)=>{try{nativeState=error?{code:'NATIVE_STATE_SAMPLE_UNAVAILABLE'}:JSON.parse(stdout);}catch{nativeState={code:'NATIVE_STATE_SAMPLE_INVALID'};}});
  },25000);sample.unref();
  const terminateTree=():Promise<boolean>=>{
    if(termination)return termination;
    const attempt=(async():Promise<boolean>=>{
    if(closed)return completion.then(result=>result.treeTerminated);
    if(!child.pid) return false;
    // Kill tree, not merely the wrapper PID. Job Object kill-on-close provides
    // an independent child containment boundary. Confirm wrapper close as well.
    const killed=await new Promise<boolean>(resolve=>execFile('taskkill.exe',['/PID',String(child.pid),'/T','/F'],
      {windowsHide:true,timeout:2000,maxBuffer:12000},e=>{if(e)terminationError=String(e.message).slice(0,2000);resolve(!e||closed);}));
    if(!killed) return false;
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{const result=await Promise.race<boolean>([completion.then(result=>result.treeTerminated),new Promise<boolean>(resolve=>{timer=setTimeout(()=>resolve(false),2000);})]);return result===true;}
    finally{if(timer)clearTimeout(timer);}
    })();
    termination=attempt;
    // Share concurrent cancellation, but a failed observation is not a terminal
    // fact. Finalization must freshly check the SAME owned task after a timeout.
    void attempt.then(ok=>{if(!ok&&termination===attempt)termination=undefined;},()=>{if(termination===attempt)termination=undefined;});
    return attempt;
  };
  const capture=(target:Buffer[]) => (chunk:Buffer)=>{
    captured+=chunk.length;
    if(captured>8*1024*1024){error??='process log resource limit';void terminateTree();return;}
    if(target===stdout) {
      pendingLine+=chunk.toString('utf8');const lines=pendingLine.split(/\r?\n/);pendingLine=lines.pop()!;
      if(lines.some(line=>Number(line.match(/^\s*NC=\s*(\d+)/)?.[1])>=20000)) {
        error??='actual increment resource bound';void terminateTree();
      }
    }
    target.push(Buffer.from(new Uint8Array(chunk)));
  };
  child.stdout?.on('data',capture(stdout)); child.stderr?.on('data',capture(stderr));
  child.stdin?.on('error',e=>{error??='Private launcher bootstrap: '+e.message;});
  const timeout=setTimeout(()=>{error??='process timeout';void terminateTree();},60000);
  const stop=monitorWorkingDirectory({child,directory:options.cwd,onExceeded:async()=>{error??='working directory resource limit';await terminateTree();}});
  const completion=new Promise<OpenRadiossProcessExit>(resolve=>{
    child.once('error',e=>{error??=e.message;});
    child.once('close',async code=>{closed=true;clearTimeout(timeout);clearTimeout(sample);stop();
      let launcherEvidence:OpenRadiossProcessExit['launcherEvidence'];
      try{launcherEvidence=await channel.finish();}catch(e){
        error??='Launcher provenance: '+String(e);
        const events=channel.snapshot();let assignedAndResumed=false;
        try{const validator=createLauncherEventValidator(channel.context,()=>child.pid??null);
          events.forEach(event=>validator.accept(event));assignedAndResumed=events.some(event=>event.event==='child_resumed');}catch{}
        const childSolverPid=events[1]?.childSolverPid??null;
        const knownChildExitObserved=assignedAndResumed&&childSolverPid!==null?await observeKnownChildExit(childSolverPid):false;
        launcherEvidence={events,wrapperPid:child.pid??null,childSolverPid,provenanceComplete:false,
          ownedTreeComplete:assignedAndResumed&&knownChildExitObserved,
          containmentGuarantee:assignedAndResumed?'exclusive_non_inherited_kill_on_last_close':'not_demonstrated',knownChildExitObserved};
      }
      finally{channel.close();}
      resolve({exitCode:code,stdout:Buffer.concat(stdout.map(b=>new Uint8Array(b))),
        stderr:Buffer.concat(stderr.map(b=>new Uint8Array(b))),error,launcherEvidence,
        treeTerminated:launcherEvidence?.ownedTreeComplete===true});});
  });
  return {pid:child.pid??null,wrapperPid:child.pid??null,completion,terminateTree,
    diagnostics:()=>({stdout:Buffer.concat(stdout.map(b=>new Uint8Array(b))).toString('utf8').slice(-12000),stderr:Buffer.concat(stderr.map(b=>new Uint8Array(b))).toString('utf8').slice(-12000),error,terminationError,wrapperClosed:closed,nativeState})};
}};
