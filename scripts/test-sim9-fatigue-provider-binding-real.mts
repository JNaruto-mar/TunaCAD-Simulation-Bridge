import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CalculiXMultiDomainSolverProvider } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { createCalculiXInputDeckV2 } from '../providers/calculix/CalculiXMultiDomainDeck.mts';
import { GmshMultiDomainMeshProvider } from '../providers/gmsh/GmshMultiDomainMeshProvider.mts';
import { bindFatigueToStructuralHistory, type StructuralStressHistory } from '../simulation-bridge/fatigueStructuralBinding.mts';
import { FatigueAdmissionLifecycle } from '../simulation-bridge/fatigueAdmission.mts';
import { sealFatigueReferenceInput, type FatigueReferenceDraft } from '../simulation-bridge/fatigueReference.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { sealNeutralSimulationRequestV2 } from '../simulation-bridge/v2Validation.mts';
import type { NeutralSimulationRequestV2, NeutralVector3 } from '../src/simulation/externalSimulationContracts.ts';

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (!gmsh || !calculix) throw new Error('Set explicit TUNACAD_GMSH_EXECUTABLE and TUNACAD_CALCULIX_EXECUTABLE.');
const revision = 'sim9-fatigue-provider-coupon-r1';
const domainId = 'coupon';
const occurrenceId = 'coupon:1';
function face(semanticReferenceId: string, role: 'load' | 'constraint', x: number,
  outwardDirection: NeutralVector3) {
  return {
    semanticReferenceId, domainId, ownerPartId: 'coupon-part', ownerBodyId: 'coupon-body',
    occurrenceId, geometryKind: 'FACE' as const, role, sourceFeatureId: 'box',
    resolutionState: 'valid' as const, resolvedAtProjectRevision: revision,
    faceOwnerLocal: { centroidPartLocalMm: [x, 5, 5] as NeutralVector3, areaMm2: 100,
      outwardDirection, geometryType: 'plane', edgeCount: 4,
      boundingBoxMm: { min: [x, 0, 0] as NeutralVector3, max: [x, 10, 10] as NeutralVector3 } },
  };
}
const steps = [
  { id: 'negative', start: 0, end: -1 },
  { id: 'positive', start: -1, end: 1 },
  { id: 'negative-return', start: 1, end: -1 },
].map(step => ({
  id: step.id, name: step.id, duration: 1,
  loadAmplitudes: [{ loadId: 'axial-force', interpolation: 'piecewise_linear' as const,
    points: [{ time: 0, scaleFactor: step.start }, { time: 1, scaleFactor: step.end }] }],
}));
const request: NeutralSimulationRequestV2 = sealNeutralSimulationRequestV2({
  schema: 'tunacad-neutral-simulation-request/2.0', studyId: 'sim9-fatigue-real-coupon',
  name: 'SIM-9 provider-owned signed stress history coupon',
  preparedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
  analysis: { type: 'nonlinear_static',
    assumptions: ['finite_deformation', 'finite_strain', 'quasi_static', 'isotropic_linear_elastic'],
    settings: { steps, initialIncrement: .25, minimumIncrement: .001,
      maximumIncrement: .25, maximumIncrements: 40, maximumIterations: 32,
      cutbackFactor: .25, maximumCutbacks: 8 } },
  model: { projectRevision: revision, coordinateSpace: 'frozen_analysis', domains: [{
    domainId, partId: 'coupon-part', bodyId: 'coupon-body', occurrenceId,
    geometryDigest: digest({ fixture: '100x10x10-fatigue-axial-coupon' }),
    transformToAnalysis: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    shape: { valid: true, connectedSolidCount: 1, faceCount: 6, edgeCount: 12,
      volumeMm3: 10000, surfaceAreaMm2: 4200,
      boundingBoxOwnerLocalMm: { min: [0, 0, 0], max: [100, 10, 10], size: [100, 10, 10] } },
  }], references: [face('fixed-face', 'constraint', 0, [-1, 0, 0]),
    face('load-face', 'load', 100, [1, 0, 0])] },
  units: { geometry: 'mm', force: 'N', stress: 'MPa', displacement: 'mm',
    density: 'kg/m^3', acceleration: 'mm/s^2' },
  materials: [{ id: 'steel', name: 'Elastic steel', model: 'isotropic_linear_elastic',
    densityKgM3: 7850, youngsModulusMPa: 210000, poissonRatio: .3,
    source: { kind: 'custom', reference: 'SIM-9 fatigue history binding fixture' } }],
  materialAssignments: [{ assignmentId: 'coupon-steel', domainId,
    materialId: 'steel', volumeRegionId: 'coupon-volume' }],
  loads: [{ id: 'axial-force', name: 'Reversing axial force',
    type: 'surface_force', semanticReferenceIds: ['load-face'],
    forceN: [.1, 0, 0], coordinateSystem: 'analysis' }],
  constraints: [{ id: 'fixed-end', name: 'Fixed end', type: 'fixed',
    semanticReferenceIds: ['fixed-face'] }],
  interactions: [],
  mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2,
    globalSizeMm: 15, minimumSizeMm: 3.75, maximumNodes: 15000,
    maximumElements: 7500, qualityMetric: 'provider_normalized', minimumQuality: .04 },
  requestedResults: ['von_mises_stress', 'displacement', 'reaction_force',
    'load_displacement_history', 'increment_convergence'],
});
const directory = await mkdtemp(join(tmpdir(), 'tunacad-sim9-fatigue-'));
try {
  const stepPath = join(directory, 'coupon.step');
  const geoPath = join(directory, 'coupon.geo');
  await writeFile(geoPath, `SetFactory("OpenCASCADE");\nBox(1) = {0, 0, 0, 100, 10, 10};\nSave "${stepPath.replace(/\\/g, '/')}";\n`, 'utf8');
  execFileSync(gmsh, [geoPath, '-0', '-v', '2'], { cwd: directory,
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 });
  const geometry = new Uint8Array(await readFile(stepPath));
  const mesher = new GmshMultiDomainMeshProvider({ executable: gmsh, runtimeVersion: '4.15.2' });
  const model = await mesher.mesh(request, { descriptor: request.model,
    async exportDomain() { return geometry; } });
  const deck = createCalculiXInputDeckV2(request, model);
  assert.equal(createCalculiXInputDeckV2(request, model), deck);
  const solver = new CalculiXMultiDomainSolverProvider({ executable: calculix, runtimeVersion: '2.16' });
  const selection = { domainId, elementId: 1, integrationPoint: 1, axisAnalysis: [1, 0, 0] as [number, number, number] };
  const submission = await solver.submitWithStressHistory(request, model, selection);
  let terminal = await solver.getStatus(submission.providerRunId);
  for (let attempt = 0; attempt < 800 && terminal.status === 'running'; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 50));
    terminal = await solver.getStatus(submission.providerRunId);
  }
  assert.equal(terminal.status, 'succeeded', JSON.stringify(terminal));
  const result = (await solver.getResult(submission.providerRunId))!;
  const datasetId = `${result.jobId}:${domainId}:fatigue-stress-history`;
  assert(result.perDomain[0].fieldDatasetIds.includes(datasetId));
  const artifact = await solver.getStressHistory(result.jobId, datasetId);
  assert.deepEqual(artifact.location, { ...selection, stressComponent: 'signed_uniaxial_normal_stress' });
  assert.deepEqual(artifact.units, { stress: 'MPa', time: 's' });
  assert.deepEqual(artifact.samples.map(sample => sample.timeS), [0, 1, 2]);
  const amplitude = artifact.samples[1].stressMPa;
  assert(amplitude > 0);
  const draft: FatigueReferenceDraft = {
    schema: 'tunacad-fatigue-reference/0.1',
    source: { structuralJobId: result.jobId, structuralResultDigest: digest(result),
      requestDigest: result.requestDigest, projectRevision: result.projectRevision,
      modelDigest: result.modelDigest, fieldDatasetId: datasetId,
      fieldDatasetDigest: digest(artifact), ...artifact.location },
    material: { materialId: 'fixture-sn', provenance: { kind: 'custom',
      reference: 'analytical fixture curve', revision: 'r1' },
      model: 'fully_reversed_stress_life', stressRatio: -1,
      snPoints: [{ cyclesToFailure: 10_000, stressAmplitudeMPa: amplitude * 2 },
        { cyclesToFailure: 100_000, stressAmplitudeMPa: amplitude },
        { cyclesToFailure: 1_000_000, stressAmplitudeMPa: amplitude / 2 }] },
    history: { quantity: 'signed_uniaxial_stress',
      cycleShape: 'one_closed_min_max_min_cycle',
      interpolation: 'linear_between_turning_points',
      samples: structuredClone(artifact.samples), repeatedCycles: 10_000 },
    units: { stress: 'MPa', time: 's', life: 'cycles' },
  };
  const input = sealFatigueReferenceInput(draft);
  const reader = { readCompletedResult: (jobId: string) => solver.getResult(jobId),
    readStressHistory: (jobId: string, id: string) => solver.getStressHistory(jobId, id) };
  const proof = await bindFatigueToStructuralHistory(input, reader);
  assert.equal(proof.structuralResultDigest, digest(result));
  assert.equal(proof.fieldDatasetDigest, digest(artifact));
  assert.equal(proof.providerAdmission, 'closed');
  const fatigue = new FatigueAdmissionLifecycle(reader);
  const fatigueJob = fatigue.submit(input);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fatigue.getStatus(fatigueJob.jobId).state, 'succeeded');
  const admitted = (await fatigue.getResult(fatigueJob.jobId))!;
  assert.equal(admitted.sourceVerification, 'verified_trusted_structural_history');
  assert.equal(admitted.predictedLifeCycles, 100_000);
  assert.equal(admitted.damageFraction, .1);
  assert.equal(admitted.remainingCycles, 90_000);
  assert.equal(admitted.predictedFailureWithinHistory, false);
  assert.equal(admitted.engineeringUsePermitted, false);
  let tamperRejected = 0;
  async function rejectArtifact(change: (value: StructuralStressHistory) => void) {
    const changed = structuredClone(artifact); change(changed);
    await assert.rejects(bindFatigueToStructuralHistory(input, {
      ...reader, async readStressHistory() { return changed; },
    }), /SIM9_FATIGUE_SOURCE_BINDING_INVALID/);
    tamperRejected++;
  }
  await rejectArtifact(value => { value.samples[1].stressMPa *= 1.01; });
  await rejectArtifact(value => { value.samples[1].timeS = 1.1; });
  await rejectArtifact(value => { value.samples = value.samples.slice(0, 2) as never; });
  await rejectArtifact(value => { value.samples.reverse(); });
  await rejectArtifact(value => { value.units.stress = 'Pa' as 'MPa'; });
  await rejectArtifact(value => { value.units.time = 'ms' as 's'; });
  await rejectArtifact(value => { value.structuralJobId = 'other-job'; });
  await rejectArtifact(value => { value.structuralResultDigest = 'sha256:' + 'a'.repeat(64); });
  await rejectArtifact(value => { value.fieldDatasetId = 'other-dataset'; });
  await rejectArtifact(value => { value.location.domainId = 'other-domain'; });
  await rejectArtifact(value => { value.location.elementId += 1; });
  await rejectArtifact(value => { value.location.integrationPoint += 1; });
  await rejectArtifact(value => { value.location.axisAnalysis = [0, 1, 0]; });
  const detached = structuredClone(result);
  detached.projectRevision = 'substituted-revision';
  await assert.rejects(bindFatigueToStructuralHistory(input, {
    ...reader, async readCompletedResult() { return detached; },
  }), /SIM9_FATIGUE_SOURCE_BINDING_INVALID/);
  tamperRejected++;
  const reread: StructuralStressHistory = await solver.getStressHistory(result.jobId, datasetId);
  assert.deepEqual(reread, artifact);
  console.log(JSON.stringify({ status: 'PASS', model: '100x10x10 mm elastic axial coupon',
    mesh: { nodes: model.nodes.length, elements: model.volumeElements.connectivity.length },
    location: selection, samples: artifact.samples, resultDigest: digest(result),
    artifactDigest: digest(artifact), authentic: true, admittedLifeCycles: admitted.predictedLifeCycles,
    admittedDamageFraction: admitted.damageFraction, tamperRejected,
    providerAdmission: proof.providerAdmission }));
} finally {
  await rm(directory, { recursive: true, force: true });
}
