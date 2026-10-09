import type { ExternalSolverProvider, SimulationProviderStatus, SimulationProviderSubmission } from './externalSimulationContracts.ts';
import type { ExplicitDynamicsRequest } from '../../simulation-bridge/explicitDynamicsFoundation.mts';

/** Private solver-neutral contract. Not registered in capability discovery.
 * Axial samples at identified monitored FACE nodes, NOT full 3D nodal fields. */
export interface ExplicitDynamicsResult {
  schema: 'tunacad-explicit-dynamics-result/0.1';
  studyId: string; providerRunId: string; requestDigest: string; revision: string;
  domainId: string; bodyId: string; geometryDigest: string; materialDigest: string;
  provider: { id: string; version: string; runtimeVersion: string; runtimeDigest: string };
  meshDigest: string; executionStatus: 'succeeded'; durationS: number; actualCycles: number;
  timestepRangeS: [number, number];
  sampling: { axis: 'X'; location: 'nodal'; scope: 'fixed_and_loaded_FACE_nodes_only'|'selected_FACE_nodes'; monitoredNodeIds: number[];
    /** Absent only on preserved historical results; new runs bind admitted selections. */
    faceMappingDigest?:string;fixedNodeIds?:number[];loadedNodeIds?:number[];
    monitoringFaces?:Array<{referenceId:string;nodeIds:number[]}> };
  units: { time: 's'; displacement: 'mm'; velocity: 'mm/s'; acceleration: 'mm/s^2';
    impulse: 'N*s'; force: 'N'; energy: 'N*mm'; mass: 'kg' };
  frames: Array<{ timeS: number; timestepS: number;
    nodes: Array<{ nodeId: number; face: 'fixed' | 'loaded' | 'monitor'; displacementMm: number;
      velocityMmPerS: number; accelerationMmPerS2: number;
      reactionImpulseNs: number; reactionForceN: number }>;
    supportImpulseNs: number; supportReactionN: number;
    kineticEnergyNmm: number; internalEnergyNmm: number; externalWorkNmm: number;
    totalMassKg: number; addedMassKg: number; addedMassChangeKg: number }>;
  requestedTimeSamples: Array<{ requestedTimeS: number; frameIndex: number; actualTimeS: number }>;
  cycleEvidence: { digest: string; orderedCycles: Array<{ cycle: number; timeS: number; timestepS: number }> };
  coverageDigest: string; actualMassScaling: false; cleanupConfirmed: true;
  artifacts: Record<string, string>; provenanceDigest: string; resultDigest: string;
  diagnostics: string[]; status: 'proof_of_concept'; engineeringUsePermitted: false;
}
export interface ExplicitDynamicsFieldPage {
  schema: 'tunacad-explicit-dynamics-field-page/0.1';
  providerRunId: string; resultDigest: string; datasetId: string; datasetDigest: string;
  frameIndex: number; timeS: number; domainId: string; location: 'nodal'; axis: 'X';
  quantity: 'displacement' | 'velocity' | 'acceleration' | 'reactionImpulse' | 'reactionForce';
  unit: string; offset: number; total: number; nextCursor: string | null;
  values: Array<{ nodeId: number; value: number }>; chunkDigest: string;
}
/** Same lifecycle abstraction, separately typed submit/result; no change to
 * established static/v2 contracts or discovery metadata. */
export interface PrivateExplicitSolverProvider extends Pick<ExternalSolverProvider, 'id' | 'version' | 'getStatus' | 'cancel'> {
  submit(request: ExplicitDynamicsRequest, mesh: unknown): Promise<SimulationProviderSubmission>;
  getResult(providerRunId: string): Promise<ExplicitDynamicsResult | null>;
  getFieldDataset(providerRunId: string, frameIndex: number, quantity: ExplicitDynamicsFieldPage['quantity'],
    cursor?: string, limit?: number): Promise<ExplicitDynamicsFieldPage>;
}
export type ExplicitProviderStatus = SimulationProviderStatus;
