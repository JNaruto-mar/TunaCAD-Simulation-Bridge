import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CalculiXMultiDomainSolverProvider } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { GmshMultiDomainMeshProvider } from '../providers/gmsh/GmshMultiDomainMeshProvider.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { sealNeutralSimulationRequestV2 } from '../simulation-bridge/v2Validation.mts';
import type { NeutralSimulationRequestV2 } from '../src/simulation/externalSimulationContracts.ts';

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (!gmsh || !calculix) throw new Error('Set TUNACAD_GMSH_EXECUTABLE and TUNACAD_CALCULIX_EXECUTABLE to run SIM-5 modal qualification.');

const directory = await mkdtemp(join(tmpdir(), 'tunacad-sim5-plate-'));
try {
  const stepPath = join(directory, 'clamped-plate.step');
  const geoPath = join(directory, 'clamped-plate.geo');
  await writeFile(geoPath, `SetFactory("OpenCASCADE");\nBox(1) = {0, 0, 0, 100, 100, 2};\nSave "${stepPath.replace(/\\/g, '/')}";\n`, 'utf8');
  execFileSync(gmsh, [geoPath, '-0', '-v', '2'], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const step = new Uint8Array(await readFile(stepPath));
  const mesher = new GmshMultiDomainMeshProvider({ executable: gmsh, runtimeVersion: '4.15.2' });
  const solver = new CalculiXMultiDomainSolverProvider({ executable: calculix, runtimeVersion: '2.16' });
  const levels = [14, 10, 7] as const;
  const samples: Array<{ globalSizeMm: number; nodeCount: number; elementCount: number; firstFrequencyHz: number }> = [];
  for (const globalSizeMm of levels) {
    const request = plateRequest(globalSizeMm);
    const model = await mesher.mesh(request, { descriptor: request.model, async exportDomain() { return step; } });
    const submission = await solver.submit(request, model);
    const result = await waitForResult(solver, submission.providerRunId);
    assert.equal(result.analysisType, 'modal');
    if (result.analysisType !== 'modal') throw new Error('Expected modal plate result.');
    assert.deepEqual(result.modal.rigidBodyModeDiagnostics.modeNumbers, []);
    assert.equal(result.modal.rigidBodyModeDiagnostics.status, 'complete');
    samples.push({ globalSizeMm, nodeCount: model.nodes.length, elementCount: model.volumeElements.connectivity.length, firstFrequencyHz: result.modal.modes[0].frequencyHz });
  }

  const sideM = 0.1; const thicknessM = 0.002; const youngsModulusPa = 210e9; const poissonRatio = 0.3; const densityKgM3 = 7850;
  const flexuralRigidity = youngsModulusPa * thicknessM ** 3 / (12 * (1 - poissonRatio ** 2));
  const analyticalFrequencyHz = 35.99 / (2 * Math.PI * sideM ** 2) * Math.sqrt(flexuralRigidity / (densityKgM3 * thicknessM));
  const fineRelativeError = Math.abs(samples[2].firstFrequencyHz - analyticalFrequencyHz) / analyticalFrequencyHz;
  const analyticalRelativeErrors = samples.map(sample => Math.abs(sample.firstFrequencyHz - analyticalFrequencyHz) / analyticalFrequencyHz);
  const coarseToMediumChange = Math.abs(samples[1].firstFrequencyHz - samples[0].firstFrequencyHz) / samples[1].firstFrequencyHz;
  const mediumToFineChange = Math.abs(samples[2].firstFrequencyHz - samples[1].firstFrequencyHz) / samples[2].firstFrequencyHz;
  console.log(JSON.stringify({ fixture: 'fully-clamped-square-thin-plate', boundaryAssumption: 'all four thickness edge faces fixed', analyticalModel: 'Kirchhoff-Love thin plate, clamped square coefficient 35.99', analyticalFrequencyHz, analyticalRelativeErrors, fineRelativeError, coarseToMediumChange, mediumToFineChange, samples }, null, 2));
  assert.ok(samples[0].nodeCount < samples[1].nodeCount && samples[1].nodeCount < samples[2].nodeCount, 'Modal refinement must strictly increase node count.');
  assert.ok(fineRelativeError < 0.02, `Fine clamped-plate frequency differs from the Kirchhoff-Love reference by ${(fineRelativeError * 100).toFixed(2)}%.`);
  assert.ok(mediumToFineChange < 0.03, `Medium-to-fine eigenfrequency change is ${(mediumToFineChange * 100).toFixed(2)}%.`);
  assert.ok(analyticalRelativeErrors[0] > analyticalRelativeErrors[1] && analyticalRelativeErrors[1] > analyticalRelativeErrors[2], 'Every refinement must move the first eigenfrequency closer to the declared analytical reference.');
} finally {
  await rm(directory, { recursive: true, force: true });
}

function plateRequest(globalSizeMm: number): NeutralSimulationRequestV2 {
  const projectRevision = `sim5-plate-${globalSizeMm}`; const domainId = 'plate-domain'; const occurrenceId = 'plate:1';
  const geometryDigest = digest({ fixture: '100x100x2-clamped-plate' });
  const faces = [
    { id: 'edge-x-min', centroid: [0, 50, 1], direction: [-1, 0, 0], min: [0, 0, 0], max: [0, 100, 2] },
    { id: 'edge-x-max', centroid: [100, 50, 1], direction: [1, 0, 0], min: [100, 0, 0], max: [100, 100, 2] },
    { id: 'edge-y-min', centroid: [50, 0, 1], direction: [0, -1, 0], min: [0, 0, 0], max: [100, 0, 2] },
    { id: 'edge-y-max', centroid: [50, 100, 1], direction: [0, 1, 0], min: [0, 100, 0], max: [100, 100, 2] },
  ] as const;
  return sealNeutralSimulationRequestV2({
    schema: 'tunacad-neutral-simulation-request/2.0', studyId: `sim5-clamped-plate-${globalSizeMm}`, name: `Clamped plate modal ${globalSizeMm} mm`,
    preparedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    analysis: { type: 'modal', assumptions: ['linear_elasticity', 'undamped_free_vibration'], settings: { requestedModeCount: 4, minimumFrequencyHz: 0, maximumFrequencyHz: 5000, massFormulation: 'consistent' } },
    model: {
      projectRevision, coordinateSpace: 'frozen_analysis',
      domains: [{ domainId, partId: 'plate', bodyId: 'body', occurrenceId, geometryDigest, transformToAnalysis: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        shape: { valid: true, connectedSolidCount: 1, faceCount: 6, edgeCount: 12, volumeMm3: 20000, surfaceAreaMm2: 20800, boundingBoxOwnerLocalMm: { min: [0, 0, 0], max: [100, 100, 2], size: [100, 100, 2] } } }],
      references: faces.map(face => ({ semanticReferenceId: face.id, domainId, ownerPartId: 'plate', ownerBodyId: 'body', occurrenceId, geometryKind: 'FACE' as const, role: 'constraint' as const, sourceFeatureId: 'box', resolutionState: 'valid' as const, resolvedAtProjectRevision: projectRevision,
        faceOwnerLocal: { centroidPartLocalMm: [...face.centroid], areaMm2: 200, outwardDirection: [...face.direction], geometryType: 'plane', edgeCount: 4, boundingBoxMm: { min: [...face.min], max: [...face.max] } } })),
    },
    units: { geometry: 'mm', force: 'N', stress: 'MPa', displacement: 'mm', density: 'kg/m^3', acceleration: 'mm/s^2' },
    materials: [{ id: 'steel', name: 'Steel', model: 'isotropic_linear_elastic', densityKgM3: 7850, youngsModulusMPa: 210000, poissonRatio: 0.3, source: { kind: 'custom', reference: 'SIM-5 plate fixture' } }],
    materialAssignments: [{ assignmentId: 'assign-steel', domainId, materialId: 'steel', volumeRegionId: 'plate-volume' }],
    loads: [], constraints: [{ id: 'clamped-boundary', name: 'Four clamped edges', type: 'fixed', semanticReferenceIds: faces.map(face => face.id) }], interactions: [],
    mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2, globalSizeMm, maximumNodes: 300000, maximumElements: 150000, qualityMetric: 'provider_normalized', minimumQuality: 0.04 },
    requestedResults: ['natural_frequencies', 'mode_shapes', 'participation_factors', 'effective_modal_mass'],
  });
}

async function waitForResult(solver: CalculiXMultiDomainSolverProvider, providerRunId: string) {
  const deadline = Date.now() + solver.capabilities.execution.totalTimeoutMs;
  while (Date.now() < deadline) {
    const status = await solver.getStatus(providerRunId);
    if (status.status === 'failed') throw new Error(`${status.failure?.code}: ${status.failure?.message}`);
    if (status.status === 'succeeded') { const result = await solver.getResult(providerRunId); if (!result) throw new Error('Modal solve completed without a result.'); return result; }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  await solver.cancel(providerRunId); throw new Error('SIM-5 modal qualification timed out.');
}
