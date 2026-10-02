// No solver. Synthetic bounded sections and the authentic retained medium listing.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readBoundedStarterConcentratedLoads as parse,
  verifyRetainedStarterArtifactPin as verifyPin } from '../simulation-bridge/openRadiossStarterLoads.mts';
const expected = [5, 6, 7, 8, 46].map(id => ({ id, forceN: id === 46 ? 33.33333333332 : 16.66666666667 }));
const rows = expected.map(n => ` ${n.id} 0 X 1 0 1.000000000000 ${n.forceN}`);
const prefix = ' NCONLD: NUMBER OF CONCENTRATED LOADS. . . . . . . . . 5\n';
const heading = ' CONCENTRATED LOADS\n ------------------\n NODE SKEW DIR LOAD_CURVE SENSOR SCALE_X SCALE_Y\n';
const end = '\n SPMD IS CHECKING FOR ELEMENT DELETION IN :\n ExplicitBarProbe_0001.rad\n';
const section = (body = rows) => prefix + heading + body.join('\n') + end;
const oldBugCount = (listing: string) => [...listing.split('CONCENTRATED LOADS')[1].split('PART MASS')[0]
  .matchAll(/^\s*(\d+)\s+0\s+X\s+1\s+0\s+([\d.E+-]+)\s+([\d.E+-]+)\s*$/gm)].length;
assert.equal(oldBugCount(section()), 0, 'Exact old false-zero extraction bug must be reproduced');
const good = parse(section(), expected);
assert.equal(good.resultantN, 100); assert.deepEqual(good.loads.map(n => n.nodeId), [5, 6, 7, 8, 46]);
assert.deepEqual(parse(section([...rows].reverse()), expected), good);
assert.deepEqual(parse(section().replaceAll('\n', '\r\n'), expected), good);
assert.throws(() => parse(prefix + end, expected), /heading/);
assert.throws(() => parse(section() + heading + rows.join('\n') + end, expected), /duplicate/);
assert.throws(() => parse(section().replace('------------------', '-----'), expected), /underline/);
assert.throws(() => parse(section().replace('SCALE_Y', 'FORCE'), expected), /schema/);
assert.throws(() => parse(section().replace(end, ''), expected), /terminator/);
assert.throws(() => parse(section(['broken row', ...rows.slice(1)]), expected), /malformed/);
assert.throws(() => parse(section(rows.slice(1)), expected), /missing/);
assert.throws(() => parse(section([...rows, rows[0]]), expected), /extra/);
assert.throws(() => parse(section([rows[0], rows[0], ...rows.slice(2)]), expected), /duplicate/);
assert.throws(() => parse(section([rows[0].replace(' 5 ', ' 99 '), ...rows.slice(1)]), expected), /node/);
assert.throws(() => parse(section([rows[0].replace(' X ', ' Y '), ...rows.slice(1)]), expected), /component/);
assert.throws(() => parse(section([rows[0].replace('16.66666666667', '17'), ...rows.slice(1)]), expected), /force/);
assert.throws(() => parse(section([rows[0].replace('16.66666666667', 'NaN'), ...rows.slice(1)]), expected), /malformed/);
assert.throws(() => parse(section([rows[0].replace(' 0 X ', ' 1 X '), ...rows.slice(1)]), expected), /interpretation/);
const wrongTotal = expected.map(n => ({ ...n, forceN: n.forceN + 1 }));
assert.throws(() => parse(section(wrongTotal.map(n => ` ${n.id} 0 X 1 0 1 ${n.forceN}`)), wrongTotal), /resultant/);
const pin = { attemptDigest: 'a'.repeat(64), starterListingDigest: 'b'.repeat(64), restartDigest: 'c'.repeat(64),
  starterDeckDigest: 'd'.repeat(64), engineDeckDigest: 'e'.repeat(64), runtimeDigest: 'f'.repeat(64) };
assert.equal(verifyPin(pin, undefined).state, 'PENDING');
assert.equal(verifyPin(pin, { ...pin }).state, 'PASS'); // Controlled pin fixture, not retained-run provenance.
for (const key of Object.keys(pin) as (keyof typeof pin)[])
  assert.throws(() => verifyPin({ ...pin, [key]: '0'.repeat(64) }, pin), /changed/);
const directory = process.env.TUNACAD_OPENRADIOSS_VALIDATION_DIR;
assert.ok(directory, 'Retained medium directory required; no solver fallback');
const listing = await readFile(join(directory, 'ExplicitBarProbe_0000.out'), 'utf8');
const receipt = JSON.parse(await readFile(join(directory, 'pre-dispatch-receipt.json'), 'utf8'));
const launch = JSON.parse(await readFile(join(directory, 'starter-launch.json'), 'utf8'));
const exit = JSON.parse(await readFile(join(directory, 'starter-exit.json'), 'utf8'));
const hash = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
assert.equal(exit.exitCode, 0); assert.equal(exit.error, null);
assert.equal(launch.deckDigest, receipt.starterSha256);
assert.equal(launch.runtimeDigest, receipt.binarySha256.starter);
assert.equal(hash(await readFile(join(directory, 'ExplicitBarProbe_0000.rad'))), launch.deckDigest);
assert.equal(hash(await readFile(join(directory, 'ExplicitBarProbe_0001.rad'))), receipt.engineSha256);
assert.equal(oldBugCount(listing), 0);
const authentic = parse(listing, receipt.faces.forceByNode);
assert.deepEqual(authentic.loads, good.loads); assert.equal(authentic.resultantN, 100);
const originalListingHash = hash(listing);
assert.equal(hash(await readFile(join(directory, 'ExplicitBarProbe_0000.out'))), originalListingHash);
const restart = await readFile(join(directory, 'ExplicitBarProbe_0000_0001.rst'));
assert.ok(restart.length > 0);
const admission = JSON.parse(await readFile(join(directory, 'engine-admission.json'), 'utf8'));
assert.equal(admission.interpretedAdmissionState, 'PASS after harness correction');
assert.equal(admission.pass, false); assert.equal(admission.dispatchAdmissionState, 'PENDING');
assert.equal(admission.engineOnlyExecutionJustified, false);
assert.equal(admission.retainedBindings.starterListingDigest, hash(listing));
assert.equal(admission.retainedBindings.restartDigest, hash(restart));
assert.equal(admission.starterLaunchDigest, hash(await readFile(join(directory, 'starter-launch.json'))));
assert.equal(admission.starterExitDigest, hash(await readFile(join(directory, 'starter-exit.json'))));
assert.deepEqual(admission.interpretedLoads.loads, authentic.loads);
assert.equal(admission.criticalNodalEstimateS, 5.3236366039543e-7);
assert.equal(admission.selectedEstimatedStepS, 3.19418196237258e-7);
assert.equal(admission.expectedCycles, 157);
assert.equal(JSON.parse(await readFile(join(directory, 'admission-failure.json'), 'utf8')).actualFailure,
  'AssertionError: load row count 0 !== 5');
await assert.rejects(readFile(join(directory, 'engine-launch.json')), { code: 'ENOENT' });
console.log(JSON.stringify({ pass: true, evidence: 'no-solver fixtures + authentic retained medium listing',
  oldBugCount: 0, correctedLoadCount: authentic.loads.length, ...authentic,
  starterListingDigest: originalListingHash, originalLaunchUnchanged: true,
  artifactPinTests: 'missing original pin PENDING; changed bindings rejected; matching controlled pin PASS',
  persistedCurrentCheckpointVerified: true, engineLaunchAbsent: true }));
