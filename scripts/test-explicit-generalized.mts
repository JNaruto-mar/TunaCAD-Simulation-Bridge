import assert from 'node:assert/strict';
import { sealExplicitDynamics } from '../simulation-bridge/explicitDynamicsFoundation.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { prepareOpenRadiossDeck,fixedNodeGroupRows } from '../providers/openradioss/OpenRadiossDeck.mts';
import { admitExplicitLinearMesh } from '../providers/gmsh/ExplicitLinearMesh.mts';
import {parseExplicitStepTopology} from '../providers/gmsh/ExplicitStepTopology.mts';
import { parseBoundedOpenRadiossTFile4 } from '../simulation-bridge/openRadiossBinaryTFileParser.mts';
import { readBoundedStarterConcentratedLoads } from '../simulation-bridge/openRadiossStarterLoads.mts';
import {admitExplicitHistoryResources} from '../providers/openradioss/OpenRadiossHistoryResource.mts';
import {recoverOpenRadiossResult} from '../providers/openradioss/OpenRadiossResult.mts';
import type { ExplicitC3D4Mesh } from '../providers/calculix/ExplicitDynamicsMeshAdmission.mts';
// Connected concave L-prism; synthetic geometry/mesh only, no CAD or solver
// execution. Non-contiguous IDs and unequal FACE populations are intentional.
const nodes=new Map<string,{id:number;xyzMm:[number,number,number]}>(),elements:ExplicitC3D4Mesh['elements']=[];
const point=(i:number,j:number,k:number)=>{
  const key=[i,j,k].join(',');if(!nodes.has(key))nodes.set(key,{id:10001+nodes.size*13,xyzMm:[i*10,j*10,k*10]});return nodes.get(key)!;
};
const patterns=[[0,1,3,7],[0,3,2,7],[0,2,6,7],[0,6,4,7],[0,4,5,7],[0,5,1,7]];
for(let i=0;i<8;i++)for(let j=0;j<8;j++)for(let k=0;k<2;k++){
  if(i>=4&&j>=4)continue;
  const p=[[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]].map(([x,y,z])=>point(i+x,j+y,k+z));
  for(const pattern of patterns){const ids=pattern.map(n=>p[n].id) as [number,number,number,number];
    const [a,b,c,d]=pattern.map(n=>p[n].xyzMm),u=b.map((x,i)=>x-a[i]),v=c.map((x,i)=>x-a[i]),w=d.map((x,i)=>x-a[i]);
    const det=(u[1]*v[2]-u[2]*v[1])*w[0]+(u[2]*v[0]-u[0]*v[2])*w[1]+(u[0]*v[1]-u[1]*v[0])*w[2];
    if(det<0)[ids[1],ids[2]]=[ids[2],ids[1]];
    elements.push({id:50001+elements.length*11,type:'C3D4',nodes:ids});
  }
}
const byId=new Map([...nodes.values()].map(n=>[n.id,n.xyzMm])),facets=new Map<string,{nodes:[number,number,number];uses:number}>();
for(const e of elements)for(let i=0;i<4;i++){
  const ids=e.nodes.filter((_,j)=>i!==j) as [number,number,number],key=[...ids].sort((a,b)=>a-b).join(',');
  facets.set(key,{nodes:ids,uses:(facets.get(key)?.uses??0)+1});
}
const tags=new Map<string,number>();
const surfaceTriangles=[...facets.values()].filter(f=>f.uses===1).map((f,i)=>{
  const p=f.nodes.map(id=>byId.get(id)!);const axis=[0,1,2].find(a=>p.every(v=>v[a]===p[0][a]));assert.notEqual(axis,undefined);
  const key=axis+':'+p[0][axis!];if(!tags.has(key))tags.set(key,tags.size+1);
  return {id:90001+i*7,nodes:f.nodes,entityTag:tags.get(key)!};
});
const geometryDigest=digest('synthetic-L-CAD');
const mesh:ExplicitC3D4Mesh={runtime:'Gmsh 4.15.2',inputGeometryDigest:geometryDigest,nodes:[...nodes.values()],elements,surfaceTriangles};
const request=sealExplicitDynamics({schema:'tunacad-explicit-dynamics-foundation/0.1',studyId:'generalized-L',
  analysis:{type:'explicit_structural_dynamics',assumptions:['one_linear_elastic_solid','small_displacement','zero_initial_conditions','undamped','no_contact','no_mass_scaling'],
    durationS:50e-6,outputTimesS:[1e-6,50e-6],integration:{kind:'central_difference_cfl_bound',minimumCharacteristicLengthMm:5,safetyFactor:.8,maximumTimeStepS:4e-7,maximumIncrements:20000}},
  model:{projectRevision:'r1',domainId:'domain',partId:'part',bodyId:'L',geometryDigest,kind:'single_solid_cad',lengthMm:80,widthMm:80,heightMm:20,fixedFaceId:'fixed',loadedFaceId:'loaded',
    cad:{volumeMm3:96000,faceCount:tags.size,boundingBoxMm:{min:[0,0,0],max:[80,80,20]},fixedFace:{centroidPartLocalMm:[0,40,10],areaMm2:1600},loadedFace:{centroidPartLocalMm:[80,20,10],areaMm2:800}}},
  material:{materialId:'elastic',domainId:'domain',model:'isotropic_linear_elastic',youngsModulusMPa:200000,poissonRatio:.3,densityKgM3:7800,source:{kind:'custom',reference:'test',revision:'1'}},
  initialConditions:{displacementMm:[0,0,0],velocityMmPerS:[0,0,0]},restraint:{kind:'fixed_face',faceId:'fixed',displacementMm:[0,0,0]},
  load:{kind:'axial_step_face_force',faceId:'loaded',onsetS:0,forceN:[100,0,0],coordinateSystem:'analysis',history:'constant_after_onset'},
  mesh:{elementFormulation:'C3D4',maximumNodes:100000,maximumElements:50000},requestedResults:['loaded_face_axial_displacement_history','fixed_face_axial_reaction_history','kinetic_energy_history','strain_energy_history','applied_work_history'],
  units:{length:'mm',time:'s',force:'N',stress:'MPa',density:'kg/m^3',velocity:'mm/s',acceleration:'mm/s^2',energy:'N*mm'}});
const admitted=admitExplicitLinearMesh(request,mesh),deck=prepareOpenRadiossDeck(request,mesh);
assert.equal(deck.expected.elementCount,576);assert.ok(Math.abs(admitted.quality.totalVolumeMm3/96000-1)<1e-12);
assert.equal(deck.expected.fixedNodeIds.length,27);assert.equal(deck.expected.loadedNodeIds.length,15);
assert.equal(deck.expected.loads.reduce((s,n)=>s+n.forceN,0),100);
assert.ok(fixedNodeGroupRows(deck.expected.fixedNodeIds).every(row=>row.length<=100));
assert.equal(deck.faceMappingDigest,admitted.faceMappingDigest);
// A rotated/translated concave solid has neither an origin assumption nor
// fixed/load X-end planes. Preserve the same approved +X force component.
const moved=structuredClone(mesh),movedDraft=structuredClone(request);
delete (movedDraft as any).requestDigest;
movedDraft.model.geometryDigest=digest('rotated-translated-L');
moved.inputGeometryDigest=movedDraft.model.geometryDigest;
moved.nodes.forEach(n=>{const [x,y,z]=n.xyzMm;n.xyzMm=[50-y,20+x,5+z];});
movedDraft.model.cad!.boundingBoxMm={min:[-30,20,5],max:[50,100,25]};
movedDraft.model.cad!.fixedFace.centroidPartLocalMm=[10,20,15];
movedDraft.model.cad!.loadedFace.centroidPartLocalMm=[30,100,15];
const movedDeck=prepareOpenRadiossDeck(sealExplicitDynamics(movedDraft),moved);
assert.deepEqual(movedDeck.expected.historyNodeIds,deck.expected.historyNodeIds);
assert.equal(movedDeck.expected.loads.reduce((sum,n)=>sum+n.forceN,0),100);
// Distinct tetrahedron FACEs necessarily share an edge. Keep both memberships
// and emit one history per node; no artificial opposing-end requirement.
const tetraMesh:ExplicitC3D4Mesh={runtime:'Gmsh 4.15.2',inputGeometryDigest:digest('tetra-cad'),
  nodes:[{id:1,xyzMm:[0,0,0]},{id:2,xyzMm:[10,0,0]},{id:3,xyzMm:[0,10,0]},{id:4,xyzMm:[0,0,10]}],
  elements:[{id:71,type:'C3D4',nodes:[1,2,3,4]}],
  surfaceTriangles:[[1,2,3],[1,3,4],[1,2,4],[2,3,4]].map((nodes,i)=>({id:100+i,entityTag:i+1,nodes:nodes as [number,number,number]}))};
const tetraDraft=structuredClone(request);delete (tetraDraft as any).requestDigest;
Object.assign(tetraDraft.model,{geometryDigest:tetraMesh.inputGeometryDigest,bodyId:'tetra',lengthMm:10,widthMm:10,heightMm:10,
  cad:{volumeMm3:1000/6,faceCount:4,boundingBoxMm:{min:[0,0,0],max:[10,10,10]},
    fixedFace:{centroidPartLocalMm:[10/3,10/3,0],areaMm2:50},loadedFace:{centroidPartLocalMm:[0,10/3,10/3],areaMm2:50}}});
const tetraDeck=prepareOpenRadiossDeck(sealExplicitDynamics(tetraDraft),tetraMesh);
// New topology path: exact B-Rep measures establish identity independently of
// triangle area. A curved trimming edge makes exact and chord areas differ.
const exactMesh=structuredClone(tetraMesh),exactDraft=structuredClone(tetraDraft);delete (exactDraft as any).requestDigest;
const pairs=[[1,2],[2,3],[3,1],[1,4],[3,4],[2,4]] as [number,number][];
const xyz=new Map(exactMesh.nodes.map(n=>[n.id,n.xyzMm]));
const curves=pairs.map(([a,b],i)=>{const p=xyz.get(a)!,q=xyz.get(b)!;return {tag:i+1,lengthMm:i===0?10.5:Math.hypot(...p.map((v,k)=>v-q[k])),
 centroidPartLocalMm:p.map((v,k)=>(v+q[k])/2) as [number,number,number],boundingBoxMm:{min:p.map((v,k)=>Math.min(v,q[k])) as [number,number,number],max:p.map((v,k)=>Math.max(v,q[k])) as [number,number,number]}};});
const surfaces=exactMesh.surfaceTriangles.map(f=>{const p=f.nodes.map(n=>xyz.get(n)!);return {tag:f.entityTag!,areaMm2:f.entityTag===1?50/1.01295:f.entityTag===4?Math.sqrt(3)*50:50,
 centroidPartLocalMm:p[0].map((_,k)=>p.reduce((s,v)=>s+v[k],0)/3) as [number,number,number],boundingBoxMm:{min:p[0].map((_,k)=>Math.min(...p.map(v=>v[k]))) as [number,number,number],max:p[0].map((_,k)=>Math.max(...p.map(v=>v[k]))) as [number,number,number]},
 boundaryCurveTags:pairs.flatMap(([a,b],i)=>f.nodes.includes(a)&&f.nodes.includes(b)?[i+1]:[])};});
const topology={schema:'tunacad-explicit-step-topology/1' as const,surfaces,curves};
const metadata=['EXPLICIT_STEP_TOPOLOGY_V1 '+surfaces.length+' '+curves.length,
 ...surfaces.flatMap(s=>['F '+[s.tag,s.areaMm2,...s.centroidPartLocalMm,...s.boundingBoxMm.min,...s.boundingBoxMm.max].join(' '),...s.boundaryCurveTags.map(t=>'B '+s.tag+' '+t)]),
 ...curves.map(c=>'C '+[c.tag,c.lengthMm,...c.centroidPartLocalMm,...c.boundingBoxMm.min,...c.boundingBoxMm.max].join(' ')),'END'].join('\n');
assert.deepEqual(parseExplicitStepTopology(metadata),topology);
for(const text of [metadata.replace(/\nEND$/,''),metadata.replace('EXPLICIT_STEP_TOPOLOGY_V1 4 6','EXPLICIT_STEP_TOPOLOGY_V1 4 5'),
 metadata.replace('F 1 ','F NaN '),metadata.replace('B 1 1','B 1 999'),metadata.replace('C 6 ','C 1 '),metadata+'\nF 1'])assert.throws(()=>parseExplicitStepTopology(text));
exactMesh.curveSegments=pairs.map((nodes,i)=>({id:200+i,nodes,entityTag:i+1}));
exactMesh.cadEvidence={topology,stepByteDigest:digest('STEP'),metadataDigest:digest('exact-topology')};
Object.assign(exactDraft.model.cad!,{mappingMethod:'exact-step-boundary-v1',fixedFace:{...surfaces[0],topology:{boundingBoxMm:surfaces[0].boundingBoxMm,boundaryCurves:surfaces[0].boundaryCurveTags.map(t=>({centroidPartLocalMm:curves[t-1].centroidPartLocalMm,lengthMm:curves[t-1].lengthMm})),surfaceKind:'plane',plane:{origin:[0,0,0],normal:[0,0,1]}}},
 loadedFace:{...surfaces[1],topology:{boundingBoxMm:surfaces[1].boundingBoxMm,boundaryCurves:surfaces[1].boundaryCurveTags.map(t=>({centroidPartLocalMm:curves[t-1].centroidPartLocalMm,lengthMm:curves[t-1].lengthMm})),surfaceKind:'plane',plane:{origin:[0,0,0],normal:[1,0,0]}}}});
for(const name of ['fixedFace','loadedFace']){const f=(exactDraft.model.cad as any)[name];delete f.tag;delete f.boundaryCurveTags;delete f.boundingBoxMm;}
const exactRequest=sealExplicitDynamics(exactDraft),exact=admitExplicitLinearMesh(exactRequest,exactMesh);
assert.equal(exact.faceMappings.fixed.entityTag,1);assert.ok((exact.faceMappings.fixed as any).approximation.relativeAreaDifference>.005);
for(const mutate of [(m:ExplicitC3D4Mesh)=>delete m.cadEvidence,(m:ExplicitC3D4Mesh)=>m.curveSegments!.shift(),
 (m:ExplicitC3D4Mesh)=>m.curveSegments!.push(m.curveSegments![0]),(m:ExplicitC3D4Mesh)=>m.cadEvidence!.topology.surfaces[0].boundaryCurveTags.pop(),
 (m:ExplicitC3D4Mesh)=>m.cadEvidence!.topology.surfaces[0].areaMm2*=2,(m:ExplicitC3D4Mesh)=>m.cadEvidence!.topology.curves[0].lengthMm*=2,
 (m:ExplicitC3D4Mesh)=>m.surfaceTriangles[0].entityTag=2,(m:ExplicitC3D4Mesh)=>m.nodes[0].xyzMm[2]=.1]){
 const bad=structuredClone(exactMesh);mutate(bad);assert.throws(()=>admitExplicitLinearMesh(exactRequest,bad));
}
const weak=structuredClone(exactMesh),weakDraft=structuredClone(exactDraft);delete (weakDraft as any).requestDigest;
weak.cadEvidence!.topology.curves[0].lengthMm=30;weakDraft.model.cad!.fixedFace.topology!.boundaryCurves[0].lengthMm=30;
assert.throws(()=>admitExplicitLinearMesh(sealExplicitDynamics(weakDraft),weak),/refinement required/);
const reordered=structuredClone(exactMesh);reordered.cadEvidence!.topology.surfaces.reverse();reordered.cadEvidence!.topology.curves.reverse();reordered.curveSegments!.reverse();
assert.equal(admitExplicitLinearMesh(exactRequest,reordered).faceMappingDigest,exact.faceMappingDigest);
assert.deepEqual(tetraDeck.expected.fixedNodeIds,[1,2,3]);assert.deepEqual(tetraDeck.expected.loadedNodeIds,[1,3,4]);
assert.deepEqual(tetraDeck.expected.historyNodeIds,[1,2,3,4]);assert.equal(tetraDeck.expected.loads.length,3);
// A third CAD FACE is a monitoring choice, not a load or restraint. Adjacent
// surfaces share nodes; native TH cards emit the exact union once.
const monitoredDraft=structuredClone(exactDraft),third=surfaces[2];
monitoredDraft.model.cad!.monitoringFaces=[{referenceId:'monitor-side',areaMm2:third.areaMm2,centroidPartLocalMm:third.centroidPartLocalMm,
 topology:{boundingBoxMm:third.boundingBoxMm,boundaryCurves:third.boundaryCurveTags.map(t=>({centroidPartLocalMm:curves[t-1].centroidPartLocalMm,lengthMm:curves[t-1].lengthMm})),
 surfaceKind:'plane',plane:{origin:[0,0,0],normal:[0,1,0]}}}];
const exactDeck=prepareOpenRadiossDeck(exactRequest,exactMesh);
const monitoredRequest=sealExplicitDynamics(monitoredDraft),monitoredDeck=prepareOpenRadiossDeck(monitoredRequest,exactMesh);
assert.deepEqual(monitoredDeck.expected.monitoringFaces,[{referenceId:'monitor-side',nodeIds:[1,2,4]}]);
assert.deepEqual(monitoredDeck.expected.historyNodeIds,[1,2,3,4]);
assert.deepEqual(monitoredDeck.expected.loads,exactDeck.expected.loads);assert.deepEqual(monitoredDeck.expected.fixedNodeIds,exactDeck.expected.fixedNodeIds);
assert.notEqual(monitoredDeck.faceMappingDigest,exact.faceMappingDigest);
const duplicateMonitor=structuredClone(monitoredDraft);
duplicateMonitor.model.cad!.monitoringFaces!.push({...duplicateMonitor.model.cad!.monitoringFaces![0],referenceId:'alias'});
assert.throws(()=>prepareOpenRadiossDeck(sealExplicitDynamics(duplicateMonitor),exactMesh),/Aliased monitoring/);
const missingMonitor=structuredClone(monitoredDraft);missingMonitor.model.cad!.monitoringFaces![0].areaMm2*=2;
assert.throws(()=>prepareOpenRadiossDeck(sealExplicitDynamics(missingMonitor),exactMesh));
const unsupportedMonitor=structuredClone(monitoredDraft);delete unsupportedMonitor.model.cad!.monitoringFaces![0].topology;
assert.throws(()=>sealExplicitDynamics(unsupportedMonitor));
const monitorIds=Array.from({length:128},(_,i)=>10001+i*13);
admitExplicitHistoryResources(2,monitorIds,true);
assert.throws(()=>admitExplicitHistoryResources(2,[...monitorIds,999999999],true),/128 nodes/);
assert.throws(()=>admitExplicitHistoryResources(64,monitorIds,true),/normalized result resource bound/);
// Refine the edge between nodes 2/4: the new node belongs to the third FACE,
// neither the loaded nor fixed FACE. B-Rep identity itself is unchanged.
const monitorMesh=structuredClone(exactMesh),monitorNativeDraft=structuredClone(monitoredDraft);
monitorMesh.nodes.push({id:503,xyzMm:[5,0,5]});
monitorMesh.elements=[{id:71,type:'C3D4',nodes:[1,2,3,503]},{id:83,type:'C3D4',nodes:[1,503,3,4]}];
monitorMesh.surfaceTriangles=[...monitorMesh.surfaceTriangles.slice(0,2),
 {id:102,entityTag:3,nodes:[1,2,503]},{id:112,entityTag:3,nodes:[1,503,4]},
 {id:103,entityTag:4,nodes:[2,3,503]},{id:113,entityTag:4,nodes:[503,3,4]}];
monitorMesh.curveSegments=monitorMesh.curveSegments!.filter(s=>s.entityTag!==6);
monitorMesh.curveSegments.push({id:205,nodes:[2,503],entityTag:6},{id:215,nodes:[503,4],entityTag:6});
monitorNativeDraft.analysis.durationS=5e-6;monitorNativeDraft.analysis.outputTimesS=[2.5e-6,5e-6];
const monitorNativeDeck=prepareOpenRadiossDeck(sealExplicitDynamics(monitorNativeDraft),monitorMesh);
assert.deepEqual(monitorNativeDeck.expected.historyNodeIds,[1,2,3,4,503]);
assert.deepEqual(monitorNativeDeck.expected.monitoringFaces,[{referenceId:'monitor-side',nodeIds:[1,2,4,503]}]);
assert.deepEqual(monitorNativeDeck.expected.loads,exactDeck.expected.loads);
const listing='NCONLD: NUMBER OF CONCENTRATED LOADS 15\nCONCENTRATED LOADS\n------------------\nNODE SKEW DIR LOAD_CURVE SENSOR SCALE_X SCALE_Y\n'+deck.expected.loads.map(n=>`${n.id} 0 X 1 0 1 ${n.forceN}`).join('\n')+'\nSPMD IS CHECKING FOR ELEMENT DELETION IN :\n';
assert.equal(readBoundedStarterConcentratedLoads(listing,deck.expected.loads).resultantN,100);
assert.throws(()=>readBoundedStarterConcentratedLoads(listing.replace(/\n\d+ 0 X 1 0 1 [^\n]+/,'\n'),deck.expected.loads));
for(const mutate of [(m:ExplicitC3D4Mesh)=>m.surfaceTriangles.pop(),(m:ExplicitC3D4Mesh)=>m.elements.push(m.elements[0]),
  (m:ExplicitC3D4Mesh)=>m.nodes[0].xyzMm[0]=NaN,(m:ExplicitC3D4Mesh)=>m.surfaceTriangles.forEach(f=>f.entityTag=1)]){
  const bad=structuredClone(mesh);mutate(bad);assert.throws(()=>admitExplicitLinearMesh(request,bad));
}
const badCad=structuredClone(request);badCad.model.cad!.loadedFace=badCad.model.cad!.fixedFace;delete (badCad as any).requestDigest;
assert.throws(()=>prepareOpenRadiossDeck(sealExplicitDynamics(badCad),mesh));
// Published big-endian Fortran record schema; dynamic entities, same exact
// THICODE-specific layouts/channels as the frozen direct-reader fixtures.
const ints=(values:number[])=>{const b=Buffer.alloc(values.length*4);values.forEach((v,i)=>b.writeInt32BE(v,i*4));return b;};
const reals=(values:number[])=>{const b=Buffer.alloc(values.length*4);values.forEach((v,i)=>b.writeFloatBE(v,i*4));return b;};
const title=(s:string,n:number)=>Buffer.from(s.padEnd(n));
const concat=(rows:Buffer[])=>Buffer.concat(rows.map(b=>Uint8Array.from(b)));
const record=(b:Buffer)=>concat([ints([b.length]),b,ints([b.length])]);
function binary(version:number,bounded=deck,validRecovery=false){const w=version===3040?40:100,t=(s:string)=>title(s,w),ids=bounded.expected.historyNodeIds;
  const rows=[concat([ints([version]),title('Explicit',80)]),title('2026',80),...(version===3040?[]:[ints([2]),ints([100]),reals([1,1,1])]),
    ints([1,2,1,1,1,22]),ints(Array.from({length:22},(_,i)=>i+1)),concat([ints([1]),t('One elastic bar'),ints([0,1,1,0])]),
    concat([ints([1]),t('Elastic')]),concat([ints([0]),t('none')]),concat([ints([1]),t('Tetra')]),concat([ints([0,0,0,1,0]),t('global')]),ints([1]),
    concat([ints([1,0,0,ids.length,4]),t('Bounded axial bar nodes')]),...ids.map(id=>concat([ints([id]),t('node_'+id)])),ints([1,4,7,620])];
  for(const time of validRecovery?[0,2.7e-6]:[0,3e-6]){const g=Array(22).fill(0);g[5]=bounded.expected.massMg;
    if(validRecovery)g[6]=3e-7;
    rows.push(reals([time]),reals(g),reals(ids.flatMap(id=>validRecovery?
      bounded.expected.fixedNodeIds.includes(id)?[0,0,0,100*time]:[time,time?1:0,time?2:0,0]:[time,1,2,100*time])));}
  return concat(rows.map(record));
}
for(const version of [3040,4021]){
  const bytes=binary(version),parsed=parseBoundedOpenRadiossTFile4(bytes,3e-6,undefined,{nodeCount:mesh.nodes.length,elementCount:elements.length},deck.expected.historyNodeIds);
  assert.equal(parsed.frames[0].nodes.size,42);assert.equal(parsed.frames.length,2);assert.equal(parsed.thicode,version);
  assert.ok(Math.abs(parsed.frames[1].nodes.values().next().value!.reactionForceN-100)<1e-4);
  assert.throws(()=>parseBoundedOpenRadiossTFile4(bytes,3e-6),/expected node/);
  assert.throws(()=>parseBoundedOpenRadiossTFile4(bytes.subarray(0,-1),3e-6,undefined,{nodeCount:mesh.nodes.length,elementCount:elements.length},deck.expected.historyNodeIds),/truncated/);
  assert.throws(()=>parseBoundedOpenRadiossTFile4(bytes,3e-6,undefined,{nodeCount:mesh.nodes.length,elementCount:elements.length},[...deck.expected.historyNodeIds].reverse()),/node/);
  const four=parseBoundedOpenRadiossTFile4(binary(version,tetraDeck),3e-6,undefined,{nodeCount:4,elementCount:1},tetraDeck.expected.historyNodeIds);
  assert.equal(four.frames[0].nodes.size,4);
  const monitoredBinary=parseBoundedOpenRadiossTFile4(binary(version,monitoredDeck),3e-6,undefined,{nodeCount:4,elementCount:1},monitoredDeck.expected.historyNodeIds);
  assert.deepEqual([...monitoredBinary.frames[0].nodes.keys()],monitoredDeck.expected.historyNodeIds);
  const scientific=(v:number)=>v.toExponential(4).replace(/e([+-])(\d)$/,(_,sign,n)=>'E'+sign+'0'+n).toUpperCase();
  const listing='TOTAL NUMBER OF CYCLES : 17\nNORMAL TERMINATION';
  const trace=Array.from({length:17},(_,i)=>`NC= ${i} T= ${scientific(i*3e-7)} DT= 3.0000E-07 ERR= 0% DM/M= 0`).join('\n')+'\n'+listing;
  const recovered=recoverOpenRadiossResult(monitorNativeDeck,binary(version,monitorNativeDeck,true),trace,listing,
    {providerRunId:'synthetic-monitor',providerId:'fixture',providerVersion:'0.1',runtimeDigest:digest('runtime'),artifacts:{},provenanceDigest:digest('synthetic')});
  assert.equal(recovered.sampling.scope,'selected_FACE_nodes');assert.equal(recovered.frames[1].nodes.find(n=>n.nodeId===503)!.face,'monitor');
  assert.deepEqual(recovered.sampling.monitoringFaces,monitorNativeDeck.expected.monitoringFaces);
  assert.ok(recovered.frames[1].nodes.find(n=>n.nodeId===503)!.displacementMm>0);
  assert.equal(recovered.frames[1].supportImpulseNs,recovered.frames[1].nodes.filter(n=>monitorNativeDeck.expected.fixedNodeIds.includes(n.nodeId)).reduce((s,n)=>s+n.reactionImpulseNs,0));
}
console.log('PASS exact STEP topology identity, >0.5% bounded trimming approximation, malformed/missing/ambiguous topology and insufficient-resolution rejection; legacy concave, rotated/translated and adjacent-FACE compatibility, 576 tetrahedra/42 nonhistorical IDs, strict 3040/4021 recovery. Solver executions: 0.');
