import type {ExplicitDispatchCapabilities} from '../../simulation-bridge/explicitDispatchContract.mts';
import type { SimulationProviderCapabilities, SimulationProviderCapabilitiesV2 } from './externalSimulationContracts.ts';
import type { ElectrostaticDispatchCapabilities } from '../../simulation-bridge/electrostaticDispatchContract.mts';

export const SIMULATION_BRIDGE_VERSION = '1.0-poc';
export const SIMULATION_BRIDGE_URL = 'http://127.0.0.1:48731';
export interface SimulationBridgeReadiness {
  protocolVersion: typeof SIMULATION_BRIDGE_VERSION;
  ready: boolean;
  provider: { id: string; version: string; capabilities: SimulationProviderCapabilities } | null;
  providerV2?: { id: string; version: string; capabilities: SimulationProviderCapabilitiesV2 } | null;
  explicit?:ExplicitDispatchCapabilities|null;
  electrostatic?: ElectrostaticDispatchCapabilities | null;
  electrostaticInitialization?:{stage:string;code:string|null;retryable:boolean;probe?:{elapsedMs:number;exitCode:number|null;timedOut:boolean;cleanupConfirmed:boolean};previousFailure?:{stage:string;code:string;probe?:{elapsedMs:number;exitCode:number|null;timedOut:boolean;cleanupConfirmed:boolean}}};
  meshing: { ready: boolean; adapterVersion: string; runtimeVersion: string | null; geometryFormats: string[]; elementFamilies: string[] };
  solving: { ready: boolean; adapterVersion: string; runtimeVersion: string | null; analysisTypes: string[] };
  configuration?: { gmshExecutable: string; calculixExecutable: string; discoveryUsed: boolean;electrostaticStorageConfigured?:boolean };
  limits: { maximumStepBytes: number; maximumTotalStepBytes: number; maximumDomains: number; maximumJobs: number; sessionLifetimeMs: number };
}
