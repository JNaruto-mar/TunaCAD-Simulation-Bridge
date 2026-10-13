import assert from 'node:assert/strict';
import { test } from 'node:test';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import { validateTwoLayerCompletionRecord } from '../simulation-bridge/electrostaticTwoLayerAdmission.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import {verifyTwoLayerA01ReadOnly} from './verify-electrostatic-two-layer-a01.mts';

// Synthetic binding metadata only, not native electrical results or A01 evidence.
function metadata() {
  const deck = 'controlled unit-test deck';
  const identity = {deckDigest:digest(deck),sourceDigest:digest('source'),fragmentMeshDigest:digest('mesh'),runtime:{engine:'unit-only'}};
  const electrical = {requestDigest:digest('request'),meshDigest:identity.fragmentMeshDigest,
    interfaceEvidence:{sharedFacetDigest:digest('facets')},rawOutputDigest:digest('unit-only-output')};
  const e = {...electrical,resultDigest:digest(electrical)};
  const completion = {jobId:'unit-job',state:'completed_converged',cleanupConfirmed:true,
    sourceDigest:identity.sourceDigest,normalizedElectricalResultDigest:e.resultDigest,rawOutputDigest:e.rawOutputDigest,
    runtime:identity.runtime,nativeEvidence:{exitCode:0,completedStep:1,completedTime:1,statusDigest:digest('unit'),diagnosticDigest:digest('unit')}};
  const r = {schema:'tunacad-electrostatic-two-layer-completed-result/0.1',jobId:'unit-job',studyId:'unit-study',
    completedProviderState:'completed_converged',status:'proof_of_concept',engineeringUsePermitted:false,providerAdmission:'closed',
    binding:identity,normalizedElectricalResultDigest:e.resultDigest,electrical:e,completionDigest:digest(completion)};
  return {record:{studyId:'unit-study',result:{...r,resultDigest:digest(r)},completion},
    source:{deck,identity,request:{studyId:'unit-study',requestDigest:e.requestDigest},verified:{interfaceEvidence:e.interfaceEvidence}} as any};
}
test('distinct deck comparison precedes aggregate checks without resealing',()=>{
  const {record,source}=metadata(),original=structuredClone(record);
  validateTwoLayerCompletionRecord(record,source,'unit-job');
  for(const deckDigest of [digest('other deck'),'invalid','',undefined]){
    const copy=structuredClone(record);copy.result.binding.deckDigest=deckDigest as any;
    assert.throws(()=>validateTwoLayerCompletionRecord(copy,source,'unit-job'),/completion deck digest mismatch/);
  }
  assert.throws(()=>validateTwoLayerCompletionRecord(record,{...source,deck:'changed deck'},'unit-job'),/completion deck digest mismatch/);
  assert.deepEqual(record,original);
});
test('existing aggregate, cleanup, result and Preview checks still reject',()=>{
  const {record,source}=metadata();
  for(const change of [
    (r:any)=>r.result.binding.sourceDigest=digest('wrong source'),
    (r:any)=>r.completion.cleanupConfirmed=false,
    (r:any)=>r.result.electrical.resultDigest=digest('wrong result'),
    (r:any)=>r.result.providerAdmission='public',
    (r:any)=>r.result.engineeringUsePermitted=true,
    (r:any)=>r.result.completionDigest=digest('wrong completion'),
  ]){const copy=structuredClone(record);change(copy);assert.throws(()=>validateTwoLayerCompletionRecord(copy,source,'unit-job'),/completion\/source\/result mismatch/);}
});
test('read-only auditor refuses quarantine or unauthenticated metadata before source reads',async()=>{
  // Deliberately synthetic, unprotected UNIT envelopes. No native/A01 PASS claim.
  for(const refusal of['quarantine','configuration','ledger']){
    const root=await mkdtemp(join(tmpdir(),'tunacad-a01-unit-'));
    const results=join(root,'results'),catalog=join(root,'catalog');await mkdir(results);await mkdir(catalog);
    const jobId='electrical_00000000-0000-4000-8000-000000000000',configurationDigest=digest('unit configuration');
    const record={schema:'tunacad-electrostatic-two-layer-ledger/0.1',jobId,...metadata().record};
    const pin={schema:'tunacad-electrostatic-two-layer-completion-pin/0.1',jobId,configurationDigest,recordDigest:digest(record)};
    if(refusal==='configuration')pin.configurationDigest=digest('wrong unit configuration');
    if(refusal==='ledger')pin.recordDigest=digest('not the unit ledger');
    const recordPath=join(results,jobId+'.json'),pinPath=join(catalog,jobId+'.pin.json');
    await writeFile(recordPath,JSON.stringify(record),{flag:'wx'});await writeFile(pinPath,JSON.stringify(pin),{flag:'wx'});
    if(refusal==='quarantine')await writeFile(join(catalog,jobId+'.quarantine.json'),'{}',{flag:'wx'});
    const before=await Promise.all([readFile(recordPath),readFile(pinPath)]);let sourceReads=0;
    const storage={configurationDigest,paths:{results,'completion-catalog':catalog},assertReady:async()=>{}} as any;
    const reader={readSealedRequest:async()=>{sourceReads++;throw Error('Source read must not be reached');}} as any;
    await assert.rejects(()=>verifyTwoLayerA01ReadOnly(storage,reader,jobId));assert.equal(sourceReads,0);
    assert.deepEqual(await Promise.all([readFile(recordPath),readFile(pinPath)]),before);
  }
});
