// Public neutral contract fixtures only. No TunaCAD-private imports, runtime
// files, physical mesh, local paths or real execution/approval evidence.
import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { sealExplicitDynamics } from '../simulation-bridge/explicitDynamicsFoundation.mts';
import { validatePrivateExplicitSolve } from '../simulation-bridge/privateExplicitPreparationContract.mts';
import { createPrivateSimulationApprovals } from '../simulation-bridge/privateSimulationApproval.mts';
const sha=digest('neutral-fixture'),session='neutral-session';
const source={documentId:'document',modelId:'model',sessionBinding:digest(session),revision:'r1',sourceEpoch:0,
  componentId:'part',bodyId:'body',domainId:'domain',topologyDigest:sha,canonicalSourceDigest:sha,materialId:'elastic',
  materialDigest:sha,studyParameterDigest:sha,unitSystemDigest:sha,
  fixedFace:{referenceId:'fixed',bodyId:'body',fingerprint:digest('fixed')},
  loadedFace:{referenceId:'loaded',bodyId:'body',fingerprint:digest('loaded')}};
const request=sealExplicitDynamics({schema:'tunacad-explicit-dynamics-foundation/0.1',studyId:'neutral-study',
  analysis:{type:'explicit_structural_dynamics',durationS:50e-6,outputTimesS:[1e-6,50e-6],
    assumptions:['one_linear_elastic_solid','small_displacement','zero_initial_conditions','undamped','no_contact','no_mass_scaling'],
    integration:{kind:'central_difference_cfl_bound',minimumCharacteristicLengthMm:5,safetyFactor:.8,maximumTimeStepS:4e-7,maximumIncrements:20000}},
  model:{projectRevision:'r1',domainId:'domain',partId:'part',bodyId:'body',geometryDigest:sha,kind:'straight_rectangular_axial_bar',
    lengthMm:100,widthMm:10,heightMm:10,fixedFaceId:'fixed',loadedFaceId:'loaded'},
  material:{materialId:'elastic',domainId:'domain',model:'isotropic_linear_elastic',youngsModulusMPa:200000,
    poissonRatio:.3,densityKgM3:7800,source:{kind:'custom',reference:'neutral unit material',revision:'1'}},
  initialConditions:{displacementMm:[0,0,0],velocityMmPerS:[0,0,0]},
  restraint:{kind:'fixed_face',faceId:'fixed',displacementMm:[0,0,0]},
  load:{kind:'axial_step_face_force',faceId:'loaded',onsetS:0,forceN:[100,0,0],coordinateSystem:'analysis',history:'constant_after_onset'},
  mesh:{elementFormulation:'C3D4',maximumNodes:100000,maximumElements:50000},
  requestedResults:['loaded_face_axial_displacement_history','fixed_face_axial_reaction_history','kinetic_energy_history','strain_energy_history','applied_work_history'],
  units:{length:'mm',time:'s',force:'N',stress:'MPa',density:'kg/m^3',velocity:'mm/s',acceleration:'mm/s^2',energy:'N*mm'}});
const binding=await validatePrivateExplicitSolve({schema:'tunacad-private-simulation-solve-approval/0.1',contractVersion:request.schema,
  preparationId:'preparation',studyId:request.studyId,source,sourceBindingDigest:digest(source),request,
  geometry:{exportId:'export',sourceBindingDigest:digest(source),canonicalSourceDigest:sha,byteDigest:sha,byteLength:256},
  mesh:{meshId:'neutral',meshDigest:sha,exportId:'export',exportByteDigest:sha,sourceBindingDigest:digest(source),geometryDigest:sha,
    faceMappingDigest:sha,validationDigest:sha,meshingRuntime:'Gmsh 4.15.2',nodeCount:8,elementCount:6,elementFormulation:'C3D4'},
  provider:{providerId:'tunacad-openradioss-explicit-private',providerVersion:'0.1.0-poc',runtimeVersion:'2026',runtimeDigest:sha,runtimeManifestDigest:sha},
  geometryApproval:{approvalId:'geometry',bindingDigest:digest({purpose:'geometry_transfer',preparationId:'preparation',studyId:request.studyId,
    sourceBindingDigest:digest(source),requestDigest:request.requestDigest,approvalSource:'controlled_test_fixture'}),
    consumedAt:1000,approvalSource:'controlled_test_fixture'}});
let now=1000,currentSession:string|null=session,delay=0,prompts=0,currentProvider={...binding.provider};
const owner=()=>createPrivateSimulationApprovals({now:()=>now,readSession:()=>currentSession,
  readProvider:async()=>{now+=delay;return currentProvider;},approve:async()=>{prompts++;now+=600000;return true;},
  testConfiguration:{mode:'controlled_test_fixture',purpose:'private_operator_approval_fixture'}});
const reset=()=>{now=1000;currentSession=session;delay=0;currentProvider={...binding.provider};};
let checks=0;const test=async(name:string,work:()=>Promise<void>)=>{reset();await work();checks++;console.log('PASS '+name);};
await test('long review and slow runtime scan precede fresh 120s commit; same consumer rejects replay',async()=>{
  const p=owner(),intent=await p.review!(binding);delay=180000;
  const committed=await p.commitReviewed!(intent,binding,sha);delay=0;
  assert.equal(committed.binding.solveRevalidation!.createdAt,now);
  assert.equal(committed.authorization.expiresAt-now,120000);
  assert.equal(committed.authorization.approvalSource,'controlled_test_fixture');
  await p.verifyConsumed(committed.authorization.authorizationId,committed.binding);
  await assert.rejects(()=>p.consume(committed.authorization.authorizationId,committed.binding),/REPLAY/);
  await assert.rejects(()=>p.commitReviewed!(intent,binding,sha),/STALE_OR_REPLAY/);
  now=committed.authorization.expiresAt;
  await assert.rejects(()=>p.verifyConsumed(committed.authorization.authorizationId,committed.binding),/EXPIRED|STALE/);p.revoke();
});
for(const mutation of ['clone','session','runtime','binding','cancel','revoke'] as const)
  await test('reject '+mutation+' intent at commit',async()=>{
    const p=owner(),intent=await p.review!(binding);let input=structuredClone(binding);
    if(mutation==='session')currentSession='different';
    if(mutation==='runtime')currentProvider.runtimeDigest=digest('different');
    if(mutation==='binding')input.mesh.meshDigest=digest('different');
    if(mutation==='cancel')p.cancelReviewed!(intent);if(mutation==='revoke')p.revoke();
    await assert.rejects(()=>p.commitReviewed!(mutation==='clone'?{}:intent,input,sha));p.revoke();
  });
await test('fixture review cannot enter a human owner or a different owner',async()=>{
  const p=owner(),intent=await p.review!(binding),other=owner();
  await assert.rejects(()=>other.commitReviewed!(intent,binding,sha),/STALE_OR_REPLAY/);
  const human=createPrivateSimulationApprovals({now:()=>now,readSession:()=>session,readProvider:async()=>binding.provider,
    approve:async()=>assert.fail('must not reach human callback')});
  await assert.rejects(()=>human.review!(binding),/SOURCE_MISMATCH/);p.revoke();other.revoke();human.revoke();
});
console.log(`${checks} canonical Bridge review/commit checks PASS; process executions=0.`);
// Real loopback pairing plus the server's actual approval composition. Neutral
// callback evidence only: no real human, CAD, mesh, runtime or provider runs.
const {startSimulationBridge}=await import('../simulation-bridge/server.mts');
const origin='http://127.0.0.1:8080';let nativePrompts=0;
const bridge=await startSimulationBridge({provider:null,port:0,allowedOrigin:origin,
  readiness:{ready:false,provider:null,meshing:{ready:false,adapterVersion:'none',runtimeVersion:null,geometryFormats:[],elementFamilies:[]},
    solving:{ready:false,adapterVersion:'none',runtimeVersion:null,analysisTypes:[]}},
  privateExplicitApprovals:{readProviderIdentity:async()=>binding.provider},approve:async()=>{nativePrompts++;return true;}});
try{
  const challenge=randomBytes(32).toString('hex');
  const paired=await fetch(bridge.url+'/v1/pair',{method:'POST',headers:{origin,'content-type':'application/json'},
    body:JSON.stringify({challenge,proof:createHmac('sha256',bridge.pairingCode).update('client:'+challenge).digest('hex')})});
  assert.equal(paired.status,200);const pair=await paired.json() as any;
  assert.equal(pair.serverProof,createHmac('sha256',bridge.pairingCode).update(`server:${challenge}:${pair.sessionToken}`).digest('hex'));
  assert.equal(bridge.readPrivateSessionIdentity(),digest({pairedSession:pair.sessionToken}));
  const source={...binding.source,sessionBinding:digest(bridge.readPrivateSessionIdentity())},sourceBindingDigest=digest(source);
  const real=await validatePrivateExplicitSolve({...binding,source,sourceBindingDigest,
    geometry:{...binding.geometry,sourceBindingDigest},mesh:{...binding.mesh,sourceBindingDigest},
    geometryApproval:{...binding.geometryApproval,approvalSource:'human',bindingDigest:digest({purpose:'geometry_transfer',
      preparationId:binding.preparationId,studyId:binding.studyId,sourceBindingDigest,requestDigest:binding.request.requestDigest})}});
  await assert.rejects(()=>bridge.privateApprovals!.review!(binding),/SOURCE_MISMATCH|UNAVAILABLE/);
  const intent=await bridge.privateApprovals!.review!(real);assert.equal(nativePrompts,1);
  const committed=await bridge.privateApprovals!.commitReviewed!(intent,real,sha);
  await bridge.privateApprovals!.verifyConsumed(committed.authorization.authorizationId,committed.binding);
  const disconnected=await fetch(bridge.url+'/v1/session',{method:'DELETE',headers:{origin,authorization:'Bearer '+pair.sessionToken}});
  assert.equal(disconnected.status,200);await assert.rejects(()=>bridge.privateApprovals!.verifyConsumed(committed.authorization.authorizationId,committed.binding));
  console.log('PASS actual paired-server opaque session identity, review/commit and revocation; solver executions=0');
}finally{await bridge.close();}
