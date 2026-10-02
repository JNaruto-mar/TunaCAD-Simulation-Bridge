// One explicitly approved Starter-only regeneration. No Engine launch path.
// Capture produced bytes immediately on OS return, BEFORE interpretation/cleanup.
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, stat, mkdtemp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { basename, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { digest } from '../simulation-bridge/stableDigest.mts';
const mode = process.argv[2], name = 'ExplicitBarProbe';
const source = process.env.TUNACAD_OPENRADIOSS_MEDIUM_SOURCE_DIR;
const directory = process.env.TUNACAD_OPENRADIOSS_VALIDATION_DIR;
const root = process.env.OPENRADIOSS_PATH;
const hash = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const json = async (dir: string, file: string) => JSON.parse(await readFile(join(dir, file), 'utf8'));
const save = async (dir: string, file: string, value: unknown, exclusive = true) =>
  writeFile(join(dir, file), JSON.stringify(value, null, 2) + '\n', exclusive ? { flag: 'wx' } : {});
const fileIdentity = async (path: string) => { const bytes = await readFile(path);
  return { path, bytes: bytes.length, sha256: hash(bytes) }; };
async function runtimeFiles(runtimeRoot: string) {
  const files: string[] = [];
  async function walk(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      assert.ok(!entry.isSymbolicLink(), 'Unexpected configuration link');
      if (entry.isDirectory()) await walk(join(path, entry.name));
      else if (entry.isFile()) files.push(join(path, entry.name));
      assert.ok(files.length <= 10000, 'Configuration inventory bound');
    }
  }
  // Native 2026 block input plus unit definitions/message catalogs, not other solvers' configs.
  for (const suffix of ['config/CFG/radioss2026', 'config/CFG/UNITS', 'messages'])
    await walk(join(runtimeRoot, 'hm_cfg_files', suffix));
  for (const suffix of ['extlib/hm_reader/win64', 'extlib/intelOneAPI_runtime/win64', 'extlib/h3d/lib/win64'])
    for (const entry of await readdir(join(runtimeRoot, suffix), { withFileTypes: true }))
      if (entry.isFile() && entry.name.endsWith('.dll')) files.push(join(runtimeRoot, suffix, entry.name));
  let size = 0;
  const identities = [];
  for (const path of files.sort()) {
    const identity = await fileIdentity(path); size += identity.bytes;
    assert.ok(size <= 400 * 1024 * 1024, 'Runtime fingerprint bound');
    identities.push({ relativePath: relative(runtimeRoot, path), ...identity });
  }
  return { sha256: digest(identities), files: identities };
}
assert.ok(root, 'Installed external runtime root required');
if (mode === 'prepare') {
  assert.ok(source);
  const old = await json(source, 'pre-dispatch-receipt.json');
  const admitted = await json(source, 'engine-admission.json');
  assert.equal(admitted.interpretedAdmissionState, 'PASS after harness correction');
  const starter = await readFile(old.starterPath), engine = await readFile(old.enginePath);
  assert.equal(hash(starter), old.starterSha256); assert.equal(hash(engine), old.engineSha256);
  assert.equal(old.time.control, '/DT/NODA; scale=0.6; minimum=0');
  assert.equal(old.time.durationS, 50e-6); assert.equal(old.time.historyIntervalS, 1e-6);
  assert.equal(old.faces.forceSumN, 100); assert.equal(old.mesh.nodes, 88); assert.equal(old.mesh.elements, 208);
  assert.equal(hash(await readFile(old.sourceFrd)), old.sourceSha256);
  assert.match(engine.toString(), /\/DT\/NODA\n\s*6\.000000000000e-1\s+0\.000000000000e\+0/);
  assert.match(engine.toString(), /\/TFILE\/4\n\s*1\.000000000000e-6/);
  assert.doesNotMatch(starter.toString() + engine.toString(), /\/(?:AMS|ADMAS|DAMP|DYREL|KEREL|INTER|INIVEL|IMPLICIT|DT\/[^\r\n]*\/(?:CST|AMS|DEL|SET))/i);
  const runtime = await runtimeFiles(root);
  for (const key of ['starter', 'engine'] as const)
    assert.equal(hash(await readFile(old.binaryPaths[`${key}Exe`])), old.binarySha256[key]);
  const env = { OPENRADIOSS_PATH: root, RAD_CFG_PATH: join(root, 'hm_cfg_files'),
    RAD_H3D_PATH: join(root, 'extlib', 'h3d', 'lib', 'win64'), KMP_STACKSIZE: '400m', OMP_NUM_THREADS: '1',
    PATH: [join(root, 'extlib', 'hm_reader', 'win64'), join(root, 'extlib', 'intelOneAPI_runtime', 'win64'),
      join(root, 'extlib', 'h3d', 'lib', 'win64'), process.env.PATH].join(';') };
  const target = await mkdtemp(join(tmpdir(), 'tunacad-openradioss-medium-provenance-'));
  await writeFile(join(target, `${name}_0000.rad`), starter, { flag: 'wx' });
  await writeFile(join(target, `${name}_0001.rad`), engine, { flag: 'wx' });
  const attemptId = randomUUID();
  const studyId = digest({ starter: old.starterSha256, mesh: old.sourceSha256,
    material: old.material, faces: old.faces, time: old.time, oracle: old.oracleDigest, plan: old.sensitivityPlanDigest });
  const receipt = { ...old, attemptId, studyId, evidence: 'one approved Starter-only medium provenance regeneration',
    sourceAttemptReceiptDigest: hash(await readFile(join(source, 'pre-dispatch-receipt.json'))),
    starterPath: join(target, `${name}_0000.rad`), enginePath: join(target, `${name}_0001.rad`),
    runtime, launchEnvironment: env, contemporaneousCaptureRequired: true,
    engineRunAuthorized: false, fineRunAuthorized: false, automaticRetry: false };
  await save(target, 'pre-dispatch-receipt.json', receipt);
  await save(target, 'attempt-receipt.json', { schema: 'tunacad-openradioss-starter-attempt/0.1',
    attemptId, studyId, phase: 'prepared', prepared: receipt,
    preparedDigest: hash(await readFile(join(target, 'pre-dispatch-receipt.json'))) });
  console.log(JSON.stringify({ pass: true, directory: target, attemptId, studyId,
    starterDeckDigest: hash(starter), engineDeckDigest: hash(engine), runtimeManifestDigest: runtime.sha256,
    runtimeManifestFiles: runtime.files.length, unchangedDecks: true, engineRunAuthorized: false }));
} else {
  assert.ok(directory);
  const receipt = await json(directory, 'pre-dispatch-receipt.json');
  const preBytes = await readFile(join(directory, 'pre-dispatch-receipt.json'));
  const attempt = await json(directory, 'attempt-receipt.json');
  assert.equal(attempt.preparedDigest, hash(preBytes));
  assert.equal(attempt.attemptId, receipt.attemptId); assert.equal(attempt.studyId, receipt.studyId);
  assert.deepEqual(attempt.prepared, receipt);
  assert.equal(hash(await readFile(receipt.starterPath)), receipt.starterSha256);
  assert.equal(hash(await readFile(receipt.enginePath)), receipt.engineSha256);
  assert.equal(root, receipt.launchEnvironment.OPENRADIOSS_PATH);
  if (mode === 'starter') {
    assert.equal(attempt.phase, 'prepared');
    assert.equal(hash(await readFile(receipt.binaryPaths.starterExe)), receipt.binarySha256.starter);
    assert.deepEqual(await runtimeFiles(root), receipt.runtime);
    const args = ['-i', `${name}_0000.rad`, '-np', '1'];
    const launch = { args, timestamp: new Date().toISOString(), attemptId: receipt.attemptId,
      deckDigest: receipt.starterSha256, runtimeDigest: receipt.binarySha256.starter,
      preparedDigest: hash(preBytes), runtimeManifestDigest: receipt.runtime.sha256, retryProhibited: true };
    await save(directory, 'starter-launch.json', launch); // exclusive launch latch BEFORE process launch
    const result = spawnSync(receipt.binaryPaths.starterExe, args, { cwd: directory,
      env: { ...process.env, ...receipt.launchEnvironment }, windowsHide: true,
      timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
    const terminatedAt = new Date().toISOString();
    // FIRST operation after process return: read and fingerprint all produced files.
    // No parser, cleanup, retry, scratch copying or Engine launch precedes this.
    const produced = [];
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isFile() && entry.name.startsWith(name) && !entry.name.endsWith('.rad'))
        produced.push({ name: entry.name, ...await fileIdentity(join(directory, entry.name)) });
    }
    const capturedAt = new Date().toISOString();
    const exit = { exitCode: result.status, signal: result.signal, error: result.error?.message ?? null };
    const stdout = result.stdout ?? Buffer.alloc(0), stderr = result.stderr ?? Buffer.alloc(0);
    await save(directory, 'attempt-receipt.json', { ...attempt, phase: 'starter_terminated_outputs_pinned',
      execution: { launch, exit, terminatedAt, capturedAt,
        stdoutDigest: hash(stdout), stderrDigest: hash(stderr), produced,
        captureOrder: 'OS return -> produced file hashes -> same attempt receipt -> logs/exit -> interpretation' } }, false);
    await writeFile(join(directory, 'starter.stdout.txt'), stdout, { flag: 'wx' });
    await writeFile(join(directory, 'starter.stderr.txt'), stderr, { flag: 'wx' });
    await save(directory, 'starter-exit.json', exit);
    const listing = produced.find(f => f.name === `${name}_0000.out`);
    const restart = produced.find(f => f.name === `${name}_0000_0001.rst`);
    if (result.status !== 0 || result.error || !listing || !restart || restart.bytes <= 0) {
      console.log(JSON.stringify({ pass: false, attemptId: receipt.attemptId, exit, produced, noRetry: true }));
      throw new Error('Starter failed or required artifacts missing; no retry/Engine');
    }
    const pin = { attemptDigest: hash(Buffer.concat([preBytes,
      await readFile(join(directory, 'starter-launch.json')), await readFile(join(directory, 'starter-exit.json'))])),
      starterListingDigest: listing.sha256, restartDigest: restart.sha256,
      starterDeckDigest: receipt.starterSha256, engineDeckDigest: receipt.engineSha256,
      runtimeDigest: receipt.binarySha256.starter };
    await save(directory, 'starter-output-receipt.json', {
      schema: 'tunacad-openradioss-starter-completion-pin/0.1', attemptId: receipt.attemptId, studyId: receipt.studyId,
      capturedContemporaneously: true, attemptReceiptDigest: hash(await readFile(join(directory, 'attempt-receipt.json'))),
      pin, produced, terminatedAt, capturedAt, executionExit: exit });
    console.log(JSON.stringify({ pass: true, attemptId: receipt.attemptId, exit,
      capturedContemporaneously: true, listing, restart, engineRan: false }));
  } else if (mode === 'verify') {
    assert.equal(attempt.phase, 'starter_terminated_outputs_pinned');
    const output = await json(directory, 'starter-output-receipt.json');
    const admission = await json(directory, 'engine-admission.json');
    assert.equal(output.attemptReceiptDigest, hash(await readFile(join(directory, 'attempt-receipt.json'))));
    assert.equal(output.attemptId, receipt.attemptId); assert.equal(output.studyId, receipt.studyId);
    assert.equal(output.capturedContemporaneously, true); assert.equal(admission.pass, true);
    assert.equal(admission.dispatchAdmissionState, 'PASS');
    for (const artifact of output.produced) {
      assert.equal(basename(artifact.path), artifact.name);
      const actual = await fileIdentity(join(directory, artifact.name));
      assert.equal(actual.bytes, artifact.bytes); assert.equal(actual.sha256, artifact.sha256);
    }
    assert.equal(admission.retainedBindings.restartDigest, output.pin.restartDigest);
    assert.equal(admission.retainedBindings.starterListingDigest, output.pin.starterListingDigest);
    assert.deepEqual(await runtimeFiles(root), receipt.runtime);
    assert.equal(hash(await readFile(receipt.binaryPaths.starterExe)), receipt.binarySha256.starter);
    assert.equal(hash(await readFile(receipt.binaryPaths.engineExe)), receipt.binarySha256.engine);
    assert.ok(!(await readdir(directory)).includes('engine-launch.json'));
    const ready = { schema: 'tunacad-openradioss-medium-engine-readiness/0.1', pass: true,
      attemptId: receipt.attemptId, studyId: receipt.studyId, inputDeckDigest: receipt.starterSha256,
      engineDeckDigest: receipt.engineSha256, listingDigest: output.pin.starterListingDigest,
      restartDigest: output.pin.restartDigest, capturedContemporaneously: true,
      admissionDigest: hash(await readFile(join(directory, 'engine-admission.json'))),
      rehashAfterAdmission: 'PASS; every produced Engine input artifact matches immediate OS-return pin',
      engineRunAuthorized: false, engineRan: false, fineRunJustified: false,
      proofOfConcept: true, engineeringUsePermitted: false, providerAdmission: 'closed' };
    await save(directory, 'engine-readiness.json', ready);
    console.log(JSON.stringify(ready));
  } else throw new Error('prepare/starter/verify only; no Engine mode');
}
