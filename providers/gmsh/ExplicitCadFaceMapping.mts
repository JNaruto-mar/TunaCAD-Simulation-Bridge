import { matchesFace } from './GmshMeshProvider.mts';
import type { ExplicitDynamicsRequest } from '../../simulation-bridge/explicitDynamicsContract.mts';
import type { ExplicitC3D4Mesh } from '../calculix/ExplicitDynamicsMeshAdmission.mts';
import {mapExactExplicitCadFaces} from './ExplicitExactFaceMapping.mts';
/** Uses the same one-to-one STEP entity/geometric-signature policy as the
 * existing neutral mesher. No topology-index, plane or end-position guesses. */
export function mapExplicitCadFaces(request:ExplicitDynamicsRequest,mesh:ExplicitC3D4Mesh){
  if(request.model.cad?.mappingMethod==='exact-step-boundary-v1')return mapExactExplicitCadFaces(request,mesh);
  const cad=request.model.cad;if(!cad)throw Error('CAD FACE evidence missing');
  const nodes=new Map(mesh.nodes.map(n=>[n.id,n.xyzMm]));
  const groups=new Map<number,number[]>();
  mesh.surfaceTriangles.forEach((f,i)=>{
    if(!Number.isSafeInteger(f.entityTag)||f.entityTag!<=0)throw Error('CAD surface entity identity missing');
    const indices=groups.get(f.entityTag!)??[];indices.push(i);groups.set(f.entityTag!,indices);
  });
  if(groups.size!==cad.faceCount)throw Error('STEP/CAD surface topology changed');
  const evidence=new Map([...groups].map(([tag,indices])=>{
    let area=0;const weighted=[0,0,0];
    for(const i of indices){const p=mesh.surfaceTriangles[i].nodes.map(id=>nodes.get(id));
      if(p.some(v=>!v))throw Error('Invalid FACE connectivity');
      const a=p[0]!,b=p[1]!,c=p[2]!;const u=b.map((x,i)=>x-a[i]),v=c.map((x,i)=>x-a[i]);
      const weight=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;
      if(!Number.isFinite(weight)||weight<=0)throw Error('Invalid FACE area');
      area+=weight;weighted.forEach((_,k)=>weighted[k]+=weight*(a[k]+b[k]+c[k])/3);
    }
    return [tag,{centroidPartLocalMm:weighted.map(v=>v/area) as [number,number,number],areaMm2:area,outwardDirection:null,geometryType:null}] as const;
  }));
  const scale=Math.max(request.model.lengthMm,request.model.widthMm,request.model.heightMm);
  const resolve=(expected:typeof cad.fixedFace)=>{
    const tags=[...evidence].filter(([,value])=>matchesFace(value,{...expected,outwardDirection:null,geometryType:null},scale,10)).map(([tag])=>tag);
    if(tags.length!==1)throw Error('Missing/ambiguous semantic CAD FACE to mesh mapping');
    const facetIndices=groups.get(tags[0])!,nodeIds=[...new Set(facetIndices.flatMap(i=>mesh.surfaceTriangles[i].nodes))].sort((a,b)=>a-b);
    return {nodeIds,facetIndices,areaMm2:evidence.get(tags[0])!.areaMm2,facetCount:facetIndices.length,entityTag:tags[0]};
  };
  const fixed=resolve(cad.fixedFace),loaded=resolve(cad.loadedFace);
  if(fixed.entityTag===loaded.entityTag)throw Error('Fixed/load selections must own distinct CAD FACEs');
  return {fixed,loaded};
}
