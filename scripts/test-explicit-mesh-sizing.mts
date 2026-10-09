// Pure contract/configuration/planning checks. No CAD, filesystem or providers.
import assert from 'node:assert/strict';
import {explicitMeshSizeSchema,estimateExplicitMeshResources,preflightExplicitMesh} from '../simulation-bridge/explicitMeshSizing.mts';
import {EXPLICIT_LINEAR_MESH_CONFIGURATION,EXPLICIT_LINEAR_MESH_GEO,explicitMeshGeo,explicitMeshConfiguration,explicitMeshConfigurationDigest,verifyExplicitMeshPreflightBinding} from '../providers/gmsh/ExplicitLinearMesh.mts';
import {sealExplicitDynamics,validateExplicitDynamics} from '../simulation-bridge/explicitDynamicsFoundation.mts';
import type {ExplicitDynamicsDraft} from '../simulation-bridge/explicitDynamicsContract.mts';
import {digest} from '../simulation-bridge/stableDigest.mts';
import {estimateExplicitHistoryBytes,normalizeExplicitHistoryNode} from '../simulation-bridge/explicitHistoryResources.mts';
const draft:ExplicitDynamicsDraft={schema:'tunacad-explicit-dynamics-foundation/0.1',studyId:'sizing-unit',
  analysis:{type:'explicit_structural_dynamics',assumptions:['one_linear_elastic_solid','small_displacement','zero_initial_conditions','undamped','no_contact','no_mass_scaling'],
    durationS:75e-6,outputTimesS:[3e-6,75e-6],integration:{kind:'central_difference_cfl_bound',minimumCharacteristicLengthMm:5,safetyFactor:.8,maximumTimeStepS:4e-7,maximumIncrements:20000}},
  model:{projectRevision:'r1',domainId:'part',partId:'part',bodyId:'solid',geometryDigest:digest('synthetic solid'),kind:'straight_rectangular_axial_bar',
    lengthMm:120,widthMm:20,heightMm:15,fixedFaceId:'fixed',loadedFaceId:'load'},
  material:{materialId:'steel',domainId:'part',model:'isotropic_linear_elastic',youngsModulusMPa:200000,poissonRatio:.3,densityKgM3:7800,source:{kind:'custom',reference:'synthetic',revision:'1'}},
  initialConditions:{displacementMm:[0,0,0],velocityMmPerS:[0,0,0]},restraint:{kind:'fixed_face',faceId:'fixed',displacementMm:[0,0,0]},
  load:{kind:'axial_step_face_force',faceId:'load',onsetS:0,forceN:[250,0,0],coordinateSystem:'analysis',history:'constant_after_onset'},
  mesh:{elementFormulation:'C3D4',maximumNodes:100000,maximumElements:50000},
  requestedResults:['loaded_face_axial_displacement_history','fixed_face_axial_reaction_history','kinetic_energy_history','strain_energy_history','applied_work_history'],
  units:{length:'mm',time:'s',force:'N',stress:'MPa',density:'kg/m^3',velocity:'mm/s',acceleration:'mm/s^2',energy:'N*mm'}};
let checks=0;const check=(run:()=>void)=>{run();checks++;};
const legacy=sealExplicitDynamics(draft),before=digest(legacy);
check(()=>{assert.equal(legacy.mesh.sizeMm,undefined);assert.equal(explicitMeshGeo(legacy),EXPLICIT_LINEAR_MESH_GEO);
  assert.equal(explicitMeshConfigurationDigest(legacy),digest({configuration:EXPLICIT_LINEAR_MESH_CONFIGURATION,geo:EXPLICIT_LINEAR_MESH_GEO}));});
for(const size of [.1,1.25,7.5,10,1000])check(()=>assert.equal(explicitMeshSizeSchema.parse(size),size));
for(const size of [0,-1,.09999,1000.01,NaN,Infinity,'10',null])check(()=>assert.equal(explicitMeshSizeSchema.safeParse(size).success,false));
for(const sizeMm of [7.5,12.25,35])check(()=>{
  const sized=sealExplicitDynamics({...draft,mesh:{...draft.mesh,sizeMm}});
  assert.notEqual(sized.requestDigest,legacy.requestDigest);
  assert.notEqual(explicitMeshConfigurationDigest(sized),explicitMeshConfigurationDigest(legacy));
  assert.equal(explicitMeshConfiguration(sized).meshSizeMm,sizeMm);
  assert.ok(explicitMeshGeo(sized).includes(`Mesh.MeshSizeMin = ${sizeMm};\nMesh.MeshSizeMax = ${sizeMm};`));
  assert.deepEqual({...explicitMeshConfiguration(sized),meshSizeMm:10},EXPLICIT_LINEAR_MESH_CONFIGURATION);
  assert.equal(preflightExplicitMesh(sized).meshSizeMm,sizeMm);
  assert.throws(()=>validateExplicitDynamics({...sized,mesh:{...sized.mesh,sizeMm:sizeMm+1}}),/digest mismatch/);
});
check(()=>{const fine=estimateExplicitMeshResources([120,20,15],5),coarse=estimateExplicitMeshResources([120,20,15],10);
  assert.ok(fine.estimatedNodes>coarse.estimatedNodes&&fine.estimatedElements>coarse.estimatedElements);
  assert.deepEqual(estimateExplicitMeshResources([120,20,15],10),estimateExplicitMeshResources([15,120,20],10));});
for(const dimensions of [[100,100,100],[10000,1000,1000],[5,2,1]])check(()=>assert.throws(()=>estimateExplicitMeshResources(dimensions,.1),/planning limits|Planning count overflow/));
// Bounds are geometric, not tied to the reference bar or unit choice.
check(()=>assert.ok(estimateExplicitMeshResources([1,.1,.1],.1).estimatedElements<50000));
for(const dimensions of [[0,1,1],[NaN,1,1],[Infinity,1,1],[1,1]])check(()=>assert.throws(()=>estimateExplicitMeshResources(dimensions),/source solid bounds/));
check(()=>assert.throws(()=>estimateExplicitMeshResources([120,20,15],10,100001,50000),/resource limits/));
check(()=>assert.throws(()=>estimateExplicitMeshResources([120,20,15],10,100000,1),/planning limits/));
const cadRequest=structuredClone(legacy);
const face={centroidPartLocalMm:[0,0,0] as [number,number,number],areaMm2:300};
cadRequest.model.cad={volumeMm3:36000,faceCount:6,boundingBoxMm:{min:[0,0,0],max:[120,20,15]},fixedFace:face,loadedFace:face};
check(()=>assert.equal(preflightExplicitMesh(cadRequest).estimatedHistoryNodes,18));
check(()=>{const dense=structuredClone(cadRequest);dense.mesh.sizeMm=Math.sqrt(10);
  dense.analysis.outputTimesS=[dense.analysis.durationS/63,dense.analysis.durationS];
  assert.throws(()=>preflightExplicitMesh(dense),/2 MiB planning limit/);
  dense.analysis.outputTimesS=[dense.analysis.durationS/20,dense.analysis.durationS];
  assert.ok(preflightExplicitMesh(dense).estimatedHistoryBytes!<2*1024*1024);
});
check(()=>{cadRequest.model.cad!.monitoringFaces=[{...face,referenceId:'wide-side',areaMm2:10000}];
  assert.throws(()=>preflightExplicitMesh(cadRequest),/histories exceed planning limit/);});
check(()=>{const changed=structuredClone(legacy);changed.analysis.integration.maximumTimeStepS=1e-12;
  assert.throws(()=>preflightExplicitMesh(changed),/increment planning limit/);});
check(()=>assert.equal(digest(legacy),before));
// Same arithmetic/schema as the previous native Buffer implementation.
for(const frames of [2,51,64])for(const hasMonitors of [false,true])check(()=>{
  const ids=[1,12345,999999999],n=-1.0000000000000002e-6;
  const bytes=ids.reduce((sum,nodeId)=>sum+Buffer.byteLength(JSON.stringify({nodeId,face:hasMonitors?'monitor':'loaded',
    displacementMm:n,velocityMmPerS:n,accelerationMmPerS2:n,reactionImpulseNs:n,reactionForceN:n}))+5*(25-String(n).length)+1,0);
  assert.equal(estimateExplicitHistoryBytes(frames,ids,hasMonitors),frames*(bytes+2)+128*1024);
});
check(()=>assert.deepEqual(normalizeExplicitHistoryNode(1,'loaded',{dxMm:2,vxMmPerS:3,axMmPerS2:4,reactionImpulseNs:5,reactionForceN:6}),
  {nodeId:1,face:'loaded',displacementMm:2,velocityMmPerS:3,accelerationMmPerS2:4,reactionImpulseNs:5,reactionForceN:6}));
check(()=>assert.doesNotThrow(()=>verifyExplicitMeshPreflightBinding(legacy,undefined)));
check(()=>{const sized=sealExplicitDynamics({...draft,mesh:{...draft.mesh,sizeMm:12.5}}),plan=preflightExplicitMesh(sized);
  assert.doesNotThrow(()=>verifyExplicitMeshPreflightBinding(sized,plan));
  for(const changed of [undefined,{...plan,meshSizeMm:15},{...plan,estimatedNodes:1},{...plan,limits:{...plan.limits,maximumElements:50001}}])
    assert.throws(()=>verifyExplicitMeshPreflightBinding(sized,changed),/PREFLIGHT_BINDING_MISMATCH/);
});
console.log(`PASS: ${checks} mesh sizing/configuration/resource planning checks; legacy digest preserved; no native execution.`);
