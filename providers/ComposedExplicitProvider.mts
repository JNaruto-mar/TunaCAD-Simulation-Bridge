import {randomUUID} from 'node:crypto';
import {validateExplicitDynamics} from '../simulation-bridge/explicitDynamicsFoundation.mts';
import {electrostaticStepGeometryDigest} from '../simulation-bridge/electrostaticStepIdentity.mts';
import {digest} from '../simulation-bridge/stableDigest.mts';
import type {ExplicitDispatchCapabilities,ExplicitDispatchProvider} from '../simulation-bridge/explicitDispatchContract.mts';
import type {ExplicitDynamicsRequest} from '../simulation-bridge/explicitDynamicsContract.mts';
import type {ExplicitDynamicsResult} from '../src/simulation/explicitDynamicsProviderContracts.ts';
import type {SimulationProviderStatus} from '../src/simulation/externalSimulationContracts.ts';
export interface ExplicitExecutionDriver {
  execute(request:ExplicitDynamicsRequest,step:Uint8Array,signal:AbortSignal,phase:(value:string)=>void):Promise<{
    result:ExplicitDynamicsResult;nodes:number;elements:number;faceMappingDigest?:string;monitoringFaces?:Array<{referenceId:string;nodeIds:number[]}>;cleanupConfirmed:true;
  }>;
}
type Run={request:ExplicitDynamicsRequest;controller:AbortController;status:SimulationProviderStatus;done:Promise<void>;
 result?:ExplicitDynamicsResult;counts?:ReturnType<ExplicitDispatchProvider['readMeshCounts']>;resultDigest?:string;archived?:boolean;executionFailure?:unknown;clean:boolean};
/** The ordinary Bridge owns admission/identity. This composition only reuses
 * the canonical numerical driver and retains bounded, immutable completions. */
export class ComposedExplicitProvider implements ExplicitDispatchProvider {
 private runs=new Map<string,Run>();
 constructor(readonly capabilities:ExplicitDispatchCapabilities,private driver:ExplicitExecutionDriver){}
 async submit(value:ExplicitDynamicsRequest,bytes:Uint8Array){
  const request=validateExplicitDynamics(value);
  if(bytes.length>this.capabilities.maximumStepBytes||await electrostaticStepGeometryDigest(bytes)!==request.model.geometryDigest)throw Error('BRIDGE_EXPLICIT_SOURCE_MISMATCH');
  if([...this.runs.values()].some(r=>r.status.phase==='cleanup_unconfirmed'))throw Error('BRIDGE_PROVIDER_CLEANUP_UNCONFIRMED');
  if([...this.runs.values()].some(r=>['queued','running'].includes(r.status.status)))throw Error('BRIDGE_BUSY');
  if(this.runs.size>=4)for(const [id,old]of this.runs)if(old.clean&&(old.archived||['failed','cancelled'].includes(old.status.status))){this.runs.delete(id);break;}
  if(this.runs.size>=4)throw Error('BRIDGE_UNSAVED_RESULTS_LIMIT');
  const id='explicit_'+randomUUID(),acceptedAt=new Date().toISOString(),controller=new AbortController();
  const run:Run={request:structuredClone(request),controller,status:{providerRunId:id,status:'queued',phase:'queued',progress:0,updatedAt:acceptedAt},done:Promise.resolve(),clean:false};
  this.runs.set(id,run);
  run.done=(async()=>{try{
   run.status.status='running';
   const finished=await this.driver.execute(run.request,new Uint8Array(bytes),controller.signal,phase=>{run.status.phase=phase;run.status.updatedAt=new Date().toISOString();});
   if(finished.cleanupConfirmed!==true)throw Error('EXPLICIT_CLEANUP_UNCONFIRMED');
   run.clean=true;if(controller.signal.aborted){run.status.status='cancelled';return;}
   const result=finished.result,{resultDigest,...unsigned}=result;
   if(digest(unsigned)!==resultDigest||result.requestDigest!==request.requestDigest||result.revision!==request.model.projectRevision||result.geometryDigest!==request.model.geometryDigest||result.materialDigest!==digest(request.material)||result.cleanupConfirmed!==true||result.engineeringUsePermitted!==false||result.provider.runtimeDigest!==this.capabilities.runtimeDigest)throw Error('EXPLICIT_COMPLETION_BINDING_MISMATCH');
   run.result=structuredClone(result);run.resultDigest=digest(result);run.counts={nodes:finished.nodes,elements:finished.elements,...(finished.faceMappingDigest?{faceMappingDigest:finished.faceMappingDigest}:{}),...(finished.monitoringFaces?{monitoringFaces:structuredClone(finished.monitoringFaces)}:{})};run.status={...run.status,status:'succeeded',phase:'completed',progress:1};
  }catch(error){
   run.executionFailure=error;run.clean=run.clean||(error as any)?.cleanupConfirmed===true;
   const code=error instanceof Error&&/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'EXPLICIT_EXECUTION_FAILED';
   run.status={...run.status,status:controller.signal.aborted&&run.clean?'cancelled':'failed',phase:run.clean?'failed_cleaned':'cleanup_unconfirmed',progress:null,failure:{code,message:code}};
  }finally{run.status.updatedAt=new Date().toISOString();}})();
  return {providerRunId:id,acceptedAt};
 }
 private require(id:string){const r=this.runs.get(id);if(!r)throw Error('BRIDGE_NOT_FOUND');return r;}
 async getStatus(id:string){return structuredClone(this.require(id).status);}
 async getResult(id:string){const r=this.require(id);if(r.status.status!=='succeeded'||!r.result)return null;if(digest(r.result)!==r.resultDigest)throw Error('EXPLICIT_COMPLETION_INTEGRITY');return structuredClone(r.result);}
 readMeshCounts(id:string){const counts=this.require(id).counts;if(!counts)throw Error('BRIDGE_RESULT_NOT_READY');return {...counts};}
 async cancel(id:string){const r=this.require(id);if(r.status.status==='succeeded')return this.getStatus(id);r.controller.abort();await r.done;return this.releaseResources(id);}
 async releaseResources(id:string){const r=this.require(id);if(!['succeeded','failed','cancelled'].includes(r.status.status))throw Error('BRIDGE_JOB_NOT_TERMINAL');await r.done;if(!r.clean)throw Error('BRIDGE_PROVIDER_CLEANUP_UNCONFIRMED');return this.getStatus(id);}
 async acknowledgeSavedProject(id:string){const r=this.require(id);if((await this.releaseResources(id)).status!=='succeeded')throw Error('BRIDGE_RESULT_NOT_READY');r.archived=true;}
}
