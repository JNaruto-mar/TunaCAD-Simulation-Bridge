import { execFile } from 'node:child_process';
import { spawnProviderProcess, hasEnforcedProviderProcessQuotas, monitorWorkingDirectory }
  from '../processLifecycle.mts';
export interface OpenRadiossProcessExit {exitCode:number|null; stdout:Buffer; stderr:Buffer; error:string|null; treeTerminated:boolean}
export interface OpenRadiossProcessTask {
  pid:number|null; completion:Promise<OpenRadiossProcessExit>; terminateTree():Promise<boolean>;
}
/** Trusted internal process port; controlled tests inject a mock, never a
 * request option, public bypass, auto-approval flag or solver command string. */
export interface OpenRadiossProcessDriver {
  start(executable:string,args:string[],options:{cwd:string;environment:NodeJS.ProcessEnv}):OpenRadiossProcessTask;
}
export const nativeOpenRadiossProcessDriver:OpenRadiossProcessDriver={start(executable,args,options){
  if(!hasEnforcedProviderProcessQuotas()) throw new Error('OpenRadioss: Windows x64 OS process quotas required');
  const child=spawnProviderProcess(executable,args,{cwd:options.cwd,env:options.environment,windowsHide:true,stdio:['ignore','pipe','pipe']},
    {cpuTimeLimitMs:60000,memoryLimitBytes:1024*1024*1024});
  const stdout:Buffer[]=[],stderr:Buffer[]=[]; let captured=0,error:string|null=null,closed=false,pendingLine='';
  let termination:Promise<boolean>|undefined;
  const terminateTree=()=>termination??=(async()=>{
    if(closed) return true;
    if(!child.pid) return false;
    // Kill tree, not merely the wrapper PID. Job Object kill-on-close provides
    // an independent child containment boundary. Confirm wrapper close as well.
    const killed=await new Promise<boolean>(resolve=>execFile('taskkill.exe',['/PID',String(child.pid),'/T','/F'],
      {windowsHide:true,timeout:2000,maxBuffer:12000},e=>resolve(!e||closed)));
    if(!killed) return false;
    if(closed) return true;
    return new Promise<boolean>(resolve=>{const timer=setTimeout(()=>resolve(closed),2000);
      child.once('close',()=>{clearTimeout(timer);resolve(true);});});
  })();
  const capture=(target:Buffer[]) => (chunk:Buffer)=>{
    captured+=chunk.length;
    if(captured>8*1024*1024){error='process log resource limit';void terminateTree();return;}
    if(target===stdout) {
      pendingLine+=chunk.toString('utf8');const lines=pendingLine.split(/\r?\n/);pendingLine=lines.pop()!;
      if(lines.some(line=>Number(line.match(/^\s*NC=\s*(\d+)/)?.[1])>=20000)) {
        error='actual increment resource bound';void terminateTree();
      }
    }
    target.push(Buffer.from(new Uint8Array(chunk)));
  };
  child.stdout?.on('data',capture(stdout)); child.stderr?.on('data',capture(stderr));
  const timeout=setTimeout(()=>{error='process timeout';void terminateTree();},60000);
  const stop=monitorWorkingDirectory({child,directory:options.cwd,onExceeded:async()=>{error='working directory resource limit';await terminateTree();}});
  const completion=new Promise<OpenRadiossProcessExit>(resolve=>{
    child.once('error',e=>{error=e.message;});
    child.once('close',code=>{closed=true;clearTimeout(timeout);stop();resolve({exitCode:code,
      stdout:Buffer.concat(stdout.map(b=>new Uint8Array(b))),stderr:Buffer.concat(stderr.map(b=>new Uint8Array(b))),error,treeTerminated:true});});
  });
  return {pid:child.pid??null,completion,terminateTree};
}};
