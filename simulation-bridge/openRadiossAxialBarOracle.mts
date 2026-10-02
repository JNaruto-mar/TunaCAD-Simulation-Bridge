// Development oracle only. No solver, approval or provider-admission path.
import { digest } from './stableDigest.mts';
import type { parseBoundedOpenRadiossTFile4 } from './openRadiossBinaryTFileParser.mts';
type History = ReturnType<typeof parseBoundedOpenRadiossTFile4>;
const fail = (why: string): never => { throw new Error(`Axial wave oracle: ${why}`); };
const positive = (v: number) => Number.isFinite(v) && v > 0;
const finite = (...values: number[]) => values.every(Number.isFinite);
const fixedIds = [1, 2, 3, 4, 45];
const loadedIds = [5, 6, 7, 8, 46];

export const AXIAL_BAR = Object.freeze({ lengthMm: 100, widthMm: 10, heightMm: 10,
  youngsModulusMPa: 200000, poissonRatio: 0.3, densityMgPerMm3: 7.8e-9, forceN: 100 });
export function axialWaveReference() {
  const b = AXIAL_BAR;
  const areaMm2 = b.widthMm * b.heightMm;
  // Mg mm / s^2 = N, hence MPa/(Mg/mm^3) = mm^2/s^2.
  const waveSpeedMmPerS = Math.sqrt(b.youngsModulusMPa / b.densityMgPerMm3);
  const transitS = b.lengthMm / waveSpeedMmPerS;
  const staticDisplacementMm = b.forceN * b.lengthMm / (areaMm2 * b.youngsModulusMPa);
  return Object.freeze({ areaMm2, massMg: b.densityMgPerMm3 * areaMm2 * b.lengthMm,
    massKg: 1000 * b.densityMgPerMm3 * areaMm2 * b.lengthMm,
    waveSpeedMmPerS, transitS, returnS: 2 * transitS,
    staticDisplacementMm, returnDisplacementMm: 2 * staticDisplacementMm,
    loadedVelocityMmPerS: staticDisplacementMm / transitS,
    incidentStressMPa: b.forceN / areaMm2, supportPlateauN: -2 * b.forceN,
    energyScaleNmm: b.forceN * staticDisplacementMm });
}

/** Exact 1D rod, first cycle only. Reaction is discontinuous at transit.
 * At that exact event use the right-hand reaction; never fit a numerical jump. */
export function firstCycleWaveSample(timeS: number) {
  const r = axialWaveReference();
  if (!Number.isFinite(timeS) || timeS < 0 || timeS > r.returnS) fail('outside first wave cycle');
  const fraction = timeS / r.transitS;
  const displacementMm = r.staticDisplacementMm * fraction;
  const incidentLengthMm = Math.min(AXIAL_BAR.lengthMm, r.waveSpeedMmPerS * timeS);
  const reflectedLengthMm = Math.max(0, r.waveSpeedMmPerS * (timeS - r.transitS));
  const factor = AXIAL_BAR.forceN ** 2 / (2 * r.areaMm2 * AXIAL_BAR.youngsModulusMPa);
  const internalEnergyNmm = factor * (incidentLengthMm + 3 * reflectedLengthMm);
  const kineticEnergyNmm = factor * (incidentLengthMm - reflectedLengthMm);
  return Object.freeze({ timeS, displacementMm,
    supportReactionN: timeS < r.transitS ? 0 : r.supportPlateauN,
    kineticEnergyNmm, internalEnergyNmm, externalWorkNmm: AXIAL_BAR.forceN * displacementMm });
}

// Frozen before the future result. Changing these creates a new oracle version.
export const AXIAL_VALIDATION_PLAN = Object.freeze({
  schema: 'tunacad-openradioss-axial-wave-oracle/0.1',
  durationS: 50e-6, historyIntervalS: 1e-6, maximumFrames: 64,
  expectedFrames: Object.freeze({ minimum: 50, maximum: 51 }),
  maximumIncrements: 20000, interpolation: 'none; earlier sample wins nearest-time ties',
  thresholds: Object.freeze({ arrivalFractionOfTransit: 0.20,
    arrivalTriggerFractionOfPlateau: 0.25, displacementRelative: 0.25,
    preArrivalReactionN: 10, plateauMedianRelative: 0.30,
    plateauIndividualRelative: 0.40, plateauRequiredFraction: 0.75,
    minimumPlateauSamples: 3, fixedDisplacementMm: 1e-9,
    fixedVelocityMmPerS: 1e-5, fixedAccelerationMmPerS2: 1,
    energyResidual: 0.15, appliedWorkResidual: 0.02,
    nearZeroEnergyFraction: 1e-6, massRelative: 1e-6 }),
  status: 'proof_of_concept', engineeringUsePermitted: false, providerAdmission: 'closed',
} as const);
export const AXIAL_ORACLE_DIGEST = digest({ bar: AXIAL_BAR, plan: AXIAL_VALIDATION_PLAN });

export function normalizedEnergyResidual(work: number, kinetic: number, internal: number) {
  if (!finite(work, kinetic, internal)) fail('non-finite energy');
  const floor = axialWaveReference().energyScaleNmm * AXIAL_VALIDATION_PLAN.thresholds.nearZeroEnergyFraction;
  return Math.abs(work - kinetic - internal) / Math.max(Math.abs(work), Math.abs(kinetic + internal), floor);
}

export function selectAxialWaveEvents(times: readonly number[], actualMaximumStepS: number) {
  const r = axialWaveReference(), p = AXIAL_VALIDATION_PLAN;
  if (!positive(actualMaximumStepS) || actualMaximumStepS >= p.historyIntervalS ||
      times.length < 3 || times.length > p.maximumFrames || times[0] !== 0 ||
      times.some((t, i) => !Number.isFinite(t) || t < 0 || (i > 0 && t <= times[i - 1])))
    fail('invalid ordered sampling or timestep');
  const samplingBoundS = p.historyIntervalS + actualMaximumStepS;
  if (times.at(-1)! <= r.returnS || times.some((t, i) => i > 0 && t - times[i - 1] > samplingBoundS * (1 + 1e-6)))
    fail('missing event coverage/history interval'); // IEEE32 comparison allowance, not physics tolerance.
  const nearest = (event: number) => times.reduce((best, t, i) =>
    Math.abs(t - event) < Math.abs(times[best] - event) ? i : best, 0);
  const beforeTransit = times.findLastIndex(t => t < r.transitS);
  const afterTransit = times.findIndex(t => t > r.transitS);
  const nearTransit = nearest(r.transitS), nearReturn = nearest(r.returnS);
  if (beforeTransit < 0 || afterTransit < 0 ||
      Math.abs(times[nearTransit] - r.transitS) > samplingBoundS ||
      Math.abs(times[nearReturn] - r.returnS) > samplingBoundS) fail('events not resolved');
  // Exclude derivative stencils and transition/dispersion zones from plateau.
  const guardS = Math.max(2 * samplingBoundS, 0.10 * r.transitS);
  const preArrival = times.flatMap((t, i) => t <= r.transitS - guardS ? [i] : []);
  const plateau = times.flatMap((t, i) => t >= r.transitS + guardS && t <= r.returnS - guardS ? [i] : []);
  if (!preArrival.length || plateau.length < p.thresholds.minimumPlateauSamples) fail('insufficient plateau/pre-arrival samples');
  return Object.freeze({ beforeTransit, nearTransit, afterTransit, nearReturn,
    preArrival, plateau, samplingBoundS, guardS });
}

/** Call only on authenticated direct-reader output and retained trusted load weights.
 * Pure POC evaluation; it cannot publish/admit a provider result. */
export function evaluateAxialWaveHistory(history: History,
  forceByNode: readonly { id: number; forceN: number }[]) {
  const p = AXIAL_VALIDATION_PLAN;
  // Frame-count range is planning information, not a coverage gate. The
  // authentic reader's source-backed scheduler proof is authoritative.
  if (!history.coverage?.complete || history.coverage.requestedStopS !== p.durationS)
    fail('wrong completed analytical-run coverage');
  return assessFrames(history, forceByNode);
}

/** Unaccepted diagnostic measurements only; cannot certify history coverage. */
export function diagnoseAxialWaveFrames(frames: History['frames'],
  forceByNode: readonly { id: number; forceN: number }[]) {
  const assessment = assessFrames({ frames }, forceByNode);
  return Object.freeze({ ...assessment, physicalGatesPass: assessment.pass, pass: false,
    diagnosticOnly: true, completedResultAccepted: false });
}

function assessFrames(history: Pick<History, 'frames'>,
  forceByNode: readonly { id: number; forceN: number }[]) {
  const r = axialWaveReference(), p = AXIAL_VALIDATION_PLAN, q = p.thresholds;
  if (forceByNode.length !== 5 || forceByNode.some((f, i) => f.id !== loadedIds[i] || !positive(f.forceN)) ||
      Math.abs(forceByNode.reduce((s, f) => s + f.forceN, 0) - AXIAL_BAR.forceN) > 1e-10)
    fail('wrong trusted loaded-FACE weights/resultant');
  const times = history.frames.map(f => f.timeS);
  const maximumStep = Math.max(...history.frames.map(f => f.global.timestepS));
  const events = selectAxialWaveEvents(times, maximumStep);
  const series = history.frames.map(f => {
    if (f.nodes.size !== 10 || [...fixedIds, ...loadedIds].some(id => !f.nodes.has(id))) fail('wrong node ownership');
    const displacementMm = forceByNode.reduce((s, load) => s + load.forceN * f.nodes.get(load.id)!.dxMm, 0) / AXIAL_BAR.forceN;
    const reactionN = fixedIds.reduce((s, id) => s + f.nodes.get(id)!.reactionForceN, 0);
    const g = f.global;
    if (!finite(displacementMm, reactionN, g.kineticEnergyNmm, g.internalEnergyNmm,
      g.externalWorkNmm, g.massMg, g.addedMassMg, g.addedMassChangeFromInitializationMg)) fail('non-finite history');
    const workReferenceNmm = AXIAL_BAR.forceN * displacementMm;
    return { timeS: f.timeS, displacementMm, reactionN,
      energyResidual: normalizedEnergyResidual(g.externalWorkNmm, g.kineticEnergyNmm, g.internalEnergyNmm),
      workResidual: normalizedEnergyResidual(g.externalWorkNmm, 0, workReferenceNmm) };
  });
  const arrivalIndex = series.findIndex(s => s.reactionN <= r.supportPlateauN * q.arrivalTriggerFractionOfPlateau);
  const arrivalErrorS = arrivalIndex < 0 ? Infinity : Math.abs(times[arrivalIndex] - r.transitS);
  const displacementGate = (index: number, targetTime: number, targetMm: number) => {
    const errorMm = Math.abs(series[index].displacementMm - targetMm);
    // Exact first-cycle maximum tip slope bounds event sampling error; no interpolation.
    const limitMm = q.displacementRelative * targetMm
      + r.loadedVelocityMmPerS * Math.abs(times[index] - targetTime);
    return { pass: errorMm <= limitMm, errorMm, limitMm, sampleTimeS: times[index] };
  };
  const plateauValues = events.plateau.map(i => series[i].reactionN).sort((a, b) => a - b);
  const mid = Math.floor(plateauValues.length / 2);
  const medianN = plateauValues.length % 2 ? plateauValues[mid] : (plateauValues[mid - 1] + plateauValues[mid]) / 2;
  const plateauFraction = plateauValues.filter(v => Math.abs(v - r.supportPlateauN)
    <= Math.abs(r.supportPlateauN) * q.plateauIndividualRelative).length / plateauValues.length;
  const allNodesFinite = history.frames.every(f => [...f.nodes.values()].every(n =>
    finite(n.dxMm, n.vxMmPerS, n.axMmPerS2, n.reactionImpulseNs, n.reactionForceN)));
  const gates = {
    finiteState: { pass: allNodesFinite },
    zeroInitialConditions: { pass: [...history.frames[0].nodes.values()].every(n =>
      Math.abs(n.dxMm) <= q.fixedDisplacementMm && Math.abs(n.vxMmPerS) <= q.fixedVelocityMmPerS) },
    waveArrival: { pass: arrivalErrorS <= q.arrivalFractionOfTransit * r.transitS + events.samplingBoundS,
      arrivalErrorS, sampleTimeS: arrivalIndex < 0 ? null : times[arrivalIndex] },
    transitDisplacement: displacementGate(events.nearTransit, r.transitS, r.staticDisplacementMm),
    returnDisplacement: displacementGate(events.nearReturn, r.returnS, r.returnDisplacementMm),
    preArrivalReaction: { pass: events.preArrival.every(i => Math.abs(series[i].reactionN) <= q.preArrivalReactionN) },
    plateauReaction: { pass: Math.abs(medianN - r.supportPlateauN) <= Math.abs(r.supportPlateauN) * q.plateauMedianRelative
      && plateauFraction >= q.plateauRequiredFraction, medianN, plateauFraction },
    fixedMotion: { pass: history.frames.every(f => fixedIds.every(id => {
      const n = f.nodes.get(id)!;
      return Math.abs(n.dxMm) <= q.fixedDisplacementMm && Math.abs(n.vxMmPerS) <= q.fixedVelocityMmPerS
        && Math.abs(n.axMmPerS2) <= q.fixedAccelerationMmPerS2;
    })) },
    energyBalance: { pass: series.every(s => s.energyResidual <= q.energyResidual)
      && history.frames.every(f => f.global.kineticEnergyNmm >= 0 && f.global.internalEnergyNmm >= 0),
      maximumResidual: Math.max(...series.map(s => s.energyResidual)) },
    appliedWork: { pass: series.every(s => s.workResidual <= q.appliedWorkResidual),
      maximumResidual: Math.max(...series.map(s => s.workResidual)) },
    massConservation: { pass: history.frames.every(f => Math.abs(f.global.massMg - r.massMg) / r.massMg <= q.massRelative
      && f.global.massMg === history.frames[0].global.massMg) },
    noAddedMass: { pass: history.frames.every(f => f.global.addedMassMg <= 0
      && Math.abs(f.global.addedMassMg) <= ((88 + 208) * 2 ** -53 / (1 - (88 + 208) * 2 ** -53)) * f.global.massMg
      && f.global.addedMassMg === history.frames[0].global.addedMassMg
      && f.global.addedMassChangeFromInitializationMg === 0) },
  };
  return Object.freeze({ oracleDigest: AXIAL_ORACLE_DIGEST, pass: Object.values(gates).every(g => g.pass),
    gates, events, series, status: p.status, engineeringUsePermitted: false, providerAdmission: 'closed' });
}
