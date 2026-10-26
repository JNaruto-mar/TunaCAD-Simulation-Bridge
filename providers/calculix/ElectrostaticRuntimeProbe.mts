import {dirname} from 'node:path';
import {spawnProviderProcess,terminateChildProcess} from '../processLifecycle.mts';

export const ELECTROSTATIC_RUNTIME_PROBE_LIMITS=Object.freeze({wallMs:5000,cpuMs:5000,memoryBytes:512*1024*1024,diagnosticBytes:4096});
export interface ElectrostaticRuntimeProbeEvidence {
  args:['-v'];exitCode:number|null;signal:string|null;elapsedMs:number;
  timedOut:boolean;outputExceeded:boolean;spawnError:string|null;cleanupConfirmed:boolean;
  diagnostic:string;executableDigest:string;currentExecutableDigest:string;
}
/** Metadata validation only. Cannot authorize a solver or mint a runtime identity. */
export function assertElectrostaticRuntimeProbe(e:ElectrostaticRuntimeProbeEvidence) {
  let code:string|null=null;
  if(!e.cleanupConfirmed)code='ELECTROSTATIC_RUNTIME_PROBE_CLEANUP_UNCONFIRMED';
  else if(e.timedOut)code='ELECTROSTATIC_RUNTIME_PROBE_TIMEOUT';
  else if(e.outputExceeded||Buffer.byteLength(e.diagnostic)>ELECTROSTATIC_RUNTIME_PROBE_LIMITS.diagnosticBytes)code='ELECTROSTATIC_RUNTIME_PROBE_OUTPUT_LIMIT';
  else if(e.spawnError||e.signal||![0,201].includes(e.exitCode as number))code='ELECTROSTATIC_RUNTIME_PROBE_FAILED';
  else if(e.executableDigest!==e.currentExecutableDigest)code='ELECTROSTATIC_EXECUTABLE_CHANGED';
  else if(!/This is Version 2\.16(?:\s|$)/.test(e.diagnostic))code='ELECTROSTATIC_RUNTIME_VERSION_INVALID';
  if(code)throw Object.assign(new Error(code),{code,details:structuredClone(e)});
}

/** Fixed -v only. No deck/arguments/provider bypass accepted. The 5 s wall/CPU,
 * 512 MiB and output bounds are the original protected identity limits. */
export async function probeElectrostaticRuntime(executable:string,executableDigest:string,
  fingerprint:(path:string)=>Promise<string>):Promise<ElectrostaticRuntimeProbeEvidence> {
  const started=performance.now();
  const child=spawnProviderProcess(executable,['-v'],{
    cwd:dirname(executable),windowsHide:true,stdio:['ignore','pipe','pipe'],
    env:{...process.env,PATH:dirname(executable)+';'+(process.env.PATH??'')},
  },{cpuTimeLimitMs:ELECTROSTATIC_RUNTIME_PROBE_LIMITS.cpuMs,memoryLimitBytes:ELECTROSTATIC_RUNTIME_PROBE_LIMITS.memoryBytes,startSuspended:true});
  let diagnostic='',timedOut=false,outputExceeded=false,spawnError:string|null=null;
  const collect=(chunk:unknown)=>{
    const bytes=Buffer.from(String(chunk));
    if(Buffer.byteLength(diagnostic)+bytes.length>ELECTROSTATIC_RUNTIME_PROBE_LIMITS.diagnosticBytes){
      outputExceeded=true;void terminateChildProcess(child);
    }
    const room=Math.max(0,ELECTROSTATIC_RUNTIME_PROBE_LIMITS.diagnosticBytes-Buffer.byteLength(diagnostic));
    diagnostic+=bytes.subarray(0,room).toString('utf8');
  };
  child.stdout?.on('data',collect);child.stderr?.on('data',collect);
  const timer=setTimeout(()=>{timedOut=true;void terminateChildProcess(child);},ELECTROSTATIC_RUNTIME_PROBE_LIMITS.wallMs);timer.unref();
  let exitCode:number|null=null,cleanupConfirmed=false;
  try{
    exitCode=await new Promise<number|null>(resolve=>{
      child.once('error',error=>{spawnError=error.message;});child.once('close',resolve);
    });
  }finally{clearTimeout(timer);cleanupConfirmed=await terminateChildProcess(child);}
  return {args:['-v'],exitCode,signal:child.signalCode,elapsedMs:performance.now()-started,
    timedOut,outputExceeded,spawnError,cleanupConfirmed,diagnostic,executableDigest,
    currentExecutableDigest:await fingerprint(executable)};
}
