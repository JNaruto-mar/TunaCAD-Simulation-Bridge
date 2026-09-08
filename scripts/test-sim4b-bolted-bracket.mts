import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCalculiXInputDeckV2 } from '../providers/calculix/CalculiXMultiDomainDeck.mts';
import { CalculiXMultiDomainSolverProvider } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { GmshMultiDomainMeshProvider } from '../providers/gmsh/GmshMultiDomainMeshProvider.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { sealNeutralSimulationRequestV2, validateNeutralSimulationRequestV2 } from '../simulation-bridge/v2Validation.mts';
import type { NeutralSimulationRequestV2, NeutralVector3 } from '../src/simulation/externalSimulationContracts.ts';

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (!gmsh || !calculix) throw new Error('Set TUNACAD_GMSH_EXECUTABLE and TUNACAD_CALCULIX_EXECUTABLE to run the SIM-4B bracket fixture.');

const fixture = JSON.parse(await readFile(new URL('../qualification/sim4b-bolted-bracket-rigid-connectors.json', import.meta.url), 'utf8')) as any;
assert.equal(fixture.schema, 'tunacad-simulation-benchmark-fixture/1.0');
assert.equal(fixture.fixtureId, 'sim4b-bolted-bracket-rigid-connectors');
assert.equal(fixture.status, 'experimental');
for (const vector of [fixture.geometry.baseSizeMm, fixture.geometry.webSizeMm, fixture.geometry.webTranslationAnalysisMm,
  fixture.load.referencePointAnalysisMm, fixture.load.forceN, fixture.load.momentNmm, fixture.support.referencePointAnalysisMm,
  fixture.support.translationMm, fixture.support.rotationRad, fixture.expected.supportReactionForceN, fixture.expected.supportReactionMomentNmm]) {
  assert.ok(Array.isArray(vector) && vector.length === 3 && vector.every(Number.isFinite), 'Fixture vectors must contain three finite components.');
}

const directory = await mkdtemp(join(tmpdir(), 'tunacad-sim4b-bracket-'));
try {
  const baseStep = await makeBoxStep('base', fixture.geometry.baseSizeMm);
  const webStep = await makeBoxStep('web', fixture.geometry.webSizeMm);
  const request = createBracketRequest();
  validateNeutralSimulationRequestV2(request);
  const mesher = new GmshMultiDomainMeshProvider({ executable: gmsh, runtimeVersion: '4.15.2' });
  const geometryByDomain = new Map([['bracket-base', baseStep], ['bracket-web', webStep]]);
  const model = await mesher.mesh(request, {
    descriptor: request.model,
    async exportDomain(domainId, format) {
      assert.equal(format, 'step');
      const bytes = geometryByDomain.get(domainId);
      if (!bytes) throw new Error(`Unexpected bracket domain ${domainId}.`);
      return bytes;
    },
  });
  assert.equal(model.domainRegions.length, 2);
  assert.deepEqual(new Set(model.volumeElements.domainIds), new Set(['bracket-base', 'bracket-web']));

  const deck = createCalculiXInputDeckV2(request, model);
  assert.equal((deck.match(/^\*RIGID BODY,/gm) ?? []).length, 2, 'The bracket must contain explicit support and load connectors.');
  assert.equal((deck.match(/^\*TIE,/gm) ?? []).length, 1, 'The web-to-base connection must remain an explicit bonded tie.');
  assert.match(deck, /^\*NSET, NSET=REACTION_MOMENT_001$/m);
  assert.match(deck, /^\*NODE PRINT, NSET=REACTION_MOMENT_001, TOTALS=ONLY, GLOBAL=YES$/m);

  const solver = new CalculiXMultiDomainSolverProvider({ executable: calculix, runtimeVersion: '2.16' });
  const submission = await solver.submit(request, model);
  const result = await waitForResult(solver, submission.providerRunId);
  const reaction = result.reactions.find(item => item.constraintId === 'bolt-group-support');
  assert.ok(reaction, 'The bolt-group support reaction is missing.');
  assert.equal(reaction.connectorId, 'bolt-group-connector');
  assert.deepEqual(reaction.referencePointAnalysisMm, fixture.support.referencePointAnalysisMm);
  assertVectorNear(reaction.forceN, fixture.expected.supportReactionForceN, fixture.expected.forceAbsoluteToleranceN, 'support reaction force');
  assert.ok(reaction.momentNmm, 'The bolt-group support moment was not normalized.');
  assertVectorNear(reaction.momentNmm, fixture.expected.supportReactionMomentNmm, fixture.expected.momentAbsoluteToleranceNmm, 'support reaction moment');
  assert.ok(result.metrics.maximumDisplacementMm! > fixture.expected.minimumNonzeroDisplacementMm);
  assert.ok(!result.warnings.some(warning => warning.code === 'SIMULATION_REMOTE_MOMENT_NOT_NORMALIZED'));

  const malformed = structuredClone(request);
  malformed.loads.push({ id: 'invalid-support-load', name: 'Invalid support load', type: 'remote_force', connectorId: 'bolt-group-connector', forceN: [1, 0, 0], momentNmm: [0, 0, 0], coordinateSystem: 'analysis' });
  reseal(malformed);
  assert.throws(() => validateNeutralSimulationRequestV2(malformed), error => error instanceof Error && error.message === 'BRIDGE_V2_CONNECTOR_INVALID');

  console.log(JSON.stringify({
    fixtureId: fixture.fixtureId,
    status: fixture.status,
    domains: model.domainRegions.map(domain => ({ domainId: domain.domainId, elementCount: domain.elementIndices.length })),
    connectors: request.interactions.filter(interaction => interaction.type === 'rigid_connector').map(interaction => interaction.id),
    reactionForceN: reaction.forceN,
    reactionMomentNmm: reaction.momentNmm,
    expectedReactionForceN: fixture.expected.supportReactionForceN,
    expectedReactionMomentNmm: fixture.expected.supportReactionMomentNmm,
    maximumDisplacementMm: result.metrics.maximumDisplacementMm,
    maximumVonMisesStressMPa: result.metrics.maximumVonMisesStressMPa,
    malformedLoadedSupport: 'BRIDGE_V2_CONNECTOR_INVALID',
    engineerReviewRequired: result.review.engineerReviewRequired,
  }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}

async function makeBoxStep(name: string, size: NeutralVector3): Promise<Uint8Array> {
  const stepPath = join(directory, `${name}.step`);
  const geoPath = join(directory, `${name}.geo`);
  const output = stepPath.replace(/\\/g, '/').replace(/"/g, '\\"');
  await writeFile(geoPath, [`SetFactory("OpenCASCADE");`, `Box(1) = {0, 0, 0, ${size.join(', ')}};`, `Save "${output}";`].join('\n'), 'utf8');
  execFileSync(gmsh!, [geoPath, '-0', '-v', '2'], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Uint8Array(await readFile(stepPath));
}

function createBracketRequest(): NeutralSimulationRequestV2 {
  const baseSize = fixture.geometry.baseSizeMm as NeutralVector3;
  const webSize = fixture.geometry.webSizeMm as NeutralVector3;
  const webTranslation = fixture.geometry.webTranslationAnalysisMm as NeutralVector3;
  const projectRevision = 'sim4b-bracket-r1';
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;
  const webTransform = [1, 0, 0, webTranslation[0], 0, 1, 0, webTranslation[1], 0, 0, 1, webTranslation[2], 0, 0, 0, 1] as const;
  const shape = (size: NeutralVector3) => ({
    valid: true as const, connectedSolidCount: 1 as const, faceCount: 6, edgeCount: 12,
    volumeMm3: size[0] * size[1] * size[2],
    surfaceAreaMm2: 2 * (size[0] * size[1] + size[0] * size[2] + size[1] * size[2]),
    boundingBoxOwnerLocalMm: { min: [0, 0, 0] as NeutralVector3, max: [...size] as NeutralVector3, size: [...size] as NeutralVector3 },
  });
  const face = (semanticReferenceId: string, domainId: string, ownerPartId: string, occurrenceId: string, centroid: NeutralVector3, areaMm2: number, outwardDirection: NeutralVector3, min: NeutralVector3, max: NeutralVector3) => ({
    semanticReferenceId, domainId, ownerPartId, ownerBodyId: `${ownerPartId}-body`, occurrenceId, geometryKind: 'FACE' as const, role: 'interaction' as const,
    sourceFeatureId: `${ownerPartId}-box`, resolutionState: 'valid' as const, resolvedAtProjectRevision: projectRevision,
    faceOwnerLocal: { centroidPartLocalMm: centroid, areaMm2, outwardDirection, geometryType: 'plane', edgeCount: 4, boundingBoxMm: { min, max } },
  });
  return sealNeutralSimulationRequestV2({
    schema: 'tunacad-neutral-simulation-request/2.0', studyId: fixture.fixtureId, name: 'SIM-4B bolted L-bracket connector fixture',
    preparedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    analysis: { type: 'linear_static', assumptions: ['small_displacement', 'small_strain', 'static_loading'] },
    model: {
      projectRevision, coordinateSpace: 'frozen_analysis',
      domains: [
        { domainId: 'bracket-base', partId: 'bracket-base-part', bodyId: 'bracket-base-part-body', occurrenceId: 'bracket-base-occurrence', geometryDigest: digest({ box: baseSize }), transformToAnalysis: [...identity], shape: shape(baseSize) },
        { domainId: 'bracket-web', partId: 'bracket-web-part', bodyId: 'bracket-web-part-body', occurrenceId: 'bracket-web-occurrence', geometryDigest: digest({ box: webSize }), transformToAnalysis: [...webTransform], shape: shape(webSize) },
      ],
      references: [
        face('base-bottom-bolt-group', 'bracket-base', 'bracket-base-part', 'bracket-base-occurrence', [20, 10, 0], 800, [0, 0, -1], [0, 0, 0], [40, 20, 0]),
        face('base-top-bond', 'bracket-base', 'bracket-base-part', 'bracket-base-occurrence', [20, 10, 5], 800, [0, 0, 1], [0, 0, 5], [40, 20, 5]),
        face('web-bottom-bond', 'bracket-web', 'bracket-web-part', 'bracket-web-occurrence', [2.5, 10, 0], 100, [0, 0, -1], [0, 0, 0], [5, 20, 0]),
        face('web-top-load-plate', 'bracket-web', 'bracket-web-part', 'bracket-web-occurrence', [2.5, 10, 40], 100, [0, 0, 1], [0, 0, 40], [5, 20, 40]),
      ],
    },
    units: { geometry: 'mm', force: 'N', stress: 'MPa', displacement: 'mm', density: 'kg/m^3', acceleration: 'mm/s^2' },
    materials: [{ id: 'steel', name: 'Fixture steel', model: 'isotropic_linear_elastic', densityKgM3: fixture.material.densityKgM3, youngsModulusMPa: fixture.material.youngsModulusMPa, poissonRatio: fixture.material.poissonRatio, source: { kind: 'custom', reference: fixture.fixtureId } }],
    materialAssignments: [
      { assignmentId: 'base-steel', domainId: 'bracket-base', materialId: 'steel', volumeRegionId: 'base-volume' },
      { assignmentId: 'web-steel', domainId: 'bracket-web', materialId: 'steel', volumeRegionId: 'web-volume' },
    ],
    loads: [{ id: 'eccentric-remote-load', name: 'Eccentric remote bracket load', type: 'remote_force', connectorId: 'load-point-connector', forceN: fixture.load.forceN, momentNmm: fixture.load.momentNmm, coordinateSystem: 'analysis' }],
    constraints: [{ id: 'bolt-group-support', name: 'Fixed bolt-group support', type: 'remote_displacement', connectorId: 'bolt-group-connector', translationMm: fixture.support.translationMm, rotationRad: fixture.support.rotationRad, coordinateSystem: 'analysis' }],
    interactions: [
      { id: 'web-base-bond', name: 'Bonded web to base', type: 'bonded_tie', secondaryReferenceIds: ['web-bottom-bond'], primaryReferenceIds: ['base-top-bond'], adjustment: 'none', positionToleranceMm: 0.05 },
      { id: 'bolt-group-connector', name: 'Rigid bolt-group connector', type: 'rigid_connector', semanticReferenceIds: ['base-bottom-bolt-group'], referencePointAnalysisMm: fixture.support.referencePointAnalysisMm, coupling: 'rigid_6dof' },
      { id: 'load-point-connector', name: 'Rigid remote load connector', type: 'rigid_connector', semanticReferenceIds: ['web-top-load-plate'], referencePointAnalysisMm: fixture.load.referencePointAnalysisMm, coupling: 'rigid_6dof' },
    ],
    mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2, globalSizeMm: 6, minimumSizeMm: 1.5, maximumNodes: 150000, maximumElements: 75000, qualityMetric: 'provider_normalized', minimumQuality: 0.04 },
    requestedResults: ['von_mises_stress', 'displacement', 'reaction_force', 'critical_regions'],
  });
}

function reseal(request: NeutralSimulationRequestV2): void {
  const sealed = sealNeutralSimulationRequestV2({ ...(request as any), requestDigest: undefined, model: { ...(request.model as any), modelDigest: undefined, domains: request.model.domains.map(domain => ({ ...domain, domainDigest: undefined })) } });
  Object.assign(request, sealed);
}

function assertVectorNear(actual: NeutralVector3, expected: NeutralVector3, tolerance: number, label: string): void {
  actual.forEach((value, axis) => assert.ok(Math.abs(value - expected[axis]) <= tolerance, `${label} component ${axis}: expected ${expected[axis]}, received ${value}.`));
}

async function waitForResult(solver: CalculiXMultiDomainSolverProvider, providerRunId: string) {
  const deadline = Date.now() + solver.capabilities.execution.totalTimeoutMs;
  while (Date.now() < deadline) {
    const status = await solver.getStatus(providerRunId);
    if (status.status === 'failed') throw new Error(`${status.failure?.code}: ${status.failure?.message}`);
    if (status.status === 'succeeded') {
      const result = await solver.getResult(providerRunId);
      if (!result) throw new Error('CalculiX completed without a normalized SIM-4B bracket result.');
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  await solver.cancel(providerRunId);
  throw new Error('SIM-4B bracket fixture timed out.');
}
