import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCalculiXInputDeckV2 } from '../providers/calculix/CalculiXMultiDomainDeck.mts';
import { CalculiXMultiDomainSolverProvider } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { GmshMultiDomainMeshProvider } from '../providers/gmsh/GmshMultiDomainMeshProvider.mts';
import { validateNeutralSimulationRequestV2 } from '../simulation-bridge/v2Validation.mts';
import type { NeutralVector3 } from '../src/simulation/externalSimulationContracts.ts';
import { createSim4bBracketRequest, loadSim4bBracketFixture, makeSim4bBoxStep, resealSim4bRequest } from './lib/sim4b-bracket-fixture.mts';

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (!gmsh || !calculix) throw new Error('Set TUNACAD_GMSH_EXECUTABLE and TUNACAD_CALCULIX_EXECUTABLE to run the SIM-4B bracket fixture.');

const fixture = await loadSim4bBracketFixture();
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
  const baseStep = await makeSim4bBoxStep(gmsh, directory, 'base', fixture.geometry.baseSizeMm);
  const webStep = await makeSim4bBoxStep(gmsh, directory, 'web', fixture.geometry.webSizeMm);
  const request = createSim4bBracketRequest(fixture);
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
  resealSim4bRequest(malformed);
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
