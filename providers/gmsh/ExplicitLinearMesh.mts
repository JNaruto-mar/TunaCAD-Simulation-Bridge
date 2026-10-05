import type { ExplicitC3D4Mesh } from '../calculix/ExplicitDynamicsMeshAdmission.mts';
import { assessExplicitC3D4Geometry } from '../calculix/ExplicitDynamicsMeshAdmission.mts';
import { validateExplicitDynamics } from '../../simulation-bridge/explicitDynamicsFoundation.mts';
import { digest } from '../../simulation-bridge/stableDigest.mts';
import { mapExplicitCadFaces } from './ExplicitCadFaceMapping.mts';
import {EXPLICIT_STEP_TOPOLOGY_GEO} from './ExplicitStepTopology.mts';
import type {ExplicitDynamicsRequest} from '../../simulation-bridge/explicitDynamicsContract.mts';

export const EXPLICIT_LINEAR_MESH_CONFIGURATION = Object.freeze({ schema: 'tunacad-explicit-gmsh-config/1',
  meshSizeMm: 10, elementOrder: 1, mshVersion: '2.2_ascii', threads: 1, maximumRawBytes: 16 * 1024 * 1024,
  cpuTimeLimitMs: 30000, memoryLimitBytes: 512 * 1024 * 1024 });
export const EXPLICIT_LINEAR_MESH_GEO = `SetFactory("OpenCASCADE");
Merge "approved.step";
Mesh.MeshSizeMin = 10;
Mesh.MeshSizeMax = 10;
Mesh.ElementOrder = 1;
Mesh.MshFileVersion = 2.2;
Mesh.Binary = 0;
Mesh.RandomSeed = 1;
General.NumThreads = 1;
`;
export function explicitMeshGeo(request:ExplicitDynamicsRequest){return EXPLICIT_LINEAR_MESH_GEO+(request.model.cad?.mappingMethod?EXPLICIT_STEP_TOPOLOGY_GEO:'');}
export function explicitMeshConfigurationDigest(request:ExplicitDynamicsRequest){return digest({configuration:EXPLICIT_LINEAR_MESH_CONFIGURATION,geo:explicitMeshGeo(request)});}
function invalid(reason: string): never { throw new Error('EXPLICIT_GMSH_MESH_INVALID: ' + reason); }

/** Explicit ASCII MSH 2.2 schema. No offset guessing, C3D10 fallback or synthetic
 * geometry generation. Only one geometric volume and complete boundary facets. */
export function parseExplicitMsh22(text: string, geometryDigest: string,includeCadEntities=true,includeCurves=false): ExplicitC3D4Mesh {
  if (Buffer.byteLength(text) > EXPLICIT_LINEAR_MESH_CONFIGURATION.maximumRawBytes) invalid('raw mesh resource bound');
  const lines = text.trim().split(/\r?\n/).map(line => line.trim());
  let cursor = 0;
  const take = (expected?: string) => { const line = lines[cursor++];
    if (line === undefined || (expected !== undefined && line !== expected)) invalid('missing/reordered MSH section'); return line; };
  take('$MeshFormat'); take('2.2 0 8'); take('$EndMeshFormat'); take('$Nodes');
  const count = (value: string, max: number) => { if (!/^\d+$/.test(value)) invalid('invalid count');
    const n = Number(value); if (!Number.isSafeInteger(n) || n < 1 || n > max) invalid('count bound'); return n; };
  const nodeCount = count(take(), 100000);
  const nodes: ExplicitC3D4Mesh['nodes'] = [];
  for (let i = 0; i < nodeCount; i++) {
    const row = take().split(/\s+/).map(Number);
    if (row.length !== 4 || row.some(n => !Number.isFinite(n))) invalid('malformed node');
    nodes.push({ id: row[0], xyzMm: row.slice(1) as [number, number, number] });
  }
  take('$EndNodes'); take('$Elements'); const total = count(take(), 150000);
  const elements: ExplicitC3D4Mesh['elements'] = [], surfaceTriangles: ExplicitC3D4Mesh['surfaceTriangles'] = [];
  const curveSegments:NonNullable<ExplicitC3D4Mesh['curveSegments']>=[];
  const ids = new Set<number>(), volumes = new Set<number>();
  const lengths: Record<number, number> = { 15: 1, 1: 2, 2: 3, 4: 4 };
  for (let i = 0; i < total; i++) {
    const row = take().split(/\s+/).map(Number), [id, type, tags] = row;
    if (row.some(n => !Number.isSafeInteger(n)) || id <= 0 || ids.has(id) || tags < 2
      || !(type in lengths) || row.length !== 3 + tags + lengths[type]) invalid('unsupported/malformed/duplicate element');
    ids.add(id); const connectivity = row.slice(3 + tags);
    if (type === 4) { volumes.add(row[4]); elements.push({ id, type: 'C3D4', nodes: connectivity as [number, number, number, number] }); }
    if (type === 2) surfaceTriangles.push({ id, nodes: connectivity as [number, number, number],...(includeCadEntities?{entityTag:row[4]}:{}) });
    if(type===1&&includeCurves)curveSegments.push({id,nodes:connectivity as [number,number],entityTag:row[4]});
  }
  take('$EndElements'); if (cursor !== lines.length || volumes.size !== 1 || [...volumes][0] <= 0)
    invalid('one volume required; unexpected trailing sections');
  return { runtime: 'Gmsh 4.15.2', inputGeometryDigest: geometryDigest, nodes: nodes.sort((a,b)=>a.id-b.id),
    elements: elements.sort((a,b)=>a.id-b.id), surfaceTriangles: surfaceTriangles.sort((a,b)=>a.id-b.id),...(includeCurves?{curveSegments}:{}) };
}

/** Same geometry/quality gate as the existing explicit foundation; deliberately
 * no CalculiX CFL selection. Recompute full boundary ownership and connectivity. */
export function admitExplicitLinearMesh(requestValue: unknown, mesh: ExplicitC3D4Mesh) {
  const request = validateExplicitDynamics(requestValue);
  const selections=request.model.kind==='single_solid_cad'?mapExplicitCadFaces(request,mesh):undefined;
  const quality = assessExplicitC3D4Geometry(request, mesh,selections);
  const nodeMap = new Map(mesh.nodes.map(n => [n.id,n.xyzMm]));
  for (const node of mesh.nodes) node.xyzMm.forEach((v,i) => {
    if (v < (request.model.cad?.boundingBoxMm.min[i]??0)-1e-7 || v > (request.model.cad?.boundingBoxMm.max[i]??[request.model.lengthMm,request.model.widthMm,request.model.heightMm][i]) + 1e-7)
      invalid('node outside approved solid bounds');
  });
  const uses = new Map<string, number>(), adjacency = new Map<string, number[]>();
  mesh.elements.forEach((e,index) => { for (let j=0;j<4;j++) {
    const key=e.nodes.filter((_,i)=>i!==j).sort((a,b)=>a-b).join(',');
    uses.set(key,(uses.get(key)??0)+1); const owners=adjacency.get(key)??[]; owners.push(index); adjacency.set(key,owners);
  }});
  if ([...uses.values()].some(n=>n!==1&&n!==2)) invalid('nonmanifold volume ownership');
  const boundary = new Set(mesh.surfaceTriangles.map(f=>[...f.nodes].sort((a,b)=>a-b).join(',')));
  if ([...uses].some(([key,n])=>n===1&&!boundary.has(key)) || boundary.size!==mesh.surfaceTriangles.length)
    invalid('incomplete/duplicate boundary ownership');
  const visited = new Set<number>(), queue=[0], neighbours=Array.from({length:mesh.elements.length},()=>[] as number[]);
  for (const owners of adjacency.values()) if (owners.length===2) {
    neighbours[owners[0]].push(owners[1]); neighbours[owners[1]].push(owners[0]);
  }
  while(queue.length){const n=queue.pop()!;if(visited.has(n))continue;visited.add(n);queue.push(...neighbours[n]);}
  if(visited.size!==mesh.elements.length)invalid('disconnected volume');
  const boundaryCounts=[0,0,0,0,0,0];
  if(!selections){
  for(const face of mesh.surfaceTriangles){
    const p=face.nodes.map(id=>nodeMap.get(id)!);
    const matches=[request.model.lengthMm,request.model.widthMm,request.model.heightMm].flatMap((extent,axis)=>
      [0,extent].map((value,side)=>p.every(x=>Math.abs(x[axis]-value)<=1e-7)?axis*2+side:-1)).filter(n=>n>=0);
    if(matches.length!==1)invalid('ambiguous/non-CAD boundary FACE');boundaryCounts[matches[0]]++;
  }
  if(boundaryCounts.some(n=>!n))invalid('missing rectangular boundary FACE');
  }
  const faceMappings={domainId:request.model.domainId,bodyId:request.model.bodyId,
    fixed:{...quality.fixedFace,...selections?.fixed,referenceId:request.model.fixedFaceId,...(!selections?{planeXMm:0}:{})},
    loaded:{...quality.loadedFace,...selections?.loaded,referenceId:request.model.loadedFaceId,...(!selections?{planeXMm:request.model.lengthMm}:{})},boundaryCounts};
  return {quality,faceMappings,faceMappingDigest:digest(faceMappings),validationDigest:digest({quality,faceMappings})};
}
