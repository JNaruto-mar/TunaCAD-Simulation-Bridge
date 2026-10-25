import * as z from 'zod/v4';
import { digest } from './stableDigest.mts';
import { crackLocal, dot, finite, fractureDigest, fractureId, point3, requireFracture as check,
  sub, validateCrackTopology, type Vec3 } from './stationaryCrackTopology.mts';
import { validateCrackedMesh, type CrackedMeshGeometry } from '../providers/gmsh/stationaryCrackMesh.mts';
import type { CrackTopology } from './stationaryCrackTopology.mts';

const fieldBodySchema = z.object({
  schema: z.literal('tunacad-fracture-nodal-displacements/0.1'),
  origin: z.literal('synthetic_analytical_mode_i'),
  crackDigest: fractureDigest, meshDigest: fractureDigest,
  units: z.literal('mm'),
  values: z.array(z.object({ node: z.number().int().min(0).max(29999), displacement: point3 }).strict()).min(10).max(30000),
}).strict();
const fieldSchema = fieldBodySchema.extend({ fieldDigest: fractureDigest }).strict();
export type CrackDisplacementFieldDraft = z.infer<typeof fieldBodySchema>;
export type CrackDisplacementField = z.infer<typeof fieldSchema>;
const requestSchema = z.object({
  schema: z.literal('tunacad-mode-i-cod-extraction/0.1'),
  planeAssumption: z.enum(['plane_stress', 'plane_strain']),
  material: z.object({ youngsModulusMPa: finite(1, 1e6), poissonRatio: finite(0, .49) }).strict(),
  units: z.literal('MPa_sqrt_m'),
  stations: z.array(z.object({ frontId: fractureId, throughThicknessMm: finite(-50, 50),
    minimumRadiusMm: finite(1e-5, 1000), maximumRadiusMm: finite(1e-5, 1000),
    pairs: z.array(z.object({ positive: z.number().int().min(0).max(29999), negative: z.number().int().min(0).max(29999) }).strict()).min(3).max(32),
  }).strict()).min(1).max(32),
}).strict();
export type ModeIExtractionRequest = z.infer<typeof requestSchema>;
export const modeICodRequestSchema = requestSchema;

/** A few coordinate-subtraction ULPs, not a physical/geometric tolerance.
 * Keep the 2:1 requirement; expose the allowance so a boundary acceptance is auditable. */
export function codRadialSpanCheck(minimumRadiusMm: number, maximumRadiusMm: number, crackHalfLengthMm: number) {
  check([minimumRadiusMm, maximumRadiusMm, crackHalfLengthMm].every(Number.isFinite)
    && minimumRadiusMm > 0 && maximumRadiusMm > minimumRadiusMm && crackHalfLengthMm > 0
    && Number.isFinite(2 * minimumRadiusMm) && Number.isFinite(maximumRadiusMm / minimumRadiusMm), 'invalid radial span inputs');
  const roundoffAllowanceMm = 32 * Number.EPSILON * Math.max(crackHalfLengthMm, maximumRadiusMm, 2 * minimumRadiusMm);
  const deficitMm = 2 * minimumRadiusMm - maximumRadiusMm;
  return { passes: deficitMm <= roundoffAllowanceMm, actualRatio: maximumRadiusMm / minimumRadiusMm,
    roundoffAllowanceMm, roundoffUsed: deficitMm > 0 && deficitMm <= roundoffAllowanceMm };
}

function fieldPreflight(value: any) {
  check(value && Array.isArray(value.values) && value.values.length <= 30000
    && value.values.every((row: any) => Array.isArray(row?.displacement) && row.displacement.length === 3), 'field resource limit');
}
/** Test-only synthetic provenance cannot be relabeled as authenticated FEM evidence. */
export function sealSyntheticCrackDisplacements(value: unknown): CrackDisplacementField {
  fieldPreflight(value);
  const body = fieldBodySchema.parse(value);
  check(new Set(body.values.map(row => row.node)).size === body.values.length, 'duplicate nodal field rows');
  return { ...body, fieldDigest: digest(body) };
}

/** No production job adapter exists. Context/digests establish consistency only, never protected-result authenticity. */
export function extractSyntheticModeICod(context: {
  topology: unknown; currentSource: unknown; mesh: unknown; expectedMeshDigest: string;
  field: unknown; expectedFieldDigest: string;
}, value: unknown) {
  const topology = validateCrackTopology(context.topology, context.currentSource);
  const mesh = validateCrackedMesh(context.mesh, topology, context.currentSource, context.expectedMeshDigest);
  fieldPreflight(context.field);
  const { fieldDigest, ...field } = fieldSchema.parse(context.field);
  check(fieldDigest === context.expectedFieldDigest && fieldDigest === digest(field)
    && field.meshDigest === mesh.meshDigest && field.crackDigest === topology.crackDigest, 'field integrity or source binding');
  check(field.values.length === mesh.nodes.length, 'incomplete displacement field');
  const u = new Map<number, Vec3>();
  for (const row of field.values) {
    check(row.node < mesh.nodes.length && !u.has(row.node), 'unknown or duplicate displacement node'); u.set(row.node, row.displacement);
  }
  const calculation = calculateModeICodGeometry(topology, mesh, u, value);
  return { schema: 'tunacad-synthetic-mode-i-cod-result/0.1', origin: 'synthetic_field_extraction_not_fem',
    crackDigest: topology.crackDigest, meshDigest: mesh.meshDigest, fieldDigest, ...calculation,
    sourceVerification: 'caller_context_consistency_only_not_provider_authentication',
    diagnostics: ['Experimental / Preview; engineeringUsePermitted=false.',
      'Synthetic displacement fields only; no native FEM validation or protected-result admission.',
      'Linear extrapolation to r=0 is model-dependent; fit quality is not mesh or extraction-path convergence.',
      'Plane stress/strain is an explicit assumption, not an inferred property of a 3D crack front.',
      'Ordinary quadratic mesh asymptotic-window resolution remains unverified.'],
    engineeringUsePermitted: false as const };
}

/** Shared arithmetic, NOT an evidence-admission API. Callers must first validate geometry, complete fields and provenance. */
export function calculateModeICodGeometry(topology: CrackTopology, mesh: CrackedMeshGeometry,
  u: ReadonlyMap<number, Vec3>, value: unknown) {
  check(u.size === mesh.nodes.length && mesh.nodes.every((_, n) => point3.safeParse(u.get(n)).success), 'incomplete or invalid arithmetic field');
  const raw: any = value;
  check(raw && Array.isArray(raw.stations) && raw.stations.length <= 32
    && raw.stations.every((s: any) => Array.isArray(s?.pairs) && s.pairs.length <= 32), 'extraction resource limit');
  const request = requestSchema.parse(value), c = topology.definition;
  const effectiveModulusMPa = request.material.youngsModulusMPa
    / (request.planeAssumption === 'plane_strain' ? 1 - request.material.poissonRatio ** 2 : 1);
  const pairMap = new Map(mesh.pairs.map(p => [p.positive, p.negative]));
  const stationKeys: Array<{ frontId: string; z: number }> = [];
  const stations = request.stations.map(station => {
    const ids = topology.identities;
    check(station.frontId === ids.leftFront || station.frontId === ids.rightFront, 'unknown extraction front');
    check(Math.abs(station.throughThicknessMm) <= .4 * c.thicknessMm, 'free-surface front endpoint excluded');
    check(!stationKeys.some(s => s.frontId === station.frontId && Math.abs(s.z - station.throughThicknessMm) < 1e-7), 'duplicate front station');
    stationKeys.push({ frontId: station.frontId, z: station.throughThicknessMm });
    check(station.minimumRadiusMm < station.maximumRadiusMm && station.maximumRadiusMm <= .25 * c.halfLengthMm,
      'invalid or nonlocal sampling interval');
    const sign = station.frontId === ids.rightFront ? 1 : -1;
    const seen = new Set<number>();
    const estimates = station.pairs.map(pair => {
      check(pairMap.get(pair.positive) === pair.negative && !seen.has(pair.positive), 'unmatched or duplicate extraction pair'); seen.add(pair.positive);
      const local = crackLocal(c, mesh.nodes[pair.positive]);
      check(Math.abs(local[2] - station.throughThicknessMm) < 1e-7, 'pair belongs to another front station');
      const radiusMm = c.halfLengthMm - sign * local[0];
      check(radiusMm > 1e-5 && radiusMm >= station.minimumRadiusMm - 1e-7 && radiusMm <= station.maximumRadiusMm + 1e-7,
        'sampling radius outside declared interval');
      const jump = sub(u.get(pair.positive)!, u.get(pair.negative)!);
      const openingMm = dot(jump, c.openingNormal);
      check(Number.isFinite(openingMm) && openingMm > 1e-12, 'closed, inverted or degenerate crack opening');
      const tangential = Math.hypot(dot(jump, c.crackDirection), dot(jump, c.thicknessDirection));
      check(tangential <= openingMm * .01 + 1e-12, 'mixed-mode displacement jump outside Mode-I tolerance');
      const kiMPaSqrtM = effectiveModulusMPa * openingMm / 8 * Math.sqrt(2 * Math.PI / radiusMm) / Math.sqrt(1000);
      check(Number.isFinite(kiMPaSqrtM) && kiMPaSqrtM > 0, 'invalid radius K_I estimate');
      return { positiveNode: pair.positive, negativeNode: pair.negative, radiusMm, openingMm, kiMPaSqrtM,
        tangentialJumpRatio: tangential / openingMm };
    }).sort((a, b) => a.radiusMm - b.radiusMm);
    check(estimates.every((e, i) => !i || e.radiusMm - estimates[i - 1].radiusMm > 1e-7), 'duplicate or unresolved sampling radii');
    const min = estimates[0].radiusMm, max = estimates.at(-1)!.radiusMm;
    const radialSpan = codRadialSpanCheck(min, max, c.halfLengthMm);
    check(radialSpan.passes, 'insufficient radial span');
    const meanR = estimates.reduce((s, e) => s + e.radiusMm, 0) / estimates.length;
    const meanK = estimates.reduce((s, e) => s + e.kiMPaSqrtM, 0) / estimates.length;
    const scale = max - min;
    const x = estimates.map(e => (e.radiusMm - meanR) / scale);
    const slopeScaled = estimates.reduce((s, e, i) => s + x[i] * (e.kiMPaSqrtM - meanK), 0) / x.reduce((s, v) => s + v * v, 0);
    const slopePerMm = slopeScaled / scale;
    const extrapolatedKiMPaSqrtM = meanK - slopePerMm * meanR;
    check(Number.isFinite(extrapolatedKiMPaSqrtM) && extrapolatedKiMPaSqrtM > 0, 'nonpositive or invalid extrapolated K_I');
    const residuals = estimates.map(e => e.kiMPaSqrtM - (extrapolatedKiMPaSqrtM + slopePerMm * e.radiusMm));
    const rmsMPaSqrtM = Math.sqrt(residuals.reduce((s, v) => s + v * v, 0) / estimates.length);
    const relativeRms = rmsMPaSqrtM / extrapolatedKiMPaSqrtM;
    const maximumRelativeResidual = Math.max(...residuals.map(Math.abs)) / extrapolatedKiMPaSqrtM;
    return { frontId: station.frontId, throughThicknessMm: station.throughThicknessMm,
      sampleCount: estimates.length, minimumRadiusMm: min, maximumRadiusMm: max, radialSpan, estimates,
      fittedMeanKiMPaSqrtM: meanK, extrapolatedKiMPaSqrtM, slopePerMm, rmsMPaSqrtM, relativeRms, maximumRelativeResidual,
      relativeEstimateSpread: (Math.max(...estimates.map(e => e.kiMPaSqrtM)) - Math.min(...estimates.map(e => e.kiMPaSqrtM))) / meanK,
      relativeExtrapolationShift: Math.abs(extrapolatedKiMPaSqrtM - meanK) / meanK,
      fitQuality: relativeRms <= .02 && maximumRelativeResidual <= .05 ? 'acceptable_synthetic_fit' : 'poor_fit_inconclusive',
      meshConvergence: 'not_evaluated', extractionIntervalConvergence: 'not_evaluated' };
  });
  return { calculationKind: 'untrusted_arithmetic_only_not_native_evidence', optionsDigest: digest(request),
    units: 'MPa_sqrt_m', planeAssumption: request.planeAssumption, effectiveModulusMPa, stations,
    engineeringUsePermitted: false as const };
}
