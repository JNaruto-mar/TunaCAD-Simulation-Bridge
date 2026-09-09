import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCalculiXInputDeckV2 } from '../providers/calculix/CalculiXMultiDomainDeck.mts';
import { CalculiXMultiDomainSolverProvider } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { GmshMultiDomainMeshProvider } from '../providers/gmsh/GmshMultiDomainMeshProvider.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { admitV2SimulationRequest, sealNeutralSimulationRequestV2, validateNeutralSimulationRequestV2 } from '../simulation-bridge/v2Validation.mts';
import type { NeutralSimulationRequestV2, NeutralVector3 } from '../src/simulation/externalSimulationContracts.ts';

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (!gmsh || !calculix) throw new Error('Set TUNACAD_GMSH_EXECUTABLE and TUNACAD_CALCULIX_EXECUTABLE to run SIM-5 modal acceptance.');

const directory = await mkdtemp(join(tmpdir(), 'tunacad-sim5-modal-'));
try {
  const stepPath = join(directory, 'cantilever.step');
  const geoPath = join(directory, 'cantilever.geo');
  await writeFile(geoPath, `SetFactory("OpenCASCADE");\nBox(1) = {0, 0, 0, 100, 10, 5};\nSave "${stepPath.replace(/\\/g, '/')}";\n`, 'utf8');
  execFileSync(gmsh, [geoPath, '-0', '-v', '2'], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const step = new Uint8Array(await readFile(stepPath));
  const request = modalRequest();
  validateNeutralSimulationRequestV2(request);
  const densityless: any = structuredClone(request); delete densityless.materials[0].densityKgM3; reseal(densityless);
  assert.throws(() => validateNeutralSimulationRequestV2(densityless), /BRIDGE_V2_MODAL_REQUEST_INVALID/);
  const loaded: any = structuredClone(request); loaded.loads = [{ id: 'gravity', name: 'Forbidden modal load', type: 'gravity', accelerationMmPerS2: [0, 0, -9806.65], coordinateSystem: 'analysis' }]; reseal(loaded);
  assert.throws(() => validateNeutralSimulationRequestV2(loaded), /BRIDGE_V2_MODAL_REQUEST_INVALID/);
  const mesher = new GmshMultiDomainMeshProvider({ executable: gmsh, runtimeVersion: '4.15.2' });
  const model = await mesher.mesh(request, { descriptor: request.model, async exportDomain() { return step; } });
  assert.equal(model.domainRegions.length, 1, 'SIM-5 must admit a single explicitly owned domain through v2.');
  const deck = createCalculiXInputDeckV2(request, model);
  assert.match(deck, /^\*FREQUENCY,SOLVER=ARPACK\n6,0,2000$/m);
  assert.match(deck, /^\*NODE FILE, NSET=NALL, GLOBAL=YES\nU$/m);
  assert.doesNotMatch(deck, /^\*(?:STATIC|CLOAD|DLOAD)$/m);

  const solver = new CalculiXMultiDomainSolverProvider({ executable: calculix, runtimeVersion: '2.16' });
  assert.deepEqual(admitV2SimulationRequest(request, solver.capabilities), { accepted: true });
  const noModalProfile: any = structuredClone(solver.capabilities); delete noModalProfile.study.modal;
  assert.equal(admitV2SimulationRequest(request, noModalProfile).accepted, false, 'Modal transfer must fail before geometry when provider admission omits modal support.');
  const submission = await solver.submit(request, model);
  const result = await waitForResult(solver, submission.providerRunId);
  assert.equal(result.analysisType, 'modal');
  if (result.analysisType !== 'modal') throw new Error('Expected modal result.');
  assert.ok(result.modal.modes.length >= 1 && result.modal.modes.length <= 6);
  assert.ok(result.modal.modes.every(mode => mode.frequencyHz <= 2000), 'The upper frequency bound must filter returned modes.');
  assert.equal(result.modal.rigidBodyModeDiagnostics.modeNumbers.length, 0, 'A fixed cantilever must not contain rigid-body modes.');
  const beta1 = 1.875104068711961;
  const expectedHz = beta1 ** 2 / (2 * Math.PI * 0.1 ** 2) * Math.sqrt(210e9 * (0.01 * 0.005 ** 3 / 12) / (7850 * 0.01 * 0.005));
  const relativeError = Math.abs(result.modal.modes[0].frequencyHz - expectedHz) / expectedHz;
  assert.ok(relativeError < 0.18, `First bending frequency differs from Euler-Bernoulli by ${(relativeError * 100).toFixed(2)}%.`);
  assert.ok(result.modal.modes.every(mode => mode.participationFactors.every(Number.isFinite) && mode.effectiveModalMass.every(value => Number.isFinite(value) && value >= 0)));
  assert.ok(result.modal.effectiveMassCoverage.every(value => Number.isFinite(value) && value >= 0));
  const datasetId = result.modal.modes[0].fieldDatasetIds[0];
  let cursor: string | undefined = '0'; const magnitudes: number[] = [];
  do {
    const page = await solver.getFieldDataset(submission.providerRunId, datasetId, cursor, 23);
    assert.equal(page.dataset.analysisType, 'modal'); assert.equal(page.dataset.component, 'mode_shape_magnitude');
    assert.equal(page.dataset.step.modeNumber, 1); assert.equal(page.dataset.step.frequencyHz, result.modal.modes[0].frequencyHz);
    for (const triangle of page.triangles) magnitudes.push(...triangle.values);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  assert.ok(Math.max(...magnitudes) > 0.999 && Math.max(...magnitudes) <= 1.000001, 'Visualization eigenvector must use deterministic max-vector normalization.');
  console.log(JSON.stringify({ expectedFirstFrequencyHz: expectedHz, calculatedFirstFrequencyHz: result.modal.modes[0].frequencyHz, relativeError, modes: result.modal.modes.map(mode => mode.frequencyHz), effectiveMassCoverage: result.modal.effectiveMassCoverage }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}

function modalRequest(): NeutralSimulationRequestV2 {
  const projectRevision = 'sim5-modal-r1'; const domainId = 'cantilever-domain'; const occurrenceId = 'cantilever:1';
  const geometryDigest = digest({ fixture: '100x10x5-cantilever' });
  return sealNeutralSimulationRequestV2({
    schema: 'tunacad-neutral-simulation-request/2.0', studyId: 'sim5-constrained-cantilever', name: 'Constrained steel cantilever modes',
    preparedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    analysis: { type: 'modal', assumptions: ['linear_elasticity', 'undamped_free_vibration'], settings: { requestedModeCount: 6, minimumFrequencyHz: 0, maximumFrequencyHz: 2000, massFormulation: 'consistent' } },
    model: {
      projectRevision, coordinateSpace: 'frozen_analysis',
      domains: [{ domainId, partId: 'cantilever', bodyId: 'body', occurrenceId, geometryDigest, transformToAnalysis: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        shape: { valid: true, connectedSolidCount: 1, faceCount: 6, edgeCount: 12, volumeMm3: 5000, surfaceAreaMm2: 3100, boundingBoxOwnerLocalMm: { min: [0, 0, 0], max: [100, 10, 5], size: [100, 10, 5] } } }],
      references: [{ semanticReferenceId: 'fixed-end', domainId, ownerPartId: 'cantilever', ownerBodyId: 'body', occurrenceId, geometryKind: 'FACE', role: 'constraint', sourceFeatureId: 'box', resolutionState: 'valid', resolvedAtProjectRevision: projectRevision,
        faceOwnerLocal: { centroidPartLocalMm: [0, 5, 2.5], areaMm2: 50, outwardDirection: [-1, 0, 0], geometryType: 'plane', edgeCount: 4, boundingBoxMm: { min: [0, 0, 0], max: [0, 10, 5] } } }],
    },
    units: { geometry: 'mm', force: 'N', stress: 'MPa', displacement: 'mm', density: 'kg/m^3', acceleration: 'mm/s^2' },
    materials: [{ id: 'steel', name: 'Steel', model: 'isotropic_linear_elastic', densityKgM3: 7850, youngsModulusMPa: 210000, poissonRatio: 0.3, source: { kind: 'custom', reference: 'SIM-5 fixture' } }],
    materialAssignments: [{ assignmentId: 'assign-steel', domainId, materialId: 'steel', volumeRegionId: 'cantilever-volume' }],
    loads: [], constraints: [{ id: 'fixed-support', name: 'Fixed end', type: 'fixed', semanticReferenceIds: ['fixed-end'] }], interactions: [],
    mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2, globalSizeMm: 7, minimumSizeMm: 2, maximumNodes: 100000, maximumElements: 50000, qualityMetric: 'provider_normalized', minimumQuality: 0.04 },
    requestedResults: ['natural_frequencies', 'mode_shapes', 'participation_factors', 'effective_modal_mass'],
  });
}

function reseal(request: any): void {
  const sealed = sealNeutralSimulationRequestV2({ ...request, requestDigest: undefined, model: { ...request.model, modelDigest: undefined, domains: request.model.domains.map((domain: any) => ({ ...domain, domainDigest: undefined })) } });
  Object.assign(request, sealed);
}

async function waitForResult(solver: CalculiXMultiDomainSolverProvider, providerRunId: string) {
  const deadline = Date.now() + solver.capabilities.execution.totalTimeoutMs;
  while (Date.now() < deadline) {
    const status = await solver.getStatus(providerRunId);
    if (status.status === 'failed') throw new Error(`${status.failure?.code}: ${status.failure?.message}`);
    if (status.status === 'succeeded') { const result = await solver.getResult(providerRunId); if (!result) throw new Error('Modal solve completed without a result.'); return result; }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  await solver.cancel(providerRunId); throw new Error('SIM-5 modal provider timed out.');
}
