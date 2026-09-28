import assert from 'node:assert/strict';
import type { NeutralSimulationResultV2 } from '../src/simulation/externalSimulationContracts.ts';
import { FatigueAdmissionLifecycle } from '../simulation-bridge/fatigueAdmission.mts';
import { sealFatigueReferenceInput, type FatigueReferenceDraft } from '../simulation-bridge/fatigueReference.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import type { StructuralStressHistory, TrustedStructuralHistoryReader } from '../simulation-bridge/fatigueStructuralBinding.mts';

const hash = (digit: string) => 'sha256:' + digit.repeat(64);
const structuralResult = {
  schema: 'tunacad-neutral-simulation-result/2.0', jobId: 'structural-job-1',
  requestDigest: hash('c'), projectRevision: 'structural-r1', modelDigest: hash('d'),
  analysisType: 'nonlinear_static', status: 'succeeded', authority: 'engineering',
  convergence: { status: 'converged' }, mutation: { occurred: false },
  perDomain: [{ domainId: 'coupon', fieldDatasetIds: ['coupon:element-1:history'] }],
} as unknown as NeutralSimulationResultV2;
const history: StructuralStressHistory = {
  schema: 'tunacad-structural-stress-history/0.1',
  structuralJobId: structuralResult.jobId, structuralResultDigest: digest(structuralResult),
  requestDigest: structuralResult.requestDigest, projectRevision: structuralResult.projectRevision,
  modelDigest: structuralResult.modelDigest, fieldDatasetId: 'coupon:element-1:history',
  location: { domainId: 'coupon', elementId: 1, integrationPoint: 1,
    stressComponent: 'signed_uniaxial_normal_stress', axisAnalysis: [1, 0, 0] },
  units: { stress: 'MPa', time: 's' },
  samples: [{ timeS: 0, stressMPa: -300 }, { timeS: 1, stressMPa: 300 },
    { timeS: 2, stressMPa: -300 }],
};
const draft: FatigueReferenceDraft = {
  schema: 'tunacad-fatigue-reference/0.1',
  source: { structuralJobId: structuralResult.jobId,
    structuralResultDigest: digest(structuralResult),
    requestDigest: structuralResult.requestDigest,
    projectRevision: structuralResult.projectRevision, modelDigest: structuralResult.modelDigest,
    fieldDatasetId: history.fieldDatasetId, fieldDatasetDigest: digest(history),
    ...history.location },
  material: { materialId: 'steel-sn', provenance: { kind: 'custom',
    reference: 'fixture S-N coupon', revision: 'r1' },
    model: 'fully_reversed_stress_life', stressRatio: -1,
    snPoints: [{ cyclesToFailure: 10_000, stressAmplitudeMPa: 400 },
      { cyclesToFailure: 100_000, stressAmplitudeMPa: 300 },
      { cyclesToFailure: 1_000_000, stressAmplitudeMPa: 200 }] },
  history: { quantity: 'signed_uniaxial_stress',
    cycleShape: 'one_closed_min_max_min_cycle',
    interpolation: 'linear_between_turning_points',
    samples: structuredClone(history.samples), repeatedCycles: 10_000 },
  units: { stress: 'MPa', time: 's', life: 'cycles' },
};
const input = sealFatigueReferenceInput(draft);
function reader(result: NeutralSimulationResultV2 | null = structuralResult,
  artifact: unknown = history): TrustedStructuralHistoryReader {
  return { async readCompletedResult() { return structuredClone(result); },
    async readStressHistory() { return structuredClone(artifact); } };
}
async function settle() { await new Promise(resolve => setImmediate(resolve)); }
const service = new FatigueAdmissionLifecycle(reader());
const queued = service.submit(input);
assert.equal(queued.state, 'queued');
assert.equal(await service.getResult(queued.jobId), null);
await settle();
assert.equal(service.getStatus(queued.jobId).state, 'succeeded');
const admitted = (await service.getResult(queued.jobId))!;
assert.equal(admitted.schema, 'tunacad-fatigue-admitted-result/0.1');
assert.equal(admitted.sourceVerification, 'verified_trusted_structural_history');
assert.equal(admitted.structuralResultDigest, digest(structuralResult));
assert.equal(admitted.fieldDatasetDigest, digest(history));
assert.equal(admitted.bindingProofDigest.startsWith('sha256:'), true);
assert.equal(admitted.materialProvenance.revision, 'r1');
assert.equal(admitted.snCurveDigest, digest(draft.material.snPoints));
assert.equal(admitted.predictedLifeCycles, 100_000);
assert.equal(admitted.damageFraction, .1);
assert.equal(admitted.remainingCycles, 90_000);
assert.equal(admitted.predictedFailureWithinHistory, false);
assert.equal(admitted.engineeringUsePermitted, false);
admitted.materialProvenance.revision = 'tampered-clone';
assert.equal((await service.getResult(queued.jobId))!.materialProvenance.revision, 'r1');

let rejected = 0;
async function fails(candidateReader: TrustedStructuralHistoryReader, candidate = input) {
  const lifecycle = new FatigueAdmissionLifecycle(candidateReader);
  const job = lifecycle.submit(candidate);
  await settle();
  assert.equal(lifecycle.getStatus(job.jobId).state, 'failed');
  assert.equal(await lifecycle.getResult(job.jobId), null);
  rejected++;
}
await fails(reader(null)); // Claimed digest is not a source proof.
await fails(reader(structuralResult, null));
await fails(reader({ ...structuralResult, status: 'failed' }));
await fails(reader({ ...structuralResult, status: 'cancelled' }));
await fails(reader({ ...structuralResult, projectRevision: 'r2' }));
await fails(reader(structuralResult, { ...history, samples: history.samples.slice(0, 2) }));
await fails(reader(structuralResult, { ...history, samples: [
  history.samples[1], history.samples[0], history.samples[2],
] }));
await fails(reader(structuralResult, { ...history, location: { ...history.location, elementId: 2 } }));
await fails(reader(structuralResult, { ...history, units: { stress: 'Pa', time: 's' } }));
await fails(reader(structuralResult, { ...history, samples: [
  history.samples[0], { timeS: 1, stressMPa: 301 }, history.samples[2],
] }));
const alteredMaterial = structuredClone(input);
alteredMaterial.material.provenance.revision = 'r2';
assert.throws(() => service.submit(alteredMaterial), /SIM9_FATIGUE_REFERENCE_INVALID/);
rejected++;
const alteredCurve = structuredClone(input);
alteredCurve.material.snPoints[1].cyclesToFailure = 200_000;
assert.throws(() => service.submit(alteredCurve), /SIM9_FATIGUE_REFERENCE_INVALID/);
rejected++;
assert.throws(() => service.submit({ ...input, bindingProof: { verification: 'claimed' } }),
  /SIM9_FATIGUE_REFERENCE_INVALID/);
rejected++;

const cancelledQueued = service.submit(input);
assert.equal(service.cancel(cancelledQueued.jobId).state, 'cancelled');
await settle();
assert.equal(await service.getResult(cancelledQueued.jobId), null);

let release!: (value: NeutralSimulationResultV2) => void;
let entered!: () => void;
const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
const blocked = new Promise<NeutralSimulationResultV2>(resolve => { release = resolve; });
const active = new FatigueAdmissionLifecycle({
  async readCompletedResult() { entered(); return blocked; },
  async readStressHistory() { return history; },
});
const activeJob = active.submit(input);
await enteredPromise;
assert.equal(active.getStatus(activeJob.jobId).state, 'running');
assert.equal(await active.getResult(activeJob.jobId), null);
assert.equal(active.cancel(activeJob.jobId).state, 'cancelled');
release(structuralResult);
await settle();
assert.equal(active.getStatus(activeJob.jobId).state, 'cancelled');
assert.equal(await active.getResult(activeJob.jobId), null);

let secondRead!: () => void;
let releaseSecond!: () => void;
const secondReadPromise = new Promise<void>(resolve => { secondRead = resolve; });
const secondBlock = new Promise<void>(resolve => { releaseSecond = resolve; });
let readCount = 0;
const cancelledAfterProof = new FatigueAdmissionLifecycle({
  async readCompletedResult() {
    readCount++;
    if (readCount === 2) { secondRead(); await secondBlock; }
    return structuralResult;
  },
  async readStressHistory() { return history; },
});
const afterProofJob = cancelledAfterProof.submit(input);
await secondReadPromise;
assert.equal(cancelledAfterProof.getStatus(afterProofJob.jobId).state, 'running');
assert.equal(cancelledAfterProof.cancel(afterProofJob.jobId).state, 'cancelled');
releaseSecond();
await settle();
assert.equal(await cancelledAfterProof.getResult(afterProofJob.jobId), null);

let reads = 0;
const changing = new FatigueAdmissionLifecycle({
  async readCompletedResult() {
    reads++;
    return reads === 1 ? structuralResult : { ...structuralResult, modelDigest: hash('e') };
  },
  async readStressHistory() { return history; },
});
const changingJob = changing.submit(input);
await settle();
assert.equal(changing.getStatus(changingJob.jobId).state, 'failed');
assert.equal(await changing.getResult(changingJob.jobId), null);

let currentResult = structuralResult;
let currentHistory = history;
const afterCompletion = new FatigueAdmissionLifecycle({
  async readCompletedResult() { return currentResult; },
  async readStressHistory() { return currentHistory; },
});
const completed = afterCompletion.submit(input);
await settle();
assert.equal(afterCompletion.getStatus(completed.jobId).state, 'succeeded');
currentResult = { ...structuralResult, requestDigest: hash('e') };
assert.equal(await afterCompletion.getResult(completed.jobId), null);
assert.equal(afterCompletion.getStatus(completed.jobId).state, 'failed');
currentResult = structuralResult;
assert.equal(await afterCompletion.getResult(completed.jobId), null);
const changedHistoryJob = afterCompletion.submit(input);
await settle();
assert.equal(afterCompletion.getStatus(changedHistoryJob.jobId).state, 'succeeded');
currentHistory = { ...history, samples: [
  history.samples[0], { timeS: 1, stressMPa: 302 }, history.samples[2],
] };
assert.equal(await afterCompletion.getResult(changedHistoryJob.jobId), null);
assert.equal(afterCompletion.getStatus(changedHistoryJob.jobId).state, 'failed');
console.log(JSON.stringify({ status: 'PASS', fixture: 'proof-required fatigue result admission',
  predictedLifeCycles: 100_000, damageFraction: .1, rejectedCases: rejected,
  cancelled: ['queued', 'running'], quarantinedAfterSourceChange: true,
  engineeringUsePermitted: false }));
