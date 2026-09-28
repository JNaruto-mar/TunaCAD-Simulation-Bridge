import assert from 'node:assert/strict';
import { CalculiXMultiDomainSolverProvider } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { HARMONIC_MODE_POLICY, selectHarmonicModeCount,
  validateHarmonicModalCoverage } from '../simulation-bridge/harmonicModePolicy.mts';
import { admitV2SimulationRequest } from '../simulation-bridge/v2Validation.mts';
import { makeRequest } from './test-sim9-harmonic-contract.mts';

const provider = new CalculiXMultiDomainSolverProvider({
  executable: 'C:\\fixture\\ccx216.exe', runtimeVersion: '2.16',
});
assert.equal(selectHarmonicModeCount(7000, 468, 209), 96);
assert.equal(selectHarmonicModeCount(20_000, 468, 209), 192);
assert.equal(selectHarmonicModeCount(8000, 999, 434), 96);
assert.equal(selectHarmonicModeCount(8000.001, 999, 434), 192);
assert.equal(selectHarmonicModeCount(7000, 468, 209), selectHarmonicModeCount(7000, 468, 209));
for (const frequencyHz of [0, 999.999, 22_000.001, 1e6, NaN, Infinity]) {
  assert.throws(() => selectHarmonicModeCount(frequencyHz), /SIMULATION_HARMONIC_FREQUENCY_UNSUPPORTED/);
}
for (const [nodes, elements] of [[2001, 434], [999, 1001], [60, 200]]) {
  assert.throws(() => selectHarmonicModeCount(20_000, nodes, elements), /SIMULATION_HARMONIC_RESOURCE_LIMIT/);
}
assert.equal(admitV2SimulationRequest(makeRequest(7000), provider.capabilities).accepted, true);
assert.equal(admitV2SimulationRequest(makeRequest(20_000), provider.capabilities).accepted, true);
assert.equal(admitV2SimulationRequest(makeRequest(500), provider.capabilities).accepted, false);
assert.equal(admitV2SimulationRequest(makeRequest(30_000), provider.capabilities).accepted, false);
const overstated = structuredClone(provider.capabilities);
overstated.study.harmonic!.maximumFrequencyHz = 1_000_000;
assert.equal(admitV2SimulationRequest(makeRequest(20_000), overstated).accepted, false);
const insufficient = structuredClone(provider.capabilities);
insufficient.study.harmonic!.maximumModes = 96;
assert.equal(admitV2SimulationRequest(makeRequest(20_000), insufficient).accepted, false);
assert.equal(provider.capabilities.study.harmonic!.maximumModes, 192);
assert.equal(provider.capabilities.study.harmonic!.maximumNodes, 2_000);
assert.equal(provider.capabilities.study.harmonic!.maximumElements, 1_000);
assert.equal(provider.capabilities.execution.resourceLimits!.cpuTimeLimitMs, 120_000);
assert.equal(provider.capabilities.execution.resourceLimits!.memoryLimitBytes, 1024 ** 3);

const frequencies = [1000, 5000, 12_000, 25_000, 45_000];
const covered = validateHarmonicModalCoverage(20_000, frequencies, 5);
assert.equal(covered.modesBelowExcitation, 3);
assert.equal(covered.modesAboveExcitation, 2);
assert.equal(covered.upperFrequencyRatio, 2.25);
assert.throws(() => validateHarmonicModalCoverage(20_000, frequencies, 6), /COVERAGE_INVALID/);
assert.throws(() => validateHarmonicModalCoverage(20_000, [1000, 5000, 12_000, 20_000, 39_000], 5),
  /COVERAGE_INADEQUATE/);
assert.throws(() => validateHarmonicModalCoverage(20_000, [21_000, 25_000, 30_000, 40_000, 45_000], 5),
  /COVERAGE_INADEQUATE/);
assert.throws(() => validateHarmonicModalCoverage(20_000, [1000, 5000, 12_000, 19_950, 45_000], 5),
  /COVERAGE_INADEQUATE/);
assert.throws(() => validateHarmonicModalCoverage(20_000, [1000, 12_000, 5000, 30_000, 45_000], 5),
  /COVERAGE_INVALID/);
console.log(JSON.stringify({ status: 'PASS', fixture: 'SIM-9 bounded harmonic mode policy',
  policy: HARMONIC_MODE_POLICY, selected: { hz7000: 96, hz20000: 192 },
  admissionAndCoverageFailClosed: true, engineeringUsePermitted: false }, null, 2));
