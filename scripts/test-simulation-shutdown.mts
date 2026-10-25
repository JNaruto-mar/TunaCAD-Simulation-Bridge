// Focused lifecycle regression: controlled memory providers + loopback HTTP only.
// No owner/protected storage, production approval, native process or browser.
import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import {setImmediate as tick} from 'node:timers/promises';
import {EventEmitter} from 'node:events';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import Module from 'node:module';
import {resolve} from 'node:path';
import {startSimulationBridge} from '../simulation-bridge/server.mts';
import {ComposedElectrostaticProvider} from '../providers/ComposedElectrostaticProvider.mts';
import {OpenRadiossExplicitSolverProvider} from '../providers/openradioss/OpenRadiossExplicitSolverProvider.mts';
import {createExecutionBudget} from '../providers/openradioss/OpenRadiossExecutionReadiness.mts';
import {slabRequest} from './sim9-electrostatic-fixture.mts';
import {electrostaticStepGeometryDigest} from '../simulation-bridge/electrostaticStepIdentity.mts';
const step=new TextEncoder().encode("ISO-10303-21;\nHEADER;\nFILE_NAME('Open CASCADE Shape Model','2026-10-24T00:00:00',(''),(''),'','', '');\nENDSEC;\nDATA;\n#1 = PRODUCT('Open CASCADE STEP translator 7.6 1',\n  'Open CASCADE STEP translator 7.6 1','',());\nENDSEC;\nEND-ISO-10303-21;\n");
const request=slabRequest(await electrostaticStepGeometryDigest(step));
let checks=0;
async function bridgeCase(late:boolean,fail:boolean,expire=false){
 const origin='http://127.0.0.1:8080';let cancels=0,entered!:()=>void,release!:()=>void,settled=false;
 const ready=new Promise<void>(r=>entered=r),held=new Promise<void>(r=>release=r),failure=Error('CONTROLLED_CANCEL_FAILED');
 let time=Date.now();
 const provider:any={capabilities:{maximumStepBytes:16*1024**2},
  async submit(){entered();if(late)await held;return {providerRunId:'controlled_shutdown_job',acceptedAt:new Date(time).toISOString()};},
  async cancel(){cancels++;if(fail)throw failure;return {providerRunId:'controlled_shutdown_job',status:'cancelled',phase:'cancelled_cleaned'};},
 };
 const b=await startSimulationBridge({port:0,allowedOrigin:origin,provider:null,providerElectrical:provider,now:()=>time,
  readiness:{ready:false,provider:null,electrostatic:provider.capabilities,meshing:{ready:false,adapterVersion:'controlled',runtimeVersion:null,geometryFormats:[],elementFamilies:[]},solving:{ready:false,adapterVersion:'controlled',runtimeVersion:null,analysisTypes:[]}},
  async approve(){return true;}});
 let token='';const call=(path:string,method='GET',body?:unknown)=>fetch(b.url+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
 try{
  const challenge=randomBytes(32).toString('hex');token=(await(await call('/v1/pair','POST',{challenge,proof:createHmac('sha256',b.pairingCode).update('client:'+challenge).digest('hex')})).json()).sessionToken;
  const issued=await call('/v1/authorizations','POST',{schema:'tunacad-electrostatic-authorization/0.1',preparationId:'simprep_electrical-11111111-1111-4111-8111-111111111111',request});assert.equal(issued.status,202);
  const grant=await issued.json();for(let n=0;n<20;n++){if((await(await call('/v1/authorizations/'+grant.authorizationId)).json()).state==='approved')break;await tick();}
  const submission=call('/v1/jobs','POST',{authorizationId:grant.authorizationId,stepBase64:Buffer.from(step).toString('base64')}).catch(e=>e);
  if(late)await ready;else assert.equal((await submission).status,202);
  if(expire){time+=21*60_000;const expired=await call('/v1/jobs/controlled_shutdown_job/status');
   assert.equal(expired.status,fail?400:410);if(fail)assert.equal((await expired.json()).error,'BRIDGE_PROVIDER_CLEANUP_UNCONFIRMED');}
  const closing=b.close();assert.equal(b.close(),closing,'Close must be single-flight');
  // Observe the same promise immediately, including intentional rejection.
  const observed=closing.then(()=>{settled=true;return null;},error=>{settled=true;return error;});
  if(late){await tick();assert.equal(settled,false,'A pending submit is not shutdown');release();}
  const error=await observed;
  if(fail){assert.equal(error.message,'BRIDGE_PROVIDER_CLEANUP_UNCONFIRMED');assert.equal(error.cause,failure);assert.deepEqual(error.errors,[failure]);}
  else assert.equal(error,null);
  await submission;assert.equal(cancels,1,'Do not retry or discard uncertain cleanup');
  await assert.rejects(()=>fetch(b.url+'/v1/capabilities',{headers:{Origin:origin}}),'Listener must close even if cleanup fails');
  checks++;
 }finally{release();await b.close().catch(()=>{});}
}
await bridgeCase(false,false);await bridgeCase(false,true);await bridgeCase(true,false);await bridgeCase(true,true);
await bridgeCase(false,false,true);await bridgeCase(false,true,true);

async function retirementCase(verified:boolean){
 const origin='http://127.0.0.1:8080',runs=new Map<string,any>();let sequence=0,releases=0,statusReads=0,openStatus!:()=>void,bothReads!:()=>void;
 const statusBarrier=new Promise<void>(r=>openStatus=r),reads=new Promise<void>(r=>bothReads=r);
 const provider:any={capabilities:{maximumStepBytes:16*1024**2},async submit(){
  const id='retirement_'+(++sequence),acceptedAt=new Date().toISOString();runs.set(id,{providerRunId:id,status:'failed',phase:'failed_cleaned',progress:null,updatedAt:acceptedAt,failure:{code:'CONTROLLED_FAILURE',message:'controlled'}});return {providerRunId:id,acceptedAt};},
  async getStatus(id:string){assert(runs.has(id),'Retired status must come from the Bridge, not a deleted execution');
   if(verified&&id==='retirement_1'){if(++statusReads===2)bothReads();await statusBarrier;}return structuredClone(runs.get(id));},
  async cancel(id:string){return structuredClone(runs.get(id));},
  ...(verified?{async releaseResources(id:string){assert(runs.has(id));releases++;const status=runs.get(id);runs.delete(id);return status;}}:{}),
 };
 const b=await startSimulationBridge({port:0,allowedOrigin:origin,provider:null,providerElectrical:provider,
  readiness:{ready:false,provider:null,electrostatic:provider.capabilities,meshing:{ready:false,adapterVersion:'controlled',runtimeVersion:null,geometryFormats:[],elementFamilies:[]},solving:{ready:false,adapterVersion:'controlled',runtimeVersion:null,analysisTypes:[]}},async approve(){return true;}});
 let token='';const call=(path:string,method='GET',body?:unknown)=>fetch(b.url+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
 try{
  const challenge=randomBytes(32).toString('hex');token=(await(await call('/v1/pair','POST',{challenge,proof:createHmac('sha256',b.pairingCode).update('client:'+challenge).digest('hex')})).json()).sessionToken;
  for(let n=1;n<=5;n++){
   const issued=await call('/v1/authorizations','POST',{schema:'tunacad-electrostatic-authorization/0.1',preparationId:'simprep_electrical-11111111-1111-4111-8111-111111111111',request});
   if(!verified&&n===5){assert.equal(issued.status,409);break;}assert.equal(issued.status,202);
   const grant=await issued.json();for(let i=0;i<20;i++){if((await(await call('/v1/authorizations/'+grant.authorizationId)).json()).state==='approved')break;await tick();}
   const submission=await call('/v1/jobs','POST',{authorizationId:grant.authorizationId,stepBase64:Buffer.from(step).toString('base64')});assert.equal(submission.status,202);const id=(await submission.json()).providerRunId;
   let status:any;
   if(verified&&n===1){const a=call('/v1/jobs/'+id+'/status'),c=call('/v1/jobs/'+id+'/status');await reads;openStatus();status=await(await a).json();assert.equal((await c).status,200);assert.equal(releases,1);}
   else status=await(await call('/v1/jobs/'+id+'/status')).json();
   assert.equal(status.status,'failed');assert.equal((await(await call('/v1/jobs/'+id+'/status')).json()).failure.code,'CONTROLLED_FAILURE');
  }
  assert.equal(sequence,verified?5:4);assert.equal(releases,verified?5:0);assert.equal(runs.size,verified?0:4);checks++;
 }finally{openStatus();await b.close();}
}
await retirementCase(true);await retirementCase(false);

function cancellationFixture(failMesh=false,confirmed=true){
 let meshCancels=0,solverCancels=0,drained=false;
 const failure=Error('CONTROLLED_MESH_CANCEL_FAILED');
 const p:any=new ComposedElectrostaticProvider({} as any,{async cancel(){meshCancels++;if(failMesh)throw failure;},async confirmCleanup(){return confirmed;}} as any,{} as any,async()=>({} as any),'CONTROLLED_NO_STORAGE');
 const run:any={id:'controlled',revoked:false,controller:new AbortController(),status:{providerRunId:'controlled',status:'running',phase:'controlled'},
  meshRunId:'controlled_mesh',electricalId:'controlled_solver',lifecycle:{async cancel(){solverCancels++;},getStatus(){return {cleanupConfirmed:confirmed};}},
  done:Promise.resolve().then(()=>{drained=true;})};
 p.runs.set(run.id,run);return {p,run,failure,counts:()=>({meshCancels,solverCancels,drained})};
}
const clean=cancellationFixture();assert.equal((await clean.p.cancel('controlled')).phase,'cancelled_cleaned');await clean.p.cancel('controlled');
assert.deepEqual(clean.counts(),{meshCancels:1,solverCancels:1,drained:true});checks++;
const failed=cancellationFixture(true);let first:any;
await assert.rejects(()=>failed.p.cancel('controlled'),error=>{first=error;return error.cause===failed.failure;});
await assert.rejects(()=>failed.p.cancel('controlled'),error=>error===first);assert.deepEqual(failed.counts(),{meshCancels:1,solverCancels:1,drained:true});checks++;
const uncertain=cancellationFixture(false,false);await assert.rejects(()=>uncertain.p.cancel('controlled'),/ELECTROSTATIC_CLEANUP_PENDING/);assert.equal(uncertain.run.status.phase,'cancelled_cleanup_pending');checks++;
const completed=cancellationFixture();completed.run.status={...completed.run.status,status:'succeeded'};completed.run.step=new Uint8Array([1,2,3]);
const numerical={unarchived:true,values:[1,2,3]};completed.run.fields=numerical;
assert.equal((await completed.p.releaseResources('controlled')).status,'succeeded');assert.equal(completed.run.revoked,false);assert.equal(completed.p.runs.has('controlled'),true);assert.equal(completed.run.fields,numerical);assert.deepEqual([...completed.run.step],[1,2,3]);assert.equal(completed.counts().meshCancels,0);checks++;
const failedClean=cancellationFixture();failedClean.run.status={...failedClean.run.status,status:'failed',failure:{code:'CONTROLLED_PRIMARY',message:'controlled'}};
assert.equal((await failedClean.p.releaseResources('controlled')).failure.code,'CONTROLLED_PRIMARY');assert.equal(failedClean.p.runs.has('controlled'),false);checks++;
const notClean=cancellationFixture(false,false);notClean.run.status={...notClean.run.status,status:'failed'};
await assert.rejects(()=>notClean.p.releaseResources('controlled'),/CLEANUP_PENDING/);assert.equal(notClean.p.runs.has('controlled'),true);checks++;
const active=cancellationFixture();await assert.rejects(()=>active.p.releaseResources('controlled'),/NOT_TERMINAL/);assert.equal(active.counts().meshCancels,0);checks++;
const budget=createExecutionBudget(Date.now()+60000),idle:any=new OpenRadiossExplicitSolverProvider({} as any,{executionBudget:budget} as any);
idle.confirmQuiescent();idle.runs.set('unknown-owned-run',{});assert.throws(()=>idle.confirmQuiescent(),/CLEANUP_UNCONFIRMED/);idle.runs.clear();checks++;
let finishVerification!:()=>void,verificationEntered!:()=>void;const verificationReady=new Promise<void>(r=>verificationEntered=r),heldVerification=new Promise<void>(r=>finishVerification=r);
const verifying=budget.verify('source','controlled_pending_source',async()=>{verificationEntered();await heldVerification;return true;});await verificationReady;
assert.throws(()=>idle.confirmQuiescent(),/OPERATIONS_PENDING/);finishVerification();await verifying;idle.confirmQuiescent();checks++;

// Exercise the real execute catch/finally, before any protected store could be
// provisioned: failed mesh status, then failed mesh cancellation.
const execution:any=new ComposedElectrostaticProvider({} as any,{
 async submit(){return {meshRunId:'controlled_mesh'};},async getStatus(){return {status:'failed',failure:{code:'CONTROLLED_ORIGINAL_MESH_FAILURE'}};},
 async cancel(){throw Error('CONTROLLED_SECONDARY_CLEANUP_FAILURE');},async confirmCleanup(){return false;},
} as any,{} as any,async()=>({} as any),'CONTROLLED_NO_STORAGE');
const run:any={id:'controlled_execute',request,revoked:false,controller:new AbortController(),step,status:{status:'running'},done:Promise.resolve()};execution.runs.set(run.id,run);
run.done=execution.execute(run);await run.done;
assert.equal(run.status.failure.code,'CONTROLLED_ORIGINAL_MESH_FAILURE');assert.equal(run.status.phase,'cleanup_pending');
await assert.rejects(()=>execution.cancel(run.id),error=>error.cause===run.executionFailure);checks++;

// Importing the reusable normal CLI factory must not start an owner or probe a
// provider; invocation still requires a genuine interactive terminal.
const interactive=await import('../simulation-bridge/interactiveBridge.mts');assert.equal(typeof interactive.startInteractiveSimulationBridge,'function');checks++;

// Exercise that SAME interactive factory with memory-only dependencies. TTY is
// true only in this in-memory test bundle, never a production authorization.
const key='__controlledInteractiveShutdown';assert.equal((globalThis as any)[key],undefined);
let memory:any;
class Terminal extends EventEmitter{closed=false;close(){if(!this.closed){this.closed=true;this.emit('close');}}async question(){throw Error('UNEXPECTED_APPROVAL');}}
(globalThis as any)[key]={terminal:()=>memory.terminal,store:()=>({filePath:'CONTROLLED',async readVerified(){return {paths:{}};}}),
 async pipeline(){return {provider:null,readiness:{meshing:{ready:false},solving:{ready:false}}};},
 async bridge(){if(memory.startError)throw memory.startError;return {async close(){memory.closes++;if(memory.closeError)throw memory.closeError;}};}};
const stubs:Record<string,string>={
 'node:readline/promises':`export const createInterface=()=>globalThis.${key}.terminal();`,
 'providers.mts':`export const loadExternalPipeline=globalThis.${key}.pipeline;export function testExternalProviderPaths(){throw Error('UNEXPECTED_CONFIGURATION');}`,
 'server.mts':`export const startSimulationBridge=globalThis.${key}.bridge;`,
 'providerSettings.mts':`export const openNativeProviderSettings=globalThis.${key}.store;export const resolveConfiguredProviderPaths=()=>({});export const resolveElectrostaticStorageParent=()=>undefined;`,
 'twoLayerTerminalApproval.mts':`export function approveTwoLayerInTerminal(){throw Error('UNEXPECTED_APPROVAL');}`,
 'nativePortableExport.mts':`export function approvePortableExportInTerminal(){throw Error('UNEXPECTED_APPROVAL');}`,
 'windowsExecutablePicker.mts':`export function browseExternalProviderExecutable(){throw Error('UNEXPECTED_CONFIGURATION');}`,
 'harmonicModePolicy.mts':`export const HARMONIC_MODE_POLICY={};export function selectHarmonicModeCount(){throw Error('UNEXPECTED_APPROVAL');}`,
};
const savedExitCode=process.exitCode,savedError=console.error;
try{
 const source=await readFile(new URL('../simulation-bridge/interactiveBridge.mts',import.meta.url),'utf8');
 assert(source.includes('!process.stdin.isTTY || !process.stdout.isTTY'));
 const bundle=await build({stdin:{contents:source,loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',define:{'process.stdin.isTTY':'true','process.stdout.isTTY':'true'},plugins:[{name:'memory-interactive-lifecycle',setup(api){
  api.onResolve({filter:/.*/},args=>{const name=args.path.startsWith('node:')?args.path:args.path.split('/').at(-1)!;assert(name in stubs,'Unexpected factory dependency');return {path:name,namespace:'controlled'};});
  api.onLoad({filter:/.*/,namespace:'controlled'},args=>({contents:stubs[args.path],loader:'js'}));
 }}]});
 const mod=new Module(resolve('scripts/.controlled-interactive.cjs'));mod.filename=resolve('scripts/.controlled-interactive.cjs');mod.paths=Module._nodeModulePaths(process.cwd());mod._compile(bundle.outputFiles[0].text,mod.filename);
 const start=mod.exports.startInteractiveSimulationBridge,reset=(extra:any={})=>memory={terminal:new Terminal(),closes:0,...extra};
 reset();const owner=await start({announce:false});const closing=owner.close();assert.equal(owner.close(),closing);await closing;assert.equal(memory.closes,1);assert.equal(memory.terminal.closed,true);checks++;
 const startup=Error('CONTROLLED_STARTUP_FAILURE');reset({startError:startup});await assert.rejects(()=>start({announce:false}),e=>e===startup);assert.equal(memory.terminal.closed,true);checks++;
 const cleanup=Error('CONTROLLED_CLOSE_FAILURE');reset({closeError:cleanup});let interrupted=0;
 const embedding=await start({announce:false,onInterrupt(){interrupted++;}});memory.terminal.emit('SIGINT');await assert.rejects(()=>embedding.close(),e=>e===cleanup);assert.equal(interrupted,1);assert.equal(memory.closes,1);checks++;
 reset({closeError:cleanup});const errors:string[]=[];console.error=(message:any)=>{errors.push(String(message));};
 const ordinary=await start({announce:false});memory.terminal.close();await assert.rejects(()=>ordinary.close(),e=>e===cleanup);await tick();assert.equal(process.exitCode,1);assert.deepEqual(errors,['BRIDGE_SHUTDOWN_UNCONFIRMED']);checks++;
}finally{delete (globalThis as any)[key];console.error=savedError;process.exitCode=savedExitCode;}
console.log(JSON.stringify({status:'PASS',checks,controlledProvidersOnly:true,nativeSolvers:0,protectedStorageOperations:0,browsers:0,engineeringUsePermitted:false}));
