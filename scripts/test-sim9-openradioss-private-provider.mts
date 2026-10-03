// Focused no-solver integration. Fake installations are NEVER executed. A
// controlled process port supplies authenticated retained bytes for mapping.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { sealExplicitDynamics, type ExplicitDynamicsDraft } from '../simulation-bridge/explicitDynamicsFoundation.mts';
import { OpenRadiossExplicitSolverProvider, type OpenRadiossHost } from '../providers/openradioss/OpenRadiossExplicitSolverProvider.mts';
import { prepareOpenRadiossDeck, RUN_NAME } from '../providers/openradioss/OpenRadiossDeck.mts';
import { admitOpenRadiossStarter } from '../providers/openradioss/OpenRadiossStarterAdmission.mts';
import { inspectOpenRadiossInstallation, sha256 } from '../providers/openradioss/OpenRadiossInstallation.mts';
import { OPENRADIOSS_RUNTIME_SPECIFICATIONS } from '../providers/openradioss/OpenRadiossRuntimeManifest.mts';
import { removeWorkingDirectory } from '../providers/processLifecycle.mts';
import { readBoundedStarterConcentratedLoads } from '../simulation-bridge/openRadiossStarterLoads.mts';
import type { OpenRadiossProcessDriver, OpenRadiossProcessExit } from '../providers/openradioss/OpenRadiossProcess.mts';
const retained=process.env.TUNACAD_OPENRADIOSS_MEDIUM_SOURCE_DIR;
const cancellationOnly=process.argv.includes('--cancellation-only');
const durableOnly=process.argv.includes('--durable-retention-only');
const selectedCases=process.argv.filter(flag=>flag.startsWith('--cancel-case=')).map(flag=>flag.slice('--cancel-case='.length));
const cancellationCases=['cancel_queued','cancel_starter','cancel_engine','cancel_final','cancel_tree_failure'];
assert.ok(process.argv.slice(2).every(flag=>flag==='--cancellation-only'||flag==='--durable-retention-only'||flag.startsWith('--cancel-case=')),'Unsupported focused test mode');
assert.ok(!durableOnly||(!cancellationOnly&&!selectedCases.length));
assert.ok(selectedCases.every(name=>cancellationCases.includes(name))&&(!selectedCases.length||cancellationOnly));
assert.ok(retained,'Authentic retained medium evidence required; no solver fallback');
const source=JSON.parse(await readFile(join(retained,'pre-dispatch-receipt.json'),'utf8'));
const frd=await readFile(source.sourceFrd,'utf8');
assert.equal(sha256(frd),'700f03b250203d5d72e01aedf156b81c843e8b467a391460387061be9623ea71');
const t01=await readFile(join(retained,`${RUN_NAME}T01`));
assert.equal(sha256(t01),'a679deb05ab2476afce7fe12d8c4eed5aaf7784065a497b68d24ff61972be559');
const trace=await readFile(join(retained,'engine.stdout.txt'),'utf8');
assert.equal(sha256(trace),'66d1058c2e83c14178a07c31bde6b43f80981b3e3e1e86ba0e2026e3060885b2');
const starterListing=await readFile(join(retained,`${RUN_NAME}_0000.out`),'utf8');
assert.equal(sha256(starterListing),'37c03e95d4d01384f8c7d1256d80860afc199efffcbd32b3f97c0a2899cdeacd');
const engineListing=await readFile(join(retained,`${RUN_NAME}_0001.out`),'utf8');
const nodes:Array<{id:number;xyzMm:[number,number,number]}>=[], elements:Array<{id:number;type:'C3D4';nodes:[number,number,number,number]}>=[];
const lines=frd.split(/\r?\n/), start=lines.findIndex(l=>/^\s*2C\s/.test(l)), end=lines.findIndex(l=>/^\s*3C\s/.test(l));
for(const line of lines.slice(start+1,end)) if(/^\s*-1\s/.test(line)) {
  const [,id,...xyz]=line.trim().split(/\s+/).map(Number);nodes.push({id,xyzMm:xyz as [number,number,number]});
}
for(let i=end+1;i+1<lines.length;i++) {
  if(/^\s*-3\s*$/.test(lines[i])) break;
  if(/^\s*-1\s/.test(lines[i])) {const id=Number(lines[i].trim().split(/\s+/)[1]);
    elements.push({id,type:'C3D4',nodes:lines[++i].trim().split(/\s+/).slice(1).map(Number) as [number,number,number,number]});}
}
const facets=new Map<string,{nodes:[number,number,number];uses:number}>();
for(const e of elements) for(let k=0;k<4;k++) {const nodes=e.nodes.filter((_,i)=>i!==k) as [number,number,number];
  const key=[...nodes].sort((a,b)=>a-b).join(',');facets.set(key,{nodes,uses:(facets.get(key)?.uses??0)+1});}
const geometryDigest='sha256:'+'a'.repeat(64);
const mesh={runtime:'Gmsh 4.15.2',inputGeometryDigest:geometryDigest,nodes,elements,
  surfaceTriangles:[...facets.values()].filter(f=>f.uses===1).map((f,i)=>({id:i+1,nodes:f.nodes}))};
assert.equal(nodes.length,88);assert.equal(elements.length,208);
const draft:ExplicitDynamicsDraft={schema:'tunacad-explicit-dynamics-foundation/0.1',studyId:'controlled-private-provider',
  analysis:{type:'explicit_structural_dynamics',assumptions:['one_linear_elastic_solid','small_displacement','zero_initial_conditions','undamped','no_contact','no_mass_scaling'],
    durationS:50e-6,outputTimesS:[1e-6,50e-6],integration:{kind:'central_difference_cfl_bound',minimumCharacteristicLengthMm:5,
      safetyFactor:0.8,maximumTimeStepS:4e-7,maximumIncrements:20000}},
  model:{projectRevision:'controlled-r1',domainId:'bar',partId:'part',bodyId:'body',geometryDigest,
    kind:'straight_rectangular_axial_bar',lengthMm:100,widthMm:10,heightMm:10,fixedFaceId:'fixed',loadedFaceId:'loaded'},
  material:{materialId:'steel',domainId:'bar',model:'isotropic_linear_elastic',youngsModulusMPa:200000,poissonRatio:0.3,densityKgM3:7800,
    source:{kind:'custom',reference:'controlled engineering material',revision:'m1'}},
  initialConditions:{displacementMm:[0,0,0],velocityMmPerS:[0,0,0]},restraint:{kind:'fixed_face',faceId:'fixed',displacementMm:[0,0,0]},
  load:{kind:'axial_step_face_force',faceId:'loaded',onsetS:0,forceN:[100,0,0],coordinateSystem:'analysis',history:'constant_after_onset'},
  mesh:{elementFormulation:'C3D4',maximumNodes:100000,maximumElements:50000},
  requestedResults:['loaded_face_axial_displacement_history','fixed_face_axial_reaction_history','kinetic_energy_history','strain_energy_history','applied_work_history'],
  units:{length:'mm',time:'s',force:'N',stress:'MPa',density:'kg/m^3',velocity:'mm/s',acceleration:'mm/s^2',energy:'N*mm'}};
const request=sealExplicitDynamics(draft),prepared=prepareOpenRadiossDeck(request,mesh);
if(!cancellationOnly&&!durableOnly) {
assert.equal(prepared.expected.loads.reduce((s,l)=>s+l.forceN,0),100);
assert.equal(sha256(prepared.starter),source.starterSha256);assert.equal(sha256(prepared.engine),source.engineSha256);
assert.deepEqual(prepareOpenRadiossDeck(structuredClone(request),structuredClone(mesh)),prepared);
const reordered={...mesh,nodes:[...mesh.nodes].reverse(),elements:[...mesh.elements].reverse()};
assert.equal(prepareOpenRadiossDeck(request,reordered).starter,prepared.starter);
assert.match(prepared.engine,/\/TFILE\/4/);assert.doesNotMatch(prepared.engine,/\/TFILE\/3|CST|AMS|th_to_csv/);
const interpreted=admitOpenRadiossStarter(starterListing,prepared);
assert.equal(interpreted.expectedCycles,157);assert.equal(interpreted.loads.resultantN,100);
assert.deepEqual(readBoundedStarterConcentratedLoads(starterListing,prepared.expected.loads),interpreted.loads);
const otherDraft=structuredClone(draft);otherDraft.load.forceN[0]=50;
// Preserve the frozen 12-place serializer: fail closed if its rounded face
// weights cannot meet the existing absolute resultant tolerance.
assert.throws(()=>prepareOpenRadiossDeck(sealExplicitDynamics(otherDraft),mesh),/serialized load resultant/);
const otherLoads=prepared.expected.loads.map(n=>({id:n.id,forceN:10}));
const section=' NCONLD: NUMBER OF CONCENTRATED LOADS 5\nCONCENTRATED LOADS\n------------------\nNODE SKEW DIR LOAD_CURVE SENSOR SCALE_X SCALE_Y\n'+
  otherLoads.map(n=>`${n.id} 0 X 1 0 1 ${n.forceN}`).join('\n')+'\nSPMD IS CHECKING FOR ELEMENT DELETION IN :\n';
assert.equal(readBoundedStarterConcentratedLoads(section,otherLoads,50).resultantN,50);
assert.throws(()=>readBoundedStarterConcentratedLoads(section,otherLoads),/resultant/);
for(const physics of ['contact','plasticity','massScaling','damping','largeDeformation','domains'])
  assert.throws(()=>prepareOpenRadiossDeck({...request,[physics]:true},mesh));
for(const change of [()=>({...request,contact:true}),()=>({...request,initialConditions:{displacementMm:[1,0,0],velocityMmPerS:[0,0,0]}}),
  ()=>({...request,mesh:{...request.mesh,elementFormulation:'C3D10'}}),()=>({...request,units:{...request.units,energy:'J'}})])
  assert.throws(()=>prepareOpenRadiossDeck(change(),mesh));
for(const change of [()=>({...mesh,inputGeometryDigest:'sha256:'+'b'.repeat(64)}),()=>({...mesh,nodes:mesh.nodes.slice(1)}),
  ()=>({...mesh,elements:[...mesh.elements.slice(1),mesh.elements[1]]}),()=>({...mesh,surfaceTriangles:mesh.surfaceTriangles.slice(1)})])
  assert.throws(()=>prepareOpenRadiossDeck(request,change()));
assert.throws(()=>admitOpenRadiossStarter(starterListing.replace('0 ERROR(S)','1 ERROR(S)'),prepared));
assert.throws(()=>admitOpenRadiossStarter(starterListing.replace('X           1','Y           1'),prepared));
}

const directory=await mkdtemp(join(tmpdir(),'tunacad-openradioss-private-test-'));
const root=join(directory,'installation');
for(const path of ['exec','licenses','hm_cfg_files/config/CFG/radioss2026','hm_cfg_files/config/CFG/UNITS','hm_cfg_files/messages',
  'extlib/hm_reader/win64','extlib/intelOneAPI_runtime/win64','extlib/h3d/lib/win64']) await mkdir(join(root,path),{recursive:true});
for(const [file,value] of [['exec/starter_win64.exe','mock-starter-never-execute'],['exec/engine_win64.exe','mock-engine-never-execute'],
  ['COPYRIGHT.md','controlled test license']]) await writeFile(join(root,file),value);
for(const file of OPENRADIOSS_RUNTIME_SPECIFICATIONS) if(!file.path.startsWith('exec/')) {
  const path=join(root,file.path);await mkdir(join(path,'..'),{recursive:true});await writeFile(path,'controlled native runtime');
}
const config={root,starterExecutable:join(root,'exec','starter_win64.exe'),engineExecutable:join(root,'exec','engine_win64.exe'),
  runtimeVersion:'2026' as const,starterSha256:sha256('mock-starter-never-execute'),engineSha256:sha256('mock-engine-never-execute')};
const installed=await inspectOpenRadiossInstallation(config);assert.equal(installed.environment.OMP_NUM_THREADS,'1');
if(!cancellationOnly) {
await assert.rejects(()=>inspectOpenRadiossInstallation({...config,engineExecutable:join(root,'exec','engine_win64_sp.exe')}));
await assert.rejects(()=>inspectOpenRadiossInstallation({...config,engineSha256:'0'.repeat(64)}));
await assert.rejects(()=>inspectOpenRadiossInstallation({...config,root:join(root,'missing')}));
}

function alteredBinary(kind:string) {
  const bytes=Buffer.from(new Uint8Array(t01));
  if(kind==='truncated') return bytes.subarray(0,-2);
  if(kind==='unsupported') {bytes.writeInt32BE(9999,4);return bytes;}
  const records:Array<{at:number;size:number}>=[];
  for(let at=0;at<bytes.length;) {const size=bytes.readInt32BE(at);records.push({at:at+4,size});at+=8+size;}
  if(kind==='4021') {
    // Controlled 4021 equivalent from the already source-backed explicit
    // schema: three extra header records; hierarchy title width 40 ->100.
    // Authentic 3040 bytes remain untouched and this is NOT provider evidence.
    const record=(data:Buffer)=>{const marker=Buffer.alloc(4);marker.writeInt32BE(data.length);
      return Buffer.concat([new Uint8Array(marker),new Uint8Array(data),new Uint8Array(marker)]);};
    const integer=(v:number)=>{const b=Buffer.alloc(4);b.writeInt32BE(v);return b;};
    const group=records.findIndex(r=>r.size===60&&bytes.subarray(r.at+20,r.at+60).toString('ascii').trim()==='Bounded axial bar nodes');
    assert.ok(group>8);
    const output:Uint8Array[]=[];
    records.forEach((r,i)=>{
      let data=Buffer.from(new Uint8Array(bytes.subarray(r.at,r.at+r.size)));
      if(i===0) data.writeInt32BE(4021,0);
      const offset=i===4||i===5||i===6||i===7?4:i===8||i===group?20:i>group&&i<=group+10?4:null;
      if(offset!==null) data=Buffer.concat([new Uint8Array(data.subarray(0,offset)),
        new Uint8Array(Buffer.from(data.subarray(offset,offset+40).toString('ascii').padEnd(100))),new Uint8Array(data.subarray(offset+40))]);
      output.push(new Uint8Array(record(data)));
      if(i===1) {const units=Buffer.alloc(12);[0,4,8].forEach(at=>units.writeFloatBE(1,at));
        output.push(new Uint8Array(record(integer(2))),new Uint8Array(record(integer(100))),new Uint8Array(record(units)));}
    });
    return Buffer.concat(output);
  }
  const globals=records.filter((r,i)=>r.size===88&&records[i-1]?.size===4&&records[i-1].at>700);
  assert.equal(globals.length,50);
  if(kind==='added') bytes.writeFloatBE(1e-8,globals[1].at+16*4);
  else if(kind==='nan') bytes.writeFloatBE(NaN,globals[1].at+4);
  else if(kind==='mass') bytes.writeFloatBE(0.0078,globals[0].at+5*4);
  else if(kind==='missing_frame') {const global=globals.at(-1)!,time=records[records.findIndex(r=>r.at===global.at)-1];return bytes.subarray(0,time.at-4);}
  return bytes;
}
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
// Observation timeout is not a production lifecycle deadline. Repeated hashes
// of the exact 86-file mock runtime may exceed the old two-second test wait.
async function waitFor(predicate:()=>boolean) {
  const deadline=Date.now()+10000;
  while(!predicate()&&Date.now()<deadline) await sleep(10);
}
let assertions=0;
async function scenario(mode:string,expect:'succeeded'|'failed'|'cancelled'='failed') {
  const records:Array<Record<string,any>>=[],launches:string[]=[],killedTrees:Array<number[]>=[];
  const durableArtifacts:Array<Record<string,any>>=[],durableCandidates:Array<Record<string,any>>=[];
  let cleanupCalls=0;
  let sourceChanged=false,activeStage='',scratch='',provider!:OpenRadiossExplicitSolverProvider;
  const receiptStorage=join(directory,'receipts',mode);await mkdir(receiptStorage,{recursive:true});
  let releaseFinal!:(value?:unknown)=>void;
  const finalBarrier=new Promise(resolve=>{releaseFinal=resolve;});
  const binding={authorizationId:'controlled-authorization-'+mode,requestDigest:request.requestDigest,meshDigest:prepared.meshDigest,
    revision:request.model.projectRevision,geometryDigest};
  const host:OpenRadiossHost={readAuthorization:async()=>({...binding}),rebindApprovedInput:async(_binding,stage)=>
    ({...binding,revision:sourceChanged || (mode==='stale_engine'&&stage==='engine')?'changed-r2':binding.revision}),
    retainEvidence:async receipt=>{
      records.push(structuredClone(receipt));
      await writeFile(join(receiptStorage,`${records.length}-${receipt.phase}.json`),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
      if(mode==='restart_tamper'&&receipt.phase==='starter_admitted') await writeFile(join(scratch,`${RUN_NAME}_0000_0001.rst`),'tampered');
      if(mode==='deck_tamper'&&receipt.phase==='engine_launch') await writeFile(join(scratch,`${RUN_NAME}_0001.rad`),'tampered');
      if(mode==='runtime_tamper'&&receipt.phase==='starter_admitted') await writeFile(config.engineExecutable,'tampered-runtime');
      if(mode==='launch_runtime_tamper'&&receipt.phase==='engine_launch') await writeFile(config.engineExecutable,'tampered-runtime');
      if(mode==='sink_failure'&&receipt.phase==='prepared') throw new Error('protected sink unavailable');
      if(mode==='cancel_final'&&receipt.phase==='finalized') await finalBarrier;
    }};
  if(mode.startsWith('durable_'))host.durableEvidence={
    artifacts:async(record,bytes)=>{
      if(mode==='durable_byte_fail'&&record.phase==='engine_output_pin')throw new Error('controlled durable T01 disk failure');
      for(const [name,pin] of Object.entries(record.artifacts) as Array<[string,{sha256:string;bytes:number}]>){
        assert.equal(sha256(Buffer.from(bytes[name])),pin.sha256);assert.equal(bytes[name].length,pin.bytes);
        await writeFile(join(receiptStorage,record.phase+'-'+name),new Uint8Array(bytes[name]),{flag:'wx'});
      }
      durableArtifacts.push(structuredClone(record));
    },candidate:async record=>{
      if(mode==='durable_candidate_fail')throw new Error('controlled candidate disk failure');
      assert.ok(durableArtifacts.some(r=>r.phase==='engine_output_pin'));
      await writeFile(join(receiptStorage,'candidate.json'),JSON.stringify(record),{flag:'wx'});durableCandidates.push(structuredClone(record));
    }};
  const driver:OpenRadiossProcessDriver={start(_exe,args,options){
    const stage=args.includes('-np')?'starter':'engine';launches.push(stage);activeStage=stage;scratch=options.cwd;
    let resolve!:(exit:OpenRadiossProcessExit)=>void;
    const completion=new Promise<OpenRadiossProcessExit>(r=>resolve=r);
    const output=async()=>{
      if(stage==='starter') {
        const listing=mode==='starter_mismatch'?starterListing.replace('NUMNOD: NUMBER OF NODAL POINTS. . . . . . . . . . . .        88',
          'NUMNOD: NUMBER OF NODAL POINTS. . . . . . . . . . . .        87'):
          mode==='budget'?starterListing.replaceAll('5.3236366039543E-07','1.0000000000000E-12'):starterListing;
        await writeFile(join(scratch,`${RUN_NAME}_0000.out`),listing);
        await writeFile(join(scratch,`${RUN_NAME}_0000_0001.rst`),'controlled restart - contemporaneously pinned');
        resolve({exitCode:mode==='starter_exit'?1:0,stdout:Buffer.from('controlled Starter'),stderr:Buffer.alloc(0),error:null,treeTerminated:true});
      } else {
        await writeFile(join(scratch,`${RUN_NAME}_0001.out`),engineListing);
        const bytes=['4021','truncated','unsupported','added','nan','mass','missing_frame'].includes(mode)?alteredBinary(mode):t01;
        await writeFile(join(scratch,`${RUN_NAME}T01`),new Uint8Array(bytes));
        resolve({exitCode:mode==='engine_exit'?1:0,stdout:Buffer.from(mode==='coverage'?trace.replace(/^\s*NC=\s*156[^\r\n]*\r?\n/m,''):trace),
          stderr:Buffer.alloc(0),error:null,treeTerminated:mode!=='cancel_tree_failure'});
      }
    };
    if(mode!=='cancel_'+stage&&!(mode==='cancel_tree_failure'&&stage==='engine')) void output();
    return {pid:500+launches.length,completion,terminateTree:async()=>{
      // Model a wrapper plus worker descendants, require tree acknowledgement,
      // then deliver a late exit-0 result. Cancellation must still win.
      killedTrees.push([500+launches.length,600+launches.length,700+launches.length]);await output();
      return mode!=='cancel_tree_failure';
    }};
  }};
  provider=new OpenRadiossExplicitSolverProvider(config,host,driver,
    mode==='cleanup_fail'?async()=>false:mode==='cleanup_throw'?async()=>{throw new Error('cleanup IO failure');}:async path=>{
      cleanupCalls++;if(mode==='durable_valid'){assert.equal(durableCandidates.length,1);assert.ok(durableArtifacts.some(r=>r.phase==='engine_output_pin'));}
      return removeWorkingDirectory(path);
    });
  const submitted=await provider.submit(request,mesh);
  assert.equal(await provider.getResult(submitted.providerRunId),null);
  if(mode==='cancel_queued') await provider.cancel(submitted.providerRunId);
  else if(mode==='cancel_final') {
    await waitFor(()=>records.some(r=>r.phase==='finalized'));
    assert.ok(records.some(r=>r.phase==='finalized'));
    const cancelling=provider.cancel(submitted.providerRunId);releaseFinal();await cancelling;
    assert.ok(records.some(r=>r.phase==='late_cancellation_quarantined'));
  }
  else if(mode==='cancel_starter'||mode==='cancel_engine'||mode==='cancel_tree_failure') {
    const target=mode==='cancel_starter'?'starter':'engine';
    await waitFor(()=>activeStage===target);
    assert.equal(activeStage,target);
    assert.equal((await provider.getStatus(submitted.providerRunId)).status,'running');
    await assert.rejects(()=>provider.submit(request,mesh),/resource bound/);
    await provider.cancel(submitted.providerRunId);
    assert.equal(killedTrees[0].length,3);
  }
  let status=await provider.getStatus(submitted.providerRunId);
  const observationDeadline=Date.now()+10000; // same bounded mock-runtime wait as waitFor above
  while(['queued','running'].includes(status.status)&&Date.now()<observationDeadline){await sleep(2);status=await provider.getStatus(submitted.providerRunId);}
  assert.equal(status.status,expect,JSON.stringify({mode,status}));
  assert.ok(records.some(r=>r.phase==='finalized'));
  if(expect==='succeeded') {
    assert.deepEqual(launches,['starter','engine']);
    const result=(await provider.getResult(submitted.providerRunId))!;
    assert.equal(result.executionStatus,'succeeded');assert.equal(result.actualCycles,157);assert.equal(result.frames.length,50);
    assert.equal(result.sampling.scope,'fixed_and_loaded_FACE_nodes_only');assert.equal(result.units.impulse,'N*s');
    assert.equal(result.frames[0].nodes.length,10);assert.equal(result.frames[0].supportImpulseNs,0);
    assert.equal(result.frames.at(-1)!.addedMassChangeKg,0);assert.equal(result.actualMassScaling,false);
    assert.equal(result.cycleEvidence.digest,sha256(trace));
    assert.deepEqual(result.timestepRangeS,[Math.min(...result.cycleEvidence.orderedCycles.map(c=>c.timestepS)),
      Math.max(...result.cycleEvidence.orderedCycles.map(c=>c.timestepS))]);
    assert.deepEqual((await provider.getResult(submitted.providerRunId))!.frames,result.frames);
    for(const quantity of ['displacement','velocity','acceleration','reactionImpulse','reactionForce'] as const) {
      const first=await provider.getFieldDataset(submitted.providerRunId,1,quantity,undefined,3);
      assert.equal(first.values.length,3);assert.equal(first.domainId,'bar');assert.equal(first.axis,'X');
      assert.equal(first.chunkDigest,digest(first.values));
      assert.deepEqual(await provider.getFieldDataset(submitted.providerRunId,1,quantity,undefined,3),first);
      const second=await provider.getFieldDataset(submitted.providerRunId,1,quantity,first.nextCursor!,3);
      assert.equal(second.offset,3);assert.equal(second.datasetDigest,first.datasetDigest);
      await assert.rejects(()=>provider.getFieldDataset(submitted.providerRunId,2,quantity,first.nextCursor!,3),/Cross/);
      await assert.rejects(()=>provider.getFieldDataset(submitted.providerRunId,1,quantity,undefined,129));
    }
    result.frames[0].nodes[0].displacementMm=123;
    assert.equal((await provider.getResult(submitted.providerRunId))!.frames[0].nodes[0].displacementMm,0);
    await assert.rejects(()=>provider.submit(request,mesh),/consumed/);
    sourceChanged=true;assert.equal(await provider.getResult(submitted.providerRunId),null);
    sourceChanged=false;assert.equal(await provider.getResult(submitted.providerRunId),null);
    assert.equal((await provider.getStatus(submitted.providerRunId)).status,'failed');
  } else {
    assert.equal(await provider.getResult(submitted.providerRunId),null);
    await assert.rejects(()=>provider.getFieldDataset(submitted.providerRunId,0,'displacement'));
    if(mode.startsWith('starter')||['budget','restart_tamper','deck_tamper','runtime_tamper','launch_runtime_tamper','stale_engine','cancel_starter'].includes(mode))
      assert.equal(launches.includes('engine'),false);
    if(mode==='sink_failure'||mode==='cancel_queued') assert.equal(launches.length,0);
  }
  for(const phase of ['starter','engine']) {
    const pin=records.find(r=>r.phase===phase+'_output_pin');
    if(pin) {assert.equal(pin.capturedBeforeInterpretation,true);assert.ok(pin.stdoutSha256);}
  }
  if(mode==='runtime_tamper'||mode==='launch_runtime_tamper') await writeFile(config.engineExecutable,'mock-engine-never-execute');
  if(mode==='cleanup_fail'||mode==='cleanup_throw') {assert.equal(records.at(-1)!.cleaned,false);await removeWorkingDirectory(scratch);}
  if(mode==='cancel_tree_failure') {assert.equal(records.at(-1)!.treeTerminated,false);assert.equal(records.at(-1)!.cleaned,false);
    await removeWorkingDirectory(scratch);}
  if(mode==='durable_byte_fail'||mode==='durable_candidate_fail'){
    assert.equal(cleanupCalls,0);assert.equal(records.at(-1)!.cleaned,false);assert.equal(records.at(-1)!.quarantined,true);
    assert.match(records.at(-1)!.failure,/retention failed.*preserved/i);
    assert.equal(sha256(await readFile(join(scratch,`${RUN_NAME}T01`))),sha256(t01));
    // Only the controlled mock scratch is removed after the preservation
    // assertion. Canonical retained authentic evidence is never altered.
    await removeWorkingDirectory(scratch);
  }
  assertions++;console.log(JSON.stringify({mode,state:status.status,launches,killedTrees,pass:true}));
}
if(durableOnly){
  await scenario('durable_valid','succeeded');
  await scenario('durable_byte_fail');await scenario('durable_candidate_fail');
} else if(!cancellationOnly) {
await scenario('valid','succeeded');
await scenario('4021','succeeded');
for(const mode of ['starter_exit','starter_mismatch','restart_tamper','deck_tamper','runtime_tamper','launch_runtime_tamper','stale_engine','budget',
  'engine_exit','truncated','unsupported','added','nan','mass','missing_frame','coverage','cleanup_fail','cleanup_throw','sink_failure']) await scenario(mode);
}
for(const mode of durableOnly?[]:selectedCases.length?selectedCases:cancellationCases)
  await scenario(mode,mode==='cancel_tree_failure'?'failed':'cancelled');
assert.equal(sha256(await readFile(join(retained,`${RUN_NAME}T01`))),sha256(t01));
console.log(JSON.stringify({pass:true,scenarioCount:assertions,realSolverProcesses:0,
  evidence:'controlled process mocks + authentic retained T01; not real Bridge provider execution',directory,
  engineeringUsePermitted:false,browserMcpAdmission:'closed'}));
