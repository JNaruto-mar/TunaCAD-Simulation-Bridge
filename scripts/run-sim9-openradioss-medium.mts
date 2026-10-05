// Separately approved medium/fine fixture admission/recovery; medium preparation.
// Starter/Engine launches reuse the write-once standalone provenance runners.
// No retry, converter, remesh or production admission.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseBoundedOpenRadiossTFile4 } from './referenceTFileReader.mts';
import { readOpenRadiossCycleTrace } from '../simulation-bridge/openRadiossHistoryCoverage.mts';
import { readBoundedStarterConcentratedLoads, verifyRetainedStarterArtifactPin } from '../simulation-bridge/openRadiossStarterLoads.mts';
import { AXIAL_ORACLE_DIGEST, AXIAL_VALIDATION_PLAN } from '../simulation-bridge/openRadiossAxialBarOracle.mts';
import { TIMESTEP_SENSITIVITY_DIGEST, estimateTimeStepLevels,
  summarizeTimeStepHistory, compareTimeStepSensitivity, normalizedTimeStepDifference } from '../simulation-bridge/openRadiossTimeStepSensitivity.mts';

const mode = process.argv[2], name = 'ExplicitBarProbe';
// Fine is a separately approved isolated fixture, never inferred by the plan.
const level = process.env.TUNACAD_OPENRADIOSS_TIMESTEP_LEVEL ?? 'medium';
assert.ok(level === 'medium' || level === 'fine');
const scale = level === 'fine' ? 0.4 : 0.6;
const baseline = process.env.TUNACAD_OPENRADIOSS_COARSE_DIR;
const directory = process.env.TUNACAD_OPENRADIOSS_VALIDATION_DIR;
assert.ok(baseline, 'Authenticated coarse directory required; no regeneration');
const hash = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const json = async (dir: string, file: string) => JSON.parse(await readFile(join(dir, file), 'utf8'));
const save = async (dir: string, file: string, value: unknown) =>
  writeFile(join(dir, file), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const coarseReceipt = await json(baseline, 'pre-dispatch-receipt.json');
const coarseReport = await json(baseline, 'source-backed-analytical-validation-report.json');
const coarseBytes = await readFile(join(baseline, `${name}T01`));
const coarseTrace = await readFile(join(baseline, 'engine.stdout.txt'), 'utf8');
const coarseStarter = await readFile(join(baseline, `${name}_0000.rad`), 'utf8');
const coarseEngine = await readFile(join(baseline, `${name}_0001.rad`), 'utf8');
assert.equal(hash(coarseBytes), '9820d44c10179aa4bb838500abc86c856a2e275c0bd134bd8d1d255d0b8a2c46');
assert.equal(hash(coarseTrace), '69ccd1325d08a004434dcd208bab02607d1b46ac4ea83638f82e561d9d1aa5ca');
assert.equal(hash(coarseStarter), coarseReceipt.starterSha256);
assert.equal(hash(coarseEngine), coarseReceipt.engineSha256);
assert.equal(coarseReport.pass, true); assert.equal(coarseReceipt.oracleDigest, AXIAL_ORACLE_DIGEST);
assert.equal(coarseReceipt.time.durationS, 50e-6); assert.equal(coarseReceipt.time.historyIntervalS, 1e-6);
assert.deepEqual([coarseReceipt.mesh.nodes, coarseReceipt.mesh.elements], [88, 208]);
assert.deepEqual(coarseReceipt.material, { E_MPa: 200000, nu: 0.3, density_Mg_mm3: 7.8e-9 });
assert.deepEqual(coarseReceipt.faces.fixed.nodeIds, [1, 2, 3, 4, 45]);
assert.equal(coarseReceipt.faces.forceSumN, 100);
assert.equal(hash(await readFile(coarseReceipt.sourceFrd)), coarseReceipt.sourceSha256);
const oldControl = '/DT/NODA\n   9.000000000000e-1   0.000000000000e+0';
const newControl = `/DT/NODA\n   ${level === 'fine' ? '4' : '6'}.000000000000e-1   0.000000000000e+0`;
assert.equal(coarseEngine.split(oldControl).length, 2);
const mediumEngine = coarseEngine.replace(oldControl, newControl);
assert.equal(mediumEngine.replace(newControl, oldControl), coarseEngine);
assert.doesNotMatch(coarseStarter + mediumEngine, /\/(?:AMS|ADMAS|DAMP|DYREL|KEREL|INTER|INIVEL|IMPLICIT|DT\/[^\r\n]*\/(?:CST|AMS|DEL|SET))/i);
const binding = (scale: number) => ({ starterDeckSha256: hash(coarseStarter), retainedMeshSha256: coarseReceipt.sourceSha256,
  starterRuntimeSha256: coarseReceipt.binarySha256.starter, engineRuntimeSha256: coarseReceipt.binarySha256.engine,
  dtNodaScale: scale, minimumTimestepS: 0 as const, starterExitCode: 0 as const, engineExitCode: 0 as const });
const coarseHistory = parseBoundedOpenRadiossTFile4(coarseBytes, 50e-6, {
  method: 'frozen-2026-cycle-trace', cycleTrace: coarseTrace, historyIntervalS: 1e-6,
  completedCycles: coarseReport.cycleCount, engineExitCode: 0, normalTermination: true });
const coarse = summarizeTimeStepHistory('coarse', coarseHistory, coarseReceipt.faces.forceByNode,
  coarseReport.cycleCount, binding(0.9));
assert.deepEqual(coarse.gates, coarseReport.evaluation.gates);
assert.equal(coarse.oraclePass, true);

if (mode === 'prepare') {
  assert.equal(level, 'medium', 'Fine preparation requires the provenance wrapper');
  for (const key of ['starter', 'engine'] as const) {
    const exe = coarseReceipt.binaryPaths[`${key}Exe`];
    assert.ok((await stat(exe)).isFile());
    assert.equal(hash(await readFile(exe)), coarseReceipt.binarySha256[key]);
  }
  const target = await mkdtemp(join(tmpdir(), 'tunacad-openradioss-medium-'));
  await writeFile(join(target, `${name}_0000.rad`), coarseStarter, { flag: 'wx' });
  await writeFile(join(target, `${name}_0001.rad`), mediumEngine, { flag: 'wx' });
  await save(target, 'pre-dispatch-receipt.json', { ...coarseReceipt,
    schema: 'tunacad-openradioss-axial-validation/0.1', evidence: 'one approved medium scale-0.6 run only',
    coarseT01Digest: hash(coarseBytes), coarseTraceDigest: hash(coarseTrace),
    sensitivityPlanDigest: TIMESTEP_SENSITIVITY_DIGEST, level: 'medium',
    starterPath: join(target, `${name}_0000.rad`), enginePath: join(target, `${name}_0001.rad`),
    starterSha256: hash(coarseStarter), engineSha256: hash(mediumEngine),
    time: { ...coarseReceipt.time, control: '/DT/NODA; scale=0.6; minimum=0' },
    changedFieldOnly: '/DT/NODA scale; 0.9 -> 0.6',
    automaticRetry: false, fineRunAuthorized: false, retainAllEvidenceThroughReporting: true });
  console.log(JSON.stringify({ pass: true, directory: target, modelDeckUnchanged: true,
    onlyEngineChange: 'scale 0.9 -> 0.6', coarsePass: true, sensitivityPlanDigest: TIMESTEP_SENSITIVITY_DIGEST }));
} else {
  assert.ok(directory && directory !== baseline);
  const receipt = await json(directory, 'pre-dispatch-receipt.json');
  assert.equal(receipt.level, level); assert.equal(receipt.sensitivityPlanDigest, TIMESTEP_SENSITIVITY_DIGEST);
  assert.equal(hash(await readFile(receipt.starterPath)), hash(coarseStarter));
  assert.equal(hash(await readFile(receipt.enginePath)), hash(mediumEngine));
  assert.equal(receipt.engineSha256, hash(mediumEngine));
  const starterExit = await json(directory, 'starter-exit.json');
  assert.equal(starterExit.exitCode, 0); assert.equal(starterExit.error, null);
  if (mode === 'admit') {
    const listing = await readFile(join(directory, `${name}_0000.out`), 'utf8');
    assert.match(listing, /NORMAL TERMINATION/); assert.match(listing, /0 ERROR\(S\)/); assert.match(listing, /0 WARNING\(S\)/);
    assert.match(listing, /INPUT UNIT SYSTEM[^\n]*\( Mg , mm , s\s*\)/);
    assert.match(listing, /WORK UNIT SYSTEM[^\n]*\( Mg , mm , s\s*\)/);
    const number = (pattern: RegExp) => { const m = listing.match(pattern); assert.ok(m); return Number(m[1]); };
    assert.equal(number(/NUMNOD[^\r\n]*\s(\d+)\s*$/m), 88);
    assert.equal(number(/NUMELS[^\r\n]*\s(\d+)\s*$/m), 208);
    assert.equal(number(/NUMBCS[^\r\n]*\s(\d+)\s*$/m), 1);
    assert.equal(number(/NCONLD[^\r\n]*\s(\d+)\s*$/m), 5);
    assert.equal(number(/INITIAL DENSITY[^\r\n]*=\s*([\d.E+-]+)/), 7.8e-9);
    assert.equal(number(/YOUNG'S MODULUS[^\r\n]*=\s*([\d.E+-]+)/), 200000);
    assert.equal(number(/POISSON'S RATIO[^\r\n]*=\s*([\d.E+-]+)/), 0.3);
    assert.equal(number(/TETRA4 FORMULATION FLAG[^\r\n]*=\s*(\d+)/), 1000);
    assert.match(listing, /Part id,name:\s*1 One elastic bar[^\r\n]*Elm type: TETRA4/);
    const mass = listing.split('TOTAL MASS AND MASS CENTER')[1]?.match(/\r?\n\s*([\d.E+-]+)\s+50/);
    assert.ok(mass); assert.equal(Number(mass[1]), 7.8e-5);
    assert.match(listing, /TOTAL ADDED MASS\s*=\s*0\.000000000000/);
    const interpretedLoads = readBoundedStarterConcentratedLoads(listing, receipt.faces.forceByNode);
    assert.deepEqual(interpretedLoads.loads.map(n => n.nodeId), receipt.faces.loaded.nodeIds);
    // Fixed mapping is the byte-identical previously verified Starter group/BCS.
    assert.match(coarseStarter, /\/GRNOD\/NODE\/1\nFixed x min\n         1         2         3         4        45\n/);
    const restartPath = join(directory, `${name}_0000_0001.rst`);
    const restart = await readFile(restartPath), restartStat = await stat(restartPath);
    assert.ok(restart.length > 0 && restart.length === restartStat.size);
    const launchBytes = await readFile(join(directory, 'starter-launch.json'));
    const exitBytes = await readFile(join(directory, 'starter-exit.json'));
    const launch = JSON.parse(launchBytes.toString('utf8'));
    assert.deepEqual(launch.args, ['-i', `${name}_0000.rad`, '-np', '1']);
    assert.equal(launch.deckDigest, receipt.starterSha256);
    assert.equal(launch.runtimeDigest, receipt.binarySha256.starter);
    for (const key of ['starter', 'engine'] as const)
      assert.equal(hash(await readFile(receipt.binaryPaths[`${key}Exe`])), receipt.binarySha256[key]);
    const retainedBindings = { attemptDigest: hash(Buffer.concat([
      await readFile(join(directory, 'pre-dispatch-receipt.json')), launchBytes, exitBytes])),
      starterListingDigest: hash(listing), restartDigest: hash(restart),
      starterDeckDigest: receipt.starterSha256, engineDeckDigest: receipt.engineSha256,
      runtimeDigest: receipt.binarySha256.starter };
    // Old attempts stay PENDING. Accept only the new Starter wrapper's immediate
    // OS-return capture, bound to the same pre-launch/launch/exit attempt chain.
    let originalPin;
    let outputPin;
    try { outputPin = await json(directory, 'starter-output-receipt.json'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (outputPin) {
      const attemptBytes = await readFile(join(directory, 'attempt-receipt.json'));
      const attempt = JSON.parse(attemptBytes.toString('utf8'));
      assert.equal(outputPin.schema, 'tunacad-openradioss-starter-completion-pin/0.1');
      assert.equal(outputPin.capturedContemporaneously, true);
      assert.equal(outputPin.attemptId, receipt.attemptId); assert.equal(outputPin.studyId, receipt.studyId);
      assert.equal(launch.attemptId, receipt.attemptId);
      assert.equal(outputPin.attemptReceiptDigest, hash(attemptBytes));
      assert.equal(attempt.preparedDigest, hash(await readFile(join(directory, 'pre-dispatch-receipt.json'))));
      assert.equal(attempt.phase, 'starter_terminated_outputs_pinned');
      assert.deepEqual(attempt.prepared, receipt); assert.deepEqual(attempt.execution.exit, starterExit);
      assert.deepEqual(attempt.execution.produced, outputPin.produced);
      assert.deepEqual(outputPin.executionExit, starterExit);
      assert.equal(attempt.execution.stdoutDigest, hash(await readFile(join(directory, 'starter.stdout.txt'))));
      assert.equal(attempt.execution.stderrDigest, hash(await readFile(join(directory, 'starter.stderr.txt'))));
      for (const artifact of outputPin.produced) {
        assert.equal(artifact.path, join(directory, artifact.name));
        const actual = await readFile(artifact.path);
        assert.equal(actual.length, artifact.bytes); assert.equal(hash(actual), artifact.sha256);
      }
      assert.equal(outputPin.produced.find((f: { name: string }) => f.name === `${name}_0000.out`)?.sha256,
        outputPin.pin.starterListingDigest);
      assert.equal(outputPin.produced.find((f: { name: string }) => f.name === `${name}_0000_0001.rst`)?.sha256,
        outputPin.pin.restartDigest);
      originalPin = outputPin.pin;
    }
    const artifactBinding = verifyRetainedStarterArtifactPin(retainedBindings, originalPin);
    const section = listing.split('NODAL TIME STEP (estimation)')[1]?.split('NODAL TIME STEP DISTRIBUTION')[0];
    assert.ok(section);
    const estimates = [...section.matchAll(/^\s*([\d.]+E[+-]\d+)\s+(\d+)\s*$/gm)].map(m => Number(m[1]));
    assert.ok(estimates.length && estimates.every(n => Number.isFinite(n) && n > 0));
    const criticalNodalEstimateS = Math.min(...estimates);
    const planned = estimateTimeStepLevels(criticalNodalEstimateS).find(l => l.level === level)!;
    assert.ok(planned.approximateCycles < 20000);
    // pass is the Engine-launch gate consumed by the existing runner. Remain
    // closed while original restart provenance is incomplete, despite corrected
    // model/load/stability checks all passing.
    const record = { pass: artifactBinding.complete, level,
      interpretedAdmissionState: 'PASS after harness correction', dispatchAdmissionState: artifactBinding.state,
      engineOnlyExecutionJustified: artifactBinding.complete, artifactBinding,
      retainedBindings, starterLaunchDigest: hash(launchBytes), starterExitDigest: hash(exitBytes),
      restartBytes: restart.length, restartCreationTime: restartStat.birthtime.toISOString(),
      restartLastWriteTime: restartStat.mtime.toISOString(),
      checkpointCapturedAfterRun: !outputPin, capturedContemporaneously: Boolean(outputPin),
      noNewStarterExecutionRecord: true,
      originalFailurePreserved: outputPin ? 'previous medium attempt remains untouched' : 'admission-failure.json',
      interpretedLoads, starterExit, normalTermination: true, errors: 0, warnings: 0,
      criticalNodalEstimateS, selectedEstimatedStepS: planned.approximateStepS,
      expectedCycles: planned.approximateCycles, maximumIncrements: 20000,
      authority: 'fresh actual-mesh OpenRadioss Starter nodal estimate', mesh: receipt.mesh,
      units: 'Mg-mm-s', material: receipt.material, totalMassKg: Number(mass[1]) * 1000,
      fixedNodeIds: receipt.faces.fixed.nodeIds, forceSumN: 100,
      noMassScaling: `/DT/NODA ${scale} 0; no CST/AMS/minimum`,
      starterListingDigest: hash(listing), engineDeckDigest: hash(mediumEngine) };
    assert.equal(hash(await readFile(join(directory, `${name}_0000.out`))), retainedBindings.starterListingDigest);
    assert.equal(hash(await readFile(restartPath)), retainedBindings.restartDigest);
    assert.equal(hash(await readFile(join(directory, 'starter-launch.json'))), hash(launchBytes));
    assert.equal(hash(await readFile(join(directory, 'starter-exit.json'))), hash(exitBytes));
    await save(directory, 'engine-admission.json', record);
    console.log(JSON.stringify(record));
  } else if (mode === 'recover') {
    const engineExit = await json(directory, 'engine-exit.json');
    assert.equal(engineExit.exitCode, 0); assert.equal(engineExit.error, null);
    const listing = await readFile(join(directory, `${name}_0001.out`), 'utf8');
    assert.match(listing, /NORMAL TERMINATION/);
    const completedCycles = Number(listing.match(/TOTAL NUMBER OF CYCLES\s*:\s*(\d+)/)?.[1]);
    const bytes = await readFile(join(directory, `${name}T01`));
    const trace = await readFile(join(directory, 'engine.stdout.txt'), 'utf8');
    const provenance = await json(directory, 'engine-output-provenance.json');
    assert.equal(provenance.attemptId, receipt.attemptId); assert.equal(provenance.studyId, receipt.studyId);
    assert.equal(provenance.capturedBeforeInterpretation, true); assert.deepEqual(provenance.exit, engineExit);
    assert.equal(provenance.engineLaunchDigest, hash(await readFile(join(directory, 'engine-launch.json'))));
    assert.equal(provenance.starterAttemptReceiptDigest, hash(await readFile(join(directory, 'attempt-receipt.json'))));
    assert.equal(provenance.stdoutDigest, hash(trace));
    assert.equal(provenance.stderrDigest, hash(await readFile(join(directory, 'engine.stderr.txt'))));
    for (const artifact of provenance.artifacts) {
      assert.equal(artifact.path, join(directory, artifact.name));
      const current = await readFile(artifact.path);
      assert.equal(current.length, artifact.bytes); assert.equal(hash(current), artifact.sha256);
    }
    assert.equal(provenance.artifacts.find((a: { name: string }) => a.name === `${name}T01`)?.sha256, hash(bytes));
    assert.equal(provenance.engineDeckAfterExit.sha256, hash(mediumEngine));
    assert.equal(provenance.engineExeAfterExit.sha256, receipt.binarySha256.engine);
    assert.equal(provenance.restartAfterExit.sha256, (await json(directory, 'engine-readiness.json')).restartDigest);
    await save(directory, 'authenticated-output-receipt.json', { digest: hash(bytes), bytes: bytes.length,
      cycleTraceDigest: hash(trace), engineListingDigest: hash(listing), completedCycles,
      engineExit, engineDeckDigest: hash(mediumEngine), runtimeDigest: receipt.binarySha256.engine });
    const cycles = readOpenRadiossCycleTrace(trace, completedCycles);
    const history = parseBoundedOpenRadiossTFile4(bytes, 50e-6, {
      method: 'frozen-2026-cycle-trace', cycleTrace: trace, historyIntervalS: 1e-6,
      engineExitCode: 0, normalTermination: true, completedCycles });
    const current = summarizeTimeStepHistory(level, history, receipt.faces.forceByNode, completedCycles, binding(scale));
    let medium = current;
    if (level === 'fine') {
      const mediumDirectory = process.env.TUNACAD_OPENRADIOSS_MEDIUM_SOURCE_DIR; assert.ok(mediumDirectory);
      const retained = await json(mediumDirectory, 'medium-validation-report.json');
      assert.equal(retained.mediumDecision, 'MEDIUM_PASS'); assert.equal(retained.oracleDigest, AXIAL_ORACLE_DIGEST);
      assert.equal(hash(await readFile(join(mediumDirectory, 'medium-validation-report.json'))), receipt.sourceMediumReportDigest);
      const mediumBytes = await readFile(join(mediumDirectory, `${name}T01`));
      const mediumTrace = await readFile(join(mediumDirectory, 'engine.stdout.txt'), 'utf8');
      assert.equal(hash(mediumBytes), 'a679deb05ab2476afce7fe12d8c4eed5aaf7784065a497b68d24ff61972be559');
      assert.equal(hash(mediumTrace), retained.cycleTraceSha256);
      const mediumPinBytes = await readFile(join(mediumDirectory, 'engine-output-provenance.json'));
      assert.equal(hash(mediumPinBytes), receipt.sourceMediumOutputPinDigest);
      const mediumPin = JSON.parse(mediumPinBytes.toString());
      assert.equal(mediumPin.artifacts.find((a: { name: string }) => a.name === `${name}T01`)?.sha256, hash(mediumBytes));
      assert.equal(mediumPin.exit.exitCode, 0);
      const mediumHistory = parseBoundedOpenRadiossTFile4(mediumBytes, 50e-6, {
        method: 'frozen-2026-cycle-trace', cycleTrace: mediumTrace, historyIntervalS: 1e-6,
        engineExitCode: 0, normalTermination: true, completedCycles: retained.summary.completedCycles });
      medium = summarizeTimeStepHistory('medium', mediumHistory, receipt.faces.forceByNode,
        retained.summary.completedCycles, binding(0.6));
      assert.deepEqual(medium, retained.summary);
    }
    const outcome = compareTimeStepSensitivity(level === 'fine' ? [coarse, medium, current] : [coarse, medium]);
    if (level === 'medium') {
      assert.notEqual(outcome.conclusion, 'stable'); assert.notEqual(outcome.conclusion, 'sensitive');
    }
    const fields = ['arrivalTimeS', 'transitDisplacementMm', 'returnDisplacementMm', 'plateauMedianN', 'maximumEnergyResidual'] as const;
    const scales = [19.748417658131497e-6, 0.0005, 0.001, 200, 0.15];
    const informationalChanges = fields.map((key, i) => ({ quantity: key, coarse: coarse[key], medium: medium[key],
      ...((coarse[key] === null || medium[key] === null || !Number.isFinite(medium[key]))
        ? { unavailable: true } : normalizedTimeStepDifference(coarse[key]!, medium[key]!, scales[i])) }));
    const fixed = history.frames.flatMap(f => receipt.faces.fixed.nodeIds.map((id: number) => f.nodes.get(id)!));
    const max = (key: 'dxMm' | 'vxMmPerS' | 'axMmPerS2') => Math.max(...fixed.map(n => Math.abs(n[key])));
    const report = { pass: current.oraclePass,
      ...(level === 'fine' ? { fineDecision: current.oraclePass ? 'FINE_PASS' : 'FINE_FAIL' }
        : { mediumDecision: current.oraclePass ? 'MEDIUM_PASS' : 'MEDIUM_FAIL' }),
      studyState: level === 'fine' ? outcome.conclusion.toUpperCase() : medium.oraclePass ? 'PENDING_FINE' : 'FAILED',
      evidence: level === 'fine' ? 'one approved fine attempt; coarse/medium reused; no retry' : 'one approved real medium timestep run; coarse retained; fine not run',
      oracleDigest: AXIAL_ORACLE_DIGEST, planDigest: TIMESTEP_SENSITIVITY_DIGEST,
      attemptId: receipt.attemptId, studyId: receipt.studyId,
      starterExit, engineExit, summary: current, coarseSummary: coarse,
      ...(level === 'fine' ? { mediumSummary: medium, sensitivity: outcome } : { informationalChanges }),
      t01Sha256: history.sha256, cycleTraceSha256: hash(trace), bytes: bytes.length, thicode: history.thicode,
      contemporaneousEngineProvenanceDigest: hash(await readFile(join(directory, 'engine-output-provenance.json'))),
      firstTimeS: history.frames[0].timeS, firstPositiveTimeS: history.frames[1].timeS,
      lastTimeS: history.frames.at(-1)!.timeS, coverage: history.coverage,
      printedCycleTimestepRangeS: [Math.min(...cycles.map(c => c.timestepS)), Math.max(...cycles.map(c => c.timestepS))],
      fixedMaxima: { dxMm: max('dxMm'), vxMmPerS: max('vxMmPerS'), axMmPerS2: max('axMmPerS2') },
      frames: history.frames.map(f => ({ timeS: f.timeS, global: f.global, nodes: [...f.nodes].map(([id, n]) => ({ id, ...n })) })),
      engineeringUsePermitted: false, providerAdmission: 'closed',
      fineRunJustified: medium.oraclePass, fineRunAuthorized: level === 'fine' };
    assert.equal(hash(await readFile(join(directory, `${name}T01`))), history.sha256);
    assert.equal(hash(await readFile(join(baseline, `${name}T01`))), hash(coarseBytes));
    await save(directory, `${level}-validation-report.json`, report);
    console.log(JSON.stringify({ ...report, frames: undefined, coverage: { ...report.coverage, expectedOutputs: undefined } }));
  } else throw new Error('Expected prepare/admit/recover; no launch or retry mode');
}
