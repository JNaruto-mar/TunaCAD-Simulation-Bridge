// Isolated, explicitly approved fine attempt; preparation/verification only.
// Starter OS-return capture reuses run-sim9-openradioss-starter-provenance.mts.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, readdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { AXIAL_ORACLE_DIGEST } from '../simulation-bridge/openRadiossAxialBarOracle.mts';
import { TIMESTEP_SENSITIVITY_DIGEST } from '../simulation-bridge/openRadiossTimeStepSensitivity.mts';
const mode = process.argv[2], name = 'ExplicitBarProbe';
const hash = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const json = async (dir: string, name: string) => JSON.parse(await readFile(join(dir, name), 'utf8'));
const save = async (dir: string, name: string, value: unknown) =>
  writeFile(join(dir, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const identity = async (path: string) => { const b = await readFile(path); return { path, bytes: b.length, sha256: hash(b) }; };
async function verifyRuntime(receipt: any) {
  for (const f of receipt.runtime.files) {
    const actual = await identity(f.path); assert.equal(actual.bytes, f.bytes); assert.equal(actual.sha256, f.sha256);
  }
  assert.equal(digest(receipt.runtime.files), receipt.runtime.sha256);
  for (const key of ['starter', 'engine'] as const)
    assert.equal(hash(await readFile(receipt.binaryPaths[`${key}Exe`])), receipt.binarySha256[key]);
}
if (mode === 'prepare') {
  const medium = process.env.TUNACAD_OPENRADIOSS_MEDIUM_SOURCE_DIR;
  assert.ok(medium);
  const old = await json(medium, 'pre-dispatch-receipt.json');
  const report = await json(medium, 'medium-validation-report.json');
  assert.equal(report.mediumDecision, 'MEDIUM_PASS'); assert.equal(report.pass, true);
  assert.equal(report.t01Sha256, 'a679deb05ab2476afce7fe12d8c4eed5aaf7784065a497b68d24ff61972be559');
  assert.equal(hash(await readFile(join(medium, `${name}T01`))), report.t01Sha256);
  assert.equal(hash(await readFile(join(medium, 'engine.stdout.txt'))), report.cycleTraceSha256);
  assert.equal(hash(await readFile(join(medium, 'engine-output-provenance.json'))), report.contemporaneousEngineProvenanceDigest);
  assert.equal(old.oracleDigest, AXIAL_ORACLE_DIGEST); assert.equal(old.sensitivityPlanDigest, TIMESTEP_SENSITIVITY_DIGEST);
  assert.equal(old.time.control, '/DT/NODA; scale=0.6; minimum=0');
  assert.deepEqual([old.mesh.nodes, old.mesh.elements], [88, 208]);
  assert.deepEqual(old.material, { E_MPa: 200000, nu: 0.3, density_Mg_mm3: 7.8e-9 });
  assert.deepEqual(old.faces.fixed.nodeIds, [1, 2, 3, 4, 45]);
  assert.deepEqual(old.faces.loaded.nodeIds, [5, 6, 7, 8, 46]);
  assert.equal(old.faces.forceSumN, 100);
  assert.equal(hash(await readFile(old.sourceFrd)), old.sourceSha256);
  await verifyRuntime(old);
  const starter = await readFile(old.starterPath), original = await readFile(old.enginePath, 'utf8');
  assert.equal(hash(starter), old.starterSha256); assert.equal(hash(original), old.engineSha256);
  const from = '/DT/NODA\n   6.000000000000e-1   0.000000000000e+0';
  const to = '/DT/NODA\n   4.000000000000e-1   0.000000000000e+0';
  assert.equal(original.split(from).length, 2);
  const engine = original.replace(from, to); assert.equal(engine.replace(to, from), original);
  assert.match(engine, /\/TFILE\/4\n\s*1\.000000000000e-6/);
  assert.match(engine, /\/RUN\/ExplicitBarProbe\/1\n\s*5\.000000000000e-5/);
  const directory = await mkdtemp(join(tmpdir(), 'tunacad-openradioss-fine-provenance-'));
  const attemptId = randomUUID();
  const time = { ...old.time, control: '/DT/NODA; scale=0.4; minimum=0' };
  const studyId = digest({ starter: hash(starter), mesh: old.sourceSha256,
    material: old.material, faces: old.faces, time, oracle: AXIAL_ORACLE_DIGEST, plan: TIMESTEP_SENSITIVITY_DIGEST });
  await writeFile(join(directory, `${name}_0000.rad`), starter, { flag: 'wx' });
  await writeFile(join(directory, `${name}_0001.rad`), engine, { flag: 'wx' });
  const receipt = { ...old, level: 'fine', attemptId, studyId, time,
    evidence: 'one explicitly approved fine Starter -> admission -> Engine attempt; no retry',
    starterPath: join(directory, `${name}_0000.rad`), enginePath: join(directory, `${name}_0001.rad`),
    starterSha256: hash(starter), engineSha256: hash(engine),
    sourceMediumReportDigest: hash(await readFile(join(medium, 'medium-validation-report.json'))),
    sourceMediumOutputPinDigest: report.contemporaneousEngineProvenanceDigest,
    changedFieldOnly: '/DT/NODA scale; 0.6 -> 0.4',
    engineRunAuthorized: true, fineRunAuthorized: true, automaticRetry: false,
    retainAllEvidenceThroughReporting: true };
  await save(directory, 'pre-dispatch-receipt.json', receipt);
  await save(directory, 'attempt-receipt.json', { schema: 'tunacad-openradioss-starter-attempt/0.1',
    attemptId, studyId, phase: 'prepared', prepared: receipt,
    preparedDigest: hash(await readFile(join(directory, 'pre-dispatch-receipt.json'))) });
  console.log(JSON.stringify({ pass: true, directory, attemptId, studyId,
    starterDeckDigest: hash(starter), engineDeckDigest: hash(engine),
    runtimeManifestDigest: old.runtime.sha256, runtimeManifestFiles: old.runtime.files.length,
    onlyChange: 'scale 0.6 -> 0.4', noSolverRan: true }));
} else if (mode === 'verify') {
  const directory = process.env.TUNACAD_OPENRADIOSS_VALIDATION_DIR; assert.ok(directory);
  const receipt = await json(directory, 'pre-dispatch-receipt.json');
  const output = await json(directory, 'starter-output-receipt.json');
  const admission = await json(directory, 'engine-admission.json');
  assert.equal(receipt.level, 'fine'); assert.equal(admission.level, 'fine'); assert.equal(admission.pass, true);
  assert.equal(output.attemptId, receipt.attemptId); assert.equal(output.studyId, receipt.studyId);
  assert.equal(output.capturedContemporaneously, true);
  assert.equal(output.attemptReceiptDigest, hash(await readFile(join(directory, 'attempt-receipt.json'))));
  for (const f of output.produced) {
    assert.equal(f.path, join(directory, f.name));
    const actual = await identity(f.path); assert.equal(actual.bytes, f.bytes); assert.equal(actual.sha256, f.sha256);
  }
  assert.equal(admission.retainedBindings.restartDigest, output.pin.restartDigest);
  assert.equal(admission.retainedBindings.starterListingDigest, output.pin.starterListingDigest);
  assert.equal(hash(await readFile(receipt.starterPath)), receipt.starterSha256);
  assert.equal(hash(await readFile(receipt.enginePath)), receipt.engineSha256);
  await verifyRuntime(receipt);
  assert.ok(!(await readdir(directory)).includes('engine-launch.json'));
  const ready = { schema: 'tunacad-openradioss-fine-engine-readiness/0.1', pass: true,
    attemptId: receipt.attemptId, studyId: receipt.studyId, inputDeckDigest: receipt.starterSha256,
    engineDeckDigest: receipt.engineSha256, listingDigest: output.pin.starterListingDigest,
    restartDigest: output.pin.restartDigest, capturedContemporaneously: true,
    admissionDigest: hash(await readFile(join(directory, 'engine-admission.json'))),
    rehashAfterAdmission: 'PASS', engineRunAuthorized: true, automaticRetry: false,
    engineeringUsePermitted: false, providerAdmission: 'closed' };
  await save(directory, 'engine-readiness.json', ready); console.log(JSON.stringify(ready));
} else throw new Error('prepare/verify only; no solver dispatch');
