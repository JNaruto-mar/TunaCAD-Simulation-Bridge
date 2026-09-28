import assert from 'node:assert/strict';
import { CalculiXMultiDomainSolverProvider } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { evaluateFatigueReference, sealFatigueReferenceInput, validateFatigueReferenceInput,
  type FatigueReferenceDraft } from '../simulation-bridge/fatigueReference.mts';

const amplitude = Math.sqrt(300 * 200);
const draft: FatigueReferenceDraft = {
  schema: 'tunacad-fatigue-reference/0.1',
  source: {
    structuralJobId: 'structural-job-1',
    structuralResultDigest: 'sha256:' + 'a'.repeat(64),
    requestDigest: 'sha256:' + 'c'.repeat(64),
    projectRevision: 'structural-r1',
    modelDigest: 'sha256:' + 'd'.repeat(64),
    fieldDatasetId: 'bar:element-42:stress-history',
    fieldDatasetDigest: 'sha256:' + 'b'.repeat(64),
    domainId: 'bar',
    elementId: 42,
    integrationPoint: 1,
    stressComponent: 'signed_uniaxial_normal_stress',
    axisAnalysis: [1, 0, 0],
  },
  material: {
    materialId: 'steel-sn',
    provenance: { kind: 'custom', reference: 'fully-reversed coupon data', revision: 'r1' },
    model: 'fully_reversed_stress_life',
    stressRatio: -1,
    snPoints: [
      { cyclesToFailure: 10_000, stressAmplitudeMPa: 400 },
      { cyclesToFailure: 100_000, stressAmplitudeMPa: 300 },
      { cyclesToFailure: 1_000_000, stressAmplitudeMPa: 200 },
    ],
  },
  history: {
    quantity: 'signed_uniaxial_stress',
    cycleShape: 'one_closed_min_max_min_cycle',
    interpolation: 'linear_between_turning_points',
    samples: [{ timeS: 0, stressMPa: -amplitude }, { timeS: 1, stressMPa: amplitude },
      { timeS: 2, stressMPa: -amplitude }],
    repeatedCycles: 100_000,
  },
  units: { stress: 'MPa', time: 's', life: 'cycles' },
};
const input = sealFatigueReferenceInput(draft);
assert.deepEqual(validateFatigueReferenceInput(input), input);
assert.deepEqual(sealFatigueReferenceInput(structuredClone(draft)), input);
const result = evaluateFatigueReference(input);
const expectedLife = Math.sqrt(100_000 * 1_000_000);
assert(Math.abs(result.predictedLifeCycles - expectedLife) < 1e-7);
assert(Math.abs(result.damageFraction - 100_000 / expectedLife) < 1e-12);
assert(Math.abs(result.remainingCycles - (expectedLife - 100_000)) < 1e-7);
assert.equal(result.predictedFailureWithinHistory, false);
assert.equal(result.meanStressMPa, 0);
assert.equal(result.stressRatio, -1);
assert.equal(result.uncertainty, 'not_quantified');
assert.equal(result.convergence, 'not_evaluated_reference_only');
assert.equal(result.sourceVerification, 'caller_supplied_digest_not_provider_verified');
assert.equal(result.engineeringUsePermitted, false);
assert.deepEqual(result.source, input.source);
assert.deepEqual(result.materialProvenance, input.material.provenance);
assert.match(result.snCurveDigest, /^sha256:[a-f0-9]{64}$/);
assert.deepEqual(evaluateFatigueReference(input), result);
assert.equal(evaluateFatigueReference(sealFatigueReferenceInput({
  ...draft, history: { ...draft.history, repeatedCycles: 400_000 },
})).predictedFailureWithinHistory, true);
assert.equal(evaluateFatigueReference(sealFatigueReferenceInput({
  ...draft, history: { ...draft.history, repeatedCycles: 400_000 },
})).remainingCycles, 0);
assert.equal(evaluateFatigueReference(sealFatigueReferenceInput({
  ...draft, history: { ...draft.history, samples: [
    { timeS: 0, stressMPa: -300 }, { timeS: 1, stressMPa: 300 },
    { timeS: 2, stressMPa: -300 },
  ] },
})).predictedLifeCycles, 100_000);
const tampered = structuredClone(input);
tampered.history.repeatedCycles = 200_000;
assert.throws(() => validateFatigueReferenceInput(tampered), /SIM9_FATIGUE_REFERENCE_INVALID/);

function rejected(change: (value: FatigueReferenceDraft) => void) {
  const altered = structuredClone(draft);
  change(altered);
  assert.throws(() => validateFatigueReferenceInput(sealFatigueReferenceInput(altered)),
    /SIM9_FATIGUE_REFERENCE_INVALID/);
}
rejected(value => { value.history.quantity = 'load_force' as never; });
rejected(value => { value.history.quantity = 'axial_strain' as never; });
rejected(value => { value.history.samples[1].stressMPa = amplitude * 1.1; });
rejected(value => { value.history.samples[2].stressMPa = 0; });
rejected(value => { value.history.samples[1].timeS = 1.5; });
rejected(value => { value.history.samples.push({ timeS: 3, stressMPa: amplitude }); });
rejected(value => { value.history.repeatedCycles = 1_000_000_001; });
rejected(value => { value.material.stressRatio = 0 as -1; });
rejected(value => { value.material.model = 'strain_life' as never; });
rejected(value => { value.material.snPoints[1].stressAmplitudeMPa = 500; });
rejected(value => { value.material.snPoints[1].cyclesToFailure = 9000; });
rejected(value => { value.material.snPoints = value.material.snPoints.slice(0, 1); });
rejected(value => { value.material.provenance.revision = ''; });
rejected(value => { value.units.stress = 'Pa' as 'MPa'; });
rejected(value => { value.source.axisAnalysis = [2, 0, 0]; });
rejected(value => { value.source.elementId = 0; });
rejected(value => { value.source.fieldDatasetDigest = 'sha256:bad'; });
rejected(value => { value.history.samples = [
  { timeS: 0, stressMPa: -450 }, { timeS: 1, stressMPa: 450 },
  { timeS: 2, stressMPa: -450 },
]; });
rejected(value => { value.history.samples = [
  { timeS: 0, stressMPa: -150 }, { timeS: 1, stressMPa: 150 },
  { timeS: 2, stressMPa: -150 },
]; });
rejected(value => { (value.history as unknown as Record<string, unknown>).rainflow = true; });
rejected(value => { (value.material as unknown as Record<string, unknown>).meanStressCorrection = 'Goodman'; });
rejected(value => { (value.source as unknown as Record<string, unknown>).locations = [{ elementId: 43 }]; });
const solver = new CalculiXMultiDomainSolverProvider({
  executable: 'C:\\fixture\\ccx216.exe', runtimeVersion: '2.16',
});
assert.equal(solver.capabilities.analysisTypes.includes('fatigue' as never), false);
console.log(JSON.stringify({ status: 'PASS', fixture: 'SIM-9 fully reversed constant-amplitude uniaxial stress-life reference',
  amplitudeMPa: amplitude, expectedLifeCycles: expectedLife, analyticalLifeCycles: result.predictedLifeCycles,
  damageFraction: result.damageFraction, rejectedCases: 22,
  providerAdmission: 'closed', engineeringUsePermitted: false }, null, 2));
