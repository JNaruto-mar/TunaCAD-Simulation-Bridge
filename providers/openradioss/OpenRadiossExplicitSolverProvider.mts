import { mkdtemp, writeFile, readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { digest } from '../../simulation-bridge/stableDigest.mts';
import type { ExplicitDynamicsRequest } from '../../simulation-bridge/explicitDynamicsFoundation.mts';
import type { PrivateExplicitSolverProvider, ExplicitDynamicsResult, ExplicitProviderStatus, ExplicitDynamicsFieldPage }
  from '../../src/simulation/explicitDynamicsProviderContracts.ts';
import { removeWorkingDirectory } from '../processLifecycle.mts';
import { prepareOpenRadiossDeck, RUN_NAME, type PreparedOpenRadioss } from './OpenRadiossDeck.mts';
import { inspectOpenRadiossInstallation, consumeNativeOpenRadiossInspection, sha256, type OpenRadiossInstallation } from './OpenRadiossInstallation.mts';
import { admitOpenRadiossStarter } from './OpenRadiossStarterAdmission.mts';
import { nativeOpenRadiossProcessDriver, type OpenRadiossProcessDriver, type OpenRadiossProcessTask } from './OpenRadiossProcess.mts';
import { recoverOpenRadiossResult, pageExplicitResult } from './OpenRadiossResult.mts';
import { OpenRadiossDurableCapture,type OpenRadiossDurableSink } from './OpenRadiossDurableCapture.mts';
import { artifactByteLimit,validateArtifactPins,EXPLICIT_ARTIFACT_POLICY_DIGEST,
  admitExecutionDeadline,createExecutionBudget,requireOwnedTreeReadiness,classifyFinalReceipt } from './OpenRadiossExecutionReadiness.mts';
import { createExecutionHeadroomLedger,requireExecutionHeadroomBinding,type ExecutionHeadroomLedger,type ExecutionStage }
  from './OpenRadiossExecutionReadiness.mts';
import { requireExecutionBudgetBinding,type ExecutionBudget } from './OpenRadiossExecutionReadiness.mts';

export interface ApprovedExplicitBinding {
  authorizationId:string; requestDigest:string; meshDigest:string; revision:string; geometryDigest:string;
}
export interface OpenRadiossHost {
  executionDeadline:number;
  /** In-memory trusted host port, not serializable approval/request data. */
  executionHeadroom?:ExecutionHeadroomLedger;
  /** Trusted host composite verifier owns its source/storage/runtime operations
   * on this SAME cumulative ledger. No serialized budget or reset per rebind. */
  executionBudget?:ExecutionBudget;
  /** Trusted Bridge owner must freshly check source AND existing authorization.
   * This is not an approval supplied by study data or a public bypass flag. */
  rebindApprovedInput(binding:ApprovedExplicitBinding,stage:'submit'|'starter'|'engine'|'result'):Promise<ApprovedExplicitBinding>;
  /** Trusted native owner can perform source/artifact/runtime verification as
   * ONE transaction. Runtime evidence must be native, fresh during this call,
   * unchanged and single-use; serialized/cached/caller evidence is rejected. */
  rebindVerifiedInput?(binding:ApprovedExplicitBinding,stage:'submit'|'starter'|'engine'|'result'):
    Promise<{binding:ApprovedExplicitBinding;installation:Awaited<ReturnType<typeof inspectOpenRadiossInstallation>>}>;
  readAuthorization(requestDigest:string,meshDigest:string):Promise<ApprovedExplicitBinding>;
  /** Required protected host-owned sink, separate from disposable solver scratch.
   * Failure to retain a receipt blocks launch/publication. No raw output retained. */
  retainEvidence(receipt:Readonly<Record<string,unknown>>):Promise<void>;
  durableEvidence?:OpenRadiossDurableSink;
}
type Run={id:string;prepared:PreparedOpenRadioss;binding:ApprovedExplicitBinding;
  installation:Awaited<ReturnType<typeof inspectOpenRadiossInstallation>>;status:ExplicitProviderStatus;
  directory:string|null;active:OpenRadiossProcessTask|null;cancelled:boolean;treeSafe:boolean;
  result:ExplicitDynamicsResult|null;quarantined:boolean;records:Array<Record<string,unknown>>;
  finished:Promise<void>;failure:string|null;durable:OpenRadiossDurableCapture|null;
  budget:ReturnType<typeof createExecutionBudget>;headroom:ExecutionHeadroomLedger};
/** Provider-private only. Deliberately absent from providers.mts, Companion,
 * browser/MCP selection and production capability metadata. No benchmark oracle. */
export class OpenRadiossExplicitSolverProvider implements PrivateExplicitSolverProvider {
  readonly id='tunacad-openradioss-explicit-private'; readonly version='0.1.0-poc';
  private readonly runs=new Map<string,Run>();
  private readonly usedAuthorizations=new Set<string>();
  private readonly config:OpenRadiossInstallation;
  private readonly host:OpenRadiossHost;
  private readonly driver:OpenRadiossProcessDriver;
  private readonly cleanup:(path:string)=>Promise<boolean>;
  constructor(config:OpenRadiossInstallation,host:OpenRadiossHost,
    driver:OpenRadiossProcessDriver=nativeOpenRadiossProcessDriver,
    cleanup:(path:string)=>Promise<boolean>=removeWorkingDirectory) {
    this.config=structuredClone(config);
    this.host=host;this.driver=driver;this.cleanup=cleanup;
  }
  async submit(request:ExplicitDynamicsRequest,mesh:unknown) {
    if(this.driver===nativeOpenRadiossProcessDriver)requireOwnedTreeReadiness();
    if(this.host.executionBudget)requireExecutionBudgetBinding(this.host.executionBudget,this.host.executionDeadline);
    admitExecutionDeadline(this.host.executionDeadline,Date.now(),this.host.executionHeadroom);
    if(this.host.durableEvidence?.artifactPolicyDigest!==EXPLICIT_ARTIFACT_POLICY_DIGEST)
      throw new Error('DURABLE_ARTIFACT_POLICY_MISMATCH');
    if(this.runs.size>=16||[...this.runs.values()].some(r=>['queued','running'].includes(r.status.status)))
      throw new Error('Private explicit provider run/resource bound');
    const prepared=prepareOpenRadiossDeck(request,structuredClone(mesh));
    const binding=await this.host.readAuthorization(prepared.request.requestDigest,prepared.meshDigest);
    if(!binding.authorizationId || binding.requestDigest!==prepared.request.requestDigest || binding.meshDigest!==prepared.meshDigest ||
      binding.revision!==prepared.request.model.projectRevision || binding.geometryDigest!==prepared.request.model.geometryDigest)
      throw new Error('Missing/mismatched approved immutable explicit input');
    this.host.executionHeadroom?.invalidate('runtime');
    const budget=this.host.executionBudget??createExecutionBudget(this.host.executionDeadline);
    let installation:Awaited<ReturnType<typeof inspectOpenRadiossInstallation>>;
    if(this.host.rebindVerifiedInput)installation=await this.verifiedHostInput(binding,'submit');
    else {
      if(digest(await this.host.rebindApprovedInput(binding,'submit'))!==digest(binding)) throw new Error('Stale explicit approval/source');
      installation=await budget.verify('runtime','provider_submission_runtime',()=>inspectOpenRadiossInstallation(this.config));
    }
    const id=randomUUID();
    const headroomIdentity={authorityId:binding.authorizationId,expiresAt:this.host.executionDeadline,
      lineageDigest:digest({requestDigest:prepared.request.requestDigest,meshDigest:prepared.meshDigest,revision:binding.revision,
        geometryDigest:binding.geometryDigest,runtimeDigest:installation.runtimeDigest,deckDigest:'sha256:'+sha256(prepared.starter+prepared.engine)})};
    const headroom=this.host.executionHeadroom??createExecutionHeadroomLedger(headroomIdentity);
    requireExecutionHeadroomBinding(headroom,headroomIdentity);
    await headroom.verifyStages(['source','runtime'],async()=>({binding,installation}),(_stage,value)=>{
      if(digest(value.binding)!==digest(binding)||value.installation.runtimeDigest!==installation.runtimeDigest)
        throw new Error('Unverified explicit source/runtime headroom evidence');
      return {authorityId:binding.authorizationId,lineageDigest:headroomIdentity.lineageDigest,outputDigest:digest(value)};
    });
    admitExecutionDeadline(this.host.executionDeadline,Date.now(),headroom);
    if(this.runs.size>=16||[...this.runs.values()].some(r=>['queued','running'].includes(r.status.status)))
      throw new Error('Private explicit provider concurrent admission/resource bound');
    if(this.usedAuthorizations.has(binding.authorizationId)) throw new Error('Explicit authorization already consumed');
    this.usedAuthorizations.add(binding.authorizationId);
    const run:Run={id,prepared,binding:structuredClone(binding),installation,directory:null,active:null,cancelled:false,treeSafe:true,
      result:null,quarantined:false,records:[],finished:Promise.resolve(),failure:null,
      durable:this.host.durableEvidence?new OpenRadiossDurableCapture(this.host.durableEvidence):null,
      budget,headroom,
      status:{providerRunId:id,status:'queued',progress:null,phase:'queued',updatedAt:new Date().toISOString()}};
    this.runs.set(id,run);
    // Yield first: caller receives identity before execution; queued cancellation wins.
    run.finished=Promise.resolve().then(()=>this.execute(run));
    return {providerRunId:id,acceptedAt:new Date().toISOString()};
  }
  async getStatus(id:string) {return structuredClone(this.get(id).status);}
  async getResult(id:string):Promise<ExplicitDynamicsResult|null> {
    const run=this.get(id);
    if(run.status.status!=='succeeded'||run.cancelled||run.quarantined||!run.result) return null;
    try {
      await this.rebind(run,'result');
      const {resultDigest,...unsigned}=run.result;
      if(digest(unsigned)!==resultDigest) throw new Error('Changed normalized result digest');
      return structuredClone(run.result);
    } catch(error) {run.result=null;run.quarantined=true;
      this.state(run,'failed','retrieval_quarantined',String(error));await this.record(run,'retrieval_quarantined',{reason:String(error)});return null;}
  }
  async getFieldDataset(id:string,frameIndex:number,quantity:ExplicitDynamicsFieldPage['quantity'],cursor?:string,limit?:number) {
    const result=await this.getResult(id); if(!result) throw new Error('No completed explicit result');
    return pageExplicitResult(result,frameIndex,quantity,cursor,limit);
  }
  async cancel(id:string) {
    const run=this.get(id);
    if(['succeeded','failed','cancelled'].includes(run.status.status)) return this.getStatus(id);
    run.cancelled=true;run.result=null;run.quarantined=true;
    if(run.active) {
      try {run.treeSafe=await run.active.terminateTree();} catch {run.treeSafe=false;}
      if(!run.treeSafe) run.failure='process-tree termination not confirmed';
    }
    await run.finished;
    return this.getStatus(id);
  }
  private get(id:string) {const r=this.runs.get(id);if(!r) throw new Error('Unknown explicit run');return r;}
  private state(run:Run,status:ExplicitProviderStatus['status'],phase:string,failure?:string) {
    run.status={providerRunId:run.id,status,progress:null,phase,updatedAt:new Date().toISOString(),
      ...(failure?{failure:{code:'EXPLICIT_PROVIDER_QUARANTINED',message:failure.slice(0,12000)}}:{})};
  }
  private alive(run:Run) {if(run.cancelled) throw new Error('Cancelled explicit run');}
  private headroomProof(run:Run,value:unknown){return {authorityId:run.binding.authorizationId,
    lineageDigest:run.headroom.identity.lineageDigest,outputDigest:digest(value)};}
  private async completeRecordedStage(run:Run,stage:ExecutionStage,phase:string){
    await run.headroom.verifyStages([stage],async()=>run.records.at(-1)!,(_stage,value)=>{
      const {receiptDigest,...unsigned}=value;
      if(!run.records.includes(value)||value.phase!==phase||digest(unsigned)!==receiptDigest||
        value.providerRunId!==run.id||value.requestDigest!==run.prepared.request.requestDigest||value.meshDigest!==run.prepared.meshDigest)
        throw new Error('Unbound headroom stage receipt');
      if(stage==='storage'&&(value.runtimeDigest!==run.installation.runtimeDigest||value.binding===undefined||
        digest(value.binding)!==digest(run.binding)||!value.decks))throw new Error('Invalid protected preparation receipt');
      if((stage==='starter'||stage==='engine')&&(value.exitCode!==0||value.error||value.captureFailure||
        value.treeTerminated!==true||!(value.launcherEvidence as any)?.provenanceComplete||!(value.launcherEvidence as any)?.ownedTreeComplete))
        throw new Error('Invalid completed process evidence');
      if(stage==='handoff'&&(value.runtimeDigest!==run.installation.runtimeDigest||value.inputPinDigest!==
        digest(run.records.find(r=>r.phase==='starter_output_pin')?.artifacts)))throw new Error('Invalid handoff evidence');
      if(stage==='durable'&&(value.t01UnchangedAfterParsing!==true||!value.candidateDigest||!value.t01Sha256))
        throw new Error('Invalid durable candidate receipt');
      if(stage==='finalization'&&(value.cleaned!==true||value.treeTerminated!==true||value.quarantined||value.cancelled||
        value.failure||!value.resultDigest))throw new Error('Invalid finalization receipt');
      return this.headroomProof(run,value);
    });
    admitExecutionDeadline(this.host.executionDeadline,Date.now(),run.headroom);
  }
  private async verifyRuntime(run:Run,message:string){
    try {await run.headroom.verifyStages(['runtime'],()=>run.budget.verify('runtime','provider_launch_runtime',()=>inspectOpenRadiossInstallation(this.config)),(_stage,value)=>{
      if(value.runtimeDigest!==run.installation.runtimeDigest)throw new Error(message);return this.headroomProof(run,value);
    });}catch(error){run.headroom.invalidateAll();throw error;}
  }
  private async verifiedHostInput(binding:ApprovedExplicitBinding,stage:'submit'|'starter'|'engine'|'result'){
    const notBefore=performance.now();
    const current=await this.host.rebindVerifiedInput!(structuredClone(binding),stage);
    if(digest(current.binding)!==digest(binding))throw new Error('Changed approved native input');
    return consumeNativeOpenRadiossInspection(this.config,current.installation,notBefore);
  }
  private async record(run:Run,phase:string,data:Record<string,unknown>) {
    const unsigned={schema:'tunacad-explicit-provider-receipt/0.1',providerRunId:run.id,studyId:run.prepared.request.studyId,
      requestDigest:run.prepared.request.requestDigest,meshDigest:run.prepared.meshDigest,phase,previousReceiptDigest:run.records.at(-1)?.receiptDigest??null,
      verificationTiming:run.budget.diagnostics(),...data};
    const receipt={...unsigned,receiptDigest:digest(unsigned)};
    try{await run.budget.run('storage',()=>this.host.retainEvidence(structuredClone(receipt)),true);}
    catch(error){run.durable?.markFailed();throw error;}
    run.records.push(receipt);
  }
  private async rebind(run:Run,stage:'starter'|'engine'|'result') {
    const read=()=>this.host.rebindApprovedInput(structuredClone(run.binding),stage);
    const completed=run.status.status==='succeeded';if(!completed)run.headroom.invalidate('source');
    try{
      // The host may verify the SAME ledger during this read. Do not wrap that
      // nested verification with an older epoch; validate its returned binding.
      // Composite trusted host ports account each component themselves. The
      // legacy provider-only port is source-only, not the native composite.
      let binding:ApprovedExplicitBinding;
      if(this.host.rebindVerifiedInput){
        const installation=await this.verifiedHostInput(run.binding,stage);
        if(installation.runtimeDigest!==run.installation.runtimeDigest||installation.manifestDigest!==run.installation.manifestDigest)
          throw new Error('Changed freshly rebound runtime');
        binding=run.binding;
        if(!completed)await run.headroom.verifyStages(['runtime'],async()=>installation,(_stage,value)=>this.headroomProof(run,value));
      }else binding=completed||this.host.executionBudget?await read():
        await run.budget.verify('source','provider_source_only_rebind',read);
      if(digest(binding)!==digest(run.binding))throw new Error('Changed approved source/request/mesh/revision');
      if(!completed)await run.headroom.verifyStages(['source'],async()=>binding,(_stage,value)=>{
        if(digest(value)!==digest(run.binding))throw new Error('Changed approved source/request/mesh/revision');return this.headroomProof(run,value);
      });
      this.alive(run);
    }catch(error){run.headroom.invalidateAll();throw error;}
  }
  private async bytes(run:Run,name:string,maximum=8*1024*1024) {
    return run.budget.run('storage',async()=>{
    const path=join(run.directory!,name),s=await lstat(path);
    if(!s.isFile()||s.isSymbolicLink()||s.size<1||s.size>maximum) throw new Error('Missing/ambiguous/oversized provider artifact');
    const bytes=await readFile(path);if(bytes.length!==s.size) throw new Error('Artifact mutated while reading');return bytes;
    },true);
  }
  private async pin(run:Run,names:string[]) {
    const artifacts:Record<string,{sha256:string;bytes:number}>={};
    for(const name of names) {const bytes=await this.bytes(run,name,artifactByteLimit(name));
      artifacts[name]={sha256:sha256(bytes),bytes:bytes.length};}
    validateArtifactPins(artifacts);return artifacts;
  }
  private async stage(run:Run,stage:'starter'|'engine',inputPin:Awaited<ReturnType<typeof this.pin>>) {
    this.alive(run);
    this.state(run,'running',stage);
    const executable=stage==='starter'?this.config.starterExecutable:this.config.engineExecutable;
    const launchId=randomUUID();
    const args=['-i',`${RUN_NAME}_${stage==='starter'?'0000':'0001'}.rad`,...(stage==='starter'?['-np','1']:[])];
    await this.record(run,stage+'_launch',{launchId,executable,inputDigest:digest(inputPin),argumentDigest:digest(args),
      executableSha256:stage==='starter'?this.config.starterSha256:this.config.engineSha256,
      runtimeDigest:run.installation.runtimeDigest,args,automaticRetries:0});
    if(!this.host.rebindVerifiedInput)await this.verifyRuntime(run,'Runtime provenance changed at launch boundary');
    await this.rebind(run,stage);
    if(digest(await this.pin(run,Object.keys(inputPin)))!==digest(inputPin)) throw new Error('Input provenance changed at launch boundary');
    await run.headroom.verifyStages(['runtime'],()=>run.budget.verify('runtime','launch_executable_identity',async()=>{
    const executableStat=await lstat(executable);
    if(!executableStat.isFile()||executableStat.isSymbolicLink()||executableStat.size>256*1024*1024)
      throw new Error('Executable provenance changed at launch boundary');
    const executableHash=sha256(await readFile(executable));
    if(executableHash!==(stage==='starter'?this.config.starterSha256:this.config.engineSha256))
      throw new Error('Executable provenance changed at launch boundary');
    return {executable,sha256:executableHash,bytes:executableStat.size,runtimeDigest:run.installation.runtimeDigest};
    }),(_stage,value)=>{
      if(value.executable!==executable||value.sha256!==(stage==='starter'?this.config.starterSha256:this.config.engineSha256)||
        value.runtimeDigest!==run.installation.runtimeDigest)throw new Error('Invalid executable headroom evidence');
      return this.headroomProof(run,value);
    });
    this.alive(run); // cancellation during protected receipt write must not launch.
    admitExecutionDeadline(this.host.executionDeadline,Date.now(),run.headroom);
    const task=await this.driver.start(executable,args,{cwd:run.directory!,environment:{...process.env,...run.installation.environment},
      beforeCreate:()=>{this.alive(run);admitExecutionDeadline(this.host.executionDeadline,Date.now(),run.headroom);},
      telemetry:{launchId,stage,executableSha256:stage==='starter'?this.config.starterSha256:this.config.engineSha256,
        inputDigest:digest(inputPin),retain:async event=>{await this.record(run,stage+'_launcher_event',{launchId,event});}}});
    run.active=task;run.treeSafe=false;
    let timer:ReturnType<typeof setTimeout>|undefined;
    try {
      const result=await run.budget.run(stage,()=>Promise.race([task.completion,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Provider stage watchdog')),65000);})]));
      run.treeSafe=result.treeTerminated;run.active=null;
      if(result.stdout.length+result.stderr.length>8*1024*1024) throw new Error('Process output resource bound');
      const names=stage==='starter'?[`${RUN_NAME}_0000.out`,`${RUN_NAME}_0000_0001.rst`,`${RUN_NAME}_0001.rad`,`${RUN_NAME}_0000.rad`]:
        [`${RUN_NAME}_0001.out`,`${RUN_NAME}T01`,`${RUN_NAME}_0000_0001.rst`,`${RUN_NAME}_0001.rad`];
      // FIRST post-return activity: capture produced bytes/digests, before admission,
      // interpretation, cleanup, source reads or any next-stage execution.
      let artifacts:Awaited<ReturnType<typeof this.pin>>={},captureFailure:string|null=null;
      try {artifacts=await this.pin(run,names);} catch(error) {captureFailure=String(error);}
      if(captureFailure)run.durable?.markFailed(); // retain bounded partial output rather than discard the only T01
      const pin={exitCode:result.exitCode,error:result.error,wrapperPid:task.wrapperPid??task.pid,
        childSolverPid:result.launcherEvidence?.childSolverPid??null,launcherEvidence:result.launcherEvidence??null,
        treeTerminated:result.treeTerminated,
        stdoutSha256:sha256(result.stdout),stderrSha256:sha256(result.stderr),artifacts,
        capturedBeforeInterpretation:true,captureFailure,
        diagnosticStdout:result.stdout.toString('utf8').slice(-12000),diagnosticStderr:result.stderr.toString('utf8').slice(-12000)};
      if(run.durable&&Object.keys(artifacts).length){
        try {
        const retained:Record<string,Uint8Array>={};
        for(const [name,expected] of Object.entries(artifacts)){
          const bytes=await this.bytes(run,name,artifactByteLimit(name));
          if(sha256(bytes)!==expected.sha256||bytes.length!==expected.bytes)throw new Error('Changed artifact before durable capture');
          retained[name]=new Uint8Array(bytes);
        }
        // Full logs, not only the bounded receipt tail. Empty stderr is recorded
        // by its digest in the receipt; an empty file is not a binary artifact.
        if(result.stdout.length)retained[stage+'.stdout.txt']=new Uint8Array(result.stdout);
        if(result.stderr.length)retained[stage+'.stderr.txt']=new Uint8Array(result.stderr);
        await run.budget.run('durable',()=>run.durable!.artifacts({providerRunId:run.id,studyId:run.prepared.request.studyId,
          requestDigest:run.prepared.request.requestDigest,executionAuthorityId:run.binding.authorizationId,
          providerId:this.id,providerVersion:this.version,runtimeDigest:run.installation.runtimeDigest,
          runtimeManifestDigest:run.installation.manifestDigest,phase:stage+'_output_pin',capturedAt:new Date().toISOString(),
          exitCode:result.exitCode,wrapperPid:task.wrapperPid??task.pid,childSolverPid:result.launcherEvidence?.childSolverPid??null,
          t01Thicode:stage==='engine'&&retained[`${RUN_NAME}T01`]?.length>=8
            ?Buffer.from(retained[`${RUN_NAME}T01`]).readInt32BE(4):null},retained),true);
        }catch(error){run.durable.markFailed();throw error;}
      }
      await this.record(run,stage+'_output_pin',pin);
      await writeFile(join(run.directory!,stage+'.stdout.txt'),new Uint8Array(result.stdout),{flag:'wx'});
      await writeFile(join(run.directory!,stage+'.stderr.txt'),new Uint8Array(result.stderr),{flag:'wx'});
      this.alive(run);
      if(result.exitCode!==0||result.error||!result.treeTerminated||!result.launcherEvidence?.provenanceComplete||
        !result.launcherEvidence.ownedTreeComplete||captureFailure) throw new Error(stage+' failure: '+(result.error??captureFailure??'incomplete launcher/tree evidence'));
      return {pin,stdout:result.stdout.toString('utf8'),stderr:result.stderr.toString('utf8')};
    } finally {if(timer) clearTimeout(timer);}
  }
  private async execute(run:Run) {
    let candidate:ReturnType<typeof recoverOpenRadiossResult>|null=null;
    try {
      admitExecutionDeadline(this.host.executionDeadline,Date.now(),run.headroom);
      this.alive(run);run.directory=await mkdtemp(join(tmpdir(),'tunacad-openradioss-provider-'));
      const p=run.prepared;
      run.headroom.invalidate('storage');
      await writeFile(join(run.directory,`${RUN_NAME}_0000.rad`),p.starter,{flag:'wx'});
      await writeFile(join(run.directory,`${RUN_NAME}_0001.rad`),p.engine,{flag:'wx'});
      const decks=await this.pin(run,[`${RUN_NAME}_0000.rad`,`${RUN_NAME}_0001.rad`]);
      await this.record(run,'prepared',{binding:run.binding,materialDigest:digest(p.request.material),geometryDigest:p.request.model.geometryDigest,
        runtime:run.installation.identity,runtimeDigest:run.installation.runtimeDigest,decks,expected:p.expected,
        durationS:p.request.analysis.durationS,historyIntervalS:p.historyIntervalS,dtNodaScale:p.dtNodaScale,minimumTimestepS:0,
        maximumIncrements:p.request.analysis.integration.maximumIncrements});
      await this.completeRecordedStage(run,'storage','prepared');
      // Native transactions perform ALL checks freshly after the launch receipt,
      // immediately before spawn. Do not hash the same boundary twice.
      if(!this.host.rebindVerifiedInput){await this.rebind(run,'starter');await this.verifyRuntime(run,'Runtime changed before Starter');}
      const starter=await this.stage(run,'starter',decks);
      await this.completeRecordedStage(run,'starter','starter_output_pin');
      const listing=(await this.bytes(run,`${RUN_NAME}_0000.out`)).toString('utf8');
      if(sha256(listing)!==starter.pin.artifacts[`${RUN_NAME}_0000.out`].sha256) throw new Error('Starter listing changed before admission');
      const admission=await run.budget.run('handoff',async()=>admitOpenRadiossStarter(listing,p));
      await this.record(run,'starter_admitted',{admission,starterOutputPinDigest:run.records.at(-1)!.receiptDigest});
      if(!this.host.rebindVerifiedInput){await this.verifyRuntime(run,'Runtime changed before Engine');await this.rebind(run,'engine');}
      const inputs=await this.pin(run,Object.keys(starter.pin.artifacts));
      if(digest(inputs)!==digest(starter.pin.artifacts)||inputs[`${RUN_NAME}_0000.rad`].sha256!==decks[`${RUN_NAME}_0000.rad`].sha256 ||
        inputs[`${RUN_NAME}_0001.rad`].sha256!==decks[`${RUN_NAME}_0001.rad`].sha256) throw new Error('Changed contemporaneously bound restart/deck/listing');
      await this.record(run,'engine_admitted',{inputPinDigest:digest(inputs),runtimeDigest:run.installation.runtimeDigest});
      await this.completeRecordedStage(run,'handoff','engine_admitted');
      const engine=await this.stage(run,'engine',inputs);
      await this.completeRecordedStage(run,'engine','engine_output_pin');
      const final=await this.pin(run,Object.keys(engine.pin.artifacts));
      if(digest(final)!==digest(engine.pin.artifacts)||final[`${RUN_NAME}_0000_0001.rst`].sha256!==inputs[`${RUN_NAME}_0000_0001.rst`].sha256 ||
        final[`${RUN_NAME}_0001.rad`].sha256!==inputs[`${RUN_NAME}_0001.rad`].sha256) throw new Error('Changed completed input/output/runtime provenance');
      // Native recovery rebind below verifies the complete runtime again before
      // candidate publication; no trust is carried from the Engine boundary.
      if(!this.host.rebindVerifiedInput)await this.verifyRuntime(run,'Changed completed input/output/runtime provenance');
      const artifacts=Object.fromEntries([...Object.entries(decks),...Object.entries(inputs),...Object.entries(final)].map(([name,v])=>[name,v.sha256]));
      artifacts.cycleTrace=sha256(engine.stdout);
      candidate=await run.budget.run('recovery',async()=>recoverOpenRadiossResult(p,await this.bytes(run,`${RUN_NAME}T01`),engine.stdout,
        (await this.bytes(run,`${RUN_NAME}_0001.out`)).toString('utf8'),{providerRunId:run.id,providerId:this.id,providerVersion:this.version,
          runtimeDigest:run.installation.runtimeDigest,artifacts,provenanceDigest:digest(run.records)}));
      if(sha256(await this.bytes(run,`${RUN_NAME}T01`))!==final[`${RUN_NAME}T01`].sha256)
        throw new Error('T01 changed during direct recovery');
      await this.rebind(run,'result');
      await run.headroom.verifyStages(['recovery'],async()=>candidate!,(_stage,value)=>{
        if(value.providerRunId!==run.id||value.requestDigest!==p.request.requestDigest||value.studyId!==p.request.studyId||
          value.artifacts[`${RUN_NAME}T01`]!==final[`${RUN_NAME}T01`].sha256)throw new Error('Invalid recovered candidate evidence');
        return this.headroomProof(run,value);
      });
      admitExecutionDeadline(this.host.executionDeadline,Date.now(),run.headroom);
      if(run.durable)await run.budget.run('durable',()=>run.durable!.candidate({providerRunId:run.id,studyId:p.request.studyId,
        requestDigest:p.request.requestDigest,executionAuthorityId:run.binding.authorizationId,
        providerId:this.id,providerVersion:this.version,runtimeDigest:run.installation.runtimeDigest,
        capturedAt:new Date().toISOString()},candidate!),true);
      await this.record(run,'result_validated',{candidateDigest:digest(candidate),coverageDigest:candidate.coverageDigest,
        actualCycles:candidate.actualCycles,timestepRangeS:candidate.timestepRangeS,actualMassScaling:false,
        t01UnchangedAfterParsing:true,t01Sha256:final[`${RUN_NAME}T01`].sha256});
      await this.completeRecordedStage(run,'durable','result_validated');
    } catch(error) {run.headroom.invalidateAll();run.failure=String(error);run.quarantined=true;candidate=null;
      if(/durable/i.test(String(error)))run.durable?.markFailed();}
    finally {
      if(run.active) {
        try {run.treeSafe=await run.active.terminateTree();} catch {run.treeSafe=false;}
        if(!run.treeSafe) run.failure='Process-tree termination not confirmed';
      }
      let cleaned=!run.directory;
      try {if(run.directory&&run.treeSafe&&run.durable?.cleanupAllowed!==false)
        cleaned=await run.budget.run('finalization',()=>this.cleanup(run.directory!),true);} catch {cleaned=false;}
      if(!cleaned) {run.failure=run.durable?.cleanupAllowed===false?'Durable evidence retention failed; bounded scratch preserved':'Cleanup/process-tree failure';run.quarantined=true;candidate=null;}
      const unsigned=candidate&&cleaned&&!run.cancelled&&!run.quarantined?
        {...candidate,executionStatus:'succeeded' as const,cleanupConfirmed:true as const}:null;
      let completed=unsigned?{...unsigned,resultDigest:digest(unsigned)}:null;
      const cancelledAtFinalReceipt=run.cancelled;
      try {
        await this.record(run,'finalized',{cleaned,treeTerminated:run.treeSafe,cancelled:run.cancelled,
          quarantined:run.quarantined||run.cancelled,failure:run.failure,resultDigest:completed?.resultDigest??null});
        if(run.cancelled&&!cancelledAtFinalReceipt) await this.record(run,'late_cancellation_quarantined',
          {cancelled:true,quarantined:true,resultDigest:null,cleaned});
        if(completed&&!run.cancelled&&!run.quarantined)await this.completeRecordedStage(run,'finalization','finalized');
      }
      catch(error) {run.failure='Protected evidence retention failed: '+String(error);candidate=null;completed=null;run.quarantined=true;
        // A final admission failure cannot leave a replayable success receipt.
        try{await this.record(run,'retrieval_quarantined',{reason:run.failure});}catch{} }
      const terminal=classifyFinalReceipt({phase:'finalized',cleaned,treeTerminated:run.treeSafe,
        cancelled:run.cancelled,quarantined:run.quarantined,failure:run.failure,resultDigest:completed?.resultDigest??null});
      if(terminal==='cancelled')
        this.state(run,'cancelled','cleaned_cancellation');
      else if(completed&&!run.cancelled&&!run.quarantined) {run.result=completed;this.state(run,'succeeded','validated_completed');}
      else {run.result=null;run.quarantined=true;this.state(run,'failed','quarantined',run.failure??'Incomplete result');}
    }
  }
}
