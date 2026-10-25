// Controlled loopback pairing/approvals and SYNTHETIC numerical driver only.
// No native owner/store, executable, solver or real human approval.
import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import {setImmediate as tick} from 'node:timers/promises';
import {registerHooks} from 'node:module';
import {NEW_EXPLICIT_PROJECT_RESULT_CAPTURE_ENABLED,NEW_ELECTROSTATIC_PROJECT_RESULT_CAPTURE_ENABLED} from '../src/simulation/projectResultDeliveryPolicy.ts';
import {slabRequest,syntheticSlabMesh,syntheticElectricalDat} from './sim9-electrostatic-fixture.mts';
import {sealElectrostaticFoundation} from '../simulation-bridge/electrostaticFoundation.mts';
import {electrostaticStepGeometryDigest} from '../simulation-bridge/electrostaticStepIdentity.mts';
import {ComposedElectrostaticProvider} from '../providers/ComposedElectrostaticProvider.mts';
import {validateProjectCompletionSnapshot} from '../src/simulation/authorizedPortableResults.ts';
assert.equal(NEW_EXPLICIT_PROJECT_RESULT_CAPTURE_ENABLED,false);assert.equal(NEW_ELECTROSTATIC_PROJECT_RESULT_CAPTURE_ENABLED,false);
// Actual server, Electrostatics-only controlled gate. The normal source flags
// are never edited and no production capture flag or native execution is enabled.
const controlledPolicy=new URL('../src/simulation/projectResultDeliveryPolicy.ts?controlled-electrical-only',import.meta.url).href;
const hook=registerHooks({resolve(specifier,context,next){const result=next(specifier,context);return result.url.endsWith('/projectResultDeliveryPolicy.ts')?{...result,url:controlledPolicy}:result;},
 load(url,context,next){return url===controlledPolicy?{format:'module',shortCircuit:true,source:'export const NEW_EXPLICIT_PROJECT_RESULT_CAPTURE_ENABLED=false;export const NEW_ELECTROSTATIC_PROJECT_RESULT_CAPTURE_ENABLED=true;export const NEW_PROJECT_RESULT_CAPTURE_ENABLED=false;'}:next(url,context);}});
let startSimulationBridge:typeof import('../simulation-bridge/server.mts')['startSimulationBridge'];
try{({startSimulationBridge}=await import('../simulation-bridge/server.mts'));}finally{hook.deregister();}
import {webCryptoDigest as hash} from '../simulation-bridge/v2ValidationBrowser.mts';
const step=new TextEncoder().encode("ISO-10303-21;\nHEADER;\nFILE_NAME('Open CASCADE Shape Model','2026-10-22T00:00:00',(''),(''),'','', '');\nENDSEC;\nDATA;\n#1 = PRODUCT('Open CASCADE STEP translator 7.6 1',\n  'Open CASCADE STEP translator 7.6 1','',());\nENDSEC;\nEND-ISO-10303-21;\n");
const origin='http://127.0.0.1:8080',h=await hash('CONTROLLED project delivery'),runtime:any={providerId:'tunacad-calculix-electrostatic-development',providerVersion:'0.1.0',engine:'CalculiX',engineVersion:'2.16',executableDigest:h,nodeMajor:24,platform:'win32',architecture:'x64'};
let permit=true,approvals=0,sequence=0,numericalReads=0,holdMesh=false;
let holdRead:null|(()=>Promise<void>)=null;
const capabilities:any={id:'controlled',version:'0.1.0',runtime,scope:'single_linear_dielectric_parallel_plate_slab',maximumStepBytes:16*1024*1024};
const meshes=new Map<string,any>();
const provider=new ComposedElectrostaticProvider(capabilities,{
 async submit(request,source){assert.deepEqual(await source.export('step'),step);const mesh=syntheticSlabMesh();Object.assign(mesh,{requestDigest:request.requestDigest,projectRevision:request.projectRevision,geometryDigest:request.geometryDigest});mesh.provenance.inputGeometryDigest=mesh.geometryDigest;
 const id='synthetic-mesh-'+(++sequence);meshes.set(id,{mesh,hold:holdMesh,cancelled:false});return {meshRunId:id};},
 async getStatus(id){const m=meshes.get(id);return {meshRunId:id,status:m.cancelled?'cancelled':m.hold?'running':'succeeded',progress:1};},
 async getMesh(id){return structuredClone(meshes.get(id).mesh);},async cancel(id){meshes.get(id).cancelled=true;return {meshRunId:id,status:'cancelled'};},async confirmCleanup(id){const m=meshes.get(id);return !m.hold||m.cancelled;},
} as any,{async execute(input){return {jobId:input.jobId,sourceDigest:input.source.identity.sourceDigest,runtime,cleanupConfirmed:true,state:'completed_converged',output:syntheticElectricalDat(input.source.mesh),nativeEvidence:{exitCode:0,completedStep:1,completedTime:1,statusDigest:h,diagnosticDigest:h}};}},async()=>runtime,'Z:\\legacy-parent-must-not-be-opened');
const runs=(provider as any).runs as Map<string,any>,readResult=provider.getResult.bind(provider);
provider.getResult=async id=>{numericalReads++;await holdRead?.();return readResult(id);};
const bridge=await startSimulationBridge({port:0,allowedOrigin:origin,provider:null,providerElectrical:provider,
 readiness:{ready:false,provider:null,electrostatic:capabilities,meshing:{ready:true,adapterVersion:'controlled',runtimeVersion:'none',geometryFormats:['step'],elementFamilies:['tetrahedral']},solving:{ready:true,adapterVersion:'controlled',runtimeVersion:'none',analysisTypes:['electrostatic']}},
 async approve(request){assert.equal(request.schema,'tunacad-electrostatic-foundation/0.1');approvals++;return permit;}});
const challenge=randomBytes(32).toString('hex'),headers:any={Origin:origin,'Content-Type':'application/json'};
const raw=async(path:string,method='GET',body?:unknown,auth=true)=>fetch(bridge.url+path,{method,headers:{...headers,...(auth?{Authorization:'Bearer '+token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
let token='';const passed:string[]=[];const check=async(name:string,fn:()=>Promise<void>)=>{await fn();passed.push(name);console.log('PASS '+name);};
try{
 const paired=await raw('/v1/pair','POST',{challenge,proof:createHmac('sha256',bridge.pairingCode).update('client:'+challenge).digest('hex')},false);assert.equal(paired.status,200);token=(await paired.json()).sessionToken;
 const {requestDigest,...draft}=slabRequest(await electrostaticStepGeometryDigest(step));
 async function submit(project:boolean,sourceDocument?:{documentId:string;revision:string;bodyId:string}){
  const request=sealElectrostaticFoundation({...draft,...(project?{resultDelivery:'project_archive' as const}:{})});
  const issued=await raw('/v1/authorizations','POST',{schema:'tunacad-electrostatic-authorization/0.1',preparationId:'simprep_electrical-11111111-1111-4111-8111-111111111111',request});assert.equal(issued.status,202);const grant=await issued.json();
  for(let i=0;i<20;i++){const state=await (await raw('/v1/authorizations/'+grant.authorizationId)).json();if(state.state!=='pending')break;await tick();}
  const response=await raw('/v1/jobs','POST',{authorizationId:grant.authorizationId,stepBase64:Buffer.from(step).toString('base64'),sourceDocument:sourceDocument??{documentId:'controlled-new-document',revision:request.model.projectRevision,bodyId:request.model.domains[0].bodyId}});
  if(response.status===202){const copy=await response.clone().json();for(let n=0;n<100;n++){const current=await provider.getStatus(copy.providerRunId);if(holdMesh||['succeeded','failed','cancelled'].includes(current.status))break;await new Promise(r=>setTimeout(r,10));}}
  return {response,request};
 }
 await check('Origin and session token mismatches fail before numerical access',async()=>{
  assert.equal((await fetch(bridge.url+'/v1/jobs/missing/project-result',{headers:{Origin:'http://127.0.0.1:9999',Authorization:'Bearer '+token}})).status,403);
  assert.equal((await fetch(bridge.url+'/v1/jobs/missing/project-result',{headers:{Origin:origin,Authorization:'Bearer '+'0'.repeat(64)}})).status,401);
 });
 await check('No project numerical data without authenticated session or current owned job',async()=>{
  assert.equal((await raw('/v1/jobs/missing/project-result','GET',undefined,false)).status,401);
  assert.equal((await raw('/v1/jobs/missing/project-result')).status,403);
 });
 let newId='';
 await check('Approved new request delivers bounded project data with no export approval or signing key',async()=>{
  const {response,request}=await submit(true);assert.equal(response.status,202);newId=(await response.json()).providerRunId;
  const delivered=await raw('/v1/jobs/'+newId+'/project-result');assert.equal(delivered.status,200);const result=await validateProjectCompletionSnapshot(await delivered.json());
  assert.equal(result.origin.requestDigest,request.requestDigest);assert.equal(result.origin.source!.documentId,'controlled-new-document');assert.equal(result.data.kind,'single_dielectric_fields');assert(!('exportReceipt' in result));assert.equal(approvals,1);
  const text=JSON.stringify(result);for(const forbidden of ['authorizationId','diagnosticDigest','statusDigest','sessionToken','storagePath'])assert(!text.includes(forbidden));
 });
 await check('Concurrent project deliveries are bounded without cancelling the completed job',async()=>{
  let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);
  holdRead=()=>{holdRead=null;entered();return wait;};const first=raw('/v1/jobs/'+newId+'/project-result');await ready;
  try{assert.equal((await raw('/v1/jobs/'+newId+'/project-result')).status,409);assert.equal(runs.get(newId).status.status,'succeeded');}
  finally{release();}assert.equal((await first).status,200);
 });
 await check('Legacy approved job is not upgraded; denied execution cannot create a job',async()=>{
  const {response}=await submit(false);assert.equal(response.status,202);const legacy=(await response.json()).providerRunId,reads=numericalReads;
  assert.equal((await raw('/v1/jobs/'+legacy+'/project-result')).status,403);assert.equal(numericalReads,reads);
  permit=false;assert.equal((await submit(true)).response.status,403);assert.equal(runs.size,2);
 });
 await check('Native scratch cleanup preserves unarchived numerical delivery',async()=>{
  const before=await(await raw('/v1/jobs/'+newId+'/project-result')).json();await provider.releaseResources(newId);
  assert.deepEqual(await(await raw('/v1/jobs/'+newId+'/project-result')).json(),before);
 });
 await check('Unapproved transfer and mismatched source cannot create a completed job',async()=>{
  const count=runs.size;assert.equal((await raw('/v1/jobs','POST',{})).status,403);
  permit=true;const wrong=await submit(true,{documentId:'controlled-new-document',revision:'wrong-revision',bodyId:draft.model.domains[0].bodyId});
  assert.equal(wrong.response.status,400);assert.equal(runs.size,count);
 });
 await check('Cancelled job and unpaired session cannot deliver numerical project data',async()=>{
  permit=true;holdMesh=true;const pending=await submit(true);assert.equal(pending.response.status,202);const activeId=(await pending.response.json()).providerRunId;
  await raw('/v1/jobs/'+activeId+'/cancel','POST');assert.notEqual((await raw('/v1/jobs/'+activeId+'/project-result')).status,200);
  await raw('/v1/session','DELETE');assert.equal((await raw('/v1/jobs/'+newId+'/project-result')).status,401);
 });
 console.log(JSON.stringify({status:'PASS',groups:passed.length,authentication:'ACTUAL NORMAL HTTP HMAC; CONTROLLED CONSENT AND SYNTHETIC COMPLETION',productionHumanConsentVerified:false,solverRuns:0,protectedStorageOperations:0,signingKeys:0,engineeringUsePermitted:false}));
}finally{await bridge.close();}
