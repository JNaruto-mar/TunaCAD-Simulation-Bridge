// Strict composed identity/recovery regression; no native processes.
import assert from 'node:assert/strict';
import {validateNeutralSimulationResultV2,validateNeutralSimulationFieldPageV2} from '../simulation-bridge/v2Validation.mts';
import {digest} from '../simulation-bridge/stableDigest.mts';
import {createThermalTransportFixture} from './fixtures/thermalTransportFixture.mts';
for(const type of ['transient_thermal','steady_thermal'] as const){
 const fixture=createThermalTransportFixture(type);const {request,model,provider}=fixture;
 const submission=await provider.submit(request,{descriptor:request.model,async exportDomain(){throw Error('No export allowed');}});
 let status=await provider.getStatus(submission.providerRunId);
 for(let attempt=0;attempt<100&&['queued','running'].includes(status.status);attempt++){
  await new Promise(r=>setTimeout(r,1));status=await provider.getStatus(submission.providerRunId);
 }
 assert.equal(status.status,'succeeded',JSON.stringify(status.failure));const result=await provider.getResult(submission.providerRunId);assert(result);
 validateNeutralSimulationResultV2(result,request);assert.equal(result.review.engineeringUsePermitted,false);
 assert.equal(result.requestDigest,request.requestDigest);assert.deepEqual(await provider.getResult(submission.providerRunId),result);
 const nativeBefore=structuredClone(fixture.nativeResult);
 for(const [index,datasetId] of result.perDomain[0].fieldDatasetIds.entries()){
  const nativeDatasetId=fixture.nativeResult.perDomain[0].fieldDatasetIds[index];
  if(type==='transient_thermal')assert(datasetId.startsWith(submission.providerRunId+':'));
  else assert.equal(datasetId,nativeDatasetId,'Keep existing steady field IDs compatible.');
  const page=await provider.getFieldDataset(submission.providerRunId,datasetId,'0',1);
  assert.equal(fixture.requestedPageId,nativeDatasetId);assert.equal(page.dataset.datasetId,datasetId);assert.equal(page.dataset.jobId,submission.providerRunId);
  validateNeutralSimulationFieldPageV2(page);assert.equal(digest(page.triangles),page.chunkDigest);assert.equal(digest(page.triangles),page.dataset.datasetDigest);
  if(request.analysis.type==='transient_thermal'){
   assert('timeS' in page.dataset.step);assert.equal(page.dataset.step.timeS,request.analysis.settings.outputTimesS[Math.floor(index/2)]);
  }
 }
 await assert.rejects(()=>provider.getFieldDataset(submission.providerRunId,'foreign:solid:temperature'),/does not belong/);
 if(type==='transient_thermal')await assert.rejects(()=>provider.getFieldDataset(submission.providerRunId,fixture.nativeResult.perDomain[0].fieldDatasetIds[0]),/does not belong/);
 for(const kind of ['dataset','job','domain','analysis']){
  fixture.tamper=kind;await assert.rejects(()=>provider.getFieldDataset(submission.providerRunId,result.perDomain[0].fieldDatasetIds[0]),/identity/i);
 }
 fixture.tamper='';assert.deepEqual(fixture.nativeResult,nativeBefore,'Native result/field identities must remain immutable.');
 console.log(type+' composed fields PASS');
}
console.log('Composed thermal field ownership/recovery regression PASS; native executions = 0');
