import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExternalSimulationProvider, NeutralSimulationLoad, NeutralSimulationRequest, NeutralSimulationResult, NeutralVector3 } from '../src/simulation/externalSimulationContracts.ts';
import { loadExternalPipeline } from '../simulation-bridge/providers.mts';
import { digest } from '../simulation-bridge/requestValidation.mts';

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (!gmsh || !calculix) throw new Error('Set TUNACAD_GMSH_EXECUTABLE and TUNACAD_CALCULIX_EXECUTABLE to run linear-superposition acceptance.');
const pipeline = await loadExternalPipeline(gmsh, calculix);
if (!pipeline.provider || !pipeline.readiness.ready) throw new Error('Gmsh and CalculiX must pass readiness before linear-superposition acceptance.');

const directory = await mkdtemp(join(tmpdir(), 'tunacad-load-superposition-'));
const forceA = surfaceForce('load-a', 100);
const forceB = surfaceForce('load-b', 150);
const forceNegativeA = surfaceForce('load-negative-a', -100);

try {
  const stepPath = join(directory, 'axial-bar.step');
  const geoPath = join(directory, 'axial-bar.geo');
  const output = stepPath.replace(/\\/g, '/').replace(/"/g, '\\"');
  await writeFile(geoPath, ['SetFactory("OpenCASCADE");', 'Box(1) = {0, 0, 0, 100, 10, 10};', `Save "${output}";`].join('\n'), 'utf8');
  execFileSync(gmsh, [geoPath, '-0', '-v', '2'], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const step = new Uint8Array(await readFile(stepPath));
  const geometryHash = `sha256:${createHash('sha256').update(step).digest('hex')}`;

  const resultA = await run(pipeline.provider, request('a', [forceA], geometryHash), step);
  const resultB = await run(pipeline.provider, request('b', [forceB], geometryHash), step);
  const combinedAB = await run(pipeline.provider, request('combined-ab', [forceA, forceB], geometryHash), step);
  const combinedBA = await run(pipeline.provider, request('combined-ba', [forceB, forceA], geometryHash), step);

  assertAdditiveMetric(resultA.metrics.maximumDisplacementMm, resultB.metrics.maximumDisplacementMm, combinedAB.metrics.maximumDisplacementMm, 'maximum displacement');
  assertAdditiveMetric(resultA.metrics.maximumVonMisesStressMPa, resultB.metrics.maximumVonMisesStressMPa, combinedAB.metrics.maximumVonMisesStressMPa, 'maximum von Mises stress');
  assertVectorClose(reaction(combinedAB), add(reaction(resultA), reaction(resultB)), 2e-5, 'Combined reaction must equal the sum of independent reactions.');
  assertEquivalentResult(combinedAB, combinedBA, 'Reversing load-array order must not change the physical result.');

  const cancelled = await run(pipeline.provider, request('cancelled', [forceA, forceNegativeA], geometryHash), step);
  assert.equal(cancelled.metrics.minimumFactorOfSafety, null, 'A zero-stress cancellation case must not publish infinite factor of safety.');
  assert.ok((cancelled.metrics.maximumDisplacementMm ?? Infinity) <= 1e-12, `Cancelled displacement is not zero: ${cancelled.metrics.maximumDisplacementMm}.`);
  assert.ok((cancelled.metrics.maximumVonMisesStressMPa ?? Infinity) <= 1e-9, `Cancelled stress is not zero: ${cancelled.metrics.maximumVonMisesStressMPa}.`);
  assertVectorClose(reaction(cancelled), [0, 0, 0], 1e-9, 'Equal and opposite coincident loads must produce zero reaction.');

  console.log(JSON.stringify({
    independentForceN: [100, 150], combinedForceN: 250,
    displacementMm: [resultA.metrics.maximumDisplacementMm, resultB.metrics.maximumDisplacementMm, combinedAB.metrics.maximumDisplacementMm],
    stressMPa: [resultA.metrics.maximumVonMisesStressMPa, resultB.metrics.maximumVonMisesStressMPa, combinedAB.metrics.maximumVonMisesStressMPa],
    combinedReactionN: reaction(combinedAB), cancellationReactionN: reaction(cancelled),
  }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}

function surfaceForce(id: string, forceX: number): NeutralSimulationLoad {
  return { id, name: id, type: 'surface_force', semanticReferenceIds: ['axial-load-face'], forceN: [forceX, 0, 0] };
}

function request(label: string, loads: NeutralSimulationLoad[], geometryDigest: string): NeutralSimulationRequest {
  const preparedAt = new Date().toISOString();
  const geometry = {
    projectRevision: 'superposition-r1', partId: 'superposition-part', bodyId: 'superposition-body', geometryDigest,
    coordinateSpace: 'part_definition_local' as const,
    shape: { valid: true as const, connectedSolidCount: 1 as const, faceCount: 6, edgeCount: 12, volumeMm3: 10_000, surfaceAreaMm2: 4_200,
      boundingBoxMm: { min: [0, 0, 0] as NeutralVector3, max: [100, 10, 10] as NeutralVector3, size: [100, 10, 10] as NeutralVector3 } },
    references: [faceBinding('fixed'), faceBinding('load')],
  };
  const unsigned = {
    schema: 'tunacad-neutral-simulation-request/1.0' as const, studyId: `superposition-${label}`, name: `Linear superposition ${label}`,
    preparedAt, expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    analysis: { type: 'linear_static' as const, assumptions: ['small_displacement', 'small_strain', 'static_loading', 'homogeneous_material'] as const }, geometry,
    units: { geometry: 'mm' as const, force: 'N' as const, stress: 'MPa' as const, displacement: 'mm' as const, density: 'kg/m^3' as const, acceleration: 'mm/s^2' as const },
    material: { id: 'steel', name: 'Steel', model: 'isotropic_linear_elastic' as const, youngsModulusMPa: 210_000, poissonRatio: 0.3, yieldStrengthMPa: 355, source: { kind: 'custom' as const, reference: 'superposition acceptance' } },
    loads, constraints: [{ id: 'fixed-end', name: 'Fixed end', type: 'fixed' as const, semanticReferenceIds: ['axial-fixed-face'] }], contacts: { mode: 'none' as const },
    mesh: { dimensionality: '3d' as const, elementFamily: 'tetrahedral' as const, order: 2 as const, globalSizeMm: 5, minimumSizeMm: 1.25, maximumNodes: 500_000, maximumElements: 250_000, qualityMetric: 'provider_normalized' as const, minimumQuality: 0.04 },
    requestedResults: ['von_mises_stress', 'displacement', 'reaction_force', 'factor_of_safety', 'critical_regions'] as const,
  };
  return { ...unsigned, requestDigest: digest(unsigned) };
}

function faceBinding(role: 'fixed' | 'load'): NeutralSimulationRequest['geometry']['references'][number] {
  const x = role === 'fixed' ? 0 : 100;
  return {
    semanticReferenceId: `axial-${role}-face`, ownerPartId: 'superposition-part', geometryKind: 'FACE', role: role === 'fixed' ? 'constraint' : 'load',
    sourceFeatureId: 'axial-bar', resolutionState: 'valid', resolvedAtProjectRevision: 'superposition-r1',
    face: { centroidPartLocalMm: [x, 5, 5], areaMm2: 100, outwardDirection: [role === 'fixed' ? -1 : 1, 0, 0], geometryType: 'plane', boundingBoxMm: { min: [x, 0, 0], max: [x, 10, 10] }, edgeCount: 4 },
  };
}

async function run(provider: ExternalSimulationProvider, simulationRequest: NeutralSimulationRequest, step: Uint8Array): Promise<NeutralSimulationResult> {
  const submission = await provider.submit(simulationRequest, { descriptor: simulationRequest.geometry, async export() { return step; } });
  const deadline = Date.now() + provider.capabilities.execution.totalTimeoutMs;
  while (Date.now() < deadline) {
    const status = await provider.getStatus(submission.providerRunId);
    if (status.status === 'failed') throw new Error(`${status.failure?.code}: ${status.failure?.message}`);
    if (status.status === 'cancelled') throw new Error('Superposition run was unexpectedly cancelled.');
    if (status.status === 'succeeded') {
      const result = await provider.getResult(submission.providerRunId);
      if (!result) throw new Error('Provider succeeded without a normalized superposition result.');
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  await provider.cancel(submission.providerRunId);
  throw new Error('Superposition run exceeded the provider timeout.');
}

function reaction(result: NeutralSimulationResult): NeutralVector3 {
  return result.reactions.reduce<NeutralVector3>((sum, item) => add(sum, item.forceN), [0, 0, 0]);
}

function add(a: NeutralVector3, b: NeutralVector3): NeutralVector3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }

function assertAdditiveMetric(a: number | null, b: number | null, combined: number | null, label: string): void {
  assert.notEqual(a, null); assert.notEqual(b, null); assert.notEqual(combined, null);
  const expected = a! + b!;
  assert.ok(Math.abs(combined! - expected) <= Math.max(1e-10, expected * 2e-5), `${label} is not additive: ${a} + ${b} != ${combined}.`);
}

function assertEquivalentResult(a: NeutralSimulationResult, b: NeutralSimulationResult, message: string): void {
  assertRelativeClose(a.metrics.maximumDisplacementMm, b.metrics.maximumDisplacementMm, 1e-10, message);
  assertRelativeClose(a.metrics.maximumVonMisesStressMPa, b.metrics.maximumVonMisesStressMPa, 1e-10, message);
  assertVectorClose(reaction(a), reaction(b), 1e-10, message);
}

function assertRelativeClose(a: number | null, b: number | null, tolerance: number, message: string): void {
  assert.notEqual(a, null); assert.notEqual(b, null);
  assert.ok(Math.abs(a! - b!) <= Math.max(1e-12, Math.max(Math.abs(a!), Math.abs(b!)) * tolerance), `${message} Received ${a} and ${b}.`);
}

function assertVectorClose(actual: NeutralVector3, expected: NeutralVector3, relativeTolerance: number, message: string): void {
  const scale = Math.max(1, Math.hypot(...actual), Math.hypot(...expected));
  assert.ok(Math.hypot(actual[0] - expected[0], actual[1] - expected[1], actual[2] - expected[2]) <= scale * relativeTolerance,
    `${message} Received ${actual.join(', ')}, expected ${expected.join(', ')}.`);
}
