import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}

type ContactCase = 'closing' | 'opening';

function createRequest(contactCase: ContactCase): NeutralSimulationRequestV2 {
  const projectRevision = `sim6a-real-${contactCase}-r1`;
  const geometryDigest = digest({ fixture: '10x10x10-contact-block' });
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;
  const translated = [1, 0, 0, 10, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;
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
  const endRole = contactCase === 'closing' ? 'load' as const : 'constraint' as const;
  return sealNeutralSimulationRequestV2({
    schema: 'tunacad-neutral-simulation-request/2.0', studyId: `sim6a-real-${contactCase}`, name: `SIM-6A real patch ${contactCase}`,
    preparedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    analysis: { type: 'static_contact', assumptions: ['small_displacement', 'small_strain', 'quasi_static', 'frictionless_contact'], settings: { initialIncrement: 0.1, minimumIncrement: 0.001, maximumIncrement: 0.2, maximumIncrements: 100 } },
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
        reference('slider-y-guide-face', 'slider', 'constraint', [5, 0, 5], [0, -1, 0], { min: [0, 0, 0], max: [10, 0, 10] }),
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
    loads: contactCase === 'closing'
      ? [{ id: 'close-contact', name: 'Close contact', type: 'surface_force', semanticReferenceIds: ['slider-end-face'], forceN: [-100, 0, 0], coordinateSystem: 'analysis' }]
      : [],
    constraints: [
      { id: 'foundation-support', name: 'Foundation support', type: 'fixed', semanticReferenceIds: ['foundation-support-face'] },
      { id: 'slider-y-guide', name: 'Slider Y guide', type: 'prescribed_displacement', semanticReferenceIds: ['slider-y-guide-face'], displacementMm: [null, 0, null], coordinateSystem: 'analysis' },
      { id: 'slider-z-guide', name: 'Slider Z guide', type: 'prescribed_displacement', semanticReferenceIds: ['slider-z-guide-face'], displacementMm: [null, null, 0], coordinateSystem: 'analysis' },
      ...(contactCase === 'opening' ? [{ id: 'open-slider', name: 'Open slider', type: 'prescribed_displacement' as const, semanticReferenceIds: ['slider-end-face'], displacementMm: [0.05, null, null] as [number | null, number | null, number | null], coordinateSystem: 'analysis' as const }] : []),
    ],
    interactions: [{
      id: 'contact-patch', name: 'Planar contact patch', type: 'frictionless_contact', secondaryReferenceIds: ['secondary-contact-face'], primaryReferenceIds: ['primary-contact-face'],
      formulation: 'node_to_surface_penalty', sliding: 'small', normalBehavior: { type: 'linear_penalty', stiffnessMPaPerMm: 1_050_000, tensionCutoffMPa: 0.000001, searchDistanceFactor: 0.01 },
      tangentialBehavior: { type: 'frictionless' }, initialAdjustment: 'none',
    }],
    mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2, globalSizeMm: 2.5, minimumSizeMm: 0.625, maximumNodes: 100000, maximumElements: 50000, qualityMetric: 'provider_normalized', minimumQuality: 0.04 },
    requestedResults: ['von_mises_stress', 'displacement', 'reaction_force', 'contact_status', 'contact_pressure', 'normal_gap', 'tangential_slip', 'contact_force'],
  });
}

async function solve(
  request: NeutralSimulationRequestV2,
  step: Uint8Array,
  mesher: GmshMultiDomainMeshProvider,
  solver: CalculiXMultiDomainSolverProvider,
): Promise<NeutralSimulationResultV2> {
  const model = await mesher.mesh(request, { descriptor: request.model, async exportDomain() { return step; } });
  const submission = await solver.submit(request, model);
  const deadline = Date.now() + solver.capabilities.execution.totalTimeoutMs;
  while (Date.now() < deadline) {
    const status = await solver.getStatus(submission.providerRunId);
    if (status.status === 'failed') throw new Error(`${status.failure?.code}: ${status.failure?.message}`);
    if (status.status === 'succeeded') {
      const result = await solver.getResult(submission.providerRunId);
      if (!result) throw new Error('CalculiX contact solve completed without a result.');
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  await solver.cancel(submission.providerRunId);
  throw new Error('CalculiX contact solve exceeded its declared total timeout.');
}
