// Explicitly approved standalone validation ONLY. Each launch is write-once.
// No production provider, no converter, no retry, no cleanup of retained evidence.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseBoundedOpenRadiossTFile4 } from './referenceTFileReader.mts';
import { evaluateAxialWaveHistory, axialWaveReference, AXIAL_ORACLE_DIGEST,
  AXIAL_VALIDATION_PLAN } from '../simulation-bridge/openRadiossAxialBarOracle.mts';
const hash = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const mode = process.argv[2];
const directory = process.env.TUNACAD_OPENRADIOSS_VALIDATION_DIR;
const retained = process.env.TUNACAD_OPENRADIOSS_RETAINED_DIR;
const root = process.env.OPENRADIOSS_PATH;
const name = 'ExplicitBarProbe';
const format = (n: number) => n.toExponential(12).padStart(20);
const save = async (dir: string, file: string, value: unknown, exclusive = false) =>
  writeFile(join(dir, file), JSON.stringify(value, null, 2) + '\n', exclusive ? { flag: 'wx' } : {});
if (mode === 'prepare') {
  assert.ok(retained && root);
  const old = JSON.parse(await readFile(join(retained, 'pre-dispatch-receipt.json'), 'utf8'));
  assert.equal(hash(await readFile(join(retained, `${name}T01`))),
    '542fd6ee406e0c5b1f2ce5218dc9329795f6b2d53632f26e9c3144e751eba82b');
  assert.equal(hash(await readFile(old.sourceFrd)), old.sourceSha256);
  assert.equal(old.mesh.nodes, 88); assert.equal(old.mesh.elements, 208);
  assert.deepEqual(old.material, { E_MPa: 200000, nu: 0.3, density_Mg_mm3: 7.8e-9 });
  assert.deepEqual(old.faces.fixed.nodeIds, [1, 2, 3, 4, 45]);
  assert.equal(old.faces.forceSumN, 100);
  const previousStarter = await readFile(old.starterPath, 'utf8');
  const previousEngine = await readFile(old.enginePath, 'utf8');
  assert.equal(hash(previousStarter), old.starterSha256);
  assert.equal(hash(previousEngine), old.engineSha256);
  const oldFunction = ['/FUNCT/1', 'Axial step from t zero', format(0) + format(1), format(1e-5) + format(1)].join('\n');
  assert.equal(previousStarter.split(oldFunction).length, 2);
  const starter = previousStarter.replace(oldFunction, oldFunction.replace(format(1e-5) + format(1), format(50e-6) + format(1)));
  const oldRun = `/RUN/${name}/1\n${format(1e-5)}`;
  assert.equal(previousEngine.split(oldRun).length, 2);
  const engine = previousEngine.replace(oldRun, `/RUN/${name}/1\n${format(50e-6)}`);
  assert.equal(starter.replace(format(50e-6) + format(1), format(1e-5) + format(1)), previousStarter);
  assert.equal(engine.replace(`/RUN/${name}/1\n${format(50e-6)}`, oldRun), previousEngine);
  assert.match(engine, /\/DT\/NODA\n\s*9\.000000000000e-1\s+0\.000000000000e\+0/);
  assert.match(engine, /\/TFILE\/4\n\s*1\.000000000000e-6/);
  assert.doesNotMatch(starter + engine, /\/(?:AMS|ADMAS|DAMP|DYREL|KEREL|INTER|INIVEL|IMPLICIT|DT\/[^\r\n]*\/(?:CST|AMS|DEL|SET))/i);
  for (const key of ['starterExe', 'engineExe'] as const) {
    assert.ok((await stat(old.binaryPaths[key])).isFile());
    assert.equal(hash(await readFile(old.binaryPaths[key])), old.binarySha256[key === 'starterExe' ? 'starter' : 'engine']);
  }
  const target = await mkdtemp(join(tmpdir(), 'tunacad-openradioss-axial-validation-'));
  await writeFile(join(target, `${name}_0000.rad`), starter);
  await writeFile(join(target, `${name}_0001.rad`), engine);
  const receipt = { ...old, schema: 'tunacad-openradioss-axial-validation/0.1',
    evidence: 'one approved standalone analytical run',
    originalPreparationDigest: hash(await readFile(join(retained, 'pre-dispatch-receipt.json'))),
    originalT01Digest: hash(await readFile(join(retained, `${name}T01`))),
    starterPath: join(target, `${name}_0000.rad`), starterSha256: hash(starter),
    enginePath: join(target, `${name}_0001.rad`), engineSha256: hash(engine),
    time: { ...old.time, durationS: 50e-6 }, oracleDigest: AXIAL_ORACLE_DIGEST,
    oraclePlan: AXIAL_VALIDATION_PLAN, retainAllEvidenceThroughReporting: true, automaticRetry: false };
  await save(target, 'pre-dispatch-receipt.json', receipt, true);
  console.log(JSON.stringify({ directory: target, receipt }));
} else {
  assert.ok(directory && root);
  const receipt = JSON.parse(await readFile(join(directory, 'pre-dispatch-receipt.json'), 'utf8'));
  assert.equal(receipt.oracleDigest, AXIAL_ORACLE_DIGEST);
  assert.equal(receipt.time.durationS, 50e-6);
  const env = { ...process.env, OPENRADIOSS_PATH: root,
    RAD_CFG_PATH: join(root, 'hm_cfg_files'), RAD_H3D_PATH: join(root, 'extlib', 'h3d', 'lib', 'win64'),
    KMP_STACKSIZE: '400m', OMP_NUM_THREADS: '1' };
  env.PATH = [join(root, 'extlib', 'hm_reader', 'win64'), join(root, 'extlib', 'intelOneAPI_runtime', 'win64'),
    join(root, 'extlib', 'h3d', 'lib', 'win64'), env.PATH].join(';');
  if (mode === 'starter' || mode === 'engine') {
    if (mode === 'engine') {
      const admission = JSON.parse(await readFile(join(directory, 'engine-admission.json'), 'utf8'));
      assert.equal(admission.pass, true);
      assert.equal(admission.starterListingDigest, hash(await readFile(join(directory, `${name}_0000.out`))));
      assert.equal(admission.engineDeckDigest, receipt.engineSha256);
    }
    const key = mode === 'starter' ? 'starterExe' : 'engineExe';
    const deck = mode === 'starter' ? receipt.starterPath : receipt.enginePath;
    assert.equal(hash(await readFile(deck)), mode === 'starter' ? receipt.starterSha256 : receipt.engineSha256);
    assert.equal(hash(await readFile(receipt.binaryPaths[key])), receipt.binarySha256[mode]);
    const args = ['-i', `${name}_${mode === 'starter' ? '0000' : '0001'}.rad`];
    if (mode === 'starter') args.push('-np', '1');
    await save(directory, `${mode}-launch.json`, { args, timestamp: new Date().toISOString(),
      deckDigest: hash(await readFile(deck)), runtimeDigest: receipt.binarySha256[mode], retryProhibited: true }, true);
    const result = spawnSync(receipt.binaryPaths[key], args, { cwd: directory, env,
      windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
    await writeFile(join(directory, `${mode}.stdout.txt`), result.stdout ?? Buffer.alloc(0));
    await writeFile(join(directory, `${mode}.stderr.txt`), result.stderr ?? Buffer.alloc(0));
    const exit = { exitCode: result.status, signal: result.signal, error: result.error?.message ?? null };
    await save(directory, `${mode}-exit.json`, exit, true);
    console.log(JSON.stringify({ mode, ...exit }));
    if (result.status !== 0 || result.error) throw new Error(`${mode} failed; no retry permitted`);
  } else if (mode === 'admit') {
    const exit = JSON.parse(await readFile(join(directory, 'starter-exit.json'), 'utf8'));
    assert.equal(exit.exitCode, 0); assert.equal(exit.error, null);
    const listing = await readFile(join(directory, `${name}_0000.out`), 'utf8');
    assert.match(listing, /NORMAL TERMINATION/); assert.match(listing, /0 ERROR\(S\)/); assert.match(listing, /0 WARNING\(S\)/);
    assert.match(listing, /INPUT UNIT SYSTEM[^\n]*\( Mg , mm , s\s*\)/);
    assert.match(listing, /TETRA4 FORMULATION FLAG[^\n]*1000/);
    assert.ok((await stat(join(directory, `${name}_0000_0001.rst`))).size > 0);
    const nodalSection = listing.split('NODAL TIME STEP (estimation)')[1]?.split('NODAL TIME STEP DISTRIBUTION')[0];
    assert.ok(nodalSection);
    const estimates = [...nodalSection.matchAll(/^\s*([\d.]+E[+-]\d+)\s+(\d+)\s*$/gm)].map(m => Number(m[1]));
    assert.ok(estimates.length > 0 && estimates.every(v => Number.isFinite(v) && v > 0));
    const criticalNodalEstimateS = Math.min(...estimates);
    const selectedEstimatedStepS = 0.9 * criticalNodalEstimateS;
    const expectedCycles = Math.floor(receipt.time.durationS / selectedEstimatedStepS) + 1;
    assert.ok(expectedCycles <= 20000 && selectedEstimatedStepS < criticalNodalEstimateS);
    assert.equal(hash(await readFile(receipt.enginePath)), receipt.engineSha256);
    await save(directory, 'engine-admission.json', { pass: true,
      authority: 'fresh OpenRadioss Starter actual retained-mesh nodal estimate; not CalculiX CFL',
      criticalNodalEstimateS, selectedEstimatedStepS, expectedCycles, maximumIncrements: 20000,
      mesh: receipt.mesh, noMassScaling: '/DT/NODA 0.9 0; no CST/AMS/minimum',
      starterListingDigest: hash(listing), engineDeckDigest: receipt.engineSha256 }, true);
    console.log(JSON.stringify({ pass: true, criticalNodalEstimateS, selectedEstimatedStepS, expectedCycles }));
  } else if (mode === 'recover') {
    const exit = JSON.parse(await readFile(join(directory, 'engine-exit.json'), 'utf8'));
    assert.equal(exit.exitCode, 0); assert.equal(exit.error, null);
    const listing = await readFile(join(directory, `${name}_0001.out`), 'utf8');
    assert.match(listing, /NORMAL TERMINATION/);
    const completedCycles = Number(listing.match(/TOTAL NUMBER OF CYCLES\s*:\s*(\d+)/)?.[1]);
    assert.ok(completedCycles > 0 && completedCycles <= 20000);
    const path = join(directory, `${name}T01`), bytes = await readFile(path);
    await save(directory, 'authenticated-output-receipt.json', { digest: hash(bytes), bytes: bytes.length,
      engineListingDigest: hash(listing), completedCycles, engineExit: exit }, true);
    const history = parseBoundedOpenRadiossTFile4(bytes, receipt.time.durationS, {
      method: 'frozen-2026-cycle-trace', cycleTrace: await readFile(join(directory, 'engine.stdout.txt'), 'utf8'),
      historyIntervalS: receipt.time.historyIntervalS,
      engineExitCode: 0, normalTermination: true, completedCycles });
    const evaluation = evaluateAxialWaveHistory(history, receipt.faces.forceByNode);
    const max = (values: number[]) => Math.max(...values.map(Math.abs));
    const fixed = history.frames.flatMap(f => receipt.faces.fixed.nodeIds.map((id: number) => f.nodes.get(id)!));
    const pre = evaluation.events.preArrival.map(i => evaluation.series[i].reactionN);
    const plateau = evaluation.events.plateau.map(i => evaluation.series[i].reactionN);
    const mass = history.frames.map(f => f.global.massMg);
    const report = { pass: evaluation.pass, evidence: 'real standalone axial analytical validation',
      directory, sourceReceipt: receipt, reference: axialWaveReference(),
      starterExit: JSON.parse(await readFile(join(directory, 'starter-exit.json'), 'utf8')),
      engineExit: exit, completedCycles, t01Digest: history.sha256, thicode: history.thicode,
      firstTimeS: history.frames[0].timeS, lastTimeS: history.frames.at(-1)!.timeS,
      frameCount: history.frames.length, coverage: history.coverage,
      timestepRangeS: [Math.min(...history.frames.map(f => f.global.timestepS)), Math.max(...history.frames.map(f => f.global.timestepS))],
      evaluation, measured: { transit: evaluation.series[evaluation.events.nearTransit],
        return: evaluation.series[evaluation.events.nearReturn], preArrivalMaximumN: max(pre),
        plateauMinimumN: Math.min(...plateau), plateauMaximumN: Math.max(...plateau),
        fixedMaxima: { dxMm: max(fixed.map(n => n.dxMm)), vxMmPerS: max(fixed.map(n => n.vxMmPerS)), axMmPerS2: max(fixed.map(n => n.axMmPerS2)) },
        massRangeMg: [Math.min(...mass), Math.max(...mass)], massVariationMg: Math.max(...mass) - Math.min(...mass),
        massRelativeError: Math.abs(mass[0] - axialWaveReference().massMg) / axialWaveReference().massMg },
      frames: history.frames.map(f => ({ timeS: f.timeS, global: f.global, nodes: [...f.nodes].map(([id, n]) => ({ id, ...n })) })) };
    assert.equal(hash(await readFile(path)), history.sha256);
    await save(directory, 'analytical-validation-report.json', report, true);
    console.log(JSON.stringify(report));
  } else throw new Error('Expected prepare/starter/admit/engine/recover stage');
}
