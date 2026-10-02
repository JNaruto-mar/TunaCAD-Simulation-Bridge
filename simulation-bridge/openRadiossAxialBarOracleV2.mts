// Separate development oracle. Never replaces v1 or admits/publishes results.
import { digest } from './stableDigest.mts';
import { AXIAL_BAR, AXIAL_ORACLE_DIGEST, AXIAL_VALIDATION_PLAN,
  axialWaveReference, evaluateAxialWaveHistory } from './openRadiossAxialBarOracle.mts';
import { differentiateVerifiedReactionImpulse } from './openRadiossBinaryHistoryRecovery.mts';
import { TIMESTEP_SENSITIVITY_PLAN, TIMESTEP_SENSITIVITY_DIGEST,
  normalizedTimeStepDifference, type TimeStepLevel, type TimeStepSummary } from './openRadiossTimeStepSensitivity.mts';
type History = Parameters<typeof evaluateAxialWaveHistory>[0];
const fixed = [1, 2, 3, 4, 45] as const;
const ids = [1, 2, 3, 4, 5, 6, 7, 8, 45, 46] as const;
const reject = (why: string): never => { throw new Error(`Axial oracle v2: ${why}`); };
export function axialWaveReferenceV2() {
  const b = AXIAL_BAR, rod = axialWaveReference();
  const mu = b.youngsModulusMPa / (2*(1+b.poissonRatio));
  const lambda = b.youngsModulusMPa*b.poissonRatio/((1+b.poissonRatio)*(1-2*b.poissonRatio));
  const pSpeedMmPerS = Math.sqrt((lambda+2*mu)/b.densityMgPerMm3);
  const shearSpeedMmPerS = Math.sqrt(mu/b.densityMgPerMm3);
  return Object.freeze({ ...rod, pSpeedMmPerS, shearSpeedMmPerS,
    pTransitS: b.lengthMm/pSpeedMmPerS, shearTransitS: b.lengthMm/shearSpeedMmPerS });
}
export const AXIAL_ORACLE_V2_PLAN = Object.freeze({
  schema: 'tunacad-openradioss-axial-wave-oracle/0.2', identity: 'axial_bar_oracle_v2',
  historicalOracle: Object.freeze({ identity: 'axial_bar_oracle_v1', digest: AXIAL_ORACLE_DIGEST,
    retainedStudyStatus: 'FAILED; never overwritten' }),
  bar: AXIAL_BAR, references: axialWaveReferenceV2(),
  reason: 'P-wave earliest causality; rod dominant response; raw intervals for quiet gate; centered support may cross boundaries',
  regions: Object.freeze({ A: 't<tP', B: 'tP<=t<tRod', C: 'dominant rod event and first reflection; return at 2*tRod' }),
  quiet: Object.freeze({ measurement: '(sum fixed I[i+1]-sum fixed I[i])/(t[i+1]-t[i])',
    eligibility: 'complete consecutive interval; end<=tP, including exact equality; no interpolation or extra guard',
    maximumMagnitudeN: AXIAL_VALIDATION_PLAN.thresholds.preArrivalReactionN,
    provenance: 'inherited 10 N development small-response bound, not a precursor-amplitude prediction' }),
  precursor: Object.freeze({ amplitudeAcceptance: 'none; diagnostic only',
    intervalRule: 'fully contained in [tP,tRod]; boundary-crossing intervals separately tagged',
    centeredRule: 'nominal frame in [tP,tRod); full stencil retained, may include rod event',
    mandatory: 'finite/provenance/channel integrity/fixed motion/mass/no addition/normal solver completion' }),
  derivative: Object.freeze({ first: 'forward [0,1]', interior: 'centered [i-1,i+1]', last: 'backward [n-2,n-1]',
    metadata: 'type, indices, endpoint times, impulse endpoints, temporal support, entirePreP',
    prePLabel: 'entire temporal support end<=tP; nominal time alone is insufficient' }),
  inheritedPlan: AXIAL_VALIDATION_PLAN,
  sensitivityPlanDigest: TIMESTEP_SENSITIVITY_DIGEST,
  sensitivity: TIMESTEP_SENSITIVITY_PLAN,
  status: 'proof_of_concept', engineeringUsePermitted: false, providerAdmission: 'closed',
} as const);
export const AXIAL_ORACLE_V2_DIGEST = digest(AXIAL_ORACLE_V2_PLAN);

/** Generic classification; no dependence on retained run-specific timestamps. */
export function describeImpulseTemporalSupport(times: readonly number[], impulses: readonly number[]) {
  const reference = axialWaveReferenceV2();
  const derived = differentiateVerifiedReactionImpulse(times, impulses);
  const intervals = times.slice(1).map((endS, i) => {
    const startS = times[i], deltaImpulseNs = impulses[i+1]-impulses[i];
    const forceN = deltaImpulseNs/(endS-startS);
    if (!Number.isFinite(forceN)) reject('non-finite interval force');
    return Object.freeze({ indices: [i,i+1] as const, startS, endS,
      impulsesNs: [impulses[i],impulses[i+1]] as const, deltaImpulseNs, forceN,
      fullyPreP: endS<=reference.pTransitS,
      fullyPrecursor: startS>=reference.pTransitS && endS<=reference.transitS,
      overlapsPrecursor: endS>reference.pTransitS && startS<reference.transitS,
      crossesP: startS<reference.pTransitS && endS>reference.pTransitS,
      crossesRod: startS<reference.transitS && endS>reference.transitS });
  });
  const stencils = derived.map((row,i) => {
    const lo = i===0 ? 0 : i-1, hi = i===times.length-1 ? i : i+1;
    return Object.freeze({ ...row, derivativeType: i===0 ? 'forward' : i===times.length-1 ? 'backward' : 'centered',
      impulseIndices: [lo,hi] as const, endpointTimesS: [times[lo],times[hi]] as const,
      endpointImpulsesNs: [impulses[lo],impulses[hi]] as const,
      temporalSupportS: [times[lo],times[hi]] as const, entirePreP: times[hi]<=reference.pTransitS,
      nominalRegion: row.timeS<reference.pTransitS ? 'A' : row.timeS<reference.transitS ? 'B' : 'C' });
  });
  return Object.freeze({ intervals: Object.freeze(intervals), stencils: Object.freeze(stencils) });
}

export type V2Evidence = Readonly<{ kind: 'synthetic_definition_test' | 'authenticated_retained_T01';
  providerHistorySha256: string; sourceAndRuntimeBound: boolean;
  engineExitCode: number; normalTermination: boolean; completedCycles: number }>;
/** Pure development assessment: authentication is performed by the trusted
 * retained-artifact loader before calling; this object is not a provider proof. */
export function evaluateAxialWaveHistoryV2(history: History,
  forceByNode: Parameters<typeof evaluateAxialWaveHistory>[1], evidence: V2Evidence) {
  if (!history.coverage?.complete || history.coverage.rule!=='frozen-2026-cycle-trace' ||
      history.coverage.requestedStopS!==AXIAL_VALIDATION_PLAN.durationS ||
      history.coverage.lastEvaluatedCycle+1!==evidence.completedCycles ||
      !Number.isSafeInteger(evidence.completedCycles) || evidence.completedCycles<2 || evidence.completedCycles>20000)
    reject('missing source-backed completed cycle coverage');
  if (!['synthetic_definition_test','authenticated_retained_T01'].includes(evidence.kind) ||
      !evidence.sourceAndRuntimeBound || evidence.engineExitCode!==0 || !evidence.normalTermination ||
      !/^[a-f0-9]{64}$/.test(evidence.providerHistorySha256) || evidence.providerHistorySha256!==history.sha256 ||
      history.reactionProvenance!=='raw REACX impulse N.s; TunaCAD dI/dt force N')
    reject('unverified/abnormal provider history or provenance');
  const times = history.frames.map(f=>f.timeS);
  const perNode = fixed.map(id=>({ id, ...describeImpulseTemporalSupport(times,
    history.frames.map(f=>f.nodes.get(id)?.reactionImpulseNs ?? NaN)) }));
  for (const [i,frame] of history.frames.entries()) {
    if (frame.nodes.size!==10 || [...frame.nodes.keys()].some((id,j)=>id!==ids[j])) reject('wrong node identities/order');
    for (const node of perNode)
      if (frame.nodes.get(node.id)!.reactionForceN!==node.stencils[i].derivedReactionN)
        reject('reaction force not derived from exact verified impulses');
  }
  const support = describeImpulseTemporalSupport(times, history.frames.map(f=>fixed.reduce((s,id)=>s+f.nodes.get(id)!.reactionImpulseNs,0)));
  const quiet = support.intervals.filter(i=>i.fullyPreP);
  if (!quiet.length) reject('missing fully pre-P interval evidence');
  const previous = evaluateAxialWaveHistory(history,forceByNode);
  // Inherit the actual v1 assessment unchanged; only its quiet gate is replaced.
  const { preArrivalReaction: historicalQuiet, ...inherited } = previous.gates;
  const maxAbs = (values: readonly number[])=>values.length ? Math.max(...values.map(Math.abs)) : null;
  const maximumQuietN = maxAbs(quiet.map(i=>i.forceN))!;
  const precursorIntervals = support.intervals.filter(i=>i.fullyPrecursor);
  const precursorFrames = support.stencils.filter(s=>s.nominalRegion==='B');
  const precursorRows = history.frames.flatMap((frame,i)=>frame.timeS>=axialWaveReferenceV2().pTransitS &&
    frame.timeS<axialWaveReferenceV2().transitS ? [{ frame:i, timeS:frame.timeS,
      rawSummedImpulseNs: support.stencils[i].rawImpulseNs, centeredForceN:support.stencils[i].derivedReactionN,
      perNode:fixed.map(id=>({ id,...frame.nodes.get(id)! })),
      signCoherence:fixed.every(id=>frame.nodes.get(id)!.reactionImpulseNs<=0) ? 'all nonpositive' :
        fixed.every(id=>frame.nodes.get(id)!.reactionImpulseNs>=0) ? 'all nonnegative' : 'mixed (diagnostic only)' }] : []);
  const gates = { ...inherited,
    historyCoverage:{ pass:true }, providerProvenance:{ pass:true }, reactionChannelIntegrity:{ pass:true },
    quietPreP:{ pass:maximumQuietN<=AXIAL_ORACLE_V2_PLAN.quiet.maximumMagnitudeN,
      maximumMagnitudeN:maximumQuietN, limitN:10, eligibleIntervalCount:quiet.length },
    precursorMandatory:{ pass:inherited.finiteState.pass && inherited.fixedMotion.pass && inherited.massConservation.pass &&
      inherited.noAddedMass.pass, amplitudeAcceptance:'none; diagnostic only' } };
  return Object.freeze({ oracleIdentity:'axial_bar_oracle_v2', oracleDigest:AXIAL_ORACLE_V2_DIGEST,
    sourceHistorySha256:history.sha256, pass:Object.values(gates).every(g=>g.pass), gates,
    historicalV1:Object.freeze({ identity:'axial_bar_oracle_v1', oracleDigest:AXIAL_ORACLE_DIGEST,
      pass:previous.pass, quietGate:historicalQuiet, gates:previous.gates }),
    reference:axialWaveReferenceV2(), rodEvents:previous.events, series:previous.series,
    support, perNode,
    precursor:Object.freeze({ rows:precursorRows, intervals:precursorIntervals,
      crossingIntervals:support.intervals.filter(i=>i.crossesP || i.crossesRod),
      maximumIntervalMagnitudeN:maxAbs(precursorIntervals.map(i=>i.forceN)),
      maximumCenteredMagnitudeN:maxAbs(precursorFrames.map(s=>s.derivedReactionN)),
      note:'centered frames labeled B may span the rod event; see exact temporal support' }),
    status:'proof_of_concept', engineeringUsePermitted:false, providerAdmission:'closed' });
}

export type V2Run = Readonly<{ level:TimeStepLevel; originalSummary:TimeStepSummary;
  evaluation:ReturnType<typeof evaluateAxialWaveHistoryV2> }>;
/** Frozen existing five metric budgets, assessed only after every v2 gate passes.
 * Original v1 summaries remain unmodified and retain their failed quiet gate. */
export function compareAxialV2TimeStepSensitivity(runs:readonly V2Run[]) {
  const levels = TIMESTEP_SENSITIVITY_PLAN.levels.map(l=>l.level);
  if (runs.some(r=>!levels.includes(r.level) || r.level!==r.originalSummary.level ||
      r.evaluation.oracleDigest!==AXIAL_ORACLE_V2_DIGEST || r.originalSummary.oracleDigest!==AXIAL_ORACLE_DIGEST) ||
      new Set(runs.map(r=>r.level)).size!==runs.length ||
      new Set(runs.map(r=>r.originalSummary.studyBindingDigest)).size>1) reject('mismatched study/level/version');
  if (runs.some(r=>!r.evaluation.pass || Object.values(r.evaluation.gates).some(g=>!g.pass)))
    return { conclusion:'FAILED', comparisons:[] };
  if (runs.length!==3) return { conclusion:'PENDING', comparisons:[] };
  const m=runs.find(r=>r.level==='medium')!.originalSummary, f=runs.find(r=>r.level==='fine')!.originalSummary;
  const ref=axialWaveReference(), q=AXIAL_VALIDATION_PLAN.thresholds;
  const fraction=TIMESTEP_SENSITIVITY_PLAN.smallChangeFractionOfFrozenTolerance;
  const metrics = [
    ['arrivalTimeS',m.arrivalTimeS!,f.arrivalTimeS!,ref.transitS,fraction*Math.min(m.arrivalLimitS,f.arrivalLimitS)],
    ['transitDisplacementMm',m.transitDisplacementMm,f.transitDisplacementMm,ref.staticDisplacementMm,fraction*Math.min(m.transitLimitMm,f.transitLimitMm)],
    ['returnDisplacementMm',m.returnDisplacementMm,f.returnDisplacementMm,ref.returnDisplacementMm,fraction*Math.min(m.returnLimitMm,f.returnLimitMm)],
    ['plateauMedianN',m.plateauMedianN,f.plateauMedianN,200,fraction*q.plateauMedianRelative*200],
    ['maximumEnergyResidual',m.maximumEnergyResidual,f.maximumEnergyResidual,q.energyResidual,fraction*q.energyResidual],
  ] as const;
  const comparisons=metrics.map(([quantity,a,b,physicalScale,absoluteLimit])=>({ quantity,
    ...normalizedTimeStepDifference(a,b,physicalScale), absoluteLimit, pass:Math.abs(a-b)<=absoluteLimit }));
  return { conclusion:comparisons.every(c=>c.pass) ? 'STABLE' : 'SENSITIVE', comparisons };
}
