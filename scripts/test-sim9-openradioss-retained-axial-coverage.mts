// No solver: authenticate and recover the existing 50 us run, leaving all old evidence intact.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseBoundedOpenRadiossTFile4 } from '../simulation-bridge/openRadiossBinaryTFileParser.mts';
import { readOpenRadiossCycleTrace } from '../simulation-bridge/openRadiossHistoryCoverage.mts';
import { evaluateAxialWaveHistory, AXIAL_ORACLE_DIGEST } from '../simulation-bridge/openRadiossAxialBarOracle.mts';
const directory = process.env.TUNACAD_OPENRADIOSS_VALIDATION_DIR;
assert.ok(directory, 'Retained authenticated validation directory required');
const hash = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const bytes = await readFile(join(directory, 'ExplicitBarProbeT01'));
const trace = await readFile(join(directory, 'engine.stdout.txt'), 'utf8');
const listing = await readFile(join(directory, 'ExplicitBarProbe_0001.out'), 'utf8');
const receipt = JSON.parse(await readFile(join(directory, 'pre-dispatch-receipt.json'), 'utf8'));
const output = JSON.parse(await readFile(join(directory, 'authenticated-output-receipt.json'), 'utf8'));
const engineExit = JSON.parse(await readFile(join(directory, 'engine-exit.json'), 'utf8'));
const starterExit = JSON.parse(await readFile(join(directory, 'starter-exit.json'), 'utf8'));
assert.equal(hash(bytes), '9820d44c10179aa4bb838500abc86c856a2e275c0bd134bd8d1d255d0b8a2c46');
assert.equal(hash(trace), '69ccd1325d08a004434dcd208bab02607d1b46ac4ea83638f82e561d9d1aa5ca');
assert.equal(hash(listing), output.engineListingDigest);
assert.equal(output.digest, hash(bytes));
assert.equal(engineExit.exitCode, 0); assert.equal(engineExit.error, null);
assert.equal(starterExit.exitCode, 0); assert.equal(starterExit.error, null);
assert.equal(receipt.oracleDigest, AXIAL_ORACLE_DIGEST);
assert.equal(hash(await readFile(receipt.enginePath)), receipt.engineSha256);
assert.equal(hash(await readFile(receipt.starterPath)), receipt.starterSha256);
assert.equal(receipt.time.durationS, 50e-6); assert.equal(receipt.time.historyIntervalS, 1e-6);
const proof = { method: 'frozen-2026-cycle-trace' as const, cycleTrace: trace,
  historyIntervalS: receipt.time.historyIntervalS, engineExitCode: 0 as const,
  normalTermination: true as const, completedCycles: output.completedCycles };
const cycles = readOpenRadiossCycleTrace(trace, output.completedCycles);
// Cross-check the full stdout trace against the separately authenticated listing.
// Listing uses E10.4 (0.xxxx mantissa); its coarser rounded values are NOT used
// to guess threshold eligibility. All identities and precision cells must agree.
const listingRows = [...listing.matchAll(/^\s*(\d+)\s+([\d.E+-]+)\s+([\d.E+-]+)\s+NODE\s+\d+/gm)];
assert.equal(listingRows.length, cycles.length);
const listingCell = (value: string) => {
  const m = value.match(/^(\d+\.\d+)(?:E([+-]\d+))?$/)!;
  assert.ok(m);
  const v = Number(value); if (v === 0) return [0, 0];
  const decimals = m[1].split('.')[1].length;
  const half = 0.5 * 10 ** (Number(m[2] ?? 0) - decimals);
  return [v - half, v + half];
};
listingRows.forEach((row, i) => {
  assert.equal(Number(row[1]), cycles[i].cycle);
  for (const [token, bounds] of [[row[2], cycles[i].timeBoundsS], [row[3], cycles[i].stepBoundsS]] as const) {
    const c = listingCell(token);
    assert.ok(c[0] <= bounds[1] && c[1] >= bounds[0], 'stdout/listing cycle disagreement');
  }
});
const history = parseBoundedOpenRadiossTFile4(bytes, 50e-6, proof);
const evaluation = evaluateAxialWaveHistory(history, receipt.faces.forceByNode);
assert.equal(history.coverage?.complete, true); assert.equal(history.frames.length, 50); // Authentic fixture assertion, NOT admission rule.
assert.equal(evaluation.pass, true);
const previous = JSON.parse(await readFile(join(directory, 'diagnostic-analytical-report.json'), 'utf8'));
assert.deepEqual(evaluation.gates, previous.evaluation.gates, 'Frozen physics measurements changed');
assert.equal(evaluation.oracleDigest, previous.evaluation.oracleDigest);
// Negative checks touch memory only, never the retained T01 or traces.
assert.throws(() => parseBoundedOpenRadiossTFile4(bytes.subarray(0, -1), 50e-6, proof), /truncated/);
assert.throws(() => parseBoundedOpenRadiossTFile4(bytes.subarray(0, -276), 50e-6, proof), /missing/);
assert.throws(() => parseBoundedOpenRadiossTFile4(bytes, 50e-6,
  { ...proof, cycleTrace: trace.replace(/^\s*NC=\s*40[^\r\n]*\r?\n/m, '') }), /incomplete/);
assert.throws(() => parseBoundedOpenRadiossTFile4(bytes, 50e-6, { ...proof, cycleTrace: '' }), /termination/);
const maxAbs = (v: number[]) => Math.max(...v.map(Math.abs));
const mass = history.frames.map(f => f.global.massMg);
const fixed = history.frames.flatMap(f => receipt.faces.fixed.nodeIds.map((id: number) => f.nodes.get(id)!));
const report = { pass: evaluation.pass, evidence: 'retained real analytical run; source-backed variable-step coverage',
  t01Sha256: hash(bytes), cycleTraceSha256: hash(trace), byteCount: bytes.length, thicode: history.thicode,
  frameCount: history.frames.length, firstTimeS: history.frames[0].timeS,
  firstPositiveTimeS: history.frames[1].timeS, lastTimeS: history.frames.at(-1)!.timeS,
  cycleCount: cycles.length, cycleTimeRangeS: [cycles[0].timeS, cycles.at(-1)!.timeS],
  cycleTimeRangeLastBoundsS: cycles.at(-1)!.timeBoundsS,
  distinctAuthenticTimestepsS: [...new Set(history.frames.map(f => f.global.timestepS))],
  coverage: history.coverage, evaluation, measured: { ...previous.measured,
    fixedMaxima: { dxMm: maxAbs(fixed.map(n => n.dxMm)), vxMmPerS: maxAbs(fixed.map(n => n.vxMmPerS)), axMmPerS2: maxAbs(fixed.map(n => n.axMmPerS2)) },
    massRangeMg: [Math.min(...mass), Math.max(...mass)], massVariationMg: Math.max(...mass) - Math.min(...mass) },
  frames: history.frames.map(f => ({ timeS: f.timeS, global: f.global,
    nodes: [...f.nodes].map(([id, value]) => ({ id, ...value })) })),
  engineeringUsePermitted: false, providerAdmission: 'closed' };
assert.equal(hash(await readFile(join(directory, 'ExplicitBarProbeT01'))), report.t01Sha256);
assert.equal(hash(await readFile(join(directory, 'engine.stdout.txt'), 'utf8')), report.cycleTraceSha256);
await writeFile(join(directory, 'source-backed-analytical-validation-report.json'), JSON.stringify(report, null, 2) + '\n');
assert.ok('expectedOutputs' in history.coverage!);
const table = ['# Retained 50 us history scheduler replay', '',
  '| Threshold (us) | Cycle | Printed cycle time (us) | Authentic frame | Authentic frame time (us) | Match |',
  '| --- | --- | --- | --- | --- | --- |',
  ...history.coverage!.expectedOutputs.map(row => `| ${(row.requestedThresholdS * 1e6).toFixed(6)} | ${row.cycle} | ${(row.printedCycleTimeS * 1e6).toFixed(6)} | ${row.frame} | ${(row.authenticFrameTimeS * 1e6).toFixed(9)} | ${row.match} |`),
  '', 'Times in text are rounded; eligibility uses their source-defined decimal cells and binary IEEE32 cells.',
  `No eligible 50 us output cycle: next evaluated opportunity is beyond stop, bounds ${history.coverage!.nextOutputTimeBoundsS.map(t => t * 1e6).join(' to ')} us.`,
  'No forced final T-file sample. No solver or converter ran during recovery.', ''].join('\n');
await writeFile(join(directory, 'threshold-to-cycle-replay.md'), table);
console.log(JSON.stringify({ ...report, frames: undefined, evaluation: { ...evaluation, series: undefined } }));
