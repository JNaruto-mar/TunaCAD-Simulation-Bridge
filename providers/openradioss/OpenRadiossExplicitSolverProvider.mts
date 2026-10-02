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
import { inspectOpenRadiossInstallation, sha256, type OpenRadiossInstallation } from './OpenRadiossInstallation.mts';
import { admitOpenRadiossStarter } from './OpenRadiossStarterAdmission.mts';
import { nativeOpenRadiossProcessDriver, type OpenRadiossProcessDriver, type OpenRadiossProcessTask } from './OpenRadiossProcess.mts';
import { recoverOpenRadiossResult, pageExplicitResult } from './OpenRadiossResult.mts';

export interface ApprovedExplicitBinding {
  authorizationId:string; requestDigest:string; meshDigest:string; revision:string; geometryDigest:string;
}
export interface OpenRadiossHost {
  /** Trusted Bridge owner must freshly check source AND existing authorization.
   * This is not an approval supplied by study data or a public bypass flag. */
  rebindApprovedInput(binding:ApprovedExplicitBinding,stage:'submit'|'starter'|'engine'|'result'):Promise<ApprovedExplicitBinding>;
  readAuthorization(requestDigest:string,meshDigest:string):Promise<ApprovedExplicitBinding>;
  /** Required protected host-owned sink, separate from disposable solver scratch.
   * Failure to retain a receipt blocks launch/publication. No raw output retained. */
  retainEvidence(receipt:Readonly<Record<string,unknown>>):Promise<void>;
}
type Run={id:string;prepared:PreparedOpenRadioss;binding:ApprovedExplicitBinding;
  installation:Awaited<ReturnType<typeof inspectOpenRadiossInstallation>>;status:ExplicitProviderStatus;
  directory:string|null;active:OpenRadiossProcessTask|null;cancelled:boolean;treeSafe:boolean;
  result:ExplicitDynamicsResult|null;quarantined:boolean;records:Array<Record<string,unknown>>;
  finished:Promise<void>;failure:string|null};
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
    if(this.runs.size>=16||[...this.runs.values()].some(r=>['queued','running'].includes(r.status.status)))
      throw new Error('Private explicit provider run/resource bound');
    const prepared=prepareOpenRadiossDeck(request,structuredClone(mesh));
    const binding=await this.host.readAuthorization(prepared.request.requestDigest,prepared.meshDigest);
    if(!binding.authorizationId || binding.requestDigest!==prepared.request.requestDigest || binding.meshDigest!==prepared.meshDigest ||
      binding.revision!==prepared.request.model.projectRevision || binding.geometryDigest!==prepared.request.model.geometryDigest)
      throw new Error('Missing/mismatched approved immutable explicit input');
    if(digest(await this.host.rebindApprovedInput(binding,'submit'))!==digest(binding)) throw new Error('Stale explicit approval/source');
    const installation=await inspectOpenRadiossInstallation(this.config), id=randomUUID();
    if(this.runs.size>=16||[...this.runs.values()].some(r=>['queued','running'].includes(r.status.status)))
      throw new Error('Private explicit provider concurrent admission/resource bound');
    if(this.usedAuthorizations.has(binding.authorizationId)) throw new Error('Explicit authorization already consumed');
    this.usedAuthorizations.add(binding.authorizationId);
    const run:Run={id,prepared,binding:structuredClone(binding),installation,directory:null,active:null,cancelled:false,treeSafe:true,
      result:null,quarantined:false,records:[],finished:Promise.resolve(),failure:null,
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
  private async record(run:Run,phase:string,data:Record<string,unknown>) {
    const unsigned={schema:'tunacad-explicit-provider-receipt/0.1',providerRunId:run.id,studyId:run.prepared.request.studyId,
      requestDigest:run.prepared.request.requestDigest,meshDigest:run.prepared.meshDigest,phase,previousReceiptDigest:run.records.at(-1)?.receiptDigest??null,...data};
    const receipt={...unsigned,receiptDigest:digest(unsigned)};
    await this.host.retainEvidence(structuredClone(receipt));run.records.push(receipt);
  }
  private async rebind(run:Run,stage:'starter'|'engine'|'result') {
    if(digest(await this.host.rebindApprovedInput(structuredClone(run.binding),stage))!==digest(run.binding)) throw new Error('Changed approved source/request/mesh/revision');
    this.alive(run);
  }
  private async bytes(run:Run,name:string,maximum=8*1024*1024) {
    const path=join(run.directory!,name),s=await lstat(path);
    if(!s.isFile()||s.isSymbolicLink()||s.size<1||s.size>maximum) throw new Error('Missing/ambiguous/oversized provider artifact');
    const bytes=await readFile(path);if(bytes.length!==s.size) throw new Error('Artifact mutated while reading');return bytes;
  }
  private async pin(run:Run,names:string[]) {
    const artifacts:Record<string,{sha256:string;bytes:number}>={};
    for(const name of names) {const bytes=await this.bytes(run,name,name.endsWith('.rst')?256*1024*1024:8*1024*1024);
      artifacts[name]={sha256:sha256(bytes),bytes:bytes.length};}
    return artifacts;
  }
  private async stage(run:Run,stage:'starter'|'engine',inputPin:Awaited<ReturnType<typeof this.pin>>) {
    this.alive(run);
    this.state(run,'running',stage);
    const executable=stage==='starter'?this.config.starterExecutable:this.config.engineExecutable;
    const args=['-i',`${RUN_NAME}_${stage==='starter'?'0000':'0001'}.rad`,...(stage==='starter'?['-np','1']:[])];
    await this.record(run,stage+'_launch',{executableSha256:stage==='starter'?this.config.starterSha256:this.config.engineSha256,
      runtimeDigest:run.installation.runtimeDigest,args,automaticRetries:0});
    if((await inspectOpenRadiossInstallation(this.config)).runtimeDigest!==run.installation.runtimeDigest)
      throw new Error('Runtime provenance changed at launch boundary');
    await this.rebind(run,stage);
    if(digest(await this.pin(run,Object.keys(inputPin)))!==digest(inputPin)) throw new Error('Input provenance changed at launch boundary');
    const executableStat=await lstat(executable);
    if(!executableStat.isFile()||executableStat.isSymbolicLink()||executableStat.size>256*1024*1024 ||
      sha256(await readFile(executable))!==(stage==='starter'?this.config.starterSha256:this.config.engineSha256))
      throw new Error('Executable provenance changed at launch boundary');
    this.alive(run); // cancellation during protected receipt write must not launch.
    const task=this.driver.start(executable,args,{cwd:run.directory!,environment:{...process.env,...run.installation.environment}});
    run.active=task;run.treeSafe=false;
    let timer:ReturnType<typeof setTimeout>|undefined;
    try {
      const result=await Promise.race([task.completion,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Provider stage watchdog')),65000);})]);
      run.treeSafe=result.treeTerminated;run.active=null;
      if(result.stdout.length+result.stderr.length>8*1024*1024) throw new Error('Process output resource bound');
      const names=stage==='starter'?[`${RUN_NAME}_0000.out`,`${RUN_NAME}_0000_0001.rst`,`${RUN_NAME}_0001.rad`,`${RUN_NAME}_0000.rad`]:
        [`${RUN_NAME}_0001.out`,`${RUN_NAME}T01`,`${RUN_NAME}_0000_0001.rst`,`${RUN_NAME}_0001.rad`];
      // FIRST post-return activity: capture produced bytes/digests, before admission,
      // interpretation, cleanup, source reads or any next-stage execution.
      let artifacts:Awaited<ReturnType<typeof this.pin>>={},captureFailure:string|null=null;
      try {artifacts=await this.pin(run,names);} catch(error) {captureFailure=String(error);}
      const pin={exitCode:result.exitCode,error:result.error,pid:task.pid,treeTerminated:result.treeTerminated,
        stdoutSha256:sha256(result.stdout),stderrSha256:sha256(result.stderr),artifacts,
        capturedBeforeInterpretation:true,captureFailure,
        diagnosticStdout:result.stdout.toString('utf8').slice(-12000),diagnosticStderr:result.stderr.toString('utf8').slice(-12000)};
      await this.record(run,stage+'_output_pin',pin);
      await writeFile(join(run.directory!,stage+'.stdout.txt'),new Uint8Array(result.stdout),{flag:'wx'});
      await writeFile(join(run.directory!,stage+'.stderr.txt'),new Uint8Array(result.stderr),{flag:'wx'});
      this.alive(run);
      if(result.exitCode!==0||result.error||!result.treeTerminated||captureFailure) throw new Error(stage+' failure: '+(result.error??captureFailure??result.exitCode));
      return {pin,stdout:result.stdout.toString('utf8'),stderr:result.stderr.toString('utf8')};
    } finally {if(timer) clearTimeout(timer);}
  }
  private async execute(run:Run) {
    let candidate:ReturnType<typeof recoverOpenRadiossResult>|null=null;
    try {
      this.alive(run);run.directory=await mkdtemp(join(tmpdir(),'tunacad-openradioss-provider-'));
      const p=run.prepared;
      await writeFile(join(run.directory,`${RUN_NAME}_0000.rad`),p.starter,{flag:'wx'});
      await writeFile(join(run.directory,`${RUN_NAME}_0001.rad`),p.engine,{flag:'wx'});
      const decks=await this.pin(run,[`${RUN_NAME}_0000.rad`,`${RUN_NAME}_0001.rad`]);
      await this.record(run,'prepared',{binding:run.binding,materialDigest:digest(p.request.material),geometryDigest:p.request.model.geometryDigest,
        runtime:run.installation.identity,runtimeDigest:run.installation.runtimeDigest,decks,expected:p.expected,
        durationS:p.request.analysis.durationS,historyIntervalS:p.historyIntervalS,dtNodaScale:p.dtNodaScale,minimumTimestepS:0,
        maximumIncrements:p.request.analysis.integration.maximumIncrements});
      await this.rebind(run,'starter');
      if((await inspectOpenRadiossInstallation(this.config)).runtimeDigest!==run.installation.runtimeDigest) throw new Error('Runtime changed before Starter');
      const starter=await this.stage(run,'starter',decks);
      const listing=(await this.bytes(run,`${RUN_NAME}_0000.out`)).toString('utf8');
      if(sha256(listing)!==starter.pin.artifacts[`${RUN_NAME}_0000.out`].sha256) throw new Error('Starter listing changed before admission');
      const admission=admitOpenRadiossStarter(listing,p);
      await this.record(run,'starter_admitted',{admission,starterOutputPinDigest:run.records.at(-1)!.receiptDigest});
      if((await inspectOpenRadiossInstallation(this.config)).runtimeDigest!==run.installation.runtimeDigest) throw new Error('Runtime changed before Engine');
      await this.rebind(run,'engine');
      const inputs=await this.pin(run,Object.keys(starter.pin.artifacts));
      if(digest(inputs)!==digest(starter.pin.artifacts)||inputs[`${RUN_NAME}_0000.rad`].sha256!==decks[`${RUN_NAME}_0000.rad`].sha256 ||
        inputs[`${RUN_NAME}_0001.rad`].sha256!==decks[`${RUN_NAME}_0001.rad`].sha256) throw new Error('Changed contemporaneously bound restart/deck/listing');
      await this.record(run,'engine_admitted',{inputPinDigest:digest(inputs),runtimeDigest:run.installation.runtimeDigest});
      const engine=await this.stage(run,'engine',inputs);
      const final=await this.pin(run,Object.keys(engine.pin.artifacts));
      if(digest(final)!==digest(engine.pin.artifacts)||final[`${RUN_NAME}_0000_0001.rst`].sha256!==inputs[`${RUN_NAME}_0000_0001.rst`].sha256 ||
        final[`${RUN_NAME}_0001.rad`].sha256!==inputs[`${RUN_NAME}_0001.rad`].sha256 ||
        (await inspectOpenRadiossInstallation(this.config)).runtimeDigest!==run.installation.runtimeDigest) throw new Error('Changed completed input/output/runtime provenance');
      const artifacts=Object.fromEntries([...Object.entries(decks),...Object.entries(inputs),...Object.entries(final)].map(([name,v])=>[name,v.sha256]));
      artifacts.cycleTrace=sha256(engine.stdout);
      candidate=recoverOpenRadiossResult(p,await this.bytes(run,`${RUN_NAME}T01`),engine.stdout,
        (await this.bytes(run,`${RUN_NAME}_0001.out`)).toString('utf8'),{providerRunId:run.id,providerId:this.id,providerVersion:this.version,
          runtimeDigest:run.installation.runtimeDigest,artifacts,provenanceDigest:digest(run.records)});
      if(sha256(await this.bytes(run,`${RUN_NAME}T01`))!==final[`${RUN_NAME}T01`].sha256)
        throw new Error('T01 changed during direct recovery');
      await this.rebind(run,'result');
      await this.record(run,'result_validated',{candidateDigest:digest(candidate),coverageDigest:candidate.coverageDigest,
        actualCycles:candidate.actualCycles,timestepRangeS:candidate.timestepRangeS,actualMassScaling:false,
        t01UnchangedAfterParsing:true,t01Sha256:final[`${RUN_NAME}T01`].sha256});
    } catch(error) {run.failure=String(error);run.quarantined=true;candidate=null;}
    finally {
      if(run.active) {
        try {run.treeSafe=await run.active.terminateTree();} catch {run.treeSafe=false;}
        if(!run.treeSafe) run.failure='Process-tree termination not confirmed';
      }
      let cleaned=!run.directory;
      try {if(run.directory&&run.treeSafe) cleaned=await this.cleanup(run.directory);} catch {cleaned=false;}
      if(!cleaned) {run.failure='Cleanup/process-tree failure';run.quarantined=true;candidate=null;}
      const unsigned=candidate&&cleaned&&!run.cancelled&&!run.quarantined?
        {...candidate,executionStatus:'succeeded' as const,cleanupConfirmed:true as const}:null;
      let completed=unsigned?{...unsigned,resultDigest:digest(unsigned)}:null;
      const cancelledAtFinalReceipt=run.cancelled;
      try {
        await this.record(run,'finalized',{cleaned,treeTerminated:run.treeSafe,cancelled:run.cancelled,
          quarantined:run.quarantined||run.cancelled,failure:run.failure,resultDigest:completed?.resultDigest??null});
        if(run.cancelled&&!cancelledAtFinalReceipt) await this.record(run,'late_cancellation_quarantined',
          {cancelled:true,quarantined:true,resultDigest:null,cleaned});
      }
      catch(error) {run.failure='Protected evidence retention failed: '+String(error);candidate=null;completed=null;run.quarantined=true;}
      if(run.cancelled&&cleaned&&!run.failure?.includes('Cleanup')&&!run.failure?.includes('termination not confirmed')&&!run.failure?.includes('retention failed'))
        this.state(run,'cancelled','cleaned_cancellation');
      else if(completed&&!run.cancelled&&!run.quarantined) {run.result=completed;this.state(run,'succeeded','validated_completed');}
      else {run.result=null;run.quarantined=true;this.state(run,'failed','quarantined',run.failure??'Incomplete result');}
    }
  }
}
