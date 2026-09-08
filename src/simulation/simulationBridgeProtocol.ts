import type { SimulationProviderCapabilities, SimulationProviderCapabilitiesV2 } from './externalSimulationContracts.ts';

export const SIMULATION_BRIDGE_VERSION = '1.0-poc';
export const SIMULATION_BRIDGE_URL = 'http://127.0.0.1:48731';
export interface SimulationBridgeReadiness {
  protocolVersion: typeof SIMULATION_BRIDGE_VERSION;
  ready: boolean;
  provider: { id: string; version: string; capabilities: SimulationProviderCapabilities } | null;
  providerV2?: { id: string; version: string; capabilities: SimulationProviderCapabilitiesV2 } | null;
  meshing: { ready: boolean; adapterVersion: string; runtimeVersion: string | null; geometryFormats: string[]; elementFamilies: string[] };
  solving: { ready: boolean; adapterVersion: string; runtimeVersion: string | null; analysisTypes: string[] };
  configuration?: { gmshExecutable: string; calculixExecutable: string; discoveryUsed: boolean };
  limits: { maximumStepBytes: number; maximumTotalStepBytes: number; maximumDomains: number; maximumJobs: number; sessionLifetimeMs: number };
}
