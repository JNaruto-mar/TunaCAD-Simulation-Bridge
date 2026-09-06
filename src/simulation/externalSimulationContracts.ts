export const NEUTRAL_SIMULATION_REQUEST_SCHEMA = 'tunacad-neutral-simulation-request/1.0' as const;
export const NEUTRAL_SIMULATION_RESULT_SCHEMA = 'tunacad-neutral-simulation-result/1.0' as const;
export const NEUTRAL_MESH_CONVERGENCE_REPORT_SCHEMA = 'tunacad-neutral-mesh-convergence-report/1.0' as const;
export const NEUTRAL_FEM_MESH_SCHEMA = 'tunacad-neutral-fem-mesh/1.0' as const;
export const SIMULATION_PROVIDER_INTERFACE_VERSION = '1.0' as const;
export const MESH_PROVIDER_INTERFACE_VERSION = '1.0' as const;

export type NeutralAnalysisType = 'linear_static';
export type NeutralSimulationJobStatus = 'awaiting_approval' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type NeutralResultAuthority = 'engineering' | 'architecture_mock';
export type NeutralVector3 = [number, number, number];

export interface NeutralSimulationMaterial {
  id: string;
  name: string;
  model: 'isotropic_linear_elastic';
  densityKgM3?: number;
  youngsModulusMPa: number;
  poissonRatio: number;
  yieldStrengthMPa?: number;
  source: { kind: 'library' | 'custom'; reference: string; revision?: string };
}

export type NeutralSimulationLoad =
  | { id: string; name: string; type: 'surface_force'; semanticReferenceIds: string[]; forceN: NeutralVector3 }
  | { id: string; name: string; type: 'pressure'; semanticReferenceIds: string[]; pressureMPa: number }
  | { id: string; name: string; type: 'gravity'; accelerationMmPerS2: NeutralVector3 };

export type NeutralSimulationConstraint =
  | { id: string; name: string; type: 'fixed'; semanticReferenceIds: string[] }
  | { id: string; name: string; type: 'prescribed_displacement'; semanticReferenceIds: string[]; displacementMm: [number | null, number | null, number | null] };

export interface NeutralMeshRequest {
  dimensionality: '3d';
  elementFamily: 'tetrahedral';
  order: 2;
  globalSizeMm: number;
  minimumSizeMm?: number;
  maximumNodes: number;
  maximumElements: number;
  qualityMetric: 'provider_normalized';
  minimumQuality: number;
}

export interface NeutralSimulationReferenceBinding {
  semanticReferenceId: string;
  ownerPartId: string;
  geometryKind: 'FACE';
  role: 'load' | 'constraint';
  sourceFeatureId: string | null;
  resolutionState: 'valid';
  resolvedAtProjectRevision: string;
  /** Solver-neutral geometric evidence captured when the durable FACE
   * reference was resolved. Providers use it to map boundary conditions
   * without depending on TunaCAD topology indices. */
  face: {
    centroidPartLocalMm: NeutralVector3;
    areaMm2: number;
    outwardDirection: NeutralVector3 | null;
    geometryType: string | null;
    /** Optional evidence used by realistic CAD adapters to disambiguate
     * repeated or symmetric imported STEP faces. */
    boundingBoxMm?: { min: NeutralVector3; max: NeutralVector3 };
    edgeCount?: number;
    analytic?: {
      kind: 'plane' | 'cylinder' | 'cone' | 'sphere' | 'other';
      originMm?: NeutralVector3;
      axis?: NeutralVector3;
      radiusMm?: number;
    };
    witnessPointsPartLocalMm?: NeutralVector3[];
  };
}

export interface NeutralMeshBoundaryRequest {
  regionId: string;
  role: 'load' | 'constraint';
  semanticReferenceId: string;
  sourceFeatureId: string | null;
  face: NeutralSimulationReferenceBinding['face'];
}

export interface NeutralMeshJobRequest {
  schema: 'tunacad-neutral-mesh-request/1.0';
  studyId: string;
  requestDigest: string;
  projectRevision: string;
  geometryDigest: string;
  coordinateSpace: 'part_definition_local';
  units: 'mm';
  mesh: NeutralMeshRequest;
  boundaryRegions: NeutralMeshBoundaryRequest[];
}

export interface NeutralFemMesh {
  schema: typeof NEUTRAL_FEM_MESH_SCHEMA;
  meshId: string;
  requestDigest: string;
  projectRevision: string;
  geometryDigest: string;
  coordinateSpace: 'part_definition_local';
  units: 'mm';
  element: {
    family: 'tetrahedral';
    /** Polynomial order of the stored geometry connectivity. */
    geometryOrder: 1 | 2;
    /** Requested displacement interpolation order used by a compatible solver. */
    solutionOrder: 2;
  };
  nodes: NeutralVector3[];
  volumeElements: {
    /** Quadratic tetrahedra use the neutral order: four vertices, then edge
     * nodes (0-1), (1-2), (2-0), (0-3), (2-3), (1-3). Solver adapters must
     * translate this canonical order when their native format differs. */
    connectivity: number[][];
    regionIds: string[];
  };
  boundaryFacets: {
    connectivity: number[][];
    regionIds: string[];
  };
  boundaryRegions: Array<{
    regionId: string;
    semanticReferenceIds: string[];
    sourceFeatureIds: string[];
    facetIndices: number[];
    matchedCadFace: NeutralSimulationReferenceBinding['face'];
    match: {
      state: 'verified';
      method: 'geometric_signature' | 'label_and_geometric_signature';
      candidateCount: 1;
      centroidToleranceMm: number;
      areaRelativeTolerance: number;
    };
  }>;
  volumeRegions: Array<{ regionId: string; elementIndices: number[] }>;
  quality: {
    metric: 'mean_ratio';
    minimum: number;
    average: number;
    invalidElementCount: 0;
    nodeCount: number;
    elementCount: number;
    boundaryFacetCount: number;
    cadVolumeMm3: number;
    meshVolumeMm3: number;
    volumeRelativeError: number;
  };
  provenance: {
    meshProviderInterfaceVersion: typeof MESH_PROVIDER_INTERFACE_VERSION;
    adapterId: string;
    adapterVersion: string;
    engine: string;
    engineVersion: string;
    optionsDigest: string;
    inputGeometryDigest: string;
    generatedAt: string;
  };
}

export interface NeutralSimulationRequest {
  schema: typeof NEUTRAL_SIMULATION_REQUEST_SCHEMA;
  studyId: string;
  name: string;
  preparedAt: string;
  expiresAt: string;
  requestDigest: string;
  analysis: {
    type: NeutralAnalysisType;
    assumptions: ['small_displacement', 'small_strain', 'static_loading', 'homogeneous_material'];
  };
  geometry: {
    projectRevision: string;
    partId: string;
    bodyId: string;
    geometryDigest: string;
    coordinateSpace: 'part_definition_local';
    shape: {
      valid: true;
      connectedSolidCount: 1;
      faceCount: number;
      edgeCount: number;
      volumeMm3: number;
      surfaceAreaMm2: number;
      boundingBoxMm: { min: NeutralVector3; max: NeutralVector3; size: NeutralVector3 };
    };
    references: NeutralSimulationReferenceBinding[];
  };
  units: {
    geometry: 'mm';
    force: 'N';
    stress: 'MPa';
    displacement: 'mm';
    density: 'kg/m^3';
    acceleration: 'mm/s^2';
  };
  material: NeutralSimulationMaterial;
  loads: NeutralSimulationLoad[];
  constraints: NeutralSimulationConstraint[];
  contacts: { mode: 'none' };
  mesh: NeutralMeshRequest;
  requestedResults: Array<'von_mises_stress' | 'displacement' | 'reaction_force' | 'factor_of_safety' | 'critical_regions'>;
}

export interface NeutralSimulationHotspot {
  id: string;
  kind: 'stress' | 'displacement' | 'constraint' | 'mesh' | 'provider';
  severity: 'info' | 'warning' | 'critical';
  value: number | null;
  unit: 'MPa' | 'mm' | 'N' | null;
  positionPartLocalMm: NeutralVector3 | null;
  semanticReferenceIds: string[];
  featureIds: string[];
  description: string;
  inspect: string[];
  mapping: 'durable_reference' | 'part_local_location' | 'unmapped';
}

export interface NeutralSimulationResult {
  schema: typeof NEUTRAL_SIMULATION_RESULT_SCHEMA;
  studyId: string;
  jobId: string;
  requestDigest: string;
  projectRevision: string;
  analysisType: NeutralAnalysisType;
  status: 'succeeded' | 'failed' | 'cancelled';
  authority: NeutralResultAuthority;
  metrics: {
    maximumVonMisesStressMPa: number | null;
    maximumDisplacementMm: number | null;
    minimumFactorOfSafety: number | null;
  };
  reactions: Array<{
    constraintId: string;
    forceN: NeutralVector3;
    semanticReferenceIds: string[];
  }>;
  criticalRegions: NeutralSimulationHotspot[];
  failedConstraints: Array<{ constraintId: string; code: string; message: string }>;
  warnings: Array<{ code: string; message: string; severity: 'info' | 'warning' | 'critical' }>;
  convergence: {
    status: 'converged' | 'not_converged' | 'not_evaluated';
    iterations: number | null;
    residual: number | null;
    providerDeclared: boolean;
  };
  suggestedEngineeringIssues: string[];
  provenance: {
    providerInterfaceVersion: typeof SIMULATION_PROVIDER_INTERFACE_VERSION;
    adapterId: string;
    adapterVersion: string;
    providerRunId: string;
    submittedAt: string;
    completedAt: string;
    normalizedAt: string;
    mesh?: {
      meshId: string;
      adapterId: string;
      adapterVersion: string;
      engine: string;
      engineVersion: string;
      nodeCount: number;
      elementCount: number;
      boundaryFacetCount: number;
      minimumQuality: number;
      averageQuality: number;
      volumeRelativeError: number;
    };
  };
  review: {
    engineerReviewRequired: true;
    engineeringUsePermitted: boolean;
    disclaimer: string;
  };
  mutation: {
    occurred: false;
    projectRevisionBefore: string;
    projectRevisionAfter: string;
  };
}

export interface SimulationProviderCapabilities {
  interfaceVersion: typeof SIMULATION_PROVIDER_INTERFACE_VERSION;
  analysisTypes: readonly NeutralAnalysisType[];
  /** Exact study envelope accepted by this adapter. The neutral request schema
   * can be broader; TunaCAD checks this profile before creating an approvable
   * job so unsupported studies never reach geometry transfer. */
  study: {
    maximumParts: number;
    maximumBodies: number;
    maximumMaterials: number;
    maximumReferenceBindings: number;
    materialModels: ReadonlyArray<NeutralSimulationMaterial['model']>;
    loadTypes: ReadonlyArray<NeutralSimulationLoad['type']>;
    maximumLoads: number;
    maximumReferencesPerLoad: number;
    constraintTypes: ReadonlyArray<NeutralSimulationConstraint['type']>;
    maximumConstraints: number;
    maximumReferencesPerConstraint: number;
    contactModes: ReadonlyArray<NeutralSimulationRequest['contacts']['mode']>;
  };
  geometryFormats: ReadonlyArray<'step' | 'brep'>;
  asynchronous: true;
  cancellation: true;
  normalizedResults: true;
  durableReferenceMapping: 'supported' | 'partial' | 'unavailable';
  authority: NeutralResultAuthority;
  execution: {
    topology: 'remote_service' | 'local_adapter' | 'native_engine' | 'contract_test';
    credentials: 'none' | 'host_managed';
    geometryLeavesDevice: boolean;
    privacyDisclosure: string;
    queueTimeoutMs: number;
    executionTimeoutMs: number;
    totalTimeoutMs: number;
    rawArtifactRetentionMs: number;
    normalizedResultRetentionMs: number;
  };
}

export interface SimulationProviderSubmission {
  providerRunId: string;
  acceptedAt: string;
}

export interface SimulationProviderStatus {
  providerRunId: string;
  status: NeutralSimulationJobStatus;
  progress: number | null;
  phase: string;
  updatedAt: string;
  failure?: { code: string; message: string };
}

export interface SimulationGeometryResolver {
  descriptor: NeutralSimulationRequest['geometry'];
  export(format: 'step' | 'brep'): Promise<Uint8Array>;
}

export interface MeshProviderCapabilities {
  interfaceVersion: typeof MESH_PROVIDER_INTERFACE_VERSION;
  geometryFormats: ReadonlyArray<'step' | 'brep'>;
  elementFamilies: readonly ['tetrahedral'];
  geometryOrders: ReadonlyArray<1 | 2>;
  asynchronous: true;
  cancellation: true;
  durableReferenceMapping: 'supported' | 'partial' | 'unavailable';
  execution: SimulationProviderCapabilities['execution'];
}

export interface MeshProviderSubmission {
  meshRunId: string;
  acceptedAt: string;
}

export interface MeshProviderStatus {
  meshRunId: string;
  status: NeutralSimulationJobStatus;
  progress: number | null;
  phase: string;
  updatedAt: string;
  failure?: { code: string; message: string };
}

export interface ExternalMeshProvider {
  readonly id: string;
  readonly version: string;
  readonly capabilities: MeshProviderCapabilities;
  submit(request: NeutralMeshJobRequest, geometry: SimulationGeometryResolver): Promise<MeshProviderSubmission>;
  getStatus(meshRunId: string): Promise<MeshProviderStatus>;
  getMesh(meshRunId: string): Promise<NeutralFemMesh | null>;
  cancel(meshRunId: string): Promise<MeshProviderStatus>;
}

export interface ExternalSolverProvider {
  readonly id: string;
  readonly version: string;
  readonly capabilities: SimulationProviderCapabilities;
  submit(request: NeutralSimulationRequest, mesh: NeutralFemMesh): Promise<SimulationProviderSubmission>;
  getStatus(providerRunId: string): Promise<SimulationProviderStatus>;
  getResult(providerRunId: string): Promise<NeutralSimulationResult | null>;
  cancel(providerRunId: string): Promise<SimulationProviderStatus>;
}

export interface ExternalSimulationProvider {
  readonly id: string;
  readonly version: string;
  readonly capabilities: SimulationProviderCapabilities;
  submit(request: NeutralSimulationRequest, geometry: SimulationGeometryResolver): Promise<SimulationProviderSubmission>;
  getStatus(providerRunId: string): Promise<SimulationProviderStatus>;
  getResult(providerRunId: string): Promise<NeutralSimulationResult | null>;
  cancel(providerRunId: string): Promise<SimulationProviderStatus>;
}

export interface PrepareNeutralSimulationInput {
  studyId: string;
  name: string;
  analysisType: NeutralAnalysisType;
  target: { partId: string; bodyId: string };
  material: NeutralSimulationMaterial;
  loads: NeutralSimulationLoad[];
  constraints: NeutralSimulationConstraint[];
  contacts: { mode: 'none' };
  mesh: NeutralMeshRequest;
}

export interface SimulationDesignCriteria {
  maximumVonMisesStressMPa?: number;
  maximumDisplacementMm?: number;
  minimumFactorOfSafety?: number;
}

export type NeutralMeshConvergenceLevelName = 'coarse' | 'medium' | 'fine';

/** Orchestration options are intentionally outside the immutable v1 study.
 * Each level remains an ordinary v1 simulation request with a distinct digest. */
export interface NeutralMeshConvergenceOptions {
  globalSizeMultipliers?: [number, number, number];
  maximumDisplacementRelativeChange?: number;
  maximumStressRelativeChange?: number;
  maximumReactionImbalanceRelative?: number;
}

export interface NeutralMeshConvergenceConfiguration {
  globalSizeMultipliers: [number, number, number];
  maximumDisplacementRelativeChange: number;
  maximumStressRelativeChange: number;
  maximumReactionImbalanceRelative: number;
}

export interface NeutralMeshConvergenceLevelResult {
  level: NeutralMeshConvergenceLevelName;
  jobId: string;
  requestDigest: string;
  geometryDigest: string;
  globalSizeMm: number;
  minimumSizeMm: number | null;
  nodeCount: number | null;
  elementCount: number | null;
  maximumDisplacementMm: number | null;
  maximumVonMisesStressMPa: number | null;
  reactionResultantN: NeutralVector3;
  reactionImbalanceRelative: number | null;
}

export interface NeutralMeshConvergenceComparison {
  from: NeutralMeshConvergenceLevelName;
  to: NeutralMeshConvergenceLevelName;
  displacementRelativeChange: number | null;
  stressRelativeChange: number | null;
}

export interface NeutralMeshConvergenceReport {
  schema: typeof NEUTRAL_MESH_CONVERGENCE_REPORT_SCHEMA;
  convergenceId: string;
  preparationId: string;
  studyId: string;
  baseRequestDigest: string;
  invariantStudyDigest: string;
  geometryDigest: string;
  projectRevision: string;
  status: 'converged' | 'not_converged' | 'indeterminate';
  configuration: NeutralMeshConvergenceConfiguration;
  levels: [NeutralMeshConvergenceLevelResult, NeutralMeshConvergenceLevelResult, NeutralMeshConvergenceLevelResult];
  comparisons: [NeutralMeshConvergenceComparison, NeutralMeshConvergenceComparison];
  checks: Array<{
    code: string;
    status: 'pass' | 'fail' | 'indeterminate';
    message: string;
  }>;
  warnings: Array<{ code: string; message: string; severity: 'info' | 'warning' | 'critical' }>;
  requestedAt: string;
  completedAt: string;
  review: {
    engineerReviewRequired: true;
    engineeringUsePermitted: false;
    disclaimer: string;
  };
  mutation: {
    occurred: false;
    projectRevisionBefore: string;
    projectRevisionAfter: string;
  };
}
