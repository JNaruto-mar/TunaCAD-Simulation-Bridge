import assert from 'node:assert/strict';
import { validateOpenRadiossExplicitCadence, readOpenRadiossCycleTrace } from '../simulation-bridge/openRadiossHistoryCoverage.mts';
const token = (n: number) => n.toExponential(4).replace(/e([+-])(\d)$/, 'E$10$2');
function trace(times: number[], steps: number[]) {
  return times.map((t, i) => ` NC= ${i} T= ${token(t)} DT= ${token(steps[i])} ERR= 0.0% DM/M= 0.0000E+00`).join('\n')
    + `\nNORMAL TERMINATION\nTOTAL NUMBER OF CYCLES : ${times.length}\n`;
}
const proof = (text: string, count: number) => ({ method: 'frozen-2026-cycle-trace' as const,
  cycleTrace: text, historyIntervalS: 1e-6, engineExitCode: 0 as const,
  normalTermination: true as const, completedCycles: count });
function check(times: number[], steps: number[], sampled: number[], stop: number) {
  const text = trace(times, steps);
  const p = proof(text, times.length);
  const output = validateOpenRadiossExplicitCadence(sampled.map(i => Math.fround(times[i])),
    sampled.map(i => Math.fround(steps[i])), stop, p);
  assert.deepEqual(output.sampledCycles, sampled);
  assert.equal(output.complete, true);
  return { output, p };
}
// Constant DT and threshold crossing between cycles; final threshold beyond stop.
const constantTimes = Array.from({ length: 9 }, (_, i) => i * 0.48e-6);
const constantSteps = constantTimes.map(() => 0.48e-6);
const constant = check(constantTimes, constantSteps, [0, 3, 5, 7], 4.1e-6);
assert.equal(constant.output.nextDueTimeS, 4e-6);
assert.ok(constant.output.nextOutputTimeBoundsS[0] > 4.1e-6);
// Small distinct DT variations are preserved, not rounded into a constant.
const smallSteps = Array.from({ length: 9 }, (_, i) => 0.47915e-6 - i * 1e-14);
const smallTimes = [0];
for (let i = 1; i < smallSteps.length; i++) smallTimes.push(smallTimes[i - 1] + smallSteps[i - 1]);
check(smallTimes, smallSteps, [0, 3, 5, 7], 4.1e-6);
// DT changes immediately before a threshold.
check([0, 0.4e-6, 0.8e-6, 1.2e-6, 1.85e-6, 2.5e-6, 3.15e-6],
  [0.4e-6, 0.4e-6, 0.4e-6, 0.65e-6, 0.65e-6, 0.65e-6, 0.65e-6], [0, 3, 5, 6], 3.5e-6);
// A large integration step crosses multiple thresholds: one output per cycle,
// MAX selects TT, not a burst/catch-up series. Source applies at each call.
check([0, 0.4e-6, 2.9e-6, 5.4e-6], [0.4e-6, 2.5e-6, 2.5e-6, 2.5e-6], [0, 2, 3], 6e-6);
const sampled = [0, 3, 5, 7];
const fTimes = sampled.map(i => Math.fround(constantTimes[i]));
const fSteps = sampled.map(i => Math.fround(constantSteps[i]));
assert.throws(() => validateOpenRadiossExplicitCadence(fTimes.slice(0, -1), fSteps.slice(0, -1), 4.1e-6, constant.p), /missing/);
assert.throws(() => validateOpenRadiossExplicitCadence([fTimes[0], fTimes[1], fTimes[1], fTimes[2]], fSteps, 4.1e-6, constant.p), /cadence/);
assert.throws(() => validateOpenRadiossExplicitCadence([...fTimes, Math.fround(3.9e-6)], [...fSteps, fSteps[0]], 4.1e-6, constant.p), /extra/);
assert.throws(() => validateOpenRadiossExplicitCadence(fTimes.map((t, i) => i === 2 ? Math.fround(t + 0.1e-6) : t), fSteps, 4.1e-6, constant.p), /disagrees/);
assert.throws(() => readOpenRadiossCycleTrace(trace([0, 0.5e-6, 0.4e-6], [0.5e-6, 0.5e-6, 0.5e-6]), 3), /non-monotonic/);
assert.throws(() => readOpenRadiossCycleTrace(constant.p.cycleTrace.replace(/ NC= 4[^\n]*\n/, ''), 9), /incomplete/);
assert.throws(() => readOpenRadiossCycleTrace(constant.p.cycleTrace.replace('NC= 4', 'NC= 3'), 9), /identity/);
assert.throws(() => validateOpenRadiossExplicitCadence(fTimes, fSteps, 4.1e-6, { ...constant.p, cycleTrace: '' }), /termination/);
// Decimal print uncertainty at exact threshold must not become an invented tolerance.
assert.throws(() => check([0, 0.5e-6, 1e-6, 1.5e-6], [0.5e-6, 0.5e-6, 0.5e-6, 0.5e-6], [0, 2], 1.7e-6), /ambiguous/);
console.log(JSON.stringify({ pass: true, scope: 'actual-cycle scheduler replay; no solver', cases:
  ['constant', 'small variation', 'threshold crossing', 'pre-threshold DT change', 'large step once per cycle',
    'no final opportunity', 'missing/extra/duplicate frame', 'unordered/incomplete cycle trace', 'ambiguous print rejection'] }));
