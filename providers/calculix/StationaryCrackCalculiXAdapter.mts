import * as z from 'zod/v4';
import { neutralToCalculiXC3D10 } from './CalculiXSolverProvider.mts';
import { solverNumber } from './CalculiXMultiDomainDeck.mts';
import { quadraticTriangleSurfaceSamples, tetraMeanRatio } from '../../src/simulation/neutralFemMesh.ts';
import { validateCrackedMeshGeometry } from '../gmsh/stationaryCrackMesh.mts';
import { digest } from '../../simulation-bridge/stableDigest.mts';
import { crackLocal, crackSourceSchema, cross, fractureId, norm, point3, requireFracture as check,
  type Vec3 } from '../../simulation-bridge/stationaryCrackTopology.mts';
import { requirePilotTopology, type MappedNativeCrack } from '../gmsh/StationaryCrackGmshAdapter.mts';
import type { ModeIExtractionRequest } from '../../simulation-bridge/stationaryModeIExtraction.mts';
import { codRadialSpanCheck } from '../../simulation-bridge/stationaryModeIExtraction.mts';

const face = z.object({ semanticReferenceId: fractureId, centroidAnalysisMm: point3, areaMm2: z.literal(100) }).strict();
export const pilotFaceBindingsSchema = z.object({ source: crackSourceSchema, lower: face, upper: face }).strict();
export type PilotFaceBindings = z.infer<typeof pilotFaceBindingsSchema>;
export const fracturePilotConfigurationSchema = z.object({
  analysis: z.literal('linear_static'), material: z.object({ model: z.literal('homogeneous_isotropic_linear_elastic'),
    youngsModulusMPa: z.literal(210000), poissonRatio: z.literal(.3) }).strict(),
  load: z.object({ type: z.literal('balanced_remote_face_traction'), stressMPa: z.literal(10) }).strict(),
  stabilization: z.literal('six_reviewed_remote_corner_dofs'), planeAssumption: z.literal('plane_stress'),
  outputs: z.literal('complete_nodal_U_and_anchor_RF'), units: z.literal('mm-N-MPa'), engineeringUsePermitted: z.literal(false),
}).strict();
export type FracturePilotConfiguration = z.infer<typeof fracturePilotConfigurationSchema>;
export function validatePilotFaceBindings(value: unknown, currentSource: unknown): PilotFaceBindings {
  const f = pilotFaceBindingsSchema.parse(value);
  check(digest(f.source) === digest(crackSourceSchema.parse(currentSource))
    && f.lower.semanticReferenceId !== f.upper.semanticReferenceId
    && !/^fracture:/i.test(f.lower.semanticReferenceId) && !/^fracture:/i.test(f.upper.semanticReferenceId)
    && norm(f.lower.centroidAnalysisMm.map((v, i) => v - [0, -200, 0][i])) < 1e-7
    && norm(f.upper.centroidAnalysisMm.map((v, i) => v - [0, 200, 0][i])) < 1e-7, 'stale or incorrect source-bound remote FACE');
  return f;
}

export function prepareStationaryCrackCalculiX(mapped: MappedNativeCrack, topologyValue: unknown, currentSource: unknown, faceValue: unknown) {
  const topology = requirePilotTopology(topologyValue, currentSource), faces = validatePilotFaceBindings(faceValue, currentSource);
  check(mapped.meshDigest === digest({ geometry: mapped.geometry, endFacets: mapped.endFacets })
    && mapped.geometry.crackDigest === topology.crackDigest && mapped.minimumQuality >= .04, 'mesh changed before deck preparation');
  const m = validateCrackedMeshGeometry(mapped.geometry, topology, currentSource);
  check(m.restraints.length === 0 && m.elements.every(cell => tetraMeanRatio(cell.slice(0, 4).map(n => m.nodes[n]) as any) >= .04),
    'unreviewed restraints or insufficient actual element quality before deck');
  const loads = new Map<number, Vec3>();
  for (const side of ['lower', 'upper'] as const) {
    const seen = new Set<string>(); let area = 0;
    for (const facet of mapped.endFacets[side]) {
      const key = [...facet].sort((a, b) => a - b).join(':'); check(!seen.has(key), 'duplicate loaded facet'); seen.add(key);
      check(facet.length === 6 && facet.every(n => Number.isInteger(n) && n >= 0 && n < m.nodes.length
        && Math.abs(m.nodes[n][1] - (side === 'lower' ? -200 : 200)) < 1e-7), 'load not on source end FACE');
      for (const q of quadraticTriangleSurfaceSamples(facet.map(n => m.nodes[n]))) {
        area += q.areaWeightMm2;
        facet.forEach((n, i) => {
          const old = loads.get(n) ?? [0, 0, 0]; old[1] += (side === 'lower' ? -10 : 10) * q.areaWeightMm2 * q.shapeFunctions[i]; loads.set(n, old);
        });
      }
    }
    check(Math.abs(area - 100) < 1e-5, 'loaded area differs from approved 100 mm2 FACE');
  }
  const fixed = [[-50, -200, -.5], [50, -200, -.5], [-50, 200, -.5]].map(point => {
    const found = m.nodes.flatMap((p, n) => norm(p.map((v, i) => v - point[i])) < 1e-7 ? [n] : []);
    check(found.length === 1, 'source corner anchor missing or ambiguous'); return found[0];
  });
  const anchors = [{ node: fixed[0], components: [1, 2, 3] }, { node: fixed[1], components: [2, 3] }, { node: fixed[2], components: [3] }];
  const crackNodes = new Set(m.lipFacets.flatMap(f => f.nodes));
  check(fixed.every(n => !crackNodes.has(n)) && [...loads.keys()].every(n => !crackNodes.has(n)), 'crack node loaded or restrained');
  const resultant: Vec3 = [0, 0, 0], moment: Vec3 = [0, 0, 0]; let lowerY = 0, upperY = 0;
  for (const [n, force] of loads) {
    for (let i = 0; i < 3; i++) resultant[i] += force[i];
    const torque = cross(m.nodes[n], force); for (let i = 0; i < 3; i++) moment[i] += torque[i];
    if (m.nodes[n][1] < 0) lowerY += force[1]; else upperY += force[1];
  }
  check(Math.abs(lowerY + 1000) < 1e-5 && Math.abs(upperY - 1000) < 1e-5 && norm(resultant) < 1e-5 && norm(moment) < 1e-4,
    'reference traction is not balanced in force and moment');
  // CalculiX reads real data with F20.0. Raw toPrecision(16) can truncate an
  // exponent (e.g. -5.551115123125783e-17), rejecting the remaining NODE block.
  // Reuse the established 12-significant-digit formatter and near-zero policy.
  const number = (v: number) => { const text = solverNumber(v); check(text.length <= 20, 'CalculiX real field exceeds F20.0'); return text; };
  const deck = ['*HEADING', 'Stationary Mode-I feasibility pilot; Experimental Preview; engineeringUsePermitted=false',
    `** source=${digest(currentSource)} crack=${topology.crackDigest} mesh=${mapped.meshDigest}`,
    '*NODE,NSET=NALL', ...m.nodes.map((p, n) => `${n + 1},${p.map(number).join(',')}`), '*ELEMENT,TYPE=C3D10,ELSET=EALL',
    ...m.elements.map((cell, e) => `${e + 1},${neutralToCalculiXC3D10(cell).map(n => n + 1).join(',')}`),
    '*MATERIAL,NAME=ELASTIC_PLATE', '*ELASTIC', '210000,0.3', '*SOLID SECTION,ELSET=EALL,MATERIAL=ELASTIC_PLATE',
    '*NSET,NSET=ANCHORS', fixed.map(n => n + 1).join(','), '*BOUNDARY',
    ...anchors.flatMap(a => a.components.map(dof => `${a.node + 1},${dof},${dof},0`)),
    '*STEP', '*STATIC', '1,1', '*CLOAD',
    ...[...loads].filter(([, f]) => Math.abs(f[1]) > 1e-12).map(([n, f]) => `${n + 1},2,${number(f[1])}`),
    '*NODE PRINT,NSET=NALL,GLOBAL=YES', 'U', '*NODE PRINT,NSET=ANCHORS,GLOBAL=YES', 'RF', '*END STEP',
  ].join('\n');
  check(Buffer.byteLength(deck) < 16 * 1024 * 1024, 'deck byte budget');
  return { deck, deckDigest: digest(deck), sourceFaces: faces, anchors, nodalLoads: [...loads].map(([node, forceN]) => ({ node, forceN })),
    lowerResultantN: lowerY, upperResultantN: upperY, resultantN: resultant, momentNmm: moment, meshDigest: mapped.meshDigest };
}

export function prepareNativeCodSamples(mapped: MappedNativeCrack, topologyValue: unknown, currentSource: unknown): ModeIExtractionRequest {
  const t = requirePilotTopology(topologyValue, currentSource), m = mapped.geometry;
  const stations = [-1, 1].flatMap(sign => [-.25, 0, .25].map(z => {
    const pairs = m.pairs.filter(p => {
      const local = crackLocal(t.definition, m.nodes[p.positive]), r = 10 - sign * local[0];
      return Math.abs(local[2] - z) < 1e-7 && r >= .5 - 1e-7 && r <= 2 + 1e-7;
    }).sort((a, b) => sign * (m.nodes[b.positive][0] - m.nodes[a.positive][0]));
    check(pairs.length >= 3, 'mesh has insufficient matched multi-radius samples at a required front station');
    const selected = pairs.length <= 32 ? pairs : Array.from({ length: 32 }, (_, i) => pairs[Math.round(i * (pairs.length - 1) / 31)]);
    const radii = selected.map(p => 10 - sign * m.nodes[p.positive][0]);
    check(codRadialSpanCheck(Math.min(...radii), Math.max(...radii), t.definition.halfLengthMm).passes
      && new Set(radii.map(r => r.toFixed(7))).size === selected.length, 'mesh sampling interval degenerate');
    return { frontId: sign < 0 ? t.identities.leftFront : t.identities.rightFront, throughThicknessMm: z,
      minimumRadiusMm: .5, maximumRadiusMm: 2, pairs: selected };
  }));
  return { schema: 'tunacad-mode-i-cod-extraction/0.1', planeAssumption: 'plane_stress',
    material: { youngsModulusMPa: 210000, poissonRatio: .3 }, units: 'MPa_sqrt_m', stations };
}

/** Dedicated bounded single-step U/RF adapter. Rejects duplicate/malformed rows instead of silently overwriting them. */
export function parseStationaryCrackDat(raw: string, nodeCount: number, anchors: number[]) {
  check(Number.isInteger(nodeCount) && nodeCount >= 10 && nodeCount <= 30000 && anchors.length === 3 && new Set(anchors).size === 3
    && anchors.every(n => Number.isInteger(n) && n >= 0 && n < nodeCount), 'invalid DAT expected identity');
  check(Buffer.byteLength(raw) <= 16 * 1024 * 1024, 'DAT byte limit');
  const lines = raw.split(/\r?\n/); check(lines.length <= 128000, 'DAT record limit');
  const displacements = new Map<number, Vec3>(), reactions = new Map<number, Vec3>();
  let mode: 'U' | 'RF' | null = null, uBlocks = 0, rfBlocks = 0;
  for (const line of lines) {
    check(line.length <= 4096, 'oversized DAT record');
    if (/displacements.*for set/i.test(line)) { check(/for set\s+NALL\b/i.test(line) && ++uBlocks === 1, 'unexpected or repeated displacement block'); mode = 'U'; continue; }
    if (/forces.*for set/i.test(line)) { check(/for set\s+ANCHORS\b/i.test(line) && ++rfBlocks === 1, 'unexpected or repeated reaction block'); mode = 'RF'; continue; }
    if (!line.trim()) continue;
    if (/for set/i.test(line)) throw new Error('STATIONARY_FRACTURE_INVALID: unexpected output block');
    if (!/^\s*[+\-\d.]/.test(line)) continue;
    check(mode, 'unscoped numerical DAT record');
    const values = line.trim().split(/\s+/).map(v => Number(v.replace(/[dD]/g, 'E')));
    check(values.length === 4 && values.every(Number.isFinite) && Number.isInteger(values[0]) && values[0] >= 1 && values[0] <= nodeCount,
      'invalid or nonfinite DAT row');
    const n = values[0] - 1, rows = mode === 'U' ? displacements : reactions;
    check(!rows.has(n) && (mode === 'U' || anchors.includes(n)), 'duplicate or unexpected DAT node');
    rows.set(n, values.slice(1) as Vec3);
  }
  check(uBlocks === 1 && rfBlocks === 1 && displacements.size === nodeCount && reactions.size === anchors.length, 'incomplete displacement/reaction output');
  const reactionSumN: Vec3 = [0, 0, 0]; for (const f of reactions.values()) for (let i = 0; i < 3; i++) reactionSumN[i] += f[i];
  return { displacements, reactions, reactionSumN, equilibriumResidualN: norm(reactionSumN), fieldDigest: digest([...displacements].sort(([a], [b]) => a - b)), rawDatDigest: digest(raw) };
}
