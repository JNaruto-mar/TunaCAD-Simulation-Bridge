import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCalculiXInputDeckV2 } from '../providers/calculix/CalculiXMultiDomainDeck.mts';
import { CalculiXMultiDomainSolverProvider } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { GmshMultiDomainMeshProvider } from '../providers/gmsh/GmshMultiDomainMeshProvider.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { sealNeutralSimulationRequestV2 } from '../simulation-bridge/v2Validation.mts';
import type { NeutralSimulationRequestV2, NeutralVector3 } from '../src/simulation/externalSimulationContracts.ts';

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE; const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (!gmsh || !calculix) throw new Error('Set TUNACAD_GMSH_EXECUTABLE and TUNACAD_CALCULIX_EXECUTABLE to run SIM-5 multi-domain modal acceptance.');
const directory = await mkdtemp(join(tmpdir(), 'tunacad-sim5-modal-coupling-'));
try {
  const stepPath = join(directory, 'half-beam.step'); const geoPath = join(directory, 'half-beam.geo');
  await writeFile(geoPath, `SetFactory("OpenCASCADE");\nBox(1) = {0, 0, 0, 50, 10, 5};\nSave "${stepPath.replace(/\\/g, '/')}";\n`, 'utf8');
  execFileSync(gmsh, [geoPath, '-0', '-v', '2'], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const step = new Uint8Array(await readFile(stepPath)); const request = coupledRequest();
  const mesher = new GmshMultiDomainMeshProvider({ executable: gmsh, runtimeVersion: '4.15.2' });
  const model = await mesher.mesh(request, { descriptor: request.model, async exportDomain() { return step; } });
  assert.deepEqual(model.domainRegions.map(domain => domain.domainId), ['beam-left', 'beam-right']);
  const deck = createCalculiXInputDeckV2(request, model);
  assert.match(deck, /^\*TIE, NAME=TIE_001, ADJUST=NO, POSITION TOLERANCE=0\.05$/m);
  assert.equal((deck.match(/^\*SOLID SECTION/gm) ?? []).length, 2);
  const solver = new CalculiXMultiDomainSolverProvider({ executable: calculix, runtimeVersion: '2.16' });
  const submission = await solver.submit(request, model); const result = await waitForResult(solver, submission.providerRunId);
  assert.equal(result.analysisType, 'modal'); if (result.analysisType !== 'modal') throw new Error('Expected multi-domain modal result.');
  assert.deepEqual(result.perDomain.map(domain => domain.domainId), ['beam-left', 'beam-right']);
  assert.ok(result.modal.modes.every(mode => mode.fieldDatasetIds.length === 2));
  assert.ok(result.perDomain.every(domain => domain.fieldDatasetIds.length === result.modal.modes.length));
  const beta1 = 1.875104068711961;
  const analyticalHz = beta1 ** 2 / (2 * Math.PI * 0.1 ** 2) * Math.sqrt(210e9 * (0.01 * 0.005 ** 3 / 12) / (7850 * 0.01 * 0.005));
  const relativeDifference = Math.abs(result.modal.modes[0].frequencyHz - analyticalHz) / analyticalHz;
  assert.ok(relativeDifference < 0.2, `Bonded two-domain first frequency differs from the monolithic beam reference by ${(relativeDifference * 100).toFixed(2)}%.`);
  for (const datasetId of result.modal.modes[0].fieldDatasetIds) {
    const page = await solver.getFieldDataset(submission.providerRunId, datasetId, '0', 128);
    assert.equal(page.dataset.analysisType, 'modal'); assert.ok(['beam-left', 'beam-right'].includes(page.dataset.domainId));
  }
  console.log(JSON.stringify({ fixture: 'two-domain bonded 100x10x5 mm steel cantilever', coupling: 'bonded_tie adjust=none', analyticalHz, calculatedHz: result.modal.modes[0].frequencyHz, relativeDifference, perDomainDatasetCounts: result.perDomain.map(domain => ({ domainId: domain.domainId, count: domain.fieldDatasetIds.length })) }, null, 2));
} finally { await rm(directory, { recursive: true, force: true }); }

function coupledRequest(): NeutralSimulationRequestV2 {
  const projectRevision = 'sim5-coupled-r1'; const geometryDigest = digest({ fixture: '50x10x5-half-beam' });
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;
  const translated = [1, 0, 0, 50, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;
  const domains = [
    { domainId: 'beam-left', partId: 'half-beam', bodyId: 'half-body', occurrenceId: 'half:1', transformToAnalysis: identity },
    { domainId: 'beam-right', partId: 'half-beam', bodyId: 'half-body', occurrenceId: 'half:2', transformToAnalysis: translated },
  ] as const;
  const face = (domainId: string, occurrenceId: string, semanticReferenceId: string, x: number, role: 'constraint' | 'interaction', direction: NeutralVector3) => ({
    semanticReferenceId, domainId, ownerPartId: 'half-beam', ownerBodyId: 'half-body', occurrenceId, geometryKind: 'FACE' as const, role,
    sourceFeatureId: 'box', resolutionState: 'valid' as const, resolvedAtProjectRevision: projectRevision,
    faceOwnerLocal: { centroidPartLocalMm: [x, 5, 2.5] as NeutralVector3, areaMm2: 50, outwardDirection: direction, geometryType: 'plane', edgeCount: 4,
      boundingBoxMm: { min: [x, 0, 0] as NeutralVector3, max: [x, 10, 5] as NeutralVector3 } },
  });
  return sealNeutralSimulationRequestV2({
    schema: 'tunacad-neutral-simulation-request/2.0', studyId: 'sim5-multidomain-modal-coupling', name: 'Bonded two-domain cantilever modes',
    preparedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    analysis: { type: 'modal', assumptions: ['linear_elasticity', 'undamped_free_vibration'], settings: { requestedModeCount: 6, minimumFrequencyHz: 0, maximumFrequencyHz: 2000, massFormulation: 'consistent' } },
    model: { projectRevision, coordinateSpace: 'frozen_analysis', domains: domains.map(domain => ({ ...domain, geometryDigest,
      shape: { valid: true, connectedSolidCount: 1, faceCount: 6, edgeCount: 12, volumeMm3: 2500, surfaceAreaMm2: 1600, boundingBoxOwnerLocalMm: { min: [0, 0, 0], max: [50, 10, 5], size: [50, 10, 5] } } })),
      references: [face('beam-left', 'half:1', 'fixed-left', 0, 'constraint', [-1, 0, 0]), face('beam-left', 'half:1', 'tie-left', 50, 'interaction', [1, 0, 0]), face('beam-right', 'half:2', 'tie-right', 0, 'interaction', [-1, 0, 0])] },
    units: { geometry: 'mm', force: 'N', stress: 'MPa', displacement: 'mm', density: 'kg/m^3', acceleration: 'mm/s^2' },
    materials: [{ id: 'steel', name: 'Steel', model: 'isotropic_linear_elastic', densityKgM3: 7850, youngsModulusMPa: 210000, poissonRatio: 0.3, source: { kind: 'custom', reference: 'SIM-5 coupled fixture' } }],
    materialAssignments: domains.map((domain, index) => ({ assignmentId: `assign-${index + 1}`, domainId: domain.domainId, materialId: 'steel', volumeRegionId: `volume-${index + 1}` })),
    loads: [], constraints: [{ id: 'fixed-left', name: 'Fixed left end', type: 'fixed', semanticReferenceIds: ['fixed-left'] }],
    interactions: [{ id: 'beam-bond', name: 'Explicit middle bond', type: 'bonded_tie', secondaryReferenceIds: ['tie-right'], primaryReferenceIds: ['tie-left'], adjustment: 'none', positionToleranceMm: 0.05 }],
    mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2, globalSizeMm: 7, maximumNodes: 150000, maximumElements: 75000, qualityMetric: 'provider_normalized', minimumQuality: 0.04 },
    requestedResults: ['natural_frequencies', 'mode_shapes', 'participation_factors', 'effective_modal_mass'],
  });
}

async function waitForResult(solver: CalculiXMultiDomainSolverProvider, providerRunId: string) {
  const deadline = Date.now() + solver.capabilities.execution.totalTimeoutMs;
  while (Date.now() < deadline) { const status = await solver.getStatus(providerRunId); if (status.status === 'failed') throw new Error(`${status.failure?.code}: ${status.failure?.message}`); if (status.status === 'succeeded') { const result = await solver.getResult(providerRunId); if (!result) throw new Error('Modal coupling solve completed without a result.'); return result; } await new Promise(resolve => setTimeout(resolve, 25)); }
  await solver.cancel(providerRunId); throw new Error('SIM-5 multi-domain modal solve timed out.');
}
