import {prepareOpenRadiossDeck} from './OpenRadiossDeck.mts';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {digest} from '../../simulation-bridge/stableDigest.mts';
import {SimulationJobWorkspace,createSimulationExecutionWorkspace,writeSimulationJsonOnce} from '../../simulation-bridge/simulationJobWorkspace.mts';
import {explicitMeshGeo,parseExplicitMsh22,admitExplicitLinearMesh} from '../gmsh/ExplicitLinearMesh.mts';
import {parseExplicitStepTopology} from '../gmsh/ExplicitStepTopology.mts';
import {spawnProviderProcess,terminateChildProcess,monitorWorkingDirectory,readUtf8FileBounded} from '../processLifecycle.mts';
import {OpenRadiossExplicitSolverProvider} from './OpenRadiossExplicitSolverProvider.mts';
import {inspectOpenRadiossInstallation,sha256,type OpenRadiossInstallation} from './OpenRadiossInstallation.mts';
import {EXPLICIT_ARTIFACT_POLICY_DIGEST} from './OpenRadiossExecutionReadiness.mts';
import type {ExplicitExecutionDriver} from '../ComposedExplicitProvider.mts';
/** Same mesh/solver arguments, gates and resource limits as the validated
 * autonomous runner. Accepted immutable input replaces live-browser callbacks;
 * runtime fingerprints and artifact/source checks remain fresh at each stage. */
export function verifyExplicitAcceptedInput(request:unknown,step:Uint8Array){
 const identity=digest({request,step:sha256(Buffer.from(step))});
 return ()=>{if(digest({request,step:sha256(Buffer.from(step))})!==identity)throw Error('EXPLICIT_ACCEPTED_INPUT_CHANGED');};
}
export async function settleExplicitSolverRun(provider:Pick<OpenRadiossExplicitSolverProvider,'settled'|'getStatus'>,id:string,signal:AbortSignal){
 try{await provider.settled(id,signal);}catch(cleanupError){
  const status=await provider.getStatus(id);
  if(status.status==='failed'&&status.failure?.message){
   const message=status.failure.message;
   const code=/EXECUTION_STAGE_BUDGET_(?:EXCEEDED|EXHAUSTED): (starter|engine)/.exec(message);
   throw Object.assign(Error(code?'EXPLICIT_'+code[1].toUpperCase()+'_BUDGET_EXCEEDED':'EXPLICIT_SOLVER_FAILED',{cause:cleanupError}),{executionFailure:message.slice(0,12000),cleanupFailure:String(cleanupError).slice(0,12000)});
  }
  throw cleanupError;
 }
}
export function explicitNativeFailure(failure:{message?:string;code?:string}|undefined,cause?:unknown){
 const message=failure?.message??failure?.code??'EXPLICIT_SOLVER_FAILED';
 const stage=/EXECUTION_STAGE_BUDGET_(?:EXCEEDED|EXHAUSTED): (starter|engine)/.exec(message);
 return Object.assign(Error(stage?'EXPLICIT_'+stage[1].toUpperCase()+'_BUDGET_EXCEEDED':'EXPLICIT_SOLVER_FAILED',{cause}),{executionFailure:message.slice(0,12000)});
}
/** Decode the contemporaneous Gmsh outputs for the accepted STEP. Exact FACE
 * identity comes from the B-Rep metadata, never inferred from mesh area/axes. */
export function admitAcceptedExplicitBridgeMesh(request:Parameters<ExplicitExecutionDriver['execute']>[0],step:Uint8Array,text:string,topologyText?:string){
 const exact=request.model.cad?.mappingMethod==='exact-step-boundary-v1';
 const mesh=parseExplicitMsh22(text,request.model.geometryDigest,true,exact);
 if(exact){
  if(topologyText===undefined)throw Error('EXPLICIT_STEP_TOPOLOGY_REQUIRED');
  mesh.cadEvidence={topology:parseExplicitStepTopology(topologyText),metadataDigest:'sha256:'+sha256(topologyText),stepByteDigest:'sha256:'+sha256(Buffer.from(step))};
 }
 admitExplicitLinearMesh(request,mesh);return mesh;
}
export class ExplicitBridgeExecution implements ExplicitExecutionDriver {
 constructor(private gmsh:string,private installation:OpenRadiossInstallation,private runtimeDigest:string){}
 async execute(request:Parameters<ExplicitExecutionDriver['execute']>[0],step:Uint8Array,signal:AbortSignal,phase:(value:string)=>void){
  let workspace:SimulationJobWorkspace|undefined,meshSpace:SimulationJobWorkspace|undefined,child:ReturnType<typeof spawnProviderProcess>|undefined;
  let provider:OpenRadiossExplicitSolverProvider|undefined,runId:string|undefined,first:unknown,output:any;
  const verifyInput=verifyExplicitAcceptedInput(request,step),unchanged=()=>{signal.throwIfAborted();verifyInput();};
  let records=0,recordBytes=0;
  try{
   unchanged();const initial=await inspectOpenRadiossInstallation(this.installation);if(initial.runtimeDigest!==this.runtimeDigest)throw Error('EXPLICIT_RUNTIME_CHANGED');
   workspace=await SimulationJobWorkspace.create();meshSpace=await createSimulationExecutionWorkspace(workspace) as SimulationJobWorkspace;
   const save=async(name:string,value:unknown)=>{if(!/^[A-Za-z0-9_.-]+$/.test(name))throw Error('EXPLICIT_EVIDENCE_NAME_INVALID');const bytes=Buffer.byteLength(JSON.stringify(value));if(++records>128||(recordBytes+=bytes)>64*1024**2)throw Error('EXPLICIT_EVIDENCE_LIMIT');await writeSimulationJsonOnce(join(workspace!.paths.results,name+'.json'),value,16*1024**2);};
   const cwd=meshSpace.root;await writeFile(join(cwd,'approved.step'),step,{flag:'wx'});await writeFile(join(cwd,'bar.geo'),explicitMeshGeo(request),{flag:'wx'});
   unchanged();phase('meshing');let diagnostic='',stageFailure:string|undefined;
   child=spawnProviderProcess(this.gmsh,['bar.geo','-3','-format','msh2','-o','bar.msh','-nt','1','-v','3'],{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']},{cpuTimeLimitMs:30000,memoryLimitBytes:512*1024**2});
   const stop=()=>{void terminateChildProcess(child!);};signal.addEventListener('abort',stop,{once:true});
   const timer=setTimeout(()=>{stageFailure='EXPLICIT_MESH_DEADLINE';stop();},30000);
   const monitor=monitorWorkingDirectory({child,directory:cwd,maximumBytes:32*1024**2,onExceeded:async()=>{stageFailure='EXPLICIT_MESH_OUTPUT_LIMIT';stop();}});
   for(const stream of [child.stdout,child.stderr])stream?.on('data',b=>{if(Buffer.byteLength(diagnostic)+b.length>65536){stageFailure='EXPLICIT_MESH_DIAGNOSTIC_LIMIT';stop();}else diagnostic+=b;});
   let mesh,meshFailure:unknown;
   try{const code=await new Promise<number|null>((resolve,reject)=>{child!.once('error',reject);child!.once('close',resolve);});await save('mesh-diagnostic',{code,diagnostic,stageFailure});if(code!==0||stageFailure)throw Error(stageFailure??'EXPLICIT_GMSH_FAILED');unchanged();
    const text=await readUtf8FileBounded(join(cwd,'bar.msh'),16*1024**2);let topologyText:string|undefined;
    // Retain bounded, immutable outputs before admission so a rejection does
    // not erase the successful mesh or require another native run to inspect it.
    await workspace.write(join(workspace.paths.results,'accepted-mesh.msh'),new TextEncoder().encode(text),16*1024**2);
    if(request.model.cad?.mappingMethod==='exact-step-boundary-v1'){
     try{topologyText=await readUtf8FileBounded(join(cwd,'cad-topology.txt'),128*1024);}catch(error){throw Error('EXPLICIT_STEP_TOPOLOGY_READ_FAILED',{cause:error});}
     await workspace.write(join(workspace.paths.results,'accepted-cad-topology.txt'),new TextEncoder().encode(topologyText),128*1024);
    }
    mesh=admitAcceptedExplicitBridgeMesh(request,step,text,topologyText);
   }
   catch(error){meshFailure=error;}
   finally{clearTimeout(timer);monitor();signal.removeEventListener('abort',stop);try{if(child&&!await terminateChildProcess(child))throw Error('EXPLICIT_MESH_CLEANUP_UNCONFIRMED');}catch(error){meshFailure??=error;}}
   if(meshFailure)throw meshFailure;
   const authorizationId='trusted-job-'+randomUUID();let consumed=false,binding:any,receipt=0,solverReceipt=0;
   provider=new OpenRadiossExplicitSolverProvider(this.installation,{executionDeadline:Date.now()+300000,
    async readAuthorization(requestDigest,meshDigest){unchanged();if(consumed||requestDigest!==request.requestDigest)throw Error('EXPLICIT_ADMISSION_REPLAY');consumed=true;return binding={authorizationId,requestDigest,meshDigest,revision:request.model.projectRevision,geometryDigest:request.model.geometryDigest};},
    async rebindApprovedInput(value){unchanged();if(digest(value)!==digest(binding))throw Error('EXPLICIT_ADMISSION_MISMATCH');return structuredClone(binding);},
    retainEvidence:receipt=>save('solver-'+(solverReceipt++),receipt),
    durableEvidence:{artifactPolicyDigest:EXPLICIT_ARTIFACT_POLICY_DIGEST,artifacts:async(record,contents)=>{for(const [name,raw]of Object.entries(contents))await save('artifact-'+receipt++,{phase:record.phase,name,contents:raw});},candidate:record=>save('candidate',record)},
   });
   const cancel=()=>{if(runId)void provider!.cancel(runId).catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
   try{unchanged();phase('solving');runId=(await provider.submit(request,mesh!)).providerRunId;if(signal.aborted)await provider.cancel(runId);
    await settleExplicitSolverRun(provider,runId,AbortSignal.timeout(300000));unchanged();const status=await provider.getStatus(runId);if(status.status!=='succeeded')throw explicitNativeFailure(status.failure);
    const deck=prepareOpenRadiossDeck(request,mesh!);const result=await provider.getResult(runId);if(!result)throw Error('EXPLICIT_RESULT_MISSING');provider.confirmQuiescent(runId);output={result,nodes:mesh!.nodes.length,elements:mesh!.elements.length,faceMappingDigest:deck.faceMappingDigest,monitoringFaces:deck.expected.monitoringFaces,cleanupConfirmed:true as const};
   }finally{signal.removeEventListener('abort',cancel);}
  }catch(error){first=error;}
  let clean=false;
  try{
   if(runId&&provider){await provider.cancel(runId);await provider.settled(runId,AbortSignal.timeout(30000));provider.confirmQuiescent(runId);}
   if(child&&!await terminateChildProcess(child))throw Error('EXPLICIT_MESH_CLEANUP_UNCONFIRMED');
   if(workspace)await workspace.cleanup(async()=>{provider?.confirmQuiescent(runId);});clean=true;
  }catch(error){first??=error;}
  if(first){const error=first instanceof Error?first:Error('EXPLICIT_EXECUTION_FAILED');Object.assign(error,{cleanupConfirmed:clean,evidence:workspace});throw error;}
  return output;
 }
}
