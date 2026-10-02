// Freeze only after synthetic tests; no retained numerical history is read.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AXIAL_VALIDATION_PLAN, AXIAL_ORACLE_DIGEST, AXIAL_BAR, firstCycleWaveSample } from '../simulation-bridge/openRadiossAxialBarOracle.mts';
import { differentiateVerifiedReactionImpulse } from '../simulation-bridge/openRadiossBinaryHistoryRecovery.mts';
import { summarizeTimeStepHistory, compareTimeStepSensitivity } from '../simulation-bridge/openRadiossTimeStepSensitivity.mts';
import { AXIAL_ORACLE_V2_PLAN, AXIAL_ORACLE_V2_DIGEST, axialWaveReferenceV2,
  describeImpulseTemporalSupport, evaluateAxialWaveHistoryV2, compareAxialV2TimeStepSensitivity } from '../simulation-bridge/openRadiossAxialBarOracleV2.mts';
type History = Parameters<typeof evaluateAxialWaveHistoryV2>[0];
const r=axialWaveReferenceV2(), p=r.pTransitS, rod=r.transitS;
assert.equal(AXIAL_ORACLE_DIGEST,'sha256:3925b93dc1a9ae733e4cbb59ba8216b9bd76f92b41f689c8c6855d12bea33121');
assert.notEqual(AXIAL_ORACLE_V2_DIGEST,AXIAL_ORACLE_DIGEST);
assert.equal(AXIAL_ORACLE_V2_PLAN.quiet.maximumMagnitudeN,10);
assert.equal(AXIAL_ORACLE_V2_PLAN.precursor.amplitudeAcceptance,'none; diagnostic only');
assert.ok(r.pTransitS<r.transitS && r.transitS<r.shearTransitS);
const boundary=describeImpulseTemporalSupport([0,p/2,p,p+1e-6,rod], [0,0,0,-20e-6,-40e-6]);
assert.equal(boundary.intervals[0].fullyPreP,true);
assert.equal(boundary.intervals[1].fullyPreP,true); // Exact P endpoint included.
assert.equal(boundary.intervals[2].fullyPreP,false);
const crossing=describeImpulseTemporalSupport([0,p-1e-6,p+1e-6], [0,0,-20e-6]);
assert.equal(crossing.intervals[1].crossesP,true); assert.equal(crossing.intervals[1].fullyPreP,false);
assert.equal(crossing.stencils[1].nominalRegion,'A'); assert.equal(crossing.stencils[1].entirePreP,false);
assert.equal(crossing.stencils[1].derivativeType,'centered');
assert.deepEqual(crossing.stencils[1].impulseIndices,[0,2]);
assert.deepEqual(crossing.stencils[1].temporalSupportS,[0,p+1e-6]);
assert.equal(crossing.stencils[0].derivativeType,'forward'); assert.equal(crossing.stencils[2].derivativeType,'backward');
assert.throws(()=>describeImpulseTemporalSupport([0,1e-6],[0,NaN]),/non-finite/);
assert.throws(()=>describeImpulseTemporalSupport([0,1e-6],[0,Infinity]),/non-finite/);
assert.throws(()=>describeImpulseTemporalSupport([0,1e-6,1e-6],[0,0,0]),/unordered/);
assert.throws(()=>describeImpulseTemporalSupport([0,1e-6],[0]),/Incomplete/);
const weights=[5,6,7,8,46].map(id=>({ id,forceN:20 }));
const fixed=[1,2,3,4,45], ids=[1,2,3,4,5,6,7,8,45,46];
function synthetic(plateau=-200):History {
  const times=Array.from({length:51},(_,i)=>i*1e-6);
  const impulses=times.map(t=>-20*Math.max(0,Math.min(t,rod)-p)+plateau*Math.max(0,t-rod));
  const forces=differentiateVerifiedReactionImpulse(times,impulses.map(i=>i/5));
  return { format:'synthetic definition test, not provider evidence',thicode:3040,nodeIds:ids as History['nodeIds'],
    channelCodes:[1,4,7,620],sha256:'0'.repeat(64),reactionProvenance:'raw REACX impulse N.s; TunaCAD dI/dt force N',
    coverage:{rule:'frozen-2026-cycle-trace',complete:true,requestedStopS:50e-6,lastEvaluatedCycle:249,
      sampledCycles:[],nextDueTimeS:50e-6,nextOutputCycle:250,nextOutputTimeS:50.2e-6,nextOutputTimeBoundsS:[50.2e-6,50.2e-6],
      forcedFinalSample:false,roundingPolicy:'controlled synthetic schedule, not real completion'},
    frames:times.map((t,i)=>{
      const sample=t<=r.returnS ? firstCycleWaveSample(t) : null;
      const dx=sample?.displacementMm ?? r.staticDisplacementMm*(4-t/rod), work=AXIAL_BAR.forceN*dx;
      return {timeS:t,global:{rawOrderedValues:Array(22).fill(0),timestepS:0.2e-6,massMg:r.massMg,
        addedMassMg:0,addedMassChangeFromInitializationMg:0,kineticEnergyNmm:sample?.kineticEnergyNmm ?? 0,
        internalEnergyNmm:sample?.internalEnergyNmm ?? work,externalWorkNmm:work},
        nodes:new Map(ids.map(id=>[id,{dxMm:fixed.includes(id)?0:dx,vxMmPerS:0,axMmPerS2:0,
          reactionImpulseNs:fixed.includes(id)?impulses[i]/5:0,reactionForceN:fixed.includes(id)?forces[i].derivedReactionN:0}]))};
    })};
}
const evidence={kind:'synthetic_definition_test' as const,providerHistorySha256:'0'.repeat(64),sourceAndRuntimeBound:true,
  engineExitCode:0,normalTermination:true,completedCycles:250};
const history=synthetic(), assessment=evaluateAxialWaveHistoryV2(history,weights,evidence);
assert.equal(assessment.pass,true); assert.equal(assessment.gates.quietPreP.maximumMagnitudeN,0);
assert.equal(assessment.gates.plateauReaction.pass,true); assert.equal(assessment.gates.waveArrival.pass,true);
assert.ok(assessment.precursor.maximumIntervalMagnitudeN!==null);
assert.equal(assessment.precursor.rows.every(row=>row.signCoherence==='all nonpositive'),true);
// Large synthetic precursor amplitude has no new amplitude gate (other inherited gates still apply).
assert.equal(assessment.gates.precursorMandatory.amplitudeAcceptance,'none; diagnostic only');
const corrupt=synthetic(); corrupt.frames[1].nodes.get(1)!.reactionImpulseNs=-20e-6;
for(const id of fixed){ const series=differentiateVerifiedReactionImpulse(corrupt.frames.map(f=>f.timeS),corrupt.frames.map(f=>f.nodes.get(id)!.reactionImpulseNs));
  corrupt.frames.forEach((f,i)=>f.nodes.get(id)!.reactionForceN=series[i].derivedReactionN); }
assert.equal(evaluateAxialWaveHistoryV2(corrupt,weights,evidence).gates.quietPreP.pass,false);
const nonfinite=synthetic(); nonfinite.frames[1].nodes.get(1)!.reactionImpulseNs=Infinity;
assert.throws(()=>evaluateAxialWaveHistoryV2(nonfinite,weights,evidence),/non-finite/);
const wrongDerivative=synthetic(); wrongDerivative.frames[1].nodes.get(1)!.reactionForceN=1;
assert.throws(()=>evaluateAxialWaveHistoryV2(wrongDerivative,weights,evidence),/not derived/);
assert.throws(()=>evaluateAxialWaveHistoryV2(history,weights,{...evidence,sourceAndRuntimeBound:false}),/unverified/);
assert.throws(()=>evaluateAxialWaveHistoryV2(history,weights,{...evidence,normalTermination:false}),/unverified/);
const missing=synthetic(); missing.frames[1].nodes.delete(1);
assert.throws(()=>evaluateAxialWaveHistoryV2(missing,weights,evidence),/non-finite/);
const binding=(scale:number)=>({starterDeckSha256:'1'.repeat(64),retainedMeshSha256:'2'.repeat(64),
  starterRuntimeSha256:'3'.repeat(64),engineRuntimeSha256:'4'.repeat(64),dtNodaScale:scale,
  minimumTimestepS:0 as const,starterExitCode:0 as const,engineExitCode:0 as const});
const runs=(['coarse','medium','fine'] as const).map((level,i)=>({level,
  originalSummary:summarizeTimeStepHistory(level,history,weights,250,binding([0.9,0.6,0.4][i])),evaluation:assessment}));
assert.equal(compareAxialV2TimeStepSensitivity(runs).conclusion,'STABLE');
const existing=compareTimeStepSensitivity(runs.map(r=>r.originalSummary));
const comparisons=compareAxialV2TimeStepSensitivity(runs).comparisons;
assert.equal(comparisons.length,5);
comparisons.forEach((c,i)=>{assert.equal(c.absoluteLimit,existing.comparisons[i].absoluteLimit);assert.equal(c.absoluteChange,existing.comparisons[i].absoluteChange);});
const sensitiveHistory=synthetic(-230), sensitiveEvaluation=evaluateAxialWaveHistoryV2(sensitiveHistory,weights,evidence);
assert.equal(sensitiveEvaluation.pass,true);
const sensitive=[...runs.slice(0,2),{level:'fine' as const,originalSummary:summarizeTimeStepHistory('fine',sensitiveHistory,weights,250,binding(0.4)),evaluation:sensitiveEvaluation}];
assert.equal(compareAxialV2TimeStepSensitivity(sensitive).conclusion,'SENSITIVE');
assert.equal(compareAxialV2TimeStepSensitivity([{...runs[0],evaluation:evaluateAxialWaveHistoryV2(corrupt,weights,evidence)},...runs.slice(1)]).conclusion,'FAILED');
const directory=await mkdtemp(join(tmpdir(),'tunacad-openradioss-oracle-v2-freeze-'));
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const record={schema:'tunacad-axial-oracle-v2-definition-freeze/0.1',frozenAt:new Date().toISOString(),
  oracleIdentity:'axial_bar_oracle_v2',oracleDigest:AXIAL_ORACLE_V2_DIGEST,plan:AXIAL_ORACLE_V2_PLAN,
  historicalV1Status:'FAILED',syntheticTestsPassed:true,retainedHistoriesRead:false,
  moduleSha256:sha(await readFile(new URL('../simulation-bridge/openRadiossAxialBarOracleV2.mts',import.meta.url))),
  testSha256:sha(await readFile(new URL(import.meta.url)))};
await writeFile(join(directory,'v2-oracle-freeze.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({pass:true,directory,oracleIdentity:record.oracleIdentity,oracleDigest:record.oracleDigest,
  freezeSha256:sha(await readFile(join(directory,'v2-oracle-freeze.json'))),retainedHistoriesRead:false,
  evidence:'synthetic causality/stencil/rod/plateau/malformed/unchanged-sensitivity tests; no solver'}));
