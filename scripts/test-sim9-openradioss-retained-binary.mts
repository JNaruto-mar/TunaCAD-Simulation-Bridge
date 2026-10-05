// No solver: authenticate and re-read the isolated existing T01 only.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parseBoundedOpenRadiossTFile4 } from './referenceTFileReader.mts';
const directory = process.env.TUNACAD_OPENRADIOSS_RETAINED_DIR;
const expectedDigest = process.env.TUNACAD_OPENRADIOSS_EXPECTED_T01_SHA256;
if (!directory || !expectedDigest || !/^[a-f0-9]{64}$/.test(expectedDigest)) throw new Error('Retained directory and authenticated T01 digest required');
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const source = join(directory, 'ExplicitBarProbeT01');
const bytes = await readFile(source);
assert.equal(bytes.length, 3984);
assert.equal(hash(bytes), expectedDigest);
const receipt = JSON.parse(await readFile(join(directory, 'pre-dispatch-receipt.json'), 'utf8'));
const engineExit = JSON.parse(await readFile(join(directory, 'engine-exit.json'), 'utf8'));
const listing = await readFile(join(directory, 'ExplicitBarProbe_0001.out'), 'utf8');
assert.equal(engineExit.exitCode, 0);
assert.equal(engineExit.error, null);
assert.match(listing, /NORMAL TERMINATION/);
const completedCycles = Number(listing.match(/TOTAL NUMBER OF CYCLES\s*:\s*(\d+)/)?.[1]);
assert.equal(completedCycles, 21);
assert.equal(hash(await readFile(receipt.enginePath)), receipt.engineSha256);
assert.equal(receipt.time.durationS, 1e-5);
assert.equal(receipt.time.historyIntervalS, 1e-6);
assert.equal(receipt.time.control, '/DT/NODA; scale=0.9; minimum=0');
assert.equal(receipt.time.historyFormat, 'binary_ieee32_TFILE_4');
const result = parseBoundedOpenRadiossTFile4(bytes, receipt.time.durationS, {
  method: 'frozen-2026-constant-step', historyIntervalS: receipt.time.historyIntervalS,
  engineExitCode: 0, normalTermination: true, completedCycles,
});
assert.equal(result.thicode, 3040);
assert.equal(result.frames.length, 10);
assert.equal(result.sha256, expectedDigest);
assert.equal(result.coverage?.complete, true);
const fixedIds = receipt.faces.fixed.nodeIds as number[];
for (const frame of result.frames) {
  assert.equal(frame.global.rawOrderedValues.length, 22);
  assert.equal(frame.nodes.size, 10);
  assert.equal(frame.global.addedMassMg, result.frames[0].global.addedMassMg);
  assert.ok(frame.global.addedMassMg <= 0);
  assert.equal(frame.global.addedMassChangeFromInitializationMg, 0);
  assert.equal(frame.global.massMg, result.frames[0].global.massMg);
  for (const id of fixedIds) {
    const node = frame.nodes.get(id)!;
    assert.equal(node.dxMm, 0);
    assert.equal(node.vxMmPerS, 0);
    assert.equal(node.axMmPerS2, 0);
    assert.ok(Number.isFinite(node.reactionImpulseNs));
    assert.ok(Number.isFinite(node.reactionForceN));
  }
}
const report = {
  pass: true, evidence: 'retained authentic TFILE/4; no solver',
  sourceSha256: result.sha256, byteCount: bytes.length, thicode: result.thicode,
  firstTimeS: result.frames[0].timeS, lastTimeS: result.frames.at(-1)!.timeS,
  frameCount: result.frames.length, coverage: result.coverage,
  frames: result.frames.map(frame => ({
    timeS: frame.timeS, global: frame.global,
    loadedNode5: frame.nodes.get(5),
    nodes: [...frame.nodes].map(([id, value]) => ({ id, ...value })),
    supportImpulseNs: fixedIds.reduce((s, id) => s + frame.nodes.get(id)!.reactionImpulseNs, 0),
    supportReactionN: fixedIds.reduce((s, id) => s + frame.nodes.get(id)!.reactionForceN, 0),
  })),
};
assert.equal(hash(await readFile(source)), expectedDigest, 'Authentic T01 mutated');
await writeFile(join(directory, 'direct-3040-recovery.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
