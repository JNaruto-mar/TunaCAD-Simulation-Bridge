import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bindTwoLayerSource, validateTwoLayerCompletionRecord, type TrustedTwoLayerSourceReader } from '../simulation-bridge/electrostaticTwoLayerAdmission.mts';
import { ElectrostaticHostStorage, readElectrostaticHostJson } from '../simulation-bridge/electrostaticHostStorage.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';

/** Read-only controlled fault injection AFTER authentic completion-pin/ledger
 * authentication and fresh source binding. No record/pin/digest is rewritten,
 * copied to another storage root or resealed. Not a public result/approval API. */
export async function verifyTwoLayerA01ReadOnly(storage:ElectrostaticHostStorage,reader:TrustedTwoLayerSourceReader,jobId:string){
  assert.match(jobId,/^electrical_[a-f0-9-]{36}$/);
  await storage.assertReady();
  const quarantinePath=join(storage.paths['completion-catalog'],jobId+'.quarantine.json');
  const assertNotQuarantined=async()=>{
    try { await readFile(quarantinePath); }
    catch(error:any){if(error.code==='ENOENT')return;throw error;}
    throw new Error('A01 requires an unquarantined authentic completion');
  };
  await assertNotQuarantined();
  const recordPath=join(storage.paths.results,jobId+'.json'),pinPath=join(storage.paths['completion-catalog'],jobId+'.pin.json');
  const before=await Promise.all([readFile(recordPath),readFile(pinPath)]);
  const pin=await readElectrostaticHostJson(pinPath,2048),record=await readElectrostaticHostJson(recordPath);
  assert.equal(pin.schema,'tunacad-electrostatic-two-layer-completion-pin/0.1');assert.equal(pin.jobId,jobId);
  assert.equal(pin.configurationDigest,storage.configurationDigest);assert.match(pin.recordDigest,/^sha256:[a-f0-9]{64}$/);assert.equal(pin.recordDigest,digest(record));
  assert.equal(record.schema,'tunacad-electrostatic-two-layer-ledger/0.1');assert.equal(record.jobId,jobId);
  const source=await bindTwoLayerSource(record.studyId,reader);
  validateTwoLayerCompletionRecord(record,source,jobId);
  const altered=structuredClone(record),originalDeckDigest=record.result.binding.deckDigest;
  altered.result.binding.deckDigest=digest('A01 controlled post-authentication in-memory deck fault');
  assert.notEqual(altered.result.binding.deckDigest,originalDeckDigest);
  assert.equal(altered.result.binding.sourceDigest,record.result.binding.sourceDigest);
  assert.equal(altered.result.resultDigest,record.result.resultDigest);
  assert.equal(altered.result.completionDigest,record.result.completionDigest);
  assert.throws(()=>validateTwoLayerCompletionRecord(altered,source,jobId),/completion deck digest mismatch/);
  const rebound=await bindTwoLayerSource(record.studyId,reader);assert.deepEqual(rebound.identity,source.identity);
  validateTwoLayerCompletionRecord(record,rebound,jobId);
  const after=await Promise.all([readFile(recordPath),readFile(pinPath)]);
  before.forEach((bytes,i)=>assert.deepEqual(after[i],bytes,'Protected completion/pin must remain byte-identical'));
  await assertNotQuarantined();
  await storage.assertReady();
  return {status:'PASS',gate:'A01',scope:'authenticated completion, post-read in-memory deck-only fault',jobId,studyId:record.studyId,
    authenticatedRecordDigest:pin.recordDigest,originalDeckDigest,rejection:'completion deck digest mismatch',
    protectedEvidenceUnchanged:true,resealedRecords:0,nativeRuns:0,publicAdmission:'closed'};
}
