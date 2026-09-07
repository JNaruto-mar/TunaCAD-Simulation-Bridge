import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildConstraintSets, createInputDeck } from '../providers/calculix/CalculiXSolverProvider.mts';
import { loadExternalPipeline } from '../simulation-bridge/providers.mts';
import { digest, validateRequest } from '../simulation-bridge/requestValidation.mts';
import type { ExternalSimulationProvider, NeutralFemMesh, NeutralSimulationRequest, NeutralSimulationResult, NeutralVector3 } from '../src/simulation/externalSimulationContracts.ts';

testSharedEdgeConstraintSemantics();

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (!gmsh || !calculix) throw new Error('Set TUNACAD_GMSH_EXECUTABLE and TUNACAD_CALCULIX_EXECUTABLE to run FACE-group acceptance.');
const pipeline = await loadExternalPipeline(gmsh, calculix);
if (!pipeline.provider || !pipeline.readiness.ready) throw new Error('Gmsh and CalculiX must pass readiness before FACE-group acceptance.');

const directory = await mkdtemp(join(tmpdir(), 'tunacad-face-groups-'));
try {
  const stepPath = join(directory, 'face-group-box.step');
  const geoPath = join(directory, 'face-group-box.geo');
  const output = stepPath.replace(/\\/g, '/').replace(/"/g, '\\"');
  await writeFile(geoPath, ['SetFactory("OpenCASCADE");', 'Box(1) = {0, 0, 0, 100, 10, 10};', `Save "${output}";`].join('\n'), 'utf8');
  execFileSync(gmsh, [geoPath, '-0', '-v', '2'], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const step = new Uint8Array(await readFile(stepPath));
  const groupedRequest = request('grouped', true);
  const duplicateReference = structuredClone(groupedRequest);
  duplicateReference.loads[0].semanticReferenceIds.push('box-right-face');
  const { requestDigest: _oldDigest, ...unsignedDuplicate } = duplicateReference;
  duplicateReference.requestDigest = digest(unsignedDuplicate);
  assert.throws(() => validateRequest(duplicateReference), /BRIDGE_REQUEST_INVALID/);

  const grouped = await run(pipeline.provider, groupedRequest, step);
  const split = await run(pipeline.provider, request('split', false), step);
  assertRelativeClose(grouped.metrics.maximumDisplacementMm, split.metrics.maximumDisplacementMm, 2e-8, 'Grouped and split displacement differ.');
  assertRelativeClose(grouped.metrics.maximumVonMisesStressMPa, split.metrics.maximumVonMisesStressMPa, 2e-8, 'Grouped and split stress differ.');
  assertVectorClose(totalReaction(grouped), totalReaction(split), 1e-6, 'Grouped and split total reactions differ.');
  assertVectorClose(totalReaction(grouped), [0, 0, 110], 2e-5, 'Grouped reaction does not balance the declared total surface force.');
  assert.equal(grouped.reactions.length, 1);
  assert.deepEqual(grouped.reactions[0].semanticReferenceIds, ['box-left-face', 'box-bottom-face']);
  assert.equal(split.reactions.length, 2);

  console.log(JSON.stringify({
    groupedConstraintReferences: 2,
    groupedLoadReferences: 2,
    groupedReactionN: totalReaction(grouped),
    splitReactionN: totalReaction(split),
    maximumDisplacementMm: grouped.metrics.maximumDisplacementMm,
    maximumVonMisesStressMPa: grouped.metrics.maximumVonMisesStressMPa,
  }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}

function testSharedEdgeConstraintSemantics(): void {
  const mesh = {
    nodes: [
      [0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10],
      [5, 0, 0], [5, 5, 0], [0, 5, 0], [0, 0, 5], [0, 5, 5], [5, 0, 5],
    ],
    element: { family: 'tetrahedral', geometryOrder: 2, solutionOrder: 2 },
    volumeElements: { connectivity: [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]], regionIds: ['solid'] },
    boundaryFacets: { connectivity: [
      [0, 1, 2, 4, 5, 6],
      [0, 1, 3, 4, 9, 7],
      [1, 2, 3, 5, 8, 9],
    ], regionIds: ['constraint-a', 'constraint-b', 'load'] },
    boundaryRegions: [
      region('constraint-a', 'face-a', [0]),
      region('constraint-b', 'face-b', [1]),
      region('constraint-alias', 'face-alias', [0]),
      region('load', 'load-face', [2]),
    ],
  } as unknown as NeutralFemMesh;
  const constraints: NeutralSimulationRequest['constraints'] = [
    { id: 'z-fixed', name: 'First fixed face', type: 'fixed', semanticReferenceIds: ['face-a'] },
    { id: 'a-fixed', name: 'Second fixed face', type: 'fixed', semanticReferenceIds: ['face-b'] },
  ];
  const sets = buildConstraintSets(constraints, mesh);
  assert.deepEqual(sets[0].nodes.filter(node => sets[1].nodes.includes(node)), [0, 1, 4]);
  assert.deepEqual(sets[0].reactionNodes.filter(node => sets[1].reactionNodes.includes(node)), []);
  assert.deepEqual([...sets[0].reactionNodes, ...sets[1].reactionNodes].sort((a, b) => a - b), [...new Set([...sets[0].nodes, ...sets[1].nodes])].sort((a, b) => a - b));
  assert.ok(sets[1].reactionNodes.includes(0), 'Stable constraint-ID order must own shared reaction nodes.');

  const base = {
    studyId: 'shared-edge-unit', analysis: { type: 'linear_static' },
    material: { model: 'isotropic_linear_elastic', youngsModulusMPa: 210_000, poissonRatio: 0.3 },
    loads: [{ id: 'load', name: 'Load', type: 'surface_force', semanticReferenceIds: ['load-face'], forceN: [0, 0, -1] }],
    constraints,
  } as unknown as NeutralSimulationRequest;
  const deck = createInputDeck(base, mesh);
  assert.match(deck, /\*NSET, NSET=REACTION_001[\s\S]*\*NSET, NSET=REACTION_002/);
  assert.match(deck, /\*NODE PRINT, NSET=REACTION_001, TOTALS=ONLY/);
  assert.match(deck, /\*NODE PRINT, NSET=REACTION_002, TOTALS=ONLY/);

  const conflicting = structuredClone(base);
  conflicting.constraints[1] = { id: 'a-driven', name: 'Conflicting edge', type: 'prescribed_displacement', semanticReferenceIds: ['face-b'], displacementMm: [0.1, null, null] };
  assert.throws(() => createInputDeck(conflicting, mesh), { code: 'SIMULATION_CONSTRAINT_INVALID' });

  const overlapping = structuredClone(base);
  overlapping.constraints[1] = { id: 'a-alias', name: 'Overlapping facet', type: 'fixed', semanticReferenceIds: ['face-alias'] };
  assert.throws(() => createInputDeck(overlapping, mesh), { code: 'SIMULATION_CONSTRAINT_INVALID' });
}

function region(regionId: string, semanticReferenceId: string, facetIndices: number[]): NeutralFemMesh['boundaryRegions'][number] {
  return {
    regionId, semanticReferenceIds: [semanticReferenceId], sourceFeatureIds: [], facetIndices,
    matchedCadFace: {} as never,
    match: { state: 'verified', method: 'geometric_signature', candidateCount: 1, centroidToleranceMm: 0.1, areaRelativeTolerance: 0.01 },
  };
}

function request(label: string, grouped: boolean): NeutralSimulationRequest {
  const preparedAt = new Date().toISOString();
  const geometryWithoutDigest = {
    projectRevision: 'face-groups-r1', partId: 'face-group-part', bodyId: 'face-group-body',
    coordinateSpace: 'part_definition_local' as const,
    shape: { valid: true as const, connectedSolidCount: 1 as const, faceCount: 6, edgeCount: 12, volumeMm3: 10_000, surfaceAreaMm2: 4_200,
      boundingBoxMm: { min: [0, 0, 0] as NeutralVector3, max: [100, 10, 10] as NeutralVector3, size: [100, 10, 10] as NeutralVector3 } },
    references: [
      faceBinding('box-left-face', 'constraint', [0, 5, 5], 100, [-1, 0, 0], [0, 0, 0], [0, 10, 10]),
      faceBinding('box-bottom-face', 'constraint', [50, 0, 5], 1_000, [0, -1, 0], [0, 0, 0], [100, 0, 10]),
      faceBinding('box-right-face', 'load', [100, 5, 5], 100, [1, 0, 0], [100, 0, 0], [100, 10, 10]),
      faceBinding('box-top-face', 'load', [50, 10, 5], 1_000, [0, 1, 0], [0, 10, 0], [100, 10, 10]),
    ],
  };
  const geometry = { ...geometryWithoutDigest, geometryDigest: digest(geometryWithoutDigest) };
  const unsigned = {
    schema: 'tunacad-neutral-simulation-request/1.0' as const, studyId: `face-groups-${label}`, name: `FACE groups ${label}`,
    preparedAt, expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    analysis: { type: 'linear_static' as const, assumptions: ['small_displacement', 'small_strain', 'static_loading', 'homogeneous_material'] as const }, geometry,
    units: { geometry: 'mm' as const, force: 'N' as const, stress: 'MPa' as const, displacement: 'mm' as const, density: 'kg/m^3' as const, acceleration: 'mm/s^2' as const },
    material: { id: 'steel', name: 'Steel', model: 'isotropic_linear_elastic' as const, youngsModulusMPa: 210_000, poissonRatio: 0.3, yieldStrengthMPa: 355, source: { kind: 'custom' as const, reference: 'FACE-group acceptance' } },
    loads: grouped
      ? [{ id: 'load-group', name: 'Two-face total force', type: 'surface_force' as const, semanticReferenceIds: ['box-right-face', 'box-top-face'], forceN: [0, 0, -110] as NeutralVector3 }]
      : [
        { id: 'load-right', name: 'Area-proportional right force', type: 'surface_force' as const, semanticReferenceIds: ['box-right-face'], forceN: [0, 0, -10] as NeutralVector3 },
        { id: 'load-top', name: 'Area-proportional top force', type: 'surface_force' as const, semanticReferenceIds: ['box-top-face'], forceN: [0, 0, -100] as NeutralVector3 },
      ],
    constraints: grouped
      ? [{ id: 'fixed-group', name: 'Two-face fixed group', type: 'fixed' as const, semanticReferenceIds: ['box-left-face', 'box-bottom-face'] }]
      : [
        { id: 'fixed-left', name: 'Fixed left', type: 'fixed' as const, semanticReferenceIds: ['box-left-face'] },
        { id: 'fixed-bottom', name: 'Fixed bottom', type: 'fixed' as const, semanticReferenceIds: ['box-bottom-face'] },
      ],
    contacts: { mode: 'none' as const },
    mesh: { dimensionality: '3d' as const, elementFamily: 'tetrahedral' as const, order: 2 as const, globalSizeMm: 5, minimumSizeMm: 1.25, maximumNodes: 500_000, maximumElements: 250_000, qualityMetric: 'provider_normalized' as const, minimumQuality: 0.04 },
    requestedResults: ['von_mises_stress', 'displacement', 'reaction_force', 'factor_of_safety', 'critical_regions'] as const,
  };
  return { ...unsigned, requestDigest: digest(unsigned) };
}

function faceBinding(
  semanticReferenceId: string,
  role: 'load' | 'constraint',
  centroidPartLocalMm: NeutralVector3,
  areaMm2: number,
  outwardDirection: NeutralVector3,
  min: NeutralVector3,
  max: NeutralVector3,
): NeutralSimulationRequest['geometry']['references'][number] {
  return { semanticReferenceId, ownerPartId: 'face-group-part', geometryKind: 'FACE', role, sourceFeatureId: 'box', resolutionState: 'valid', resolvedAtProjectRevision: 'face-groups-r1',
    face: { centroidPartLocalMm, areaMm2, outwardDirection, geometryType: 'plane', boundingBoxMm: { min, max }, edgeCount: 4 } };
}

async function run(provider: ExternalSimulationProvider, simulationRequest: NeutralSimulationRequest, step: Uint8Array): Promise<NeutralSimulationResult> {
  validateRequest(simulationRequest);
  const submission = await provider.submit(simulationRequest, { descriptor: simulationRequest.geometry, async export() { return step; } });
  const deadline = Date.now() + provider.capabilities.execution.totalTimeoutMs;
  while (Date.now() < deadline) {
    const status = await provider.getStatus(submission.providerRunId);
    if (status.status === 'failed') throw new Error(`${status.failure?.code}: ${status.failure?.message}`);
    if (status.status === 'cancelled') throw new Error('FACE-group run was unexpectedly cancelled.');
    if (status.status === 'succeeded') {
      const result = await provider.getResult(submission.providerRunId);
      if (!result) throw new Error('Provider succeeded without a normalized FACE-group result.');
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  await provider.cancel(submission.providerRunId);
  throw new Error('FACE-group run exceeded the provider timeout.');
}

function totalReaction(result: NeutralSimulationResult): NeutralVector3 {
  return result.reactions.reduce<NeutralVector3>((sum, reaction) => [sum[0] + reaction.forceN[0], sum[1] + reaction.forceN[1], sum[2] + reaction.forceN[2]], [0, 0, 0]);
}

function assertRelativeClose(a: number | null, b: number | null, tolerance: number, message: string): void {
  assert.notEqual(a, null); assert.notEqual(b, null);
  const scale = Math.max(1, Math.abs(a!), Math.abs(b!));
  assert.ok(Math.abs(a! - b!) <= scale * tolerance, `${message} Received ${a} and ${b}.`);
}

function assertVectorClose(actual: NeutralVector3, expected: NeutralVector3, relativeTolerance: number, message: string): void {
  const scale = Math.max(1, Math.hypot(...actual), Math.hypot(...expected));
  assert.ok(Math.hypot(actual[0] - expected[0], actual[1] - expected[1], actual[2] - expected[2]) <= scale * relativeTolerance,
    `${message} Received ${actual.join(', ')}, expected ${expected.join(', ')}.`);
}
