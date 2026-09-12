import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExternalSimulationProvider, NeutralSimulationRequest, NeutralSimulationResult, NeutralVector3 } from '../src/simulation/externalSimulationContracts.ts';
import { loadExternalPipeline } from '../simulation-bridge/providers.mts';
import { digest } from '../simulation-bridge/requestValidation.mts';

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (!gmsh || !calculix) throw new Error('Set TUNACAD_GMSH_EXECUTABLE and TUNACAD_CALCULIX_EXECUTABLE to run SIM-2 benchmarks.');
const pipeline = await loadExternalPipeline(gmsh, calculix);
if (!pipeline.provider || !pipeline.readiness.ready) throw new Error('Gmsh and CalculiX must pass readiness before qualification benchmarks.');
const directory = await mkdtemp(join(tmpdir(), 'tunacad-sim2-benchmarks-'));

interface Spec {
  id: string;
  length: number;
  width: number;
  height: number;
  forceN: NeutralVector3;
  faceCount: number;
  edgeCount: number;
  volumeMm3: number;
  surfaceAreaMm2: number;
  geometryScript: string[];
}

try {
  const cantilever = boxSpec('cantilever', 100, 10, 10, [0, 0, -100]);
  const cantileverStep = await createStep(cantilever);
  const cantileverRuns = await runLevels(pipeline.provider, cantilever, cantileverStep, [6, 4.5, 3.5]);
  increasingMeshCounts(cantileverRuns);
  cantileverRuns.forEach((result) => assertReactionBalance(result, cantilever.forceN));
  const elasticModulus = 210_000;
  const shearModulus = elasticModulus / (2 * (1 + 0.3));
  const secondMoment = cantilever.width * cantilever.height ** 3 / 12;
  const expectedTipDisplacement = Math.abs(cantilever.forceN[2]) * cantilever.length ** 3 / (3 * elasticModulus * secondMoment)
    + Math.abs(cantilever.forceN[2]) * cantilever.length / ((5 / 6) * shearModulus * cantilever.width * cantilever.height);
  const cantileverFine = requiredMetric(cantileverRuns[2].metrics.maximumDisplacementMm, 'cantilever displacement');
  const cantileverError = Math.abs(cantileverFine - expectedTipDisplacement) / expectedTipDisplacement;
  assert.ok(cantileverError <= 0.08, `Cantilever displacement error ${cantileverError} exceeds 8%.`);
  assert.ok(relativeChange(cantileverRuns[1].metrics.maximumDisplacementMm, cantileverRuns[2].metrics.maximumDisplacementMm) <= 0.04, 'Cantilever displacement did not stabilize across refinement.');
  const repeatRequest = createRequest(cantilever, await geometryDigest(cantileverStep), 3.5);
  const repeatedCantileverRuns = [
    await run(pipeline.provider, repeatRequest, cantileverStep),
    await run(pipeline.provider, repeatRequest, cantileverStep),
    await run(pipeline.provider, repeatRequest, cantileverStep),
  ];
  const repeatDisplacements = repeatedCantileverRuns.map(result => requiredMetric(result.metrics.maximumDisplacementMm, 'repeatability displacement'));
  const repeatStresses = repeatedCantileverRuns.map(result => requiredMetric(result.metrics.maximumVonMisesStressMPa, 'repeatability stress'));
  const repeatReactions = repeatedCantileverRuns.map(result => result.reactions.reduce<NeutralVector3>((sum, item) => [sum[0] + item.forceN[0], sum[1] + item.forceN[1], sum[2] + item.forceN[2]], [0, 0, 0]));
  assertRepeatable(repeatDisplacements, 1e-10, 'maximum displacement');
  assertRepeatable(repeatStresses, 1e-10, 'maximum stress');
  for (let axis = 0; axis < 3; axis++) assertRepeatable(repeatReactions.map(reaction => reaction[axis]), 1e-10, `reaction axis ${axis}`);
  assert.deepEqual(repeatedCantileverRuns.map(result => result.provenance.mesh?.elementCount), [1618, 1618, 1618], 'Identical version-bound requests must retain the same mesh element count.');

  const plate = plateWithHoleSpec();
  const plateStep = await createStep(plate);
  const plateRuns = await runLevels(pipeline.provider, plate, plateStep, [6, 4.5, 3.5]);
  increasingMeshCounts(plateRuns);
  plateRuns.forEach((result) => assertReactionBalance(result, plate.forceN));
  const grossStress = Math.abs(plate.forceN[0]) / (plate.width * plate.height);
  const plateStresses = plateRuns.map(result => requiredMetric(result.metrics.maximumVonMisesStressMPa, 'plate stress'));
  assert.ok(plateStresses.every(stress => stress / grossStress >= 1.5 && stress / grossStress <= 6), `Plate-with-hole stress concentration is outside the bounded trend: ${plateStresses.join(', ')} MPa.`);
  assert.ok(plateStresses[2] >= plateStresses[0] * 0.9, 'Plate-with-hole refinement unexpectedly erased the stress concentration.');
  assert.ok(relativeChange(plateStresses[1], plateStresses[2]) <= 0.2, 'Plate-with-hole stress did not stabilize within the 20% qualification band.');

  const slender = boxSpec('near-singular-slender-beam', 100, 1, 1, [0, 0, -10]);
  const slenderStep = await createStep(slender);
  const slenderResult = await run(pipeline.provider, createRequest(slender, await geometryDigest(slenderStep), 1.5), slenderStep);
  assertReactionBalance(slenderResult, slender.forceN);
  const slenderDisplacement = requiredMetric(slenderResult.metrics.maximumDisplacementMm, 'near-singular displacement');
  assert.ok(slenderDisplacement > slender.height * 10, 'Near-singular fixture did not expose the intended small-displacement-assumption failure.');
  assert.equal(slenderResult.review.engineeringUsePermitted, false);
  assert.ok(slenderResult.warnings.some(warning => warning.code === 'SIMULATION_PROVIDER_POC'));
  assert.ok(slenderResult.warnings.some(warning => warning.code === 'SIMULATION_SMALL_DISPLACEMENT_ASSUMPTION_EXCEEDED' && warning.severity === 'critical'), 'Near-singular fixture must emit a critical small-displacement-assumption warning.');

  console.log(JSON.stringify({
    cantilever: {
      elementCounts: cantileverRuns.map(result => result.provenance.mesh?.elementCount),
      expectedTipDisplacementMm: expectedTipDisplacement,
      fineDisplacementMm: cantileverFine,
      relativeError: cantileverError,
      mediumToFineRelativeChange: relativeChange(cantileverRuns[1].metrics.maximumDisplacementMm, cantileverRuns[2].metrics.maximumDisplacementMm),
    },
    plateWithHole: {
      elementCounts: plateRuns.map(result => result.provenance.mesh?.elementCount),
      maximumStressMPa: plateStresses,
      grossStressMPa: grossStress,
      mediumToFineRelativeChange: relativeChange(plateStresses[1], plateStresses[2]),
    },
    nearSingular: { maximumDisplacementMm: slenderDisplacement, thicknessMm: slender.height, engineeringUsePermitted: slenderResult.review.engineeringUsePermitted },
    repeatability: {
      runCount: repeatedCantileverRuns.length, meshElementCounts: repeatedCantileverRuns.map(result => result.provenance.mesh?.elementCount),
      maximumDisplacementMm: repeatDisplacements, maximumVonMisesStressMPa: repeatStresses, reactionForceN: repeatReactions,
      maximumRelativeSpread: Math.max(relativeSpread(repeatDisplacements), relativeSpread(repeatStresses), ...[0, 1, 2].map(axis => relativeSpread(repeatReactions.map(reaction => reaction[axis])))),
    },
  }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}

async function createStep(spec: Spec): Promise<Uint8Array> {
  const geoPath = join(directory, `${spec.id}.geo`);
  const stepPath = join(directory, `${spec.id}.step`);
  const output = stepPath.replace(/\\/g, '/').replace(/"/g, '\\"');
  await writeFile(geoPath, ['SetFactory("OpenCASCADE");', ...spec.geometryScript, `Save "${output}";`].join('\n'), 'utf8');
  execFileSync(gmsh!, [geoPath, '-0', '-v', '2'], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Uint8Array(await readFile(stepPath));
}

async function runLevels(provider: ExternalSimulationProvider, spec: Spec, step: Uint8Array, sizes: [number, number, number]): Promise<[NeutralSimulationResult, NeutralSimulationResult, NeutralSimulationResult]> {
  const geometryHash = await geometryDigest(step);
  return [
    await run(provider, createRequest(spec, geometryHash, sizes[0]), step),
    await run(provider, createRequest(spec, geometryHash, sizes[1]), step),
    await run(provider, createRequest(spec, geometryHash, sizes[2]), step),
  ];
}

async function run(provider: ExternalSimulationProvider, request: NeutralSimulationRequest, step: Uint8Array): Promise<NeutralSimulationResult> {
  const submission = await provider.submit(request, { descriptor: request.geometry, async export() { return step; } });
  const deadline = Date.now() + provider.capabilities.execution.totalTimeoutMs;
  while (Date.now() < deadline) {
    const status = await provider.getStatus(submission.providerRunId);
    if (status.status === 'failed') throw Object.assign(new Error(`${status.failure?.code}: ${status.failure?.message}`), { status });
    if (status.status === 'cancelled') throw new Error('Qualification benchmark was unexpectedly cancelled.');
    if (status.status === 'succeeded') {
      const result = await provider.getResult(submission.providerRunId);
      if (!result) throw new Error('Provider succeeded without a normalized benchmark result.');
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  await provider.cancel(submission.providerRunId);
  throw new Error('Qualification benchmark exceeded the provider timeout.');
}

function createRequest(spec: Spec, geometryHash: string, globalSizeMm: number): NeutralSimulationRequest {
  const preparedAt = new Date().toISOString();
  const geometryWithoutDigest = {
    projectRevision: `qualification-${spec.id}-r1`, partId: `qualification-${spec.id}-part`, bodyId: `qualification-${spec.id}-body`, coordinateSpace: 'part_definition_local' as const,
    shape: { valid: true as const, connectedSolidCount: 1 as const, faceCount: spec.faceCount, edgeCount: spec.edgeCount, volumeMm3: spec.volumeMm3, surfaceAreaMm2: spec.surfaceAreaMm2, boundingBoxMm: { min: [0, 0, 0] as NeutralVector3, max: [spec.length, spec.width, spec.height] as NeutralVector3, size: [spec.length, spec.width, spec.height] as NeutralVector3 } },
    references: [faceBinding(spec, 'fixed'), faceBinding(spec, 'load')],
  };
  const geometry = { ...geometryWithoutDigest, geometryDigest: geometryHash };
  const unsigned = {
    schema: 'tunacad-neutral-simulation-request/1.0' as const, studyId: `qualification-${spec.id}-${String(globalSizeMm).replace('.', '_')}`, name: `SIM-2 ${spec.id} benchmark`, preparedAt,
    expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    analysis: { type: 'linear_static' as const, assumptions: ['small_displacement', 'small_strain', 'static_loading', 'homogeneous_material'] as const }, geometry,
    units: { geometry: 'mm' as const, force: 'N' as const, stress: 'MPa' as const, displacement: 'mm' as const, density: 'kg/m^3' as const, acceleration: 'mm/s^2' as const },
    material: { id: 'steel-sim2', name: 'Steel SIM-2', model: 'isotropic_linear_elastic' as const, youngsModulusMPa: 210_000, poissonRatio: 0.3, yieldStrengthMPa: 355, source: { kind: 'custom' as const, reference: 'SIM-2 qualification values' } },
    loads: [{ id: 'terminal-force', name: 'Terminal force', type: 'surface_force' as const, semanticReferenceIds: [`${spec.id}-load-face`], forceN: spec.forceN }],
    constraints: [{ id: 'fixed-end', name: 'Fixed end', type: 'fixed' as const, semanticReferenceIds: [`${spec.id}-fixed-face`] }], contacts: { mode: 'none' as const },
    mesh: { dimensionality: '3d' as const, elementFamily: 'tetrahedral' as const, order: 2 as const, globalSizeMm, minimumSizeMm: Math.min(globalSizeMm / 4, spec.height / 3), maximumNodes: 500_000, maximumElements: 250_000, qualityMetric: 'provider_normalized' as const, minimumQuality: 0.04 },
    requestedResults: ['von_mises_stress', 'displacement', 'reaction_force', 'factor_of_safety', 'critical_regions'] as const,
  };
  return { ...unsigned, requestDigest: digest(unsigned) };
}

function faceBinding(spec: Spec, role: 'fixed' | 'load'): NeutralSimulationRequest['geometry']['references'][number] {
  const x = role === 'fixed' ? 0 : spec.length;
  return {
    semanticReferenceId: `${spec.id}-${role}-face`, ownerPartId: `qualification-${spec.id}-part`, geometryKind: 'FACE', role: role === 'fixed' ? 'constraint' : 'load', sourceFeatureId: 'qualification-fixture', resolutionState: 'valid', resolvedAtProjectRevision: `qualification-${spec.id}-r1`,
    face: { centroidPartLocalMm: [x, spec.width / 2, spec.height / 2], areaMm2: spec.width * spec.height, outwardDirection: [role === 'fixed' ? -1 : 1, 0, 0], geometryType: 'plane', boundingBoxMm: { min: [x, 0, 0], max: [x, spec.width, spec.height] }, edgeCount: 4 },
  };
}

function boxSpec(id: string, length: number, width: number, height: number, forceN: NeutralVector3): Spec {
  return { id, length, width, height, forceN, faceCount: 6, edgeCount: 12, volumeMm3: length * width * height, surfaceAreaMm2: 2 * (length * width + length * height + width * height), geometryScript: [`Box(1) = {0, 0, 0, ${length}, ${width}, ${height}};`] };
}

function plateWithHoleSpec(): Spec {
  const length = 100; const width = 50; const height = 5; const radius = 10;
  return {
    id: 'plate-with-hole', length, width, height, forceN: [1_000, 0, 0], faceCount: 7, edgeCount: 18,
    volumeMm3: length * width * height - Math.PI * radius ** 2 * height,
    surfaceAreaMm2: 2 * (length * width + length * height + width * height) - 2 * Math.PI * radius ** 2 + 2 * Math.PI * radius * height,
    geometryScript: [`Box(1) = {0, 0, 0, ${length}, ${width}, ${height}};`, `Cylinder(2) = {${length / 2}, ${width / 2}, -1, 0, 0, ${height + 2}, ${radius}};`, 'BooleanDifference{ Volume{1}; Delete; }{ Volume{2}; Delete; }'],
  };
}

async function geometryDigest(step: Uint8Array): Promise<string> {
  return `sha256:${createHash('sha256').update(step).digest('hex')}`;
}

function increasingMeshCounts(results: NeutralSimulationResult[]): void {
  const counts = results.map(result => result.provenance.mesh?.elementCount ?? 0);
  assert.ok(counts[0] > 0 && counts[0] < counts[1] && counts[1] < counts[2], `Mesh refinement counts are not strictly increasing: ${counts.join(', ')}.`);
}

function assertReactionBalance(result: NeutralSimulationResult, force: NeutralVector3): void {
  const reaction = result.reactions.reduce<NeutralVector3>((sum, item) => [sum[0] + item.forceN[0], sum[1] + item.forceN[1], sum[2] + item.forceN[2]], [0, 0, 0]);
  const residual = Math.hypot(reaction[0] + force[0], reaction[1] + force[1], reaction[2] + force[2]);
  assert.ok(residual <= Math.max(1e-6, Math.hypot(...force) * 1e-4), `Reaction residual ${residual} N exceeds the qualification tolerance.`);
}

function requiredMetric(value: number | null, label: string): number {
  if (!Number.isFinite(value) || value === null) throw new Error(`${label} is not finite.`);
  return value;
}

function relativeChange(from: number | null, to: number | null): number {
  const a = requiredMetric(from, 'comparison source'); const b = requiredMetric(to, 'comparison target');
  return Math.abs(b - a) / Math.max(Math.abs(b), 1e-12);
}

function relativeSpread(values: number[]): number {
  return (Math.max(...values) - Math.min(...values)) / Math.max(...values.map(Math.abs), 1);
}

function assertRepeatable(values: number[], tolerance: number, label: string): void {
  const spread = relativeSpread(values);
  assert.ok(spread <= tolerance, `${label} repeatability spread ${spread} exceeds ${tolerance}.`);
}
