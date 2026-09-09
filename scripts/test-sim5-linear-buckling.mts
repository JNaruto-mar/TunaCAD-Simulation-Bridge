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

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE; const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (!gmsh || !calculix) throw new Error('Set TUNACAD_GMSH_EXECUTABLE and TUNACAD_CALCULIX_EXECUTABLE to run SIM-5 linear-buckling acceptance.');
const directory = await mkdtemp(join(tmpdir(), 'tunacad-sim5-buckling-'));
try {
  const stepPath = join(directory, 'column.step'); const geoPath = join(directory, 'column.geo');
  await writeFile(geoPath, `SetFactory("OpenCASCADE");\nBox(1) = {0, 0, 0, 200, 10, 10};\nSave "${stepPath.replace(/\\/g, '/')}";\n`, 'utf8');
  execFileSync(gmsh, [geoPath, '-0', '-v', '2'], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const step = new Uint8Array(await readFile(stepPath)); const request = bucklingRequest();
  validateNeutralSimulationRequestV2(request);
  const invalidPreload: any = structuredClone(request); invalidPreload.analysis.settings.preloadCase.loadIds = ['missing-load']; reseal(invalidPreload);
  assert.throws(() => validateNeutralSimulationRequestV2(invalidPreload), /BRIDGE_V2_BUCKLING_REQUEST_INVALID/);
  const mesher = new GmshMultiDomainMeshProvider({ executable: gmsh, runtimeVersion: '4.15.2' });
  const model = await mesher.mesh(request, { descriptor: request.model, async exportDomain() { return step; } });
  const deck = createCalculiXInputDeckV2(request, model);
  assert.match(deck, /^\*BUCKLE\n3$/m); assert.match(deck, /^\*CLOAD$/m);
  assert.match(deck, /^\*NODE FILE, NSET=NALL, GLOBAL=YES\nU$/m);
  assert.doesNotMatch(deck, /^\*(?:STATIC|FREQUENCY|DLOAD)$/m);

  const solver = new CalculiXMultiDomainSolverProvider({ executable: calculix, runtimeVersion: '2.16' });
  assert.deepEqual(admitV2SimulationRequest(request, solver.capabilities), { accepted: true });
  const noBuckling: any = structuredClone(solver.capabilities); delete noBuckling.study.buckling;
  assert.equal(admitV2SimulationRequest(request, noBuckling).accepted, false, 'Buckling transfer must fail before geometry when provider admission omits the buckling profile.');
  const submission = await solver.submit(request, model); const result = await waitForResult(solver, submission.providerRunId);
  assert.equal(result.analysisType, 'linear_buckling'); if (result.analysisType !== 'linear_buckling') throw new Error('Expected linear-buckling result.');
  assert.ok(result.buckling.modes.length >= 1 && result.buckling.modes.length <= 3);
  assert.ok(result.buckling.modes.every((mode, index, modes) => mode.modeNumber === index + 1 && mode.eigenvalueLoadFactor > 0
    && (index === 0 || mode.eigenvalueLoadFactor >= modes[index - 1].eigenvalueLoadFactor)));
  assert.ok(result.warnings.some(warning => warning.code === 'SIMULATION_LINEAR_BUCKLING_LIMITATION'));
  const youngsModulusPa = 210e9; const lengthM = 0.2; const weakAxisMomentM4 = 0.01 * 0.01 ** 3 / 12; const referenceLoadN = 1000;
  const eulerCriticalLoadN = Math.PI ** 2 * youngsModulusPa * weakAxisMomentM4 / (4 * lengthM ** 2);
  const analyticalLoadFactor = eulerCriticalLoadN / referenceLoadN;
  const calculatedLoadFactor = result.buckling.modes[0].eigenvalueLoadFactor;
  const relativeDifference = Math.abs(calculatedLoadFactor - analyticalLoadFactor) / analyticalLoadFactor;
  assert.ok(relativeDifference < 0.2, `First buckling factor differs from the fixed-free Euler column by ${(relativeDifference * 100).toFixed(2)}%.`);
  const datasetId = result.buckling.modes[0].fieldDatasetIds[0]; let cursor: string | undefined = '0'; const magnitudes: number[] = [];
  do {
    const page = await solver.getFieldDataset(submission.providerRunId, datasetId, cursor, 31);
    assert.equal(page.dataset.analysisType, 'linear_buckling'); assert.equal(page.dataset.component, 'buckling_mode_shape_magnitude');
    assert.equal(page.dataset.step.bucklingModeNumber, 1); assert.equal(page.dataset.step.eigenvalueLoadFactor, calculatedLoadFactor);
    page.triangles.forEach(triangle => magnitudes.push(...triangle.values)); cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  assert.ok(Math.max(...magnitudes) > 0.999 && Math.max(...magnitudes) <= 1.000001, 'Buckling visualization must use deterministic max-vector normalization.');
  console.log(JSON.stringify({ fixture: '200x10x10 mm fixed-free steel column', referenceLoadN, eulerCriticalLoadN, analyticalLoadFactor, calculatedLoadFactor, relativeDifference, returnedFactors: result.buckling.modes.map(mode => mode.eigenvalueLoadFactor), fieldTriangles: magnitudes.length / 3 }, null, 2));
} finally { await rm(directory, { recursive: true, force: true }); }

function bucklingRequest(): NeutralSimulationRequestV2 {
  const projectRevision = 'sim5-buckling-r1'; const domainId = 'column-domain'; const occurrenceId = 'column:1'; const geometryDigest = digest({ fixture: '200x10x10-column' });
  const face = (semanticReferenceId: string, role: 'constraint' | 'load', x: number, direction: NeutralVector3) => ({
    semanticReferenceId, domainId, ownerPartId: 'column', ownerBodyId: 'body', occurrenceId, geometryKind: 'FACE' as const, role,
    sourceFeatureId: 'box', resolutionState: 'valid' as const, resolvedAtProjectRevision: projectRevision,
    faceOwnerLocal: { centroidPartLocalMm: [x, 5, 5] as NeutralVector3, areaMm2: 100, outwardDirection: direction, geometryType: 'plane', edgeCount: 4,
      boundingBoxMm: { min: [x, 0, 0] as NeutralVector3, max: [x, 10, 10] as NeutralVector3 } },
  });
  return sealNeutralSimulationRequestV2({
    schema: 'tunacad-neutral-simulation-request/2.0', studyId: 'sim5-euler-column-buckling', name: 'Fixed-free steel column eigenvalue buckling',
    preparedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    analysis: { type: 'linear_buckling', assumptions: ['linear_elasticity', 'small_displacement_preload', 'eigenvalue_buckling'], settings: { requestedModeCount: 3, preloadCase: { id: 'reference-compression', name: '1000 N axial reference compression', loadIds: ['axial-compression'], scaleFactor: 1 } } },
    model: { projectRevision, coordinateSpace: 'frozen_analysis', domains: [{ domainId, partId: 'column', bodyId: 'body', occurrenceId, geometryDigest, transformToAnalysis: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      shape: { valid: true, connectedSolidCount: 1, faceCount: 6, edgeCount: 12, volumeMm3: 20000, surfaceAreaMm2: 8200, boundingBoxOwnerLocalMm: { min: [0, 0, 0], max: [200, 10, 10], size: [200, 10, 10] } } }],
      references: [face('fixed-end', 'constraint', 0, [-1, 0, 0]), face('loaded-end', 'load', 200, [1, 0, 0])] },
    units: { geometry: 'mm', force: 'N', stress: 'MPa', displacement: 'mm', density: 'kg/m^3', acceleration: 'mm/s^2' },
    materials: [{ id: 'steel', name: 'Steel', model: 'isotropic_linear_elastic', youngsModulusMPa: 210000, poissonRatio: 0.3, source: { kind: 'custom', reference: 'SIM-5 Euler fixture' } }],
    materialAssignments: [{ assignmentId: 'assign-steel', domainId, materialId: 'steel', volumeRegionId: 'column-volume' }],
    loads: [{ id: 'axial-compression', name: 'Reference axial compression', type: 'surface_force', semanticReferenceIds: ['loaded-end'], forceN: [-1000, 0, 0], coordinateSystem: 'analysis' }],
    constraints: [{ id: 'fixed-support', name: 'Fixed end', type: 'fixed', semanticReferenceIds: ['fixed-end'] }], interactions: [],
    mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2, globalSizeMm: 8, minimumSizeMm: 3, maximumNodes: 150000, maximumElements: 75000, qualityMetric: 'provider_normalized', minimumQuality: 0.04 },
    requestedResults: ['buckling_load_factors', 'buckling_mode_shapes'],
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
    if (status.status === 'succeeded') { const result = await solver.getResult(providerRunId); if (!result) throw new Error('Buckling solve completed without a result.'); return result; }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  await solver.cancel(providerRunId); throw new Error('SIM-5 linear-buckling provider timed out.');
}
