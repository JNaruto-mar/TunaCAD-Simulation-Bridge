import * as z from 'zod/v4';
import type {ExplicitDynamicsDraft} from './explicitDynamicsContract.mts';
import {explicitHistorySampling} from './explicitHistorySampling.mts';
import {estimateExplicitHistoryBytes,admitExplicitHistoryResources} from './explicitHistoryResources.mts';

export const EXPLICIT_MESH_DEFAULT_SIZE_MM=10;
export const EXPLICIT_MESH_MINIMUM_SIZE_MM=.1;
export const EXPLICIT_MESH_MAXIMUM_SIZE_MM=1000;
export const EXPLICIT_MESH_MAXIMUM_NODES=100000;
export const EXPLICIT_MESH_MAXIMUM_ELEMENTS=50000;
export const explicitMeshSizeSchema=z.number().finite().min(EXPLICIT_MESH_MINIMUM_SIZE_MM).max(EXPLICIT_MESH_MAXIMUM_SIZE_MM);
function reject(why:string):never{throw Error('EXPLICIT_MESH_PREFLIGHT_REJECTED: '+why);}

/** Browser-safe planning gate, not a prediction of Gmsh topology or a promise
 * of runtime/accuracy. Bounding-box cells include thin/partly empty regions;
 * tetrahedral/boundary headroom deliberately favors rejection over admission.
 * Native quotas and exact post-mesh admission remain the hard authority.
 * Freeze this /1 formula for replay; future policies must retain old readers. */
export function estimateExplicitMeshResources(dimensionsMm:readonly number[],sizeMm=EXPLICIT_MESH_DEFAULT_SIZE_MM,
  maximumNodes=EXPLICIT_MESH_MAXIMUM_NODES,maximumElements=EXPLICIT_MESH_MAXIMUM_ELEMENTS){
  const size=explicitMeshSizeSchema.safeParse(sizeMm);
  if(!size.success)reject('Mesh size must be finite and between 0.1 and 1,000 mm.');
  if(dimensionsMm.length!==3||dimensionsMm.some(v=>!Number.isFinite(v)||v<=0||v>10000))reject('Invalid source solid bounds.');
  if(!Number.isSafeInteger(maximumNodes)||maximumNodes<4||maximumNodes>EXPLICIT_MESH_MAXIMUM_NODES
    ||!Number.isSafeInteger(maximumElements)||maximumElements<1||maximumElements>EXPLICIT_MESH_MAXIMUM_ELEMENTS)
    reject('Invalid mesh resource limits.');
  const [x,y,z]=dimensionsMm.map(v=>Math.max(1,Math.ceil(v/size.data)));
  const cells=x*y*z,boundaryCells=2*(x*y+x*z+y*z);
  const estimatedNodes=4*(x+1)*(y+1)*(z+1),estimatedElements=12*cells+4*boundaryCells;
  const estimatedRawBytes=estimatedNodes*128+estimatedElements*160+boundaryCells*2*128;
  if(![estimatedNodes,estimatedElements,estimatedRawBytes].every(Number.isSafeInteger))reject('Planning count overflow.');
  if(estimatedNodes>maximumNodes||estimatedElements>maximumElements||estimatedRawBytes>16*1024*1024)
    reject(`Mesh size ${size.data} mm exceeds planning limits (${estimatedNodes} estimated nodes / ${maximumNodes}, ${estimatedElements} estimated elements / ${maximumElements}). Choose a coarser mesh or a smaller solid.`);
  return {schema:'tunacad-explicit-mesh-resource-preflight/1' as const,
    estimateKind:'bounding_box_planning_not_a_mesh_guarantee' as const,meshSizeMm:size.data,
    estimatedNodes,estimatedElements,estimatedRawBytes,
    limits:{maximumNodes,maximumElements,maximumRawBytes:16*1024*1024},
    actualMeshAdmissionRequired:true as const,nativeResourceLimitsUnchanged:true as const};
}

/** Run on trusted source-derived requests before preparation is published and
 * again on the protected approved export BEFORE scratch/process allocation.
 * No caller-supplied estimate, budget increase, decimation or fallback mesh. */
export function preflightExplicitMesh(request:Pick<ExplicitDynamicsDraft,'model'|'mesh'|'analysis'>){
  const m=request.model,plan=estimateExplicitMeshResources([m.lengthMm,m.widthMm,m.heightMm],request.mesh.sizeMm,
    request.mesh.maximumNodes,request.mesh.maximumElements);
  const faces=m.cad?[m.cad.fixedFace,m.cad.loadedFace,...m.cad.monitoringFaces??[]]:null;
  // Count each complete FACE independently (shared nodes may make this an
  // overestimate). Actual mapping/union and normalized byte gates still apply.
  if(faces?.some(f=>!Number.isFinite(f.areaMm2)||f.areaMm2<=0))reject('Invalid selected source FACE area.');
  const estimatedHistoryNodes=faces?faces.reduce((n,f)=>n+2*Math.ceil(f.areaMm2/(plan.meshSizeMm**2))+3,0):null;
  if(estimatedHistoryNodes!==null&&(!Number.isSafeInteger(estimatedHistoryNodes)||estimatedHistoryNodes>128))
    reject(`Complete selected FACE histories exceed planning limit (${estimatedHistoryNodes} estimated nodes / 128). Coarsen the mesh or reduce monitoring FACEs; histories are never truncated.`);
  const a=request.analysis;
  if(!Number.isFinite(a.durationS)||a.durationS<=0||!Number.isFinite(a.integration.maximumTimeStepS)||a.integration.maximumTimeStepS<=0
    ||!Number.isSafeInteger(a.integration.maximumIncrements)||a.integration.maximumIncrements<2||a.integration.maximumIncrements>20000)
    reject('Invalid explicit duration/timestep resource inputs.');
  const minimumIncrements=Math.ceil(a.durationS/a.integration.maximumTimeStepS);
  if(!Number.isSafeInteger(minimumIncrements)||minimumIncrements<1||minimumIncrements>a.integration.maximumIncrements)
    reject('Mesh sizing/duration exceeds the explicit increment planning limit.');
  const maximumHistoryFrames=explicitHistorySampling(a.durationS,a.outputTimesS).maximumFrames;
  // Use the existing exact normalized-row policy with worst-width node IDs;
  // only the source-area node estimate is approximate. Never a second budget.
  const ids=estimatedHistoryNodes===null?null:Array.from({length:estimatedHistoryNodes},(_,i)=>999999999-i);
  const hasMonitors=Boolean(m.cad?.monitoringFaces?.length);
  if(ids)try{admitExplicitHistoryResources(maximumHistoryFrames,ids,hasMonitors);}
    catch{reject('Selected FACE histories and recording cadence exceed the 2 MiB planning limit. Coarsen the mesh, reduce monitors or choose fewer history intervals.');}
  return {...plan,estimatedHistoryNodes,maximumHistoryFrames,estimatedHistoryBytes:ids?estimateExplicitHistoryBytes(maximumHistoryFrames,ids,hasMonitors):null,
    minimumIncrements,maximumIncrements:a.integration.maximumIncrements,
    actualNativeStabilityAdmissionRequired:true as const};
}
