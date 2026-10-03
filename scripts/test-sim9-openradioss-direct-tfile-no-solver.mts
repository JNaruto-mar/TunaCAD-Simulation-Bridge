import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBoundedOpenRadiossTFile4 } from '../simulation-bridge/openRadiossBinaryTFileParser.mts';
import { validateOpenRadiossExplicitCadence } from '../simulation-bridge/openRadiossHistoryCoverage.mts';

// These records mirror frozen hist1.F and published th_to_csv.c, not a
// converter-produced CSV. IEEE32 values/ints and record markers are big endian.
const record = (body: Buffer) => {
  const marker = Buffer.alloc(4);
  marker.writeInt32BE(body.length);
  return Buffer.concat([marker, body, marker]);
};
const ints = (...values: number[]) => {
  const out = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => out.writeInt32BE(v, i * 4));
  return out;
};
const floats = (...values: number[]) => {
  const out = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => out.writeFloatBE(v, i * 4));
  return out;
};
const title = (value: string, width = 100) => Buffer.from(value.padEnd(width), 'ascii');
const nodes = [1, 2, 3, 4, 5, 6, 7, 8, 45, 46];
const globals = (time: number) => {
  const g = Array(22).fill(0);
  g[0] = 0.1 * time; // IE, unchanged as energy
  g[1] = 0.2 * time; // KE, unchanged as energy
  g[5] = 7.8e-5; // Mg
  g[8] = 0.3 * time; // external work, unchanged as energy
  return g;
};
function fixture(options: {
  version?: number; nodeIds?: number[]; channels?: number[]; times?: number[];
  lastNodeCount?: number; nonfinite?: boolean; addedMass?: number; step?: number;
  addedMassByFrame?: number[]; massByFrame?: number[];
} = {}) {
  const times = options.times ?? [0, 1e-6, 2e-6, 3e-6];
  const version = options.version ?? 4021;
  const width = version === 3040 ? 40 : 100;
  const name = (value: string) => title(value, width);
  const rows = [
    record(Buffer.concat([ints(version), title('ExplicitBarProbe', 80)])),
    record(title('OpenRadioss 2026', 80)),
    ...(version === 3040 ? [] : [record(ints(2)), record(ints(100)), record(floats(1, 1, 1))]),
    record(ints(1, 2, 1, 1, 1, 22)),
    record(ints(...Array.from({ length: 22 }, (_, i) => i + 1))),
    record(Buffer.concat([ints(1), name('One elastic bar'), ints(0, 1, 1, 0)])),
    record(Buffer.concat([ints(1), name('Steel elastic')])),
    record(Buffer.concat([ints(0), name('no_title')])),
    record(Buffer.concat([ints(1), name('Linear tetra small strain')])),
    record(Buffer.concat([ints(0, 0, 0, 1, 1), name('global')])),
    record(ints(1)), // child part identity
    record(ints(1)), // one subset variable code
    record(Buffer.concat([ints(1, 0, 0, 10, 4), name('Bounded axial bar nodes')])),
    ...(options.nodeIds ?? nodes).map(id => record(Buffer.concat([ints(id), name(`node_${id}`)]))),
    record(ints(...(options.channels ?? [1, 4, 7, 620]))),
  ];
  times.forEach((time, frameIndex) => {
    const global = globals(time);
    global[16] = options.addedMassByFrame?.[frameIndex] ?? options.addedMass ?? 0;
    if (options.step !== undefined) global[6] = options.step;
    if (options.massByFrame) global[5] = options.massByFrame[frameIndex];
    rows.push(record(floats(time)), record(floats(...global)), record(floats(0)));
    const values = nodes.flatMap((id, index) =>
      [index * time, index + time, frameIndex + index,
        options.nonfinite && index === 2 && frameIndex === 1 ? NaN : (id <= 4 || id === 45 ? 100 * time : 0)]);
    rows.push(record(floats(...(frameIndex === times.length - 1 && options.lastNodeCount
      ? values.slice(0, options.lastNodeCount) : values))));
  });
  return Buffer.concat(rows);
}
const bytes = fixture();
const parsed = parseBoundedOpenRadiossTFile4(bytes, 3e-6);
assert.equal(parsed.frames.length, 4);
assert.equal(parsed.frames[1].global.rawOrderedValues.length, 22);
assert.equal(parsed.sha256.length, 64);
assert.deepEqual(parsed.nodeIds, nodes);
assert.deepEqual(parsed.channelCodes, [1, 4, 7, 620]);
for (const frame of parsed.frames) {
  assert.equal(frame.nodes.size, 10);
  for (const id of [1, 2, 3, 4, 45]) {
    const node = frame.nodes.get(id)!;
    assert.ok(Math.abs(node.reactionImpulseNs - 100 * frame.timeS) < 1e-11);
    assert.ok(Math.abs(node.reactionForceN - 100) < 1e-5); // float32 time/impulse roundoff
  }
  assert.equal(frame.global.addedMassMg, 0);
}
assert.equal(parsed.frames[0].global.kineticEnergyNmm, 0);
assert.equal(parsed.frames[0].global.externalWorkNmm, 0);
assert.match(parsed.reactionProvenance, /impulse/);
assert.throws(() => parseBoundedOpenRadiossTFile4(bytes.subarray(0, -2), 3e-6), /truncated/);
assert.throws(() => parseBoundedOpenRadiossTFile4(bytes.subarray(0, bytes.length - 168), 3e-6), /truncated|coverage|record/);
const legacy = parseBoundedOpenRadiossTFile4(fixture({ version: 3040 }), 3e-6);
assert.equal(legacy.thicode, 3040);
assert.deepEqual(legacy.frames, parsed.frames);
assert.equal(parsed.thicode, 4021);
assert.throws(() => parseBoundedOpenRadiossTFile4(fixture({ version: 3050 }), 3e-6), /version/);
assert.throws(() => parseBoundedOpenRadiossTFile4(fixture({ channels: [1, 4, 7, 7] }), 3e-6), /channel/);
assert.throws(() => parseBoundedOpenRadiossTFile4(fixture({ channels: [1, 4, 7] }), 3e-6), /integer record length/);
assert.throws(() => parseBoundedOpenRadiossTFile4(fixture({ nodeIds: [1, 2, 3, 4, 5, 6, 7, 8, 45, 45] }), 3e-6), /node/);
assert.throws(() => parseBoundedOpenRadiossTFile4(fixture({ nodeIds: [1, 2, 3, 4, 5, 6, 7, 8, 45, 99] }), 3e-6), /node/);
assert.throws(() => parseBoundedOpenRadiossTFile4(fixture({ nodeIds: [2, 1, 3, 4, 5, 6, 7, 8, 45, 46] }), 3e-6), /node/);
assert.throws(() => parseBoundedOpenRadiossTFile4(fixture({ nonfinite: true }), 3e-6), /non-finite/);
const infinity = Buffer.from(bytes);
const lastFrame = infinity.length - (8 + 160);
infinity.writeUInt32BE(0x7f800000, lastFrame + 4 + 8);
assert.throws(() => parseBoundedOpenRadiossTFile4(infinity, 3e-6), /non-finite/);
assert.throws(() => parseBoundedOpenRadiossTFile4(fixture({ times: [0, 1e-6, 1e-6, 3e-6] }), 3e-6), /time/);
assert.throws(() => parseBoundedOpenRadiossTFile4(fixture({ times: [0, 1e-6, 2e-6] }), 3e-6), /coverage/);
assert.throws(() => parseBoundedOpenRadiossTFile4(fixture({ lastNodeCount: 39 }), 3e-6), /real record length/);
assert.throws(() => parseBoundedOpenRadiossTFile4(fixture({ addedMass: 0.001 }), 3e-6), /mass scaling/);
const brokenBoundary = Buffer.from(bytes);
brokenBoundary.writeInt32BE(80, 88);
assert.throws(() => parseBoundedOpenRadiossTFile4(brokenBoundary, 3e-6), /boundary/);
for (const version of [3040, 4021]) {
  assert.throws(() => parseBoundedOpenRadiossTFile4(fixture({ version }).subarray(0, -2), 3e-6), /truncated/);
  assert.throws(() => parseBoundedOpenRadiossTFile4(fixture({ version, channels: [1, 4, 7, 7] }), 3e-6), /channel/);
  assert.throws(() => parseBoundedOpenRadiossTFile4(fixture({ version, nonfinite: true }), 3e-6), /non-finite/);
  assert.throws(() => parseBoundedOpenRadiossTFile4(fixture({ version,
    nodeIds: [1, 2, 3, 4, 5, 6, 7, 8, 45, 45] }), 3e-6), /node/);
}
const step = Math.fround(4.791501169165713e-7);
const cycles = [0, 3, 5, 7, 9, 11, 13, 15, 17, 19];
const cadenceTimes = cycles.map(c => Math.fround(c * step));
const completion = { method: 'frozen-2026-constant-step' as const, historyIntervalS: 1e-6,
  engineExitCode: 0 as const, normalTermination: true as const, completedCycles: 21 };
const coverage = validateOpenRadiossExplicitCadence(cadenceTimes, cycles.map(() => step), 1e-5, completion);
assert.deepEqual(coverage.sampledCycles, cycles);
assert.equal(coverage.nextOutputCycle, 21);
assert.ok(coverage.nextOutputTimeBoundsS[0] > 1e-5);
assert.equal(coverage.lastEvaluatedCycle, 20);
const cadenceOptions = { version: 3040, times: cadenceTimes, step };
const initialResidual = -5.421010862427522e-20;
const residualHistory = parseBoundedOpenRadiossTFile4(
  fixture({ ...cadenceOptions, addedMass: initialResidual }), 1e-5, completion);
assert.equal(residualHistory.frames[0].global.addedMassMg, initialResidual);
assert.ok(residualHistory.frames.every(f => f.global.addedMassChangeFromInitializationMg === 0));
const actualMeshCounts = { nodeCount: 88, elementCount: 209 };
assert.deepEqual(parseBoundedOpenRadiossTFile4(fixture({ ...cadenceOptions,
  addedMass: initialResidual }), 1e-5, completion, actualMeshCounts).frames, residualHistory.frames);
// Between gamma_296 and gamma_297: actual counts, not a guessed T01 layout.
const middleBound = -Math.fround(296.5 * 2 ** -53 * Math.fround(7.8e-5));
assert.throws(() => parseBoundedOpenRadiossTFile4(fixture({ ...cadenceOptions,
  addedMass: middleBound }), 1e-5, completion), /mass scaling/);
assert.doesNotThrow(() => parseBoundedOpenRadiossTFile4(fixture({ ...cadenceOptions,
  addedMass: middleBound }), 1e-5, completion, actualMeshCounts));
for (const counts of [{nodeCount:3,elementCount:209},{nodeCount:88,elementCount:0},
  {nodeCount:100001,elementCount:209},{nodeCount:88,elementCount:50001},
  {nodeCount:NaN,elementCount:209},{nodeCount:88,elementCount:208.5}])
  assert.throws(() => parseBoundedOpenRadiossTFile4(bytes, 3e-6, undefined, counts), /summation counts/);
assert.throws(() => parseBoundedOpenRadiossTFile4(fixture({ ...cadenceOptions,
  addedMass: 5e-20 }), 1e-5, completion, actualMeshCounts), /mass scaling/);
assert.throws(() => parseBoundedOpenRadiossTFile4(
  fixture({ ...cadenceOptions, addedMass: 5e-20 }), 1e-5, completion), /mass scaling/);
assert.throws(() => parseBoundedOpenRadiossTFile4(
  fixture({ ...cadenceOptions, addedMass: -1e-9 }), 1e-5, completion), /mass scaling/);
assert.throws(() => parseBoundedOpenRadiossTFile4(fixture({ ...cadenceOptions,
  addedMassByFrame: cycles.map((_, i) => i === 5 ? -4e-20 : initialResidual) }),
  1e-5, completion), /changed.*mass|mass scaling/);
assert.throws(() => parseBoundedOpenRadiossTFile4(fixture({ ...cadenceOptions,
  massByFrame: cycles.map((_, i) => i === 5 ? 7.81e-5 : 7.8e-5) }),
  1e-5, completion), /inconsistent mass|mass scaling/);
assert.throws(() => validateOpenRadiossExplicitCadence(cadenceTimes.slice(0, -1),
  cycles.slice(0, -1).map(() => step), 1e-5, completion), /missing/);
assert.throws(() => validateOpenRadiossExplicitCadence(cadenceTimes, cycles.map(() => step),
  1e-5, { ...completion, completedCycles: 20 }), /cycle count/);
assert.throws(() => validateOpenRadiossExplicitCadence(cadenceTimes,
  cycles.map((_, i) => i === 2 ? Math.fround(step * 1.01) : step), 1e-5, completion), /variable timestep/);
assert.throws(() => validateOpenRadiossExplicitCadence(cadenceTimes.map((t, i) => i === 3 ? Math.fround(t + step) : t),
  cycles.map(() => step), 1e-5, completion), /inconsistent/);
const deck = readFileSync(new URL('./probe-sim9-openradioss-standalone.mts', import.meta.url), 'utf8');
assert.match(deck, /'\/TFILE\/4', formatFloat\(1e-6\)/);
assert.doesNotMatch(deck, /'\/TH\/TITLE'/);
console.log(JSON.stringify({ pass: true, syntheticFrames: parsed.frames.length,
  nodes: parsed.nodeIds.length, channels: parsed.channelCodes, rawImpulsePreserved: true,
  forceRule: 'forward/centered/backward dI/dt; N.s/s=N', converterTrusted: false }));
