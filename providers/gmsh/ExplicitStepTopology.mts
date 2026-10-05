import * as z from 'zod/v4';
const vec=z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]);
const box=z.object({min:vec,max:vec}).strict();
export const explicitStepTopologySchema=z.object({schema:z.literal('tunacad-explicit-step-topology/1'),
  surfaces:z.array(z.object({tag:z.number().int().positive(),areaMm2:z.number().finite().positive(),centroidPartLocalMm:vec,boundingBoxMm:box,
    boundaryCurveTags:z.array(z.number().int().positive()).max(40000)}).strict()).min(2).max(20000),
  curves:z.array(z.object({tag:z.number().int().positive(),lengthMm:z.number().finite().nonnegative(),centroidPartLocalMm:vec,boundingBoxMm:box}).strict()).max(40000),
}).strict();
export type ExplicitStepTopology=z.infer<typeof explicitStepTopologySchema>;
/** Gmsh 4.15.2 GEO Mass/CenterOfMass/BoundingBox/Boundary operate on the
 * imported OCC B-Rep BEFORE meshing, not on triangle approximations.
 * https://gmsh.info/doc/texinfo/gmsh.html#Floating-point-expressions */
export const EXPLICIT_STEP_TOPOLOGY_GEO=`
surfaces[] = Surface{:};
curves[] = Curve{:};
Printf("EXPLICIT_STEP_TOPOLOGY_V1 %.17g %.17g", #surfaces[], #curves[]) > "cad-topology.txt";
For i In {0:#surfaces[]-1}
  t = surfaces[i]; a[] = Mass Surface{t}; c[] = CenterOfMass Surface{t}; b[] = BoundingBox Surface{t};
  Printf("F %.17g %.17g %.17g %.17g %.17g %.17g %.17g %.17g %.17g %.17g %.17g", t,a[0],c[0],c[1],c[2],b[0],b[1],b[2],b[3],b[4],b[5]) >> "cad-topology.txt";
  edges[] = Boundary{ Surface{t}; };
  For j In {0:#edges[]-1}
    Printf("B %.17g %.17g", t,Abs(edges[j])) >> "cad-topology.txt";
  EndFor
EndFor
For i In {0:#curves[]-1}
  t = curves[i]; a[] = Mass Curve{t}; c[] = CenterOfMass Curve{t}; b[] = BoundingBox Curve{t};
  Printf("C %.17g %.17g %.17g %.17g %.17g %.17g %.17g %.17g %.17g %.17g %.17g", t,a[0],c[0],c[1],c[2],b[0],b[1],b[2],b[3],b[4],b[5]) >> "cad-topology.txt";
EndFor
Printf("END") >> "cad-topology.txt";
`;
export function parseExplicitStepTopology(text:string):ExplicitStepTopology{
  const fail=():never=>{throw Error('EXPLICIT_STEP_TOPOLOGY_INVALID');};
  if(Buffer.byteLength(text)>128*1024)fail();
  const rows=text.trim().split(/\r?\n/).map(r=>r.trim().split(/\s+/));
  const header=rows.shift()!,end=rows.pop()!;
  if(header?.length!==3||header[0]!=='EXPLICIT_STEP_TOPOLOGY_V1'||end?.length!==1||end[0]!=='END')fail();
  const surfaces:ExplicitStepTopology['surfaces']=[],curves:ExplicitStepTopology['curves']=[],boundaries:number[][]=[];
  for(const [type,...values] of rows){const n=values.map(Number);if(n.some(v=>!Number.isFinite(v)))fail();
    if(type==='B'){if(n.length!==2||n.some(v=>!Number.isSafeInteger(v)||v<=0))fail();boundaries.push(n);continue;}
    if(!['F','C'].includes(type)||n.length!==11)fail();
    const measure={tag:n[0],centroidPartLocalMm:n.slice(2,5) as [number,number,number],boundingBoxMm:{min:n.slice(5,8) as [number,number,number],max:n.slice(8,11) as [number,number,number]}};
    if(type==='F')surfaces.push({...measure,areaMm2:n[1],boundaryCurveTags:[]});else curves.push({...measure,lengthMm:n[1]});
  }
  const result=explicitStepTopologySchema.parse({schema:'tunacad-explicit-step-topology/1',surfaces,curves}),s=new Map(surfaces.map(v=>[v.tag,v])),c=new Set(curves.map(v=>v.tag));
  if(s.size!==surfaces.length||c.size!==curves.length||surfaces.length!==Number(header[1])||curves.length!==Number(header[2]))fail();
  for(const [surface,curve] of boundaries){if(!s.has(surface)||!c.has(curve))fail();s.get(surface)!.boundaryCurveTags.push(curve);}
  // parse again after assigning incidence; enforce bounds, including bbox order.
  const parsed=explicitStepTopologySchema.parse({...result,surfaces});
  if([...surfaces,...curves].some(v=>v.boundingBoxMm.max.some((x,i)=>x<v.boundingBoxMm.min[i])))fail();
  return parsed;
}
