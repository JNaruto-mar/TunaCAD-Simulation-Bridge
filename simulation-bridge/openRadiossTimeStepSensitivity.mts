// Development planning only: no solver launch, production admission or result publication.
import { digest } from './stableDigest.mts';
import { AXIAL_ORACLE_DIGEST, AXIAL_VALIDATION_PLAN as oracle,
  axialWaveReference, evaluateAxialWaveHistory } from './openRadiossAxialBarOracle.mts';

type History = Parameters<typeof evaluateAxialWaveHistory>[0];
export type TimeStepLevel = 'coarse' | 'medium' | 'fine';
export type TimeStepStudyBinding = Readonly<{
  starterDeckSha256: string; retainedMeshSha256: string;
  starterRuntimeSha256: string; engineRuntimeSha256: string;
  dtNodaScale: number; minimumTimestepS: 0;
  starterExitCode: 0; engineExitCode: 0;
}>;
const fail = (why: string): never => { throw new Error(`Axial timestep plan: ${why}`); };
const positive = (v: number) => Number.isFinite(v) && v > 0;
const r = axialWaveReference();

export const TIMESTEP_SENSITIVITY_PLAN = Object.freeze({
  schema: 'tunacad-openradioss-axial-timestep-sensitivity/0.1',
  oracleDigest: AXIAL_ORACLE_DIGEST,
  levels: Object.freeze([
    Object.freeze({ level: 'coarse', scale: 0.9, execution: 'reuse retained authenticated result; never rerun' }),
    Object.freeze({ level: 'medium', scale: 0.6, execution: 'separate approval required' }),
    Object.freeze({ level: 'fine', scale: 0.4, execution: 'conditional on valid medium; separate approval required' }),
  ] as const),
  durationS: oracle.durationS, historyIntervalS: oracle.historyIntervalS,
  mesh: Object.freeze({ nodes: 88, elements: 208, elementType: 'TETRA4' }),
  minimumTimestepS: 0, maximumIncrements: oracle.maximumIncrements,
  maximumFrames: oracle.maximumFrames, interpolation: oracle.interpolation,
  // New cross-run criterion, NOT a replacement/relaxation of any physical gate.
  smallChangeFractionOfFrozenTolerance: 0.25,
  comparison: 'medium to fine; one quarter of smaller applicable frozen error budget',
  coverage: 'frozen-2026-cycle-trace; replay actual ordered cycles, never nominal/average timestep',
  resources: Object.freeze({ threads: 1, processTimeoutMs: 60000, maximumCapturedLogBytes: 8 * 1024 * 1024 }),
  executionApproval: 'none granted by this plan',
  status: 'proof_of_concept', engineeringUsePermitted: false, providerAdmission: 'closed',
} as const);
export const TIMESTEP_SENSITIVITY_DIGEST = digest(TIMESTEP_SENSITIVITY_PLAN);

/** Estimates only. Future Engine admission must use that run's fresh actual-mesh
 * Starter estimate; final coverage/resource evidence uses actual Engine cycles. */
export function estimateTimeStepLevels(criticalNodalEstimateS: number) {
  if (!positive(criticalNodalEstimateS)) fail('invalid provider-native nodal estimate');
  return TIMESTEP_SENSITIVITY_PLAN.levels.map(l => {
    const approximateStepS = l.scale * criticalNodalEstimateS;
    const approximateCycles = Math.floor(oracle.durationS / approximateStepS) + 1;
    if (!positive(approximateStepS) || approximateStepS >= criticalNodalEstimateS ||
      approximateStepS >= oracle.historyIntervalS || !Number.isSafeInteger(approximateCycles) ||
      approximateCycles > oracle.maximumIncrements) fail('timestep/history/increment resource limit');
    return Object.freeze({ ...l, approximateStepS, approximateCycles,
      belowIncrementCap: true, minimumTimestepS: 0,
      approximateEngineCycleCostRelativeToBaseline: 0.9 / l.scale });
  });
}

/** Fixed physical denominators keep differences defined even for zero values. */
export function normalizedTimeStepDifference(a: number, b: number, physicalScale: number) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !positive(physicalScale)) fail('invalid normalized difference');
  const absoluteChange = Math.abs(a - b);
  const normalizedChange = absoluteChange / Math.max(Math.abs(a), Math.abs(b), physicalScale);
  if (!Number.isFinite(normalizedChange)) fail('non-finite difference');
  return Object.freeze({ absoluteChange, normalizedChange });
}

/** Call only after direct T01 decoding and independent receipt/deck/runtime
 * authentication. This pure summary cannot itself authenticate provider bytes. */
export function summarizeTimeStepHistory(level: TimeStepLevel, history: History,
  forceByNode: Parameters<typeof evaluateAxialWaveHistory>[1], completedCycles: number,
  binding: TimeStepStudyBinding) {
  const selected = TIMESTEP_SENSITIVITY_PLAN.levels.find(l => l.level === level);
  if (!selected || binding.dtNodaScale !== selected.scale || binding.minimumTimestepS !== 0 ||
      binding.starterExitCode !== 0 || binding.engineExitCode !== 0 ||
      [binding.starterDeckSha256, binding.retainedMeshSha256,
        binding.starterRuntimeSha256, binding.engineRuntimeSha256].some(h => !/^[a-f0-9]{64}$/.test(h)))
    fail('invalid process/study/control binding');
  const { dtNodaScale: _scale, ...commonBinding } = binding;
  const studyBindingDigest = digest({ commonBinding, forceByNode, oracleDigest: AXIAL_ORACLE_DIGEST });
  if (!TIMESTEP_SENSITIVITY_PLAN.levels.some(l => l.level === level) ||
      !Number.isSafeInteger(completedCycles) || completedCycles < 2 || completedCycles > oracle.maximumIncrements ||
      history.coverage?.rule !== 'frozen-2026-cycle-trace' ||
      history.coverage.lastEvaluatedCycle + 1 !== completedCycles) fail('wrong level/actual cycle evidence');
  const evaluation = evaluateAxialWaveHistory(history, forceByNode);
  const steps = history.frames.map(f => f.global.timestepS);
  const mass = history.frames.map(f => f.global.massMg);
  const addedMass = history.frames.map(f => f.global.addedMassMg);
  const addedChange = history.frames.map(f => f.global.addedMassChangeFromInitializationMg);
  if (steps.some(s => !positive(s))) fail('invalid timestep history');
  const series = evaluation.series, events = evaluation.events, g = evaluation.gates;
  return Object.freeze({ level, oracleDigest: evaluation.oracleDigest, studyBindingDigest,
    oraclePass: evaluation.pass, gates: g, coveragePass: history.coverage.complete,
    completedCycles, timestepRangeS: [Math.min(...steps), Math.max(...steps)] as const,
    distinctTimestepsS: [...new Set(steps)], frameCount: history.frames.length,
    arrivalTimeS: g.waveArrival.sampleTimeS, arrivalErrorS: g.waveArrival.arrivalErrorS,
    arrivalLimitS: oracle.thresholds.arrivalFractionOfTransit * r.transitS + events.samplingBoundS,
    transitSampleTimeS: g.transitDisplacement.sampleTimeS,
    transitDisplacementMm: series[events.nearTransit].displacementMm,
    transitErrorMm: g.transitDisplacement.errorMm, transitLimitMm: g.transitDisplacement.limitMm,
    returnSampleTimeS: g.returnDisplacement.sampleTimeS,
    returnDisplacementMm: series[events.nearReturn].displacementMm,
    returnErrorMm: g.returnDisplacement.errorMm, returnLimitMm: g.returnDisplacement.limitMm,
    preArrivalMaximumN: Math.max(...events.preArrival.map(i => Math.abs(series[i].reactionN))),
    plateauMedianN: g.plateauReaction.medianN, plateauInBandFraction: g.plateauReaction.plateauFraction,
    maximumEnergyResidual: g.energyBalance.maximumResidual,
    maximumAppliedWorkResidual: g.appliedWork.maximumResidual,
    massVariationMg: Math.max(...mass) - Math.min(...mass),
    addedMassRangeMg: [Math.min(...addedMass), Math.max(...addedMass)] as const,
    maximumAddedMassChangeMg: Math.max(...addedChange.map(Math.abs)),
    status: 'proof_of_concept', engineeringUsePermitted: false });
}
export type TimeStepSummary = ReturnType<typeof summarizeTimeStepHistory>;

/** PENDING is missing evidence, not a failed solve. Failed includes any mandatory
 * physical/recovery/resource/process gate. No monotonic error requirement. */
export function compareTimeStepSensitivity(runs: readonly TimeStepSummary[]) {
  const levels = TIMESTEP_SENSITIVITY_PLAN.levels.map(l => l.level);
  if (runs.some(x => !levels.includes(x.level) || x.oracleDigest !== AXIAL_ORACLE_DIGEST) ||
      new Set(runs.map(x => x.level)).size !== runs.length ||
      new Set(runs.map(x => x.studyBindingDigest)).size > 1) fail('duplicate/mismatched study level');
  if (runs.some(x => !x.oraclePass || !x.coveragePass ||
      Object.values(x.gates).some(g => !g.pass) || x.completedCycles > oracle.maximumIncrements))
    return { conclusion: 'failed' as const, reason: 'mandatory frozen gate failed', comparisons: [] };
  if (runs.length !== levels.length)
    return { conclusion: 'pending' as const, reason: 'missing medium/fine evidence; no solve inferred', comparisons: [] };
  const medium = runs.find(x => x.level === 'medium')!, fine = runs.find(x => x.level === 'fine')!;
  const numbers = [medium.arrivalTimeS, fine.arrivalTimeS,
    medium.arrivalLimitS, fine.arrivalLimitS, medium.transitLimitMm, fine.transitLimitMm,
    medium.returnLimitMm, fine.returnLimitMm];
  if (numbers.some(v => v === null || !positive(v))) fail('invalid comparison event/budget');
  const fraction = TIMESTEP_SENSITIVITY_PLAN.smallChangeFractionOfFrozenTolerance;
  const compare = (quantity: string, a: number, b: number, physicalScale: number, absoluteLimit: number) => {
    const difference = normalizedTimeStepDifference(a, b, physicalScale);
    const denominator = Math.max(Math.abs(a), Math.abs(b), physicalScale);
    return { quantity, ...difference, absoluteLimit, normalizedLimit: absoluteLimit / denominator,
      small: difference.absoluteChange <= absoluteLimit };
  };
  const comparisons = [
    compare('arrivalTimeS', medium.arrivalTimeS!, fine.arrivalTimeS!, r.transitS,
      fraction * Math.min(medium.arrivalLimitS, fine.arrivalLimitS)),
    compare('transitDisplacementMm', medium.transitDisplacementMm, fine.transitDisplacementMm,
      r.staticDisplacementMm, fraction * Math.min(medium.transitLimitMm, fine.transitLimitMm)),
    compare('returnDisplacementMm', medium.returnDisplacementMm, fine.returnDisplacementMm,
      r.returnDisplacementMm, fraction * Math.min(medium.returnLimitMm, fine.returnLimitMm)),
    compare('plateauMedianN', medium.plateauMedianN, fine.plateauMedianN, Math.abs(r.supportPlateauN),
      fraction * oracle.thresholds.plateauMedianRelative * Math.abs(r.supportPlateauN)),
    compare('maximumEnergyResidual', medium.maximumEnergyResidual, fine.maximumEnergyResidual,
      oracle.thresholds.energyResidual, fraction * oracle.thresholds.energyResidual),
  ];
  return { conclusion: comparisons.every(c => c.small) ? 'stable' as const : 'sensitive' as const,
    reason: 'all levels pass oracle; medium/fine sensitivity independently assessed', comparisons };
}
