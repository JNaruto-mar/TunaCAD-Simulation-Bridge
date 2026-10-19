import * as z from 'zod/v4';
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
/** Persistent user intent, never mesh evidence or approval authority. The
 * parent revision excludes ONLY this root annotation collection, avoiding a
 * self-referential revision. Preparation binds the complete current revision. */
export const stationaryCrackDocumentSchema = z.object({
  schema: z.literal('tunacad-document-stationary-crack/0.1'), id, name: z.string().trim().min(1).max(100),
  documentRootId: id, parentPartId: id, parentBodyId: id, parentGeometryRevision: hash,
  centerMm: z.tuple([z.literal(0), z.literal(0), z.literal(0)]),
  direction: z.tuple([z.literal(1), z.literal(0), z.literal(0)]),
  openingNormal: z.tuple([z.literal(0), z.literal(1), z.literal(0)]),
  thicknessDirection: z.tuple([z.literal(0), z.literal(0), z.literal(1)]),
  totalLengthMm: z.number().finite().min(2).max(50),
  lowerFaceId: id, upperFaceId: id,
  materialPolicy: z.literal('read_current_part_engineering_material'),
  referenceTensionMPa: z.literal(10), meshPolicy: z.literal('reviewed_stationary_plate_v1'),
  stabilization: z.literal('six_remote_corner_dofs_from_validated_end_surfaces'),
  units: z.literal('mm-N-MPa'), engineeringUsePermitted: z.literal(false),
}).strict().refine(r => r.lowerFaceId !== r.upperFaceId && !r.lowerFaceId.startsWith('fracture:')
  && !r.upperFaceId.startsWith('fracture:'), 'Distinct actual CAD end FACEs required.');
export type StationaryCrackDocument = z.infer<typeof stationaryCrackDocumentSchema>;
/** Shared browser/owner geometry admission. Observations must still be obtained
 * from the authenticated CAD reader; this pure check confers no authority. */
export function validateStationaryPilotPlate(b:any) {
  const near=(a:number,c:number)=>Number.isFinite(a)&&Math.abs(a-c)<=Math.max(1e-6,Math.abs(c)*1e-8);
  const vec=(a:any,c:number[])=>Array.isArray(a)&&a.length===3&&a.every((v:number,i:number)=>near(v,c[i]));
  const check=(c:unknown)=>{if(!c)throw Error('STATIONARY_CRACK_RECTANGULAR_PLATE_REQUIRED');};
  check(b?.isValid&&b.shapeType==='solid'&&b.solidCount===1&&b.connectedComponentCount===1&&b.closed&&b.manifold
    &&b.faceCount===6&&b.nativeTopology?.faces?.length===6&&b.nativeTopology?.edges?.length===12&&b.exactFaces?.length===6
    &&vec(b.boundingBox?.min,[-50,-200,-.5])&&vec(b.boundingBox?.max,[50,200,.5])&&near(b.volume,40000)&&near(b.surfaceArea,81000));
  const expected=[[-50,0,0,400],[50,0,0,400],[0,-200,0,100],[0,200,0,100],[0,0,-.5,40000],[0,0,.5,40000]];
  const seen=new Set<number>(),edges=new Set<number>();
  for(const face of b.nativeTopology.faces) {
    const index=expected.findIndex(e=>vec(face.signature?.centroid,e.slice(0,3))&&near(face.signature?.measure,e[3]));
    check(index>=0&&!seen.has(index)&&face.edgeIndices?.length===4);seen.add(index);
  }
  check(b.exactFaces.every((d:any,i:number)=>{const center=b.nativeTopology.faces[i].signature.centroid,
    axis=center.findIndex((v:number)=>Math.abs(v)>1e-7);
    return d.shapeType==='FACE'&&d.evidence?.exact&&d.analyticType==='plane'&&d.frame?.direction?.length===3
      &&near(Math.abs(d.frame.direction[axis]),1)&&near(d.frame.origin?.[axis],center[axis]);}));
  for(const e of b.nativeTopology.edges) {
    check(Number.isInteger(e.index)&&e.index>0&&!edges.has(e.index)&&e.faceIndices?.length===2
      &&e.faceIndices[0]!==e.faceIndices[1]&&e.faceIndices.every((i:number)=>i>=1&&i<=6));edges.add(e.index);
  }
  b.nativeTopology.faces.forEach((face:any,i:number)=>check(new Set(face.edgeIndices).size===4
    &&face.edgeIndices.every((index:number)=>b.nativeTopology.edges.find((e:any)=>e.index===index)?.faceIndices.includes(i+1))));
}
/** Keep the established project revision calculation; only remove the new
 * annotations for the nonrecursive parent-geometry revision. */
export function stationaryParentRevisionInput(state: {activePartId: string | null; nodes: Record<string, any>; mates: unknown}) {
  const nodes = Object.fromEntries(Object.entries(state.nodes).map(([id, node]) => {
    const { stationaryCracks: _annotations, ...rest } = node; return [id, rest];
  }));
  return { activePartId: state.activePartId, nodes, mates: state.mates };
}
export function validateStationaryCrackDocument(value: unknown, current: {
  rootId: string; partId: string; bodyId: string; parentGeometryRevision: string;
}) {
  const r = stationaryCrackDocumentSchema.parse(value);
  if (r.documentRootId !== current.rootId || r.parentPartId !== current.partId
    || r.parentBodyId !== current.bodyId || r.parentGeometryRevision !== current.parentGeometryRevision)
    throw new Error('STATIONARY_CRACK_DOCUMENT_STALE');
  return r;
}
