import type { SimulationProviderCapabilities } from './externalSimulationContracts.ts';

export const SIMULATION_BRIDGE_VERSION = '1.0-poc';
export const SIMULATION_BRIDGE_URL = 'http://127.0.0.1:48731';
export interface SimulationBridgeReadiness {
  protocolVersion: typeof SIMULATION_BRIDGE_VERSION;
  ready: boolean;
  provider: { id: string; version: string; capabilities: SimulationProviderCapabilities } | null;
  meshing: { ready: boolean; adapterVersion: string; runtimeVersion: string | null; geometryFormats: string[]; elementFamilies: string[] };
  solving: { ready: boolean; adapterVersion: string; runtimeVersion: string | null; analysisTypes: string[] };
  configuration?: { gmshExecutable: string; calculixExecutable: string; discoveryUsed: boolean };
  limits: { maximumStepBytes: number; maximumJobs: number; sessionLifetimeMs: number };
}
