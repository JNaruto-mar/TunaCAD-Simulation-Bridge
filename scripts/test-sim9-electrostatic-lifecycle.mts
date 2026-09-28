import assert from 'node:assert/strict';
import {
  ElectrostaticAdmissionLifecycle, type ElectrostaticExecutionDriver,
  type ElectrostaticExecutionInput, type ElectrostaticNativeOutcome,
  type ElectrostaticRuntimeIdentity, type TrustedElectrostaticSourceReader,
} from '../simulation-bridge/electrostaticAdmission.mts';
import { assertElectrostaticNativeCompletion } from '../providers/calculix/CalculiXElectrostaticExecution.mts';
import { sealElectrostaticFoundation } from '../simulation-bridge/electrostaticFoundation.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { slabRequest, syntheticSlabMesh, syntheticElectricalDat } from './sim9-electrostatic-fixture.mts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(callback => resolve = callback);
  return { promise, resolve };
}
function setup() {
  const store = {
    request: slabRequest(), mesh: syntheticSlabMesh(), revision: 'electrical-slab-r1',
    runtime: { providerId: 'tunacad-calculix-electrostatic-development', providerVersion: '0.1.0',
      engine: 'CalculiX', engineVersion: '2.16', executableDigest: digest({ binary: 'synthetic' }),
      nodeMajor: 24, platform: 'win32', architecture: 'x64' } as ElectrostaticRuntimeIdentity,
  };
  const reader: TrustedElectrostaticSourceReader = {
    async readCurrentProjectRevision() { return store.revision; },
    async readSealedRequest() { return structuredClone(store.request); },
    async readValidatedMesh() { return structuredClone(store.mesh); },
    async readCurrentRuntimeIdentity() { return structuredClone(store.runtime); },
  };
  const started = deferred<ElectrostaticExecutionInput>();
  const finish = deferred<ElectrostaticNativeOutcome>();
  let calls = 0;
  const driver: ElectrostaticExecutionDriver = {
    async execute(input) { calls++; started.resolve(input); return finish.promise; },
  };
  const lifecycle = new ElectrostaticAdmissionLifecycle(reader, driver);
  const success = (input: ElectrostaticExecutionInput, output = syntheticElectricalDat(input.source.mesh)): ElectrostaticNativeOutcome =>
    ({ state: 'completed_converged', jobId: input.jobId, sourceDigest: input.source.identity.sourceDigest,
      runtime: input.source.identity.runtime, output, nativeEvidence, cleanupConfirmed: true });
  const nativeEvidence = { exitCode: 0 as const, completedStep: 1 as const, completedTime: 1 as const,
    statusDigest: digest({ syntheticStatus: true }), diagnosticDigest: digest({ syntheticDiagnostic: true }) };
  const reseal = () => {
    const { requestDigest: _digest, ...unsigned } = store.request;
    store.request = sealElectrostaticFoundation(unsigned);
    store.mesh.requestDigest = store.request.requestDigest;
  };
  return { store, reader, driver, lifecycle, started, finish, success, reseal, calls: () => calls };
}
async function terminal(lifecycle: ElectrostaticAdmissionLifecycle, id: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const status = lifecycle.getStatus(id);
    if (status.state !== 'queued' && status.state !== 'running') return status;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  throw new Error('Synthetic lifecycle did not terminate.');
}
async function complete(fixture: ReturnType<typeof setup>) {
  const job = fixture.lifecycle.submit(fixture.store.request.studyId);
  assert.equal(await fixture.lifecycle.getResult(job.jobId), null);
  const input = await fixture.started.promise;
  assert.equal(await fixture.lifecycle.getResult(job.jobId), null);
  fixture.finish.resolve(fixture.success(input));
  assert.equal((await terminal(fixture.lifecycle, job.jobId)).phase, 'succeeded_cleaned');
  const result = await fixture.lifecycle.getResult(job.jobId);
  assert.ok(result); return { job, result };
}

let cases = 0;
const authentic = setup(); const { job, result } = await complete(authentic);
assert.equal(result.jobId, job.jobId);
assert.equal(result.completedProviderState, 'completed_converged');
assert.equal(result.binding.requestDigest, authentic.store.request.requestDigest);
assert.equal(result.binding.modelDigest, digest(authentic.store.request.model));
assert.equal(result.binding.materialDigest, digest(authentic.store.request.material));
assert.equal(result.binding.absolutePermittivityFPerM, authentic.store.request.material.absolutePermittivityFPerM);
assert.deepEqual(result.binding.electrodeFaceIds, ['face-left', 'face-right']);
assert.deepEqual(result.binding.runtime, authentic.store.runtime);
const { resultDigest, ...unsigned } = result; assert.equal(resultDigest, digest(unsigned));
assert.equal(result.normalizedElectricalResultDigest, result.electrical.resultDigest);
assert.deepEqual(await authentic.lifecycle.getResult(job.jobId), result);
result.electrical.samples[0].electricPotentialV = 999;
assert.notEqual((await authentic.lifecycle.getResult(job.jobId))!.electrical.samples[0].electricPotentialV, 999);
assert.throws(() => authentic.lifecycle.submit({ requestDigest: result.binding.requestDigest } as never));
await assert.rejects(() => authentic.lifecycle.getResult('foreign-job'));
cases += 4;

const queuedBound = setup();
const boundA = queuedBound.lifecycle.submit(queuedBound.store.request.studyId);
const boundB = queuedBound.lifecycle.submit(queuedBound.store.request.studyId);
assert.throws(() => queuedBound.lifecycle.submit(queuedBound.store.request.studyId), /ELECTROSTATIC_JOB_LIMIT/);
await Promise.all([queuedBound.lifecycle.cancel(boundA.jobId), queuedBound.lifecycle.cancel(boundB.jobId)]);
cases++;
const pendingBound = setup();
const pendingLifecycle = new ElectrostaticAdmissionLifecycle(pendingBound.reader, {
  async execute(input) {
    return { state: 'failed', jobId: input.jobId, sourceDigest: input.source.identity.sourceDigest,
      runtime: input.source.identity.runtime, cleanupConfirmed: false, failureCode: 'cleanup pending' };
  },
});
for (let i = 0; i < 2; i++) {
  const pending = pendingLifecycle.submit(pendingBound.store.request.studyId);
  assert.equal((await terminal(pendingLifecycle, pending.jobId)).phase, 'cleanup_pending');
  assert.equal(await pendingLifecycle.getResult(pending.jobId), null);
}
assert.throws(() => pendingLifecycle.submit(pendingBound.store.request.studyId), /ELECTROSTATIC_JOB_LIMIT/);
cases++;

async function stale(label: string, mutate: (fixture: ReturnType<typeof setup>) => void) {
  const fixture = setup(); const { job } = await complete(fixture);
  mutate(fixture);
  assert.equal(await fixture.lifecycle.getResult(job.jobId), null, label);
  assert.equal(fixture.lifecycle.getStatus(job.jobId).state, 'failed');
  assert.equal(await fixture.lifecycle.getResult(job.jobId), null);
  cases++;
}
await stale('current CAD revision', f => f.store.revision = 'r2');
await stale('sealed request changed', f => { f.store.request.prescribedPotentials[1].potentialV = 90; f.reseal(); });
await stale('material/permittivity', f => { f.store.request.material.absolutePermittivityFPerM *= 2; f.reseal(); });
await stale('material provenance', f => { f.store.request.material.source.revision = 'r2'; f.reseal(); });
await stale('electrode FACE identity', f => {
  f.store.request.model.domains[0].shape.faces.xMin = 'new-left';
  f.store.request.prescribedPotentials[0].faceIds = ['new-left'];
  f.store.mesh.boundaryRegions[0].semanticReferenceIds = ['new-left']; f.reseal();
});
await stale('geometry identity', f => {
  const hash = digest({ changedGeometry: true });
  f.store.request.model.domains[0].geometryDigest = hash; f.store.mesh.geometryDigest = hash; f.reseal();
});
await stale('mesh changed within geometric tolerance', f => f.store.mesh.nodes[0][2] += 1e-10);
await stale('runtime binary changed', f => f.store.runtime.executableDigest = digest({ changedBinary: true }));
await stale('unsupported runtime version', f => f.store.runtime.engineVersion = '2.17' as never);
await stale('request digest tampered', f => f.store.request.requestDigest = digest({ tampered: true }));
await stale('provider changed', f => f.store.runtime.providerId = 'other' as never);
// Reader mutation during retrieval cannot pass a single snapshot check.
const racing = setup(); const racingCompleted = await complete(racing);
let reads = 0;
racing.reader.readCurrentRuntimeIdentity = async () => {
  const snapshot = structuredClone(racing.store.runtime);
  if (++reads === 1) racing.store.runtime.executableDigest = digest({ swappedBetweenReads: true });
  return snapshot;
};
assert.equal(await racing.lifecycle.getResult(racingCompleted.job.jobId), null); cases++;

const queued = setup(); const queuedJob = queued.lifecycle.submit(queued.store.request.studyId);
const queuedStatus = await queued.lifecycle.cancel(queuedJob.jobId);
assert.equal(queuedStatus.phase, 'cancelled_cleaned');
assert.equal(queued.calls(), 0); assert.equal(await queued.lifecycle.getResult(queuedJob.jobId), null); cases++;

const late = setup(); const lateJob = late.lifecycle.submit(late.store.request.studyId);
const lateInput = await late.started.promise;
const cancelling = late.lifecycle.cancel(lateJob.jobId);
assert.equal(await late.lifecycle.getResult(lateJob.jobId), null);
// A late successful completion, even with complete valid electrical data,
// cannot resurrect the cancelled job.
late.finish.resolve(late.success(lateInput));
assert.equal((await cancelling).phase, 'cancelled_cleaned');
assert.equal(await late.lifecycle.getResult(lateJob.jobId), null);
assert.equal(late.lifecycle.getStatus(lateJob.jobId).state, 'cancelled'); cases++;

const finalizing = setup(); const finalJob = finalizing.lifecycle.submit(finalizing.store.request.studyId);
const finalInput = await finalizing.started.promise;
const bindingPaused = deferred<void>(); const releaseBinding = deferred<void>();
finalizing.reader.readCurrentProjectRevision = async () => {
  bindingPaused.resolve(); await releaseBinding.promise; return finalizing.store.revision;
};
finalizing.finish.resolve(finalizing.success(finalInput));
await bindingPaused.promise;
const cancelFinal = finalizing.lifecycle.cancel(finalJob.jobId);
assert.equal(await finalizing.lifecycle.getResult(finalJob.jobId), null);
releaseBinding.resolve(); assert.equal((await cancelFinal).phase, 'cancelled_cleaned'); cases++;

async function failCase(label: string, outcome: (input: ElectrostaticExecutionInput,
  f: ReturnType<typeof setup>) => ElectrostaticNativeOutcome) {
  const f = setup(); const job = f.lifecycle.submit(f.store.request.studyId); const input = await f.started.promise;
  f.finish.resolve(outcome(input, f));
  assert.equal((await terminal(f.lifecycle, job.jobId)).state, 'failed', label);
  assert.equal(await f.lifecycle.getResult(job.jobId), null); cases++;
}
await failCase('solver failure', (input, f) => ({
  ...f.success(input), state: 'failed', failureCode: 'ELECTROSTATIC_SOLVER_FAILED',
} as unknown as ElectrostaticNativeOutcome));
await failCase('non-convergence', (input, f) => ({
  ...f.success(input), state: 'failed', failureCode: 'ELECTROSTATIC_NATIVE_FAILED_OR_NONCONVERGED',
} as ElectrostaticNativeOutcome));
await failCase('malformed output', (input, f) => f.success(input, 'malformed'));
await failCase('partial electrical output', (input, f) => f.success(input, syntheticElectricalDat(input.source.mesh).split(' heat flux')[0]));
await failCase('wrong completed job', (input, f) => ({ ...f.success(input), jobId: 'another-completed-job' }));
await failCase('wrong completed source', (input, f) => ({ ...f.success(input), sourceDigest: digest({ wrongSource: true }) }));
await failCase('wrong completed runtime', (input, f) => ({
  ...f.success(input), runtime: { ...input.source.identity.runtime, executableDigest: digest({ wrongRuntime: true }) },
}));
await failCase('missing native completion evidence', (input, f) => {
  const outcome = f.success(input); delete (outcome as any).nativeEvidence; return outcome;
});
await failCase('incomplete native completion evidence', (input, f) => ({
  ...f.success(input), nativeEvidence: { exitCode: 0, completedStep: 1, completedTime: 0.5,
    statusDigest: digest({ incomplete: true }), diagnosticDigest: digest({ incomplete: true }) },
} as unknown as ElectrostaticNativeOutcome));
await failCase('cleanup not confirmed', (input, f) => ({ ...f.success(input), cleanupConfirmed: false }));
await failCase('changed source during solve', (input, f) => {
  f.store.revision = 'changed-before-native-completion'; return f.success(input);
});
const sourceFailure = setup();
sourceFailure.reader.readValidatedMesh = async () => { throw new Error('source missing'); };
const missingJob = sourceFailure.lifecycle.submit(sourceFailure.store.request.studyId);
assert.equal((await terminal(sourceFailure.lifecycle, missingJob.jobId)).phase, 'failed_cleaned');
assert.equal(sourceFailure.calls(), 0); assert.equal(await sourceFailure.lifecycle.getResult(missingJob.jobId), null); cases++;

const diagnostic = 'This is Version 2.16\nJob finished\n';
const sta = ' STEP INC ATT ITRS TOT TIME STEP TIME INC TIME\n1 1 1 0 1 1 1\n';
assert.doesNotThrow(() => assertElectrostaticNativeCompletion(0, diagnostic, sta));
assert.doesNotThrow(() => assertElectrostaticNativeCompletion(0,
  diagnostic + 'divergence control settings\nmaximum iterations if no convergence\n no convergence\n convergence\n', sta));
for (const [code, log, status] of [
  [1, diagnostic, sta], [0, 'This is Version 2.16', sta],
  [0, diagnostic + '*ERROR no convergence', sta], [0, diagnostic, ''],
  [0, diagnostic, '1 1 1 0 0.5 0.5 0.5'], [0, diagnostic, sta + '1 2 1 0 1 1 1'],
  [0, diagnostic.replace('Job finished', 'Job incomplete'), sta], [0, diagnostic, '1 1 1 0 NaN 1 1'],
] as const) { assert.throws(() => assertElectrostaticNativeCompletion(code, log, status)); cases++; }
console.log(JSON.stringify({
  status: 'PASS', cases, provenance: 'synthetic_controlled_lifecycle_and_native_completion_guards',
  solverExecutions: 0, providerAdmission: 'closed', engineeringUsePermitted: false,
}));
