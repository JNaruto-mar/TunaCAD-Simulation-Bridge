import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CalculiXMultiDomainSolverProvider } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { GmshMultiDomainMeshProvider } from '../providers/gmsh/GmshMultiDomainMeshProvider.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { sealNeutralSimulationRequestV2 } from '../simulation-bridge/v2Validation.mts';
import type { NeutralSimulationRequestV2, NeutralSimulationResultV2, NeutralVector3 } from '../src/simulation/externalSimulationContracts.ts';

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (!gmsh || !calculix) throw new Error('Set TUNACAD_GMSH_EXECUTABLE and TUNACAD_CALCULIX_EXECUTABLE to run SIM-6A real-contact acceptance.');

const directory = await mkdtemp(join(tmpdir(), 'tunacad-sim6a-contact-'));
try {
  const stepPath = join(directory, 'contact-block.step');
  const geoPath = join(directory, 'contact-block.geo');
  await writeFile(geoPath, `SetFactory("OpenCASCADE");\nBox(1) = {0, 0, 0, 10, 10, 10};\nSave "${stepPath.replace(/\\/g, '/')}";\n`, 'utf8');
  execFileSync(gmsh, [geoPath, '-0', '-v', '2'], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const step = new Uint8Array(await readFile(stepPath));
  const mesher = new GmshMultiDomainMeshProvider({ executable: gmsh, runtimeVersion: '4.15.2' });
  const solver = new CalculiXMultiDomainSolverProvider({ executable: calculix, runtimeVersion: '2.16' });

  const closing = await solve(createRequest('closing'), step, mesher, solver);
  assert.equal(closing.analysisType, 'static_contact');
  if (closing.analysisType !== 'static_contact') throw new Error('Expected a static-contact closing result.');
  const closingInterface = closing.contact.interfaces[0];
  assert.equal(closingInterface.status, 'active');
  assert.ok(closingInterface.maximumPressureMPa > 0);
  assert.ok(closingInterface.maximumPenetrationMm > 0);
  const contactForce = closingInterface.forceOnSecondaryN;
  assert.ok(contactForce[0] > 0, 'Compressive contact must push the secondary body in +X.');
  assert.ok(Math.abs(contactForce[1]) < 2 && Math.abs(contactForce[2]) < 2, 'A symmetric frictionless patch must not transmit meaningful transverse force.');
  const appliedForceN = 100;
  const contactEquilibriumError = Math.abs(contactForce[0] - appliedForceN) / appliedForceN;
  assert.ok(contactEquilibriumError < 0.08, `Contact resultant differs from the applied force by ${(contactEquilibriumError * 100).toFixed(2)}%.`);
  const supportReaction = closing.reactions.find(reaction => reaction.constraintId === 'foundation-support')?.forceN;
  assert.ok(supportReaction, 'The closing result omitted the foundation reaction.');
  const globalEquilibriumError = Math.hypot(supportReaction![0] - appliedForceN, supportReaction![1], supportReaction![2]) / appliedForceN;
  assert.ok(globalEquilibriumError < 0.02, `Foundation reaction differs from the applied force by ${(globalEquilibriumError * 100).toFixed(2)}%.`);

  const opening = await solve(createRequest('opening'), step, mesher, solver);
  assert.equal(opening.analysisType, 'static_contact');
  if (opening.analysisType !== 'static_contact') throw new Error('Expected a static-contact opening result.');
  const openingInterface = opening.contact.interfaces[0];
  assert.equal(openingInterface.status, 'open_or_touching');
  const openingForce = Math.hypot(...openingInterface.forceOnSecondaryN);
  assert.ok(openingInterface.maximumPressureMPa < 1e-4, `Opening contact retained ${openingInterface.maximumPressureMPa} MPa pressure.`);
  assert.ok(openingForce < 0.01, `Opening contact transmitted ${openingForce} N.`);
  const drivenReaction = opening.reactions.find(reaction => reaction.constraintId === 'open-slider')?.forceN;
  assert.ok(drivenReaction && Math.hypot(...drivenReaction) < 0.01, 'A separated frictionless body must not retain a meaningful driven-face reaction.');

  const adjustedInterference = await solve(createRequest('adjust_interference'), step, mesher, solver);
  const adjustedClearance = await solve(createRequest('adjust_clearance'), step, mesher, solver);
  const adjustmentEvidence = [adjustedClearance, adjustedInterference].map((result, index) => {
    assert.equal(result.analysisType, 'static_contact');
    if (result.analysisType !== 'static_contact') throw new Error('Expected a bounded-adjustment static-contact result.');
    assert.ok(result.warnings.some(warning => warning.code === 'SIMULATION_CONTACT_INITIAL_ADJUSTMENT'));
    const interfaceResult = result.contact.interfaces[0];
    assert.equal(interfaceResult.status, 'active');
    assert.ok(interfaceResult.maximumPressureMPa > 0);
    assert.ok(interfaceResult.forceOnSecondaryN[0] > 1, 'The adjusted interface must transmit the displacement-controlled compression.');
    assert.ok(interfaceResult.maximumPenetrationMm < 0.06, 'The final penetration must remain below the declared initial-adjustment bound.');
    return {
      initialGapMm: index === 0 ? 0.05 : -0.05,
      maximumAdjustmentMm: 0.06,
      contactForceOnSecondaryN: interfaceResult.forceOnSecondaryN,
      maximumPressureMPa: interfaceResult.maximumPressureMPa,
      maximumPenetrationMm: interfaceResult.maximumPenetrationMm,
      convergedIncrements: result.contact.increments.length,
    };
  });

  const frictionlessSliding = await solve(createRequest('sliding_frictionless'), step, mesher, solver);
  const frictionalSlidingRun = await solveRun(createRequest('sliding_frictional'), step, mesher, solver);
  const frictionalSliding = frictionalSlidingRun.result;
  if (frictionlessSliding.analysisType !== 'static_contact' || frictionalSliding.analysisType !== 'static_contact') throw new Error('Expected static-contact sliding results.');
  const frictionlessInterface = frictionlessSliding.contact.interfaces[0]; const frictionalInterface = frictionalSliding.contact.interfaces[0];
  assert.equal(frictionalInterface.status, 'active');
  assert.ok(frictionalSliding.warnings.some(warning => warning.code === 'SIMULATION_CONTACT_FRICTION_POC'));
  assert.ok((frictionalInterface.maximumShearMPa ?? 0) > 1e-5, 'Frictional sliding must recover nonzero contact shear.');
  assert.ok(frictionalInterface.maximumTangentialSlipMm > 1e-5, 'Frictional sliding must recover nonzero tangential slip.');
  assert.ok(frictionalInterface.tangentialSlipDatasetId && frictionalInterface.contactShearDatasetId, 'Frictional sliding must publish paginated slip and shear datasets.');
  const slipPage = await solver.getFieldDataset(frictionalSlidingRun.providerRunId, frictionalInterface.tangentialSlipDatasetId!, '0', 128);
  const shearPage = await solver.getFieldDataset(frictionalSlidingRun.providerRunId, frictionalInterface.contactShearDatasetId!, '0', 128);
  assert.equal(slipPage.dataset.component, 'tangential_slip'); assert.equal(slipPage.dataset.unit, 'mm');
  assert.equal(shearPage.dataset.component, 'contact_shear'); assert.equal(shearPage.dataset.unit, 'MPa');
  assert.ok(slipPage.triangles.some(triangle => triangle.values.some(value => value > 1e-5)));
  assert.ok(shearPage.triangles.some(triangle => triangle.values.some(value => value > 1e-5)));
  assert.ok(Math.abs(frictionlessInterface.forceOnSecondaryN[1]) < 0.1, 'The frictionless comparison must not transmit meaningful tangential force.');
  assert.ok(Math.abs(frictionalInterface.forceOnSecondaryN[1]) > 1, 'The frictional interface must transmit a meaningful tangential force.');
  assert.ok((frictionalInterface.maximumShearMPa ?? Infinity) <= 0.2 * frictionalInterface.maximumPressureMPa * 1.08 + 1e-5, 'Recovered shear must respect the Coulomb limit within numerical tolerance.');
  const slidingDriveReaction = frictionalSliding.reactions.find(reaction => reaction.constraintId === 'drive-slider')?.forceN;
  assert.ok(slidingDriveReaction, 'The frictional sliding result omitted its drive reaction.');
  const tangentialEquilibriumError = Math.abs(slidingDriveReaction![1] + frictionalInterface.forceOnSecondaryN[1]) / Math.max(1, Math.abs(frictionalInterface.forceOnSecondaryN[1]));
  assert.ok(tangentialEquilibriumError < 0.03, `Frictional tangential equilibrium error is ${(tangentialEquilibriumError * 100).toFixed(2)}%.`);

  const beforeFailureDirectories = await providerDirectories();
  const nonconvergentRequest = createRequest('nonconvergent');
  const nonconvergentModel = await mesher.mesh(nonconvergentRequest, { descriptor: nonconvergentRequest.model, async exportDomain() { return step; } });
  const nonconvergentSubmission = await solver.submit(nonconvergentRequest, nonconvergentModel);
  const failureRunDirectories = (await providerDirectories()).filter(name => !beforeFailureDirectories.includes(name));
  assert.equal(failureRunDirectories.length, 1, 'The deliberate failure must own one isolated native working directory.');
  const nonconvergentStatus = await waitForTerminal(solver, nonconvergentSubmission.providerRunId);
  assert.equal(nonconvergentStatus.status, 'failed');
  assert.equal(nonconvergentStatus.failure?.code, 'SIMULATION_SOLVER_FAILED');
  assert.match(nonconvergentStatus.failure?.message ?? '', /max\. # of increments reached|too many increments|increment size smaller than minimum/i);
  assert.equal(await solver.getResult(nonconvergentSubmission.providerRunId), null);
  await assert.rejects(() => solver.getFieldDataset(nonconvergentSubmission.providerRunId, `${nonconvergentSubmission.providerRunId}:slider:stress`), /Unknown or expired/);
  await waitForDirectoriesRemoved(failureRunDirectories);

  const beforeCancellationDirectories = await providerDirectories();
  const cancelledRequest = createRequest('closing');
  const cancelledModel = await mesher.mesh(cancelledRequest, { descriptor: cancelledRequest.model, async exportDomain() { return step; } });
  const cancelledSubmission = await solver.submit(cancelledRequest, cancelledModel);
  const cancellationRunDirectories = (await providerDirectories()).filter(name => !beforeCancellationDirectories.includes(name));
  assert.equal(cancellationRunDirectories.length, 1, 'The cancellation fixture must own one isolated native working directory.');
  const cancelledStatus = await solver.cancel(cancelledSubmission.providerRunId);
  assert.equal(cancelledStatus.status, 'cancelled');
  assert.equal(cancelledStatus.phase, 'cancelled_cleaned');
  assert.equal(await solver.getResult(cancelledSubmission.providerRunId), null);
  await assert.rejects(() => solver.getFieldDataset(cancelledSubmission.providerRunId, `${cancelledSubmission.providerRunId}:slider:stress`), /Unknown or expired/);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal((await solver.getStatus(cancelledSubmission.providerRunId)).status, 'cancelled', 'Late process exit must not resurrect a cancelled contact run.');
  await waitForDirectoriesRemoved(cancellationRunDirectories);

  console.log(JSON.stringify({
    fixture: 'two touching 10x10x10 mm steel blocks',
    closing: {
      appliedForceN,
      contactForceOnSecondaryN: contactForce,
      supportReactionN: supportReaction,
      contactEquilibriumError,
      globalEquilibriumError,
      maximumPressureMPa: closingInterface.maximumPressureMPa,
      maximumPenetrationMm: closingInterface.maximumPenetrationMm,
      convergedIncrements: closing.contact.increments.length,
    },
    opening: {
      prescribedOpeningMm: 0.05,
      status: openingInterface.status,
      contactForceOnSecondaryN: openingInterface.forceOnSecondaryN,
      maximumPressureMPa: openingInterface.maximumPressureMPa,
      drivenReactionN: drivenReaction,
      convergedIncrements: opening.contact.increments.length,
    },
    boundedInitialAdjustment: adjustmentEvidence,
    frictionalSliding: {
      coefficient: 0.2,
      stickSlopeMPaPerMm: 5000,
      prescribedNormalMm: -0.001,
      prescribedTangentialMm: 0.02,
      frictionlessTangentialForceN: frictionlessInterface.forceOnSecondaryN[1],
      frictionalContactForceOnSecondaryN: frictionalInterface.forceOnSecondaryN,
      driveReactionN: slidingDriveReaction,
      tangentialEquilibriumError,
      maximumPressureMPa: frictionalInterface.maximumPressureMPa,
      maximumShearMPa: frictionalInterface.maximumShearMPa,
      maximumTangentialSlipMm: frictionalInterface.maximumTangentialSlipMm,
      normalizedDatasets: [frictionalInterface.tangentialSlipDatasetId, frictionalInterface.contactShearDatasetId],
    },
    lifecycle: {
      nonconvergence: { status: nonconvergentStatus.status, code: nonconvergentStatus.failure?.code, resultQuarantined: true, nativeFilesRemoved: true },
      cancellation: { status: cancelledStatus.status, phase: cancelledStatus.phase, resultQuarantined: true, lateExitQuarantined: true, nativeFilesRemoved: true },
    },
  }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}

type ContactCase = 'closing' | 'opening' | 'adjust_clearance' | 'adjust_interference' | 'nonconvergent' | 'sliding_frictionless' | 'sliding_frictional';

function createRequest(contactCase: ContactCase): NeutralSimulationRequestV2 {
  const projectRevision = `sim6a-real-${contactCase}-r1`;
  const geometryDigest = digest({ fixture: '10x10x10-contact-block' });
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;
  const initialGapMm = contactCase === 'adjust_clearance' || contactCase === 'nonconvergent' ? 0.05 : contactCase === 'adjust_interference' ? -0.05 : 0;
  const usesAdjustment = contactCase.startsWith('adjust_') || contactCase === 'nonconvergent';
  const usesSliding = contactCase === 'sliding_frictionless' || contactCase === 'sliding_frictional';
  const usesFriction = contactCase === 'sliding_frictional';
  const translated = [1, 0, 0, 10 + initialGapMm, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;
  const shape = {
    valid: true as const, connectedSolidCount: 1 as const, faceCount: 6, edgeCount: 12, volumeMm3: 1000, surfaceAreaMm2: 600,
    boundingBoxOwnerLocalMm: { min: [0, 0, 0] as NeutralVector3, max: [10, 10, 10] as NeutralVector3, size: [10, 10, 10] as NeutralVector3 },
  };
  const reference = (
    semanticReferenceId: string,
    domainId: 'foundation' | 'slider',
    role: 'load' | 'constraint' | 'interaction',
    centroid: NeutralVector3,
    outwardDirection: NeutralVector3,
    boundingBoxMm: { min: NeutralVector3; max: NeutralVector3 },
  ) => ({
    semanticReferenceId, domainId, ownerPartId: 'contact-block', ownerBodyId: 'block-body', occurrenceId: `${domainId}:1`,
    geometryKind: 'FACE' as const, role, sourceFeatureId: 'box', resolutionState: 'valid' as const, resolvedAtProjectRevision: projectRevision,
    faceOwnerLocal: { centroidPartLocalMm: centroid, areaMm2: 100, outwardDirection, geometryType: 'plane', edgeCount: 4, boundingBoxMm },
  });
  const endRole = contactCase === 'closing' || contactCase === 'nonconvergent' ? 'load' as const : 'constraint' as const;
  return sealNeutralSimulationRequestV2({
    schema: 'tunacad-neutral-simulation-request/2.0', studyId: `sim6a-real-${contactCase}`, name: `SIM-6A real patch ${contactCase}`,
    preparedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    analysis: { type: 'static_contact', assumptions: ['small_displacement', 'small_strain', 'quasi_static', usesFriction ? 'frictional_contact' : 'frictionless_contact'], settings: contactCase.startsWith('adjust_') || usesSliding
      ? { initialIncrement: 0.01, minimumIncrement: 0.00001, maximumIncrement: 0.1, maximumIncrements: 200 }
      : contactCase === 'nonconvergent' ? { initialIncrement: 0.1, minimumIncrement: 0.1, maximumIncrement: 0.1, maximumIncrements: 1 }
      : { initialIncrement: 0.1, minimumIncrement: 0.001, maximumIncrement: 0.2, maximumIncrements: 100 } },
    model: {
      projectRevision, coordinateSpace: 'frozen_analysis',
      domains: [
        { domainId: 'foundation', partId: 'contact-block', bodyId: 'block-body', occurrenceId: 'foundation:1', geometryDigest, transformToAnalysis: [...identity], shape },
        { domainId: 'slider', partId: 'contact-block', bodyId: 'block-body', occurrenceId: 'slider:1', geometryDigest, transformToAnalysis: [...translated], shape },
      ],
      references: [
        reference('foundation-support-face', 'foundation', 'constraint', [0, 5, 5], [-1, 0, 0], { min: [0, 0, 0], max: [0, 10, 10] }),
        reference('primary-contact-face', 'foundation', 'interaction', [10, 5, 5], [1, 0, 0], { min: [10, 0, 0], max: [10, 10, 10] }),
        reference('secondary-contact-face', 'slider', 'interaction', [0, 5, 5], [-1, 0, 0], { min: [0, 0, 0], max: [0, 10, 10] }),
        ...(!usesSliding ? [reference('slider-y-guide-face', 'slider', 'constraint', [5, 0, 5], [0, -1, 0], { min: [0, 0, 0], max: [10, 0, 10] })] : []),
        reference('slider-z-guide-face', 'slider', 'constraint', [5, 5, 0], [0, 0, -1], { min: [0, 0, 0], max: [10, 10, 0] }),
        reference('slider-end-face', 'slider', endRole, [10, 5, 5], [1, 0, 0], { min: [10, 0, 0], max: [10, 10, 10] }),
      ],
    },
    units: { geometry: 'mm', force: 'N', stress: 'MPa', displacement: 'mm', density: 'kg/m^3', acceleration: 'mm/s^2' },
    materials: [{ id: 'steel', name: 'Steel', model: 'isotropic_linear_elastic', densityKgM3: 7850, youngsModulusMPa: 210000, poissonRatio: 0.3, source: { kind: 'custom', reference: 'SIM-6A real-contact fixture' } }],
    materialAssignments: [
      { assignmentId: 'foundation-material', domainId: 'foundation', materialId: 'steel', volumeRegionId: 'foundation-volume' },
      { assignmentId: 'slider-material', domainId: 'slider', materialId: 'steel', volumeRegionId: 'slider-volume' },
    ],
    loads: contactCase === 'closing' || contactCase === 'nonconvergent'
      ? [{ id: 'close-contact', name: 'Close contact', type: 'surface_force', semanticReferenceIds: ['slider-end-face'], forceN: [-100, 0, 0], coordinateSystem: 'analysis' }]
      : [],
    constraints: [
      { id: 'foundation-support', name: 'Foundation support', type: 'fixed', semanticReferenceIds: ['foundation-support-face'] },
      ...(!usesSliding ? [{ id: 'slider-y-guide', name: 'Slider Y guide', type: 'prescribed_displacement' as const, semanticReferenceIds: ['slider-y-guide-face'], displacementMm: [null, 0, null] as [number | null, number | null, number | null], coordinateSystem: 'analysis' as const }] : []),
      { id: 'slider-z-guide', name: 'Slider Z guide', type: 'prescribed_displacement', semanticReferenceIds: ['slider-z-guide-face'], displacementMm: [null, null, 0], coordinateSystem: 'analysis' },
      ...(contactCase === 'opening' ? [{ id: 'open-slider', name: 'Open slider', type: 'prescribed_displacement' as const, semanticReferenceIds: ['slider-end-face'], displacementMm: [0.05, null, null] as [number | null, number | null, number | null], coordinateSystem: 'analysis' as const }] : []),
      ...(contactCase.startsWith('adjust_') ? [{ id: 'compress-adjusted-slider', name: 'Compress adjusted slider', type: 'prescribed_displacement' as const, semanticReferenceIds: ['slider-end-face'], displacementMm: [-0.01, null, null] as [number | null, number | null, number | null], coordinateSystem: 'analysis' as const }] : []),
      ...(usesSliding ? [{ id: 'drive-slider', name: 'Compress and slide slider', type: 'prescribed_displacement' as const, semanticReferenceIds: ['slider-end-face'], displacementMm: [-0.001, 0.02, null] as [number | null, number | null, number | null], coordinateSystem: 'analysis' as const }] : []),
    ],
    interactions: [{
      id: 'contact-patch', name: 'Planar contact patch', type: usesFriction ? 'frictional_contact' : 'frictionless_contact', secondaryReferenceIds: ['secondary-contact-face'], primaryReferenceIds: ['primary-contact-face'],
      formulation: 'node_to_surface_penalty', sliding: 'small', normalBehavior: { type: 'linear_penalty', stiffnessMPaPerMm: 1_050_000, tensionCutoffMPa: 0.000001, searchDistanceFactor: 0.01 },
      tangentialBehavior: usesFriction ? { type: 'coulomb_penalty', frictionCoefficient: 0.2, stickSlopeMPaPerMm: 5000 } : { type: 'frictionless' }, initialAdjustment: usesAdjustment
        ? { type: 'bounded_to_contact', maximumAdjustmentMm: 0.06 }
        : 'none',
    }],
    mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2, globalSizeMm: contactCase === 'nonconvergent' ? 5 : 2.5, minimumSizeMm: contactCase === 'nonconvergent' ? 1.25 : 0.625, maximumNodes: 100000, maximumElements: 50000, qualityMetric: 'provider_normalized', minimumQuality: 0.04 },
    requestedResults: ['von_mises_stress', 'displacement', 'reaction_force', 'contact_status', 'contact_pressure', 'normal_gap', 'tangential_slip', ...(usesFriction ? ['contact_shear' as const] : []), 'contact_force'],
  });
}

async function solve(
  request: NeutralSimulationRequestV2,
  step: Uint8Array,
  mesher: GmshMultiDomainMeshProvider,
  solver: CalculiXMultiDomainSolverProvider,
): Promise<NeutralSimulationResultV2> {
  return (await solveRun(request, step, mesher, solver)).result;
}

async function solveRun(
  request: NeutralSimulationRequestV2,
  step: Uint8Array,
  mesher: GmshMultiDomainMeshProvider,
  solver: CalculiXMultiDomainSolverProvider,
): Promise<{ result: NeutralSimulationResultV2; providerRunId: string }> {
  const model = await mesher.mesh(request, { descriptor: request.model, async exportDomain() { return step; } });
  const submission = await solver.submit(request, model);
  const deadline = Date.now() + solver.capabilities.execution.totalTimeoutMs;
  while (Date.now() < deadline) {
    const status = await solver.getStatus(submission.providerRunId);
    if (status.status === 'failed') throw new Error(`${status.failure?.code}: ${status.failure?.message}`);
    if (status.status === 'succeeded') {
      const result = await solver.getResult(submission.providerRunId);
      if (!result) throw new Error('CalculiX contact solve completed without a result.');
      return { result, providerRunId: submission.providerRunId };
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  await solver.cancel(submission.providerRunId);
  throw new Error('CalculiX contact solve exceeded its declared total timeout.');
}

async function providerDirectories(): Promise<string[]> {
  return (await readdir(tmpdir())).filter(name => name.startsWith('tunacad-calculix-v2-')).sort();
}

async function waitForDirectoriesRemoved(names: string[]): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const current = await providerDirectories();
    if (names.every(name => !current.includes(name))) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(`Native provider directories were not removed: ${names.join(', ')}`);
}

async function waitForTerminal(solver: CalculiXMultiDomainSolverProvider, providerRunId: string) {
  const deadline = Date.now() + solver.capabilities.execution.totalTimeoutMs;
  while (Date.now() < deadline) {
    const status = await solver.getStatus(providerRunId);
    if (['failed', 'succeeded', 'cancelled'].includes(status.status)) return status;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  await solver.cancel(providerRunId);
  throw new Error('CalculiX lifecycle fixture exceeded its declared total timeout.');
}
