import type {ExplicitDynamicsRequest} from './explicitDynamicsContract.mts';
import type {ExplicitDynamicsResult} from '../src/simulation/explicitDynamicsProviderContracts.ts';
import type {SimulationProviderStatus,SimulationProviderSubmission} from '../src/simulation/externalSimulationContracts.ts';
export interface ExplicitDispatchCapabilities {
  id:string;version:string;runtimeDigest:string;maximumStepBytes:number;
  maximumNodes:number;maximumElements:number;engineeringUsePermitted:false;
}
export interface ExplicitDispatchProvider {
  capabilities:ExplicitDispatchCapabilities;
  submit(request:ExplicitDynamicsRequest,step:Uint8Array):Promise<SimulationProviderSubmission>;
  getStatus(id:string):Promise<SimulationProviderStatus>;
  getResult(id:string):Promise<ExplicitDynamicsResult|null>;
  readMeshCounts(id:string):{nodes:number;elements:number;faceMappingDigest?:string;monitoringFaces?:Array<{referenceId:string;nodeIds:number[]}>};
  cancel(id:string):Promise<SimulationProviderStatus>;
  releaseResources(id:string):Promise<SimulationProviderStatus>;
  acknowledgeSavedProject(id:string):Promise<void>;
}
