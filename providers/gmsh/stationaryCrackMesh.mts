import * as z from 'zod/v4';
import { quadraticTetraVolumeSamples, quadraticTriangleSurfaceSamples } from '../../src/simulation/neutralFemMesh.ts';
import { digest } from '../../simulation-bridge/stableDigest.mts';
import { crackLocal, cross, dot, fractureDigest, fractureId, norm, point3, requireFracture as check,
  sub, validateCrackTopology, assertOrdinaryFaceReferences, type CrackTopology } from '../../simulation-bridge/stationaryCrackTopology.mts';

export const CRACK_MESH_LIMITS = Object.freeze({ maximumNodes: 30000, maximumElements: 15000, maximumLipFacets: 20000 });
const node = z.number().int().min(0).max(CRACK_MESH_LIMITS.maximumNodes - 1);
const tet = z.tuple([node, node, node, node, node, node, node, node, node, node]);
const tri = z.tuple([node, node, node, node, node, node]);
const meshBodySchema = z.object({
  schema: z.literal('tunacad-stationary-cracked-mesh/0.1'), crackDigest: fractureDigest,
  meshRevision: fractureId, coordinateSpace: z.literal('frozen_analysis'), units: z.literal('mm'),
  element: z.literal('C3D10_neutral_order'),
  provenance: z.literal('synthetic_topology_fixture'),
  nodes: z.array(point3).min(10).max(CRACK_MESH_LIMITS.maximumNodes),
  elements: z.array(tet).min(1).max(CRACK_MESH_LIMITS.maximumElements),
  mapping: z.object({ surfaceId: fractureId, positiveLipId: fractureId, negativeLipId: fractureId,
    leftFrontId: fractureId, rightFrontId: fractureId,
    positiveSurfaceTag: z.number().int().min(1).max(1e7), negativeSurfaceTag: z.number().int().min(1).max(1e7),
    leftFrontCurveTag: z.number().int().min(1).max(1e7), rightFrontCurveTag: z.number().int().min(1).max(1e7),
  }).strict(),
  lipFacets: z.array(z.object({ lipId: fractureId, nodes: tri,
    ownerElement: z.number().int().min(0).max(CRACK_MESH_LIMITS.maximumElements - 1) }).strict()).min(2).max(CRACK_MESH_LIMITS.maximumLipFacets),
  pairs: z.array(z.object({ positive: node, negative: node }).strict()).min(1).max(15000),
  fronts: z.array(z.object({ frontId: fractureId, orderedNodes: z.array(node).min(3).max(257) }).strict()).length(2),
  ordinaryFaceReferences: z.array(fractureId).max(128),
  restraints: z.array(z.object({ node, components: z.array(z.enum(['X', 'Y', 'Z'])).min(1).max(3) }).strict()).max(128),
  // This precursor does not admit any tie/MPC/contact, not even caller-reported benign ones.
  ties: z.array(z.never()).max(0),
}).strict();
export type CrackedMeshDraft = z.infer<typeof meshBodySchema>;
export type CrackedMesh = CrackedMeshDraft & { meshDigest: string };
const meshSchema = meshBodySchema.extend({ meshDigest: fractureDigest }).strict();
// Shared geometry checks confer no native provenance or execution authority.
export const crackedMeshGeometrySchema = meshBodySchema.omit({ provenance: true });
export type CrackedMeshGeometry = z.infer<typeof crackedMeshGeometrySchema>;
export const TET_EDGES = [[0, 1, 4], [1, 2, 5], [2, 0, 6], [0, 3, 7], [2, 3, 8], [1, 3, 9]] as const;
export const TET_FACES = [[0, 2, 1, 6, 5, 4], [0, 1, 3, 4, 9, 7], [1, 2, 3, 5, 8, 9], [2, 0, 3, 6, 7, 8]] as const;
const key = (values: number[]) => [...values].sort((a, b) => a - b).join(':');
const epsilon = 1e-7;

function preflight(value: any) {
  check(value && typeof value === 'object' && Array.isArray(value.nodes) && value.nodes.length <= 30000
    && Array.isArray(value.elements) && value.elements.length <= 15000
    && Array.isArray(value.lipFacets) && value.lipFacets.length <= 20000
    && Array.isArray(value.pairs) && value.pairs.length <= 15000
    && value.nodes.every((p: any) => Array.isArray(p) && p.length === 3)
    && value.elements.every((e: any) => Array.isArray(e) && e.length === 10)
    && value.lipFacets.every((f: any) => Array.isArray(f?.nodes) && f.nodes.length === 6)
    && Array.isArray(value.fronts) && value.fronts.length === 2
    && value.fronts.every((f: any) => Array.isArray(f?.orderedNodes) && f.orderedNodes.length <= 257)
    && Array.isArray(value.restraints) && value.restraints.length <= 128
    && Array.isArray(value.ordinaryFaceReferences) && value.ordinaryFaceReferences.length <= 128
    && Array.isArray(value.ties) && value.ties.length === 0, 'mesh resource limit or unsupported coupling');
}
export function assertCrackedMeshResourceBounds(value: unknown): void { preflight(value); }

/** Dedicated crack integrity validation; does not relax validateNeutralFemMesh or admit a production job. */
function validateBody(mesh: CrackedMeshGeometry, topology: CrackTopology): void {
  const c = topology.definition, ids = topology.identities;
  check(mesh.crackDigest === topology.crackDigest, 'mesh belongs to another crack');
  assertOrdinaryFaceReferences(mesh.ordinaryFaceReferences);
  check(mesh.mapping.surfaceId === ids.surface && mesh.mapping.positiveLipId === ids.positiveLip
    && mesh.mapping.negativeLipId === ids.negativeLip && mesh.mapping.leftFrontId === ids.leftFront
    && mesh.mapping.rightFrontId === ids.rightFront && mesh.mapping.positiveSurfaceTag !== mesh.mapping.negativeSurfaceTag
    && mesh.mapping.leftFrontCurveTag !== mesh.mapping.rightFrontCurveTag, 'source-to-mesh entity mapping');
  const local = mesh.nodes.map(p => crackLocal(c, p));
  local.forEach(p => check(Math.abs(p[0]) <= c.fullWidthMm / 2 + epsilon
    && Math.abs(p[1]) <= c.fullHeightMm / 2 + epsilon && Math.abs(p[2]) <= c.thicknessMm / 2 + epsilon, 'node outside source plate'));
  const used = new Set<number>(), cornerNodes = new Set<number>(), cells = new Set<string>(), spatialCells = new Set<string>();
  const edgeMids = new Map<string, number>(), midEdges = new Map<number, string>();
  const faces = new Map<string, { nodes: number[]; owners: number[] }>();
  let volume = 0;
  mesh.elements.forEach((cell, owner) => {
    check(new Set(cell).size === 10 && cell.every(n => n < mesh.nodes.length), 'invalid tetra connectivity');
    check(!cells.has(key(cell)), 'duplicate volume element'); cells.add(key(cell)); cell.forEach(n => used.add(n));
    cell.slice(0, 4).forEach(n => cornerNodes.add(n));
    const spatial = cell.map(n => local[n].map(v => v.toFixed(7)).join(',')).sort().join('|');
    check(!spatialCells.has(spatial), 'coincident duplicate volume element'); spatialCells.add(spatial);
    const corners = cell.slice(0, 4).map(n => mesh.nodes[n]);
    check(dot(sub(corners[1], corners[0]), cross(sub(corners[2], corners[0]), sub(corners[3], corners[0]))) > 1e-15,
      'inverted or degenerate neutral tetrahedron');
    for (const [a, b, mid] of TET_EDGES) {
      const edge = key([cell[a], cell[b]]), m = cell[mid];
      const midpoint = mesh.nodes[cell[a]].map((v, i) => (v + mesh.nodes[cell[b]][i]) / 2);
      check(norm(sub(mesh.nodes[m], midpoint)) < epsilon, 'ordinary quadratic midside node is not a midpoint');
      check(!edgeMids.has(edge) || edgeMids.get(edge) === m, 'nonconforming quadratic edge');
      check(!midEdges.has(m) || midEdges.get(m) === edge, 'midside node reused by unrelated edges');
      edgeMids.set(edge, m); midEdges.set(m, edge);
    }
    volume += quadraticTetraVolumeSamples(cell.map(n => mesh.nodes[n])).reduce((s, q) => s + q.volumeWeightMm3, 0);
    const lp = cell.slice(0, 4).map(n => local[n]);
    if (lp.some(p => p[1] > epsilon) && lp.some(p => p[1] < -epsilon)) {
      const xs: number[] = [];
      for (const [a, b] of TET_EDGES) {
        const p = lp[a], q = lp[b];
        if (Math.abs(p[1]) <= epsilon) xs.push(p[0]);
        if (p[1] * q[1] < 0) xs.push(p[0] + (q[0] - p[0]) * p[1] / (p[1] - q[1]));
      }
      check(!xs.length || Math.min(...xs) >= c.halfLengthMm - epsilon || Math.max(...xs) <= -c.halfLengthMm + epsilon,
        'volume element bridges the crack plane');
    }
    for (const f of TET_FACES) {
      const nodes = f.map(i => cell[i]), k = key(nodes), entry = faces.get(k);
      if (entry) { entry.owners.push(owner); check(entry.owners.length <= 2, 'nonmanifold volume face'); }
      else faces.set(k, { nodes, owners: [owner] });
    }
  });
  check(used.size === mesh.nodes.length, 'orphan mesh node');
  check([...midEdges.keys()].every(m => !cornerNodes.has(m)), 'midside node used as a corner');
  check(Math.abs(volume / (c.fullWidthMm * c.fullHeightMm * c.thicknessMm) - 1) < 1e-7, 'source plate volume mismatch');
  const graph = Array.from({ length: mesh.elements.length }, () => [] as number[]);
  for (const face of faces.values()) if (face.owners.length === 2) {
    const [a, b] = face.owners; graph[a].push(b); graph[b].push(a);
  }
  const visited = new Set([0]), queue = [0];
  for (let i = 0; i < queue.length; i++) for (const next of graph[queue[i]]) if (!visited.has(next)) { visited.add(next); queue.push(next); }
  check(visited.size === mesh.elements.length, 'disconnected or orphan volume component');

  const isCrack = (nodes: number[]) => nodes.every(n => Math.abs(local[n][1]) < epsilon && Math.abs(local[n][0]) <= c.halfLengthMm + epsilon);
  const candidateFaces = new Set<string>();
  for (const [k, face] of faces) if (face.owners.length === 1) {
    if (isCrack(face.nodes)) candidateFaces.add(k);
    else check([0, 1, 2].some(axis => [-1, 1].some(sign => face.nodes.every(n =>
      Math.abs(local[n][axis] - sign * [c.fullWidthMm, c.fullHeightMm, c.thicknessMm][axis] / 2) < epsilon))),
    'unexpected internal free surface or missing volume element');
  }
  const positive = new Set<number>(), negative = new Set<number>(), seen = new Set<string>();
  const lipArea = new Map([[ids.positiveLip, 0], [ids.negativeLip, 0]]);
  const lipEdges = new Map<string, Map<string, { nodes: number[]; count: number }>>();
  for (const facet of mesh.lipFacets) {
    const k = key(facet.nodes), face = faces.get(k);
    check(candidateFaces.has(k) && !seen.has(k) && face?.owners.length === 1 && face.owners[0] === facet.ownerElement,
      'duplicate, unmatched or orphan lip facet'); seen.add(k);
    check(key(facet.nodes.slice(0, 3)) === key(face.nodes.slice(0, 3))
      && [[0, 1, 3], [1, 2, 4], [2, 0, 5]].every(([a, b, m]) => edgeMids.get(key([facet.nodes[a], facet.nodes[b]])) === facet.nodes[m]),
    'invalid quadratic lip corner/midside ordering');
    check(facet.lipId === ids.positiveLip || facet.lipId === ids.negativeLip, 'unknown lip identity');
    const isPositive = facet.lipId === ids.positiveLip, set = isPositive ? positive : negative;
    facet.nodes.forEach(n => set.add(n));
    const centroidSide = mesh.elements[facet.ownerElement].slice(0, 4).reduce((s, n) => s + local[n][1], 0) / 4;
    check(isPositive ? centroidSide > epsilon : centroidSide < -epsilon, 'lip identity assigned to wrong material side');
    for (const sample of quadraticTriangleSurfaceSamples(facet.nodes.map(n => mesh.nodes[n]))) {
      check(dot(sample.areaVectorMm2, c.openingNormal) * (isPositive ? -1 : 1) > sample.areaWeightMm2 * (1 - 1e-8),
        'reversed lip outward normal');
      lipArea.set(facet.lipId, lipArea.get(facet.lipId)! + sample.areaWeightMm2);
    }
    const edges = lipEdges.get(facet.lipId) ?? new Map<string, { nodes: number[]; count: number }>();
    for (const e of [[0, 1, 3], [1, 2, 4], [2, 0, 5]]) {
      const nodes = e.map(i => facet.nodes[i]), ek = key(nodes), old = edges.get(ek);
      edges.set(ek, { nodes, count: (old?.count ?? 0) + 1 });
    }
    lipEdges.set(facet.lipId, edges);
  }
  check(seen.size === candidateFaces.size, 'missing crack lip facets');
  for (const [id, area] of lipArea) {
    check(Math.abs(area / (2 * c.halfLengthMm * c.thicknessMm) - 1) < 1e-7, 'incomplete crack surface area');
    for (const { nodes, count } of lipEdges.get(id)!.values()) {
      check(count <= 2, 'nonmanifold crack lip');
      if (count === 1) check([-1, 1].some(sign => nodes.every(n => Math.abs(local[n][0] - sign * c.halfLengthMm) < epsilon)
        || nodes.every(n => Math.abs(local[n][2] - sign * c.thicknessMm / 2) < epsilon)), 'hole or branching boundary in crack lip');
    }
  }
  const fronts = new Set<number>(), frontIds = new Set<string>();
  for (const front of mesh.fronts) {
    check(!frontIds.has(front.frontId) && [ids.leftFront, ids.rightFront].includes(front.frontId), 'unknown or duplicate crack front');
    frontIds.add(front.frontId);
    const x = front.frontId === ids.leftFront ? -c.halfLengthMm : c.halfLengthMm, chain = front.orderedNodes;
    check(chain.length % 2 === 1 && new Set(chain).size === chain.length && chain.every(n => n < mesh.nodes.length), 'invalid quadratic front chain');
    chain.forEach((n, i) => {
      check(positive.has(n) && negative.has(n) && Math.abs(local[n][0] - x) < epsilon && Math.abs(local[n][1]) < epsilon
        && (!i || local[n][2] > local[chain[i - 1]][2] + epsilon), 'unshared, curved or unordered crack front'); fronts.add(n);
    });
    check(Math.abs(local[chain[0]][2] + c.thicknessMm / 2) < epsilon && Math.abs(local[chain.at(-1)!][2] - c.thicknessMm / 2) < epsilon,
      'front does not reach both thickness surfaces');
    for (let i = 0; i < chain.length - 2; i += 2) check(edgeMids.get(key([chain[i], chain[i + 2]])) === chain[i + 1], 'broken quadratic front edge');
  }
  check([...positive].filter(n => negative.has(n)).every(n => fronts.has(n)), 'merged crack lip nodes away from fronts');
  const pairMap = new Map<number, number>(), pairedNegative = new Set<number>();
  for (const pair of mesh.pairs) {
    check(pair.positive !== pair.negative && positive.has(pair.positive) && negative.has(pair.negative)
      && !fronts.has(pair.positive) && !fronts.has(pair.negative) && !pairMap.has(pair.positive) && !pairedNegative.has(pair.negative),
    'unmatched, merged or duplicate lip node pair');
    check(norm(sub(mesh.nodes[pair.positive], mesh.nodes[pair.negative])) < epsilon
      && Math.abs(local[pair.positive][0]) < c.halfLengthMm - epsilon, 'noncoincident pair or duplicated crack-front node');
    pairMap.set(pair.positive, pair.negative); pairedNegative.add(pair.negative);
  }
  check(pairMap.size === positive.size - fronts.size && pairedNegative.size === negative.size - fronts.size, 'incomplete quadratic lip pairing');
  for (const cell of mesh.elements) check(cell.every(n => !pairMap.has(n) || !cell.includes(pairMap.get(n)!)), 'element connects opposite crack lips');
  const negativeFacets = new Set(mesh.lipFacets.filter(f => f.lipId === ids.negativeLip).map(f => key(f.nodes)));
  mesh.lipFacets.filter(f => f.lipId === ids.positiveLip).forEach(f => check(negativeFacets.has(key(f.nodes.map(n => fronts.has(n) ? n : pairMap.get(n)!))),
    'nonconformal lip triangulation'));
  for (const restraint of mesh.restraints) check(restraint.node < mesh.nodes.length && !positive.has(restraint.node) && !negative.has(restraint.node)
    && new Set(restraint.components).size === restraint.components.length, 'crack node restrained or invalid restraint');
}

export function validateCrackedMeshGeometry(value: unknown, topologyValue: unknown, currentSource: unknown): CrackedMeshGeometry {
  preflight(value);
  const body = crackedMeshGeometrySchema.parse(value);
  validateBody(body, validateCrackTopology(topologyValue, currentSource));
  return body;
}

export function sealCrackedMesh(value: unknown, topologyValue: unknown, currentSource: unknown): CrackedMesh {
  preflight(value);
  const topology = validateCrackTopology(topologyValue, currentSource), body = meshBodySchema.parse(value);
  validateBody(body, topology);
  return { ...body, meshDigest: digest(body) };
}

export function validateCrackedMesh(value: unknown, topologyValue: unknown, currentSource: unknown, expectedMeshDigest: string): CrackedMesh {
  preflight(value);
  const { meshDigest, ...body } = meshSchema.parse(value);
  check(meshDigest === expectedMeshDigest && meshDigest === digest(body), 'mesh fingerprint mismatch');
  validateBody(body, validateCrackTopology(topologyValue, currentSource));
  return { ...body, meshDigest };
}
