import { validateExplicitDynamics } from '../../simulation-bridge/explicitDynamicsFoundation.mts';
import { digest } from '../../simulation-bridge/stableDigest.mts';
import { beginBlock, bcsBlock, solidTetra4Block, fixedField, RADIOSSS_FIELD_RULER }
  from '../../simulation-bridge/openRadiossStarterSerialization.mts';
import type { ExplicitC3D4Mesh } from '../calculix/ExplicitDynamicsMeshAdmission.mts';
import { admitExplicitLinearMesh } from '../gmsh/ExplicitLinearMesh.mts';
import {serializeExplicitFaceLoads} from './OpenRadiossFaceLoads.mts';
import {estimateExplicitHistoryBytes,EXPLICIT_NORMALIZED_RESULT_MAXIMUM_BYTES} from './OpenRadiossHistoryResource.mts';
import {explicitLoadHistoryPoints,assertExplicitLoadResolution,explicitLoadHistoryOnset} from '../../simulation-bridge/explicitLoadHistory.mts';

export const RUN_NAME = 'ExplicitBarProbe'; // Fixed safe file root; per-run directories isolate jobs.
const fail = (why:string):never => { throw new Error('OpenRadioss admission: '+why); };
const sub = (a:number[],b:number[])=>a.map((x,i)=>x-b[i]);
const cross = (a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const area = (p:number[][])=>Math.hypot(...cross(sub(p[1],p[0]),sub(p[2],p[0])))/2;
const real = (v:number)=>fixedField(v.toExponential(12),20);

/** Actual mesh inspection only. Never imports/evaluates CalculiX's CFL or an
 * axial qualification oracle. Histories include all nodes on the two admitted
 * semantic FACEs. Native CAD topology owns the single-solid geometry. */
export function prepareOpenRadiossDeck(value:unknown, meshValue:unknown) {
  const request=validateExplicitDynamics(value), mesh=meshValue as ExplicitC3D4Mesh;
  if(!mesh || mesh.runtime!=='Gmsh 4.15.2' || mesh.inputGeometryDigest!==request.model.geometryDigest ||
    !Array.isArray(mesh.nodes) || !Array.isArray(mesh.elements) || !Array.isArray(mesh.surfaceTriangles) ||
    mesh.nodes.length<4 || mesh.elements.length<1 || mesh.surfaceTriangles.length>4*mesh.elements.length ||
    mesh.nodes.length>request.mesh.maximumNodes || mesh.elements.length>request.mesh.maximumElements)
    fail('unsupported trusted mesh layout/source/resource bound');
  // Reuse full connected-solid/boundary/CAD ownership admission, not CalculiX
  // CFL. This rejects disconnected/nonmanifold topology even with valid counts.
  const admission=admitExplicitLinearMesh(request,mesh);
  const nodes=new Map<number,[number,number,number]>();
  for(const n of mesh.nodes) {
    if(!Number.isSafeInteger(n.id) || n.id<1 || n.id>999999999 || nodes.has(n.id) ||
      !Array.isArray(n.xyzMm) || n.xyzMm.length!==3 || n.xyzMm.some(x=>!Number.isFinite(x)) ||
      n.xyzMm.some((x,i)=>x < (request.model.cad?.boundingBoxMm.min[i]??0)-1e-7 || x > (request.model.cad?.boundingBoxMm.max[i]??[request.model.lengthMm,request.model.widthMm,request.model.heightMm][i])+1e-7))
      fail('invalid node identity/coordinate or source bounds');
    nodes.set(n.id,n.xyzMm);
  }
  const facets=new Map<string,{ids:number[];uses:number}>(), elementIds=new Set<number>(), keys=new Set<string>();
  const masses=new Map([...nodes.keys()].map(id=>[id,0]));
  let volume=0, minimumAltitudeMm=Infinity;
  for(const e of [...mesh.elements].sort((a,b)=>a.id-b.id)) {
    if(e.type!=='C3D4' || !Number.isSafeInteger(e.id) || e.id<1 || e.id>999999999 || elementIds.has(e.id) ||
      !Array.isArray(e.nodes) || e.nodes.length!==4 || new Set(e.nodes).size!==4 || e.nodes.some(id=>!nodes.has(id)))
      fail('unsupported/degenerate/duplicate tetra identity');
    elementIds.add(e.id); const key=[...e.nodes].sort((a,b)=>a-b).join(',');
    if(keys.has(key)) fail('duplicate tetra connectivity'); keys.add(key);
    const [a,b,c,d]=e.nodes.map(id=>nodes.get(id)!);
    const v=cross(sub(b,a),sub(c,a)).reduce((s,x,i)=>s+x*(d[i]-a[i]),0)/6;
    if(!Number.isFinite(v) || v<=1e-9) fail('nonpositive/degenerate Jacobian');
    volume+=v;
    let maxArea=0;
    for(let k=0;k<4;k++) {
      const ids=e.nodes.filter((_,i)=>i!==k), key=[...ids].sort((a,b)=>a-b).join(',');
      maxArea=Math.max(maxArea,area(ids.map(id=>nodes.get(id)!)));
      const old=facets.get(key); facets.set(key,{ids,uses:(old?.uses??0)+1});
    }
    minimumAltitudeMm=Math.min(minimumAltitudeMm,3*v/maxArea);
    e.nodes.forEach(id=>masses.set(id,masses.get(id)!+v*request.material.densityKgM3*1e-9/4));
  }
  if(minimumAltitudeMm<0.01 || !Number.isFinite(minimumAltitudeMm) ||
    [...masses.values()].some(v=>!Number.isFinite(v)||v<=0) || [...facets.values()].some(f=>f.uses>2)) fail('invalid mesh quality/mass/topology');
  const expectedVolume=admission.quality.totalVolumeMm3;
  if(Math.abs(volume-expectedVolume)>expectedVolume*1e-5) fail('mesh/source volume mismatch');
  const boundary=[...facets.entries()].filter(([,f])=>f.uses===1), supplied=new Set<string>();
  for(const f of mesh.surfaceTriangles) {
    if(!Array.isArray(f.nodes)||f.nodes.length!==3||new Set(f.nodes).size!==3) fail('invalid boundary facet');
    const key=[...f.nodes].sort((a,b)=>a-b).join(',');
    if(supplied.has(key)||facets.get(key)?.uses!==1) fail('duplicate/unowned boundary facet'); supplied.add(key);
  }
  if(supplied.size!==boundary.length) fail('missing boundary facets');
  const face=(x:number,mapping:typeof admission.faceMappings.fixed)=>{
    const expected=mapping.nodeIds;
    const keys=mapping.facetIndices?new Set(mapping.facetIndices.map(i=>[...mesh.surfaceTriangles[i].nodes].sort((a,b)=>a-b).join(','))):null;
    const matched=boundary.filter(([key,f])=>keys?keys.has(key):f.ids.every(id=>Math.abs(nodes.get(id)![0]-x)<=1e-7));
    const ids=[...new Set(matched.flatMap(([,f])=>f.ids))].sort((a,b)=>a-b);
    if(ids.join(',')!==expected.join(',')) fail('unsupported/mismatched FACE node ownership');
    const weights=new Map(ids.map(id=>[id,0])); let totalArea=0;
    for(const [,f] of matched) {const a=area(f.ids.map(id=>nodes.get(id)!)); totalArea+=a;
      f.ids.forEach(id=>weights.set(id,weights.get(id)!+a/3));}
    if(Math.abs(totalArea-mapping.areaMm2)>totalArea*1e-6) fail('incomplete FACE area');
    return {nodeIds:ids,areaMm2:totalArea,weights};
  };
  const fixed=face(0,admission.faceMappings.fixed), loaded=face(request.model.lengthMm,admission.faceMappings.loaded), force=request.load.forceN[0];
  // A CAD edge can belong to both distinct FACEs. Such nodes receive their
  // load share AND their restraint; raw histories are emitted once per node.
  const historyNodeIds=[...new Set([...fixed.nodeIds,...loaded.nodeIds])].sort((a,b)=>a-b);
  let preceding=0;
  const exactLoads=request.model.cad?.mappingMethod==='exact-step-boundary-v1'?serializeExplicitFaceLoads(loaded.nodeIds,loaded.weights,loaded.areaMm2,force):null;
  const loads=exactLoads?exactLoads.map(({id,forceN,forceText})=>({id,forceN,forceText})):loaded.nodeIds.map((id,i)=>{const forceN=Number((i===loaded.nodeIds.length-1?force-preceding:force*loaded.weights.get(id)!/loaded.areaMm2).toExponential(12));
    preceding+=forceN; if(forceN<=0) fail('invalid load weight'); return {id,forceN};});
  if(!exactLoads&&Math.abs(preceding-force)>=1e-12) fail('serialized load resultant mismatch');
  // Resolve a bounded uniform cadence from requested spacing. Actual requested
  // sample identities retain their true timestamps; never fabricate exact frames.
  const times=[0,...request.analysis.outputTimesS];
  const historyIntervalS=Math.min(...times.slice(1).map((t,i)=>t-times[i]));
  if(Math.ceil(request.analysis.durationS/historyIntervalS)+1>64) fail('history resource bound');
  assertExplicitLoadResolution(request.load.history,request.analysis.durationS,historyIntervalS);
  const loadPoints=explicitLoadHistoryPoints(request.load.history,request.analysis.durationS);
  // Native cycles can cross the requested end. Constant terminal extension
  // prevents FUNCT extrapolation above peak or below zero, without changing RUN.
  const last=loadPoints.at(-1)!;
  if(last[1]!==loadPoints.at(-2)![1])loadPoints.push([last[0]+request.analysis.durationS,last[1]]);
  const loadOnsetS=explicitLoadHistoryOnset(request.load.history),loadSensorId:0|1=loadOnsetS>0?1:0;
  if(loadOnsetS>0&&Number(real(loadOnsetS))<=0)fail('unrepresentable load onset');
  // Fail closed if fixed-width serialization collapses distinct phase times.
  if(loadPoints.some(([t],i)=>i>0&&Number(real(t))<=Number(real(loadPoints[i-1][0]))))fail('unrepresentable load-history timing');
  // Existing 8 MiB binary and 2 MiB normalized/durable limits, reserved before
  // dispatch. No partial FACE sampling or silently dropped history is allowed.
  const frames=Math.ceil(request.analysis.durationS/historyIntervalS)+1;
  if(historyNodeIds.length>128 || estimateExplicitHistoryBytes(frames,historyNodeIds)>EXPLICIT_NORMALIZED_RESULT_MAXIMUM_BYTES)
    fail('complete FACE histories exceed normalized result resource bound');
  const densityMgPerMm3=request.material.densityKgM3/1e12;
  const starter=['#RADIOSS STARTER',RADIOSSS_FIELD_RULER,...beginBlock(RUN_NAME),'/NODE'];
  for(const [id,xyz] of [...nodes].sort((a,b)=>a[0]-b[0])) starter.push(fixedField(id,10)+xyz.map(real).join(''));
  starter.push('/TETRA4/1');
  for(const e of [...mesh.elements].sort((a,b)=>a.id-b.id)) starter.push([e.id,...e.nodes].map(v=>fixedField(v,10)).join(''));
  starter.push('/MAT/LAW1/1','Steel elastic',real(densityMgPerMm3),real(request.material.youngsModulusMPa)+real(request.material.poissonRatio),
    ...solidTetra4Block(),'/PART/1','One elastic bar',fixedField(1,10)+fixedField(1,10),
    '/GRNOD/NODE/1','Fixed x min',...fixedNodeGroupRows(fixed.nodeIds),...bcsBlock(1),
    ...(loadSensorId?['/SENSOR/TIME/1','Approved load onset',real(loadOnsetS),'']:[]),
    '/FUNCT/1',request.load.history==='constant_after_onset'?'Axial step from t zero':'Approved axial load history',
    ...loadPoints.map(([time,factor])=>real(time)+real(factor)));
  loads.forEach(({id,forceN},i)=>{const group=10+i;
    starter.push(`/GRNOD/NODE/${group}`,`Load node ${id}`,fixedField(id,10),`/CLOAD/${group}`,`Axial force on ${id}`,
      fixedField(1,10)+fixedField('X',10)+[0,loadSensorId,group,0].map(v=>fixedField(v,10)).join('')+real(1)+(exactLoads?fixedField(exactLoads[i].forceText,20):real(forceN)));});
  starter.push('/TH/NODE/1','Bounded axial bar nodes',['DX','VX','AX','REACX'].map(v=>v.padEnd(10)).join(''));
  for(const id of request.model.kind==='straight_rectangular_axial_bar'?[...fixed.nodeIds,...loaded.nodeIds]:historyNodeIds)
    starter.push(fixedField(id,10)+fixedField(0,10)+`node_${id}`);
  starter.push('/END','');
  const engine=[`/RUN/${RUN_NAME}/1`,real(request.analysis.durationS),'/VERS/2026','/DT/NODA',real(0.6)+real(0),
    '/TFILE/4',real(historyIntervalS),'/PRINT/-1',''].join('\n');
  const starterText=starter.join('\n');
  if(/\/(?:AMS|ADMAS|DAMP|DYREL|KEREL|INTER|INIVEL|IMPLICIT|DT\/[^\r\n]*\/(?:CST|AMS|DEL|SET))/i.test(starterText+engine)) fail('forbidden physics/mass-scaling card');
  return {request,meshDigest:digest(mesh),faceMappingDigest:admission.faceMappingDigest,starter:starterText,engine,historyIntervalS,dtNodaScale:0.6,
    expected:{nodeCount:nodes.size,elementCount:elementIds.size,densityMgPerMm3,massMg:volume*densityMgPerMm3,
      E:request.material.youngsModulusMPa,nu:request.material.poissonRatio,loads,forceN:force,loadOnsetS,loadSensorId,
      fixedNodeIds:fixed.nodeIds,loadedNodeIds:loaded.nodeIds,historyNodeIds,minimumAltitudeMm}};
}
/** Radioss node groups contain at most ten fixed-width IDs on each row. */
export function fixedNodeGroupRows(ids:readonly number[]) {
  return Array.from({length:Math.ceil(ids.length/10)},(_,i)=>ids.slice(i*10,i*10+10).map(v=>fixedField(v,10)).join(''));
}
export type PreparedOpenRadioss = ReturnType<typeof prepareOpenRadiossDeck>;
