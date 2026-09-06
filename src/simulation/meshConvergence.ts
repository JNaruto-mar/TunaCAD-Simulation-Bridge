import {
  NEUTRAL_MESH_CONVERGENCE_REPORT_SCHEMA,
  type NeutralMeshConvergenceComparison,
  type NeutralMeshConvergenceConfiguration,
  type NeutralMeshConvergenceLevelResult,
  type NeutralMeshConvergenceOptions,
  type NeutralMeshConvergenceReport,
  type NeutralSimulationRequest,
  type NeutralSimulationResult,
  type NeutralVector3,
} from './externalSimulationContracts.ts';

export const DEFAULT_MESH_CONVERGENCE_CONFIGURATION: NeutralMeshConvergenceConfiguration = Object.freeze({
  globalSizeMultipliers: [1.25, 1, 0.8] as [number, number, number],
  maximumDisplacementRelativeChange: 0.05,
  maximumStressRelativeChange: 0.15,
  maximumReactionImbalanceRelative: 0.0001,
});

export function resolveMeshConvergenceConfiguration(
  options: NeutralMeshConvergenceOptions = {},
): NeutralMeshConvergenceConfiguration {
  const multipliers = options.globalSizeMultipliers ?? DEFAULT_MESH_CONVERGENCE_CONFIGURATION.globalSizeMultipliers;
  if (multipliers.length !== 3 || multipliers.some(value => !Number.isFinite(value) || value <= 0 || value > 10)
    || !(multipliers[0] > multipliers[1] && multipliers[1] > multipliers[2])) {
    throw convergenceError('SIMULATION_CONVERGENCE_OPTIONS_INVALID', 'Mesh multipliers must contain three finite positive values ordered coarse > medium > fine.');
  }
  const configuration: NeutralMeshConvergenceConfiguration = {
    globalSizeMultipliers: [...multipliers],
    maximumDisplacementRelativeChange: options.maximumDisplacementRelativeChange ?? DEFAULT_MESH_CONVERGENCE_CONFIGURATION.maximumDisplacementRelativeChange,
    maximumStressRelativeChange: options.maximumStressRelativeChange ?? DEFAULT_MESH_CONVERGENCE_CONFIGURATION.maximumStressRelativeChange,
    maximumReactionImbalanceRelative: options.maximumReactionImbalanceRelative ?? DEFAULT_MESH_CONVERGENCE_CONFIGURATION.maximumReactionImbalanceRelative,
  };
  for (const [name, value] of Object.entries(configuration).filter(([key]) => key !== 'globalSizeMultipliers')) {
    if (!Number.isFinite(value) || (value as number) <= 0 || (value as number) > 1) {
      throw convergenceError('SIMULATION_CONVERGENCE_OPTIONS_INVALID', `${name} must be greater than zero and no greater than one.`);
    }
  }
  return configuration;
}

export function createConvergenceMeshRequests(
  request: NeutralSimulationRequest,
  configuration: NeutralMeshConvergenceConfiguration,
): Array<{ level: 'coarse' | 'medium' | 'fine'; mesh: NeutralSimulationRequest['mesh'] }> {
  const names = ['coarse', 'medium', 'fine'] as const;
  return names.map((level, index) => {
    const multiplier = configuration.globalSizeMultipliers[index];
    const globalSizeMm = request.mesh.globalSizeMm * multiplier;
    if (!Number.isFinite(globalSizeMm) || globalSizeMm <= 0 || globalSizeMm > 1_000_000) {
      throw convergenceError('SIMULATION_CONVERGENCE_OPTIONS_INVALID', 'A derived convergence mesh size is outside the neutral v1 mesh bounds.');
    }
    return {
      level,
      mesh: {
        ...structuredClone(request.mesh),
        globalSizeMm,
        ...(request.mesh.minimumSizeMm === undefined
          ? {}
          : { minimumSizeMm: Math.min(request.mesh.minimumSizeMm * multiplier, globalSizeMm) }),
      },
    };
  });
}

export function createMeshConvergenceLevelResult(
  level: 'coarse' | 'medium' | 'fine',
  jobId: string,
  request: NeutralSimulationRequest,
  result: NeutralSimulationResult,
): NeutralMeshConvergenceLevelResult {
  const reactionResultantN = result.reactions.reduce<NeutralVector3>(
    (sum, reaction) => [sum[0] + reaction.forceN[0], sum[1] + reaction.forceN[1], sum[2] + reaction.forceN[2]],
    [0, 0, 0],
  );
  const applied = surfaceForceResultant(request);
  const appliedMagnitude = applied ? magnitude(applied) : 0;
  const reactionConstraintIds = new Set(result.reactions.map(reaction => reaction.constraintId));
  const reactionsComplete = reactionConstraintIds.size === request.constraints.length
    && request.constraints.every(constraint => reactionConstraintIds.has(constraint.id));
  const imbalance = applied && reactionsComplete
    ? magnitude([reactionResultantN[0] + applied[0], reactionResultantN[1] + applied[1], reactionResultantN[2] + applied[2]])
    : null;
  return {
    level,
    jobId,
    requestDigest: request.requestDigest,
    geometryDigest: request.geometry.geometryDigest,
    globalSizeMm: request.mesh.globalSizeMm,
    minimumSizeMm: request.mesh.minimumSizeMm ?? null,
    nodeCount: result.provenance.mesh?.nodeCount ?? null,
    elementCount: result.provenance.mesh?.elementCount ?? null,
    maximumDisplacementMm: result.metrics.maximumDisplacementMm,
    maximumVonMisesStressMPa: result.metrics.maximumVonMisesStressMPa,
    reactionResultantN,
    reactionImbalanceRelative: imbalance === null ? null : imbalance / Math.max(appliedMagnitude, 1e-12),
  };
}

export function analyzeMeshConvergence(input: {
  convergenceId: string;
  preparationId: string;
  request: NeutralSimulationRequest;
  invariantStudyDigest: string;
  configuration: NeutralMeshConvergenceConfiguration;
  levels: [NeutralMeshConvergenceLevelResult, NeutralMeshConvergenceLevelResult, NeutralMeshConvergenceLevelResult];
  requestedAt: string;
  completedAt: string;
}): NeutralMeshConvergenceReport {
  const comparisons: [NeutralMeshConvergenceComparison, NeutralMeshConvergenceComparison] = [
    compareLevels(input.levels[0], input.levels[1]),
    compareLevels(input.levels[1], input.levels[2]),
  ];
  const fineComparison = comparisons[1];
  const checks: NeutralMeshConvergenceReport['checks'] = [];
  const expectedLevels = ['coarse', 'medium', 'fine'];
  const levelOrderValid = input.levels.every((level, index) => level.level === expectedLevels[index]);
  checks.push({
    code: 'REFINEMENT_LEVEL_ORDER',
    status: levelOrderValid ? 'pass' : 'fail',
    message: levelOrderValid ? 'Levels are ordered coarse, medium, and fine.' : 'Convergence levels are missing or out of order.',
  });
  const meshSizesDecrease = input.levels[0].globalSizeMm > input.levels[1].globalSizeMm
    && input.levels[1].globalSizeMm > input.levels[2].globalSizeMm;
  checks.push({
    code: 'MESH_SIZE_REFINEMENT',
    status: meshSizesDecrease ? 'pass' : 'fail',
    message: meshSizesDecrease ? 'Requested global mesh size decreases at every level.' : 'Requested mesh sizes do not strictly refine from coarse to fine.',
  });
  const geometryInvariant = input.levels.every(level => level.geometryDigest === input.request.geometry.geometryDigest);
  checks.push({
    code: 'GEOMETRY_DIGEST_INVARIANT',
    status: geometryInvariant ? 'pass' : 'fail',
    message: geometryInvariant ? 'All levels use the frozen geometry digest.' : 'At least one level used a different geometry digest.',
  });
  const distinctRequests = new Set(input.levels.map(level => level.requestDigest)).size === input.levels.length;
  checks.push({
    code: 'LEVEL_REQUEST_DIGESTS_DISTINCT',
    status: distinctRequests ? 'pass' : 'fail',
    message: distinctRequests ? 'Every mesh variant has a distinct request digest.' : 'Two or more mesh variants share a request digest.',
  });
  const countsAvailable = input.levels.every(level => level.nodeCount !== null && level.elementCount !== null);
  const monotonicCounts = countsAvailable
    && input.levels[0].nodeCount! < input.levels[1].nodeCount!
    && input.levels[1].nodeCount! < input.levels[2].nodeCount!
    && input.levels[0].elementCount! < input.levels[1].elementCount!
    && input.levels[1].elementCount! < input.levels[2].elementCount!;
  checks.push({
    code: 'MESH_REFINEMENT_MONOTONIC',
    status: !countsAvailable ? 'indeterminate' : monotonicCounts ? 'pass' : 'fail',
    message: !countsAvailable ? 'One or more providers omitted mesh counts.' : monotonicCounts ? 'Node and element counts increase at every refinement level.' : 'Node or element counts did not increase at every refinement level.',
  });
  checks.push(metricChangeCheck('DISPLACEMENT_REFINED_CHANGE', fineComparison.displacementRelativeChange, input.configuration.maximumDisplacementRelativeChange, 'displacement'));
  checks.push(metricChangeCheck('STRESS_REFINED_CHANGE', fineComparison.stressRelativeChange, input.configuration.maximumStressRelativeChange, 'stress'));
  for (const level of input.levels) {
    const value = level.reactionImbalanceRelative;
    checks.push({
      code: `REACTION_EQUILIBRIUM_${level.level.toUpperCase()}`,
      status: value === null ? 'indeterminate' : value <= input.configuration.maximumReactionImbalanceRelative ? 'pass' : 'fail',
      message: value === null
        ? `${level.level} equilibrium is unavailable for this load combination.`
        : `${level.level} relative reaction imbalance is ${value}.`,
    });
  }
  const status = checks.some(check => check.status === 'fail')
    ? 'not_converged'
    : checks.some(check => check.status === 'indeterminate') ? 'indeterminate' : 'converged';
  const warnings: NeutralMeshConvergenceReport['warnings'] = [{
    code: 'STRESS_SINGULARITY_REVIEW_REQUIRED',
    severity: 'warning',
    message: 'Peak stress convergence can be invalid near point loads, sharp re-entrant corners, and idealized fixed boundaries; inspect hotspot movement and stress trends.',
  }];
  if (status !== 'converged') warnings.push({
    code: 'MESH_CONVERGENCE_NOT_ESTABLISHED',
    severity: 'critical',
    message: 'The three-level study did not establish mesh-independent results within the configured acceptance bands.',
  });
  return {
    schema: NEUTRAL_MESH_CONVERGENCE_REPORT_SCHEMA,
    convergenceId: input.convergenceId,
    preparationId: input.preparationId,
    studyId: input.request.studyId,
    baseRequestDigest: input.request.requestDigest,
    invariantStudyDigest: input.invariantStudyDigest,
    geometryDigest: input.request.geometry.geometryDigest,
    projectRevision: input.request.geometry.projectRevision,
    status,
    configuration: structuredClone(input.configuration),
    levels: structuredClone(input.levels),
    comparisons,
    checks,
    warnings,
    requestedAt: input.requestedAt,
    completedAt: input.completedAt,
    review: {
      engineerReviewRequired: true,
      engineeringUsePermitted: false,
      disclaimer: 'Experimental three-level mesh evidence only. A qualified engineer must review mesh quality, boundary idealization, singularities, and the underlying model.',
    },
    mutation: {
      occurred: false,
      projectRevisionBefore: input.request.geometry.projectRevision,
      projectRevisionAfter: input.request.geometry.projectRevision,
    },
  };
}

function compareLevels(from: NeutralMeshConvergenceLevelResult, to: NeutralMeshConvergenceLevelResult): NeutralMeshConvergenceComparison {
  return {
    from: from.level,
    to: to.level,
    displacementRelativeChange: relativeChange(from.maximumDisplacementMm, to.maximumDisplacementMm),
    stressRelativeChange: relativeChange(from.maximumVonMisesStressMPa, to.maximumVonMisesStressMPa),
  };
}

function relativeChange(from: number | null, to: number | null): number | null {
  if (from === null || to === null || !Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.abs(to - from) / Math.max(Math.abs(to), 1e-12);
}

function metricChangeCheck(code: string, value: number | null, maximum: number, label: string) {
  return {
    code,
    status: value === null ? 'indeterminate' as const : value <= maximum ? 'pass' as const : 'fail' as const,
    message: value === null ? `Refined ${label} change is unavailable.` : `Medium-to-fine ${label} relative change is ${value}; the configured maximum is ${maximum}.`,
  };
}

function surfaceForceResultant(request: NeutralSimulationRequest): NeutralVector3 | null {
  if (request.loads.some(load => load.type !== 'surface_force')) return null;
  return request.loads.reduce<NeutralVector3>((sum, load) => {
    if (load.type !== 'surface_force') return sum;
    return [sum[0] + load.forceN[0], sum[1] + load.forceN[1], sum[2] + load.forceN[2]];
  }, [0, 0, 0]);
}

function magnitude(vector: NeutralVector3): number { return Math.hypot(vector[0], vector[1], vector[2]); }
function convergenceError(code: string, message: string): Error & { code: string } { return Object.assign(new Error(message), { code }); }
