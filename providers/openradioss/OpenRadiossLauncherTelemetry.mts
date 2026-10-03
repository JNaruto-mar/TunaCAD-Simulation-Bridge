import { createHmac,randomBytes,randomUUID,timingSafeEqual } from 'node:crypto';
import { createServer,type Socket } from 'node:net';
import { digest } from '../../simulation-bridge/stableDigest.mts';

export const LAUNCHER_EVENTS=['launcher_started','child_created_suspended','job_assigned','child_resumed','child_exited','job_empty','launcher_finalized'] as const;
export type LauncherContext={launchId:string;stage:'starter'|'engine';executable:string;executableSha256:string;inputDigest:string;argumentDigest:string};
export type LauncherEvent=LauncherContext & {schema:'tunacad-launcher-event/2';sequence:number;event:typeof LAUNCHER_EVENTS[number];
  wrapperPid:number;childSolverPid:number|null;at:string;childStartAt:string|null;childResumedAt:string|null;childExitAt:string|null;
  childExitCode:number|null;jobAssigned:boolean|null;jobActiveProcesses:number|null;jobTotalProcesses:number|null;
  jobHandleClosed:boolean;jobOwnerPid:number;jobHandleInheritable:false;jobKillOnClose:true;jobBreakawayAllowed:false;failure:string|null};
const keys=['launchId','stage','executable','executableSha256','inputDigest','argumentDigest','schema','sequence','event',
  'wrapperPid','childSolverPid','at','childStartAt','childResumedAt','childExitAt','childExitCode','jobAssigned','jobActiveProcesses','jobTotalProcesses',
  'jobHandleClosed','jobOwnerPid','jobHandleInheritable','jobKillOnClose','jobBreakawayAllowed','failure'].sort();
const timestamp=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v));
export function createLauncherEventValidator(expected:LauncherContext,wrapperPid:()=>number|null){
  const events:LauncherEvent[]=[];let failed=false;
  return {accept(value:unknown){try{
    const v=value as LauncherEvent;
    if(!v||Object.keys(v).sort().join(',')!==keys.join(',')||v.schema!=='tunacad-launcher-event/2'||
      v.sequence!==events.length+1||v.event!==LAUNCHER_EVENTS[events.length])throw new Error('LAUNCHER_EVENT_SCHEMA_OR_ORDER');
    for(const key of Object.keys(expected) as Array<keyof LauncherContext>)if(v[key]!==expected[key])throw new Error('LAUNCHER_EVENT_BINDING');
    if(v.wrapperPid!==wrapperPid()||!Number.isSafeInteger(v.wrapperPid)||v.wrapperPid<=0||!timestamp(v.at)||
      events.length&&Date.parse(v.at)<Date.parse(events.at(-1)!.at))throw new Error('LAUNCHER_EVENT_WRAPPER_OR_TIME');
    if(v.childSolverPid!==null&&(!Number.isSafeInteger(v.childSolverPid)||v.childSolverPid<=0||v.childSolverPid===v.wrapperPid))throw new Error('LAUNCHER_CHILD_ID');
    if(v.jobOwnerPid!==v.wrapperPid||v.jobHandleInheritable!==false||v.jobKillOnClose!==true||v.jobBreakawayAllowed!==false)
      throw new Error('LAUNCHER_JOB_OWNERSHIP_POLICY');
    if(v.childStartAt!==null&&!timestamp(v.childStartAt)||v.childResumedAt!==null&&!timestamp(v.childResumedAt)||v.childExitAt!==null&&!timestamp(v.childExitAt)||
      v.childExitCode!==null&&!Number.isSafeInteger(v.childExitCode)||v.jobAssigned!==null&&typeof v.jobAssigned!=='boolean'||
      typeof v.jobHandleClosed!=='boolean'||v.failure!==null&&typeof v.failure!=='string')throw new Error('LAUNCHER_EVENT_VALUES');
    for(const n of [v.jobActiveProcesses,v.jobTotalProcesses])if(n!==null&&(!Number.isSafeInteger(n)||n<0||n>32))throw new Error('LAUNCHER_JOB_BOUND');
    if(v.event==='launcher_started'&&(v.childSolverPid!==null||v.childStartAt!==null||v.jobAssigned!==null||v.childExitAt!==null||v.childExitCode!==null))throw new Error('LAUNCHER_PRECREATION');
    if(v.failure!==null||v.jobHandleClosed!==(v.event==='launcher_finalized')||
      v.childStartAt!==null&&Date.parse(v.childStartAt)>Date.parse(v.at)||
      v.childExitAt!==null&&Date.parse(v.childExitAt)>Date.parse(v.at))throw new Error('LAUNCHER_CONTRADICTORY_STATE');
    if(v.jobTotalProcesses!==null&&(v.jobAssigned===true&&v.jobTotalProcesses<1||
      v.jobActiveProcesses!==null&&v.jobActiveProcesses>v.jobTotalProcesses))throw new Error('LAUNCHER_CONTRADICTORY_ACCOUNTING');
    if(['launcher_started','child_created_suspended'].includes(v.event)&&(v.jobAssigned!==null||v.jobActiveProcesses!==null||
      v.jobTotalProcesses!==null||v.childExitAt!==null||v.childExitCode!==null))throw new Error('LAUNCHER_PREASSIGNMENT_STATE');
    if(v.sequence>=3&&
      (v.jobActiveProcesses===null||v.jobTotalProcesses===null))throw new Error('LAUNCHER_MISSING_ACCOUNTING');
    if(v.event!=='launcher_started'&&(v.childSolverPid===null||v.childStartAt===null))throw new Error('LAUNCHER_MISSING_CREATION');
    if(events.length>1&&(v.childSolverPid!==events[1].childSolverPid||v.childStartAt!==events[1].childStartAt))throw new Error('LAUNCHER_CHILD_CHANGED');
    if(v.sequence>=3&&v.jobAssigned!==true)throw new Error('LAUNCHER_JOB_ASSIGNMENT');
    if(v.sequence<4&&v.childResumedAt!==null||v.sequence>=4&&(v.childResumedAt===null||
      Date.parse(v.childResumedAt)<Date.parse(v.childStartAt!)||Date.parse(v.childResumedAt)>Date.parse(v.at)))throw new Error('LAUNCHER_RESUME_STATE');
    if(v.sequence>4&&v.childResumedAt!==events[3].childResumedAt)throw new Error('LAUNCHER_RESUME_CHANGED');
    if(v.sequence<5&&(v.childExitCode!==null||v.childExitAt!==null))throw new Error('LAUNCHER_PREEXIT_STATE');
    if(v.sequence>=5&&(v.childExitCode===null||v.childExitAt===null||Date.parse(v.childExitAt)<Date.parse(v.childResumedAt!)))throw new Error('LAUNCHER_MISSING_EXIT');
    if(v.event==='launcher_finalized'&&!v.jobHandleClosed)throw new Error('LAUNCHER_MISSING_FINALIZATION');
    if(v.sequence>=6&&(v.childExitCode!==events[4]?.childExitCode||v.childExitAt!==events[4]?.childExitAt))throw new Error('LAUNCHER_EXIT_CHANGED');
    if(v.sequence>=6&&v.jobActiveProcesses!==0)throw new Error('LAUNCHER_JOB_NOT_EMPTY');
    if(failed)throw new Error('LAUNCHER_STICKY_FAILURE');events.push(structuredClone(v));return structuredClone(v);
  }catch(e){failed=true;throw e;}},snapshot:()=>structuredClone(events),
    complete:()=>!failed&&events.length===7,childSolverPid:()=>events[1]?.childSolverPid??null};
}
export function authenticateLauncherEnvelope(line:string,key:Buffer){
  if(Buffer.byteLength(line)>16384)throw new Error('LAUNCHER_MESSAGE_BOUND');
  const value=JSON.parse(line);
  if(Object.keys(value).sort().join(',')!=='mac,payload'||typeof value.payload!=='string'||!/^[a-f0-9]{64}$/.test(value.mac))throw new Error('LAUNCHER_ENVELOPE');
  const actual=Buffer.from(value.mac,'hex'),expected=createHmac('sha256',new Uint8Array(key)).update(value.payload,'utf8').digest();
  if(!timingSafeEqual(new Uint8Array(actual),new Uint8Array(expected)))throw new Error('LAUNCHER_AUTHENTICATION');return JSON.parse(value.payload);
}
/** Constructor-owned channel. Capability travels ONLY over wrapper stdin, never
 * argv/env/solver output. Node's public net API has no Windows client-PID query;
 * record that limitation, do not pretend signed PID is an OS peer query. The
 * wrapper checks the native pipe server PID. Full tree readiness remains blocked. */
export async function createPrivateLauncherChannel(stage:'starter'|'engine',executable:string,executableSha256:string,
  args:string[],inputDigest:string,retain:(event:LauncherEvent)=>Promise<void>,launchId:string=randomUUID()){
  if(process.platform!=='win32')throw new Error('WINDOWS_PRIVATE_TELEMETRY_REQUIRED');
  const key=randomBytes(32),name='tunacad-launcher-'+randomBytes(24).toString('hex');
  const path='\\\\.\\pipe\\'+name;
  const context:LauncherContext={launchId,stage,executable,executableSha256,inputDigest,argumentDigest:digest(args)};
  let wrapperPid:number|null=null,socket:Socket|null=null,pending='',total=0,problem:Error|null=null,chain=Promise.resolve();
  let drained=false,resolveDrained:()=>void=()=>{};
  const drain=new Promise<void>(yes=>{resolveDrained=yes;});
  const validator=createLauncherEventValidator(context,()=>wrapperPid);
  const server=createServer(client=>{
    if(socket){client.destroy();problem=new Error('LAUNCHER_DUPLICATE_CONNECTION');return;}socket=client;
    client.on('error',e=>{problem=e;});
    client.on('end',()=>{drained=true;resolveDrained();});
    client.on('close',()=>{resolveDrained();});
    client.on('data',b=>{total+=b.length;pending+=b.toString('utf8');
      if(total>96*1024||Buffer.byteLength(pending)>16384){problem=new Error('LAUNCHER_CHANNEL_BOUND');client.destroy();return;}
      const lines=pending.split('\n');pending=lines.pop()!;
      for(const line of lines)chain=chain.then(async()=>{const event=validator.accept(authenticateLauncherEnvelope(line,key));await retain(event);})
        .catch(e=>{problem=e;client.destroy();});
    });
  });
  await new Promise<void>((yes,no)=>{server.once('error',no);server.listen(path,yes);});
  return {context,setWrapperPid(pid:number){if(wrapperPid!==null||!Number.isSafeInteger(pid)||pid<1)throw new Error('LAUNCHER_WRAPPER_BINDING');wrapperPid=pid;},
    bootstrap:()=>JSON.stringify({schema:'tunacad-launcher-bootstrap/2',pipeName:name,nodePid:process.pid,keyHex:key.toString('hex'),context})+'\n',
    async finish(){let timer:ReturnType<typeof setTimeout>|undefined;
      try{await Promise.race([drain,new Promise<never>((_,no)=>{timer=setTimeout(()=>no(new Error('LAUNCHER_CHANNEL_NOT_DRAINED')),2000);})]);}
      finally{if(timer)clearTimeout(timer);}
      await chain;if(problem)throw problem;if(!drained||pending||!validator.complete())throw new Error('LAUNCHER_INCOMPLETE_EVENTS');
      return {events:validator.snapshot(),wrapperPid,childSolverPid:validator.childSolverPid(),
        provenanceComplete:true,ownedTreeComplete:true,peerAuthentication:'private_stdin_capability',osClientPidVerified:false};},
    snapshot:validator.snapshot,close(){socket?.destroy();server.close();key.fill(0);}};
}
