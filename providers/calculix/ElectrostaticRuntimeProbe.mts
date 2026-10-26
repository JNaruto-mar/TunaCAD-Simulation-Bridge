import {dirname} from 'node:path';
import {spawnProviderProcess,terminateChildProcess,hasEnforcedProviderProcessQuotas} from '../processLifecycle.mts';

export const ELECTROSTATIC_RUNTIME_PROBE_LIMITS=Object.freeze({wallMs:5000,cpuMs:5000,memoryBytes:512*1024*1024,diagnosticBytes:4096});
// Same 10-second bootstrap bound used by the existing general version probes.
// This is NOT additional native execution time: Windows enforces wallMs itself.
export const ELECTROSTATIC_PROBE_LAUNCHER_STARTUP_MS=10000;
export interface ElectrostaticRuntimeProbeEvidence {
  args:['-v'];exitCode:number|null;signal:string|null;elapsedMs:number;
  timedOut:boolean;outputExceeded:boolean;spawnError:string|null;cleanupConfirmed:boolean;
  diagnostic:string;executableDigest:string;currentExecutableDigest:string;
  phase?:'launcher_bootstrap'|'native_execution'|'output_drain'|'complete';launcherMs?:number;nativeMs?:number;
}
/** Metadata validation only. Cannot authorize a solver or mint a runtime identity. */
export function assertElectrostaticRuntimeProbe(e:ElectrostaticRuntimeProbeEvidence) {
  let code:string|null=null;
  if(!e.cleanupConfirmed)code='ELECTROSTATIC_RUNTIME_PROBE_CLEANUP_UNCONFIRMED';
  else if(e.timedOut)code=e.phase==='launcher_bootstrap'?'ELECTROSTATIC_RUNTIME_PROBE_LAUNCHER_TIMEOUT':e.phase==='output_drain'?'ELECTROSTATIC_RUNTIME_PROBE_DRAIN_TIMEOUT':'ELECTROSTATIC_RUNTIME_PROBE_TIMEOUT';
  else if(e.outputExceeded||Buffer.byteLength(e.diagnostic)>ELECTROSTATIC_RUNTIME_PROBE_LIMITS.diagnosticBytes)code='ELECTROSTATIC_RUNTIME_PROBE_OUTPUT_LIMIT';
  else if(e.spawnError||e.signal||![0,201].includes(e.exitCode as number))code='ELECTROSTATIC_RUNTIME_PROBE_FAILED';
  else if(e.executableDigest!==e.currentExecutableDigest)code='ELECTROSTATIC_EXECUTABLE_CHANGED';
  else if(!/This is Version 2\.16(?:\s|$)/.test(e.diagnostic))code='ELECTROSTATIC_RUNTIME_VERSION_INVALID';
  if(code)throw Object.assign(new Error(code),{code,details:structuredClone(e)});
}

/** Fixed -v only. Windows bounds the child to the original 5 s wall/CPU and
 * 512 MiB. Separately bound PowerShell compilation and output/cleanup overhead. */
export async function probeElectrostaticRuntime(executable:string,executableDigest:string,
  fingerprint:(path:string)=>Promise<string>):Promise<ElectrostaticRuntimeProbeEvidence> {
  const started=performance.now(),windows=hasEnforcedProviderProcessQuotas();
  const child=spawnProviderProcess(executable,['-v'],{
    cwd:dirname(executable),windowsHide:true,stdio:['ignore','pipe','pipe'],
    env:{...process.env,PATH:dirname(executable)+';'+(process.env.PATH??'')},
  },{cpuTimeLimitMs:ELECTROSTATIC_RUNTIME_PROBE_LIMITS.cpuMs,memoryLimitBytes:ELECTROSTATIC_RUNTIME_PROBE_LIMITS.memoryBytes,startSuspended:true,identityProbeWallMs:ELECTROSTATIC_RUNTIME_PROBE_LIMITS.wallMs});
  let diagnostic='',timedOut=false,outputExceeded=false,spawnError:string|null=null;
  let phase:NonNullable<ElectrostaticRuntimeProbeEvidence['phase']>=windows?'launcher_bootstrap':'native_execution',launcherMs:number|undefined,nativeMs:number|undefined,stderr='',finished=false;
  const watchdog=(ms:number)=>{const t=setTimeout(()=>setImmediate(()=>{if(finished||child.exitCode!==null||child.signalCode!==null)return;timedOut=true;void terminateChildProcess(child);}),ms);t.unref();return t;};
  let timer=watchdog(windows?ELECTROSTATIC_PROBE_LAUNCHER_STARTUP_MS:ELECTROSTATIC_RUNTIME_PROBE_LIMITS.wallMs);
  const collect=(chunk:unknown)=>{
    const bytes=Buffer.from(String(chunk));
    if(Buffer.byteLength(diagnostic)+bytes.length>ELECTROSTATIC_RUNTIME_PROBE_LIMITS.diagnosticBytes){
      outputExceeded=true;void terminateChildProcess(child);
    }
    const room=Math.max(0,ELECTROSTATIC_RUNTIME_PROBE_LIMITS.diagnosticBytes-Buffer.byteLength(diagnostic));
    diagnostic+=bytes.subarray(0,room).toString('utf8');
  };
  child.stdout?.on('data',collect);
  const stderrLine=(line:string)=>{
    if(windows&&line==='TUNACAD_IDENTITY_READY'&&phase==='launcher_bootstrap'){
      launcherMs=performance.now()-started;phase='native_execution';clearTimeout(timer);
      // Native five-second wall is enforced inside the helper, independent of
      // the Node event loop. Allow only existing two-second drain/cleanup bounds.
      timer=watchdog(ELECTROSTATIC_RUNTIME_PROBE_LIMITS.wallMs+4000);return;
    }
    const marker=windows?/^TUNACAD_IDENTITY_(EXIT|TIMEOUT) (\d{1,8})$/.exec(line):null;
    if(marker&&phase==='native_execution'){nativeMs=Number(marker[2]);if(marker[1]==='TIMEOUT')timedOut=true;else phase='output_drain';return;}
    collect(line+'\n');
  };
  child.stderr?.on('data',chunk=>{stderr+=String(chunk);let at;while((at=stderr.indexOf('\n'))!==-1){stderrLine(stderr.slice(0,at).replace(/\r$/,''));stderr=stderr.slice(at+1);}if(Buffer.byteLength(stderr)>ELECTROSTATIC_RUNTIME_PROBE_LIMITS.diagnosticBytes){collect(stderr);stderr='';}});
  let exitCode:number|null=null,cleanupConfirmed=false;
  try{
    exitCode=await new Promise<number|null>(resolve=>{
      child.once('error',error=>{spawnError=error.message;});child.once('close',code=>{finished=true;resolve(code);});
    });
  }finally{finished=true;clearTimeout(timer);if(stderr)stderrLine(stderr.replace(/\r$/,''));cleanupConfirmed=await terminateChildProcess(child);}
  if(windows&&!timedOut&&!spawnError&&nativeMs===undefined)spawnError='Metadata launcher completion evidence missing';
  if(!timedOut&&!spawnError&&[0,201].includes(exitCode as number))phase='complete';
  return {args:['-v'],exitCode,signal:child.signalCode,elapsedMs:performance.now()-started,
    timedOut,outputExceeded,spawnError,cleanupConfirmed,diagnostic,executableDigest,
    currentExecutableDigest:await fingerprint(executable),phase,...(launcherMs===undefined?{}:{launcherMs}),...(nativeMs===undefined?{}:{nativeMs})};
}
