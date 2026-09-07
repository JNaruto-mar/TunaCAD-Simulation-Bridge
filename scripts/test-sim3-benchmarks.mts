import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadExternalPipeline } from '../simulation-bridge/providers.mts';
import { digest, validateRequest } from '../simulation-bridge/requestValidation.mts';
import type {
  ExternalSimulationProvider,
  NeutralSimulationConstraint,
  NeutralSimulationLoad,
  NeutralSimulationRequest,
  NeutralSimulationResult,
  NeutralVector3,
} from '../src/simulation/externalSimulationContracts.ts';

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (!gmsh || !calculix) throw new Error('Set TUNACAD_GMSH_EXECUTABLE and TUNACAD_CALCULIX_EXECUTABLE to run SIM-3 benchmarks.');
const pipeline = await loadExternalPipeline(gmsh, calculix);
if (!pipeline.provider || !pipeline.readiness.ready) throw new Error('Gmsh and CalculiX must pass readiness before SIM-3 benchmarks.');

interface FaceSpec {
  id: string;
  centroid: NeutralVector3;
  area: number;
  outwardDirection: NeutralVector3 | null;
  geometryType: string;
  boundingBox: { min: NeutralVector3; max: NeutralVector3 };
  edgeCount: number;
}

interface GeometrySpec {
  id: string;
  script: string[];
  shape: NeutralSimulationRequest['geometry']['shape'];
  faces: Record<string, FaceSpec>;
}

interface RunSpec {
  label: string;
  geometry: GeometrySpec;
  loads: NeutralSimulationLoad[];
  constraints: NeutralSimulationConstraint[];
  globalSizeMm: number;
  densityKgM3?: number;
}

const directory = await mkdtemp(join(tmpdir(), 'tunacad-sim3-benchmarks-'));
const box = boxGeometry();
const cylinder = cylinderGeometry();

try {
  const boxStep = await createStep(box);
  const cylinderStep = await createStep(cylinder);
  const mixed = await mixedLoadMatrix(pipeline.provider, box, boxStep);
  const curvedPressure = await curvedPressureMatrix(pipeline.provider, cylinder, cylinderStep);
  const gravity = await gravityMatrix(pipeline.provider, box, boxStep);
  const prescribed = await prescribedMatrix(pipeline.provider, box, boxStep);
  console.log(JSON.stringify({ mixed, curvedPressure, gravity, prescribed }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}

async function mixedLoadMatrix(provider: ExternalSimulationProvider, geometry: GeometrySpec, step: Uint8Array) {
  const densityKgM3 = 7_800;
  const gravity: NeutralVector3 = [0, 0, -500_000];
  const loads: NeutralSimulationLoad[] = [
    { id: 'force-z', name: 'Terminal resultant', type: 'surface_force', semanticReferenceIds: ['box-right'], forceN: [250, 0, -100] },
    { id: 'pressure-x', name: 'Terminal compression', type: 'pressure', semanticReferenceIds: ['box-right'], pressureMPa: 0.25 },
    { id: 'gravity-z', name: 'Body acceleration', type: 'gravity', accelerationMmPerS2: gravity },
  ];
  const sizes: [number, number, number] = [10, 7, 5];
  const runs = [] as NeutralSimulationResult[];
  for (const size of sizes) runs.push(await run(provider, {
    label: `mixed-${size}`, geometry, loads, constraints: fixedLeft(), globalSizeMm: size, densityKgM3,
  }, step));
  increasingMeshCounts(runs);
  const weight = scaled(gravity, densityKgM3 * geometry.shape.volumeMm3 * 1e-12);
  const applied = add([150, 0, -100], weight);
  runs.forEach(result => assertReaction(result, scaled(applied, -1), 3e-4, 'Mixed-load reaction'));
  assertRefinement(runs, 0.12, 0.3, 'mixed surface-force/pressure/gravity');
  const reordered = await run(provider, {
    label: 'mixed-reordered', geometry, loads: [loads[2], loads[0], loads[1]], constraints: fixedLeft(), globalSizeMm: sizes[2], densityKgM3,
  }, step);
  assertEquivalent(runs[2], reordered, 2e-7, 'Mixed load order changed the deterministic result.');
  return evidence(runs, { expectedAppliedForceN: applied, fineOrderInvariant: true });
}

async function curvedPressureMatrix(provider: ExternalSimulationProvider, geometry: GeometrySpec, step: Uint8Array) {
  const pressureMPa = 1;
  const sizes: [number, number, number] = [8, 6, 4.5];
  const runs = [] as NeutralSimulationResult[];
  for (const size of sizes) runs.push(await run(provider, {
    label: `curved-pressure-${String(size).replace('.', '_')}`, geometry,
    loads: [{ id: 'external-pressure', name: 'External cylindrical pressure', type: 'pressure', semanticReferenceIds: ['cylinder-lateral'], pressureMPa }],
    constraints: [{ id: 'fixed-cap', name: 'Fixed cap', type: 'fixed', semanticReferenceIds: ['cylinder-fixed'] }], globalSizeMm: size,
  }, step));
  increasingMeshCounts(runs);
  runs.forEach(result => assertReaction(result, [0, 0, 0], 2e-4, 'Closed curved-pressure resultant', pressureMPa * geometry.faces['cylinder-lateral'].area));
  assertRefinement(runs, 0.15, 0.35, 'curved pressure');
  const suction = await run(provider, {
    label: 'curved-suction', geometry,
    loads: [{ id: 'external-pressure', name: 'Cylindrical suction', type: 'pressure', semanticReferenceIds: ['cylinder-lateral'], pressureMPa: -pressureMPa }],
    constraints: [{ id: 'fixed-cap', name: 'Fixed cap', type: 'fixed', semanticReferenceIds: ['cylinder-fixed'] }], globalSizeMm: sizes[2],
  }, step);
  assertMetricClose(runs[2].metrics.maximumDisplacementMm, suction.metrics.maximumDisplacementMm, 2e-6, 'Curved pressure displacement sign symmetry');
  assertMetricClose(runs[2].metrics.maximumVonMisesStressMPa, suction.metrics.maximumVonMisesStressMPa, 2e-6, 'Curved pressure stress sign symmetry');
  return evidence(runs, { analyticalResultantN: [0, 0, 0], fineSignSymmetry: true, exactCadAreaMm2: geometry.faces['cylinder-lateral'].area });
}

async function gravityMatrix(provider: ExternalSimulationProvider, geometry: GeometrySpec, step: Uint8Array) {
  const densityKgM3 = 7_800;
  const diagonal: NeutralVector3 = [300_000, -400_000, -500_000];
  const sizes: [number, number, number] = [10, 7, 5];
  const runs = [] as NeutralSimulationResult[];
  for (const size of sizes) runs.push(await gravityRun(provider, geometry, step, `gravity-diagonal-${size}`, diagonal, size, densityKgM3));
  increasingMeshCounts(runs);
  const massScale = densityKgM3 * geometry.shape.volumeMm3 * 1e-12;
  runs.forEach(result => assertReaction(result, scaled(diagonal, -massScale), 3e-4, 'Diagonal-gravity reaction'));
  assertRefinement(runs, 0.12, 0.3, 'diagonal gravity');
  const axes: NeutralVector3[] = [[1_000_000, 0, 0], [0, 1_000_000, 0], [0, 0, 1_000_000]];
  const axisRuns = [] as NeutralSimulationResult[];
  for (let index = 0; index < axes.length; index += 1) {
    const result = await gravityRun(provider, geometry, step, `gravity-axis-${index}`, axes[index], sizes[2], densityKgM3);
    assertReaction(result, scaled(axes[index], -massScale), 3e-4, `Axis-${index} gravity reaction`);
    axisRuns.push(result);
  }
  const expectedAxialDisplacementMm = densityKgM3 * 1e-12 * axes[0][0] * 100 ** 2 / (2 * 210_000);
  const axialError = relativeError(requiredMetric(axisRuns[0].metrics.maximumDisplacementMm, 'axial gravity displacement'), expectedAxialDisplacementMm);
  assert.ok(axialError <= 0.06, `Axial gravity displacement error ${axialError} exceeds 6%.`);
  assertMetricClose(axisRuns[1].metrics.maximumDisplacementMm, axisRuns[2].metrics.maximumDisplacementMm, 0.04, 'Square-section Y/Z gravity symmetry');
  return evidence(runs, {
    diagonalExpectedReactionN: scaled(diagonal, -massScale),
    axisExpectedReactionMagnitudeN: massScale * 1_000_000,
    axialExpectedDisplacementMm: expectedAxialDisplacementMm,
    axialFineDisplacementMm: axisRuns[0].metrics.maximumDisplacementMm,
    axialRelativeError: axialError,
    transverseSymmetryRelativeChange: relativeChange(axisRuns[1].metrics.maximumDisplacementMm, axisRuns[2].metrics.maximumDisplacementMm),
  });
}

async function prescribedMatrix(provider: ExternalSimulationProvider, geometry: GeometrySpec, step: Uint8Array) {
  const sizes: [number, number, number] = [10, 7, 5];
  const axial = [] as NeutralSimulationResult[];
  for (const size of sizes) axial.push(await prescribedRun(provider, geometry, step, `prescribed-axial-${size}`, [0.01, 0, null], size));
  increasingMeshCounts(axial);
  const expectedReactionN = 210_000 * 400 * 0.01 / 100;
  for (const result of axial) {
    const fixed = reactionFor(result, 'fixed-left');
    assert.ok(relativeError(Math.abs(fixed[0]), expectedReactionN) <= 0.025, `Axial prescribed reaction ${fixed[0]} differs from EAδ/L=${expectedReactionN} N.`);
    assertSelfEquilibrated(result, 'Prescribed axial reactions');
  }
  assert.ok(relativeChange(Math.abs(reactionFor(axial[1], 'fixed-left')[0]), Math.abs(reactionFor(axial[2], 'fixed-left')[0])) <= 0.01, 'Axial prescribed reaction did not converge within 1%.');
  const transverse = await prescribedRun(provider, geometry, step, 'prescribed-transverse', [0, 0.005, null], sizes[2]);
  const combined = await prescribedRun(provider, geometry, step, 'prescribed-combined', [0.01, 0.005, null], sizes[2]);
  const reversed = await prescribedRun(provider, geometry, step, 'prescribed-combined-reversed', [-0.01, -0.005, null], sizes[2]);
  [transverse, combined, reversed].forEach(result => assertSelfEquilibrated(result, 'Multi-component prescribed reactions'));
  assertVectorClose(
    reactionFor(combined, 'fixed-left'),
    add(reactionFor(axial[2], 'fixed-left'), reactionFor(transverse, 'fixed-left')),
    3e-5,
    'Combined prescribed reaction must superpose axial and transverse components.',
  );
  assertVectorClose(reactionFor(reversed, 'fixed-left'), scaled(reactionFor(combined, 'fixed-left'), -1), 3e-5, 'Reversed multi-component prescribed reaction lost sign symmetry.');
  assertMetricClose(combined.metrics.maximumDisplacementMm, reversed.metrics.maximumDisplacementMm, 2e-5, 'Multi-component displacement sign symmetry');
  assertMetricClose(combined.metrics.maximumVonMisesStressMPa, reversed.metrics.maximumVonMisesStressMPa, 2e-5, 'Multi-component stress sign symmetry');
  return evidence(axial, {
    analyticalReactionN: expectedReactionN,
    fineReactionN: Math.abs(reactionFor(axial[2], 'fixed-left')[0]),
    fineReactionRelativeError: relativeError(Math.abs(reactionFor(axial[2], 'fixed-left')[0]), expectedReactionN),
    combinedFixedReactionN: reactionFor(combined, 'fixed-left'),
    combinedSuperposition: true,
    signSymmetry: true,
  });
}

async function gravityRun(provider: ExternalSimulationProvider, geometry: GeometrySpec, step: Uint8Array, label: string, acceleration: NeutralVector3, globalSizeMm: number, densityKgM3: number) {
  return run(provider, { label, geometry, loads: [{ id: 'gravity', name: 'Gravity', type: 'gravity', accelerationMmPerS2: acceleration }], constraints: fixedLeft(), globalSizeMm, densityKgM3 }, step);
}

async function prescribedRun(provider: ExternalSimulationProvider, geometry: GeometrySpec, step: Uint8Array, label: string, displacementMm: [number | null, number | null, number | null], globalSizeMm: number) {
  return run(provider, {
    label, geometry, loads: [], globalSizeMm,
    constraints: [
      ...fixedLeft(),
      { id: 'driven-right', name: 'Driven right face', type: 'prescribed_displacement', semanticReferenceIds: ['box-right'], displacementMm },
    ],
  }, step);
}

function fixedLeft(): NeutralSimulationConstraint[] {
  return [{ id: 'fixed-left', name: 'Fixed left face', type: 'fixed', semanticReferenceIds: ['box-left'] }];
}

async function createStep(spec: GeometrySpec): Promise<Uint8Array> {
  const geoPath = join(directory, `${spec.id}.geo`);
  const stepPath = join(directory, `${spec.id}.step`);
  const output = stepPath.replace(/\\/g, '/').replace(/"/g, '\\"');
  await writeFile(geoPath, ['SetFactory("OpenCASCADE");', ...spec.script, `Save "${output}";`].join('\n'), 'utf8');
  execFileSync(gmsh!, [geoPath, '-0', '-v', '2'], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Uint8Array(await readFile(stepPath));
}

async function run(provider: ExternalSimulationProvider, spec: RunSpec, step: Uint8Array): Promise<NeutralSimulationResult> {
  const request = createRequest(spec);
  validateRequest(request);
  const submission = await provider.submit(request, { descriptor: request.geometry, async export() { return step; } });
  const deadline = Date.now() + provider.capabilities.execution.totalTimeoutMs;
  while (Date.now() < deadline) {
    const status = await provider.getStatus(submission.providerRunId);
    if (status.status === 'failed') throw new Error(`${spec.label}: ${status.failure?.code}: ${status.failure?.message}`);
    if (status.status === 'cancelled') throw new Error(`${spec.label}: run was unexpectedly cancelled.`);
    if (status.status === 'succeeded') {
      const result = await provider.getResult(submission.providerRunId);
      if (!result) throw new Error(`${spec.label}: provider succeeded without a normalized result.`);
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  await provider.cancel(submission.providerRunId);
  throw new Error(`${spec.label}: run exceeded the provider timeout.`);
}

function createRequest(spec: RunSpec): NeutralSimulationRequest {
  const preparedAt = new Date().toISOString();
  const requiredRoles = new Map<string, 'load' | 'constraint'>();
  for (const load of spec.loads) if ('semanticReferenceIds' in load) load.semanticReferenceIds.forEach(id => requiredRoles.set(id, 'load'));
  for (const constraint of spec.constraints) constraint.semanticReferenceIds.forEach(id => {
    const prior = requiredRoles.get(id);
    if (prior && prior !== 'constraint') throw new Error(`Fixture FACE ${id} cannot be both loaded and constrained.`);
    requiredRoles.set(id, 'constraint');
  });
  const geometryWithoutDigest = {
    projectRevision: `sim3-${spec.geometry.id}-r1`, partId: `sim3-${spec.geometry.id}-part`, bodyId: `sim3-${spec.geometry.id}-body`, coordinateSpace: 'part_definition_local' as const,
    shape: spec.geometry.shape,
    references: [...requiredRoles].map(([id, role]) => binding(spec.geometry, id, role)),
  };
  const geometry = { ...geometryWithoutDigest, geometryDigest: digest(geometryWithoutDigest) };
  const unsigned = {
    schema: 'tunacad-neutral-simulation-request/1.0' as const, studyId: spec.label, name: `SIM-3 benchmark ${spec.label}`, preparedAt,
    expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    analysis: { type: 'linear_static' as const, assumptions: ['small_displacement', 'small_strain', 'static_loading', 'homogeneous_material'] as const }, geometry,
    units: { geometry: 'mm' as const, force: 'N' as const, stress: 'MPa' as const, displacement: 'mm' as const, density: 'kg/m^3' as const, acceleration: 'mm/s^2' as const },
    material: { id: 'steel-sim3', name: 'Steel SIM-3', model: 'isotropic_linear_elastic' as const, ...(spec.densityKgM3 === undefined ? {} : { densityKgM3: spec.densityKgM3 }), youngsModulusMPa: 210_000, poissonRatio: 0.3, yieldStrengthMPa: 355, source: { kind: 'custom' as const, reference: 'SIM-3 experimental benchmark values' } },
    loads: spec.loads, constraints: spec.constraints, contacts: { mode: 'none' as const },
    mesh: { dimensionality: '3d' as const, elementFamily: 'tetrahedral' as const, order: 2 as const, globalSizeMm: spec.globalSizeMm, minimumSizeMm: spec.globalSizeMm / 4, maximumNodes: 500_000, maximumElements: 250_000, qualityMetric: 'provider_normalized' as const, minimumQuality: 0.04 },
    requestedResults: ['von_mises_stress', 'displacement', 'reaction_force', 'factor_of_safety', 'critical_regions'] as const,
  };
  return { ...unsigned, requestDigest: digest(unsigned) };
}

function binding(geometry: GeometrySpec, id: string, role: 'load' | 'constraint'): NeutralSimulationRequest['geometry']['references'][number] {
  const face = geometry.faces[id];
  if (!face) throw new Error(`Unknown fixture FACE ${id}.`);
  return {
    semanticReferenceId: id, ownerPartId: `sim3-${geometry.id}-part`, geometryKind: 'FACE', role, sourceFeatureId: geometry.id,
    resolutionState: 'valid', resolvedAtProjectRevision: `sim3-${geometry.id}-r1`,
    face: { centroidPartLocalMm: face.centroid, areaMm2: face.area, outwardDirection: face.outwardDirection, geometryType: face.geometryType, boundingBoxMm: face.boundingBox, edgeCount: face.edgeCount },
  };
}

function boxGeometry(): GeometrySpec {
  const length = 100; const width = 20; const height = 20;
  return {
    id: 'box', script: [`Box(1) = {0, 0, 0, ${length}, ${width}, ${height}};`],
    shape: { valid: true, connectedSolidCount: 1, faceCount: 6, edgeCount: 12, volumeMm3: length * width * height, surfaceAreaMm2: 2 * (length * width + length * height + width * height), boundingBoxMm: { min: [0, 0, 0], max: [length, width, height], size: [length, width, height] } },
    faces: {
      'box-left': { id: 'box-left', centroid: [0, width / 2, height / 2], area: width * height, outwardDirection: [-1, 0, 0], geometryType: 'plane', boundingBox: { min: [0, 0, 0], max: [0, width, height] }, edgeCount: 4 },
      'box-right': { id: 'box-right', centroid: [length, width / 2, height / 2], area: width * height, outwardDirection: [1, 0, 0], geometryType: 'plane', boundingBox: { min: [length, 0, 0], max: [length, width, height] }, edgeCount: 4 },
    },
  };
}

function cylinderGeometry(): GeometrySpec {
  const length = 100; const radius = 10;
  return {
    id: 'cylinder', script: [`Cylinder(1) = {0, 0, 0, ${length}, 0, 0, ${radius}};`],
    shape: { valid: true, connectedSolidCount: 1, faceCount: 3, edgeCount: 3, volumeMm3: Math.PI * radius ** 2 * length, surfaceAreaMm2: 2 * Math.PI * radius * length + 2 * Math.PI * radius ** 2, boundingBoxMm: { min: [0, -radius, -radius], max: [length, radius, radius], size: [length, 2 * radius, 2 * radius] } },
    faces: {
      'cylinder-fixed': { id: 'cylinder-fixed', centroid: [0, 0, 0], area: Math.PI * radius ** 2, outwardDirection: [-1, 0, 0], geometryType: 'plane', boundingBox: { min: [0, -radius, -radius], max: [0, radius, radius] }, edgeCount: 1 },
      'cylinder-lateral': { id: 'cylinder-lateral', centroid: [length / 2, 0, 0], area: 2 * Math.PI * radius * length, outwardDirection: null, geometryType: 'cylinder', boundingBox: { min: [0, -radius, -radius], max: [length, radius, radius] }, edgeCount: 4 },
    },
  };
}

function evidence(runs: NeutralSimulationResult[], extra: Record<string, unknown>) {
  return {
    elementCounts: runs.map(result => result.provenance.mesh?.elementCount),
    displacementMm: runs.map(result => result.metrics.maximumDisplacementMm),
    stressMPa: runs.map(result => result.metrics.maximumVonMisesStressMPa),
    mediumToFineDisplacementRelativeChange: relativeChange(runs[1].metrics.maximumDisplacementMm, runs[2].metrics.maximumDisplacementMm),
    mediumToFineStressRelativeChange: relativeChange(runs[1].metrics.maximumVonMisesStressMPa, runs[2].metrics.maximumVonMisesStressMPa),
    ...extra,
  };
}

function increasingMeshCounts(results: NeutralSimulationResult[]): void {
  const counts = results.map(result => result.provenance.mesh?.elementCount ?? 0);
  assert.ok(counts[0] > 0 && counts[0] < counts[1] && counts[1] < counts[2], `Mesh refinement counts are not strictly increasing: ${counts.join(', ')}.`);
}

function assertRefinement(results: NeutralSimulationResult[], displacementTolerance: number, stressTolerance: number, label: string): void {
  const displacementChange = relativeChange(results[1].metrics.maximumDisplacementMm, results[2].metrics.maximumDisplacementMm);
  const stressChange = relativeChange(results[1].metrics.maximumVonMisesStressMPa, results[2].metrics.maximumVonMisesStressMPa);
  assert.ok(displacementChange <= displacementTolerance, `${label} displacement refinement change ${displacementChange} exceeds ${displacementTolerance}.`);
  assert.ok(stressChange <= stressTolerance, `${label} stress refinement change ${stressChange} exceeds ${stressTolerance}.`);
}

function assertReaction(result: NeutralSimulationResult, expected: NeutralVector3, relativeTolerance: number, label: string, explicitScale?: number): void {
  assertVectorClose(totalReaction(result), expected, relativeTolerance, label, explicitScale);
}

function assertSelfEquilibrated(result: NeutralSimulationResult, label: string): void {
  const scale = Math.max(1, ...result.reactions.map(reaction => Math.hypot(...reaction.forceN)));
  assertVectorClose(totalReaction(result), [0, 0, 0], 1e-4, label, scale);
}

function assertEquivalent(a: NeutralSimulationResult, b: NeutralSimulationResult, tolerance: number, message: string): void {
  assertMetricClose(a.metrics.maximumDisplacementMm, b.metrics.maximumDisplacementMm, tolerance, message);
  assertMetricClose(a.metrics.maximumVonMisesStressMPa, b.metrics.maximumVonMisesStressMPa, tolerance, message);
  assertVectorClose(totalReaction(a), totalReaction(b), tolerance, message);
}

function reactionFor(result: NeutralSimulationResult, constraintId: string): NeutralVector3 {
  const reaction = result.reactions.find(item => item.constraintId === constraintId);
  if (!reaction) throw new Error(`Missing reaction for ${constraintId}.`);
  return reaction.forceN;
}

function totalReaction(result: NeutralSimulationResult): NeutralVector3 {
  return result.reactions.reduce<NeutralVector3>((sum, reaction) => add(sum, reaction.forceN), [0, 0, 0]);
}

function add(a: NeutralVector3, b: NeutralVector3): NeutralVector3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function scaled(value: NeutralVector3, scale: number): NeutralVector3 { return [value[0] * scale, value[1] * scale, value[2] * scale]; }

function assertMetricClose(a: number | null, b: number | null, tolerance: number, message: string): void {
  const first = requiredMetric(a, message); const second = requiredMetric(b, message);
  assert.ok(relativeError(first, second) <= tolerance, `${message}: ${first} and ${second} differ by ${relativeError(first, second)}.`);
}

function assertVectorClose(actual: NeutralVector3, expected: NeutralVector3, relativeTolerance: number, message: string, explicitScale?: number): void {
  const scale = Math.max(1, explicitScale ?? 0, Math.hypot(...actual), Math.hypot(...expected));
  const error = Math.hypot(actual[0] - expected[0], actual[1] - expected[1], actual[2] - expected[2]);
  assert.ok(error <= scale * relativeTolerance, `${message}: received ${actual.join(', ')}, expected ${expected.join(', ')}, relative residual ${error / scale}.`);
}

function requiredMetric(value: number | null, label: string): number {
  if (value === null || !Number.isFinite(value)) throw new Error(`${label} metric is unavailable.`);
  return value;
}

function relativeChange(from: number | null, to: number | null): number {
  return relativeError(requiredMetric(from, 'comparison source'), requiredMetric(to, 'comparison target'));
}

function relativeError(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.max(Math.abs(expected), Math.abs(actual), 1e-12);
}
