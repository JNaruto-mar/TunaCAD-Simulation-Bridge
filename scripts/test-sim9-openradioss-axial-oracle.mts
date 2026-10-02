// Controlled mathematical histories only: no solver and no retained T01 mutation.
import assert from 'node:assert/strict';
import { AXIAL_BAR, AXIAL_VALIDATION_PLAN as plan, AXIAL_ORACLE_DIGEST,
  axialWaveReference, firstCycleWaveSample, normalizedEnergyResidual,
  selectAxialWaveEvents, evaluateAxialWaveHistory, diagnoseAxialWaveFrames } from '../simulation-bridge/openRadiossAxialBarOracle.mts';
type History = Parameters<typeof evaluateAxialWaveHistory>[0];
const r = axialWaveReference();
const close = (a: number, b: number, tolerance = 1e-12) => assert.ok(Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b)));
close(r.massKg, 0.078);
close(r.massMg, 7.8e-5);
close(r.waveSpeedMmPerS, 1000 * Math.sqrt(200000 * 1e6 / 7800));
close(r.transitS * r.waveSpeedMmPerS, 100);
close(r.transitS, 19.7484176581315e-6);
close(r.returnS, 39.496835316263e-6);
close(r.staticDisplacementMm, 0.0005);
close(r.returnDisplacementMm, 0.001);
assert.equal(r.supportPlateauN, -200);
for (const fraction of [0, 0.25, 0.9, 1, 1.25, 1.75, 2]) {
  const s = firstCycleWaveSample(fraction * r.transitS);
  close(s.displacementMm, fraction * 0.0005);
  close(s.externalWorkNmm, s.kineticEnergyNmm + s.internalEnergyNmm);
  assert.equal(s.supportReactionN, fraction < 1 ? 0 : -200);
}
close(firstCycleWaveSample(r.transitS).kineticEnergyNmm, 0.025);
close(firstCycleWaveSample(r.transitS).internalEnergyNmm, 0.025);
close(firstCycleWaveSample(r.returnS).kineticEnergyNmm, 0);
close(firstCycleWaveSample(r.returnS).externalWorkNmm, 0.1);
assert.throws(() => firstCycleWaveSample(-1), /outside/);
assert.throws(() => firstCycleWaveSample(r.returnS * 1.01), /outside/);
assert.throws(() => firstCycleWaveSample(NaN), /outside/);
assert.equal(normalizedEnergyResidual(0, 0, 0), 0);
assert.ok(Number.isFinite(normalizedEnergyResidual(0, 1e-14, 0)));
close(normalizedEnergyResidual(1, 0.5, 0.5), 0);
close(normalizedEnergyResidual(1, 0.4, 0.4), 0.2);
assert.throws(() => normalizedEnergyResidual(NaN, 0, 0), /non-finite/);
const times = Array.from({ length: 51 }, (_, i) => i * plan.historyIntervalS);
const dt = 4.791501169165713e-7;
const events = selectAxialWaveEvents(times, dt);
assert.equal(events.beforeTransit, 19);
assert.equal(events.nearTransit, 20);
assert.equal(events.afterTransit, 20);
assert.equal(events.nearReturn, 39);
assert.ok(events.plateau.length >= 3);
assert.ok(events.plateau.every(i => times[i] > r.transitS && times[i] < r.returnS));
assert.throws(() => selectAxialWaveEvents(times.slice(0, 30), dt), /coverage/);
assert.throws(() => selectAxialWaveEvents(times.filter((_, i) => i !== 20), dt), /interval/);
assert.throws(() => selectAxialWaveEvents([0, 1e-6, 1e-6], dt), /ordered/);
assert.throws(() => selectAxialWaveEvents(times, plan.historyIntervalS), /timestep/);
const nodes = [1, 2, 3, 4, 5, 6, 7, 8, 45, 46];
const fixed = [1, 2, 3, 4, 45];
const weights = [5, 6, 7, 8, 46].map(id => ({ id, forceN: 20 }));
function mathematicalHistory(): History {
  return {
    format: 'controlled mathematical oracle test, not provider evidence', thicode: 3040,
    nodeIds: [1, 2, 3, 4, 5, 6, 7, 8, 45, 46], channelCodes: [1, 4, 7, 620],
    sha256: '0'.repeat(64), reactionProvenance: 'raw REACX impulse N.s; TunaCAD dI/dt force N',
    coverage: { rule: 'frozen-2026-constant-step', complete: true, requestedStopS: plan.durationS, sampledCycles: [],
      lastEvaluatedCycle: 104, nextDueTimeS: plan.durationS, nextOutputCycle: 105,
      nextOutputTimeBoundsS: [50.31e-6, 50.32e-6], nextOutputTimeS: 50.315e-6,
      forcedFinalSample: false, roundingPolicy: 'IEEE32 representable rounding cells; no arbitrary tolerance' },
    frames: times.map(timeS => {
      // Beyond 2T this synthetic continuation supplies balance only; no 3D evidence.
      const first = timeS <= r.returnS ? firstCycleWaveSample(timeS) : null;
      const dx = first?.displacementMm ?? r.staticDisplacementMm * (4 - timeS / r.transitS);
      const work = AXIAL_BAR.forceN * dx;
      const reaction = timeS < r.transitS ? 0 : -200;
      return { timeS, global: { rawOrderedValues: Array(22).fill(0),
        kineticEnergyNmm: first?.kineticEnergyNmm ?? 0,
        internalEnergyNmm: first?.internalEnergyNmm ?? work,
        externalWorkNmm: work, massMg: r.massMg, addedMassMg: 0,
        addedMassChangeFromInitializationMg: 0, timestepS: dt },
      nodes: new Map(nodes.map(id => [id, { dxMm: fixed.includes(id) ? 0 : dx,
        vxMmPerS: 0, axMmPerS2: 0,
        reactionImpulseNs: fixed.includes(id) ? -200 * Math.max(0, timeS - r.transitS) / 5 : 0,
        reactionForceN: fixed.includes(id) ? reaction / 5 : 0 }])) };
    }),
  };
}
const valid = evaluateAxialWaveHistory(mathematicalHistory(), weights);
assert.equal(valid.pass, true);
assert.equal(valid.oracleDigest, AXIAL_ORACLE_DIGEST);
assert.equal(valid.providerAdmission, 'closed');
const diagnostic = diagnoseAxialWaveFrames(mathematicalHistory().frames, weights);
assert.deepEqual(diagnostic.gates, valid.gates);
assert.equal(diagnostic.physicalGatesPass, true);
assert.equal(diagnostic.pass, false);
assert.equal(diagnostic.completedResultAccepted, false);
const corrupt = (mutate: (h: History) => void) => { const h = mathematicalHistory(); mutate(h); return evaluateAxialWaveHistory(h, weights); };
assert.equal(corrupt(h => h.frames.forEach(f => f.nodes.get(1)!.dxMm = 1e-3)).gates.fixedMotion.pass, false);
assert.equal(corrupt(h => h.frames[0].nodes.get(5)!.vxMmPerS = 1).gates.zeroInitialConditions.pass, false);
assert.equal(corrupt(h => h.frames.forEach(f => fixed.forEach(id => f.nodes.get(id)!.reactionForceN = 40))).gates.plateauReaction.pass, false);
assert.equal(corrupt(h => h.frames.forEach(f => fixed.forEach(id => f.nodes.get(id)!.reactionForceN = 0))).gates.waveArrival.pass, false);
assert.equal(corrupt(h => h.frames[1].nodes.get(1)!.reactionForceN = -50).gates.preArrivalReaction.pass, false);
assert.equal(corrupt(h => h.frames.forEach(f => f.global.kineticEnergyNmm = 1)).gates.energyBalance.pass, false);
assert.equal(corrupt(h => h.frames.forEach(f => f.nodes.get(5)!.dxMm *= 10)).gates.appliedWork.pass, false);
assert.equal(corrupt(h => h.frames[10].global.massMg *= 1.01).gates.massConservation.pass, false);
assert.equal(corrupt(h => h.frames[10].global.addedMassMg = 1e-10).gates.noAddedMass.pass, false);
assert.equal(corrupt(h => h.frames.forEach(f => f.global.addedMassMg = -1e-10)).gates.noAddedMass.pass, false);
assert.equal(corrupt(h => [5, 6, 7, 8, 46].forEach(id => h.frames[events.nearTransit].nodes.get(id)!.dxMm *= 2))
  .gates.transitDisplacement.pass, false);
assert.equal(corrupt(h => h.frames.forEach(f => fixed.forEach(id => {
  f.nodes.get(id)!.reactionForceN = f.timeS < 30e-6 ? 0 : -40;
}))).gates.waveArrival.pass, false);
assert.equal(corrupt(h => { h.frames[1].global.kineticEnergyNmm = -0.001;
  h.frames[1].global.internalEnergyNmm = h.frames[1].global.externalWorkNmm + 0.001; })
  .gates.energyBalance.pass, false);
assert.throws(() => evaluateAxialWaveHistory(mathematicalHistory(), weights.slice(1)), /weights/);
const incomplete = mathematicalHistory(); incomplete.coverage = undefined;
assert.throws(() => evaluateAxialWaveHistory(incomplete, weights), /coverage/);
const nonfinite = mathematicalHistory(); nonfinite.frames[0].global.externalWorkNmm = NaN;
assert.throws(() => evaluateAxialWaveHistory(nonfinite, weights), /non-finite/);
console.log(JSON.stringify({ pass: true, evidence: 'mathematical/no-solver', oracleDigest: AXIAL_ORACLE_DIGEST,
  reference: r, futurePlan: plan, sampleSelection: events, syntheticGates: valid.gates }));
