// One approved medium Engine-only or fine post-admission Engine launch.
// Isolated fixture only; no Starter, retry or production admission path.
// Hash provider output immediately on process return, before any interpretation.
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const directory = process.env.TUNACAD_OPENRADIOSS_VALIDATION_DIR;
assert.ok(directory);
const hash = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const json = async (file: string) => JSON.parse(await readFile(join(directory, file), 'utf8'));
const save = async (file: string, value: unknown) => writeFile(join(directory, file), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const file = async (path: string) => { const bytes = await readFile(path); return { path, bytes: bytes.length, sha256: hash(bytes) }; };
const name = 'ExplicitBarProbe', receipt = await json('pre-dispatch-receipt.json');
const fine = process.env.TUNACAD_OPENRADIOSS_TIMESTEP_LEVEL === 'fine';
assert.equal(receipt.level, fine ? 'fine' : 'medium');
const ready = await json('engine-readiness.json'), admission = await json('engine-admission.json');
const attemptBytes = await readFile(join(directory, 'attempt-receipt.json'));
const attempt = JSON.parse(attemptBytes.toString('utf8')), starterPin = await json('starter-output-receipt.json');
if (!fine) assert.equal(receipt.attemptId, 'edc380e8-cd29-4cab-99ea-0f208d069811');
else { assert.equal(receipt.fineRunAuthorized, true); assert.equal(ready.engineRunAuthorized, true); }
assert.equal(ready.attemptId, receipt.attemptId); assert.equal(ready.studyId, receipt.studyId);
assert.equal(starterPin.attemptId, receipt.attemptId); assert.equal(starterPin.studyId, receipt.studyId);
assert.equal(attempt.attemptId, receipt.attemptId); assert.equal(attempt.studyId, receipt.studyId);
assert.equal(starterPin.attemptReceiptDigest, hash(attemptBytes));
assert.equal(attempt.preparedDigest, hash(await readFile(join(directory, 'pre-dispatch-receipt.json'))));
assert.deepEqual(attempt.prepared, receipt); assert.deepEqual(attempt.execution.produced, starterPin.produced);
assert.equal(ready.pass, true); assert.equal(admission.pass, true);
assert.equal(ready.admissionDigest, hash(await readFile(join(directory, 'engine-admission.json'))));
assert.equal(ready.inputDeckDigest, '58424691156acf7cd163a0fd5bc61c71a24fabdd186c799394a8bb79fc43324f');
assert.equal(ready.engineDeckDigest, receipt.engineSha256);
if (!fine) {
  assert.equal(ready.engineDeckDigest, '8a20fe6add5f25384a9ddc4808d22240cf772d69cf7ee04e4c069e44f1c83536');
  assert.equal(ready.listingDigest, '37c03e95d4d01384f8c7d1256d80860afc199efffcbd32b3f97c0a2899cdeacd');
  assert.equal(ready.restartDigest, 'a74992b8e9712153d30c69090e7f5b8c32b2398c56018a769b97501f2cab0456');
}
assert.deepEqual([receipt.mesh.nodes, receipt.mesh.elements], [88, 208]);
assert.deepEqual(receipt.material, { E_MPa: 200000, nu: 0.3, density_Mg_mm3: 7.8e-9 });
assert.deepEqual(receipt.faces.fixed.nodeIds, [1, 2, 3, 4, 45]);
assert.deepEqual(receipt.faces.loaded.nodeIds, [5, 6, 7, 8, 46]);
assert.equal(receipt.faces.forceSumN, 100);
assert.equal(receipt.time.durationS, 50e-6); assert.equal(receipt.time.historyIntervalS, 1e-6);
assert.equal(receipt.time.control, `/DT/NODA; scale=${fine ? '0.4' : '0.6'}; minimum=0`);
const existing = await readdir(directory);
assert.ok(!existing.includes('engine-launch.json') && !existing.includes(`${name}T01`), 'No prior Engine/result can be reused');
assert.equal(hash(await readFile(receipt.sourceFrd)), receipt.sourceSha256);
const starterDeck = await file(receipt.starterPath), engineDeck = await file(receipt.enginePath);
const listing = await file(join(directory, `${name}_0000.out`));
const restart = await file(join(directory, `${name}_0000_0001.rst`));
assert.equal(starterDeck.sha256, ready.inputDeckDigest); assert.equal(engineDeck.sha256, ready.engineDeckDigest);
assert.equal(listing.sha256, ready.listingDigest); assert.equal(restart.sha256, ready.restartDigest);
assert.equal(starterPin.pin.starterListingDigest, listing.sha256); assert.equal(starterPin.pin.restartDigest, restart.sha256);
const control = await readFile(receipt.enginePath, 'utf8');
assert.match(control, /\/RUN\/ExplicitBarProbe\/1\n\s*5\.000000000000e-5/);
assert.match(control, fine ? /\/DT\/NODA\n\s*4\.000000000000e-1\s+0\.000000000000e\+0/
  : /\/DT\/NODA\n\s*6\.000000000000e-1\s+0\.000000000000e\+0/);
assert.match(control, /\/TFILE\/4\n\s*1\.000000000000e-6/);
assert.doesNotMatch(control, /\/(?:AMS|ADMAS|DAMP|DYREL|KEREL|INTER|INIVEL|IMPLICIT|DT\/[^\r\n]*\/(?:CST|AMS|DEL|SET))/i);
for (const artifact of starterPin.produced) {
  assert.equal(artifact.path, join(directory, artifact.name));
  const current = await file(artifact.path);
  assert.equal(current.bytes, artifact.bytes); assert.equal(current.sha256, artifact.sha256);
}
assert.ok(admission.expectedCycles < 20000);
for (const required of receipt.runtime.files) {
  const current = await file(required.path);
  assert.equal(current.bytes, required.bytes); assert.equal(current.sha256, required.sha256);
}
const engineExe = await file(receipt.binaryPaths.engineExe);
assert.equal(engineExe.sha256, receipt.binarySha256.engine);
assert.equal(receipt.launchEnvironment.OMP_NUM_THREADS, '1');
assert.equal(receipt.launchEnvironment.OPENRADIOSS_PATH, process.env.OPENRADIOSS_PATH);
// Final immediate model-identity check after runtime inspection, before launch.
assert.equal(hash(await readFile(engineDeck.path)), engineDeck.sha256);
assert.equal(hash(await readFile(listing.path)), listing.sha256);
assert.equal(hash(await readFile(restart.path)), restart.sha256);
const launch = { attemptId: receipt.attemptId, studyId: receipt.studyId, timestamp: new Date().toISOString(),
  args: ['-i', `${name}_0001.rad`], approvedScope: fine ? 'one fine Engine after Starter admission; no retry' : 'one Engine-only medium run; no automatic retry',
  starterAttemptReceiptDigest: hash(attemptBytes), readinessDigest: hash(await readFile(join(directory, 'engine-readiness.json'))),
  engineDeck, starterDeck, restart, starterListing: listing, engineExe,
  runtimeManifestDigest: receipt.runtime.sha256, runtimeFilesVerified: receipt.runtime.files.length,
  environment: receipt.launchEnvironment, retryProhibited: true };
await save('engine-launch.json', launch); // exclusive write-once launch latch
const result = spawnSync(engineExe.path, launch.args, { cwd: directory,
  env: { ...process.env, ...receipt.launchEnvironment }, windowsHide: true,
  timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
const terminatedAt = new Date().toISOString();
// First post-return activity is byte capture/fingerprinting, NOT output parsing.
const artifacts = [];
for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name)))
  if (entry.isFile() && entry.name.startsWith(name) && !entry.name.endsWith('.rad'))
    artifacts.push({ name: entry.name, ...await file(join(directory, entry.name)) });
const stdout = result.stdout ?? Buffer.alloc(0), stderr = result.stderr ?? Buffer.alloc(0);
const exit = { exitCode: result.status, signal: result.signal, error: result.error?.message ?? null };
const output = { schema: 'tunacad-openradioss-medium-engine-output-pin/0.1',
  attemptId: receipt.attemptId, studyId: receipt.studyId, starterAttemptReceiptDigest: hash(attemptBytes),
  engineLaunchDigest: hash(await readFile(join(directory, 'engine-launch.json'))),
  terminatedAt, capturedAt: new Date().toISOString(), exit, artifacts,
  stdoutDigest: hash(stdout), stderrDigest: hash(stderr),
  engineExeAfterExit: await file(engineExe.path), engineDeckAfterExit: await file(engineDeck.path),
  restartAfterExit: await file(restart.path),
  capturedBeforeInterpretation: true, engineRetriesAllowed: 0, fineRunAuthorized: fine };
await save('engine-output-provenance.json', output);
// Extend same attempt lineage without rewriting its original Starter receipt/pin.
await save('engine-attempt-receipt.json', { attemptId: receipt.attemptId, studyId: receipt.studyId,
  starterAttemptReceiptDigest: hash(attemptBytes), launch,
  outputReceiptDigest: hash(await readFile(join(directory, 'engine-output-provenance.json'))) });
await writeFile(join(directory, 'engine.stdout.txt'), stdout, { flag: 'wx' });
await writeFile(join(directory, 'engine.stderr.txt'), stderr, { flag: 'wx' });
await save('engine-exit.json', exit);
const t01 = artifacts.find(a => a.name === `${name}T01`);
console.log(JSON.stringify({ attemptId: receipt.attemptId, preLaunchVerification: 'PASS',
  engineExit: exit, t01, capturedBeforeInterpretation: true, noRetry: true }));
if (result.status !== 0 || result.error || !t01)
  throw new Error(`Engine failure/output missing: ${fine ? 'FINE_FAIL' : 'MEDIUM_FAIL'}; no retry`);
assert.equal(output.engineExeAfterExit.sha256, engineExe.sha256);
assert.equal(output.engineDeckAfterExit.sha256, engineDeck.sha256);
assert.equal(output.restartAfterExit.sha256, restart.sha256);
