// No solver: authenticate retained histories, diagnose raw impulses/stencils.
// Never changes v1, thresholds, differentiation, production admission or results.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parseBoundedOpenRadiossTFile4 } from '../simulation-bridge/openRadiossBinaryTFileParser.mts';
import { differentiateVerifiedReactionImpulse } from '../simulation-bridge/openRadiossBinaryHistoryRecovery.mts';
import { AXIAL_BAR, AXIAL_ORACLE_DIGEST, evaluateAxialWaveHistory } from '../simulation-bridge/openRadiossAxialBarOracle.mts';
const fixed = [1, 2, 3, 4, 45], loaded = [5, 6, 7, 8, 46], name = 'ExplicitBarProbe';
const hash = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const json = async (dir: string, file: string) => JSON.parse(await readFile(join(dir, file), 'utf8'));
const b = AXIAL_BAR, rho = b.densityMgPerMm3, E = b.youngsModulusMPa, nu = b.poissonRatio;
const muMPa = E / (2 * (1 + nu)), lambdaMPa = E * nu / ((1 + nu) * (1 - 2 * nu));
const cRod = Math.sqrt(E / rho), cP = Math.sqrt((lambdaMPa + 2 * muMPa) / rho), cS = Math.sqrt(muMPa / rho);
const waves = { units: 'Mg-mm-s: MPa / (Mg/mm3) = mm2/s2', E, nu, rho, muMPa, lambdaMPa,
  rod: { speedMmPerS: cRod, transitS: b.lengthMm / cRod },
  p: { speedMmPerS: cP, transitS: b.lengthMm / cP },
  shear: { speedMmPerS: cS, transitS: b.lengthMm / cS } };
assert.ok(cP > cRod && cRod > cS);
assert.ok(Math.abs(cP ** 2 - E * (1 - nu) / (rho * (1 + nu) * (1 - 2 * nu))) / cP ** 2 < 1e-15);
// Independent SI dimensional cross-check, not copied historical timing values.
assert.ok(Math.abs(cRod / 1000 - Math.sqrt(E * 1e6 / (rho * 1e12))) < 1e-10);
assert.ok(Math.abs(waves.rod.transitS - 19.748417658131497e-6) < 1e-18);
// I=F*t => N.s/s=N for endpoint and nonuniform centered stencils.
const syntheticTimes = [0, 1e-6, 2.5e-6, 4e-6];
assert.ok(differentiateVerifiedReactionImpulse(syntheticTimes, syntheticTimes.map(t => 100*t))
  .every(r => Math.abs(r.derivedReactionN - 100) < 1e-12));
// A centered stencil labels later impulse change at an earlier frame.
const onset = differentiateVerifiedReactionImpulse([0, 1e-6, 2e-6], [0, 0, -100e-6]);
assert.equal(onset[1].rawImpulseNs, 0);
assert.ok(Math.abs(onset[1].derivedReactionN+50) <= 4*Number.EPSILON*50);
assert.throws(() => differentiateVerifiedReactionImpulse([0, 1e-6], [0, NaN]));
const inputs = [
  { level: 'coarse', dir: process.env.TUNACAD_OPENRADIOSS_COARSE_DIR,
    t01: '9820d44c10179aa4bb838500abc86c856a2e275c0bd134bd8d1d255d0b8a2c46',
    trace: '69ccd1325d08a004434dcd208bab02607d1b46ac4ea83638f82e561d9d1aa5ca',
    report: 'source-backed-analytical-validation-report.json' },
  { level: 'medium', dir: process.env.TUNACAD_OPENRADIOSS_MEDIUM_SOURCE_DIR,
    t01: 'a679deb05ab2476afce7fe12d8c4eed5aaf7784065a497b68d24ff61972be559',
    trace: '66d1058c2e83c14178a07c31bde6b43f80981b3e3e1e86ba0e2026e3060885b2',
    report: 'medium-validation-report.json' },
  { level: 'fine', dir: process.env.TUNACAD_OPENRADIOSS_VALIDATION_DIR,
    t01: 'e54941f8330344ebd6e5ada798a2f30e1d6b7d52783a5536235b2e113a5dfa4d',
    trace: '380563f3aa1c87d09e98b7e6da95d2f42e9b8d3fcfbf38ab183434afbfa1de04',
    report: 'fine-validation-report.json' },
];
const runs = [];
for (const input of inputs) {
  assert.ok(input.dir);
  const receipt = await json(input.dir, 'pre-dispatch-receipt.json');
  const report = await json(input.dir, input.report);
  assert.equal(receipt.oracleDigest, AXIAL_ORACLE_DIGEST);
  assert.deepEqual(receipt.faces.fixed.nodeIds, fixed); assert.deepEqual(receipt.faces.loaded.nodeIds, loaded);
  const bytes = await readFile(join(input.dir, `${name}T01`));
  const trace = await readFile(join(input.dir, 'engine.stdout.txt'), 'utf8');
  assert.equal(hash(bytes), input.t01); assert.equal(hash(trace), input.trace);
  const engineExit = await json(input.dir, 'engine-exit.json'); assert.equal(engineExit.exitCode, 0);
  const listing = await readFile(join(input.dir, `${name}_0001.out`), 'utf8');
  assert.match(listing, /NORMAL TERMINATION/);
  const completedCycles = Number(listing.match(/TOTAL NUMBER OF CYCLES\s*:\s*(\d+)/)?.[1]);
  if (input.level !== 'coarse') {
    const pinBytes = await readFile(join(input.dir, 'engine-output-provenance.json'));
    assert.equal(hash(pinBytes), report.contemporaneousEngineProvenanceDigest);
    const pin = JSON.parse(pinBytes.toString()); assert.equal(pin.capturedBeforeInterpretation, true);
    assert.equal(pin.attemptId, receipt.attemptId); assert.equal(pin.studyId, receipt.studyId);
    assert.equal(pin.stdoutDigest, input.trace);
    for (const artifact of pin.artifacts) {
      assert.equal(artifact.path, join(input.dir, artifact.name));
      const current = await readFile(artifact.path);
      assert.equal(current.length, artifact.bytes); assert.equal(hash(current), artifact.sha256);
    }
  }
  const history = parseBoundedOpenRadiossTFile4(bytes, 50e-6, { method: 'frozen-2026-cycle-trace',
    cycleTrace: trace, completedCycles, historyIntervalS: 1e-6, engineExitCode: 0, normalTermination: true });
  const evaluation = evaluateAxialWaveHistory(history, receipt.faces.forceByNode);
  assert.deepEqual(evaluation.gates, input.level === 'coarse' ? report.evaluation.gates : report.summary.gates);
  const rows = history.frames.map((frame, i, frames) => {
    const lo = i === 0 ? 0 : i-1, hi = i === frames.length-1 ? i : i+1;
    const before = frames[lo], after = frames[hi], previous = frames[Math.max(0, i-1)];
    const nodeRows = fixed.map(id => {
      const n = frame.nodes.get(id)!;
      const impulseIncrementNs = n.reactionImpulseNs - previous.nodes.get(id)!.reactionImpulseNs;
      const backwardForceN = i === 0 ? null : impulseIncrementNs / (frame.timeS - previous.timeS);
      const forwardForceN = i === frames.length-1 ? null :
        (after.nodes.get(id)!.reactionImpulseNs - n.reactionImpulseNs) / (after.timeS - frame.timeS);
      assert.equal(n.reactionForceN,
        (after.nodes.get(id)!.reactionImpulseNs - before.nodes.get(id)!.reactionImpulseNs) / (after.timeS - before.timeS));
      return { id, rawImpulseNs: n.reactionImpulseNs, impulseIncrementNs, reactionForceN: n.reactionForceN,
        backwardForceN, forwardForceN,
        stencil: i === 0 ? 'forward' : i === frames.length-1 ? 'backward' : 'centered',
        stencilTimesS: [before.timeS, after.timeS], stencilImpulsesNs: [before.nodes.get(id)!.reactionImpulseNs,
          after.nodes.get(id)!.reactionImpulseNs], dxMm: n.dxMm, vxMmPerS: n.vxMmPerS, axMmPerS2: n.axMmPerS2 };
    });
    const sum = (key: 'rawImpulseNs' | 'impulseIncrementNs' | 'reactionForceN') => nodeRows.reduce((s, n) => s+n[key], 0);
    const summed = { rawImpulseNs: sum('rawImpulseNs'), impulseIncrementNs: sum('impulseIncrementNs'),
      reactionForceN: sum('reactionForceN'),
      backwardForceN: i === 0 ? null : sum('impulseIncrementNs') / (frame.timeS-previous.timeS),
      forwardForceN: nodeRows[0].forwardForceN === null ? null : nodeRows.reduce((s,n) => s+n.forwardForceN!,0) };
    return { frame: i, timeS: frame.timeS, nodes: nodeRows, summed, global: frame.global,
      loadedMotion: loaded.map(id => ({ id, ...frame.nodes.get(id)! })) };
  });
  const first = (predicate: (r: typeof rows[number]) => boolean) => rows.find(predicate) ?? null;
  // "Material" onset is an observational diagnostic, not a new PASS gate:
  // reuse v1's 10 N scale as |delta I|/delta t. Also preserve earliest exact nonzero.
  const firstRawNonzero = first(r => r.summed.rawImpulseNs !== 0);
  const firstMaterialImpulseInterval = first(r => r.summed.backwardForceN !== null && Math.abs(r.summed.backwardForceN) > 10);
  const firstDerivedAbove10 = first(r => Math.abs(r.summed.reactionForceN) > 10);
  const firstDerivedBelowMinus50 = first(r => r.summed.reactionForceN <= -50);
  const events = [firstRawNonzero, firstMaterialImpulseInterval, firstDerivedAbove10, firstDerivedBelowMinus50]
    .map(r => r === null ? null : ({ frame: r.frame, timeS: r.timeS, ...r.summed }));
  const critical = rows.filter(r => r.timeS >= 14e-6 && r.timeS <= 22e-6);
  const last = history.frames.at(-1)!;
  runs.push({ level: input.level, t01Sha256: input.t01, cycleTraceSha256: input.trace,
    oracleV1Pass: evaluation.pass, v1Gates: evaluation.gates,
    v1GuardS: evaluation.events.guardS, v1PreArrivalCutoffS: waves.rod.transitS-evaluation.events.guardS,
    firstRawNonzero: events[0], firstMaterialImpulseInterval: events[1], firstDerivedAbove10: events[2],
    firstDerivedBelowMinus50: events[3],
    perNodeFirstNonzero: fixed.map(id => ({ id, first: rows.find(r => r.nodes.find(n => n.id===id)!.rawImpulseNs !== 0)?.timeS ?? null })),
    perNodeFirstMaterialImpulseInterval: fixed.map(id => ({ id, first: rows.find(r => {
      const n = r.nodes.find(n => n.id===id)!; return n.backwardForceN !== null && Math.abs(n.backwardForceN) > 10/5;
    })?.timeS ?? null, interpretation: 'equal-share 10 N diagnostic scale, not an acceptance criterion' })),
    critical, coverage: history.coverage, maximumEnergyResidual: evaluation.gates.energyBalance.maximumResidual,
    firstMassMg: history.frames[0].global.massMg, lastMassMg: last.global.massMg,
    firstAddedMassMg: history.frames[0].global.addedMassMg, lastAddedMassMg: last.global.addedMassMg,
    abnormalListingLines: listing.split(/\r?\n/).filter(line => /\b(?:ERROR|WARNING|NaN|Infinity|INSTABILITY)\b/i.test(line)),
    frames: rows });
  assert.equal(hash(await readFile(join(input.dir, `${name}T01`))), input.t01);
}
assert.equal(runs[2].oracleV1Pass, false); assert.equal(runs[2].v1Gates.preArrivalReaction.pass, false);
const failed = runs[2].frames.find(r => r.timeS === 1.7036447388818488e-5)!;
assert.ok(failed); assert.equal(failed.summed.reactionForceN, -15.164045461210522);
const stencil = failed.nodes[0].stencilTimesS;
const backwardDurationS = failed.timeS-stencil[0], forwardDurationS = stencil[1]-failed.timeS;
const decomposition = { frameTimeS: failed.timeS, pArrivalDeltaS: failed.timeS-waves.p.transitS,
  stencilTimesS: stencil, backwardForceN: failed.summed.backwardForceN,
  forwardForceN: failed.summed.forwardForceN,
  backwardContributionN: failed.summed.backwardForceN!*backwardDurationS/(backwardDurationS+forwardDurationS),
  forwardContributionN: failed.summed.forwardForceN!*forwardDurationS/(backwardDurationS+forwardDurationS),
  centeredForceN: failed.summed.reactionForceN, perNode: failed.nodes };
assert.ok(Math.abs(decomposition.backwardContributionN+decomposition.forwardContributionN-decomposition.centeredForceN) < 1e-12);
const result = { evidence: 'no-solver retained authentic T01 diagnosis; v1 unchanged', waves,
  oracleV1Digest: AXIAL_ORACLE_DIGEST, historicalV1Study: 'FAILED', decomposition,
  onsetDefinitions: { exact: 'first exact nonzero raw impulse; not a physical arrival claim',
    material: '|delta raw summed impulse / delta actual frame time| > existing 10 N diagnostic scale',
    perNode: 'existing 10 N divided equally over five nodes for observation only; not a new gate' },
  runs, tests: 'wave dimensional checks, constant-force and anticipatory-stencil assertions, authentic three-level parsing/coverage, exact per-node derivative equality, final T01 digests',
  noSolverRan: true, engineeringUsePermitted: false, providerAdmission: 'closed' };
assert.ok(inputs[2].dir);
await writeFile(join(inputs[2].dir, 'reaction-onset-diagnostic.json'), JSON.stringify(result, null, 2)+'\n', { flag: 'wx' });
console.log(JSON.stringify({ ...result, runs: runs.map(r => ({ ...r, frames: undefined, critical: undefined,
  coverage: { ...r.coverage, expectedOutputs: undefined, sampledCycles: undefined } })) }));
