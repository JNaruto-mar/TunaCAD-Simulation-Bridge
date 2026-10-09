// Focused output/resource/coverage checks only: no native process or solver.
import assert from 'node:assert/strict';
import {explicitHistorySampling} from '../simulation-bridge/explicitHistorySampling.mts';
import {validateOpenRadiossExplicitCadence} from '../simulation-bridge/openRadiossHistoryCoverage.mts';
import {estimateExplicitHistoryBytes,EXPLICIT_NORMALIZED_RESULT_MAXIMUM_BYTES} from '../providers/openradioss/OpenRadiossHistoryResource.mts';
for(const durationUs of [.125,50,75.125,10000])for(const count of [2,17,25,50,63]){
 const durationS=durationUs/1e6,intervalS=durationUs/count/1e6;
 assert.deepEqual(explicitHistorySampling(durationS,[intervalS,durationS]),{intervalS,maximumFrames:count+1});
 assert.ok(estimateExplicitHistoryBytes(count+1,[101,211,307])<=EXPLICIT_NORMALIZED_RESULT_MAXIMUM_BYTES);
}
for(const times of [[1e-9,50e-6],[50e-6/64,50e-6],[1e-6,49e-6],[NaN,50e-6],[10e-6,1e-6,50e-6]])
 assert.throws(()=>explicitHistorySampling(50e-6,times));
// Just below an integer due to roundoff is admitted; meaningfully over the cap is not.
assert.equal(explicitHistorySampling(75e-6,[75e-6/63,75e-6]).maximumFrames,64);
assert.throws(()=>explicitHistorySampling(75e-6,[75e-6/(63+1e-8),75e-6]),/resource limit/);
// Synthetic binary timestamps verify existing frozen scheduler coverage at
// multiple cadences, without pretending these are authentic solver results.
const step=2**-23,stop=75e-6,lastCycle=Math.floor(stop/step);
for(const count of [2,17,25,63]){
 const interval=stop/count,times:number[]=[];let due=0;
 for(let n=0;n<=count;n++){
  const cycle=Math.ceil(due/step);if(cycle>lastCycle)break;
  times.push(Math.fround(cycle*step));due=Math.min(stop,due+interval);
 }
 const completion={method:'frozen-2026-constant-step' as const,historyIntervalS:interval,
  engineExitCode:0 as const,normalTermination:true as const,completedCycles:lastCycle+1};
 const coverage=validateOpenRadiossExplicitCadence(times,times.map(()=>step),stop,completion);
 assert.equal(coverage.complete,true);assert.equal(coverage.forcedFinalSample,false);
 assert.throws(()=>validateOpenRadiossExplicitCadence(times.slice(0,-1),times.slice(0,-1).map(()=>step),stop,completion));
}
console.log('PASS sampling: bounded generalized cadence, floating boundary, result reserve, complete scheduled coverage/missing-frame rejection. No native execution.');
