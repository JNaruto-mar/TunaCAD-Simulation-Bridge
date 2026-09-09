import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ComposedSimulationProviderV2 } from '../providers/ComposedSimulationProviderV2.mts';
import { CalculiXMultiDomainSolverProvider } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { createCalculiXInputDeckV2 } from '../providers/calculix/CalculiXMultiDomainDeck.mts';
import { GmshMultiDomainMeshProvider } from '../providers/gmsh/GmshMultiDomainMeshProvider.mts';
import { validateNeutralSimulationRequestV2 } from '../simulation-bridge/v2Validation.mts';
import type { NeutralSimulationRequestV2 } from '../src/simulation/externalSimulationContracts.ts';
import { createSim4bBracketRequest, loadSim4bBracketFixture, makeSim4bBoxStep, resealSim4bRequest } from './lib/sim4b-bracket-fixture.mts';

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (!gmsh || !calculix) throw new Error('Set TUNACAD_GMSH_EXECUTABLE and TUNACAD_CALCULIX_EXECUTABLE to run the SIM-4B failure fixtures.');

const directory = await mkdtemp(join(tmpdir(), 'tunacad-sim4b-failures-'));
try {
  const fixture = await loadSim4bBracketFixture();
  const baseline = createSim4bBracketRequest(fixture);
  const geometryByDomain = new Map([
    ['bracket-base', await makeSim4bBoxStep(gmsh, directory, 'base', fixture.geometry.baseSizeMm)],
    ['bracket-web', await makeSim4bBoxStep(gmsh, directory, 'web', fixture.geometry.webSizeMm)],
  ]);
  const geometry = {
    descriptor: baseline.model,
    async exportDomain(domainId: string, format: 'step') {
      assert.equal(format, 'step');
      const bytes = geometryByDomain.get(domainId);
      if (!bytes) throw new Error(`Unexpected SIM-4B failure-fixture domain "${domainId}".`);
      return bytes;
    },
  };
  const mesher = new GmshMultiDomainMeshProvider({ executable: gmsh, runtimeVersion: '4.15.2' });
  const model = await mesher.mesh(baseline, geometry);
  assert.doesNotThrow(() => createCalculiXInputDeckV2(baseline, model), 'The fully connected and restrained baseline must pass stability admission.');

  const disconnected = structuredClone(baseline);
  disconnected.studyId = 'sim4b-intentionally-disconnected';
  disconnected.name = 'SIM-4B intentionally disconnected web';
  disconnected.interactions = disconnected.interactions.filter(interaction => interaction.id !== 'web-base-bond');
  disconnected.model.references = disconnected.model.references.filter(reference => !['base-top-bond', 'web-bottom-bond'].includes(reference.semanticReferenceId));
  resealSim4bRequest(disconnected);
  validateNeutralSimulationRequestV2(disconnected);
  const disconnectedModel = await mesher.mesh(disconnected, { ...geometry, descriptor: disconnected.model });
  expectDeckFailure(disconnected, disconnectedModel, 'SIMULATION_MODEL_DISCONNECTED');

  const independentlySupported = structuredClone(baseline);
  independentlySupported.studyId = 'sim4b-independently-supported-domains';
  independentlySupported.name = 'SIM-4B intentionally separate but independently supported domains';
  independentlySupported.interactions = independentlySupported.interactions.filter(interaction => interaction.id !== 'web-base-bond');
  independentlySupported.model.references = independentlySupported.model.references
    .filter(reference => reference.semanticReferenceId !== 'base-top-bond')
    .map(reference => reference.semanticReferenceId === 'web-bottom-bond' ? { ...reference, role: 'constraint' as const } : reference);
  independentlySupported.constraints.push({ id: 'web-independent-support', name: 'Independent fixed web support', type: 'fixed', semanticReferenceIds: ['web-bottom-bond'] });
  resealSim4bRequest(independentlySupported);
  validateNeutralSimulationRequestV2(independentlySupported);
  const independentlySupportedModel = await mesher.mesh(independentlySupported, { ...geometry, descriptor: independentlySupported.model });
  assert.doesNotThrow(() => createCalculiXInputDeckV2(independentlySupported, independentlySupportedModel), 'Fully restrained disconnected domains must remain supported.');

  const underconstrained = structuredClone(baseline);
  underconstrained.studyId = 'sim4b-underconstrained-connected';
  underconstrained.name = 'SIM-4B connected bracket with one free rigid rotation';
  const support = underconstrained.constraints.find(constraint => constraint.type === 'remote_displacement');
  assert.ok(support && support.type === 'remote_displacement');
  support.rotationRad = [0, 0, null];
  resealSim4bRequest(underconstrained);
  validateNeutralSimulationRequestV2(underconstrained);
  const underconstrainedModel = await mesher.mesh(underconstrained, { ...geometry, descriptor: underconstrained.model });
  expectDeckFailure(underconstrained, underconstrainedModel, 'SIMULATION_MODEL_UNDERCONSTRAINED');

  const disconnectedStatus = await expectPipelineFailure(disconnected, 'SIMULATION_MODEL_DISCONNECTED');
  const underconstrainedStatus = await expectPipelineFailure(underconstrained, 'SIMULATION_MODEL_UNDERCONSTRAINED');
  console.log(JSON.stringify({
    fixture: fixture.fixtureId,
    disconnected: { code: disconnectedStatus.failure!.code, phase: disconnectedStatus.phase, resultQuarantined: true },
    underconstrained: { code: underconstrainedStatus.failure!.code, phase: underconstrainedStatus.phase, resultQuarantined: true },
    independentlySupportedDisconnectedDomains: 'admitted',
    solverLaunch: 'blocked by deterministic six-rigid-body-mode admission',
  }, null, 2));

  function expectDeckFailure(request: NeutralSimulationRequestV2, candidateModel: typeof model, code: string): void {
    assert.throws(() => createCalculiXInputDeckV2(request, candidateModel), error => (error as Error & { code?: string }).code === code);
  }

  async function expectPipelineFailure(request: NeutralSimulationRequestV2, code: string) {
    const provider = new ComposedSimulationProviderV2({
      id: 'sim4b-failure-pipeline', version: '1.0.0',
      meshProvider: new GmshMultiDomainMeshProvider({ executable: gmsh!, runtimeVersion: '4.15.2' }),
      solverProvider: new CalculiXMultiDomainSolverProvider({ executable: calculix!, runtimeVersion: '2.16' }),
    });
    const submission = await provider.submit(request, { ...geometry, descriptor: request.model });
    const deadline = Date.now() + provider.capabilities.execution.totalTimeoutMs;
    while (Date.now() < deadline) {
      const status = await provider.getStatus(submission.providerRunId);
      if (status.status === 'failed') {
        assert.equal(status.failure?.code, code);
        assert.equal(status.phase, 'failed');
        assert.equal(await provider.getResult(submission.providerRunId), null);
        return status;
      }
      if (status.status === 'succeeded' || status.status === 'cancelled') assert.fail(`Expected ${code}, received ${status.status}.`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await provider.cancel(submission.providerRunId);
    assert.fail(`Timed out waiting for stable failure ${code}.`);
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
