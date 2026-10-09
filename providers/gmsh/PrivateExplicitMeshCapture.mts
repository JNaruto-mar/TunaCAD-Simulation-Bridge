import { mkdtemp,readFile,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnProviderProcess,terminateChildProcess,monitorWorkingDirectory,removeWorkingDirectory,readUtf8FileBounded }
  from '../processLifecycle.mts';
import { runProviderSettingsCommand } from '../../simulation-bridge/providerSettingsCommand.mts';
import { ElectrostaticHostStorage,writeElectrostaticHostOnce } from '../../simulation-bridge/electrostaticHostStorage.mts';
import { openPrivateExplicitExportStore } from '../../simulation-bridge/privateExplicitExportStore.mts';
import { capturePrivateExplicitMesh,rawDigest,writeProtectedMeshBytesOnce } from '../../simulation-bridge/privateExplicitMeshCaptureStore.mts';
import { digest } from '../../simulation-bridge/stableDigest.mts';
import { EXPLICIT_LINEAR_MESH_CONFIGURATION,explicitMeshConfiguration,explicitMeshGeo,explicitMeshConfigurationDigest } from './ExplicitLinearMesh.mts';
import {preflightExplicitMesh} from '../../simulation-bridge/explicitMeshSizing.mts';

/** Explicit trusted launch authorization, not geometry approval or browser input.
 * A new object is NOT permission to rerun a failed operation: caller approvals
 * are bounded independently. This owner is single-use and has no solver port. */
export function createPrivateExplicitGmshCapture(storage:ElectrostaticHostStorage,authorization:{
  purpose:'controlled_explicit_mesh_capture'|'human_explicit_mesh_capture';maximumRuns:1;settingsIdentity:string;executableDigest:string;executableBytes:number;
},test?:{mode:'controlled_test_fixture';purpose:'private_operator_approval_fixture'}) {
  if(authorization.purpose!==(test?'controlled_explicit_mesh_capture':'human_explicit_mesh_capture')||authorization.maximumRuns!==1
    ||![authorization.settingsIdentity,authorization.executableDigest].every(s=>/^sha256:[a-f0-9]{64}$/.test(s)))
    throw new Error('PRIVATE_GMSH_AUTHORIZATION_INVALID');
  let used=false;
  return async(studyId:string,geometry:any,source:any,verifyCurrent:()=>Promise<void>)=>{
    if(used)throw new Error('PRIVATE_GMSH_SINGLE_RUN_CONSUMED');
    const settings=await runProviderSettingsCommand(['--show']);
    if(settings.state!=='GMSH_PATH_CONFIGURED_VERIFIED'||settings.settings?.identity!==authorization.settingsIdentity
      ||'sha256:'+settings.gmsh?.sha256!==authorization.executableDigest||settings.gmsh?.size!==authorization.executableBytes)
      throw new Error('PRIVATE_GMSH_SETTINGS_CHANGED');
    const exported=await (await openPrivateExplicitExportStore(storage.root,test)).read(geometry.exportId);
    if(exported.receipt.studyId!==studyId||digest(exported.receipt.source)!==digest(source)
      ||digest(exported.receipt.geometry)!==digest(geometry)||rawDigest(exported.bytes)!==geometry.byteDigest)
      throw new Error('PRIVATE_GMSH_APPROVED_EXPORT_CHANGED');
    await verifyCurrent();await storage.assertReady();
    // This is freshly derived from the immutable approved request, never a UI
    // estimate. Reject before allocating scratch, consuming the run or spawning.
    const meshResourcePreflight=preflightExplicitMesh(exported.receipt.request);
    const directory=await mkdtemp(join(tmpdir(),'tunacad-explicit-gmsh-')),runId=randomUUID();
    const rawMeshPath=join(directory,'bar.msh'),args=['bar.geo','-3','-format','msh2','-o','bar.msh','-nt','1','-v','3'];
    const configurationDigest=explicitMeshConfigurationDigest(exported.receipt.request),geo=explicitMeshGeo(exported.receipt.request);
    const exactTopology=exported.receipt.request.model.cad?.mappingMethod==='exact-step-boundary-v1';
    let cleanupConfirmed=false,cleanupRecorded=false;
    try {
      await writeFile(join(directory,'approved.step'),exported.bytes,{flag:'wx'});
      await writeFile(join(directory,'bar.geo'),geo,{flag:'wx'});
      if(rawDigest(Uint8Array.from(await readFile(join(directory,'approved.step'))))!==geometry.byteDigest)throw new Error('PRIVATE_GMSH_INPUT_CHANGED');
      const before={schema:'tunacad-explicit-gmsh-predispatch/1',runId,studyId,exportId:geometry.exportId,
        sourceBindingDigest:digest(source),revision:source.revision,sourceEpoch:source.sourceEpoch,
        stepDigest:geometry.byteDigest,stepBytes:geometry.byteLength,exportReceiptDigest:exported.status.receiptDigest,
        settingsIdentity:settings.settings!.identity,executablePath:settings.gmsh!.path,
        executableDigest:'sha256:'+settings.gmsh!.sha256,executableBytes:settings.gmsh!.size,
        args,cwd:directory,rawMeshPath,configuration:explicitMeshConfiguration(exported.receipt.request),configurationDigest,
        meshResourcePreflight,
        createdAt:new Date().toISOString(),solverDispatchEnabled:false};
      await writeElectrostaticHostOnce(join(storage.paths.results,'gmsh-'+runId+'-before.json'),before,32768);
      // Re-read source and settings immediately before the single authorized process.
      await verifyCurrent();const current=await runProviderSettingsCommand(['--show']);
      if(digest(current)!==digest(settings))throw new Error('PRIVATE_GMSH_SETTINGS_CHANGED');
      const fresh=await (await openPrivateExplicitExportStore(storage.root,test)).read(geometry.exportId,exported.status.receiptDigest);
      if(rawDigest(fresh.bytes)!==geometry.byteDigest)throw new Error('PRIVATE_GMSH_EXPORT_CHANGED');
      used=true;
      let stdout='',stderr='',processFailure:string|null=null;
      const child=spawnProviderProcess(settings.gmsh!.path,args,{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe']},
        {cpuTimeLimitMs:30000,memoryLimitBytes:512*1024*1024});
      const abort=async(reason:string)=>{processFailure=reason;await terminateChildProcess(child);};
      const collect=(kind:'stdout'|'stderr',chunk:Buffer)=>{
        if(kind==='stdout')stdout+=chunk.toString('utf8');else stderr+=chunk.toString('utf8');
        if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)>65536)void abort('diagnostic limit exceeded');
      };
      child.stdout!.on('data',chunk=>collect('stdout',chunk));child.stderr!.on('data',chunk=>collect('stderr',chunk));
      const stopMonitor=monitorWorkingDirectory({child,directory,maximumBytes:32*1024*1024,onExceeded:async()=>abort('scratch limit exceeded')});
      const timer=setTimeout(()=>void abort('wall time limit exceeded'),30000);
      const termination=await new Promise<{exitCode:number|null;signal:string|null}>(resolve=>{
        child.once('error',error=>{processFailure=error.message;});child.once('close',(exitCode,signal)=>resolve({exitCode,signal}));
      });clearTimeout(timer);stopMonitor();
      // Retain contemporaneous post-exit identities BEFORE decoding, validation,
      // cleanup or any reporter. A failing parser never requires another run.
      let text='',meshReadFailure:string|null=null;
      try{text=await readUtf8FileBounded(rawMeshPath,EXPLICIT_LINEAR_MESH_CONFIGURATION.maximumRawBytes);}
      catch(error){meshReadFailure=String(error);}
      let topologyText='',cadTopologyReadFailure:string|null=null;
      if(exactTopology)try{topologyText=await readUtf8FileBounded(join(directory,'cad-topology.txt'),128*1024);}
      catch(error){cadTopologyReadFailure=String(error);}
      const execution={schema:'tunacad-explicit-gmsh-execution/1',...termination,processFailure,meshReadFailure,
        runId,studyId,exportId:geometry.exportId,stepDigest:geometry.byteDigest,sourceBindingDigest:digest(source),
        settingsIdentity:settings.settings!.identity,executableDigest:'sha256:'+settings.gmsh!.sha256,
        invocation:{executable:settings.gmsh!.path,args,cwd:directory},configurationDigest,rawMeshPath,predispatchDigest:digest(before),
        rawMeshDigest:rawDigest(text),rawMeshByteLength:Buffer.byteLength(text),
        ...(exactTopology?{cadTopologyDigest:rawDigest(topologyText),cadTopologyByteLength:Buffer.byteLength(topologyText),cadTopologyReadFailure}:{}),
        stdout,stderr,stdoutDigest:rawDigest(stdout),stderrDigest:rawDigest(stderr),createdAt:new Date().toISOString()};
      await writeElectrostaticHostOnce(join(storage.paths.results,'gmsh-'+runId+'-after.json'),execution,128*1024);
      if(text)await writeProtectedMeshBytesOnce(join(storage.paths.results,'explicit-raw-'+execution.rawMeshDigest.slice(7)+'.msh'),new TextEncoder().encode(text));
      if(topologyText)await writeProtectedMeshBytesOnce(join(storage.paths.results,'explicit-cad-topology-'+rawDigest(topologyText).slice(7)+'.txt'),new TextEncoder().encode(topologyText));
      if(termination.exitCode!==0||termination.signal||processFailure||meshReadFailure||cadTopologyReadFailure)throw new Error('PRIVATE_GMSH_PROCESS_FAILED: '+JSON.stringify(termination));
      cleanupConfirmed=await removeWorkingDirectory(directory);
      await writeElectrostaticHostOnce(join(storage.paths.results,'gmsh-'+runId+'-cleanup.json'),{
        schema:'tunacad-explicit-gmsh-cleanup/1',runId,cleanupConfirmed},4096);cleanupRecorded=true;
      if(!cleanupConfirmed)throw new Error('PRIVATE_GMSH_CLEANUP_FAILED');
      await verifyCurrent();await capturePrivateExplicitMesh(storage,geometry.exportId,execution,text,verifyCurrent,test);
    }finally{
      if(!cleanupRecorded){cleanupConfirmed=await removeWorkingDirectory(directory);
        await writeElectrostaticHostOnce(join(storage.paths.results,'gmsh-'+runId+'-cleanup.json'),{
          schema:'tunacad-explicit-gmsh-cleanup/1',runId,cleanupConfirmed},4096);}
      if(!cleanupConfirmed)throw new Error('PRIVATE_GMSH_CLEANUP_FAILED');
    }
  };
}
