// No solver. Read authenticated existing artifacts; write only a separate v2 report.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { parseBoundedOpenRadiossTFile4 } from '../simulation-bridge/openRadiossBinaryTFileParser.mts';
import { AXIAL_ORACLE_DIGEST, AXIAL_VALIDATION_PLAN, evaluateAxialWaveHistory } from '../simulation-bridge/openRadiossAxialBarOracle.mts';
import { summarizeTimeStepHistory, compareTimeStepSensitivity } from '../simulation-bridge/openRadiossTimeStepSensitivity.mts';
import { AXIAL_ORACLE_V2_PLAN, AXIAL_ORACLE_V2_DIGEST, evaluateAxialWaveHistoryV2,
  compareAxialV2TimeStepSensitivity, type V2Run } from '../simulation-bridge/openRadiossAxialBarOracleV2.mts';
const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const json=async(dir:string,file:string)=>JSON.parse(await readFile(join(dir,file),'utf8'));
const freezeDir=process.env.TUNACAD_OPENRADIOSS_ORACLE_V2_FREEZE_DIR;
assert.ok(freezeDir,'independent synthetic definition freeze required');
const freezeBytes=await readFile(join(freezeDir,'v2-oracle-freeze.json'));
assert.equal(sha(freezeBytes),process.env.TUNACAD_OPENRADIOSS_ORACLE_V2_FREEZE_SHA256);
const freeze=JSON.parse(freezeBytes.toString());
assert.equal(freeze.oracleIdentity,'axial_bar_oracle_v2');
assert.equal(freeze.oracleDigest,AXIAL_ORACLE_V2_DIGEST);
assert.equal(digest(freeze.plan),AXIAL_ORACLE_V2_DIGEST);
assert.deepEqual(freeze.plan,JSON.parse(JSON.stringify(AXIAL_ORACLE_V2_PLAN)));
assert.equal(freeze.syntheticTestsPassed,true); assert.equal(freeze.retainedHistoriesRead,false);
assert.equal(freeze.historicalV1Status,'FAILED');
const moduleUrl=new URL('../simulation-bridge/openRadiossAxialBarOracleV2.mts',import.meta.url);
const testUrl=new URL('./test-sim9-openradioss-axial-oracle-v2.mts',import.meta.url);
assert.equal(sha(await readFile(moduleUrl)),freeze.moduleSha256);
assert.equal(sha(await readFile(testUrl)),freeze.testSha256);
assert.equal(AXIAL_ORACLE_DIGEST,'sha256:3925b93dc1a9ae733e4cbb59ba8216b9bd76f92b41f689c8c6855d12bea33121');
// First retained artifact read occurs only after verifying the independent freeze.
const inputs=[
  {level:'coarse',scale:0.9,dir:process.env.TUNACAD_OPENRADIOSS_COARSE_DIR,
    report:'source-backed-analytical-validation-report.json',
    t01:'9820d44c10179aa4bb838500abc86c856a2e275c0bd134bd8d1d255d0b8a2c46',
    trace:'69ccd1325d08a004434dcd208bab02607d1b46ac4ea83638f82e561d9d1aa5ca',provenance:undefined},
  {level:'medium',scale:0.6,dir:process.env.TUNACAD_OPENRADIOSS_MEDIUM_SOURCE_DIR,
    report:'medium-validation-report.json',
    t01:'a679deb05ab2476afce7fe12d8c4eed5aaf7784065a497b68d24ff61972be559',
    trace:'66d1058c2e83c14178a07c31bde6b43f80981b3e3e1e86ba0e2026e3060885b2',
    provenance:'009620ebcb3cad5d4a0eceed8b462a2df38d2772b0934de752ff90a7de59ed31'},
  {level:'fine',scale:0.4,dir:process.env.TUNACAD_OPENRADIOSS_VALIDATION_DIR,
    report:'fine-validation-report.json',
    t01:'e54941f8330344ebd6e5ada798a2f30e1d6b7d52783a5536235b2e113a5dfa4d',
    trace:'380563f3aa1c87d09e98b7e6da95d2f42e9b8d3fcfbf38ab183434afbfa1de04',
    provenance:'b5a51874817b64478f299e18fde23b55386c2d97727cca7d9eff9cccfb7ca8a0'},
] as const;
const runs:V2Run[]=[], identities=[];
for (const input of inputs) {
  assert.ok(input.dir);
  const receipt=await json(input.dir,'pre-dispatch-receipt.json');
  const original=await json(input.dir,input.report);
  const originalReportDigest=sha(await readFile(join(input.dir,input.report)));
  assert.equal(receipt.oracleDigest,AXIAL_ORACLE_DIGEST);
  assert.deepEqual(receipt.oraclePlan,JSON.parse(JSON.stringify(AXIAL_VALIDATION_PLAN)));
  assert.deepEqual(receipt.faces.fixed.nodeIds,[1,2,3,4,45]);
  assert.deepEqual(receipt.faces.loaded.nodeIds,[5,6,7,8,46]);
  assert.equal(receipt.faces.forceSumN,100);
  assert.deepEqual(receipt.material,{E_MPa:200000,nu:0.3,density_Mg_mm3:7.8e-9});
  assert.equal(receipt.mesh.nodes,88); assert.equal(receipt.mesh.elements,208);
  assert.equal(receipt.time.durationS,50e-6); assert.equal(receipt.time.historyIntervalS,1e-6);
  assert.equal(receipt.time.control,`/DT/NODA; scale=${input.scale}; minimum=0`);
  assert.equal(receipt.invariants.zeroInitialState,true);
  assert.equal(receipt.invariants.noMassScalingCards,true);
  assert.equal(receipt.invariants.noDampingContactPlasticityOrMultidomain,true);
  assert.equal(receipt.sourceSha256,'700f03b250203d5d72e01aedf156b81c843e8b467a391460387061be9623ea71');
  assert.equal(receipt.starterSha256,'58424691156acf7cd163a0fd5bc61c71a24fabdd186c799394a8bb79fc43324f');
  for(const [path,expected] of [[receipt.sourceFrd,receipt.sourceSha256],[receipt.starterPath,receipt.starterSha256],
    [receipt.enginePath,receipt.engineSha256],[receipt.binaryPaths.starterExe,receipt.binarySha256.starter],
    [receipt.binaryPaths.engineExe,receipt.binarySha256.engine]]) assert.equal(sha(await readFile(path)),expected);
  assert.equal(receipt.binarySha256.starter,'961eca1640c321b0cb4893c8481942e5162e89ea292d64e964deea1b5ead96d6');
  assert.equal(receipt.binarySha256.engine,'53625d1fdc32991b0f51c368c648a5c184fd3bc43875553b4653132445e4b8e8');
  if(input.provenance) {
    const pinBytes=await readFile(join(input.dir,'engine-output-provenance.json'));
    assert.equal(sha(pinBytes),input.provenance);
    assert.equal(original.contemporaneousEngineProvenanceDigest,input.provenance);
    const pin=JSON.parse(pinBytes.toString());
    assert.equal(pin.capturedBeforeInterpretation,true);
    assert.equal(pin.attemptId,receipt.attemptId); assert.equal(pin.studyId,receipt.studyId);
    assert.equal(pin.stdoutDigest,input.trace);
    for(const artifact of pin.artifacts) {
      assert.equal(artifact.path,join(input.dir,artifact.name));
      const bytes=await readFile(artifact.path);
      assert.equal(bytes.length,artifact.bytes); assert.equal(sha(bytes),artifact.sha256);
    }
    assert.ok(receipt.runtime.files.length);
    for(const file of receipt.runtime.files) {
      const bytes=await readFile(file.path);
      assert.equal(bytes.length,file.bytes); assert.equal(sha(bytes),file.sha256);
    }
  }
  const bytes=await readFile(join(input.dir,'ExplicitBarProbeT01'));
  const trace=await readFile(join(input.dir,'engine.stdout.txt'),'utf8');
  assert.equal(sha(bytes),input.t01); assert.equal(sha(trace),input.trace);
  const engineExit=await json(input.dir,'engine-exit.json'); assert.equal(engineExit.exitCode,0);
  const listing=await readFile(join(input.dir,'ExplicitBarProbe_0001.out'),'utf8');
  assert.match(listing,/NORMAL TERMINATION/);
  const completedCycles=Number(listing.match(/TOTAL NUMBER OF CYCLES\s*:\s*(\d+)/)?.[1]);
  const history=parseBoundedOpenRadiossTFile4(bytes,50e-6,{method:'frozen-2026-cycle-trace',
    cycleTrace:trace,completedCycles,historyIntervalS:1e-6,engineExitCode:0,normalTermination:true});
  const unchangedV1=evaluateAxialWaveHistory(history,receipt.faces.forceByNode);
  assert.deepEqual(unchangedV1.gates,input.level==='coarse'?original.evaluation.gates:original.summary.gates);
  const originalSummary=summarizeTimeStepHistory(input.level,history,receipt.faces.forceByNode,completedCycles,{
    starterDeckSha256:receipt.starterSha256,retainedMeshSha256:receipt.sourceSha256,
    starterRuntimeSha256:receipt.binarySha256.starter,engineRuntimeSha256:receipt.binarySha256.engine,
    dtNodaScale:input.scale,minimumTimestepS:0,starterExitCode:0,engineExitCode:0});
  if(input.level!=='coarse') assert.deepEqual(originalSummary,original.summary);
  const evaluation=evaluateAxialWaveHistoryV2(history,receipt.faces.forceByNode,{
    kind:'authenticated_retained_T01',providerHistorySha256:input.t01,sourceAndRuntimeBound:true,
    engineExitCode:0,normalTermination:true,completedCycles});
  runs.push({level:input.level,originalSummary,evaluation});
  identities.push({level:input.level,studyId:receipt.studyId??'original coarse authenticated analytical run',
    attemptId:receipt.attemptId??null,t01Sha256:input.t01,cycleTraceSha256:input.trace,
    originalReportSha256:originalReportDigest,completionProvenanceSha256:input.provenance??null,
    meshSha256:receipt.sourceSha256,starterDeckSha256:receipt.starterSha256,engineDeckSha256:receipt.engineSha256,
    runtime:receipt.binarySha256,coverage:history.coverage,firstTimeS:history.frames[0].timeS,
    lastTimeS:history.frames.at(-1)!.timeS,frameCount:history.frames.length});
}
assert.equal(runs[2].evaluation.historicalV1.pass,false);
assert.equal(runs[2].evaluation.historicalV1.quietGate.pass,false);
const historicalStudy=compareTimeStepSensitivity(runs.map(r=>r.originalSummary));
assert.equal(historicalStudy.conclusion,'failed');
assert.equal(runs[2].originalSummary.preArrivalMaximumN,15.164045461210522);
const sensitivity=compareAxialV2TimeStepSensitivity(runs);
// Verify identity preservation at the end; never write original reports or artifacts.
for(const input of inputs) {
  assert.equal(sha(await readFile(join(input.dir!,'ExplicitBarProbeT01'))),input.t01);
  assert.equal(sha(await readFile(join(input.dir!,input.report))),identities.find(i=>i.level===input.level)!.originalReportSha256);
}
assert.equal(sha(await readFile(join(freezeDir,'v2-oracle-freeze.json'))),sha(freezeBytes));
assert.equal(sha(await readFile(moduleUrl)),freeze.moduleSha256);
const result={schema:'tunacad-axial-oracle-v2-retained-reevaluation/0.1',evaluatedAt:new Date().toISOString(),
  evidence:'no-solver authentic retained T01 reevaluation after independent synthetic definition freeze',
  definition:{identity:freeze.oracleIdentity,digest:freeze.oracleDigest,frozenAt:freeze.frozenAt,freezeSha256:sha(freezeBytes)},
  historicalV1:{identity:'axial_bar_oracle_v1',digest:AXIAL_ORACLE_DIGEST,study:'FAILED',fineQuietN:15.164045461210522,limitN:10},
  identities,runs,sensitivity,noSolverRan:true,providerAdmission:'closed',engineeringUsePermitted:false};
const output=join(freezeDir,'v2-retained-reevaluation.json');
await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...result,output,reportSha256:sha(await readFile(output)),runs:runs.map(r=>({level:r.level,
  summary:r.originalSummary,pass:r.evaluation.pass,gates:r.evaluation.gates,
  precursor:{maximumIntervalMagnitudeN:r.evaluation.precursor.maximumIntervalMagnitudeN,
    maximumCenteredMagnitudeN:r.evaluation.precursor.maximumCenteredMagnitudeN},
  historicalV1Pass:r.evaluation.historicalV1.pass})),identities:identities.map(i=>({...i,
    coverage:{...i.coverage,expectedOutputs:undefined,sampledCycles:undefined}}))}));
