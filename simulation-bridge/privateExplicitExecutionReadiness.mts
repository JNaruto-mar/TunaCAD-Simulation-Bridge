// Shared private terminal-chain verification; never creates approval or authority.
import { digest } from './stableDigest.mts';
import { classifyFinalReceipt,assessDevelopmentValidation,validateArtifactPins,EXPLICIT_ARTIFACT_POLICY_DIGEST } from '../providers/openradioss/OpenRadiossExecutionReadiness.mts';
import { createLauncherEventValidator,type LauncherContext } from '../providers/openradioss/OpenRadiossLauncherTelemetry.mts';

const mandatory=['prepared','starter_launch','starter_output_pin','starter_admitted','engine_admitted',
  'engine_launch','engine_output_pin','result_validated','finalized'];
export function verifyExecutionTerminalChain(pkg:any,captures:any[],manifests:any[],candidate:any,result:any,latch:any=null){
  const fail=(why:string):never=>{throw new Error('DURABLE_TERMINAL_CHAIN_INVALID: '+why);};
  if(pkg?.schema!=='tunacad-current-lineage-execution-evidence/1'||pkg.evidenceOnly!==true||pkg.replayableAuthority!==false)
    fail('execution package');
  const t=pkg.authority,{authorityDigest,...unsigned}=t;
  if(digest(unsigned)!==authorityDigest||digest(pkg.input)!==t.inputDigest||digest(pkg.bridgeReady)!==t.bridgeReadyDigest||
    pkg.bridgeReady.solveApproval.authorizationId!==t.bridgeApprovalId||
    pkg.bridgeReady.solveApproval.bindingDigest!==digest(pkg.bridgeReady.binding))fail('package bindings');
  if(!captures.length||captures.length>32)fail('receipt count');
  let previous:string|null=null,runId:string|null=null,terminal:'succeeded'|'failed'|'cancelled'|null=null,sticky=false;
  const receipts=captures.map(c=>{
    const r=c.receipt,{receiptDigest,...u}=r;runId??=r.providerRunId;
    if(c.schema!=='tunacad-current-lineage-provider-receipt/1'||c.executionAuthorityId!==t.authorityId||
      digest(u)!==receiptDigest||r.previousReceiptDigest!==previous||r.providerRunId!==runId||
      r.studyId!==t.studyId||r.requestDigest!==t.requestDigest||r.meshDigest!==t.providerMeshDigest)fail('receipt identity/chain');
    previous=receiptDigest;const classified=classifyFinalReceipt(r);
    if(c.terminalStatus!==classified)fail('terminal classification');
    if(classified==='failed'||classified==='cancelled'){sticky=true;terminal=terminal==='failed'?'failed':classified;}
    else if(classified==='succeeded'&&!sticky)terminal='succeeded';return r;
  });
  if(latch){if(latch.schema!=='tunacad-current-execution-quarantine/1'||latch.authorityId!==t.authorityId||
    latch.providerRunId!==runId||!receipts.some(r=>r.receiptDigest===latch.receiptDigest&&
      ['failed','cancelled'].includes(classifyFinalReceipt(r)??'')))fail('sticky latch');
    sticky=true;terminal=terminal==='cancelled'?'cancelled':'failed';}
  if(sticky)return {status:terminal,verified:true,result:null,aggregate:assessDevelopmentValidation(terminal,'PENDING',true)};
  if((terminal as string|null)!=='succeeded')fail('missing successful finalized receipt');
  let at=-1;for(const phase of mandatory){const found=receipts.flatMap((r,i)=>r.phase===phase?[i]:[]);
    if(found.length!==1||found[0]<=at)fail('missing/duplicate/reordered '+phase);at=found[0];}
  if(receipts.some(r=>!mandatory.includes(r.phase)&&!['starter_launcher_event','engine_launcher_event'].includes(r.phase)))
    fail('unknown successful-chain phase');
  if(manifests.length!==2)fail('manifest count');
  const prepared=receipts[0];if(prepared.phase!=='prepared'||prepared.binding.authorizationId!==t.authorityId||
    prepared.runtimeDigest!==pkg.input.provider.runtimeDigest)fail('prepared authority/runtime');
  for(const stage of ['starter','engine']){
    const launch=receipts.find(r=>r.phase===stage+'_launch'),pin=receipts.find(r=>r.phase===stage+'_output_pin');
    const context:LauncherContext={launchId:launch.launchId,stage:stage as 'starter'|'engine',
      executable:stage==='starter'?pkg.input.config.starterExecutable:pkg.input.config.engineExecutable,executableSha256:launch.executableSha256,
      argumentDigest:launch.argumentDigest,inputDigest:launch.inputDigest};
    const validator=createLauncherEventValidator(context,()=>pin.wrapperPid);
    for(const r of receipts.filter(r=>r.phase===stage+'_launcher_event')){
      if(receipts.indexOf(r)<=receipts.indexOf(launch)||receipts.indexOf(r)>=receipts.indexOf(pin))fail('launcher receipt placement');
      if(r.launchId!==launch.launchId)fail('launcher identity');validator.accept(r.event);
    }
    if(!validator.complete()||digest(validator.snapshot())!==digest(pin.launcherEvidence.events)||
      pin.childSolverPid!==validator.childSolverPid()||pin.exitCode!==0||pin.error||pin.captureFailure||
      !pin.treeTerminated||!pin.launcherEvidence.ownedTreeComplete)fail('launcher/completion evidence');
    const manifest=manifests.filter(m=>m.phase===stage+'_output_pin');if(manifest.length!==1)fail('stage manifest');
    const m=manifest[0],{recordDigest,...u}=m;
    if(m.schema!=='tunacad-openradioss-durable-artifacts/1'||m.artifactPolicyDigest!==EXPLICIT_ARTIFACT_POLICY_DIGEST||
      digest(u)!==recordDigest||m.providerRunId!==runId||m.studyId!==t.studyId||m.requestDigest!==t.requestDigest||
      m.executionAuthorityId!==t.authorityId||m.runtimeDigest!==pkg.input.provider.runtimeDigest||
      m.runtimeManifestDigest!==pkg.input.provider.runtimeManifestDigest||m.providerId!==pkg.input.provider.providerId||
      m.providerVersion!==pkg.input.provider.providerVersion||m.wrapperPid!==pin.wrapperPid||m.childSolverPid!==pin.childSolverPid)
      fail('manifest identities');
    validateArtifactPins(m.artifacts);validateArtifactPins(pin.artifacts);
    for(const [name,p] of Object.entries(pin.artifacts))if(digest(m.artifacts[name])!==digest(p))fail('artifact pins');
    const expectedInput=stage==='starter'?prepared.decks:receipts.find(r=>r.phase==='starter_output_pin').artifacts;
    if(launch.inputDigest!==digest(expectedInput)||launch.argumentDigest!==digest(launch.args)||launch.executable!==context.executable||
      launch.executableSha256!==(stage==='starter'?pkg.input.config.starterSha256:pkg.input.config.engineSha256))fail('launch/deck/runtime pins');
  }
  if(!candidate||!result)fail('missing candidate/result');
  const {recordDigest,...u}=candidate,{resultDigest,...normalized}=result;
  const validated=receipts.find(r=>r.phase==='result_validated'),finalized=receipts.find(r=>r.phase==='finalized');
  if(digest(u)!==recordDigest||candidate.providerRunId!==runId||candidate.executionAuthorityId!==t.authorityId||
    candidate.runtimeDigest!==pkg.input.provider.runtimeDigest||digest(candidate.candidate)!==candidate.candidateDigest||
    candidate.candidateDigest!==validated.candidateDigest||!validated.t01UnchangedAfterParsing||
    candidate.t01Sha256!==validated.t01Sha256||candidate.t01Sha256!==manifests.find(m=>m.phase==='engine_output_pin').artifacts.ExplicitBarProbeT01.sha256||
    digest(normalized)!==resultDigest||resultDigest!==finalized.resultDigest||result.cleanupConfirmed!==true||result.executionStatus!=='succeeded'||
    digest({...candidate.candidate,executionStatus:'succeeded',cleanupConfirmed:true})!==resultDigest)
    fail('candidate/result/final bindings');
  if(candidate.candidate.requestDigest!==t.requestDigest||candidate.candidate.studyId!==t.studyId||
    candidate.candidate.providerRunId!==runId)fail('normalized result identity');
  const starter=receipts.find(r=>r.phase==='starter_output_pin'),engine=receipts.find(r=>r.phase==='engine_output_pin');
  if(receipts.find(r=>r.phase==='engine_admitted').inputPinDigest!==digest(starter.artifacts))fail('engine input provenance');
  for(const name of ['ExplicitBarProbe_0000_0001.rst','ExplicitBarProbe_0001.rad'])
    if(digest(engine.artifacts[name])!==digest(starter.artifacts[name]))fail('restart/deck substituted');
  if(candidate.candidate.provenanceDigest!==digest(receipts.slice(0,receipts.indexOf(validated))))fail('candidate receipt provenance');
  return {status:'succeeded' as const,verified:true,result:structuredClone(result),aggregate:assessDevelopmentValidation('succeeded','PENDING',true)};
}

export function canonicalExecutionCounts(receipts:any[],invocations:number,acceptedRuns:number){
  if(!Number.isSafeInteger(invocations)||invocations<0||invocations>1||!Number.isSafeInteger(acceptedRuns)||acceptedRuns<0||acceptedRuns>invocations)
    throw new Error('CANONICAL_SUBMISSION_COUNTS');
  const out:any={providerSubmissions:invocations,acceptedRuns};
  for(const stage of ['starter','engine']){
    const intents=receipts.filter(r=>r.phase===stage+'_launch');
    if(intents.length>1)throw new Error('CANONICAL_DUPLICATE_INTENT');
    out[stage+'LaunchIntents']=intents.length;
    const events=receipts.filter(r=>r.phase===stage+'_launcher_event');
    // Suspended OS object creation is NOT application execution.
    const created=events.filter(r=>r.event.event==='child_resumed');
    const identities=new Set<string>();for(const r of events){const id=r.launchId+':'+r.event.sequence;
      if(identities.has(id))throw new Error('CANONICAL_DUPLICATE_EVENT');identities.add(id);
      if(!intents.some(i=>i.launchId===r.launchId)||r.event.launchId!==r.launchId)throw new Error('CANONICAL_EVENT_BINDING');}
    if(events.length){const i=intents[0],first=events[0].event;
      const validator=createLauncherEventValidator({launchId:i.launchId,stage:stage as 'starter'|'engine',executable:i.executable,
        executableSha256:i.executableSha256,argumentDigest:i.argumentDigest,inputDigest:i.inputDigest},()=>first.wrapperPid);
      for(const r of events)validator.accept(r.event);}
    out[stage+'ActualExecutions']=created.length?created.length:intents.length?'UNKNOWN':0;
  }return out;
}
