// No solver. Read-only loading of the authenticated coarse result; controlled
// medium/fine summaries exercise calculations, NOT provider validation evidence.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { AXIAL_ORACLE_DIGEST, AXIAL_VALIDATION_PLAN as oracle,
  axialWaveReference, selectAxialWaveEvents } from '../simulation-bridge/openRadiossAxialBarOracle.mts';
import { parseBoundedOpenRadiossTFile4 } from './referenceTFileReader.mts';
import { TIMESTEP_SENSITIVITY_PLAN as plan, TIMESTEP_SENSITIVITY_DIGEST,
  estimateTimeStepLevels, normalizedTimeStepDifference, summarizeTimeStepHistory,
  compareTimeStepSensitivity } from '../simulation-bridge/openRadiossTimeStepSensitivity.mts';

const directory = process.env.TUNACAD_OPENRADIOSS_VALIDATION_DIR;
assert.ok(directory, 'Retained authenticated coarse validation directory required; no solver fallback');
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const json = async (file: string) => JSON.parse(await readFile(join(directory, file), 'utf8'));
const receipt = await json('pre-dispatch-receipt.json');
const admission = await json('engine-admission.json');
const prior = await json('source-backed-analytical-validation-report.json');
const output = await json('authenticated-output-receipt.json');
const starterExit = await json('starter-exit.json'), engineExit = await json('engine-exit.json');
const bytes = await readFile(join(directory, 'ExplicitBarProbeT01'));
const trace = await readFile(join(directory, 'engine.stdout.txt'), 'utf8');
const starter = await readFile(join(directory, 'ExplicitBarProbe_0000.rad'), 'utf8');
const engine = await readFile(join(directory, 'ExplicitBarProbe_0001.rad'), 'utf8');
const listing = await readFile(join(directory, 'ExplicitBarProbe_0001.out'));
assert.equal(hash(bytes), '9820d44c10179aa4bb838500abc86c856a2e275c0bd134bd8d1d255d0b8a2c46');
assert.equal(hash(trace), '69ccd1325d08a004434dcd208bab02607d1b46ac4ea83638f82e561d9d1aa5ca');
assert.equal(hash(listing), output.engineListingDigest);
assert.equal(hash(bytes), output.digest);
assert.equal(hash(starter), receipt.starterSha256); assert.equal(hash(engine), receipt.engineSha256);
assert.equal(hash(await readFile(receipt.sourceFrd)), receipt.sourceSha256);
assert.equal(starterExit.exitCode, 0); assert.equal(engineExit.exitCode, 0);
assert.equal(starterExit.error, null); assert.equal(engineExit.error, null);
assert.equal(admission.pass, true);
assert.equal(hash(await readFile(join(directory, 'ExplicitBarProbe_0000.out'))), admission.starterListingDigest);
assert.equal(admission.engineDeckDigest, hash(engine));
assert.equal(receipt.oracleDigest, AXIAL_ORACLE_DIGEST);
assert.equal(AXIAL_ORACLE_DIGEST, 'sha256:3925b93dc1a9ae733e4cbb59ba8216b9bd76f92b41f689c8c6855d12bea33121');
assert.equal(receipt.time.durationS, plan.durationS);
assert.equal(receipt.time.historyIntervalS, plan.historyIntervalS);
assert.deepEqual([receipt.mesh.nodes, receipt.mesh.elements], [88, 208]);
assert.deepEqual(receipt.material, { E_MPa: 200000, nu: 0.3, density_Mg_mm3: 7.8e-9 });
assert.match(engine, /\/DT\/NODA\n\s*9\.000000000000e-1\s+0\.000000000000e\+0/);
assert.equal(plan.minimumTimestepS, 0); assert.equal(plan.maximumIncrements, 20000);
assert.equal(plan.providerAdmission, 'closed');
const levels = estimateTimeStepLevels(admission.criticalNodalEstimateS);
assert.deepEqual(levels.map(l => l.approximateCycles), [105, 157, 235]);
assert.deepEqual(levels.map(l => l.scale), [0.9, 0.6, 0.4]);
assert.equal(levels[0].approximateStepS, admission.selectedEstimatedStepS);
assert.throws(() => estimateTimeStepLevels(1e-12), /resource/);
assert.equal(estimateTimeStepLevels(plan.durationS / (19999.5 * 0.4))[2].approximateCycles, 20000);
assert.throws(() => estimateTimeStepLevels(plan.durationS / (20000.5 * 0.4)), /resource/);
assert.throws(() => estimateTimeStepLevels(1e-4), /resource/);
for (const invalid of [0, -1, NaN, Infinity]) assert.throws(() => estimateTimeStepLevels(invalid), /estimate/);
assert.deepEqual(normalizedTimeStepDifference(0, 0, 0.15), { absoluteChange: 0, normalizedChange: 0 });
assert.equal(normalizedTimeStepDifference(-200, -210, 200).absoluteChange, 10);
assert.equal(normalizedTimeStepDifference(-200, -210, 200).normalizedChange, 10 / 210);
assert.equal(normalizedTimeStepDifference(0, 0.03, 0.15).normalizedChange, 0.2);
assert.equal(normalizedTimeStepDifference(0.03, 0, 0.15).normalizedChange, 0.2);
for (const invalid of [0, -1, NaN, Infinity]) assert.throws(() => normalizedTimeStepDifference(1, 2, invalid), /invalid/);
assert.throws(() => normalizedTimeStepDifference(NaN, 0, 1), /invalid/);
const history = parseBoundedOpenRadiossTFile4(bytes, plan.durationS, {
  method: 'frozen-2026-cycle-trace', cycleTrace: trace, historyIntervalS: plan.historyIntervalS,
  completedCycles: output.completedCycles, engineExitCode: 0, normalTermination: true,
});
const binding = { starterDeckSha256: hash(starter), retainedMeshSha256: receipt.sourceSha256,
  starterRuntimeSha256: receipt.binarySha256.starter, engineRuntimeSha256: receipt.binarySha256.engine,
  dtNodaScale: 0.9, minimumTimestepS: 0 as const, starterExitCode: 0 as const, engineExitCode: 0 as const };
const coarse = summarizeTimeStepHistory('coarse', history, receipt.faces.forceByNode, output.completedCycles, binding);
assert.equal(coarse.oraclePass, true); assert.deepEqual(coarse.gates, prior.evaluation.gates);
assert.deepEqual(coarse.distinctTimestepsS, prior.distinctAuthenticTimestepsS);
assert.equal(coarse.completedCycles, 105);
assert.equal(compareTimeStepSensitivity([coarse]).conclusion, 'pending');
assert.throws(() => summarizeTimeStepHistory('medium', history, receipt.faces.forceByNode, 105, binding), /binding/);
assert.throws(() => summarizeTimeStepHistory('coarse', history, receipt.faces.forceByNode, 20001, binding), /cycle/);
assert.throws(() => summarizeTimeStepHistory('coarse', history, receipt.faces.forceByNode, 105,
  { ...binding, minimumTimestepS: 1 as never }), /binding/);
assert.throws(() => summarizeTimeStepHistory('coarse', history, receipt.faces.forceByNode, 105,
  { ...binding, engineExitCode: 1 as never }), /binding/);
// Controlled summaries only: actual medium/fine results remain PENDING.
const medium = { ...coarse, level: 'medium' as const }, fine = { ...coarse, level: 'fine' as const };
const comparison = compareTimeStepSensitivity([coarse, medium, fine]);
assert.equal(comparison.conclusion, 'stable');
assert.equal(comparison.comparisons[3].absoluteLimit, 15);
assert.equal(comparison.comparisons[4].absoluteLimit, 0.0375);
assert.equal(compareTimeStepSensitivity([coarse, medium, { ...fine, plateauMedianN: medium.plateauMedianN + 15 }]).conclusion, 'stable');
assert.equal(compareTimeStepSensitivity([coarse, medium, { ...fine, plateauMedianN: medium.plateauMedianN + 15.001 }]).conclusion, 'sensitive');
assert.equal(compareTimeStepSensitivity([coarse, medium, { ...fine, maximumEnergyResidual: medium.maximumEnergyResidual + 0.04 }]).conclusion, 'sensitive');
for (const [index, field] of [[0, 'arrivalTimeS'], [1, 'transitDisplacementMm'], [2, 'returnDisplacementMm']] as const) {
  const bound = comparison.comparisons[index].absoluteLimit;
  assert.equal(compareTimeStepSensitivity([coarse, medium,
    { ...fine, [field]: medium[field]! + bound * 1.01 }]).conclusion, 'sensitive');
}
// Nonmonotonic analytical errors do not themselves fail timestep sensitivity.
assert.equal(compareTimeStepSensitivity([coarse,
  { ...medium, arrivalErrorS: 0.8e-6 }, { ...fine, arrivalErrorS: 0.9e-6 }]).conclusion, 'stable');
assert.equal(compareTimeStepSensitivity([coarse, medium, { ...fine, oraclePass: false }]).conclusion, 'failed');
assert.equal(compareTimeStepSensitivity([coarse, medium, { ...fine, coveragePass: false }]).conclusion, 'failed');
assert.equal(compareTimeStepSensitivity([coarse, medium, { ...fine,
  gates: { ...fine.gates, noAddedMass: { pass: false } } }]).conclusion, 'failed');
assert.throws(() => compareTimeStepSensitivity([coarse, coarse]), /duplicate/);
assert.throws(() => compareTimeStepSensitivity([coarse, { ...medium, studyBindingDigest: 'changed mesh' }, fine]), /mismatched/);
assert.throws(() => compareTimeStepSensitivity([coarse, { ...medium, oracleDigest: 'changed oracle' }]), /mismatched/);
// Earlier time wins ties, unchanged. Finer output still uses actual eligible cycles.
const ref = axialWaveReference();
const halfSpacing = 2 ** -21; // Binary-exact equal distances; decimal half-us is not an exact tie.
const shift = ref.transitS % plan.historyIntervalS - halfSpacing;
const eventTimes = [0, ...Array.from({ length: 50 }, (_, i) =>
  i === 19 ? ref.transitS - halfSpacing : i === 20 ? ref.transitS + halfSpacing
    : i * plan.historyIntervalS + shift)];
const selected = selectAxialWaveEvents(eventTimes, levels[2].approximateStepS);
assert.ok(eventTimes[selected.nearTransit] < ref.transitS);
assert.equal(plan.interpolation, oracle.interpolation);
// No writes, launches or receipt upgrades; retained evidence remains byte-identical.
assert.equal(hash(await readFile(join(directory, 'ExplicitBarProbeT01'))), hash(bytes));
console.log(JSON.stringify({ pass: true, evidence: 'no-solver plan; retained coarse loading plus controlled metric tests',
  planDigest: TIMESTEP_SENSITIVITY_DIGEST, plan, levels, coarse,
  actualStudyConclusion: compareTimeStepSensitivity([coarse]).conclusion,
  controlledComparisonBounds: comparison.comparisons.map(c => ({ quantity: c.quantity, limit: c.absoluteLimit })) }));
