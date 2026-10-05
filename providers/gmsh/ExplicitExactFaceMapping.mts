import type {ExplicitDynamicsRequest} from '../../simulation-bridge/explicitDynamicsContract.mts';
import type {ExplicitC3D4Mesh} from '../calculix/ExplicitDynamicsMeshAdmission.mts';
import {explicitStepTopologySchema} from './ExplicitStepTopology.mts';

/** Identity comes from imported STEP B-Rep incidence and exact measures. Mesh
 * area is never an identity selector. No axis/end/shape-specific assumptions. */
export function mapExactExplicitCadFaces(request:ExplicitDynamicsRequest,mesh:ExplicitC3D4Mesh){
  const cad=request.model.cad!,e=mesh.cadEvidence;
  if(!e||!mesh.curveSegments||!/^sha256:[a-f0-9]{64}$/.test(e.stepByteDigest)||!/^sha256:[a-f0-9]{64}$/.test(e.metadataDigest))throw Error('Exact STEP FACE evidence missing');
  const topology=explicitStepTopologySchema.parse(e.topology),curves=new Map(topology.curves.map(c=>[c.tag,c]));
  const scale=Math.max(request.model.lengthMm,request.model.widthMm,request.model.heightMm),eps=Math.max(1e-7,scale*1e-7);
  const near=(a:number,b:number)=>Math.abs(a-b)<=Math.max(eps,Math.abs(b)*1e-7);
  const vector=(a:number[],b:number[])=>a.every((v,i)=>near(v,b[i]));
  const nodes=new Map(mesh.nodes.map(n=>[n.id,n.xyzMm])),groups=new Map<number,number[]>();
  mesh.surfaceTriangles.forEach((f,i)=>{if(!f.entityTag)throw Error('CAD surface entity missing');const g=groups.get(f.entityTag)??[];g.push(i);groups.set(f.entityTag,g);});
  if(topology.surfaces.length!==cad.faceCount||new Set(topology.surfaces.map(s=>s.tag)).size!==cad.faceCount||curves.size!==topology.curves.length
    ||groups.size!==cad.faceCount||topology.surfaces.some(s=>!groups.has(s.tag)))throw Error('STEP/CAD surface topology changed');
  const key=(a:number,b:number)=>[a,b].sort((x,y)=>x-y).join(',');
  const resolve=(expected:typeof cad.fixedFace)=>{
    const t=expected.topology;if(!t)throw Error('Exact selected FACE topology missing');
    const candidates=topology.surfaces.filter(s=>{
      if(!vector(s.centroidPartLocalMm,expected.centroidPartLocalMm)||!near(s.areaMm2,expected.areaMm2)
        ||!vector(s.boundingBoxMm.min,t.boundingBoxMm.min)||!vector(s.boundingBoxMm.max,t.boundingBoxMm.max)
        ||s.boundaryCurveTags.length!==t.boundaryCurves.length)return false;
      const remaining=[...s.boundaryCurveTags];
      for(const wanted of t.boundaryCurves){const i=remaining.findIndex(tag=>{const c=curves.get(tag);return c&&near(c.lengthMm,wanted.lengthMm)&&vector(c.centroidPartLocalMm,wanted.centroidPartLocalMm);});
        if(i<0)return false;remaining.splice(i,1);}
      return !remaining.length;
    });
    if(candidates.length!==1)throw Error('Missing/ambiguous exact semantic CAD FACE to STEP entity mapping');
    const surface=candidates[0],facetIndices=groups.get(surface.tag)!,edgeUses=new Map<string,number>();
    let area=0;
    for(const i of facetIndices){const f=mesh.surfaceTriangles[i],p=f.nodes.map(id=>nodes.get(id));if(p.some(x=>!x))throw Error('Invalid FACE connectivity');
      const a=p[0]!,b=p[1]!,c=p[2]!,u=b.map((x,k)=>x-a[k]),v=c.map((x,k)=>x-a[k]);
      const weight=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;
      if(!Number.isFinite(weight)||weight<=0)throw Error('Invalid FACE mesh area');area+=weight;
      for(const xyz of [a,b,c]){if(xyz.some((x,k)=>x<surface.boundingBoxMm.min[k]-eps||x>surface.boundingBoxMm.max[k]+eps))throw Error('FACE mesh outside exact CAD bounds');
        if(t.plane&&Math.abs(xyz.reduce((s,x,k)=>s+(x-t.plane!.origin[k])*t.plane!.normal[k],0))>eps)throw Error('FACE mesh off exact CAD plane');}
      for(let k=0;k<3;k++){const id=key(f.nodes[k],f.nodes[(k+1)%3]);edgeUses.set(id,(edgeUses.get(id)??0)+1);}
    }
    if([...edgeUses.values()].some(n=>n>2))throw Error('Nonmanifold selected FACE');
    const boundary=new Set([...edgeUses].filter(([,n])=>n===1).map(([id])=>id)),expectedBoundary=new Set<string>(),incidence=new Map<number,number>();
    surface.boundaryCurveTags.forEach(tag=>incidence.set(tag,(incidence.get(tag)??0)+1));
    let ribbonAreaBoundMm2=0,maximumBoundaryDeflectionBoundMm=0;
    const curveQuality=[];
    for(const [tag,uses] of incidence){const curve=curves.get(tag);if(!curve||uses>2)throw Error('Invalid CAD trimming incidence');
      const segments=mesh.curveSegments!.filter(s=>s.entityTag===tag);
      if(curve.lengthMm<=eps){if(segments.length)throw Error('Degenerate CAD curve unexpectedly meshed');continue;}
      if(!segments.length)throw Error('Missing selected FACE trimming curve');
      let polygonLengthMm=0;const degree=new Map<number,number>(),segmentKeys=new Set<string>();
      for(const s of segments){const a=nodes.get(s.nodes[0]),b=nodes.get(s.nodes[1]),id=key(...s.nodes);
        if(!a||!b||s.nodes[0]===s.nodes[1]||segmentKeys.has(id))throw Error('Invalid/duplicate FACE curve segment');segmentKeys.add(id);
        polygonLengthMm+=Math.hypot(...a.map((x,k)=>x-b[k]));
        s.nodes.forEach(n=>degree.set(n,(degree.get(n)??0)+1));
        if(uses===1){if(expectedBoundary.has(id))throw Error('Ambiguous FACE trimming ownership');expectedBoundary.add(id);}
      }
      const endpoints=[...degree.values()].filter(n=>n===1).length;
      if([...degree.values()].some(n=>n>2)||(endpoints!==0&&endpoints!==2))throw Error('Incomplete/branched FACE trimming curve');
      // Confirm one connected polyline, not several partial loops with matching totals.
      const visited=new Set<number>(),queue=[segments[0].nodes[0]];while(queue.length){const n=queue.pop()!;if(visited.has(n))continue;visited.add(n);for(const s of segments)if(s.nodes.includes(n))queue.push(...s.nodes);}
      if(visited.size!==degree.size||polygonLengthMm>curve.lengthMm+eps*segments.length)throw Error('Invalid exact CAD curve coverage');
      // Arclength/chord ellipse bound: every omitted curve point lies within
      // 1/2 sqrt(L^2-P^2) of the polyline. Conservative; no guessed percentage.
      const delta=.5*Math.sqrt(Math.max(0,curve.lengthMm**2-polygonLengthMm**2));
      maximumBoundaryDeflectionBoundMm=Math.max(maximumBoundaryDeflectionBoundMm,delta);
      if(uses===1)ribbonAreaBoundMm2+=2*curve.lengthMm*delta+Math.PI*delta**2;
      curveQuality.push({entityTag:tag,exactLengthMm:curve.lengthMm,polygonLengthMm,deflectionBoundMm:delta,segments:segments.length});
    }
    if(boundary.size!==expectedBoundary.size||[...boundary].some(id=>!expectedBoundary.has(id)))throw Error('Missing/wrong selected FACE boundary coverage');
    const extents=surface.boundingBoxMm.max.map((x,k)=>x-surface.boundingBoxMm.min[k]).filter(x=>x>eps);
    if(!extents.length||maximumBoundaryDeflectionBoundMm>=Math.min(...extents)/2||ribbonAreaBoundMm2>=surface.areaMm2)throw Error('Selected FACE approximation unresolved: mesh refinement required');
    const difference=Math.abs(area-surface.areaMm2),roundoff=eps*Math.max(scale,surface.areaMm2);
    if(t.plane&&difference>ribbonAreaBoundMm2+roundoff)throw Error('Selected FACE planar area outside trimming approximation envelope');
    const nodeIds=[...new Set(facetIndices.flatMap(i=>mesh.surfaceTriangles[i].nodes))].sort((a,b)=>a-b);
    return {nodeIds,facetIndices,areaMm2:area,facetCount:facetIndices.length,entityTag:surface.tag,
      identityMethod:'exact-step-boundary-v1' as const,approximation:{cadAreaMm2:surface.areaMm2,triangulatedAreaMm2:area,absoluteAreaDifferenceMm2:difference,
        relativeAreaDifference:difference/surface.areaMm2,areaEnvelopeMm2:t.plane?ribbonAreaBoundMm2+roundoff:null,
        maximumBoundaryDeflectionBoundMm,curveQuality}};
  };
  const fixed=resolve(cad.fixedFace),loaded=resolve(cad.loadedFace);if(fixed.entityTag===loaded.entityTag)throw Error('Fixed/load selections must own distinct CAD FACEs');
  return {fixed,loaded};
}
