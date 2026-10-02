// Explicitly approved real integration fixture ONLY; default is no-solver preparation.
// Never registered as a provider route, automatic approval or test-suite member.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, open, lstat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { sealExplicitDynamics, type ExplicitDynamicsDraft } from '../simulation-bridge/explicitDynamicsFoundation.mts';
import { parseBoundedOpenRadiossTFile4 } from '../simulation-bridge/openRadiossBinaryTFileParser.mts';
import { axialWaveReference, selectAxialWaveEvents, AXIAL_VALIDATION_PLAN } from '../simulation-bridge/openRadiossAxialBarOracle.mts';
import { OpenRadiossExplicitSolverProvider, type OpenRadiossHost } from '../providers/openradioss/OpenRadiossExplicitSolverProvider.mts';
import { nativeOpenRadiossProcessDriver, type OpenRadiossProcessDriver } from '../providers/openradioss/OpenRadiossProcess.mts';
import { inspectOpenRadiossInstallation, sha256 } from '../providers/openradioss/OpenRadiossInstallation.mts';
import { OPENRADIOSS_RUNTIME_POLICY } from '../providers/openradioss/OpenRadiossRuntimeManifest.mts';
import { prepareOpenRadiossDeck, RUN_NAME } from '../providers/openradioss/OpenRadiossDeck.mts';
import { recoverOpenRadiossResult } from '../providers/openradioss/OpenRadiossResult.mts';
import type { ExplicitDynamicsResult, ExplicitDynamicsFieldPage } from '../src/simulation/explicitDynamicsProviderContracts.ts';
import { snapshotNativeTree,positiveCancellationTime,requireNoOwnedSurvivors,type TreeSnapshot }
  from './openradiossNativeCancellationWitness.mts';

const execute=promisify(execFile), stamp=()=>new Date().toISOString();
const flags=process.argv.slice(2);
assert.ok(flags.length===1&&['--prepare-only','--execute','--cancel-prepare-only','--cancel-execute'].includes(flags[0]),'Choose one explicit fixture mode');
const cancellation=flags[0].startsWith('--cancel-');
const real=flags[0]==='--execute'||flags[0]==='--cancel-execute';
const retained=process.env.TUNACAD_OPENRADIOSS_MEDIUM_SOURCE_DIR;
assert.ok(retained,'Retained validated medium evidence required; no fallback');
const readJson=async(path:string)=>JSON.parse(await readFile(path,'utf8'));
async function writeOnce(path:string,value:unknown) {
  const bytes=typeof value==='string'?Buffer.from(value):Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value,null,2));
  assert.ok(bytes.length<=16*1024*1024,'Bounded test evidence');
  const handle=await open(path,'wx',0o600);
  try {await handle.writeFile(new Uint8Array(bytes));await handle.sync();} finally {await handle.close();}
}
// Fixed script; paths enter via JSON environment, never interpolated into shell code.
const aclScript=String.raw`
$ErrorActionPreference='Stop'
$path=$env:TUNACAD_EXPLICIT_TEST_STORAGE
$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowed=@($sid,'S-1-5-18','S-1-5-32-544') | Select-Object -Unique
if($env:TUNACAD_EXPLICIT_TEST_PROVISION -eq 'new') {
  $acl=[System.Security.AccessControl.DirectorySecurity]::new()
  $acl.SetOwner([System.Security.Principal.SecurityIdentifier]::new($sid))
  $acl.SetAccessRuleProtection($true,$false)
  foreach($account in $allowed) {
    $rule=[System.Security.AccessControl.FileSystemAccessRule]::new(
      [System.Security.Principal.SecurityIdentifier]::new($account),
      [System.Security.AccessControl.FileSystemRights]::FullControl,
      ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),
      [System.Security.AccessControl.PropagationFlags]::None,
      [System.Security.AccessControl.AccessControlType]::Allow)
    $acl.AddAccessRule($rule)
  }
  [System.IO.Directory]::SetAccessControl($path,$acl)
}
$acl=[System.IO.Directory]::GetAccessControl($path)
if(-not $acl.AreAccessRulesProtected -or $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid) {throw 'Unprotected test evidence'}
$rules=@($acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]))
if(-not ($rules | Where-Object {$_.IdentityReference.Value -eq $sid -and $_.FileSystemRights -eq 'FullControl'})) {throw 'Owner rights missing'}
foreach($rule in $rules) {if($allowed -notcontains $rule.IdentityReference.Value -or $rule.AccessControlType -ne 'Allow') {throw 'Unapproved principal'}}
ConvertTo-Json -Compress -InputObject ([PSCustomObject]@{owner=$sid;protected=$true;principals=$allowed})
`;
async function protection(path:string,provision=false) {
  const result=await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',aclScript],
    {windowsHide:true,timeout:10000,maxBuffer:20000,env:{...process.env,TUNACAD_EXPLICIT_TEST_STORAGE:path,
      TUNACAD_EXPLICIT_TEST_PROVISION:provision?'new':'verify'}});
  return JSON.parse(result.stdout);
}
const source=await readJson(join(retained,'pre-dispatch-receipt.json'));
const input=await readFile(source.sourceFrd,'utf8');
assert.equal(sha256(input),'700f03b250203d5d72e01aedf156b81c843e8b467a391460387061be9623ea71');
const baselineBytes=await readFile(join(retained,`${RUN_NAME}T01`));
assert.equal(sha256(baselineBytes),'a679deb05ab2476afce7fe12d8c4eed5aaf7784065a497b68d24ff61972be559');
const baselineTrace=await readFile(join(retained,'engine.stdout.txt'),'utf8');
assert.equal(sha256(baselineTrace),'66d1058c2e83c14178a07c31bde6b43f80981b3e3e1e86ba0e2026e3060885b2');
const lines=input.split(/\r?\n/), start=lines.findIndex(l=>/^\s*2C\s/.test(l)), end=lines.findIndex(l=>/^\s*3C\s/.test(l));
const nodes:Array<{id:number;xyzMm:[number,number,number]}>=[],elements:Array<{id:number;type:'C3D4';nodes:[number,number,number,number]}>=[];
assert.ok(start>=0&&end>start);
for(const line of lines.slice(start+1,end)) if(/^\s*-1\s/.test(line)) {
  const [,id,...xyz]=line.trim().split(/\s+/).map(Number);nodes.push({id,xyzMm:xyz as [number,number,number]});
}
for(let i=end+1;i+1<lines.length;i++) {
  if(/^\s*-3\s*$/.test(lines[i])) break;
  if(/^\s*-1\s/.test(lines[i])) {const id=Number(lines[i].trim().split(/\s+/)[1]);
    elements.push({id,type:'C3D4',nodes:lines[++i].trim().split(/\s+/).slice(1).map(Number) as [number,number,number,number]});}
}
const facets=new Map<string,{nodes:[number,number,number];uses:number}>();
for(const e of elements) for(let k=0;k<4;k++) {
  const ids=e.nodes.filter((_,i)=>i!==k) as [number,number,number],key=[...ids].sort((a,b)=>a-b).join(',');
  facets.set(key,{nodes:ids,uses:(facets.get(key)?.uses??0)+1});
}
const geometry={kind:'trusted_retained_axial_bar_fixture',dimensionsMm:[100,10,10],sourceMeshSha256:sha256(input)};
const geometryDigest=digest(geometry);
const mesh={runtime:'Gmsh 4.15.2',inputGeometryDigest:geometryDigest,nodes,elements,
  surfaceTriangles:[...facets.values()].filter(f=>f.uses===1).map((f,i)=>({id:i+1,nodes:f.nodes}))};
const draft:ExplicitDynamicsDraft={schema:'tunacad-explicit-dynamics-foundation/0.1',studyId:'bridge-axial-'+randomUUID(),
  analysis:{type:'explicit_structural_dynamics',assumptions:['one_linear_elastic_solid','small_displacement','zero_initial_conditions','undamped','no_contact','no_mass_scaling'],
    durationS:50e-6,outputTimesS:[1e-6,50e-6],integration:{kind:'central_difference_cfl_bound',minimumCharacteristicLengthMm:5,
      safetyFactor:0.8,maximumTimeStepS:4e-7,maximumIncrements:20000}},
  model:{projectRevision:'retained-axial-model-r1',domainId:'axial-bar',partId:'bar-part',bodyId:'bar-body',geometryDigest,
    kind:'straight_rectangular_axial_bar',lengthMm:100,widthMm:10,heightMm:10,fixedFaceId:'fixed',loadedFaceId:'loaded'},
  material:{materialId:'steel',domainId:'axial-bar',model:'isotropic_linear_elastic',youngsModulusMPa:200000,poissonRatio:0.3,densityKgM3:7800,
    source:{kind:'custom',reference:'validated axial-bar material',revision:'m1'}},
  initialConditions:{displacementMm:[0,0,0],velocityMmPerS:[0,0,0]},restraint:{kind:'fixed_face',faceId:'fixed',displacementMm:[0,0,0]},
  load:{kind:'axial_step_face_force',faceId:'loaded',onsetS:0,forceN:[100,0,0],coordinateSystem:'analysis',history:'constant_after_onset'},
  mesh:{elementFormulation:'C3D4',maximumNodes:88,maximumElements:208},
  requestedResults:['loaded_face_axial_displacement_history','fixed_face_axial_reaction_history','kinetic_energy_history','strain_energy_history','applied_work_history'],
  units:{length:'mm',time:'s',force:'N',stress:'MPa',density:'kg/m^3',velocity:'mm/s',acceleration:'mm/s^2',energy:'N*mm'}};
const frozenPrepared=prepareOpenRadiossDeck(sealExplicitDynamics(draft),mesh);
assert.equal(sha256(frozenPrepared.starter),source.starterSha256);assert.equal(sha256(frozenPrepared.engine),source.engineSha256);
if(cancellation) {
  // Cancellation observation window only. No numerical validation or new physics.
  // Keep 20,000-cycle/64-history caps; 6ms predicts 18,784 native cycles.
  draft.studyId='bridge-cancel-'+randomUUID();draft.analysis.durationS=0.006;
  draft.analysis.outputTimesS=[0.0001,0.006];
}
const request=sealExplicitDynamics(draft),prepared=prepareOpenRadiossDeck(request,mesh);
assert.deepEqual(prepared.expected,frozenPrepared.expected);assert.equal(prepared.dtNodaScale,frozenPrepared.dtNodaScale);
assert.deepEqual(prepared.expected.fixedNodeIds,[1,2,3,4,45]);assert.equal(prepared.expected.forceN,100);
const config={root:process.env.TUNACAD_OPENRADIOSS_ROOT!,starterExecutable:process.env.TUNACAD_OPENRADIOSS_STARTER!,
  engineExecutable:process.env.TUNACAD_OPENRADIOSS_ENGINE!,runtimeVersion:'2026' as const,
  starterSha256:source.binarySha256.starter,engineSha256:source.binarySha256.engine};
assert.ok(config.root&&config.starterExecutable&&config.engineExecutable,'Explicit installation paths required');
const installation=await inspectOpenRadiossInstallation(config);
// User-approved exact installation, not an old seal or any merely readable tree.
assert.equal(OPENRADIOSS_RUNTIME_POLICY.maximumTotalBytes,512*1024*1024);
assert.equal(OPENRADIOSS_RUNTIME_POLICY.maximumFileBytes,256*1024*1024);
assert.equal(installation.identity.files.length,86);
assert.equal(installation.manifestDigest,'sha256:64019bec8c2f46a8431c8976db6c3664f162376f59ef1c2edca7f229a8e1208b');
assert.equal(installation.runtimeDigest,'sha256:65d76caa5f3c9d83f2092d51505d92f14abe5ca4a10a540876d11e595afd7b36');
assert.equal(installation.totalBytes,456153698);assert.equal(installation.hashingBytes,456155074);
const baseline=cancellation?null:recoverOpenRadiossResult(prepared,baselineBytes,baselineTrace,
  await readFile(join(retained,`${RUN_NAME}_0001.out`),'utf8'),
  {providerRunId:'retained-medium',providerId:'standalone-reference',providerVersion:'retained',runtimeDigest:installation.runtimeDigest,
    artifacts:{t01:sha256(baselineBytes)},provenanceDigest:sha256(baselineTrace)});

let directory:string;
if(!real) {
  directory=await mkdtemp(join(tmpdir(),'tunacad-openradioss-real-bridge-'));
  const acl=await protection(directory,true);
  for(const part of ['receipts','artifacts','quarantine']) await mkdir(join(directory,part));
  const approvalSource=process.env.TUNACAD_OPENRADIOSS_BRIDGE_APPROVAL_FILE;
  assert.ok(approvalSource,'Explicit human authorization document required for fixture provenance');
  const approvalSha256=sha256(await readFile(approvalSource));
  const binding={authorizationId:randomUUID(),requestDigest:request.requestDigest,meshDigest:prepared.meshDigest,
    revision:request.model.projectRevision,geometryDigest};
  const record={schema:'tunacad-openradioss-real-bridge-fixture/0.1',createdAt:stamp(),request,mesh,geometry,binding,config,
    runtimeDigest:installation.runtimeDigest,runtimeManifestDigest:installation.manifestDigest,
    runtimeBytes:installation.totalBytes,hashingBytes:installation.hashingBytes,
    runtimePolicyVersion:OPENRADIOSS_RUNTIME_POLICY.version,executableRuntime:installation.identity,environment:installation.environment,
    expected:prepared.expected,contractVersion:request.schema,providerId:'tunacad-openradioss-explicit-private',providerVersion:'0.1.0-poc',
    starterSha256:sha256(prepared.starter),engineSha256:sha256(prepared.engine),sourceFrd:source.sourceFrd,sourceSha256:sha256(input),
    approvalSha256,approvedExecutionLimit:{starter:1,engine:1,retries:0},cancellationFixture:cancellation,
    evidence:cancellation?'native cancellation only; no numerical validation':'real Bridge integration; not browser approval',acl};
  await writeOnce(join(directory,'protected-study.json'),record);
  await writeOnce(join(directory,'preparation-pin.json'),{recordDigest:digest(record)});
  await writeOnce(join(directory,'sealed-request.json'),request);
  await writeOnce(join(directory,'generated-starter.rad'),prepared.starter);
  await writeOnce(join(directory,'generated-engine.rad'),prepared.engine);
  if(!cancellation) {
  const decoded=parseBoundedOpenRadiossTFile4(baselineBytes,50e-6,{method:'frozen-2026-cycle-trace',cycleTrace:baselineTrace,
    completedCycles:157,historyIntervalS:1e-6,engineExitCode:0,normalTermination:true});
  assert.equal(decoded.frames.length,50);assert.equal(baseline!.frames.length,50);
  }
  await writeOnce(join(directory,'preflight.json'),{at:stamp(),pass:true,realSolverProcesses:0,studyId:request.studyId,
    meshDigest:prepared.meshDigest,runtimeDigest:installation.runtimeDigest,runtimeManifestDigest:installation.manifestDigest,
    runtimeBytes:installation.totalBytes,hashingBytes:installation.hashingBytes,runtimePolicyVersion:OPENRADIOSS_RUNTIME_POLICY.version,
    starterSha256:record.starterSha256,
    engineSha256:record.engineSha256,baselineMappingPass:cancellation?null:true,cancellationFixture:cancellation,
    durationS:request.analysis.durationS,historyIntervalS:prepared.historyIntervalS,
    retainedT01Unchanged:sha256(await readFile(join(retained,`${RUN_NAME}T01`)))===sha256(baselineBytes)});
  console.log(JSON.stringify({preflight:'PASS',directory,studyId:request.studyId,realSolverProcesses:0}));
} else {
  directory=resolve(process.env.TUNACAD_OPENRADIOSS_BRIDGE_EVIDENCE_DIR!);
  assert.ok(process.env.TUNACAD_OPENRADIOSS_BRIDGE_EVIDENCE_DIR,'Prepared isolated storage required');
  const acl=await protection(directory), stored=await readJson(join(directory,'protected-study.json'));
  assert.equal(digest(stored),(await readJson(join(directory,'preparation-pin.json'))).recordDigest);
  assert.deepEqual(acl,stored.acl);assert.deepEqual(config,stored.config);
  assert.equal(stored.cancellationFixture,cancellation,'Do not reuse another fixture mode');
  assert.equal(installation.runtimeDigest,stored.runtimeDigest);
  assert.equal(installation.manifestDigest,stored.runtimeManifestDigest);
  assert.equal(stored.runtimePolicyVersion,OPENRADIOSS_RUNTIME_POLICY.version);
  assert.equal(stored.runtimeBytes,installation.totalBytes);assert.equal(stored.hashingBytes,installation.hashingBytes);
  const p=prepareOpenRadiossDeck(stored.request,stored.mesh);
  assert.equal(p.meshDigest,stored.binding.meshDigest);assert.equal(sha256(p.starter),stored.starterSha256);
  assert.equal(sha256(p.engine),stored.engineSha256);
  // Exclusive claim persists even on failure. This fixture cannot retry the attempt.
  await writeOnce(join(directory,'execution-claim.json'),{at:stamp(),studyId:stored.request.studyId,limit:stored.approvedExecutionLimit});
  let provider:OpenRadiossExplicitSolverProvider, scratch:string|null=null;
  let resultRebindCount=0;
  let engineWrapperPid:number|null=null,engineReturned=false,cancelRequested=false;
  let cancelAt:string|null=null,cancelTree:TreeSnapshot|null=null,cancelTime:ReturnType<typeof positiveCancellationTime>=null;
  let cancelStatus:Awaited<ReturnType<OpenRadiossExplicitSolverProvider['getStatus']>>|null=null;
  let engineExit:number|null=null;
  const terminationEvents:Array<Record<string,unknown>>=[];
  const launches:Array<Record<string,unknown>>=[], transitions:Array<Record<string,unknown>>=[],receipts:Array<Record<string,any>>=[];
  const observe=async(id:string)=>{
    const status=await provider.getStatus(id);
    const last=transitions.at(-1);
    if(!last||last.status!==status.status||last.phase!==status.phase||last.updatedAt!==status.updatedAt) {
      transitions.push({...status,observedAt:stamp()});
      await writeOnce(join(directory,'receipts',`state-${String(transitions.length).padStart(3,'0')}.json`),transitions.at(-1));
    }
    return status;
  };
  async function rebind() {
    const current=await readJson(join(directory,'protected-study.json'));
    assert.equal(digest(current),(await readJson(join(directory,'preparation-pin.json'))).recordDigest);
    assert.equal(digest(current),digest(stored));
    assert.equal(sha256(await readFile(current.sourceFrd)),current.sourceSha256);
    const check=prepareOpenRadiossDeck(current.request,current.mesh);
    assert.equal(check.meshDigest,current.binding.meshDigest);assert.equal(check.request.requestDigest,current.binding.requestDigest);
    assert.equal(digest(current.geometry),current.binding.geometryDigest);
    return structuredClone(current.binding);
  }
  const host:OpenRadiossHost={readAuthorization:async(req,mesh)=>{
    const binding=await rebind();assert.equal(req,binding.requestDigest);assert.equal(mesh,binding.meshDigest);return binding;
  },rebindApprovedInput:async(binding,stage)=>{
    const current=await rebind();assert.deepEqual(binding,current);
    if(stage!=='result'||++resultRebindCount===1)
      await writeOnce(join(directory,'receipts',`rebind-${stage}-${randomUUID()}.json`),{at:stamp(),stage,bindingDigest:digest(binding)});
    return current;
  },retainEvidence:async(receipt)=>{
    const r=receipt as Record<string,any>,{receiptDigest,...unsigned}=r;assert.equal(digest(unsigned),receiptDigest);
    assert.equal(r.studyId,stored.request.studyId);assert.equal(r.requestDigest,stored.request.requestDigest);
    assert.equal(r.previousReceiptDigest,receipts.at(-1)?.receiptDigest??null);
    if(r.artifacts) {
      assert.ok(scratch);
      for(const [name,pin] of Object.entries(r.artifacts) as Array<[string,{sha256:string;bytes:number}]>) {
        assert.match(name,/^[A-Za-z0-9_.-]+$/);
        const bytes=await readFile(join(scratch,name));assert.equal(bytes.length,pin.bytes);assert.equal(sha256(bytes),pin.sha256);
        const category=cancellation&&r.phase==='engine_output_pin'?'quarantine':'artifacts';
        await writeOnce(join(directory,category,`${r.phase}-${name}`),bytes);
      }
    }
    const capture={capturedAt:stamp(),receipt:r};
    await writeOnce(join(directory,'receipts',`${String(receipts.length).padStart(3,'0')}-${r.phase}.json`),capture);
    receipts.push(structuredClone(r));await observe(r.providerRunId);
    console.log(JSON.stringify({phase:r.phase,at:capture.capturedAt,exitCode:r.exitCode??null,cleaned:r.cleaned??null}));
  }};
  // Audit-only decorator forwards EVERY launch to the existing native Job Object
  // driver. No mock process, standalone script or alternate solver.
  const driver:OpenRadiossProcessDriver={start(executable,args,options){
    const stage=executable===config.starterExecutable?'starter':'engine';
    assert.equal(executable,stage==='starter'?config.starterExecutable:config.engineExecutable);
    assert.ok(!launches.some(l=>l.stage===stage),'No repeated native launch');
    if(stage==='engine') assert.ok(receipts.some(r=>r.phase==='engine_admitted'));
    scratch=options.cwd;
    const task=nativeOpenRadiossProcessDriver.start(executable,args,options);
    if(stage==='engine') engineWrapperPid=task.pid;
    launches.push({stage,at:stamp(),pid:task.pid,executableSha256:stage==='starter'?config.starterSha256:config.engineSha256,args});
    return {pid:task.pid,terminateTree:async()=>{
      const at=stamp(),terminated=await task.terminateTree();terminationEvents.push({stage,pid:task.pid,requestedAt:at,completedAt:stamp(),terminated});return terminated;
    },completion:task.completion.then(async result=>{
      if(stage==='engine') {engineReturned=true;engineExit=result.exitCode;}
      await writeOnce(join(directory,'artifacts',`${stage}.stdout.txt`),result.stdout);
      await writeOnce(join(directory,'artifacts',`${stage}.stderr.txt`),result.stderr);
      await writeOnce(join(directory,'receipts',`${stage}-os-exit.json`),{...launches.at(-1),launchAt:launches.at(-1)!.at,at:stamp(),exitCode:result.exitCode,
        error:result.error,treeTerminated:result.treeTerminated,stdoutSha256:sha256(result.stdout),stderrSha256:sha256(result.stderr)});
      return result;
    })};
  }};
  provider=new OpenRadiossExplicitSolverProvider(config,host,driver);
  let submission:Awaited<ReturnType<typeof provider.submit>>|null=null;
  try {
    submission=await provider.submit(stored.request,stored.mesh);
    await writeOnce(join(directory,'submission.json'),{at:stamp(),...submission,studyId:stored.request.studyId});
    assert.equal(await provider.getResult(submission.providerRunId),null,'No result before completion');
    let status=await observe(submission.providerRunId),deadline=Date.now()+150000;
    while(status.status==='queued'||status.status==='running') {
      assert.ok(Date.now()<deadline,'Bounded real fixture lifecycle wait');
      if(cancellation&&engineWrapperPid!==null&&!cancelRequested&&!engineReturned) {
        let liveBytes:Buffer|null=null;
        try {liveBytes=await readFile(join(scratch!,`${RUN_NAME}T01`));} catch(error) {if((error as NodeJS.ErrnoException).code!=='ENOENT') throw error;}
        const time=liveBytes?positiveCancellationTime(new Uint8Array(liveBytes),stored.request.analysis.durationS):null;
        if(time) {
          const tree=await snapshotNativeTree(engineWrapperPid);
          assert.equal(tree.engines.length,1,'Actual owned Engine identity required');
          const engine=tree.engines[0];assert.equal(engine.identity.executable.toLowerCase(),config.engineExecutable.toLowerCase());
          assert.equal(engine.identity.parentPid,engineWrapperPid);assert.equal(engine.inJob,true);
          assert.match(engine.commandLine,/-i\s+ExplicitBarProbe_0001\.rad/);
          status=await observe(submission.providerRunId);assert.equal(status.status,'running');assert.equal(status.phase,'engine');
          assert.equal(engineReturned,false,'Do not count natural completion as cancellation');
          cancelTree=tree;cancelTime=time;cancelStatus=status;
          const prefix=liveBytes!.subarray(0,time.completePrefixBytes);
          await writeOnce(join(directory,'quarantine','positive-time-witness.t01-prefix'),prefix);
          await writeOnce(join(directory,'cancellation-armed.json'),{at:stamp(),state:status,tree,time,prefixSha256:sha256(prefix),
            mechanism:'provider.cancel -> taskkill /T wrapper + Job Object kill-on-close',numericalValidation:false});
          cancelRequested=true;cancelAt=stamp();
          const cancelled=provider.cancel(submission.providerRunId);
          await writeOnce(join(directory,'cancellation-request.json'),{at:cancelAt,state:status,engine:engine.identity,wrapperPid:engineWrapperPid});
          await cancelled;status=await observe(submission.providerRunId);
        }
      }
      await new Promise(resolve=>setTimeout(resolve,10));status=await observe(submission.providerRunId);
    }
    await writeOnce(join(directory,'terminal-status.json'),status);
    if(cancellation) {
      assert.ok(cancelRequested&&cancelAt&&cancelTree&&cancelTime&&cancelStatus&&engineWrapperPid);
      assert.equal(status.status,'cancelled',JSON.stringify(status));assert.equal(status.phase,'cleaned_cancellation');
      assert.equal(engineReturned,true);assert.notEqual(engineExit,0,'Native run must be interrupted, not finish naturally');
      assert.deepEqual(launches.map(l=>l.stage),['starter','engine']);
      const finalized=receipts.find(r=>r.phase==='finalized')!;
      assert.ok(finalized);assert.equal(finalized.cancelled,true);assert.equal(finalized.quarantined,true);
      assert.equal(finalized.cleaned,true);assert.equal(finalized.treeTerminated,true);assert.equal(finalized.resultDigest,null);
      assert.equal(receipts.some(r=>r.phase==='result_validated'),false,'Partial history must never enter normalized recovery');
      const after=await snapshotNativeTree(engineWrapperPid),ownership=requireNoOwnedSurvivors(cancelTree,after);
      for(let repeat=0;repeat<3;repeat++) {
        assert.equal(await provider.getResult(submission.providerRunId),null);
        for(const quantity of ['displacement','velocity','acceleration','reactionImpulse','reactionForce'] as const)
          await assert.rejects(()=>provider.getFieldDataset(submission!.providerRunId,0,quantity));
        assert.deepEqual(await provider.cancel(submission.providerRunId),status);
        await new Promise(resolve=>setTimeout(resolve,50));assert.deepEqual(await provider.getStatus(submission.providerRunId),status);
      }
      assert.ok(scratch);await assert.rejects(()=>lstat(scratch!),{code:'ENOENT'});
      assert.equal(transitions.filter(t=>t.status==='cancelled').length,1);assert.equal(transitions.some(t=>t.status==='succeeded'),false);
      assert.equal(launches.length,2);await protection(directory);
      const quarantineFiles=await readdir(join(directory,'quarantine'));
      assert.ok(quarantineFiles.includes(`engine_output_pin-${RUN_NAME}T01`),'Post-cancel partial T01 must be retained under quarantine');
      const report={at:stamp(),pass:true,evidence:'native Windows Engine cancellation, not numerical validation',directory,
        studyId:stored.request.studyId,runId:submission.providerRunId,runtimeManifestDigest:stored.runtimeManifestDigest,
        runtimeDigest:stored.runtimeDigest,meshDigest:p.meshDigest,durationS:stored.request.analysis.durationS,historyIntervalS:p.historyIntervalS,
        starterAdmission:receipts.find(r=>r.phase==='starter_admitted')?.admission,cancelAt,cancelStatus,cancelTime,
        engine:cancelTree.engines[0],wrapperPid:engineWrapperPid,ownership,terminationEvents,engineExit,
        transitions,launches,terminal:status,quarantineFiles,finalized,resultDenied:true,pagesDenied:true,
        lateNativeCompletion:'completion delivered after cancellation; no result_validated or succeeded',
        terminalStable:true,cleaned:true,noOwnedProcesses:true,newStudyReadiness:'no active run/scratch/global lock; no new submit performed',
        protectedPerAttemptClaim:'intentionally retained single-use, not global lock',engineeringUsePermitted:false,browserMcpAdmission:'closed'};
      await writeOnce(join(directory,'quarantine','catalog.json'),{at:stamp(),runId:submission.providerRunId,incomplete:true,resultDigest:null,
        artifacts:receipts.find(r=>r.phase==='engine_output_pin')?.artifacts,previousReceiptDigest:finalized.receiptDigest,publication:'denied'});
      await writeOnce(join(directory,'final-receipt.json'),report);console.log(JSON.stringify(report));
    } else {
    assert.ok(baseline);
    assert.equal(status.status,'succeeded',JSON.stringify(status));
    assert.deepEqual(launches.map(l=>l.stage),['starter','engine']);
    const result=(await provider.getResult(submission.providerRunId))!;
    assert.ok(result);assert.equal(result.studyId,stored.request.studyId);assert.equal(result.meshDigest,p.meshDigest);
    const {resultDigest,...unsigned}=result;assert.equal(digest(unsigned),resultDigest);
    await writeOnce(join(directory,'normalized-result.json'),result);
    assert.deepEqual(await provider.getResult(submission.providerRunId),result);
    const bytes=await readFile(join(directory,'artifacts',`engine_output_pin-${RUN_NAME}T01`));
    assert.equal(sha256(bytes),result.artifacts[`${RUN_NAME}T01`]);
    const trace=await readFile(join(directory,'artifacts','engine.stdout.txt'),'utf8');
    const listing=await readFile(join(directory,'artifacts',`engine_output_pin-${RUN_NAME}_0001.out`),'utf8');
    const decoded=parseBoundedOpenRadiossTFile4(bytes,50e-6,{method:'frozen-2026-cycle-trace',cycleTrace:trace,
      completedCycles:result.actualCycles,historyIntervalS:1e-6,engineExitCode:0,normalTermination:true});
    assert.ok(decoded.coverage?.complete);
    const mapped=recoverOpenRadiossResult(p,bytes,trace,listing,{providerRunId:result.providerRunId,providerId:result.provider.id,
      providerVersion:result.provider.version,runtimeDigest:result.provider.runtimeDigest,artifacts:result.artifacts,provenanceDigest:result.provenanceDigest});
    assert.deepEqual(mapped.frames,result.frames);assert.equal(sha256(bytes),sha256(await readFile(join(directory,'artifacts',`engine_output_pin-${RUN_NAME}T01`))));
    const pages:ExplicitDynamicsFieldPage[]=[];
    const events=selectAxialWaveEvents(result.frames.map(f=>f.timeS),Math.max(...result.frames.map(f=>f.timestepS)));
    const pageFrames=[...new Set([0,events.nearTransit,events.nearReturn,result.frames.length-1])];
    for(const frame of pageFrames) for(const quantity of ['displacement','velocity','acceleration','reactionImpulse','reactionForce'] as const) {
      let cursor:string|undefined, collected:Array<{nodeId:number;value:number}>=[], datasetDigest:string|undefined;
      do {
        const page=await provider.getFieldDataset(result.providerRunId,frame,quantity,cursor,3);
        assert.equal(page.offset,collected.length);assert.equal(page.total,10);assert.equal(page.domainId,result.domainId);
        assert.equal(page.frameIndex,frame);assert.equal(page.timeS,result.frames[frame].timeS);assert.equal(page.chunkDigest,digest(page.values));
        assert.deepEqual(await provider.getFieldDataset(result.providerRunId,frame,quantity,cursor,3),page);
        datasetDigest??=page.datasetDigest;assert.equal(page.datasetDigest,datasetDigest);
        collected.push(...page.values);pages.push(page);cursor=page.nextCursor??undefined;
      } while(cursor);
      assert.equal(collected.length,10);assert.equal(new Set(collected.map(v=>v.nodeId)).size,10);
      assert.deepEqual(collected.map(v=>v.nodeId),result.sampling.monitoredNodeIds);assert.equal(digest(collected),datasetDigest);
    }
    await writeOnce(join(directory,'field-pages.json'),pages);
    const baseEvents=selectAxialWaveEvents(baseline.frames.map(f=>f.timeS),Math.max(...baseline.frames.map(f=>f.timestepS)));
    const median=(vs:number[])=>{const values=[...vs].sort((a,b)=>a-b);return (values[Math.floor((values.length-1)/2)]+values[Math.floor(values.length/2)])/2;};
    const values=(r:Pick<ExplicitDynamicsResult,'frames'>,e:ReturnType<typeof selectAxialWaveEvents>)=>({
      transitDisplacementMm:p.expected.loads.reduce((s,l)=>s+l.forceN*r.frames[e.nearTransit].nodes.find(n=>n.nodeId===l.id)!.displacementMm,0)/100,
      returnDisplacementMm:p.expected.loads.reduce((s,l)=>s+l.forceN*r.frames[e.nearReturn].nodes.find(n=>n.nodeId===l.id)!.displacementMm,0)/100,
      plateauReactionN:median(e.plateau.map(i=>r.frames[i].supportReactionN))});
    const measured=values(result,events),reference=values(baseline,baseEvents), thresholds=AXIAL_VALIDATION_PLAN.thresholds;
    // Integration sanity only: exact retained history equality, plus existing
    // frozen physical tolerances. Never register an oracle in provider execution.
    assert.deepEqual(result.frames,baseline.frames);assert.equal(result.actualCycles,baseline.actualCycles);
    assert.deepEqual(result.timestepRangeS,baseline.timestepRangeS);
    assert.deepEqual(measured,reference);
    const wave=axialWaveReference();
    assert.ok(Math.abs(measured.transitDisplacementMm-wave.staticDisplacementMm)<=thresholds.displacementRelative*wave.staticDisplacementMm+wave.loadedVelocityMmPerS*events.samplingBoundS);
    assert.ok(Math.abs(measured.returnDisplacementMm-wave.returnDisplacementMm)<=thresholds.displacementRelative*wave.returnDisplacementMm+wave.loadedVelocityMmPerS*events.samplingBoundS);
    assert.ok(Math.abs(measured.plateauReactionN-wave.supportPlateauN)<=thresholds.plateauMedianRelative*Math.abs(wave.supportPlateauN));
    assert.equal(result.cleanupConfirmed,true);assert.equal(result.actualMassScaling,false);
    assert.ok(scratch);await assert.rejects(()=>lstat(scratch!),{code:'ENOENT'});
    await protection(directory);assert.equal(sha256(await readFile(join(retained,`${RUN_NAME}T01`))),sha256(baselineBytes));
    const receipt={at:stamp(),pass:true,evidence:'real Bridge-level OpenRadioss integration; not native cancellation or browser admission',
      directory,studyId:result.studyId,runId:result.providerRunId,requestDigest:result.requestDigest,meshDigest:result.meshDigest,
      provider:result.provider,runtimeManifestDigest:stored.runtimeManifestDigest,runtimeBytes:stored.runtimeBytes,
      hashingBytes:stored.hashingBytes,runtimePolicyVersion:stored.runtimePolicyVersion,transitions,launches,
      starterAdmission:receipts.find(r=>r.phase==='starter_admitted')?.admission,
      t01:{thicode:bytes.readInt32BE(4),bytes:bytes.length,sha256:sha256(bytes),frameCount:result.frames.length,
        firstTimeS:result.frames[0].timeS,lastTimeS:result.frames.at(-1)!.timeS,unchangedAfterParsing:true},
      coverage:decoded.coverage,actualCycles:result.actualCycles,timestepRangeS:result.timestepRangeS,
      distinctTimestepsS:[...new Set(result.cycleEvidence.orderedCycles.map(c=>c.timestepS))],
      exactRetainedMediumFrames:true,exactRetainedMediumCycles:true,measured,reference,
      massKg:result.frames[0].totalMassKg,maximumMassChangeKg:Math.max(...result.frames.map(f=>Math.abs(f.totalMassKg-result.frames[0].totalMassKg))),
      addedMassRangeKg:[Math.min(...result.frames.map(f=>f.addedMassKg)),Math.max(...result.frames.map(f=>f.addedMassKg))],
      addedMassChangeKg:Math.max(...result.frames.map(f=>Math.abs(f.addedMassChangeKg))),
      energyRangeNmm:{kinetic:[Math.min(...result.frames.map(f=>f.kineticEnergyNmm)),Math.max(...result.frames.map(f=>f.kineticEnergyNmm))],
        internal:[Math.min(...result.frames.map(f=>f.internalEnergyNmm)),Math.max(...result.frames.map(f=>f.internalEnergyNmm))],
        externalWork:[Math.min(...result.frames.map(f=>f.externalWorkNmm)),Math.max(...result.frames.map(f=>f.externalWorkNmm))]},
      paging:{datasets:pageFrames.length*5,pages:pages.length,frameIndices:pageFrames,valuesPerDataset:10,pageBoundUsed:3,repeatIdentityPass:true},
      freshResultRebindCount:resultRebindCount,
      resultDigest:result.resultDigest,cleanupConfirmed:true,quarantined:false,nativeCancellation:'PENDING / not exercised',
      engineeringUsePermitted:false,browserMcpAdmission:'closed'};
    await writeOnce(join(directory,'final-receipt.json'),receipt);console.log(JSON.stringify(receipt));
    }
  } catch(error) {
    // A failed observer must not leave the approved solver running. This is
    // safety cleanup through the SAME provider API, never qualifying evidence
    // for the positive-time cancellation gate, and never a retry.
    if(submission) {
      const active=await provider.getStatus(submission.providerRunId);
      if(active.status==='queued'||active.status==='running') {
        await writeOnce(join(directory,'observer-failure-cleanup.json'),{at:stamp(),error:String(error),state:active,
          action:'provider.cancel safety cleanup; not a qualifying cancellation trigger'});
        await provider.cancel(submission.providerRunId);
      }
    }
    const terminal=submission?await provider.getStatus(submission.providerRunId):null;
    const receipt={at:stamp(),pass:false,error:String(error),directory,studyId:stored.request.studyId,
      submission,terminal,launches,transitions,evidenceRetained:true,automaticRetry:false,browserMcpAdmission:'closed'};
    await writeOnce(join(directory,'failure-receipt.json'),receipt);console.error(JSON.stringify(receipt));process.exitCode=1;
  }
}
