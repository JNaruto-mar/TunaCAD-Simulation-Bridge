import assert from 'node:assert/strict';
import { parseExplicitMsh22,admitExplicitLinearMesh,EXPLICIT_LINEAR_MESH_GEO } from '../providers/gmsh/ExplicitLinearMesh.mts';
import { assessExplicitC3D4Mesh,assessExplicitC3D4Geometry } from '../providers/calculix/ExplicitDynamicsMeshAdmission.mts';
import { sealExplicitDynamics } from '../simulation-bridge/explicitDynamicsFoundation.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { privateExplicitMeshSchema } from '../simulation-bridge/privateExplicitPreparationContract.mts';
const request=sealExplicitDynamics({schema:'tunacad-explicit-dynamics-foundation/0.1',studyId:'unit-mesh',
  analysis:{type:'explicit_structural_dynamics',assumptions:['one_linear_elastic_solid','small_displacement','zero_initial_conditions','undamped','no_contact','no_mass_scaling'],
    durationS:1e-5,outputTimesS:[5e-6,1e-5],integration:{kind:'central_difference_cfl_bound',minimumCharacteristicLengthMm:5,
      safetyFactor:.8,maximumTimeStepS:1e-7,maximumIncrements:20000}},
  model:{projectRevision:'r1',domainId:'part',partId:'part',bodyId:'body',geometryDigest:digest('test geometry'),
    kind:'straight_rectangular_axial_bar',lengthMm:100,widthMm:10,heightMm:10,fixedFaceId:'fixed',loadedFaceId:'loaded'},
  material:{materialId:'steel',domainId:'part',model:'isotropic_linear_elastic',youngsModulusMPa:200000,poissonRatio:.3,densityKgM3:7800,
    source:{kind:'custom',reference:'unit fixture',revision:'1'}},initialConditions:{displacementMm:[0,0,0],velocityMmPerS:[0,0,0]},
  restraint:{kind:'fixed_face',faceId:'fixed',displacementMm:[0,0,0]},load:{kind:'axial_step_face_force',faceId:'loaded',onsetS:0,forceN:[100,0,0],coordinateSystem:'analysis',history:'constant_after_onset'},
  mesh:{elementFormulation:'C3D4',maximumNodes:100000,maximumElements:50000},
  requestedResults:['loaded_face_axial_displacement_history','fixed_face_axial_reaction_history','kinetic_energy_history','strain_energy_history','applied_work_history'],
  units:{length:'mm',time:'s',force:'N',stress:'MPa',density:'kg/m^3',velocity:'mm/s',acceleration:'mm/s^2',energy:'N*mm'}});
const points=[[0,0,0],[100,0,0],[100,10,0],[0,10,0],[0,0,10],[100,0,10],[100,10,10],[0,10,10]];
const tets=[[1,2,3,7],[1,3,4,7],[1,4,8,7],[1,8,5,7],[1,5,6,7],[1,6,2,7]];
const faces=new Map<string,{nodes:number[];uses:number}>();
for(const tet of tets)for(let i=0;i<4;i++) {const nodes=tet.filter((_,j)=>i!==j),key=[...nodes].sort((a,b)=>a-b).join(',');
  const prior=faces.get(key);faces.set(key,{nodes,uses:(prior?.uses??0)+1});}
const boundary=[...faces.values()].filter(f=>f.uses===1).map(f=>f.nodes);
const text=['$MeshFormat','2.2 0 8','$EndMeshFormat','$Nodes','8',...points.map((p,i)=>[i+1,...p].join(' ')),
  '$EndNodes','$Elements',String(tets.length+boundary.length),
  ...tets.map((tet,i)=>[i+1,4,2,0,1,...tet].join(' ')),...boundary.map((f,i)=>[i+7,2,2,0,i+1,...f].join(' ')),
  '$EndElements',''].join('\n');
const mesh=parseExplicitMsh22(text,request.model.geometryDigest),admission=admitExplicitLinearMesh(request,mesh);
let checks=0;const check=(f:()=>void)=>{f();checks++;};
check(()=>assert.equal(admission.quality.nodeCount,8));check(()=>assert.equal(admission.quality.elementCount,6));
check(()=>assert.equal(admission.quality.meshMassKg,.078));check(()=>assert.equal(admission.faceMappings.fixed.areaMm2,100));
check(()=>assert.equal(admission.faceMappings.loaded.areaMm2,100));
check(()=>assert.deepEqual(admission.quality,assessExplicitC3D4Geometry(request,mesh)));
check(()=>assert.equal(assessExplicitC3D4Mesh(request,mesh).providerCharacteristicLengthMm,admission.quality.minimumCharacteristicLengthMm/9));
check(()=>assert(!/Box\(|Merge.*other/.test(EXPLICIT_LINEAR_MESH_GEO)));
for(const changed of [text.replace('2.2 0 8','2.2 1 8'),text.replace('$EndElements',''),text.replace('1 0 0 0','1 NaN 0 0'),
  text.replace('1 4 2 0 1','1 11 2 0 1'),text.replace('1 4 2 0 1','1 4 1 0 1'),text+'$Unexpected\n'])
  check(()=>assert.throws(()=>parseExplicitMsh22(changed,request.model.geometryDigest)));
for(const change of [(m:any)=>{m.nodes[1].id=m.nodes[0].id;},(m:any)=>{m.nodes[0].xyzMm[0]=Infinity;},
  (m:any)=>{const n=m.elements[0].nodes;[n[0],n[1]]=[n[1],n[0]];},(m:any)=>{m.elements[0].nodes[0]=999;},
  (m:any)=>{m.elements.push({...m.elements[0],id:999});},(m:any)=>{m.surfaceTriangles.pop();},
  (m:any)=>{m.surfaceTriangles[0].nodes=[1,2,7];},(m:any)=>{m.elements[0].type='C3D10';}]){
  const altered=structuredClone(mesh);change(altered);check(()=>assert.throws(()=>admitExplicitLinearMesh(request,altered)));
}
check(()=>assert.doesNotThrow(()=>privateExplicitMeshSchema.parse({meshId:'new',meshDigest:digest(mesh),exportId:'export',exportByteDigest:digest('step'),
  sourceBindingDigest:digest('source'),geometryDigest:request.model.geometryDigest,faceMappingDigest:admission.faceMappingDigest,
  validationDigest:admission.validationDigest,meshingRuntime:'Gmsh 4.15.2',nodeCount:8,elementCount:6,elementFormulation:'C3D4'})));
console.log(JSON.stringify({pass:true,checks,evidence:'synthetic pure mesh/parser tests only',gmshExecutions:0,solverExecutions:0}));
