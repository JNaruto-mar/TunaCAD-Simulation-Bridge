import assert from 'node:assert/strict';
import type { NeutralSimulationResultV2 } from '../src/simulation/externalSimulationContracts.ts';
import { bindFatigueToStructuralHistory, type StructuralStressHistory,
  type TrustedStructuralHistoryReader } from '../simulation-bridge/fatigueStructuralBinding.mts';
import { sealFatigueReferenceInput, type FatigueReferenceDraft } from '../simulation-bridge/fatigueReference.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';

const hash = (digit: string) => 'sha256:' + digit.repeat(64);
const result = {
  schema: 'tunacad-neutral-simulation-result/2.0',
  jobId: 'structural-job-1',
  requestDigest: hash('c'),
  projectRevision: 'structural-r1',
  modelDigest: hash('d'),
  analysisType: 'nonlinear_static',
  status: 'succeeded',
  authority: 'engineering',
  perDomain: [{ domainId: 'bar', fieldDatasetIds: ['bar:element-42:stress-history'] }],
  convergence: { status: 'converged' },
  mutation: { occurred: false },
} as unknown as NeutralSimulationResultV2;
const resultDigest = digest(result);
const history: StructuralStressHistory = {
  schema: 'tunacad-structural-stress-history/0.1',
  structuralJobId: result.jobId,
  structuralResultDigest: resultDigest,
  requestDigest: result.requestDigest,
  projectRevision: result.projectRevision,
  modelDigest: result.modelDigest,
  fieldDatasetId: 'bar:element-42:stress-history',
  location: { domainId: 'bar', elementId: 42, integrationPoint: 1,
    stressComponent: 'signed_uniaxial_normal_stress', axisAnalysis: [1, 0, 0] },
  units: { stress: 'MPa', time: 's' },
  samples: [{ timeS: 0, stressMPa: -300 }, { timeS: 1, stressMPa: 300 },
    { timeS: 2, stressMPa: -300 }],
};
const draft: FatigueReferenceDraft = {
  schema: 'tunacad-fatigue-reference/0.1',
  source: {
    structuralJobId: result.jobId, structuralResultDigest: resultDigest,
    requestDigest: result.requestDigest, projectRevision: result.projectRevision,
    modelDigest: result.modelDigest, fieldDatasetId: history.fieldDatasetId,
    fieldDatasetDigest: digest(history), ...history.location,
  },
  material: { materialId: 'steel-sn', provenance: { kind: 'custom',
    reference: 'fixture coupon', revision: 'r1' }, model: 'fully_reversed_stress_life',
  stressRatio: -1, snPoints: [
    { cyclesToFailure: 10_000, stressAmplitudeMPa: 400 },
    { cyclesToFailure: 100_000, stressAmplitudeMPa: 300 },
    { cyclesToFailure: 1_000_000, stressAmplitudeMPa: 200 },
  ] },
  history: { quantity: 'signed_uniaxial_stress', cycleShape: 'one_closed_min_max_min_cycle',
    interpolation: 'linear_between_turning_points', samples: structuredClone(history.samples),
    repeatedCycles: 100_000 },
  units: { stress: 'MPa', time: 's', life: 'cycles' },
};
const input = sealFatigueReferenceInput(draft);
function trustedReader(storedResult: NeutralSimulationResultV2 | null = result,
  storedHistory: unknown = history): TrustedStructuralHistoryReader {
  return {
    async readCompletedResult(jobId) {
      return jobId === result.jobId ? storedResult : null;
    },
    async readStressHistory(jobId, datasetId) {
      return jobId === result.jobId && datasetId === history.fieldDatasetId ? storedHistory : null;
    },
  };
}
const proof = await bindFatigueToStructuralHistory(input, trustedReader());
assert.equal(proof.structuralResultDigest, resultDigest);
assert.equal(proof.fieldDatasetDigest, digest(history));
assert.deepEqual(proof.verifiedSamples, history.samples);
assert.equal(proof.providerAdmission, 'closed');
assert.deepEqual(await bindFatigueToStructuralHistory(input, trustedReader()), proof);

let rejected = 0;
async function mustReject(candidate = input, storedResult: NeutralSimulationResultV2 | null = result,
  storedHistory: unknown = history) {
  await assert.rejects(bindFatigueToStructuralHistory(candidate,
    trustedReader(storedResult, storedHistory)), /SIM9_FATIGUE_(SOURCE_BINDING|REFERENCE)_INVALID/);
  rejected += 1;
}
function changedInput(change: (value: FatigueReferenceDraft) => void) {
  const changed = structuredClone(draft);
  change(changed);
  return sealFatigueReferenceInput(changed);
}
function changedResult(change: (value: NeutralSimulationResultV2) => void) {
  const changed = structuredClone(result);
  change(changed);
  return changed;
}
function changedHistory(change: (value: StructuralStressHistory) => void) {
  const changed = structuredClone(history);
  change(changed);
  return changed;
}
await mustReject(input, null); // A caller digest alone is not proof.
await mustReject(changedInput(value => { value.source.structuralJobId = 'different-job'; }));
await mustReject(changedInput(value => { value.source.structuralResultDigest = hash('a'); }));
await mustReject(changedInput(value => { value.source.fieldDatasetDigest = hash('b'); }));
await mustReject(changedInput(value => { value.source.domainId = 'other-domain'; }));
await mustReject(changedInput(value => { value.source.elementId = 43; }));
await mustReject(changedInput(value => { value.source.integrationPoint = 2; }));
await mustReject(changedInput(value => { value.source.axisAnalysis = [0, 1, 0]; }));
await mustReject(changedInput(value => { value.history.samples[1].stressMPa = 310;
  value.history.samples[0].stressMPa = -310; value.history.samples[2].stressMPa = -310; }));
await mustReject(input, changedResult(value => { value.status = 'failed'; }));
await mustReject(input, changedResult(value => { value.status = 'cancelled'; }));
await mustReject(input, changedResult(value => { value.authority = 'architecture_mock'; }));
await mustReject(input, changedResult(value => { value.convergence.status = 'failed'; }));
await mustReject(input, changedResult(value => { value.mutation.occurred = true; }));
await mustReject(input, changedResult(value => { value.requestDigest = hash('e'); }));
await mustReject(input, changedResult(value => { value.projectRevision = 'r2'; }));
await mustReject(input, changedResult(value => { value.modelDigest = hash('e'); }));
await mustReject(input, changedResult(value => { value.perDomain[0].fieldDatasetIds = []; }));
await mustReject(input, changedResult(value => { value.perDomain[0].fieldDatasetIds.push(history.fieldDatasetId); }));
await mustReject(input, changedResult(value => { value.convergence = null as never; }));
await mustReject(input, result, null);
await mustReject(input, result, changedHistory(value => { value.structuralResultDigest = hash('a'); }));
await mustReject(input, result, changedHistory(value => { value.structuralJobId = 'other-job'; }));
await mustReject(input, result, changedHistory(value => { value.requestDigest = hash('e'); }));
await mustReject(input, result, changedHistory(value => { value.projectRevision = 'r2'; }));
await mustReject(input, result, changedHistory(value => { value.modelDigest = hash('e'); }));
await mustReject(input, result, changedHistory(value => { value.fieldDatasetId = 'other-dataset'; }));
await mustReject(input, result, changedHistory(value => { value.units.stress = 'Pa' as 'MPa'; }));
await mustReject(input, result, changedHistory(value => { value.units.time = 'ms' as 's'; }));
await mustReject(input, result, changedHistory(value => { value.location.domainId = 'other-domain'; }));
await mustReject(input, result, changedHistory(value => { value.location.elementId = 43; }));
await mustReject(input, result, changedHistory(value => { value.location.integrationPoint = 2; }));
await mustReject(input, result, changedHistory(value => { value.location.axisAnalysis = [0, 1, 0]; }));
await mustReject(input, result, changedHistory(value => { value.samples[1].stressMPa = 301; }));
await mustReject(input, result, changedHistory(value => { value.samples[1].timeS = 0.5; }));
await mustReject(input, result, changedHistory(value => { value.samples = value.samples.slice(0, 2) as never; }));
await mustReject(input, result, changedHistory(value => { value.samples.push({ timeS: 3, stressMPa: 300 }); }));
await mustReject(input, result, changedHistory(value => { value.samples.reverse(); }));
console.log(JSON.stringify({ status: 'PASS', fixture: 'trusted structural history binding',
  resultDigest, historyDigest: digest(history), rejectedCases: rejected, providerAdmission: proof.providerAdmission }));
