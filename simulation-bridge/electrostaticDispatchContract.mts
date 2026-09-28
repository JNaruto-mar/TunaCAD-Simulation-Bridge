import type { ElectrostaticFoundation } from './electrostaticContract.mts';
import type { ElectrostaticRuntimeIdentity, CompletedElectrostaticResult } from './electrostaticAdmission.mts';
import type { SimulationProviderStatus, SimulationProviderSubmission } from '../src/simulation/externalSimulationContracts.ts';
import type { ElectricalDataset, ElectricalPage } from './electrostaticFields.mts';

export interface ElectrostaticDispatchCapabilities {
  id: string; version: '0.1.0'; runtime: ElectrostaticRuntimeIdentity;
  status: 'proof_of_concept'; engineeringUsePermitted: false;
  scope: 'single_linear_dielectric_parallel_plate_slab';
  meshSizeMm: 2; maximumNodes: 8000; maximumElements: 4000;
  maximumStepBytes: number; cpuTimeLimitMs: 30000; memoryLimitBytes: number;
  sourceIdentity: 'tunacad-electrostatic-native-step-identity/0.1';
}
/** Host adapter only. Request came through both approvals; STEP still must be
 * independently canonical-digest checked. Not a live browser CAD reader. */
export interface ElectrostaticDispatchProvider {
  capabilities: ElectrostaticDispatchCapabilities;
  submit(request: ElectrostaticFoundation, step: Uint8Array, approval: {
    preparationId: string; authorizationId: string;
  }): Promise<SimulationProviderSubmission>;
  getStatus(id: string): Promise<SimulationProviderStatus>;
  getResult(id: string): Promise<ElectrostaticDispatchResult | null>;
  getFieldDataset(id: string, datasetId: string, cursor?: string, limit?: number): Promise<ElectricalPage>;
  cancel(id: string): Promise<SimulationProviderStatus>;
}
export interface ElectrostaticDispatchResult {
  schema: 'tunacad-electrostatic-dispatch-result/0.1';
  preparationId: string; authorizationId: string; providerRunId: string;
  completion: CompletedElectrostaticResult; fieldDatasets: ElectricalDataset[]; dispatchDigest: string;
}
