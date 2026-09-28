import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { GmshMeshProvider } from '../providers/gmsh/GmshMeshProvider.mts';
import { CalculiXElectrostaticExecution } from '../providers/calculix/CalculiXElectrostaticExecution.mts';
import { electrostaticSlabMeshInputs } from '../providers/calculix/CalculiXElectrostaticSlab.mts';
import {
  ElectrostaticAdmissionLifecycle, type ElectrostaticExecutionDriver, type ElectrostaticNativeOutcome,
  type TrustedElectrostaticSourceReader,
} from '../simulation-bridge/electrostaticAdmission.mts';
import {
  hasEnforcedProviderProcessQuotas, monitorWorkingDirectory, removeWorkingDirectory,
  spawnProviderProcess, terminateChildProcess,
} from '../providers/processLifecycle.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { slabRequest } from './sim9-electrostatic-fixture.mts';

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (!gmsh || !calculix || !hasEnforcedProviderProcessQuotas()) throw new Error('Explicit provider paths and Windows x64 quotas required.');
const directory = await mkdtemp(join(tmpdir(), 'tunacad-electrical-lifecycle-fixture-'));
let mesher: GmshMeshProvider | null = null; let meshRunId: string | null = null;
let lifecycle: ElectrostaticAdmissionLifecycle | null = null;
const submittedIds: string[] = [];
try {
  assert.match(await runGmsh(['--version']), /(?:^|\s)4\.15\.2(?:\s|$)/);
  const stepPath = join(directory, 'slab.step'); const geoPath = join(directory, 'slab.geo');
  await writeFile(geoPath, 'SetFactory("OpenCASCADE");\nBox(1)={0,0,0,1,10,10};\nSave "'
    + stepPath.replaceAll('\\', '/') + '";\n', 'utf8');
  await runGmsh([geoPath, '-0', '-v', '2']);
  const step = new Uint8Array(await readFile(stepPath));
  const request = slabRequest(digest(Array.from(step)));
  const { meshRequest, descriptor } = electrostaticSlabMeshInputs(request, 2);
  mesher = new GmshMeshProvider({ executable: gmsh, runtimeVersion: '4.15.2' });
  meshRunId = (await mesher.submit(meshRequest, { descriptor, async export() { return step; } })).meshRunId;
  let mesh = null; const meshDeadline = Date.now() + 60_000;
  while (Date.now() < meshDeadline) {
    const status = await mesher.getStatus(meshRunId);
    if (status.status === 'failed' || status.status === 'cancelled') throw new Error(JSON.stringify(status));
    if (status.status === 'succeeded') { mesh = await mesher.getMesh(meshRunId); break; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!mesh) throw new Error('Electrical lifecycle mesh missing.');
  const native = new CalculiXElectrostaticExecution(calculix);
  let currentRevision = request.model.projectRevision;
  const reader: TrustedElectrostaticSourceReader = {
    async readCurrentProjectRevision() { return currentRevision; },
    async readSealedRequest() { return structuredClone(request); },
    async readValidatedMesh() { return structuredClone(mesh!); },
    async readCurrentRuntimeIdentity() { return native.readCurrentRuntimeIdentity(); },
  };
  let activeCancellationId: string | null = null;
  let cancellation: Promise<unknown> | null = null;
  let nativeCalls = 0; let completedNativeCalls = 0;
  let authenticOutcome: Extract<ElectrostaticNativeOutcome, { state: 'completed_converged' }> | null = null;
  let nativeStartObserved = false; let inputArtifactObserved = false; let nativeOutputFileObserved = false;
  const driver: ElectrostaticExecutionDriver = {
    async execute(input) {
      nativeCalls++;
      const outcome = await native.execute({
        ...input,
        onProgress(phase) {
          input.onProgress(phase);
          if (phase === 'native_solver_started' && input.jobId === activeCancellationId) {
            nativeStartObserved = true;
            const prefix = 'tunacad-electrical-job-' + input.jobId + '-';
            const name = readdirSync(tmpdir()).find(name => name.startsWith(prefix));
            if (name) {
              inputArtifactObserved = existsSync(join(tmpdir(), name, 'electrical.inp'));
              nativeOutputFileObserved = existsSync(join(tmpdir(), name, 'electrical.dat'));
            }
            // Legitimate cancellation immediately on actual native output.
            // The tiny solve can finish numerically in that output chunk; this
            // intentionally covers the native-finish/publication race too.
            cancellation = lifecycle!.cancel(input.jobId);
          }
        },
      });
      if (outcome.state === 'completed_converged') { completedNativeCalls++; authenticOutcome = outcome; }
      return outcome;
    },
  };
  lifecycle = new ElectrostaticAdmissionLifecycle(reader, driver);
  const success = lifecycle.submit(request.studyId); submittedIds.push(success.jobId);
  assert.equal(await lifecycle.getResult(success.jobId), null);
  const completedStatus = await waitForTerminal(lifecycle, success.jobId);
  assert.equal(completedStatus.phase, 'succeeded_cleaned', JSON.stringify(completedStatus));
  const result = await lifecycle.getResult(success.jobId);
  assert.ok(result); assert.ok(authenticOutcome);
  assert.equal(result.jobId, success.jobId);
  assert.equal(result.binding.requestDigest, request.requestDigest);
  assert.equal(result.binding.meshDigest, digest(mesh));
  assert.equal(result.binding.materialDigest, digest(request.material));
  assert.deepEqual(result.binding.electrodeFaceIds, ['face-left', 'face-right']);
  assert.deepEqual(await lifecycle.getResult(success.jobId), result);
  assert.equal((await providerDirectories(success.jobId)).length, 0);
  currentRevision = 'changed-after-completion';
  assert.equal(await lifecycle.getResult(success.jobId), null);
  assert.equal(lifecycle.getStatus(success.jobId).state, 'failed');
  currentRevision = request.model.projectRevision;
  assert.equal(await lifecycle.getResult(success.jobId), null, 'Restoring a source must not revive an invalidated completion.');

  const queued = lifecycle.submit(request.studyId); submittedIds.push(queued.jobId);
  assert.equal((await lifecycle.cancel(queued.jobId)).phase, 'cancelled_cleaned');
  assert.equal(await lifecycle.getResult(queued.jobId), null);
  assert.equal(nativeCalls, 1, 'Queued cancellation must not invoke the native adapter.');
  assert.equal((await providerDirectories(queued.jobId)).length, 0);

  const active = lifecycle.submit(request.studyId); submittedIds.push(active.jobId);
  activeCancellationId = active.jobId;
  const activeStatus = await waitForTerminal(lifecycle, active.jobId);
  if (cancellation) await cancellation;
  assert.ok(nativeStartObserved && inputArtifactObserved);
  assert.equal(activeStatus.phase, 'cancelled_cleaned');
  assert.equal(await lifecycle.getResult(active.jobId), null);
  assert.equal((await providerDirectories(active.jobId)).length, 0);
  assert.equal(completedNativeCalls, 1);

  // Authentic completed raw data, but controlled failure flags/output mutation:
  // these are NOT additional native solves or actual nonlinear non-convergence.
  let rejectedReplays = 0;
  for (const mode of ['native_failure', 'non_convergence', 'partial_output', 'malformed_output', 'foreign_job'] as const) {
    const replay = new ElectrostaticAdmissionLifecycle(reader, {
      async execute(input) {
        const base = { jobId: input.jobId, sourceDigest: input.source.identity.sourceDigest,
          runtime: input.source.identity.runtime, cleanupConfirmed: true };
        if (mode === 'native_failure' || mode === 'non_convergence') {
          return { ...base, state: 'failed', failureCode: mode === 'native_failure'
            ? 'ELECTROSTATIC_NATIVE_FAILED' : 'ELECTROSTATIC_NATIVE_FAILED_OR_NONCONVERGED' };
        }
        const output = mode === 'partial_output'
          ? authenticOutcome!.output.split(/heat flux/i)[0]
          : mode === 'malformed_output' ? authenticOutcome!.output + '\nNaN malformed\n' : authenticOutcome!.output;
        return { ...base, state: 'completed_converged', nativeEvidence: authenticOutcome!.nativeEvidence, output,
          jobId: mode === 'foreign_job' ? success.jobId : input.jobId };
      },
    });
    const job = replay.submit(request.studyId);
    assert.equal((await waitForTerminal(replay, job.jobId)).phase, 'failed_cleaned');
    assert.equal(await replay.getResult(job.jobId), null); rejectedReplays++;
  }
  // A real unavailable executable is an environment/start failure, not a
  // deliberately non-converged dielectric solve.
  const unavailable = new CalculiXElectrostaticExecution(join(directory, 'missing', 'ccx216.exe'));
  const startFailure = new ElectrostaticAdmissionLifecycle(reader, unavailable);
  const failure = startFailure.submit(request.studyId);
  assert.equal((await waitForTerminal(startFailure, failure.jobId)).phase, 'failed_cleaned');
  assert.equal(await startFailure.getResult(failure.jobId), null);
  assert.equal((await providerDirectories(failure.jobId)).length, 0);
  console.log(JSON.stringify({
    status: 'PASS', fixture: 'bounded-electrical-completion-and-quarantine',
    runtime: result.binding.runtime,
    mesh: { nodes: mesh.nodes.length, elements: mesh.volumeElements.connectivity.length, element: 'DC3D10' },
    nativeExecutions: nativeCalls, completedNativeExecutions: completedNativeCalls,
    successfulBinding: { jobId: result.jobId, requestDigest: result.binding.requestDigest,
      projectRevision: result.binding.projectRevision, modelDigest: result.binding.modelDigest,
      materialDigest: result.binding.materialDigest, electrodeFaceIds: result.binding.electrodeFaceIds,
      meshDigest: result.binding.meshDigest, deckDigest: result.binding.deckDigest,
      normalizedElectricalResultDigest: result.normalizedElectricalResultDigest,
      completionDigest: result.completionDigest, resultDigest: result.resultDigest },
    lifecycle: { noEarlyResult: true, queuedCancellation: 'cancelled_cleaned',
      activeCancellation: activeStatus.phase, nativeStartObserved, inputArtifactObserved,
      nativeOutputFileObserved, cancelledResult: null, sourceMutationInvalidatedRetrieval: true,
      startFailure: 'failed_cleaned', controlledAuthenticDataReplaysRejected: rejectedReplays,
      temporaryArtifactCleanupConfirmed: true },
    electrical: { capacitanceF: result.electrical.capacitanceF, energyJ: result.electrical.electrostaticEnergyJ,
      netChargeC: result.electrical.consistency.netElectrodeChargeC },
    providerAdmission: 'closed', engineeringUsePermitted: false,
  }, null, 2));
} finally {
  for (const id of submittedIds) if (lifecycle) await lifecycle.cancel(id);
  if (mesher && meshRunId) await mesher.cancel(meshRunId);
  if (!await removeWorkingDirectory(directory)) throw new Error('Electrical lifecycle fixture cleanup pending.');
}

async function providerDirectories(jobId: string) {
  return (await readdir(tmpdir())).filter(name => name.startsWith('tunacad-electrical-job-' + jobId + '-'));
}
async function waitForTerminal(provider: ElectrostaticAdmissionLifecycle, id: string) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const status = provider.getStatus(id);
    if (status.state !== 'queued' && status.state !== 'running' && status.phase !== 'cancelling') return status;
    if (status.state === 'queued' || status.state === 'running') assert.equal(await provider.getResult(id), null);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  await provider.cancel(id); throw new Error('Electrical lifecycle timed out.');
}
async function runGmsh(args: string[]) {
  const child = spawnProviderProcess(gmsh!, args, {
    cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: dirname(gmsh!) + ';' + (process.env.PATH ?? '') },
  }, { cpuTimeLimitMs: 30_000, memoryLimitBytes: 512 * 1024 * 1024 });
  let diagnostic = ''; let exceeded = false;
  const collect = (chunk: unknown) => diagnostic = (diagnostic + String(chunk)).slice(-12000);
  child.stdout?.on('data', collect); child.stderr?.on('data', collect);
  const stop = monitorWorkingDirectory({ child, directory, maximumBytes: 64 * 1024 * 1024,
    async onExceeded() { exceeded = true; await terminateChildProcess(child); } });
  const timer = setTimeout(() => { exceeded = true; void terminateChildProcess(child); }, 30_000); timer.unref();
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject); child.once('close', resolve);
    });
    if (exceeded || code !== 0) throw new Error('Electrical fixture geometry operation failed: ' + diagnostic);
    return diagnostic;
  } finally { clearTimeout(timer); stop(); await terminateChildProcess(child); }
}
