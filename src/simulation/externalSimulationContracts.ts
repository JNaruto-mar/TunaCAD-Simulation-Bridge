export const NEUTRAL_SIMULATION_REQUEST_SCHEMA = 'tunacad-neutral-simulation-request/1.0' as const;
export const NEUTRAL_SIMULATION_RESULT_SCHEMA = 'tunacad-neutral-simulation-result/1.0' as const;
export const NEUTRAL_MESH_CONVERGENCE_REPORT_SCHEMA = 'tunacad-neutral-mesh-convergence-report/1.0' as const;
export const NEUTRAL_FEM_MESH_SCHEMA = 'tunacad-neutral-fem-mesh/1.0' as const;
export const NEUTRAL_SIMULATION_REQUEST_V2_SCHEMA = 'tunacad-neutral-simulation-request/2.0' as const;
export const NEUTRAL_MESH_REQUEST_V2_SCHEMA = 'tunacad-neutral-mesh-request/2.0' as const;
export const NEUTRAL_FEM_MODEL_V2_SCHEMA = 'tunacad-neutral-fem-model/2.0' as const;
export const NEUTRAL_SIMULATION_RESULT_V2_SCHEMA = 'tunacad-neutral-simulation-result/2.0' as const;
export const NEUTRAL_SIMULATION_FIELD_DATASET_V2_SCHEMA = 'tunacad-neutral-simulation-field-dataset/2.0' as const;
export const NEUTRAL_SIMULATION_FIELD_PAGE_V2_SCHEMA = 'tunacad-neutral-simulation-field-page/2.0' as const;
export const SIMULATION_PROVIDER_INTERFACE_VERSION = '1.0' as const;
export const MESH_PROVIDER_INTERFACE_VERSION = '1.0' as const;
export const SIMULATION_PROVIDER_INTERFACE_V2_VERSION = '2.0' as const;
export const MESH_PROVIDER_INTERFACE_V2_VERSION = '2.0' as const;

export type NeutralAnalysisType = 'linear_static';
export type NeutralAnalysisTypeV2 = 'linear_static' | 'modal' | 'linear_buckling' | 'static_contact' | 'nonlinear_static';
export type NeutralSimulationJobStatus = 'awaiting_approval' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type NeutralResultAuthority = 'engineering' | 'architecture_mock';
export type NeutralVector3 = [number, number, number];
export type NeutralTriangle3<T> = [T, T, T];
/** Row-major homogeneous transform from occurrence-local coordinates into the
 * immutable analysis coordinate system. V2 admission accepts rigid transforms
 * only: the last row is [0, 0, 0, 1] and the 3x3 block is a proper rotation. */
export type NeutralMatrix4 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export interface NeutralSimulationMaterial {
  id: string;
  name: string;
  model: 'isotropic_linear_elastic' | 'isotropic_elastic_plastic';
  densityKgM3?: number;
  youngsModulusMPa: number;
  poissonRatio: number;
  yieldStrengthMPa?: number;
  /** SIM-7B tabulated true stress versus accumulated true plastic strain.
   * The first point must be the initial yield stress at zero plastic strain;
   * subsequent points must increase in both plastic strain and true stress.
   * Only isotropic hardening is currently admitted. */
  plasticity?: {
    hardening: 'isotropic';
    curve: Array<{ trueStressMPa: number; plasticStrain: number }>;
  };
  source: { kind: 'library' | 'custom'; reference: string; revision?: string };
}

/** All load entries belong to one simultaneous linear-static load case.
 * Providers accumulate them deterministically and preserve every entry ID.
 * FACE IDs within one entry are unique. A surface force is the total vector
 * distributed over the union by facet area; pressure acts on every FACE. */
export type NeutralSimulationLoad =
  | { id: string; name: string; type: 'surface_force'; semanticReferenceIds: string[]; forceN: NeutralVector3 }
  /** Positive pressure acts inward, opposite each boundary facet's computed
   * outward normal. Negative pressure represents outward suction. */
  | { id: string; name: string; type: 'pressure'; semanticReferenceIds: string[]; pressureMPa: number }
  /** Uniform body acceleration in part-local coordinates. The solver combines
   * it with densityKgM3 and the neutral volume elements to obtain force. */
  | { id: string; name: string; type: 'gravity'; accelerationMmPerS2: NeutralVector3 };

export type NeutralSimulationConstraint =
  /** Every unique FACE in the group receives the same constraint. Distinct
   * constraint groups may meet at edges/corners but cannot overlap in area. */
  | { id: string; name: string; type: 'fixed'; semanticReferenceIds: string[] }
  /** Part-local X/Y/Z components in millimetres. null leaves a component free;
   * numeric zero is an intentional zero-displacement restraint. */
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
    /** Quadratic tetrahedra use the neutral Gmsh order: four vertices, then
     * edge nodes (0-1), (1-2), (2-0), (0-3), (2-3), (1-3). Solver adapters
     * must translate this canonical order when their native format differs. */
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

/** V2 is intentionally additive. V1 remains immutable and providers must never
 * interpret a V2 envelope as a V1 single-Part request. */
export interface NeutralSimulationDomainV2 {
  domainId: string;
  partId: string;
  bodyId: string;
  occurrenceId: string;
  domainDigest: string;
  geometryDigest: string;
  transformToAnalysis: NeutralMatrix4;
  shape: {
    valid: true;
    connectedSolidCount: 1;
    faceCount: number;
    edgeCount: number;
    volumeMm3: number;
    surfaceAreaMm2: number;
    boundingBoxOwnerLocalMm: { min: NeutralVector3; max: NeutralVector3; size: NeutralVector3 };
  };
}

export interface NeutralSimulationReferenceBindingV2 {
  semanticReferenceId: string;
  domainId: string;
  ownerPartId: string;
  ownerBodyId: string;
  occurrenceId: string;
  geometryKind: 'FACE';
  role: 'load' | 'constraint' | 'interaction';
  sourceFeatureId: string | null;
  resolutionState: 'valid';
  resolvedAtProjectRevision: string;
  faceOwnerLocal: NeutralSimulationReferenceBinding['face'];
}

export interface NeutralMaterialAssignmentV2 {
  assignmentId: string;
  domainId: string;
  materialId: string;
  volumeRegionId: string;
}

export type NeutralSimulationLoadV2 =
  | { id: string; name: string; type: 'surface_force'; semanticReferenceIds: string[]; forceN: NeutralVector3; coordinateSystem: 'analysis' }
  | { id: string; name: string; type: 'pressure'; semanticReferenceIds: string[]; pressureMPa: number }
  | { id: string; name: string; type: 'gravity'; accelerationMmPerS2: NeutralVector3; coordinateSystem: 'analysis' }
  | { id: string; name: string; type: 'remote_force'; connectorId: string; forceN: NeutralVector3; momentNmm: NeutralVector3; coordinateSystem: 'analysis' };

export type NeutralSimulationConstraintV2 =
  | { id: string; name: string; type: 'fixed'; semanticReferenceIds: string[] }
  | { id: string; name: string; type: 'prescribed_displacement'; semanticReferenceIds: string[]; displacementMm: [number | null, number | null, number | null]; coordinateSystem: 'analysis' }
  | { id: string; name: string; type: 'remote_displacement'; connectorId: string; translationMm: [number | null, number | null, number | null]; rotationRad: [number | null, number | null, number | null]; coordinateSystem: 'analysis' };

/** SIM-4B connected behavior is always explicit. No variant is separable
 * contact. Frictionless/frictional contact remains a separately
 * capability-gated nonlinear SIM-6 feature. */
export interface NeutralBondedTieInteractionV2 {
  id: string;
  name: string;
  type: 'bonded_tie';
  secondaryReferenceIds: string[];
  primaryReferenceIds: string[];
  adjustment: 'none';
  positionToleranceMm: number;
}

/** A conformal interface is admitted only when the independently generated
 * quadratic surface meshes have a complete one-to-one node and facet match.
 * The mesher then shares node identities; it never projects or adjusts CAD. */
export interface NeutralSharedTopologyInteractionV2 {
  id: string;
  name: string;
  type: 'shared_topology';
  secondaryReferenceIds: string[];
  primaryReferenceIds: string[];
  adjustment: 'none';
  positionToleranceMm: number;
}

/** A deliberately named analysis object that rigidly couples one verified FACE
 * group to a reference point. Loads and supports target the connector ID; the
 * point is never inferred from assembly proximity or transient mesh nodes. */
export interface NeutralRigidConnectorInteractionV2 {
  id: string;
  name: string;
  type: 'rigid_connector';
  semanticReferenceIds: string[];
  referencePointAnalysisMm: NeutralVector3;
  coupling: 'rigid_6dof';
}

export type NeutralContactInitialAdjustmentV2 = 'none' | {
  /** Move only secondary nodes whose signed initial gap is within the
   * explicitly bounded distance. The CAD model is never mutated. */
  type: 'bounded_to_contact';
  maximumAdjustmentMm: number;
};

export type NeutralContactSlidingV2 = 'small' | 'finite';

/** SIM-6 frictionless-contact member. Small sliding freezes pairing once per
 * increment; finite sliding updates the active surface projection under
 * finite-deformation kinematics. It maps exactly to CalculiX
 * face-based node-to-surface penalty contact with pairing frozen once per
 * increment only for `small`. Tangential traction is zero; optional initial adjustment is
 * explicit and bounded by admission before the solver can alter its mesh. */
export interface NeutralFrictionlessContactInteractionV2 {
  id: string;
  name: string;
  type: 'frictionless_contact';
  secondaryReferenceIds: string[];
  primaryReferenceIds: string[];
  formulation: 'node_to_surface_penalty';
  sliding: NeutralContactSlidingV2;
  normalBehavior: {
    type: 'linear_penalty';
    stiffnessMPaPerMm: number;
    tensionCutoffMPa: number;
    searchDistanceFactor: number;
  };
  tangentialBehavior: { type: 'frictionless' };
  initialAdjustment: NeutralContactInitialAdjustmentV2;
}

export interface NeutralFrictionalContactInteractionV2 extends Omit<NeutralFrictionlessContactInteractionV2, 'type' | 'tangentialBehavior'> {
  type: 'frictional_contact';
  tangentialBehavior: {
    type: 'coulomb_penalty';
    frictionCoefficient: number;
    stickSlopeMPaPerMm: number;
  };
}

export type NeutralSimulationInteractionV2 = NeutralBondedTieInteractionV2 | NeutralSharedTopologyInteractionV2 | NeutralRigidConnectorInteractionV2 | NeutralFrictionlessContactInteractionV2 | NeutralFrictionalContactInteractionV2;

interface NeutralSimulationRequestV2Base {
  schema: typeof NEUTRAL_SIMULATION_REQUEST_V2_SCHEMA;
  studyId: string;
  name: string;
  preparedAt: string;
  expiresAt: string;
  requestDigest: string;
  model: {
    projectRevision: string;
    modelDigest: string;
    coordinateSpace: 'frozen_analysis';
    domains: NeutralSimulationDomainV2[];
    references: NeutralSimulationReferenceBindingV2[];
  };
  units: NeutralSimulationRequest['units'];
  materials: NeutralSimulationMaterial[];
  materialAssignments: NeutralMaterialAssignmentV2[];
  loads: NeutralSimulationLoadV2[];
  constraints: NeutralSimulationConstraintV2[];
  interactions: NeutralSimulationInteractionV2[];
  mesh: NeutralMeshRequest;
}

export type NeutralSimulationRequestV2 = NeutralSimulationRequestV2Base & ({
  analysis: {
    type: 'linear_static';
    assumptions: ['small_displacement', 'small_strain', 'static_loading'];
  };
  requestedResults: Array<'von_mises_stress' | 'displacement' | 'reaction_force' | 'factor_of_safety' | 'critical_regions'>;
} | {
  analysis: {
    type: 'modal';
    assumptions: ['linear_elasticity', 'undamped_free_vibration'];
    settings: {
      requestedModeCount: number;
      minimumFrequencyHz: number | null;
      maximumFrequencyHz: number | null;
      massFormulation: 'consistent';
    };
  };
  requestedResults: Array<'natural_frequencies' | 'mode_shapes' | 'participation_factors' | 'effective_modal_mass'>;
} | {
  analysis: {
    type: 'linear_buckling';
    assumptions: ['linear_elasticity', 'small_displacement_preload', 'eigenvalue_buckling'];
    settings: {
      requestedModeCount: number;
      preloadCase: { id: string; name: string; loadIds: string[]; scaleFactor: 1 };
    };
  };
  requestedResults: Array<'buckling_load_factors' | 'buckling_mode_shapes'>;
} | {
  analysis: {
    type: 'static_contact';
    assumptions: [
      'small_displacement' | 'finite_deformation',
      'small_strain' | 'finite_strain',
      'quasi_static',
      'frictionless_contact' | 'frictional_contact',
    ];
    settings: {
      initialIncrement: number;
      minimumIncrement: number;
      maximumIncrement: number;
      maximumIncrements: number;
    };
  };
  requestedResults: Array<'von_mises_stress' | 'displacement' | 'reaction_force' | 'contact_status' | 'contact_pressure' | 'normal_gap' | 'tangential_slip' | 'contact_shear' | 'contact_force'>;
} | {
  analysis: {
    type: 'nonlinear_static';
    assumptions: ['finite_deformation', 'finite_strain', 'quasi_static', 'isotropic_linear_elastic' | 'isotropic_elastic_plastic'];
    settings: {
      steps: NeutralNonlinearLoadStepV2[];
      initialIncrement: number;
      minimumIncrement: number;
      maximumIncrement: number;
      maximumIncrements: number;
      maximumIterations: number;
      cutbackFactor: number;
      maximumCutbacks: number;
    };
  };
  requestedResults: Array<'von_mises_stress' | 'displacement' | 'reaction_force' | 'load_displacement_history' | 'increment_convergence' | 'equivalent_plastic_strain' | 'strain_energy_density' | 'internal_energy'>;
});

export interface NeutralMeshJobRequestV2 {
  schema: typeof NEUTRAL_MESH_REQUEST_V2_SCHEMA;
  studyId: string;
  requestDigest: string;
  projectRevision: string;
  modelDigest: string;
  coordinateSpace: 'frozen_analysis';
  units: 'mm';
  mesh: NeutralMeshRequest;
  domains: Array<{
    domainId: string;
    partId: string;
    bodyId: string;
    occurrenceId: string;
    geometryDigest: string;
    domainDigest: string;
    transformToAnalysis: NeutralMatrix4;
    volumeRegionId: string;
    materialId: string;
    shape: NeutralSimulationDomainV2['shape'];
  }>;
  boundaryRegions: Array<{
    regionId: string;
    domainId: string;
    role: 'load' | 'constraint' | 'interaction';
    semanticReferenceId: string;
    sourceFeatureId: string | null;
    faceOwnerLocal: NeutralSimulationReferenceBinding['face'];
  }>;
  interactions: NeutralSimulationInteractionV2[];
}

export interface NeutralFemModelV2 {
  schema: typeof NEUTRAL_FEM_MODEL_V2_SCHEMA;
  modelId: string;
  requestDigest: string;
  projectRevision: string;
  modelDigest: string;
  coordinateSpace: 'frozen_analysis';
  units: 'mm';
  element: NeutralFemMesh['element'];
  nodes: NeutralVector3[];
  volumeElements: {
    connectivity: number[][];
    domainIds: string[];
    materialIds: string[];
    volumeRegionIds: string[];
  };
  boundaryFacets: {
    connectivity: number[][];
    domainIds: string[];
    regionIds: string[];
  };
  domainRegions: Array<{
    domainId: string;
    partId: string;
    bodyId: string;
    occurrenceId: string;
    domainDigest: string;
    geometryDigest: string;
    materialId: string;
    volumeRegionId: string;
    transformToAnalysis: NeutralMatrix4;
    elementIndices: number[];
    nodeIndices: number[];
  }>;
  boundaryRegions: Array<{
    regionId: string;
    domainId: string;
    semanticReferenceIds: string[];
    sourceFeatureIds: string[];
    facetIndices: number[];
    matchedCadFaceOwnerLocal: NeutralSimulationReferenceBinding['face'];
    match: NeutralFemMesh['boundaryRegions'][number]['match'];
  }>;
  quality: NeutralFemMesh['quality'] & {
    perDomain: Array<{
      domainId: string;
      nodeCount: number;
      elementCount: number;
      cadVolumeMm3: number;
      meshVolumeMm3: number;
      volumeRelativeError: number;
      minimum: number;
      average: number;
      invalidElementCount: 0;
    }>;
  };
  provenance: Omit<NeutralFemMesh['provenance'], 'meshProviderInterfaceVersion'> & {
    meshProviderInterfaceVersion: typeof MESH_PROVIDER_INTERFACE_V2_VERSION;
  };
}

interface NeutralSimulationResultV2Base {
  schema: typeof NEUTRAL_SIMULATION_RESULT_V2_SCHEMA;
  studyId: string;
  jobId: string;
  requestDigest: string;
  projectRevision: string;
  modelDigest: string;
  analysisType: NeutralAnalysisTypeV2;
  status: 'succeeded' | 'failed' | 'cancelled';
  authority: NeutralResultAuthority;
  metrics: NeutralSimulationResult['metrics'];
  perDomain: Array<{
    domainId: string;
    metrics: NeutralSimulationResult['metrics'];
    /** Dataset IDs provide deterministic ownership for future field payloads;
     * extrema cannot silently collapse multiple domains into one. */
    fieldDatasetIds: string[];
  }>;
  reactions: Array<{
    constraintId: string;
    domainId: string;
    semanticReferenceIds: string[];
    forceN: NeutralVector3;
    /** Present only for a remote-displacement constraint. CalculiX reports
     * the rotation-node resultant in N*mm; direct FACE constraints have no
     * single trustworthy moment reduction and therefore return null. */
    momentNmm: NeutralVector3 | null;
    connectorId: string | null;
    referencePointAnalysisMm: NeutralVector3 | null;
  }>;
  criticalRegions: Array<Omit<NeutralSimulationHotspot, 'positionPartLocalMm' | 'mapping'> & {
    domainId: string;
    positionAnalysisMm: NeutralVector3 | null;
    mapping: 'durable_reference' | 'analysis_location' | 'unmapped';
  }>;
  failedConstraints: NeutralSimulationResult['failedConstraints'];
  warnings: NeutralSimulationResult['warnings'];
  convergence: NeutralSimulationResult['convergence'];
  suggestedEngineeringIssues: string[];
  provenance: Omit<NeutralSimulationResult['provenance'], 'providerInterfaceVersion'> & {
    providerInterfaceVersion: typeof SIMULATION_PROVIDER_INTERFACE_V2_VERSION;
  };
  review: NeutralSimulationResult['review'];
  mutation: NeutralSimulationResult['mutation'];
}

export interface NeutralModalModeV2 {
  modeNumber: number;
  eigenvalueRad2PerS2: number;
  angularFrequencyRadPerS: number;
  frequencyHz: number;
  imaginaryAngularFrequencyRadPerS: number;
  participationFactors: [number, number, number, number, number, number];
  effectiveModalMass: [number, number, number, number, number, number];
  fieldDatasetIds: string[];
}

export interface NeutralBucklingModeV2 {
  modeNumber: number;
  eigenvalueLoadFactor: number;
  fieldDatasetIds: string[];
}

export interface NeutralContactInterfaceResultV2 {
  interactionId: string;
  secondaryDomainId: string;
  primaryDomainId: string;
  status: 'active' | 'open_or_touching';
  maximumPressureMPa: number;
  minimumNormalGapMm: number;
  maximumPenetrationMm: number;
  maximumTangentialSlipMm: number;
  maximumShearMPa?: number;
  forceOnSecondaryN: NeutralVector3;
  pressureDatasetId: string;
  normalGapDatasetId: string;
  tangentialSlipDatasetId?: string;
  contactShearDatasetId?: string;
}

export interface NeutralContactIncrementV2 {
  increment: number;
  attempt: number;
  iterations: number;
  stepTime: number;
  incrementSize: number;
}

export interface NeutralNonlinearAmplitudePointV2 {
  /** Normalized step time. Every amplitude must begin at 0 and end at 1. */
  time: number;
  scaleFactor: number;
}

export interface NeutralNonlinearLoadStepV2 {
  id: string;
  name: string;
  /** Pseudo-time retained in result history; no dynamic inertia is implied. */
  duration: number;
  loadAmplitudes: Array<{
    loadId: string;
    interpolation: 'piecewise_linear';
    points: NeutralNonlinearAmplitudePointV2[];
  }>;
}

export interface NeutralNonlinearHistoryPointV2 {
  stepIndex: number;
  stepId: string;
  increment: number;
  attempt: number;
  iterations: number;
  stepTime: number;
  totalTime: number;
  incrementSize: number;
  loadScaleFactors: Array<{ loadId: string; scaleFactor: number }>;
  maximumDisplacementMm: number;
  resultantReactionForceN: NeutralVector3;
  materialState: NeutralNonlinearMaterialStateV2 | null;
}

export interface NeutralNonlinearMaterialStateV2 {
  maximumEquivalentPlasticStrain: number;
  maximumEnergyDensityMPa: number;
  totalInternalEnergyNmm: number;
  yieldedElementCount: number;
}

export type NeutralSimulationResultV2 = NeutralSimulationResultV2Base & ({
  analysisType: 'linear_static';
} | {
  analysisType: 'modal';
  modal: {
    massFormulation: 'consistent';
    solverNormalization: 'mass';
    visualizationNormalization: 'maximum_vector_magnitude_1';
    requestedModeCount: number;
    modes: NeutralModalModeV2[];
    totalEffectiveModalMass: [number, number, number, number, number, number];
    totalEffectiveMass: [number, number, number, number, number, number];
    effectiveMassCoverage: [number, number, number, number, number, number];
    rigidBodyModeDiagnostics: {
      thresholdHz: number;
      expectedModeCount: 0 | 6;
      detectedModeCount: number;
      modeNumbers: number[];
      status: 'complete' | 'incomplete';
    };
  };
} | {
  analysisType: 'linear_buckling';
  buckling: {
    preloadCaseId: string;
    requestedModeCount: number;
    solverNormalization: 'eigenvector';
    visualizationNormalization: 'maximum_vector_magnitude_1';
    prediction: 'linear_eigenvalue_not_nonlinear_collapse';
    modes: NeutralBucklingModeV2[];
  };
} | {
  analysisType: 'static_contact';
  contact: {
    formulation: 'node_to_surface_penalty';
    sliding: NeutralContactSlidingV2;
    interfaces: NeutralContactInterfaceResultV2[];
    increments: NeutralContactIncrementV2[];
  };
} | {
  analysisType: 'nonlinear_static';
  nonlinear: {
    formulation: 'finite_deformation_elastic' | 'finite_deformation_elastic_plastic';
    steps: Array<{
      stepIndex: number;
      stepId: string;
      converged: true;
      increments: NeutralContactIncrementV2[];
    }>;
    history: NeutralNonlinearHistoryPointV2[];
    materialState: NeutralNonlinearMaterialStateV2 | null;
  };
});

/** A small, immutable handle describing a solver-normalized visualization
 * field. Native solver files never cross the provider boundary. Triangle
 * pages deliberately repeat their vertices so every page can be rendered and
 * verified independently without hidden topology state. */
interface NeutralSimulationFieldDatasetV2Base {
  schema: typeof NEUTRAL_SIMULATION_FIELD_DATASET_V2_SCHEMA;
  datasetId: string;
  jobId: string;
  domainId: string;
  location: 'boundary_facet';
  topology: 'triangle_soup';
  valueRange: {
    minimum: number;
    maximum: number;
    minimumPositionAnalysisMm: NeutralVector3;
    maximumPositionAnalysisMm: NeutralVector3;
  };
  deformation: {
    vectorsIncluded: true;
    trueScale: 1;
    recommendedScale: number;
  };
  mapping: {
    domain: 'exact';
    cadRegions: 'partial' | 'exact';
    semanticReferenceIds: string[];
  };
  totalTriangles: number;
  maximumPageTriangles: number;
  datasetDigest: string;
}

export type NeutralSimulationFieldDatasetV2 = NeutralSimulationFieldDatasetV2Base & ({
  analysisType: 'linear_static';
  step: { index: 0; label: 'static' };
  component: 'displacement_magnitude' | 'von_mises_stress';
  unit: 'mm' | 'MPa';
} | {
  analysisType: 'modal';
  step: { index: number; label: string; modeNumber: number; frequencyHz: number };
  component: 'mode_shape_magnitude';
  unit: 'normalized';
} | {
  analysisType: 'linear_buckling';
  step: { index: number; label: string; bucklingModeNumber: number; eigenvalueLoadFactor: number };
  component: 'buckling_mode_shape_magnitude';
  unit: 'normalized';
} | {
  analysisType: 'static_contact';
  step: { index: 0; label: 'final_contact_increment' };
  component: 'displacement_magnitude' | 'von_mises_stress' | 'contact_pressure' | 'normal_gap' | 'tangential_slip' | 'contact_shear';
  unit: 'mm' | 'MPa';
} | {
  analysisType: 'nonlinear_static';
  step: { index: number; label: 'final_nonlinear_increment'; stepId: string; totalTime: number };
  component: 'displacement_magnitude' | 'von_mises_stress' | 'equivalent_plastic_strain' | 'strain_energy_density';
  unit: 'mm' | 'MPa' | 'dimensionless';
});

export interface NeutralSimulationFieldTriangleV2 {
  facetIndex: number;
  elementIndex: number;
  positionsAnalysisMm: NeutralTriangle3<NeutralVector3>;
  displacementsMm: NeutralTriangle3<NeutralVector3>;
  values: [number, number, number];
}

export interface NeutralSimulationFieldPageV2 {
  schema: typeof NEUTRAL_SIMULATION_FIELD_PAGE_V2_SCHEMA;
  dataset: NeutralSimulationFieldDatasetV2;
  cursor: string;
  nextCursor: string | null;
  triangleOffset: number;
  triangleCount: number;
  chunkDigest: string;
  triangles: NeutralSimulationFieldTriangleV2[];
}

export interface SimulationProviderCapabilitiesV2 extends Omit<SimulationProviderCapabilities, 'interfaceVersion' | 'analysisTypes' | 'study'> {
  interfaceVersion: typeof SIMULATION_PROVIDER_INTERFACE_V2_VERSION;
  analysisTypes: readonly NeutralAnalysisTypeV2[];
  fieldResults: {
    paginated: true;
    maximumPageTriangles: number;
    components: ReadonlyArray<'displacement_magnitude' | 'von_mises_stress' | 'mode_shape_magnitude' | 'buckling_mode_shape_magnitude' | 'contact_pressure' | 'normal_gap' | 'tangential_slip' | 'contact_shear' | 'equivalent_plastic_strain' | 'strain_energy_density'>;
    topology: 'triangle_soup';
  };
  study: Omit<SimulationProviderCapabilities['study'], 'loadTypes' | 'constraintTypes'> & {
    loadTypes: ReadonlyArray<NeutralSimulationLoadV2['type']>;
    constraintTypes: ReadonlyArray<NeutralSimulationConstraintV2['type']>;
    maximumDomains: number;
    maximumOccurrences: number;
    multiDomain: true;
    perDomainMaterials: true;
    rigidOccurrenceTransforms: true;
    interactionTypes: ReadonlyArray<NeutralSimulationInteractionV2['type']>;
    maximumInteractions: number;
    maximumReferencesPerInteractionSide: number;
    modal?: {
      maximumModes: number;
      frequencyBounds: true;
      massFormulations: readonly ['consistent'];
      constrainedOnly: boolean;
      maximumFreeFreeDomains: number;
    };
    buckling?: {
      maximumModes: number;
      maximumDomains: number;
      preloadCaseRequired: true;
      loadTypes: readonly ['surface_force'];
      constraintTypes: readonly ['fixed'];
    };
    nonlinearStatic?: {
      maximumDomains: number;
      maximumSteps: number;
      maximumAmplitudePoints: number;
      amplitudeModes: readonly ['shared_shape_per_step'];
      loadTypes: ReadonlyArray<NeutralSimulationLoadV2['type']>;
      constraintTypes: ReadonlyArray<NeutralSimulationConstraintV2['type']>;
      geometricNonlinearity: true;
      materialModels: ReadonlyArray<'isotropic_linear_elastic' | 'isotropic_elastic_plastic'>;
      materialNonlinearity: boolean;
      hardeningModels: ReadonlyArray<'isotropic'>;
      plasticStrainResults: boolean;
      energyResults: boolean;
      automaticIncrements: true;
      incrementHistory: true;
      loadDisplacementHistory: true;
    };
    contact?: {
      maximumDomains: 2;
      maximumInteractions: number;
      interactionTypes: ReadonlyArray<'frictionless_contact' | 'frictional_contact'>;
      formulations: readonly ['node_to_surface_penalty'];
      sliding: ReadonlyArray<NeutralContactSlidingV2>;
      normalBehaviors: readonly ['linear_penalty'];
      tangentialBehaviors: ReadonlyArray<'frictionless' | 'coulomb_penalty'>;
      initialAdjustments: ReadonlyArray<'none' | 'bounded_to_contact'>;
      nonlinearIncrementReporting: true;
    };
  };
}

export interface MeshProviderCapabilitiesV2 extends Omit<MeshProviderCapabilities, 'interfaceVersion'> {
  interfaceVersion: typeof MESH_PROVIDER_INTERFACE_V2_VERSION;
  maximumDomains: number;
  multiDomain: true;
  rigidOccurrenceTransforms: true;
  domainRegionMapping: true;
  interactionTypes: ReadonlyArray<NeutralSimulationInteractionV2['type']>;
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
  qualification: {
    status: 'proof_of_concept' | 'internally_validated' | 'public_beta' | 'independently_reviewed' | 'qualified' | 'unsupported';
    engineeringUsePermitted: boolean;
    statement: string;
    limitations: readonly string[];
    evidence: {
      schema: 'tunacad-simulation-qualification-matrix/1.0';
      matrixId: string;
      pendingLaneIds: readonly string[];
    } | null;
  };
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
    resourceLimits?: {
      maximumInputGeometryBytes: number | null;
      maximumWorkingDirectoryBytes: number | null;
      maximumResultFileBytes: number | null;
      maximumDiagnosticCharacters: number;
      processTerminationGraceMs: number;
      cpuTimeLimitMs: number | null;
      memoryLimitBytes: number | null;
    };
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
  qualification: SimulationProviderCapabilities['qualification'];
  execution: SimulationProviderCapabilities['execution'];
}

/** V2 geometry is exported one approved domain at a time. Repeated Part
 * occurrences may return identical owner-local STEP bytes; their independent
 * rigid transforms are applied by the multi-domain mesher composition layer. */
export interface SimulationGeometryResolverV2 {
  descriptor: NeutralSimulationRequestV2['model'];
  exportDomain(domainId: string, format: 'step' | 'brep'): Promise<Uint8Array>;
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

export interface ExternalSolverProviderV2 {
  readonly id: string;
  readonly version: string;
  readonly capabilities: SimulationProviderCapabilitiesV2;
  submit(request: NeutralSimulationRequestV2, model: NeutralFemModelV2): Promise<SimulationProviderSubmission>;
  getStatus(providerRunId: string): Promise<SimulationProviderStatus>;
  getResult(providerRunId: string): Promise<NeutralSimulationResultV2 | null>;
  getFieldDataset(providerRunId: string, datasetId: string, cursor?: string, limit?: number): Promise<NeutralSimulationFieldPageV2>;
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

export interface ExternalSimulationProviderV2 {
  readonly id: string;
  readonly version: string;
  readonly capabilities: SimulationProviderCapabilitiesV2;
  submit(request: NeutralSimulationRequestV2, geometry: SimulationGeometryResolverV2): Promise<SimulationProviderSubmission>;
  getStatus(providerRunId: string): Promise<SimulationProviderStatus>;
  getResult(providerRunId: string): Promise<NeutralSimulationResultV2 | null>;
  getFieldDataset(providerRunId: string, datasetId: string, cursor?: string, limit?: number): Promise<NeutralSimulationFieldPageV2>;
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

/** Browser/MCP preparation shape for an explicit SIM-4A multi-domain study.
 * Assembly proximity and mates are deliberately absent: every occurrence,
 * material assignment and FACE binding must be named by the caller. */
export interface PrepareNeutralSimulationInputV2 {
  schema: 'tunacad-neutral-simulation-preparation/2.0';
  studyId: string;
  name: string;
  analysisType: 'linear_static' | 'modal' | 'linear_buckling' | 'static_contact' | 'nonlinear_static';
  modal?: {
    requestedModeCount: number;
    minimumFrequencyHz?: number | null;
    maximumFrequencyHz?: number | null;
    massFormulation?: 'consistent';
  };
  buckling?: {
    requestedModeCount: number;
    preloadCase: { id: string; name: string; loadIds: string[]; scaleFactor?: 1 };
  };
  contact?: {
    initialIncrement: number;
    minimumIncrement: number;
    maximumIncrement: number;
    maximumIncrements: number;
  };
  nonlinear?: {
    steps: NeutralNonlinearLoadStepV2[];
    initialIncrement: number;
    minimumIncrement: number;
    maximumIncrement: number;
    maximumIncrements: number;
    maximumIterations: number;
    cutbackFactor: number;
    maximumCutbacks: number;
  };
  domains: Array<{
    domainId: string;
    partId: string;
    bodyId: string;
    occurrenceId: string;
    materialId: string;
    volumeRegionId: string;
  }>;
  referenceBindings: Array<{
    semanticReferenceId: string;
    domainId: string;
    role: 'load' | 'constraint' | 'interaction';
  }>;
  materials: NeutralSimulationMaterial[];
  loads: NeutralSimulationLoadV2[];
  constraints: NeutralSimulationConstraintV2[];
  interactions: NeutralSimulationInteractionV2[];
  mesh: NeutralMeshRequest;
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
