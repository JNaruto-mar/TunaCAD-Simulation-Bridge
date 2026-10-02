// Frozen 2026 hist2.F: output at TT>=THIS, then THIS=min(stop,max(TT,THIS+interval)).
// resol.F evaluates SORTIE_MAIN before advancing TT; no forced final T01 sample.
// Legacy constant-step receipts remain explicit; variable runs require the full trace.
import { createHash } from 'node:crypto';
type CommonCompletion = Readonly<{
  historyIntervalS: number; engineExitCode: 0; normalTermination: true; completedCycles: number;
}>;
export type ExplicitCadenceCompletion = CommonCompletion & (Readonly<{
  method: 'frozen-2026-constant-step';
}> | Readonly<{ method: 'frozen-2026-cycle-trace'; cycleTrace: string }>);
function reject(why: string): never { throw new Error(`OpenRadioss coverage: ${why}`); }
function cell(value: number): [number, number] {
  if (!Number.isFinite(value) || value <= 0 || Math.fround(value) !== value) reject('invalid IEEE32 sample');
  const bytes = Buffer.alloc(4);
  bytes.writeFloatBE(value);
  const bits = bytes.readUInt32BE();
  bytes.writeUInt32BE(bits - 1);
  const before = bytes.readFloatBE();
  bytes.writeUInt32BE(bits + 1);
  const after = bytes.readFloatBE();
  return [(before + value) / 2, (value + after) / 2];
}
export function validateOpenRadiossExplicitCadence(
  times: readonly number[], steps: readonly number[], stopS: number,
  completion: ExplicitCadenceCompletion,
) {
  if (completion.method === 'frozen-2026-cycle-trace')
    return validateCycleTraceCadence(times, steps, stopS, completion);
  if (completion.method !== 'frozen-2026-constant-step' || completion.engineExitCode !== 0 ||
      completion.normalTermination !== true || !Number.isFinite(stopS) || stopS <= 0 ||
      !Number.isFinite(completion.historyIntervalS) || completion.historyIntervalS <= 0 ||
      !Number.isSafeInteger(completion.completedCycles) || completion.completedCycles < 2 ||
      completion.completedCycles > 20000 || times.length < 2 || times.length > 64 ||
      times.length !== steps.length || times[0] !== 0) reject('invalid completion/cadence evidence');
  const interval = completion.historyIntervalS;
  if (steps.some(step => step !== steps[0])) reject('variable timestep requires separate coverage evidence');
  let [lo, hi] = cell(steps[0]);
  if (hi >= interval) reject('step must remain below history interval for bounded recurrence');
  const lastCycleLo = Math.floor(stopS / hi);
  const lastCycleHi = Math.floor(stopS / lo);
  if (lastCycleLo !== lastCycleHi || completion.completedCycles !== lastCycleLo + 1)
    reject('stop-cycle count disagrees with IEEE32 timestep evidence');
  const lastCycle = lastCycleLo;
  let due = 0;
  const cycles: number[] = [];
  let nextCycle = 0;
  // Because step<interval, a crossing cycle cannot overtake THIS+interval.
  // Therefore the source MAX branch leaves due+interval as the next threshold.
  for (let n = 0; n <= 64; n++) {
    const cycleLo = Math.ceil(due / hi);
    const cycleHi = Math.ceil(due / lo);
    if (cycleLo !== cycleHi) reject('ambiguous due-cycle under IEEE32 rounding');
    nextCycle = cycleLo;
    if (nextCycle > lastCycle) break;
    if (cycles.length >= times.length) reject('missing scheduled history frame');
    const time = times[cycles.length];
    if (nextCycle === 0) {
      if (time !== 0) reject('missing initialization frame');
    } else {
      const [sampleLo, sampleHi] = cell(time);
      lo = Math.max(lo, sampleLo / nextCycle);
      hi = Math.min(hi, sampleHi / nextCycle);
      if (lo > hi) reject('frame time inconsistent with constant integration step');
    }
    cycles.push(nextCycle);
    const nextDue = Math.min(stopS, due + interval);
    if (nextDue <= due) reject('invalid history due recurrence');
    due = nextDue;
  }
  if (cycles.length !== times.length || nextCycle <= lastCycle) reject('extra or incomplete history frames');
  return Object.freeze({
    rule: completion.method, complete: true, sampledCycles: cycles,
    requestedStopS: stopS,
    lastEvaluatedCycle: lastCycle, nextDueTimeS: due, nextOutputCycle: nextCycle,
    nextOutputTimeBoundsS: [nextCycle * lo, nextCycle * hi] as const,
    nextOutputTimeS: nextCycle * ((lo + hi) / 2),
    forcedFinalSample: false, roundingPolicy: 'IEEE32 representable rounding cells; no arbitrary tolerance',
  });
}

// Frozen ecrit.F prints cycle time/DT using 1PE11.4, i.e. five significant
// decimal digits. Preserve the token and its rounding interval; not a tolerance.
function decimalCell(token: string): readonly [number, number] {
  const m = token.match(/^([+-]?\d\.\d{4})[Ee]([+-]\d{2,3})$/);
  if (!m) reject('unsupported cycle print precision');
  const value = Number(token);
  if (!Number.isFinite(value) || value < 0) reject('invalid cycle number value');
  if (value === 0) return [0, 0];
  const halfLastPrintedPlace = 0.5 * 10 ** (Number(m[2]) - 4);
  return [value - halfLastPrintedPlace, value + halfLastPrintedPlace];
}
export function readOpenRadiossCycleTrace(trace: string, completedCycles: number) {
  if (typeof trace !== 'string' || trace.length > 8 * 1024 * 1024 ||
      !Number.isSafeInteger(completedCycles) || completedCycles < 2 || completedCycles > 20000)
    reject('missing/invalid cycle evidence');
  const totals = [...trace.matchAll(/TOTAL NUMBER OF CYCLES\s*:\s*(\d+)/g)];
  if (!/NORMAL TERMINATION/.test(trace) || totals.length !== 1 || Number(totals[0][1]) !== completedCycles)
    reject('missing cycle termination evidence');
  const lines = trace.split(/\r?\n/).filter(line => /^\s*NC=/.test(line));
  if (lines.length !== completedCycles) reject('incomplete cycle trace');
  const rows = lines.map((line, index) => {
    const m = line.match(/^\s*NC=\s*(\d+)\s+T=\s*(\S+)\s+DT=\s*(\S+)\s+ERR=\s*[^%]+%\s+DM\/M=\s*(\S+)\s*$/);
    if (!m || Number(m[1]) !== index) reject('missing/duplicate/reordered cycle identity');
    const timeBoundsS = decimalCell(m[2]), stepBoundsS = decimalCell(m[3]);
    if (stepBoundsS[0] <= 0 || !Number.isFinite(Number(m[4])) || Number(m[4]) !== 0)
      reject('invalid cycle timestep or mass scaling');
    return { cycle: index, timeS: Number(m[2]), timeToken: m[2], timeBoundsS,
      timestepS: Number(m[3]), timestepToken: m[3], stepBoundsS };
  });
  if (rows[0].timeS !== 0 || rows.some((row, i) => i > 0 && row.timeBoundsS[0] <= rows[i - 1].timeBoundsS[1]))
    reject('non-monotonic/ambiguous cycle times');
  // Each real time comes from the previous real cycle plus its real DT, not
  // an averaged/constant-step approximation. Check the printed intervals agree.
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (b.timeBoundsS[1] < a.timeBoundsS[0] + a.stepBoundsS[0] ||
        b.timeBoundsS[0] > a.timeBoundsS[1] + a.stepBoundsS[1])
      reject('cycle time and timestep evidence disagree');
  }
  return rows;
}
function validateCycleTraceCadence(times: readonly number[], steps: readonly number[], stopS: number,
  completion: CommonCompletion & Readonly<{ method: 'frozen-2026-cycle-trace'; cycleTrace: string }>) {
  if (completion.engineExitCode !== 0 || completion.normalTermination !== true ||
      !Number.isFinite(stopS) || stopS <= 0 || !Number.isFinite(completion.historyIntervalS) ||
      completion.historyIntervalS <= 0 || times.length < 2 || times.length > 64 || times.length !== steps.length ||
      times[0] !== 0 || times.some((t, i) => !Number.isFinite(t) || t < 0 || (i > 0 && t <= times[i - 1])))
    reject('invalid completion/cadence evidence');
  const rows = readOpenRadiossCycleTrace(completion.cycleTrace, completion.completedCycles);
  const last = rows.at(-1)!;
  // Scope has no extra animation/H3D cycle. Normal termination follows the
  // last evaluated pre-stop cycle's advance. Boundary ambiguity is not guessed.
  if (last.timeBoundsS[1] > stopS || last.timeBoundsS[0] + last.stepBoundsS[0] <= stopS)
    reject('incomplete/ambiguous stop-cycle evidence');
  const table: { requestedThresholdS: number; thresholdBoundsS: readonly [number, number];
    cycle: number; printedCycleTimeS: number; cycleTimeBoundsS: readonly [number, number];
    frame: number; authenticFrameTimeS: number; match: 'PASS' }[] = [];
  let dueLo = 0, dueHi = 0;
  for (const row of rows) {
    if (row.timeBoundsS[1] < dueLo) continue;
    if (row.timeBoundsS[0] < dueHi) reject('ambiguous history threshold eligibility');
    const index = table.length;
    if (index >= times.length) reject('missing scheduled history frame');
    const timeCell = times[index] === 0 ? [0, 0] as const : cell(times[index]);
    const stepCell = cell(steps[index]);
    if (timeCell[1] < row.timeBoundsS[0] || timeCell[0] > row.timeBoundsS[1])
      reject('frame time disagrees with eligible cycle');
    if (stepCell[1] < row.stepBoundsS[0] || stepCell[0] > row.stepBoundsS[1])
      reject('frame timestep disagrees with cycle evidence');
    table.push({ requestedThresholdS: (dueLo + dueHi) / 2, thresholdBoundsS: [dueLo, dueHi],
      cycle: row.cycle, printedCycleTimeS: row.timeS, cycleTimeBoundsS: row.timeBoundsS,
      frame: index, authenticFrameTimeS: times[index], match: 'PASS' });
    // One output per eligible cycle, even when a large step crosses several
    // thresholds. Match explicit hist2.F MAX/MIN exactly; never catch-up loop.
    const nextLo = Math.min(stopS, Math.max(row.timeBoundsS[0], dueLo + completion.historyIntervalS));
    const nextHi = Math.min(stopS, Math.max(row.timeBoundsS[1], dueHi + completion.historyIntervalS));
    dueLo = nextLo; dueHi = nextHi;
  }
  if (table.length !== times.length) reject('extra/reordered history frame');
  // MAX can leave the next threshold at the last output's TT after a large
  // step. HIST2 is called once per cycle: no second output at that same TT.
  // All evaluated cycles were replayed; the next cycle is beyond stop.
  return Object.freeze({ rule: completion.method, complete: true, requestedStopS: stopS, sampledCycles: table.map(row => row.cycle),
    lastEvaluatedCycle: last.cycle, nextDueTimeS: (dueLo + dueHi) / 2,
    nextDueBoundsS: [dueLo, dueHi] as const, nextOutputCycle: last.cycle + 1,
    nextOutputTimeBoundsS: [last.timeBoundsS[0] + last.stepBoundsS[0], last.timeBoundsS[1] + last.stepBoundsS[1]] as const,
    nextOutputTimeS: last.timeS + last.timestepS,
    nextCycleIsAfterStop: true, forcedFinalSample: false,
    roundingPolicy: 'frozen E11.4 decimal print cells and IEEE32 binary cells; no empirical tolerance',
    cycleTraceSha256: createHash('sha256').update(completion.cycleTrace).digest('hex'), expectedOutputs: table });
}
