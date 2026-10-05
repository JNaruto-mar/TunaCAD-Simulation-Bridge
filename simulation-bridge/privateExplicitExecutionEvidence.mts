// Protected native sink. Constructor-owned approval policy; no browser-supplied paths.
import assert from 'node:assert/strict';
import { open,readFile,lstat,readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { digest } from './stableDigest.mts';
import { sha256 } from '../providers/openradioss/OpenRadiossInstallation.mts';
import { ElectrostaticHostStorage,writeElectrostaticHostOnce,readElectrostaticHostJson } from './electrostaticHostStorage.mts';
import type { OpenRadiossDurableSink } from '../providers/openradioss/OpenRadiossDurableCapture.mts';
import { validatePrivateExplicitSolve } from './privateExplicitPreparationContract.mts';
import { artifactByteLimit,validateArtifactPins,EXPLICIT_ARTIFACT_POLICY_DIGEST,classifyFinalReceipt }
  from '../providers/openradioss/OpenRadiossExecutionReadiness.mts';
import { verifyExecutionTerminalChain } from './privateExplicitExecutionReadiness.mts';

/** Use a NEW per-execution protected storage root, not an existing completion.
 * Caller is the trusted native owner (fixtures isolate theirs), never HTTP data.
 * Provisioning stays explicit; opening never repairs permissions. */
export async function openProtectedExecutionEvidence(storage:ElectrostaticHostStorage,ticket:any,input:any,bridgeReady:any,expectedApprovalSource:'human'|'controlled_test_fixture'='controlled_test_fixture'){
  await storage.assertReady();assert.equal(digest(input),ticket.inputDigest);
  assert.equal(ticket.approvalSource,expectedApprovalSource);
  assert.equal(digest(bridgeReady),ticket.bridgeReadyDigest);
  const binding=await validatePrivateExplicitSolve(bridgeReady.binding);
  assert.equal(binding.solveRevalidation!.solveBindingId,ticket.solveBindingId);
  assert.equal(bridgeReady.solveApproval.authorizationId,ticket.bridgeApprovalId);
  assert.equal(bridgeReady.solveApproval.approvalSource,expectedApprovalSource);
  assert.equal(bridgeReady.solveApproval.bindingDigest,digest(binding));
  await writeElectrostaticHostOnce(join(storage.paths.studies,'execution-package.json'),{
    schema:'tunacad-current-lineage-execution-evidence/1',authority:ticket,input,bridgeReady,
    evidenceOnly:true,replayableAuthority:false,engineeringUsePermitted:false},2*1024*1024);
  let runId:string|null=null,previous:string|null=null,receipts=0,candidateDigest:string|null=null;
  const identity=(record:any)=>{
    assert.equal(record.studyId,ticket.studyId);assert.equal(record.requestDigest,ticket.requestDigest);
    assert.equal(record.executionAuthorityId,ticket.authorityId);assert.equal(record.runtimeDigest,input.provider.runtimeDigest);
    assert.equal(record.providerId,input.provider.providerId);assert.equal(record.providerVersion,input.provider.providerVersion);
    assert.equal(typeof record.providerRunId,'string');runId??=record.providerRunId;assert.equal(record.providerRunId,runId);
  };
  async function saveJson(role:'results'|'completion-catalog',name:string,record:any){
    await storage.assertReady();const path=join(storage.paths[role],name);
    await writeElectrostaticHostOnce(path,record,2*1024*1024);
    assert.equal(digest(await readElectrostaticHostJson(path,2*1024*1024)),digest(record));
    await storage.assertReady();
  }
  const durableEvidence:OpenRadiossDurableSink={
    artifactPolicyDigest:EXPLICIT_ARTIFACT_POLICY_DIGEST,
    async artifacts(record,bytes){
      identity(record);const {recordDigest,...unsigned}=record;assert.equal(digest(unsigned),recordDigest);
      assert.ok(['starter_output_pin','engine_output_pin'].includes(record.phase));
      assert.equal(record.artifactPolicyDigest,EXPLICIT_ARTIFACT_POLICY_DIGEST);validateArtifactPins(record.artifacts);
      for(const [name,pin] of Object.entries(record.artifacts) as Array<[string,{bytes:number;sha256:string}]>){
        assert.match(name,/^[A-Za-z0-9_.-]+$/);const raw=bytes[name];
        assert.ok(raw&&raw.length===pin.bytes&&raw.length<=artifactByteLimit(name));assert.equal(sha256(Buffer.from(raw)),pin.sha256);
        await storage.assertReady();const path=join(storage.paths.results,record.phase+'-'+name);
        const handle=await open(path,'wx',0o600);try{await handle.writeFile(new Uint8Array(raw));await handle.sync();}finally{await handle.close();}
        const stat=await lstat(path);assert.ok(stat.isFile()&&!stat.isSymbolicLink());
        const reopened=await readFile(path);assert.equal(reopened.length,pin.bytes);assert.equal(sha256(reopened),pin.sha256);
      }
      // Commit the manifest only after every byte has been persisted/fsynced/
      // independently reopened. Partial files never represent a completion.
      await saveJson('results',record.phase+'-manifest.json',record);
    },
    async candidate(record){identity(record);const {recordDigest,...unsigned}=record;assert.equal(digest(unsigned),recordDigest);
      assert.equal(digest(record.candidate),record.candidateDigest);candidateDigest=record.candidateDigest;
      await saveJson('results','validated-candidate.json',record);},
  };
  return {durableEvidence,async verifyStorageReadiness(){
    await storage.assertReady();
    const saved=await readElectrostaticHostJson(join(storage.paths.studies,'execution-package.json'),2*1024*1024);
    assert.equal(digest(saved.authority),digest(ticket));assert.equal(digest(saved.input),ticket.inputDigest);
    assert.equal(digest(saved.bridgeReady),ticket.bridgeReadyDigest);await storage.assertReady();
    return {authorityId:ticket.authorityId,inputDigest:ticket.inputDigest,bridgeReadyDigest:ticket.bridgeReadyDigest,
      artifactPolicyDigest:EXPLICIT_ARTIFACT_POLICY_DIGEST};
  },async retainEvidence(record:Readonly<Record<string,unknown>>){
    const r=record as any,{receiptDigest,...unsigned}=r;assert.equal(digest(unsigned),receiptDigest);
    assert.equal(r.studyId,ticket.studyId);assert.equal(r.requestDigest,ticket.requestDigest);
    assert.equal(r.meshDigest,ticket.providerMeshDigest);runId??=r.providerRunId;assert.equal(r.providerRunId,runId);
    assert.equal(r.previousReceiptDigest,previous);if(receipts>=32)throw new Error('Bounded execution receipt count');
    if(r.phase==='prepared'){
      assert.equal(r.binding.authorizationId,ticket.authorityId);assert.equal(r.runtimeDigest,input.provider.runtimeDigest);
    }
    if(r.phase==='result_validated')assert.equal(r.candidateDigest,digest((await readElectrostaticHostJson(
      join(storage.paths.results,'validated-candidate.json'),2*1024*1024)).candidate));
    // finalized is the authenticated publication/cleanup receipt; candidate is
    // explicitly NOT a retrievable result before this boundary.
    const capture={schema:'tunacad-current-lineage-provider-receipt/1',executionAuthorityId:ticket.authorityId,
      at:new Date().toISOString(),receipt:r,candidateDigest,
      terminalStatus:classifyFinalReceipt(r)};
    await saveJson('completion-catalog',String(receipts).padStart(2,'0')+'-'+r.phase+'.json',capture);
    if(capture.terminalStatus==='failed'||capture.terminalStatus==='cancelled'){
      const latch=join(storage.paths['source-catalog'],'execution-quarantine.json');
      // First failure is immutable; later failures cannot clear/reseal it.
      let exists=true;try{await lstat(latch);}catch(e:any){if(e.code==='ENOENT')exists=false;else throw e;}
      if(!exists)await writeElectrostaticHostOnce(latch,{schema:'tunacad-current-execution-quarantine/1',
        authorityId:ticket.authorityId,providerRunId:runId,receiptDigest:r.receiptDigest},4096);
    }
    receipts++;previous=receiptDigest;
  }};
}

/** Fresh native reader, never recreates execution authority from disk. */
export async function reopenProtectedExecutionEvidence(root:string,readFreshInput:()=>Promise<unknown>){
  const storage=await ElectrostaticHostStorage.open(root);
  const pkg=await readElectrostaticHostJson(join(storage.paths.studies,'execution-package.json'),2*1024*1024);
  await validatePrivateExplicitSolve(pkg.bridgeReady.binding);
  assert.equal(digest(await readFreshInput()),pkg.authority.inputDigest,'fresh source/artifacts/runtime changed');
  const names=(await readdir(storage.paths['completion-catalog'])).sort();
  if(names.some((n,i)=>!n.startsWith(String(i).padStart(2,'0')+'-')||!n.endsWith('.json')))throw new Error('Terminal catalog gap/ambiguity');
  const captures=[];for(const n of names)captures.push(await readElectrostaticHostJson(join(storage.paths['completion-catalog'],n),2*1024*1024));
  async function optional(path:string){try{return await readElectrostaticHostJson(path,2*1024*1024);}catch(e:any){if(e.code==='ENOENT')return null;throw e;}}
  const latch=await optional(join(storage.paths['source-catalog'],'execution-quarantine.json'));
  const manifests=[];
  for(const phase of ['starter_output_pin','engine_output_pin']){
    const m=await optional(join(storage.paths.results,phase+'-manifest.json'));if(!m)continue;
    assert.equal(m.artifactPolicyDigest,EXPLICIT_ARTIFACT_POLICY_DIGEST);validateArtifactPins(m.artifacts);
    for(const [name,pin] of Object.entries(m.artifacts) as Array<[string,{sha256:string;bytes:number}]>){
      const path=join(storage.paths.results,phase+'-'+name),s=await lstat(path);
      assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.size===pin.bytes&&s.size<=artifactByteLimit(name));
      const bytes=await readFile(path);assert.equal(bytes.length,pin.bytes);assert.equal(sha256(bytes),pin.sha256);
    }manifests.push(m);
  }
  const candidate=await optional(join(storage.paths.results,'validated-candidate.json'));
  const result=await optional(join(storage.paths.results,'completed-result.json'));
  const verified=verifyExecutionTerminalChain(pkg,captures,manifests,candidate,result,latch);
  assert.equal(digest(await readFreshInput()),pkg.authority.inputDigest,'source changed during replay');
  await storage.assertReady();return {...verified,receipts:captures.map(c=>c.receipt)};
}
