// Canonical adapters and validators with labelled synthetic mesh/output only.
// No filesystem storage, provider process, protected result or human consent.
import assert from 'node:assert/strict';
import {setTimeout as wait} from 'node:timers/promises';
import {ComposedElectrostaticProvider} from '../providers/ComposedElectrostaticProvider.mts';
import {slabRequest,syntheticSlabMesh,syntheticElectricalDat} from './sim9-electrostatic-fixture.mts';
import {electrostaticStepGeometryDigest} from '../simulation-bridge/electrostaticStepIdentity.mts';
import {sealElectrostaticFoundation} from '../simulation-bridge/electrostaticFoundation.mts';
import {digest} from '../simulation-bridge/stableDigest.mts';
import type {ElectrostaticRuntimeIdentity} from '../simulation-bridge/electrostaticAdmission.mts';
const step=new TextEncoder().encode("ISO-10303-21;\nHEADER;\nFILE_NAME('Open CASCADE Shape Model','2026-10-24T00:00:00',(''),(''),'','', '');\nENDSEC;\nDATA;\n#1 = PRODUCT('Open CASCADE STEP translator 7.6 1',\n  'Open CASCADE STEP translator 7.6 1','',());\nENDSEC;\nEND-ISO-10303-21;\n");
const {requestDigest:_,...draft}=slabRequest(await electrostaticStepGeometryDigest(step));
const request=sealElectrostaticFoundation({...draft,resultDelivery:'project_archive'});
const approval={preparationId:'simprep_electrical-11111111-1111-4111-8111-111111111111',authorizationId:'a'.repeat(64)};
let checks=0;
function fixture(mode:'pass'|'fail'|'cancel'='pass'){
 const mesh=syntheticSlabMesh();mesh.geometryDigest=request.model.domains[0].geometryDigest;mesh.requestDigest=request.requestDigest;mesh.provenance.inputGeometryDigest=mesh.geometryDigest;
 let runtime:ElectrostaticRuntimeIdentity={providerId:'tunacad-calculix-electrostatic-development',providerVersion:'0.1.0',engine:'CalculiX',engineVersion:'2.16',executableDigest:digest('synthetic executable'),nodeMajor:24,platform:'win32',architecture:'x64'};
 let solves=0,cancelled=false;
 const provider=new ComposedElectrostaticProvider({maximumStepBytes:16*1024**2} as any,{
  async submit(_request:any,source:any){assert.deepEqual(await source.export('step'),step);return {meshRunId:'synthetic-mesh'};},
  async getStatus(){return {status:mode==='cancel'&&!cancelled?'running':mode==='fail'?'failed':'succeeded',failure:{code:'SYNTHETIC_MESH_FAILURE'}};},
  async getMesh(){return structuredClone(mesh);},async cancel(){cancelled=true;},async confirmCleanup(){return mode!=='cancel'||cancelled;},
 } as any,{async execute(input){solves++;return {jobId:input.jobId,sourceDigest:input.source.identity.sourceDigest,runtime,cleanupConfirmed:true,
   state:'completed_converged',output:syntheticElectricalDat(input.source.mesh),nativeEvidence:{exitCode:0,completedStep:1,completedTime:1,statusDigest:digest('synthetic status'),diagnosticDigest:digest('synthetic diagnostics')}};}},
 async()=>runtime,'Z:\\not-accessed-legacy-storage');
 return {provider,solves:()=>solves,changeRuntime(){runtime={...runtime,executableDigest:digest('different executable')};}};
}
async function terminal(p:ComposedElectrostaticProvider,id:string){for(let i=0;i<100;i++){const s=await p.getStatus(id);if(['succeeded','failed','cancelled'].includes(s.status))return s;await wait(20);}throw Error('OFFLINE_FIXTURE_DEADLINE');}
const success=fixture(),id=(await success.provider.submit(request,step,approval)).providerRunId;
assert.equal((await terminal(success.provider,id)).status,'succeeded');assert.equal(success.solves(),1);checks++;
const result=await success.provider.getResult(id);assert.ok(result);assert.equal(result.completion.engineeringUsePermitted,false);assert.equal(result.fieldDatasets.length,3);checks++;
const snapshot=await success.provider.captureNewPortableFields(id,new AbortController().signal);assert.equal(snapshot.datasets.length,3);
await success.provider.releaseResources(id);assert.equal((await success.provider.getResult(id))?.dispatchDigest,result.dispatchDigest);
assert.deepEqual((await success.provider.captureNewPortableFields(id,new AbortController().signal)).datasets,snapshot.datasets);checks++;
success.changeRuntime();assert.equal(await success.provider.getResult(id),null);checks++;
const failed=fixture('fail'),failedId=(await failed.provider.submit(request,step,approval)).providerRunId;
assert.equal((await terminal(failed.provider,failedId)).failure?.code,'SYNTHETIC_MESH_FAILURE');assert.equal(failed.solves(),0);
assert.equal((await failed.provider.releaseResources(failedId)).status,'failed');checks++;
const cancelled=fixture('cancel'),cancelId=(await cancelled.provider.submit(request,step,approval)).providerRunId;
await wait(30);await cancelled.provider.cancel(cancelId);assert.equal((await cancelled.provider.releaseResources(cancelId)).status,'cancelled');assert.equal(cancelled.solves(),0);checks++;
await assert.rejects(()=>fixture().provider.submit(request,step,{...approval,authorizationId:'invalid'}),/APPROVAL_INVALID/);checks++;
console.log(JSON.stringify({status:'PASS',checks,evidence:'SYNTHETIC ONLY',nativeSolvers:0,protectedStorageOperations:0,engineeringUsePermitted:false}));
