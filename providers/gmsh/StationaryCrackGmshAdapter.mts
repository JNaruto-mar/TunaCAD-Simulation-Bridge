import { parseMsh41 } from './GmshMeshProvider.mts';
import { tetraMeanRatio } from '../../src/simulation/neutralFemMesh.ts';
import { digest } from '../../simulation-bridge/stableDigest.mts';
import { crackLocal, norm, requireFracture as check, sub, validateCrackTopology, type CrackTopology } from '../../simulation-bridge/stationaryCrackTopology.mts';
import { TET_FACES, validateCrackedMeshGeometry, type CrackedMeshGeometry } from './stationaryCrackMesh.mts';

export const FRACTURE_PHYSICAL = Object.freeze({ negativeLip: 101, positiveLip: 102, leftFront: 201, rightFront: 202,
  openMouths: 203, lowerEnd: 301, upperEnd: 302, solid: 901 });
export function requirePilotTopology(value: unknown, currentSource: unknown): CrackTopology {
  const t = validateCrackTopology(value, currentSource), c = t.definition;
  check(c.fullWidthMm === 100 && c.fullHeightMm === 400 && c.thicknessMm === 1 && c.halfLengthMm === 10
    && norm(c.centerAnalysisMm) === 0 && norm(sub(c.crackDirection, [1, 0, 0])) === 0
    && norm(sub(c.openingNormal, [0, 1, 0])) === 0 && norm(sub(c.thicknessDirection, [0, 0, 1])) === 0,
  'native pilot is restricted to the reviewed 100x400x1 mm analysis-frame plate');
  return t;
}

/** Fixed relative paths only. Mesh 3 is executed once during parsing; CLI MUST NOT also use -3. */
export function prepareStationaryCrackGmsh(value: unknown, currentSource: unknown) {
  const topology = requirePilotTopology(value, currentSource);
  const script = [
    'SetFactory("OpenCASCADE");', 'General.AbortOnError=4;', 'General.NumThreads=1;', 'Geometry.OCCBooleanPreserveNumbering = 1;',
    'Mesh.MshFileVersion = 4.1;', 'Mesh.Binary = 0;', 'Mesh.SaveAll = 1;',
    'Mesh.ElementOrder = 2;', 'Mesh.SecondOrderIncomplete = 0;', 'Mesh.RecombineAll=0;',
    'Mesh.MeshSizeMin = 0.25;', 'Mesh.MeshSizeMax = 15;',
    'Merge "geometry.step";', 'v() = Volume{:};', 'If (#v() != 1)', 'Error("Expected one approved plate volume");', 'Abort;', 'EndIf',
    // +Z then +X => original surface normal +Y. Plugin duplicates positive-Y material.
    'p = newp;', 'Point(p)={-10,0,-0.5,0.25};', 'Point(p+1)={-10,0,0.5,0.25};',
    'Point(p+2)={10,0,0.5,0.25};', 'Point(p+3)={10,0,-0.5,0.25};',
    'l = newl;', 'Line(l)={p,p+1};', 'Line(l+1)={p+1,p+2};', 'Line(l+2)={p+2,p+3};', 'Line(l+3)={p+3,p};',
    'll = newcl;', 'Curve Loop(ll)={l,l+1,l+2,l+3};', 's = news;', 'Plane Surface(s)={ll};',
    'BooleanFragments{Volume{v()}; Delete;}{Surface{s}; Delete;}',
    'v() = Volume{:};', 'If (#v() != 1)', 'Error("Crack fragment changed solid count");', 'Abort;', 'EndIf',
    'eps=1e-5;', 'cs()=Surface In BoundingBox{-10-eps,-eps,-0.5-eps,10+eps,eps,0.5+eps};',
    'lf()=Curve In BoundingBox{-10-eps,-eps,-0.5-eps,-10+eps,eps,0.5+eps};',
    'rf()=Curve In BoundingBox{10-eps,-eps,-0.5-eps,10+eps,eps,0.5+eps};',
    'mt()=Curve In BoundingBox{-10-eps,-eps,0.5-eps,10+eps,eps,0.5+eps};',
    'mb()=Curve In BoundingBox{-10-eps,-eps,-0.5-eps,10+eps,eps,-0.5+eps};',
    'lo()=Surface In BoundingBox{-50-eps,-200-eps,-0.5-eps,50+eps,-200+eps,0.5+eps};',
    'hi()=Surface In BoundingBox{-50-eps,200-eps,-0.5-eps,50+eps,200+eps,0.5+eps};',
    'If (#cs()!=1 || #lf()!=1 || #rf()!=1 || #mt()!=1 || #mb()!=1 || #lo()!=1 || #hi()!=1)',
    'Error("Ambiguous fracture or end-face entity mapping");', 'Abort;', 'EndIf',
    'Physical Surface(101)={cs()};', 'Physical Curve(201)={lf()};', 'Physical Curve(202)={rf()};',
    'Physical Curve(203)={mt(),mb()};', 'Physical Surface(301)={lo()};', 'Physical Surface(302)={hi()};', 'Physical Volume(901)={v()};',
    'Transfinite Curve {mt(),mb()}=81;', 'Transfinite Curve {lf(),rf()}=5;', 'Transfinite Surface {cs()};',
    'Field[1]=Distance;', 'Field[1].CurvesList={lf(),rf()};', 'Field[1].Sampling=100;',
    'Field[2]=Threshold;', 'Field[2].InField=1;', 'Field[2].SizeMin=0.25;', 'Field[2].SizeMax=15;',
    'Field[2].DistMin=2;', 'Field[2].DistMax=10;', 'Background Field=2;',
    'Mesh 3;', 'Plugin(Crack).Dimension=2;', 'Plugin(Crack).PhysicalGroup=101;',
    'Plugin(Crack).OpenBoundaryPhysicalGroup=203;', 'Plugin(Crack).NewPhysicalGroup=102;',
    'Plugin(Crack).SwapOrientation=1;', 'Plugin(Crack).Run;', 'Save "fracture.msh";',
  ].join('\n');
  return { topology, script, scriptDigest: digest(script), arguments: ['mesh.geo', '-parse_and_exit', '-v', '2'],
    maximumNodes: 30000, maximumElements: 15000, minimumQuality: .04, meshingCalls: 1,
    installedPluginBehavior: 'UNVERIFIED', engineeringUsePermitted: false as const };
}

const section = (text: string, name: string) => {
  const parts = text.split('$' + name + '\n');
  check(parts.length === 2, 'missing or repeated MSH ' + name);
  const end = parts[1].split('$End' + name); check(end.length === 2, 'MSH section termination'); return end[0].trim();
};
const fkey = (nodes: number[]) => [...nodes].sort((a, b) => a - b).join(':');
export type MappedNativeCrack = { geometry: CrackedMeshGeometry; meshDigest: string;
  endFacets: { lower: number[][]; upper: number[][] }; minimumQuality: number; rawMeshDigest: string };

/** Reads explicit physical tags, not coincident ordinary FACE signatures. Output is untrusted until an owned run admits it. */
export function mapStationaryCrackMsh41(raw: string, topologyValue: unknown, currentSource: unknown): MappedNativeCrack {
  check(Buffer.byteLength(raw) <= 64 * 1024 * 1024 && raw.length > 0, 'mesh output byte limit');
  const text = raw.replace(/\r/g, ''); check(text.split('\n').every(line => line.length <= 4096), 'oversized MSH record');
  const topology = requirePilotTopology(topologyValue, currentSource), parsed = parseMsh41(text, 30000, 15000);
  const entityLines = section(text, 'Entities').split('\n');
  const counts = entityLines[0].trim().split(/\s+/).map(Number);
  check(counts.length === 4 && counts.every(v => Number.isSafeInteger(v) && v >= 0 && v <= 60000)
    && counts.reduce((a, b) => a + b, 0) === entityLines.length - 1, 'invalid MSH entity counts');
  const physical = new Map<string, number[]>(); let cursor = 1;
  for (let dim = 0; dim < 4; dim++) for (let i = 0; i < counts[dim]; i++) {
    const row = entityLines[cursor++].trim().split(/\s+/).map(Number), offset = dim === 0 ? 4 : 7, count = row[offset];
    check(row.every(Number.isFinite) && Number.isSafeInteger(row[0]) && row[0] > 0
      && Number.isSafeInteger(count) && count >= 0 && count <= 16 && row.length >= offset + 1 + count, 'invalid physical entity');
    const groups = row.slice(offset + 1, offset + 1 + count);
    check(groups.every(v => Number.isSafeInteger(v) && v > 0) && new Set(groups).size === groups.length, 'invalid physical tags');
    if (dim === 0) check(row.length === offset + 1 + count, 'invalid point entity length');
    else {
      const boundaries = row[offset + 1 + count];
      check(Number.isSafeInteger(boundaries) && boundaries >= 0 && boundaries <= 60000
        && row.length === offset + 2 + count + boundaries
        && row.slice(offset + 2 + count).every(v => Number.isSafeInteger(v) && v !== 0), 'invalid entity boundary list');
    }
    const key = `${dim}:${row[0]}`; check(!physical.has(key), 'duplicate MSH entity');
    physical.set(key, groups);
  }
  const has = (dim: number, entity: number, tag: number) => physical.get(`${dim}:${entity}`)?.includes(tag) ?? false;
  for (const tag of [101, 102, 301, 302]) check([...physical].filter(([key, tags]) => key.startsWith('2:') && tags.includes(tag)).length === 1,
    'missing or ambiguous lip/end physical group');
  for (const tag of [201, 202]) check([...physical].filter(([key, tags]) => key.startsWith('1:') && tags.includes(tag)).length === 1, 'ambiguous front physical group');
  check(parsed.tetrahedra.every(t => has(3, t.entityTag, 901)), 'unmapped solid volume');
  const owners = new Map<string, number[]>();
  parsed.tetrahedra.forEach((tet, i) => TET_FACES.forEach(f => {
    const key = fkey(f.map(j => tet.connectivity[j])); owners.set(key, [...(owners.get(key) ?? []), i]);
  }));
  const ids = topology.identities, lipFacets: CrackedMeshGeometry['lipFacets'] = [], endFacets = { lower: [] as number[][], upper: [] as number[][] };
  const triangleKeys = new Set<string>();
  for (const triangle of parsed.triangles) {
    const nodes = triangle.connectivity, owner = owners.get(fkey(nodes));
    check(owner && owner.length === 1 && !triangleKeys.has(fkey(nodes)), 'orphan, duplicate or still-connected MSH surface'); triangleKeys.add(fkey(nodes));
    const plus = has(2, triangle.entityTag, 102), minus = has(2, triangle.entityTag, 101);
    check(!(plus && minus), 'both lips assigned to one entity');
    if (plus || minus) {
      check(owner.length === 1, 'crack surface still connects both material sides');
      lipFacets.push({ lipId: plus ? ids.positiveLip : ids.negativeLip,
        nodes: nodes as CrackedMeshGeometry['lipFacets'][number]['nodes'], ownerElement: owner[0] });
    }
    for (const [tag, side] of [[301, 'lower'], [302, 'upper']] as const) if (has(2, triangle.entityTag, tag)) {
      check(owner.length === 1 && nodes.every(n => Math.abs(parsed.nodes[n][1] - (side === 'lower' ? -200 : 200)) < 1e-7), 'wrong remote end surface');
      endFacets[side].push(nodes);
    }
  }
  check(endFacets.lower.length && endFacets.upper.length, 'missing remote end facets');
  const plus = new Set(lipFacets.filter(f => f.lipId === ids.positiveLip).flatMap(f => f.nodes));
  const minus = new Set(lipFacets.filter(f => f.lipId === ids.negativeLip).flatMap(f => f.nodes));
  const byCoord = new Map<string, number>();
  const coordinate = (n: number) => parsed.nodes[n].map(v => v.toFixed(8)).join(':');
  for (const n of minus) { check(!byCoord.has(coordinate(n)), 'ambiguous physical negative-lip node'); byCoord.set(coordinate(n), n); }
  const pairs = [...plus].filter(n => !minus.has(n)).map(positive => {
    const negative = byCoord.get(coordinate(positive)); check(negative !== undefined, 'unpaired physical crack node'); return { positive, negative };
  });
  const tokens = section(text, 'Elements').split(/\s+/).map(Number); let k = 0;
  const blocks = tokens[k++]; k += 3;
  const frontEdges = new Map<number, number[][]>([[201, []], [202, []]]), elementTags = new Set<number>();
  const width: Record<number, number> = { 1: 2, 2: 3, 3: 4, 4: 4, 5: 8, 6: 6, 7: 5, 8: 3, 9: 6, 11: 10, 15: 1 };
  for (let b = 0; b < blocks; b++) {
    const dim = tokens[k++], entity = tokens[k++], type = tokens[k++], count = tokens[k++]; check(width[type], 'unsupported MSH element');
    for (let i = 0; i < count; i++) {
      const elementTag = tokens[k++]; check(!elementTags.has(elementTag), 'duplicate MSH element tag'); elementTags.add(elementTag);
      const tags = tokens.slice(k, k + width[type]); k += width[type];
      if (dim === 1) for (const tag of [201, 202]) if (has(1, entity, tag)) {
        check(type === 8, 'front must have complete quadratic line elements');
        frontEdges.get(tag)!.push(tags.map(tag => { const n = parsed.nodeIndexByTag.get(tag); check(n !== undefined, 'unknown front node'); return n; }));
      }
    }
  }
  const fronts = [201, 202].map(tag => {
    const edges = frontEdges.get(tag)!, incidence = new Map<number, number[]>(); check(edges.length > 0 && edges.length <= 128, 'front edge count');
    edges.forEach((e, i) => { for (const n of e.slice(0, 2)) incidence.set(n, [...(incidence.get(n) ?? []), i]); });
    const endpoints = [...incidence].filter(([, edges]) => edges.length === 1).map(([n]) => n);
    check(endpoints.length === 2 && [...incidence.values()].every(e => e.length <= 2), 'branched or closed front');
    let n = endpoints.sort((a, b) => parsed.nodes[a][2] - parsed.nodes[b][2])[0];
    const orderedNodes = [n], seen = new Set<number>();
    while (seen.size < edges.length) {
      const next = incidence.get(n)!.find(i => !seen.has(i)); check(next !== undefined, 'disconnected front');
      seen.add(next); const e = edges[next]; n = e[0] === n ? e[1] : e[0]; orderedNodes.push(e[2], n);
    }
    return { frontId: tag === 201 ? ids.leftFront : ids.rightFront, orderedNodes };
  });
  const entityFor = (dim: number, tag: number) => Number([...physical].find(([key, tags]) => key.startsWith(dim + ':') && tags.includes(tag))![0].split(':')[1]);
  const geometry = validateCrackedMeshGeometry({ schema: 'tunacad-stationary-cracked-mesh/0.1', crackDigest: topology.crackDigest,
    meshRevision: 'native-pilot-mesh-v1', coordinateSpace: 'frozen_analysis', units: 'mm', element: 'C3D10_neutral_order',
    nodes: parsed.nodes, elements: parsed.tetrahedra.map(t => t.connectivity), lipFacets, pairs, fronts,
    mapping: { surfaceId: ids.surface, positiveLipId: ids.positiveLip, negativeLipId: ids.negativeLip, leftFrontId: ids.leftFront, rightFrontId: ids.rightFront,
      positiveSurfaceTag: entityFor(2, 102), negativeSurfaceTag: entityFor(2, 101), leftFrontCurveTag: entityFor(1, 201), rightFrontCurveTag: entityFor(1, 202) },
    ordinaryFaceReferences: [], restraints: [], ties: [] }, topology, currentSource);
  const minimumQuality = Math.min(...geometry.elements.map(cell => tetraMeanRatio(cell.slice(0, 4).map(n => geometry.nodes[n]) as any)));
  check(minimumQuality >= .04, 'native cracked mesh fails existing minimum quality 0.04');
  return { geometry, meshDigest: digest({ geometry, endFacets }), endFacets, minimumQuality, rawMeshDigest: digest(raw) };
}
