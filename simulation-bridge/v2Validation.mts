import * as z from 'zod/v4';
import type {
  MeshProviderCapabilities,
  MeshProviderCapabilitiesV2,
  NeutralContactInitialAdjustmentV2,
  NeutralFemModelV2,
  NeutralSimulationFieldPageV2,
  NeutralSimulationRequestV2,
  NeutralSimulationResultV2,
  SimulationProviderCapabilities,
  SimulationProviderCapabilitiesV2,
} from '../src/simulation/externalSimulationContracts.ts';
import { digest } from './stableDigest.mts';

const text = z.string().min(1).max(500).regex(/^[^\u0000-\u001f\u007f]*$/);
const finite = z.number().finite();
const positive = finite.positive();
const nonNegative = finite.nonnegative();
const vector = z.tuple([finite, finite, finite]);
const analysisPoint = z.tuple([finite.min(-1e9).max(1e9), finite.min(-1e9).max(1e9), finite.min(-1e9).max(1e9)]);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const uniqueReferences = z.array(text).min(1).max(32)
  .refine(ids => new Set(ids).size === ids.length, 'References within one entry must be unique.');
const matrix = z.array(finite).length(16);
const box = z.object({ min: vector, max: vector, size: vector }).strict();
const face = z.object({
  centroidPartLocalMm: vector,
  areaMm2: positive,
  outwardDirection: vector.nullable(),
  geometryType: text.nullable(),
  boundingBoxMm: z.object({ min: vector, max: vector }).strict().optional(),
  edgeCount: z.number().int().positive().optional(),
  analytic: z.object({
    kind: z.enum(['plane', 'cylinder', 'cone', 'sphere', 'other']),
    originMm: vector.optional(), axis: vector.optional(), radiusMm: positive.optional(),
  }).strict().optional(),
  witnessPointsPartLocalMm: z.array(vector).max(32).optional(),
}).strict();
const materialSource = z.object({ kind: z.enum(['library', 'custom']), reference: text, revision: text.optional() }).strict();
const material = z.discriminatedUnion('model', [
  z.object({
    id: text, name: text, model: z.literal('isotropic_linear_elastic'),
    densityKgM3: positive.max(100000).optional(),
    youngsModulusMPa: positive.max(100000000), poissonRatio: finite.min(0).lt(0.5),
    yieldStrengthMPa: positive.optional(), thermalConductivityWPerMK: positive.max(1e7).optional(), source: materialSource,
  }).strict(),
  z.object({
    id: text, name: text, model: z.literal('isotropic_elastic_plastic'),
    densityKgM3: positive.max(100000).optional(),
    youngsModulusMPa: positive.max(100000000), poissonRatio: finite.min(0).lt(0.5),
    yieldStrengthMPa: positive, thermalConductivityWPerMK: positive.max(1e7).optional(),
    plasticity: z.object({
      hardening: z.literal('isotropic'),
      curve: z.array(z.object({ trueStressMPa: positive.max(100000000), plasticStrain: nonNegative.max(10) }).strict()).min(2).max(128),
    }).strict(),
    source: materialSource,
  }).strict(),
]);
const meshRequest = z.object({
  dimensionality: z.literal('3d'), elementFamily: z.literal('tetrahedral'), order: z.literal(2),
  globalSizeMm: positive.max(1000000), minimumSizeMm: positive.optional(),
  maximumNodes: z.number().int().min(10).max(2_000_000), maximumElements: z.number().int().min(10).max(1_000_000),
  qualityMetric: z.literal('provider_normalized'), minimumQuality: finite.min(0.04).max(1),
}).strict();

const requestSchema = z.object({
  schema: z.literal('tunacad-neutral-simulation-request/2.0'),
  studyId: text, name: text, preparedAt: z.iso.datetime(), expiresAt: z.iso.datetime(), requestDigest: hash,
  analysis: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('linear_static'),
      assumptions: z.tuple([z.literal('small_displacement'), z.literal('small_strain'), z.literal('static_loading')]),
    }).strict(),
    z.object({
      type: z.literal('modal'),
      assumptions: z.tuple([z.literal('linear_elasticity'), z.literal('undamped_free_vibration')]),
      settings: z.object({
        requestedModeCount: z.number().int().min(1).max(24),
        minimumFrequencyHz: nonNegative.max(1e9).nullable(),
        maximumFrequencyHz: positive.max(1e9).nullable(),
        massFormulation: z.literal('consistent'),
      }).strict(),
    }).strict(),
    z.object({
      type: z.literal('linear_buckling'),
      assumptions: z.tuple([z.literal('linear_elasticity'), z.literal('small_displacement_preload'), z.literal('eigenvalue_buckling')]),
      settings: z.object({
        requestedModeCount: z.number().int().min(1).max(12),
        preloadCase: z.object({ id: text, name: text, loadIds: z.array(text).min(1).max(64).refine(unique), scaleFactor: z.literal(1) }).strict(),
      }).strict(),
    }).strict(),
    z.object({
      type: z.literal('static_contact'),
      assumptions: z.tuple([
        z.enum(['small_displacement', 'finite_deformation']),
        z.enum(['small_strain', 'finite_strain']),
        z.literal('quasi_static'),
        z.enum(['frictionless_contact', 'frictional_contact']),
      ]),
      settings: z.object({
        initialIncrement: positive.max(1), minimumIncrement: positive.max(1), maximumIncrement: positive.max(1),
        maximumIncrements: z.number().int().min(1).max(1000),
      }).strict(),
    }).strict(),
    z.object({
      type: z.literal('nonlinear_static'),
      assumptions: z.tuple([z.literal('finite_deformation'), z.literal('finite_strain'), z.literal('quasi_static'), z.enum(['isotropic_linear_elastic', 'isotropic_elastic_plastic'])]),
      settings: z.object({
        steps: z.array(z.object({
          id: text, name: text, duration: positive.max(1e9),
          loadAmplitudes: z.array(z.object({
            loadId: text, interpolation: z.literal('piecewise_linear'),
            points: z.array(z.object({ time: nonNegative.max(1), scaleFactor: finite.min(-1e6).max(1e6) }).strict()).min(2).max(64),
          }).strict()).min(1).max(64),
        }).strict()).min(1).max(16),
        initialIncrement: positive.max(1), minimumIncrement: positive.max(1), maximumIncrement: positive.max(1),
        maximumIncrements: z.number().int().min(1).max(1000), maximumIterations: z.number().int().min(4).max(100),
        cutbackFactor: positive.lt(1), maximumCutbacks: z.number().int().min(1).max(20),
      }).strict(),
    }).strict(),
    z.object({
      type: z.literal('steady_thermal'),
      assumptions: z.tuple([z.literal('steady_state'), z.literal('isotropic_conduction'), z.literal('temperature_independent_properties')]),
    }).strict(),
  ]),
  model: z.object({
    projectRevision: text, modelDigest: hash, coordinateSpace: z.literal('frozen_analysis'),
    domains: z.array(z.object({
      domainId: text, partId: text, bodyId: text, occurrenceId: text, domainDigest: hash, geometryDigest: hash,
      transformToAnalysis: matrix,
      shape: z.object({
        valid: z.literal(true), connectedSolidCount: z.literal(1),
        faceCount: z.number().int().positive().max(10000), edgeCount: z.number().int().positive().max(50000),
        volumeMm3: positive, surfaceAreaMm2: positive, boundingBoxOwnerLocalMm: box,
      }).strict(),
    }).strict()).min(1).max(128),
    references: z.array(z.object({
      semanticReferenceId: text, domainId: text, ownerPartId: text, ownerBodyId: text, occurrenceId: text,
      geometryKind: z.literal('FACE'), role: z.enum(['load', 'constraint', 'interaction']),
      sourceFeatureId: text.nullable(), resolutionState: z.literal('valid'), resolvedAtProjectRevision: text,
      faceOwnerLocal: face,
    }).strict()).max(512),
  }).strict(),
  units: z.object({
    geometry: z.literal('mm'), force: z.literal('N'), stress: z.literal('MPa'), displacement: z.literal('mm'),
    density: z.literal('kg/m^3'), acceleration: z.literal('mm/s^2'), temperature: z.literal('degC').optional(),
    heatFlux: z.literal('W/m^2').optional(), heatFlow: z.literal('W').optional(), thermalConductivity: z.literal('W/(m*K)').optional(),
  }).strict(),
  materials: z.array(material).min(1).max(128),
  materialAssignments: z.array(z.object({ assignmentId: text, domainId: text, materialId: text, volumeRegionId: text }).strict()).min(1).max(128),
  loads: z.array(z.discriminatedUnion('type', [
    z.object({ id: text, name: text, type: z.literal('surface_force'), semanticReferenceIds: uniqueReferences, forceN: vector, coordinateSystem: z.literal('analysis') }).strict()
      .refine(value => Math.hypot(...(value.forceN as [number, number, number])) > 1e-14 && Math.hypot(...(value.forceN as [number, number, number])) <= 1e12),
    z.object({ id: text, name: text, type: z.literal('pressure'), semanticReferenceIds: uniqueReferences, pressureMPa: finite.refine(value => value !== 0 && Math.abs(value) <= 1e6) }).strict(),
    z.object({ id: text, name: text, type: z.literal('gravity'), accelerationMmPerS2: vector, coordinateSystem: z.literal('analysis') }).strict()
      .refine(value => Math.hypot(...(value.accelerationMmPerS2 as [number, number, number])) > 1e-9 && Math.hypot(...(value.accelerationMmPerS2 as [number, number, number])) <= 1e9),
    z.object({
      id: text, name: text, type: z.literal('remote_force'), connectorId: text,
      forceN: vector, momentNmm: vector, coordinateSystem: z.literal('analysis'),
    }).strict().refine(value => (Math.hypot(...(value.forceN as [number, number, number])) > 1e-14
      || Math.hypot(...(value.momentNmm as [number, number, number])) > 1e-14)
      && Math.hypot(...(value.forceN as [number, number, number])) <= 1e12
      && Math.hypot(...(value.momentNmm as [number, number, number])) <= 1e15),
    z.object({ id: text, name: text, type: z.literal('surface_heat_flux'), semanticReferenceIds: uniqueReferences, heatFluxWPerM2: positive.max(1e12) }).strict(),
  ])).max(64),
  constraints: z.array(z.discriminatedUnion('type', [
    z.object({ id: text, name: text, type: z.literal('fixed'), semanticReferenceIds: uniqueReferences }).strict(),
    z.object({
      id: text, name: text, type: z.literal('prescribed_displacement'), semanticReferenceIds: uniqueReferences,
      displacementMm: z.tuple([finite.min(-1e6).max(1e6).nullable(), finite.min(-1e6).max(1e6).nullable(), finite.min(-1e6).max(1e6).nullable()])
        .refine(value => value.some(component => component !== null)),
      coordinateSystem: z.literal('analysis'),
    }).strict(),
    z.object({
      id: text, name: text, type: z.literal('remote_displacement'), connectorId: text,
      translationMm: z.tuple([finite.min(-1e6).max(1e6).nullable(), finite.min(-1e6).max(1e6).nullable(), finite.min(-1e6).max(1e6).nullable()]),
      rotationRad: z.tuple([finite.min(-1).max(1).nullable(), finite.min(-1).max(1).nullable(), finite.min(-1).max(1).nullable()]),
      coordinateSystem: z.literal('analysis'),
    }).strict().refine(value => [...value.translationMm, ...value.rotationRad].some(component => component !== null)),
    z.object({ id: text, name: text, type: z.literal('prescribed_temperature'), semanticReferenceIds: uniqueReferences, temperatureC: finite.min(-273.15).max(1e6) }).strict(),
  ])).max(64),
  interactions: z.array(z.discriminatedUnion('type', [
    z.object({
      id: text, name: text, type: z.literal('bonded_tie'),
      secondaryReferenceIds: uniqueReferences, primaryReferenceIds: uniqueReferences,
      adjustment: z.literal('none'), positionToleranceMm: positive.max(1000),
    }).strict(),
    z.object({
      id: text, name: text, type: z.literal('shared_topology'),
      secondaryReferenceIds: uniqueReferences, primaryReferenceIds: uniqueReferences,
      adjustment: z.literal('none'), positionToleranceMm: positive.max(1000),
    }).strict(),
    z.object({
      id: text, name: text, type: z.literal('rigid_connector'), semanticReferenceIds: uniqueReferences,
      referencePointAnalysisMm: analysisPoint, coupling: z.literal('rigid_6dof'),
    }).strict(),
    z.object({
      id: text, name: text, type: z.literal('frictionless_contact'),
      secondaryReferenceIds: uniqueReferences, primaryReferenceIds: uniqueReferences,
      formulation: z.literal('node_to_surface_penalty'), sliding: z.enum(['small', 'finite']),
      normalBehavior: z.object({
        type: z.literal('linear_penalty'), stiffnessMPaPerMm: positive.max(1e12),
        tensionCutoffMPa: positive.max(1e6), searchDistanceFactor: positive.max(1),
      }).strict(),
      tangentialBehavior: z.object({ type: z.literal('frictionless') }).strict(),
      initialAdjustment: z.union([
        z.literal('none'),
        z.object({ type: z.literal('bounded_to_contact'), maximumAdjustmentMm: positive.max(10) }).strict(),
      ]),
    }).strict(),
    z.object({
      id: text, name: text, type: z.literal('frictional_contact'),
      secondaryReferenceIds: uniqueReferences, primaryReferenceIds: uniqueReferences,
      formulation: z.literal('node_to_surface_penalty'), sliding: z.enum(['small', 'finite']),
      normalBehavior: z.object({
        type: z.literal('linear_penalty'), stiffnessMPaPerMm: positive.max(1e12),
        tensionCutoffMPa: positive.max(1e6), searchDistanceFactor: positive.max(1),
      }).strict(),
      tangentialBehavior: z.object({
        type: z.literal('coulomb_penalty'), frictionCoefficient: positive.max(2), stickSlopeMPaPerMm: positive.max(1e12),
      }).strict(),
      initialAdjustment: z.union([
        z.literal('none'),
        z.object({ type: z.literal('bounded_to_contact'), maximumAdjustmentMm: positive.max(10) }).strict(),
      ]),
    }).strict(),
  ])).max(32),
  mesh: meshRequest,
  requestedResults: z.array(z.enum(['von_mises_stress', 'displacement', 'reaction_force', 'factor_of_safety', 'critical_regions',
    'natural_frequencies', 'mode_shapes', 'participation_factors', 'effective_modal_mass', 'buckling_load_factors', 'buckling_mode_shapes',
    'contact_status', 'contact_pressure', 'normal_gap', 'tangential_slip', 'contact_shear', 'contact_force',
    'load_displacement_history', 'increment_convergence', 'equivalent_plastic_strain', 'strain_energy_density', 'internal_energy',
    'temperature', 'heat_flux', 'reaction_heat_flow'])).min(1).max(12),
}).strict();

function unique(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function contactAdjustmentMode(value: NeutralContactInitialAdjustmentV2): 'none' | 'bounded_to_contact' {
  return value === 'none' ? 'none' : value.type;
}

function isRigidTransform(value: number[], tolerance = 1e-9): boolean {
  if (value.length !== 16 || value.some(component => !Number.isFinite(component))) return false;
  if (Math.abs(value[12]) > tolerance || Math.abs(value[13]) > tolerance || Math.abs(value[14]) > tolerance || Math.abs(value[15] - 1) > tolerance) return false;
  const rows = [[value[0], value[1], value[2]], [value[4], value[5], value[6]], [value[8], value[9], value[10]]];
  for (let row = 0; row < 3; row += 1) {
    for (let other = 0; other < 3; other += 1) {
      const dot = rows[row][0] * rows[other][0] + rows[row][1] * rows[other][1] + rows[row][2] * rows[other][2];
      if (Math.abs(dot - (row === other ? 1 : 0)) > tolerance) return false;
    }
  }
  const determinant =
    value[0] * (value[5] * value[10] - value[6] * value[9])
    - value[1] * (value[4] * value[10] - value[6] * value[8])
    + value[2] * (value[4] * value[9] - value[5] * value[8]);
  return Math.abs(determinant - 1) <= tolerance;
}

function transformPoint(matrix: number[], point: [number, number, number]): [number, number, number] {
  return [matrix[0] * point[0] + matrix[1] * point[1] + matrix[2] * point[2] + matrix[3], matrix[4] * point[0] + matrix[5] * point[1] + matrix[6] * point[2] + matrix[7], matrix[8] * point[0] + matrix[9] * point[1] + matrix[10] * point[2] + matrix[11]];
}

function transformDirection(matrix: number[], direction: [number, number, number]): [number, number, number] {
  const value: [number, number, number] = [matrix[0] * direction[0] + matrix[1] * direction[1] + matrix[2] * direction[2], matrix[4] * direction[0] + matrix[5] * direction[1] + matrix[6] * direction[2], matrix[8] * direction[0] + matrix[9] * direction[1] + matrix[10] * direction[2]];
  const length = Math.hypot(...value); return value.map(component => component / length) as [number, number, number];
}

function faceBoundsDistance(
  first: { min: [number, number, number]; max: [number, number, number] } | undefined,
  firstTransform: number[],
  second: { min: [number, number, number]; max: [number, number, number] } | undefined,
  secondTransform: number[],
): number {
  if (!first || !second) return Number.POSITIVE_INFINITY;
  const transformed = (box: { min: [number, number, number]; max: [number, number, number] }, matrix: number[]) => {
    const points = [0, 1].flatMap(x => [0, 1].flatMap(y => [0, 1].map(z => transformPoint(matrix, [box[x ? 'max' : 'min'][0], box[y ? 'max' : 'min'][1], box[z ? 'max' : 'min'][2]]))));
    return { min: [0, 1, 2].map(axis => Math.min(...points.map(point => point[axis]))), max: [0, 1, 2].map(axis => Math.max(...points.map(point => point[axis]))) };
  };
  const a = transformed(first, firstTransform); const b = transformed(second, secondTransform);
  return Math.hypot(...[0, 1, 2].map(axis => Math.max(0, a.min[axis] - b.max[axis], b.min[axis] - a.max[axis])));
}

function fail(code: string): never {
  throw new Error(code);
}

export type UnsealedNeutralSimulationRequestV2 = Omit<NeutralSimulationRequestV2, 'requestDigest' | 'model'> & {
  requestDigest?: string;
  model: Omit<NeutralSimulationRequestV2['model'], 'modelDigest' | 'domains'> & {
    modelDigest?: string;
    domains: Array<Omit<NeutralSimulationRequestV2['model']['domains'][number], 'domainDigest'> & { domainDigest?: string }>;
  };
};

export function sealNeutralSimulationRequestV2(unsigned: UnsealedNeutralSimulationRequestV2): NeutralSimulationRequestV2 {
  const modelDomains = unsigned.model.domains.map(domain => {
    const { domainDigest: _ignored, ...domainUnsigned } = domain;
    return { ...domainUnsigned, domainDigest: digest(domainUnsigned) };
  });
  const modelWithoutDigest = { ...unsigned.model, domains: modelDomains };
  delete modelWithoutDigest.modelDigest;
  const model = { ...modelWithoutDigest, modelDigest: digest(modelWithoutDigest) };
  const requestWithoutDigest = { ...unsigned, model };
  delete requestWithoutDigest.requestDigest;
  return { ...requestWithoutDigest, requestDigest: digest(requestWithoutDigest) } as NeutralSimulationRequestV2;
}

export function validateNeutralSimulationRequestV2(value: unknown, now = Date.now()): NeutralSimulationRequestV2 {
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) fail('BRIDGE_V2_REQUEST_INVALID');
  const request = parsed.data as NeutralSimulationRequestV2;
  const domains = request.model.domains;
  if (!unique(domains.map(domain => domain.domainId)) || !unique(domains.map(domain => domain.occurrenceId))) fail('BRIDGE_V2_DOMAIN_IDENTITY_INVALID');
  if (domains.some(domain => !isRigidTransform(domain.transformToAnalysis))) fail('BRIDGE_V2_TRANSFORM_INVALID');
  for (const domain of domains) {
    const { domainDigest, ...unsignedDomain } = domain;
    if (digest(unsignedDomain) !== domainDigest) fail('BRIDGE_V2_DOMAIN_DIGEST_INVALID');
    const size = domain.shape.boundingBoxOwnerLocalMm.size;
    if (size.some(component => component <= 0 || component > 1e6)) fail('BRIDGE_V2_DOMAIN_INVALID');
  }
  const { modelDigest, ...unsignedModel } = request.model;
  if (digest(unsignedModel) !== modelDigest) fail('BRIDGE_V2_MODEL_DIGEST_INVALID');
  const { requestDigest, ...unsignedRequest } = request;
  if (digest(unsignedRequest) !== requestDigest) fail('BRIDGE_V2_REQUEST_DIGEST_INVALID');
  if (Date.parse(request.expiresAt) <= now || Date.parse(request.expiresAt) > now + 21 * 60_000 || Date.parse(request.preparedAt) > now + 60_000) fail('BRIDGE_V2_REQUEST_EXPIRED');

  const materials = new Map(request.materials.map(entry => [entry.id, entry]));
  if (materials.size !== request.materials.length) fail('BRIDGE_V2_MATERIAL_INVALID');
  for (const entry of request.materials) if (entry.model === 'isotropic_elastic_plastic') {
    const curve = entry.plasticity?.curve ?? [];
    if (curve[0]?.plasticStrain !== 0 || curve[0]?.trueStressMPa !== entry.yieldStrengthMPa
      || curve.some((point, index) => index > 0
        && (point.plasticStrain <= curve[index - 1].plasticStrain || point.trueStressMPa <= curve[index - 1].trueStressMPa))) {
      fail('BRIDGE_V2_MATERIAL_INVALID');
    }
  }
  if (request.analysis.type !== 'nonlinear_static' && request.materials.some(entry => entry.model === 'isotropic_elastic_plastic')) fail('BRIDGE_V2_MATERIAL_INVALID');
  const assignments = request.materialAssignments;
  if (!unique(assignments.map(entry => entry.assignmentId)) || !unique(assignments.map(entry => entry.domainId)) || !unique(assignments.map(entry => entry.volumeRegionId))) fail('BRIDGE_V2_ASSIGNMENT_INVALID');
  if (assignments.length !== domains.length) fail('BRIDGE_V2_ASSIGNMENT_INVALID');
  const domainsById = new Map(domains.map(domain => [domain.domainId, domain]));
  for (const assignment of assignments) {
    if (!domainsById.has(assignment.domainId) || !materials.has(assignment.materialId)) fail('BRIDGE_V2_ASSIGNMENT_INVALID');
  }
  if (new Set(assignments.map(assignment => assignment.materialId)).size !== materials.size) fail('BRIDGE_V2_MATERIAL_INVALID');

  const referenceKeys = request.model.references.map(reference => `${reference.role}:${reference.semanticReferenceId}`);
  if (!unique(referenceKeys)) fail('BRIDGE_V2_REFERENCE_INVALID');
  const references = new Map(request.model.references.map(reference => [`${reference.role}:${reference.semanticReferenceId}`, reference]));
  for (const reference of request.model.references) {
    const domain = domainsById.get(reference.domainId);
    if (!domain || reference.ownerPartId !== domain.partId || reference.ownerBodyId !== domain.bodyId
      || reference.occurrenceId !== domain.occurrenceId || reference.resolvedAtProjectRevision !== request.model.projectRevision) fail('BRIDGE_V2_REFERENCE_INVALID');
  }
  const required = [
    ...request.loads.flatMap(load => 'semanticReferenceIds' in load ? load.semanticReferenceIds.map(id => [`load:${id}`, id] as const) : []),
    ...request.constraints.flatMap(constraint => 'semanticReferenceIds' in constraint ? constraint.semanticReferenceIds.map(id => [`constraint:${id}`, id] as const) : []),
    ...request.interactions.flatMap(interaction => (interaction.type === 'rigid_connector'
      ? interaction.semanticReferenceIds
      : [...interaction.secondaryReferenceIds, ...interaction.primaryReferenceIds]).map(id => [`interaction:${id}`, id] as const)),
  ];
  if (required.length !== references.size || required.some(([key]) => !references.has(key))) fail('BRIDGE_V2_REFERENCE_INVALID');
  const loaded = new Set(required.filter(([key]) => key.startsWith('load:')).map(([, id]) => id));
  if (required.some(([key, id]) => key.startsWith('constraint:') && loaded.has(id))) fail('BRIDGE_V2_REFERENCE_INVALID');
  for (const interaction of request.interactions) {
    if (interaction.type === 'rigid_connector') {
      const connectorDomains = new Set(interaction.semanticReferenceIds.map(id => references.get(`interaction:${id}`)?.domainId));
      if (connectorDomains.size !== 1 || connectorDomains.has(undefined)) fail('BRIDGE_V2_INTERACTION_INVALID');
      continue;
    }
    const secondaryDomains = new Set(interaction.secondaryReferenceIds.map(id => references.get(`interaction:${id}`)?.domainId));
    const primaryDomains = new Set(interaction.primaryReferenceIds.map(id => references.get(`interaction:${id}`)?.domainId));
    if (secondaryDomains.size !== 1 || primaryDomains.size !== 1 || [...secondaryDomains][0] === [...primaryDomains][0]
      || interaction.secondaryReferenceIds.some(id => interaction.primaryReferenceIds.includes(id))) fail('BRIDGE_V2_INTERACTION_INVALID');
    if (interaction.type === 'frictionless_contact' || interaction.type === 'frictional_contact') {
      const secondaryDomain = domainsById.get([...secondaryDomains][0]!); const primaryDomain = domainsById.get([...primaryDomains][0]!);
      if (!secondaryDomain || !primaryDomain) fail('BRIDGE_V2_CONTACT_GEOMETRY_INVALID');
      for (const referenceId of interaction.secondaryReferenceIds) {
        const secondary = references.get(`interaction:${referenceId}`)!; const secondaryDirection = secondary.faceOwnerLocal.outwardDirection;
        if (!secondaryDirection) fail('BRIDGE_V2_CONTACT_GEOMETRY_INVALID');
        const secondaryNormal = transformDirection(secondaryDomain.transformToAnalysis, secondaryDirection);
        const secondaryPoint = transformPoint(secondaryDomain.transformToAnalysis, secondary.faceOwnerLocal.centroidPartLocalMm);
        const candidates = interaction.primaryReferenceIds.map(primaryId => references.get(`interaction:${primaryId}`)!).filter(Boolean).map(primary => {
          const primaryDirection = primary.faceOwnerLocal.outwardDirection;
          if (!primaryDirection) fail('BRIDGE_V2_CONTACT_GEOMETRY_INVALID');
          const primaryNormal = transformDirection(primaryDomain.transformToAnalysis, primaryDirection);
          const primaryPoint = transformPoint(primaryDomain.transformToAnalysis, primary.faceOwnerLocal.centroidPartLocalMm);
          const delta = primaryPoint.map((value, axis) => value - secondaryPoint[axis]) as [number, number, number];
          const normalGap = delta[0] * secondaryNormal[0] + delta[1] * secondaryNormal[1] + delta[2] * secondaryNormal[2];
          const opposed = secondaryNormal[0] * primaryNormal[0] + secondaryNormal[1] * primaryNormal[1] + secondaryNormal[2] * primaryNormal[2];
          const tangentialOffset = Math.sqrt(Math.max(0, Math.hypot(...delta) ** 2 - normalGap ** 2));
          return {
            normalGap, opposed, tangentialOffset,
            boundsDistance: faceBoundsDistance(secondary.faceOwnerLocal.boundingBoxMm, secondaryDomain.transformToAnalysis, primary.faceOwnerLocal.boundingBoxMm, primaryDomain.transformToAnalysis),
            curvedAdjustment: secondary.faceOwnerLocal.geometryType !== 'plane' || primary.faceOwnerLocal.geometryType !== 'plane',
          };
        });
        const tolerance = interaction.normalBehavior.searchDistanceFactor * Math.sqrt(secondary.faceOwnerLocal.areaMm2);
        const adjustmentLimit = interaction.initialAdjustment === 'none' ? 0 : interaction.initialAdjustment.maximumAdjustmentMm;
        if (adjustmentLimit > tolerance
          || !candidates.some(candidate => candidate.opposed <= -.9
            && (interaction.initialAdjustment !== 'none' && candidate.curvedAdjustment
              ? candidate.boundsDistance <= adjustmentLimit + 1e-8
              : candidate.normalGap >= -(adjustmentLimit + 1e-8)
                && candidate.normalGap <= tolerance
                && (interaction.initialAdjustment === 'none' || Math.abs(candidate.normalGap) <= adjustmentLimit + 1e-8)
                && candidate.tangentialOffset <= Math.sqrt(secondary.faceOwnerLocal.areaMm2)))) fail('BRIDGE_V2_CONTACT_GEOMETRY_INVALID');
      }
    }
  }
  const connectors = new Map(request.interactions.filter(interaction => interaction.type === 'rigid_connector').map(interaction => [interaction.id, interaction]));
  const remoteLoads = request.loads.filter(load => load.type === 'remote_force');
  const remoteConstraints = request.constraints.filter(constraint => constraint.type === 'remote_displacement');
  if ([...remoteLoads, ...remoteConstraints].some(entry => !connectors.has(entry.connectorId))
    || !unique(remoteConstraints.map(entry => entry.connectorId))
    || remoteLoads.some(load => remoteConstraints.some(constraint => constraint.connectorId === load.connectorId))
    || [...connectors.keys()].some(connectorId => !remoteLoads.some(load => load.connectorId === connectorId)
      && !remoteConstraints.some(constraint => constraint.connectorId === connectorId))) fail('BRIDGE_V2_CONNECTOR_INVALID');
  const directReferenceIds = new Set([
    ...request.loads.flatMap(load => 'semanticReferenceIds' in load ? load.semanticReferenceIds : []),
    ...request.constraints.flatMap(constraint => 'semanticReferenceIds' in constraint ? constraint.semanticReferenceIds : []),
  ]);
  if ([...connectors.values()].some(connector => connector.semanticReferenceIds.some(id => directReferenceIds.has(id)))) fail('BRIDGE_V2_CONNECTOR_INVALID');
  const entryIds = [...request.loads, ...request.constraints, ...request.interactions].map(entry => entry.id);
  if (!unique(entryIds)) fail('BRIDGE_V2_REQUEST_INVALID');
  const hasThermalEntries = request.loads.some(load => load.type === 'surface_heat_flux')
    || request.constraints.some(constraint => constraint.type === 'prescribed_temperature');
  if (request.analysis.type === 'steady_thermal') {
    const expectedResults = ['heat_flux', 'reaction_heat_flow', 'temperature'];
    if (request.model.domains.length !== 1 || request.materials.length !== 1 || request.interactions.length
      || !request.loads.length || request.loads.some(load => load.type !== 'surface_heat_flux')
      || !request.constraints.length || request.constraints.some(constraint => constraint.type !== 'prescribed_temperature')
      || request.materials.some(entry => entry.model !== 'isotropic_linear_elastic' || !(entry.thermalConductivityWPerMK && entry.thermalConductivityWPerMK > 0))
      || request.units.temperature !== 'degC' || request.units.heatFlux !== 'W/m^2' || request.units.heatFlow !== 'W'
      || request.units.thermalConductivity !== 'W/(m*K)'
      || request.requestedResults.length !== expectedResults.length
      || [...request.requestedResults].sort().some((result, index) => result !== expectedResults[index])) {
      fail('BRIDGE_V2_THERMAL_REQUEST_INVALID');
    }
  } else if (hasThermalEntries) {
    fail('BRIDGE_V2_THERMAL_REQUEST_INVALID');
  } else if (request.analysis.type === 'modal') {
    const settings = request.analysis.settings;
    if (request.loads.length || request.materials.some(entry => entry.densityKgM3 === undefined)
      || (settings.minimumFrequencyHz !== null && settings.maximumFrequencyHz !== null
        && settings.maximumFrequencyHz <= settings.minimumFrequencyHz)
      || request.requestedResults.some(result => !['natural_frequencies', 'mode_shapes', 'participation_factors', 'effective_modal_mass'].includes(result))
      || !request.requestedResults.includes('natural_frequencies') || !request.requestedResults.includes('mode_shapes')
      || request.constraints.some(constraint => constraint.type === 'prescribed_displacement'
        ? constraint.displacementMm.some(component => component !== null && Math.abs(component) > 1e-14)
        : constraint.type === 'remote_displacement'
          && [...constraint.translationMm, ...constraint.rotationRad].some(component => component !== null && Math.abs(component) > 1e-14))) {
      fail('BRIDGE_V2_MODAL_REQUEST_INVALID');
    }
  } else if (request.analysis.type === 'linear_buckling') {
    const preloadIds = request.analysis.settings.preloadCase.loadIds;
    if (request.model.domains.length !== 1 || request.interactions.length || !request.loads.length || !request.constraints.length
      || request.loads.some(load => load.type !== 'surface_force') || request.constraints.some(constraint => constraint.type !== 'fixed')
      || preloadIds.length !== request.loads.length || preloadIds.some(loadId => !request.loads.some(load => load.id === loadId))
      || request.requestedResults.length !== 2 || !request.requestedResults.includes('buckling_load_factors') || !request.requestedResults.includes('buckling_mode_shapes')) {
      fail('BRIDGE_V2_BUCKLING_REQUEST_INVALID');
    }
  } else if (request.analysis.type === 'static_contact') {
    const settings = request.analysis.settings;
    const frictional = request.interactions.some(interaction => interaction.type === 'frictional_contact');
    const finiteSliding = request.interactions.some(interaction => interaction.type === 'frictionless_contact' || interaction.type === 'frictional_contact' ? interaction.sliding === 'finite' : false);
    const expectedResults = ['contact_force', 'contact_pressure', 'contact_status', ...(frictional ? ['contact_shear'] : []), 'displacement', 'normal_gap', 'reaction_force', 'tangential_slip', 'von_mises_stress'].sort();
    const hasNonzeroPrescribedDisplacement = request.constraints.some(constraint => constraint.type === 'prescribed_displacement'
      && constraint.displacementMm.some(component => component !== null && Math.abs(component) > 1e-14));
    if (request.model.domains.length !== 2 || (!request.loads.length && !hasNonzeroPrescribedDisplacement) || !request.constraints.length || !request.interactions.length
      || request.interactions.some(interaction => interaction.type !== 'frictionless_contact' && interaction.type !== 'frictional_contact')
      || new Set(request.interactions.map(interaction => interaction.type)).size !== 1
      || new Set(request.interactions.map(interaction => interaction.type === 'frictionless_contact' || interaction.type === 'frictional_contact' ? interaction.sliding : null)).size !== 1
      || request.analysis.assumptions[0] !== (finiteSliding ? 'finite_deformation' : 'small_displacement')
      || request.analysis.assumptions[1] !== (finiteSliding ? 'finite_strain' : 'small_strain')
      || request.analysis.assumptions[3] !== (frictional ? 'frictional_contact' : 'frictionless_contact')
      || settings.minimumIncrement > settings.initialIncrement || settings.initialIncrement > settings.maximumIncrement
      || request.requestedResults.length !== expectedResults.length
      || [...request.requestedResults].sort().some((result, index) => result !== expectedResults[index])) {
      fail('BRIDGE_V2_CONTACT_REQUEST_INVALID');
    }
  } else if (request.analysis.type === 'nonlinear_static') {
    const settings = request.analysis.settings;
    const loadIds = new Set(request.loads.map(load => load.id));
    const materialModels = new Set(request.materials.map(material => material.model));
    const plastic = materialModels.has('isotropic_elastic_plastic');
    const expectedResults = ['displacement', 'increment_convergence', 'load_displacement_history', 'reaction_force', 'von_mises_stress',
      ...(plastic ? ['equivalent_plastic_strain', 'strain_energy_density', 'internal_energy'] : [])].sort();
    if (!request.loads.length || !request.constraints.length || request.interactions.length
      || materialModels.size !== 1 || !materialModels.has(request.analysis.assumptions[3])
      || request.constraints.some(constraint => constraint.type !== 'fixed')
      || settings.minimumIncrement > settings.initialIncrement || settings.initialIncrement > settings.maximumIncrement
      || !unique(settings.steps.map(step => step.id))
      || settings.steps.some(step => !unique(step.loadAmplitudes.map(entry => entry.loadId))
        || entryListInvalid(step.loadAmplitudes, loadIds))
      || request.loads.some(load => !settings.steps.some(step => step.loadAmplitudes.some(entry => entry.loadId === load.id)))
      || request.requestedResults.length !== expectedResults.length
      || [...request.requestedResults].sort().some((result, index) => result !== expectedResults[index])) {
      fail('BRIDGE_V2_NONLINEAR_REQUEST_INVALID');
    }
  } else if (!request.constraints.length || !request.loads.length && !request.constraints.some(constraint => (constraint.type === 'prescribed_displacement'
    && constraint.displacementMm.some(component => component !== null && Math.abs(component) > 1e-14))
    || (constraint.type === 'remote_displacement' && [...constraint.translationMm, ...constraint.rotationRad]
      .some(component => component !== null && Math.abs(component) > 1e-14)))) fail('BRIDGE_V2_REQUEST_INVALID');
  const maximumSize = Math.max(...domains.flatMap(domain => domain.shape.boundingBoxOwnerLocalMm.size));
  if (request.mesh.globalSizeMm < maximumSize / 200
    || (request.mesh.minimumSizeMm !== undefined && request.mesh.minimumSizeMm < request.mesh.globalSizeMm / 20)) fail('BRIDGE_V2_MESH_BUDGET_INVALID');
  return request;
}

function entryListInvalid(entries: Array<{ loadId: string; points: Array<{ time: number; scaleFactor: number }> }>, loadIds: Set<string>): boolean {
  return entries.some(entry => !loadIds.has(entry.loadId)
    || entry.points[0].time !== 0 || entry.points.at(-1)?.time !== 1
    || entry.points.some((point, index, points) => index > 0 && point.time <= points[index - 1].time));
}

export type V2Admission = { accepted: true } | { accepted: false; code: 'PROVIDER_INTERFACE_VERSION_UNSUPPORTED' | 'PROVIDER_V2_CAPABILITY_UNSUPPORTED'; message: string };

export function admitV2SimulationRequest(request: NeutralSimulationRequestV2, capabilities: SimulationProviderCapabilities | SimulationProviderCapabilitiesV2): V2Admission {
  if (capabilities.interfaceVersion !== '2.0') return { accepted: false, code: 'PROVIDER_INTERFACE_VERSION_UNSUPPORTED', message: 'A version 2.0 simulation provider is required before geometry transfer.' };
  const profile = capabilities as SimulationProviderCapabilitiesV2;
  if (!Array.isArray(profile.analysisTypes) || !profile.study || !Array.isArray(profile.study.materialModels)
    || !Array.isArray(profile.study.loadTypes) || !Array.isArray(profile.study.constraintTypes)
    || !Array.isArray(profile.study.contactModes) || !Array.isArray(profile.study.interactionTypes)
    || !Number.isInteger(profile.study.maximumInteractions) || !Number.isInteger(profile.study.maximumReferencesPerInteractionSide)) {
    return { accepted: false, code: 'PROVIDER_V2_CAPABILITY_UNSUPPORTED', message: 'The provider does not exactly support this SIM-4A study envelope.' };
  }
  const referenceDomains = new Map(request.model.references.map(reference => [reference.semanticReferenceId, reference.domainId]));
  if (!profile.analysisTypes.includes(request.analysis.type) || !profile.normalizedResults || !profile.asynchronous || !profile.cancellation
    || !profile.fieldResults?.paginated || profile.fieldResults.maximumPageTriangles < 1 || profile.fieldResults.maximumPageTriangles > 512
    || profile.fieldResults.topology !== 'triangle_soup'
    || (request.analysis.type === 'linear_static' && (!profile.fieldResults.components.includes('displacement_magnitude') || !profile.fieldResults.components.includes('von_mises_stress')))
    || (request.analysis.type === 'modal' && (!profile.fieldResults.components.includes('mode_shape_magnitude') || !profile.study.modal
      || request.analysis.settings.requestedModeCount > profile.study.modal.maximumModes
      || !profile.study.modal.frequencyBounds || !profile.study.modal.massFormulations.includes(request.analysis.settings.massFormulation)
      || (!request.constraints.length && (profile.study.modal.constrainedOnly
        || !Number.isInteger(profile.study.modal.maximumFreeFreeDomains)
        || request.model.domains.length > profile.study.modal.maximumFreeFreeDomains))))
    || (request.analysis.type === 'linear_buckling' && (!profile.fieldResults.components.includes('buckling_mode_shape_magnitude') || !profile.study.buckling
      || request.analysis.settings.requestedModeCount > profile.study.buckling.maximumModes
      || request.model.domains.length > profile.study.buckling.maximumDomains || !profile.study.buckling.preloadCaseRequired
      || request.loads.some(load => !profile.study.buckling!.loadTypes.includes(load.type as 'surface_force'))
      || request.constraints.some(constraint => !profile.study.buckling!.constraintTypes.includes(constraint.type as 'fixed'))))
    || (request.analysis.type === 'static_contact' && (!profile.fieldResults.components.includes('contact_pressure') || !profile.fieldResults.components.includes('normal_gap')
      || !profile.fieldResults.components.includes('tangential_slip')
      || (request.interactions.some(interaction => interaction.type === 'frictional_contact') && !profile.fieldResults.components.includes('contact_shear'))
      || !profile.study.contact || request.model.domains.length > profile.study.contact.maximumDomains
      || request.interactions.length > profile.study.contact.maximumInteractions
      || request.interactions.some(interaction => interaction.type !== 'frictionless_contact' && interaction.type !== 'frictional_contact'
        || !profile.study.contact!.interactionTypes.includes(interaction.type)
        || !profile.study.contact!.formulations.includes(interaction.formulation)
        || !profile.study.contact!.sliding.includes(interaction.sliding)
        || !profile.study.contact!.normalBehaviors.includes(interaction.normalBehavior.type)
        || !profile.study.contact!.tangentialBehaviors.includes(interaction.tangentialBehavior.type)
        || !profile.study.contact!.initialAdjustments.includes(contactAdjustmentMode(interaction.initialAdjustment)))
      || !profile.study.contact.nonlinearIncrementReporting))
    || (request.analysis.type === 'nonlinear_static' && (!profile.fieldResults.components.includes('displacement_magnitude')
      || !profile.fieldResults.components.includes('von_mises_stress') || !profile.study.nonlinearStatic
      || request.model.domains.length > profile.study.nonlinearStatic.maximumDomains
      || request.analysis.settings.steps.length > profile.study.nonlinearStatic.maximumSteps
      || request.analysis.settings.steps.some(step => step.loadAmplitudes.some(entry => entry.points.length > profile.study.nonlinearStatic!.maximumAmplitudePoints))
      || !profile.study.nonlinearStatic.amplitudeModes?.includes('shared_shape_per_step')
      || request.analysis.settings.steps.some(step => !sharedAmplitudeShape(step.loadAmplitudes))
      || request.loads.some(load => !profile.study.nonlinearStatic!.loadTypes.includes(load.type))
      || request.constraints.some(constraint => !profile.study.nonlinearStatic!.constraintTypes.includes(constraint.type))
      || !profile.study.nonlinearStatic.geometricNonlinearity || !profile.study.nonlinearStatic.automaticIncrements
      || !profile.study.nonlinearStatic.incrementHistory || !profile.study.nonlinearStatic.loadDisplacementHistory
      || request.materials.some(material => !profile.study.nonlinearStatic!.materialModels.includes(material.model))
      || (request.materials.some(material => material.model === 'isotropic_elastic_plastic')
        && (!profile.study.nonlinearStatic.materialNonlinearity
          || !profile.study.nonlinearStatic.hardeningModels.includes('isotropic')
          || !profile.study.nonlinearStatic.plasticStrainResults || !profile.study.nonlinearStatic.energyResults
          || !profile.fieldResults.components.includes('equivalent_plastic_strain')
          || !profile.fieldResults.components.includes('strain_energy_density')))))
    || (request.analysis.type === 'steady_thermal' && (!profile.study.steadyThermal
      || request.model.domains.length > profile.study.steadyThermal.maximumDomains
      || profile.study.steadyThermal.materialModel !== 'constant_isotropic_conductivity'
      || request.loads.some(load => load.type !== 'surface_heat_flux' || !profile.study.steadyThermal!.loadTypes.includes(load.type))
      || request.constraints.some(constraint => constraint.type !== 'prescribed_temperature' || !profile.study.steadyThermal!.constraintTypes.includes(constraint.type))
      || profile.study.steadyThermal.temperatureProfile !== 'bounded_samples'
      || profile.study.steadyThermal.maximumTemperatureSamples < 2
      || !profile.study.steadyThermal.heatBalance))
    || !profile.study.multiDomain || !profile.study.perDomainMaterials || !profile.study.rigidOccurrenceTransforms
    || request.model.domains.length > profile.study.maximumDomains
    || request.model.domains.length > profile.study.maximumOccurrences
    || request.model.domains.length > profile.study.maximumBodies
    || new Set(request.model.domains.map(domain => domain.partId)).size > profile.study.maximumParts
    || request.materials.length > profile.study.maximumMaterials
    || request.materials.some(material => !profile.study.materialModels.includes(material.model))
    || request.model.references.length > profile.study.maximumReferenceBindings
    || request.loads.length > profile.study.maximumLoads
    || request.loads.some(load => !profile.study.loadTypes.includes(load.type)
      || ('semanticReferenceIds' in load && load.semanticReferenceIds.length > profile.study.maximumReferencesPerLoad))
    || request.constraints.length > profile.study.maximumConstraints
    || request.constraints.some(constraint => !profile.study.constraintTypes.includes(constraint.type)
      || ('semanticReferenceIds' in constraint && constraint.semanticReferenceIds.length > profile.study.maximumReferencesPerConstraint))
    || !profile.study.contactModes.includes('none')
    || request.constraints.some(constraint => 'semanticReferenceIds' in constraint
      && new Set(constraint.semanticReferenceIds.map(referenceId => referenceDomains.get(referenceId))).size !== 1)
    || request.interactions.length > profile.study.maximumInteractions
    || request.interactions.some(interaction => !profile.study.interactionTypes.includes(interaction.type)
      || (interaction.type === 'rigid_connector'
        ? interaction.semanticReferenceIds.length > profile.study.maximumReferencesPerInteractionSide
        : interaction.primaryReferenceIds.length > profile.study.maximumReferencesPerInteractionSide
          || interaction.secondaryReferenceIds.length > profile.study.maximumReferencesPerInteractionSide))) {
    return { accepted: false, code: 'PROVIDER_V2_CAPABILITY_UNSUPPORTED', message: 'The provider does not exactly support this SIM-4A study envelope.' };
  }
  return { accepted: true };
}

function sharedAmplitudeShape(entries: Array<{ points: Array<{ time: number; scaleFactor: number }> }>): boolean {
  const first = entries[0]?.points;
  return !!first && entries.every(entry => entry.points.length === first.length
    && entry.points.every((point, index) => point.time === first[index].time && point.scaleFactor === first[index].scaleFactor));
}

const femSchema = z.object({
  schema: z.literal('tunacad-neutral-fem-model/2.0'), modelId: text, requestDigest: hash, projectRevision: text, modelDigest: hash,
  coordinateSpace: z.literal('frozen_analysis'), units: z.literal('mm'),
  element: z.object({ family: z.literal('tetrahedral'), geometryOrder: z.union([z.literal(1), z.literal(2)]), solutionOrder: z.literal(2) }).strict(),
  nodes: z.array(vector).min(4).max(2_000_000),
  volumeElements: z.object({
    connectivity: z.array(z.array(z.number().int().nonnegative()).min(4).max(10)).min(1).max(1_000_000),
    domainIds: z.array(text), materialIds: z.array(text), volumeRegionIds: z.array(text),
  }).strict(),
  boundaryFacets: z.object({
    connectivity: z.array(z.array(z.number().int().nonnegative()).min(3).max(6)).max(4_000_000),
    domainIds: z.array(text), regionIds: z.array(text),
  }).strict(),
  domainRegions: z.array(z.object({
    domainId: text, partId: text, bodyId: text, occurrenceId: text, domainDigest: hash, geometryDigest: hash,
    materialId: text, volumeRegionId: text, transformToAnalysis: matrix,
    elementIndices: z.array(z.number().int().nonnegative()).min(1), nodeIndices: z.array(z.number().int().nonnegative()).min(4),
  }).strict()).min(1).max(128),
  boundaryRegions: z.array(z.object({
    regionId: text, domainId: text, semanticReferenceIds: z.array(text).min(1), sourceFeatureIds: z.array(text),
    facetIndices: z.array(z.number().int().nonnegative()).min(1), matchedCadFaceOwnerLocal: face,
    match: z.object({ state: z.literal('verified'), method: z.enum(['geometric_signature', 'label_and_geometric_signature']), candidateCount: z.literal(1), centroidToleranceMm: positive, areaRelativeTolerance: positive }).strict(),
  }).strict()),
  quality: z.object({
    metric: z.literal('mean_ratio'), minimum: finite.min(0).max(1), average: finite.min(0).max(1), invalidElementCount: z.literal(0),
    nodeCount: z.number().int().positive(), elementCount: z.number().int().positive(), boundaryFacetCount: z.number().int().nonnegative(),
    cadVolumeMm3: positive, meshVolumeMm3: positive, volumeRelativeError: nonNegative,
    perDomain: z.array(z.object({
      domainId: text, nodeCount: z.number().int().positive(), elementCount: z.number().int().positive(), cadVolumeMm3: positive,
      meshVolumeMm3: positive, volumeRelativeError: nonNegative, minimum: finite.min(0).max(1), average: finite.min(0).max(1), invalidElementCount: z.literal(0),
    }).strict()).min(1),
  }).strict(),
  provenance: z.object({
    meshProviderInterfaceVersion: z.literal('2.0'), adapterId: text, adapterVersion: text, engine: text, engineVersion: text,
    optionsDigest: hash, inputGeometryDigest: hash, generatedAt: z.iso.datetime(),
  }).strict(),
}).strict();

export function validateNeutralFemModelV2(value: unknown, request: NeutralSimulationRequestV2): NeutralFemModelV2 {
  const parsed = femSchema.safeParse(value);
  if (!parsed.success) fail('BRIDGE_V2_FEM_MODEL_INVALID');
  const model = parsed.data as NeutralFemModelV2;
  if (model.requestDigest !== request.requestDigest || model.projectRevision !== request.model.projectRevision || model.modelDigest !== request.model.modelDigest) fail('BRIDGE_V2_FEM_IDENTITY_INVALID');
  const elementCount = model.volumeElements.connectivity.length;
  const facetCount = model.boundaryFacets.connectivity.length;
  if (model.nodes.length > request.mesh.maximumNodes || elementCount > request.mesh.maximumElements) fail('BRIDGE_V2_FEM_BUDGET_EXCEEDED');
  if (model.volumeElements.domainIds.length !== elementCount || model.volumeElements.materialIds.length !== elementCount
    || model.volumeElements.volumeRegionIds.length !== elementCount || model.boundaryFacets.domainIds.length !== facetCount
    || model.boundaryFacets.regionIds.length !== facetCount) fail('BRIDGE_V2_FEM_MODEL_INVALID');
  const expectedConnectivity = model.element.geometryOrder === 2 ? 10 : 4;
  if (model.volumeElements.connectivity.some(entry => entry.length !== expectedConnectivity || !unique(entry.map(String)) || entry.some(index => index >= model.nodes.length))
    || model.boundaryFacets.connectivity.some(entry => entry.length !== (model.element.geometryOrder === 2 ? 6 : 3) || !unique(entry.map(String)) || entry.some(index => index >= model.nodes.length))) fail('BRIDGE_V2_FEM_CONNECTIVITY_INVALID');
  if (model.quality.nodeCount !== model.nodes.length || model.quality.elementCount !== elementCount || model.quality.boundaryFacetCount !== facetCount) fail('BRIDGE_V2_FEM_QUALITY_INVALID');

  const assignments = new Map(request.materialAssignments.map(entry => [entry.domainId, entry]));
  const domains = new Map(request.model.domains.map(entry => [entry.domainId, entry]));
  if (model.domainRegions.length !== domains.size || model.quality.perDomain.length !== domains.size
    || !unique(model.domainRegions.map(entry => entry.domainId)) || !unique(model.quality.perDomain.map(entry => entry.domainId))) fail('BRIDGE_V2_FEM_DOMAIN_MAPPING_INVALID');
  const claimedElements: number[] = [];
  for (const region of model.domainRegions) {
    const domain = domains.get(region.domainId);
    const assignment = assignments.get(region.domainId);
    if (!domain || !assignment || region.partId !== domain.partId || region.bodyId !== domain.bodyId || region.occurrenceId !== domain.occurrenceId
      || region.domainDigest !== domain.domainDigest || region.geometryDigest !== domain.geometryDigest || region.materialId !== assignment.materialId
      || region.volumeRegionId !== assignment.volumeRegionId || region.transformToAnalysis.some((component, index) => component !== domain.transformToAnalysis[index])
      || !isRigidTransform(region.transformToAnalysis) || !unique(region.elementIndices.map(String)) || !unique(region.nodeIndices.map(String))) fail('BRIDGE_V2_FEM_DOMAIN_MAPPING_INVALID');
    if (region.elementIndices.some(index => index >= elementCount || model.volumeElements.domainIds[index] !== region.domainId
      || model.volumeElements.materialIds[index] !== region.materialId || model.volumeElements.volumeRegionIds[index] !== region.volumeRegionId)
      || region.nodeIndices.some(index => index >= model.nodes.length)) fail('BRIDGE_V2_FEM_DOMAIN_MAPPING_INVALID');
    const connectedNodes = new Set(region.elementIndices.flatMap(index => model.volumeElements.connectivity[index]));
    if (connectedNodes.size !== region.nodeIndices.length || region.nodeIndices.some(index => !connectedNodes.has(index))) fail('BRIDGE_V2_FEM_DOMAIN_MAPPING_INVALID');
    claimedElements.push(...region.elementIndices);
  }
  if (claimedElements.length !== elementCount || !unique(claimedElements.map(String)) || claimedElements.some((index, expected) => [...claimedElements].sort((a, b) => a - b)[expected] !== expected)) fail('BRIDGE_V2_FEM_DOMAIN_MAPPING_INVALID');
  for (let index = 0; index < elementCount; index += 1) if (!domains.has(model.volumeElements.domainIds[index])) fail('BRIDGE_V2_FEM_DOMAIN_MAPPING_INVALID');
  for (const region of model.boundaryRegions) {
    const domainRegion = model.domainRegions.find(entry => entry.domainId === region.domainId);
    const domainNodes = new Set(domainRegion?.nodeIndices ?? []);
    if (!domainRegion || region.facetIndices.some(index => index >= facetCount || model.boundaryFacets.domainIds[index] !== region.domainId
      || model.boundaryFacets.regionIds[index] !== region.regionId || model.boundaryFacets.connectivity[index].some(node => !domainNodes.has(node)))) fail('BRIDGE_V2_FEM_BOUNDARY_MAPPING_INVALID');
  }
  const requestedBoundaryKeys = request.model.references.map(reference => `${reference.domainId}:${reference.semanticReferenceId}`);
  const mappedBoundaryKeys = model.boundaryRegions.flatMap(region => region.semanticReferenceIds.map(referenceId => `${region.domainId}:${referenceId}`));
  if (requestedBoundaryKeys.length !== mappedBoundaryKeys.length || !unique(mappedBoundaryKeys)
    || requestedBoundaryKeys.some(key => !mappedBoundaryKeys.includes(key))) fail('BRIDGE_V2_FEM_BOUNDARY_MAPPING_INVALID');
  for (const quality of model.quality.perDomain) {
    const region = model.domainRegions.find(entry => entry.domainId === quality.domainId);
    const domain = domains.get(quality.domainId);
    if (!region || !domain || quality.elementCount !== region.elementIndices.length || quality.nodeCount !== region.nodeIndices.length
      || quality.cadVolumeMm3 !== domain.shape.volumeMm3) fail('BRIDGE_V2_FEM_QUALITY_INVALID');
  }
  return model;
}

export function admitV2MeshRequest(capabilities: MeshProviderCapabilities | MeshProviderCapabilitiesV2): V2Admission {
  if (capabilities.interfaceVersion !== '2.0') return { accepted: false, code: 'PROVIDER_INTERFACE_VERSION_UNSUPPORTED', message: 'A version 2.0 mesh provider is required before geometry transfer.' };
  const profile = capabilities as MeshProviderCapabilitiesV2;
  if (!profile.multiDomain || !profile.rigidOccurrenceTransforms || !profile.domainRegionMapping
    || !Array.isArray(profile.interactionTypes)) {
    return { accepted: false, code: 'PROVIDER_V2_CAPABILITY_UNSUPPORTED', message: 'The mesh provider cannot preserve SIM-4A domain ownership.' };
  }
  return { accepted: true };
}

const resultMetrics = z.object({
  maximumVonMisesStressMPa: nonNegative.nullable(), maximumDisplacementMm: nonNegative.nullable(), minimumFactorOfSafety: nonNegative.nullable(),
}).strict();
const modalSix = z.tuple([finite, finite, finite, finite, finite, finite]);
const modalResult = z.object({
  massFormulation: z.literal('consistent'), solverNormalization: z.literal('mass'),
  visualizationNormalization: z.literal('maximum_vector_magnitude_1'), requestedModeCount: z.number().int().min(1).max(24),
  modes: z.array(z.object({
    modeNumber: z.number().int().positive(), eigenvalueRad2PerS2: nonNegative, angularFrequencyRadPerS: nonNegative,
    frequencyHz: nonNegative, imaginaryAngularFrequencyRadPerS: nonNegative,
    participationFactors: modalSix, effectiveModalMass: modalSix, fieldDatasetIds: z.array(text).min(1).max(128),
  }).strict()).min(1).max(24),
  totalEffectiveModalMass: modalSix, totalEffectiveMass: modalSix,
  effectiveMassCoverage: z.tuple([nonNegative, nonNegative, nonNegative, nonNegative, nonNegative, nonNegative]),
  rigidBodyModeDiagnostics: z.object({
    thresholdHz: nonNegative, expectedModeCount: z.union([z.literal(0), z.literal(6)]),
    detectedModeCount: z.number().int().min(0).max(6), modeNumbers: z.array(z.number().int().positive()).max(6),
    status: z.enum(['complete', 'incomplete']),
  }).strict(),
}).strict();
const bucklingResult = z.object({
  preloadCaseId: text, requestedModeCount: z.number().int().min(1).max(12), solverNormalization: z.literal('eigenvector'),
  visualizationNormalization: z.literal('maximum_vector_magnitude_1'), prediction: z.literal('linear_eigenvalue_not_nonlinear_collapse'),
  modes: z.array(z.object({ modeNumber: z.number().int().positive(), eigenvalueLoadFactor: positive, fieldDatasetIds: z.array(text).min(1).max(128) }).strict()).min(1).max(12),
}).strict();
const contactResult = z.object({
  formulation: z.literal('node_to_surface_penalty'), sliding: z.enum(['small', 'finite']),
  interfaces: z.array(z.object({
    interactionId: text, secondaryDomainId: text, primaryDomainId: text, status: z.enum(['active', 'open_or_touching']),
    maximumPressureMPa: nonNegative, minimumNormalGapMm: finite, maximumPenetrationMm: nonNegative, maximumTangentialSlipMm: nonNegative,
    maximumShearMPa: nonNegative.optional(), forceOnSecondaryN: vector, pressureDatasetId: text, normalGapDatasetId: text,
    tangentialSlipDatasetId: text.optional(), contactShearDatasetId: text.optional(),
  }).strict()).min(1).max(32),
  increments: z.array(z.object({
    increment: z.number().int().positive(), attempt: z.number().int().positive(), iterations: z.number().int().positive(),
    stepTime: nonNegative.max(1), incrementSize: positive.max(1),
  }).strict()).min(1).max(1000),
}).strict();
const nonlinearIncrement = z.object({
  increment: z.number().int().positive(), attempt: z.number().int().positive(), iterations: z.number().int().positive(),
  stepTime: nonNegative, incrementSize: positive,
}).strict();
const nonlinearMaterialState = z.object({
  maximumEquivalentPlasticStrain: nonNegative,
  maximumEnergyDensityMPa: nonNegative,
  totalInternalEnergyNmm: nonNegative,
  yieldedElementCount: z.number().int().nonnegative(),
}).strict();
const nonlinearResult = z.object({
  formulation: z.enum(['finite_deformation_elastic', 'finite_deformation_elastic_plastic']),
  steps: z.array(z.object({
    stepIndex: z.number().int().positive(), stepId: text, converged: z.literal(true),
    increments: z.array(nonlinearIncrement).min(1).max(1000),
  }).strict()).min(1).max(16),
  history: z.array(z.object({
    stepIndex: z.number().int().positive(), stepId: text, increment: z.number().int().positive(), attempt: z.number().int().positive(),
    iterations: z.number().int().positive(), stepTime: nonNegative, totalTime: nonNegative, incrementSize: positive,
    loadScaleFactors: z.array(z.object({ loadId: text, scaleFactor: finite }).strict()).min(1).max(64),
    maximumDisplacementMm: nonNegative, resultantReactionForceN: vector, materialState: nonlinearMaterialState.nullable(),
  }).strict()).min(1).max(16000),
  materialState: nonlinearMaterialState.nullable(),
}).strict();
const steadyThermalResult = z.object({
  formulation: z.literal('steady_state_isotropic_conduction'),
  minimumTemperatureC: finite.min(-273.15).max(1e6), maximumTemperatureC: finite.min(-273.15).max(1e6),
  maximumTemperatureGradientCPerM: nonNegative.max(1e12), totalAppliedHeatW: positive.max(1e15),
  totalReactionHeatW: finite.min(-1e15).max(0), heatBalanceResidualW: nonNegative.max(1e15),
  temperatureSamples: z.array(z.object({ positionAnalysisMm: analysisPoint, temperatureC: finite.min(-273.15).max(1e6) }).strict()).min(2).max(256),
}).strict();
const resultSchema = z.object({
  schema: z.literal('tunacad-neutral-simulation-result/2.0'), studyId: text, jobId: text, requestDigest: hash,
  projectRevision: text, modelDigest: hash, analysisType: z.enum(['linear_static', 'modal', 'linear_buckling', 'static_contact', 'nonlinear_static', 'steady_thermal']), status: z.enum(['succeeded', 'failed', 'cancelled']),
  authority: z.enum(['engineering', 'architecture_mock']), metrics: resultMetrics,
  perDomain: z.array(z.object({ domainId: text, metrics: resultMetrics, fieldDatasetIds: z.array(text).max(512) }).strict()).min(1).max(128),
  reactions: z.array(z.object({
    constraintId: text, forceN: vector, momentNmm: vector.nullable(), connectorId: text.nullable(),
    referencePointAnalysisMm: analysisPoint.nullable(), semanticReferenceIds: z.array(text), domainId: text,
  }).strict()).max(512),
  criticalRegions: z.array(z.object({
    id: text, kind: z.enum(['stress', 'displacement', 'constraint', 'mesh', 'provider']), severity: z.enum(['info', 'warning', 'critical']),
    value: finite.nullable(), unit: z.enum(['MPa', 'mm', 'N']).nullable(), positionAnalysisMm: vector.nullable(), semanticReferenceIds: z.array(text),
    featureIds: z.array(text), description: text, inspect: z.array(text), mapping: z.enum(['durable_reference', 'analysis_location', 'unmapped']), domainId: text,
  }).strict()).max(10000),
  failedConstraints: z.array(z.object({ constraintId: text, code: text, message: text }).strict()),
  warnings: z.array(z.object({ code: text, message: text, severity: z.enum(['info', 'warning', 'critical']) }).strict()),
  convergence: z.object({ status: z.enum(['converged', 'not_converged', 'not_evaluated']), iterations: z.number().int().nonnegative().nullable(), residual: nonNegative.nullable(), providerDeclared: z.boolean() }).strict(),
  suggestedEngineeringIssues: z.array(text),
  modal: modalResult.optional(),
  buckling: bucklingResult.optional(),
  contact: contactResult.optional(),
  nonlinear: nonlinearResult.optional(),
  thermal: steadyThermalResult.optional(),
  provenance: z.object({
    providerInterfaceVersion: z.literal('2.0'), adapterId: text, adapterVersion: text, providerRunId: text,
    submittedAt: z.iso.datetime(), completedAt: z.iso.datetime(), normalizedAt: z.iso.datetime(),
    mesh: z.object({ meshId: text, adapterId: text, adapterVersion: text, engine: text, engineVersion: text,
      nodeCount: z.number().int().nonnegative(), elementCount: z.number().int().nonnegative(), boundaryFacetCount: z.number().int().nonnegative(),
      minimumQuality: finite.min(0).max(1), averageQuality: finite.min(0).max(1), volumeRelativeError: nonNegative }).strict().optional(),
  }).strict(),
  review: z.object({ engineerReviewRequired: z.literal(true), engineeringUsePermitted: z.boolean(), disclaimer: text }).strict(),
  mutation: z.object({ occurred: z.literal(false), projectRevisionBefore: text, projectRevisionAfter: text }).strict(),
}).strict();

export function validateNeutralSimulationResultV2(value: unknown, request: NeutralSimulationRequestV2): NeutralSimulationResultV2 {
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success) fail('BRIDGE_V2_RESULT_INVALID');
  const result = parsed.data as NeutralSimulationResultV2;
  if (result.studyId !== request.studyId || result.requestDigest !== request.requestDigest || result.projectRevision !== request.model.projectRevision
    || result.modelDigest !== request.model.modelDigest || result.mutation.projectRevisionBefore !== request.model.projectRevision
    || result.mutation.projectRevisionAfter !== request.model.projectRevision) fail('BRIDGE_V2_RESULT_IDENTITY_INVALID');
  const domainIds = request.model.domains.map(domain => domain.domainId);
  if (result.perDomain.length !== domainIds.length || !unique(result.perDomain.map(domain => domain.domainId))
    || result.perDomain.some(domain => !domainIds.includes(domain.domainId))) fail('BRIDGE_V2_RESULT_DOMAIN_MAPPING_INVALID');
  const datasetIds = result.perDomain.flatMap(domain => domain.fieldDatasetIds);
  if (!unique(datasetIds) || result.reactions.some(reaction => !domainIds.includes(reaction.domainId))
    || result.criticalRegions.some(region => !domainIds.includes(region.domainId))) fail('BRIDGE_V2_RESULT_DOMAIN_MAPPING_INVALID');
  if (result.analysisType !== request.analysis.type) fail('BRIDGE_V2_RESULT_IDENTITY_INVALID');
  if (request.analysis.type === 'steady_thermal') {
    if (result.analysisType !== 'steady_thermal' || !('thermal' in result) || !result.thermal
      || ('modal' in result && result.modal !== undefined) || ('buckling' in result && result.buckling !== undefined)
      || ('contact' in result && result.contact !== undefined) || ('nonlinear' in result && result.nonlinear !== undefined)
      || result.reactions.length || result.criticalRegions.length || datasetIds.length
      || Object.values(result.metrics).some(value => value !== null)
      || result.perDomain.some(domain => Object.values(domain.metrics).some(value => value !== null))
      || result.thermal.minimumTemperatureC > result.thermal.maximumTemperatureC
      || result.thermal.temperatureSamples.some(sample => sample.temperatureC < result.thermal.minimumTemperatureC - 1e-9
        || sample.temperatureC > result.thermal.maximumTemperatureC + 1e-9)
      || Math.abs(Math.abs(result.thermal.totalAppliedHeatW + result.thermal.totalReactionHeatW) - result.thermal.heatBalanceResidualW) > 1e-9
      || result.thermal.heatBalanceResidualW > Math.max(1e-9, result.thermal.totalAppliedHeatW * 1e-6)
      || !result.warnings.some(warning => warning.code === 'SIMULATION_STEADY_THERMAL_POC')) fail('BRIDGE_V2_THERMAL_RESULT_INVALID');
    if (result.review.engineeringUsePermitted) fail('BRIDGE_V2_RESULT_AUTHORITY_INVALID');
    return result;
  }
  if (request.analysis.type === 'modal') {
    if (result.analysisType !== 'modal' || !('modal' in result) || !result.modal
      || result.modal.requestedModeCount !== request.analysis.settings.requestedModeCount
      || result.reactions.length || result.criticalRegions.length
      || Object.values(result.metrics).some(value => value !== null)
      || result.perDomain.some(domain => Object.values(domain.metrics).some(value => value !== null))
      || datasetIds.length !== result.modal.modes.length * domainIds.length
      || !unique(result.modal.modes.map(mode => mode.modeNumber))
      || result.modal.modes.some((mode, index) => mode.modeNumber > request.analysis.settings.requestedModeCount
        || (index > 0 && mode.modeNumber <= result.modal.modes[index - 1].modeNumber) || mode.frequencyHz < 0
        || mode.fieldDatasetIds.length !== domainIds.length || mode.fieldDatasetIds.some(id => !datasetIds.includes(id))
        || result.perDomain.some(domain => domain.fieldDatasetIds.filter(id => mode.fieldDatasetIds.includes(id)).length !== 1))
      || !unique(result.modal.modes.flatMap(mode => mode.fieldDatasetIds))) fail('BRIDGE_V2_MODAL_RESULT_INVALID');
    const diagnostics = result.modal.rigidBodyModeDiagnostics;
    const expectedRigidModes = request.constraints.length ? 0 : 6;
    if (diagnostics.expectedModeCount !== expectedRigidModes || diagnostics.detectedModeCount !== diagnostics.modeNumbers.length
      || diagnostics.status !== (diagnostics.detectedModeCount === expectedRigidModes ? 'complete' : 'incomplete')
      || !unique(diagnostics.modeNumbers) || diagnostics.modeNumbers.some(modeNumber => result.modal.modes.some(mode => mode.modeNumber === modeNumber))
      || (!request.constraints.length && (diagnostics.status !== 'complete' || diagnostics.modeNumbers.some((modeNumber, index) => modeNumber !== index + 1)
        || result.modal.modes.some(mode => mode.modeNumber <= 6)))) fail('BRIDGE_V2_MODAL_RESULT_INVALID');
    if (result.review.engineeringUsePermitted) fail('BRIDGE_V2_RESULT_AUTHORITY_INVALID');
    return result;
  }
  if (request.analysis.type === 'linear_buckling') {
    if (result.analysisType !== 'linear_buckling' || !('buckling' in result) || !result.buckling || ('modal' in result && result.modal !== undefined)
      || result.buckling.preloadCaseId !== request.analysis.settings.preloadCase.id
      || result.buckling.requestedModeCount !== request.analysis.settings.requestedModeCount || result.reactions.length || result.criticalRegions.length
      || Object.values(result.metrics).some(value => value !== null) || result.perDomain.some(domain => Object.values(domain.metrics).some(value => value !== null))
      || datasetIds.length !== result.buckling.modes.length * domainIds.length || !unique(result.buckling.modes.map(mode => mode.modeNumber))
      || result.buckling.modes.some((mode, index) => mode.modeNumber !== index + 1 || mode.modeNumber > request.analysis.settings.requestedModeCount
        || mode.fieldDatasetIds.length !== domainIds.length || mode.fieldDatasetIds.some(id => !datasetIds.includes(id)))
      || !result.warnings.some(warning => warning.code === 'SIMULATION_LINEAR_BUCKLING_LIMITATION')) fail('BRIDGE_V2_BUCKLING_RESULT_INVALID');
    if (result.review.engineeringUsePermitted) fail('BRIDGE_V2_RESULT_AUTHORITY_INVALID');
    return result;
  }
  if (request.analysis.type === 'nonlinear_static') {
    const plastic = request.materials.some(material => material.model === 'isotropic_elastic_plastic');
    if (result.analysisType !== 'nonlinear_static' || !('nonlinear' in result) || !result.nonlinear
      || ('modal' in result && result.modal !== undefined) || ('buckling' in result && result.buckling !== undefined)
      || ('contact' in result && result.contact !== undefined)
      || result.nonlinear.formulation !== (plastic ? 'finite_deformation_elastic_plastic' : 'finite_deformation_elastic')
      || result.nonlinear.steps.length !== request.analysis.settings.steps.length
      || result.nonlinear.steps.some((step, index) => {
        const requested = request.analysis.settings.steps[index];
        return step.stepIndex !== index + 1 || step.stepId !== requested.id || step.increments.length > request.analysis.settings.maximumIncrements
          || Math.abs((step.increments.at(-1)?.stepTime ?? -1) - requested.duration) > 1e-8
          || step.increments.some((entry, entryIndex, entries) => entry.iterations > request.analysis.settings.maximumIterations
            || entry.attempt > request.analysis.settings.maximumCutbacks + 1
            || entryIndex > 0 && (entry.increment <= entries[entryIndex - 1].increment || entry.stepTime <= entries[entryIndex - 1].stepTime));
      })
      || result.nonlinear.history.length !== result.nonlinear.steps.reduce((sum, step) => sum + step.increments.length, 0)
      || result.nonlinear.history.some((point, index, history) => {
        const step = request.analysis.settings.steps[point.stepIndex - 1];
        const increment = result.nonlinear.steps[point.stepIndex - 1]?.increments.find(entry => entry.increment === point.increment);
        const expectedLoads = step?.loadAmplitudes ?? [];
        return !step || point.stepId !== step.id || !increment || point.attempt !== increment.attempt || point.iterations !== increment.iterations
          || Math.abs(point.stepTime - increment.stepTime) > 1e-10 || Math.abs(point.incrementSize - increment.incrementSize) > 1e-10
          || point.loadScaleFactors.length !== expectedLoads.length || !unique(point.loadScaleFactors.map(entry => entry.loadId))
          || point.loadScaleFactors.some(entry => Math.abs(entry.scaleFactor - interpolateAmplitude(expectedLoads.find(candidate => candidate.loadId === entry.loadId)?.points ?? [], point.stepTime / step.duration)) > 1e-8)
          || index > 0 && point.totalTime <= history[index - 1].totalTime
          || (plastic ? !point.materialState || point.materialState.yieldedElementCount > request.mesh.maximumElements : point.materialState !== null);
      })
      || (plastic ? !result.nonlinear.materialState || JSON.stringify(result.nonlinear.materialState) !== JSON.stringify(result.nonlinear.history.at(-1)?.materialState) : result.nonlinear.materialState !== null)
      || !result.warnings.some(warning => warning.code === 'SIMULATION_GEOMETRIC_NONLINEARITY_POC')
      || (plastic && !result.warnings.some(warning => warning.code === 'SIMULATION_MATERIAL_NONLINEARITY_POC'))) fail('BRIDGE_V2_NONLINEAR_RESULT_INVALID');
  }
  if (request.analysis.type === 'static_contact') {
    const requestedSliding = request.interactions.find(interaction => interaction.type === 'frictionless_contact' || interaction.type === 'frictional_contact')?.sliding;
    if (result.analysisType !== 'static_contact' || !('contact' in result) || !result.contact
      || ('modal' in result && result.modal !== undefined) || ('buckling' in result && result.buckling !== undefined)
      || result.contact.sliding !== requestedSliding
      || result.contact.interfaces.length !== request.interactions.length
      || !unique(result.contact.interfaces.map(entry => entry.interactionId))
      || result.contact.interfaces.some(entry => {
        const interaction = request.interactions.find(candidate => candidate.id === entry.interactionId);
        if (!interaction || (interaction.type !== 'frictionless_contact' && interaction.type !== 'frictional_contact')) return true;
        const secondary = request.model.references.find(reference => interaction.secondaryReferenceIds.includes(reference.semanticReferenceId))?.domainId;
        const primary = request.model.references.find(reference => interaction.primaryReferenceIds.includes(reference.semanticReferenceId))?.domainId;
        return entry.secondaryDomainId !== secondary || entry.primaryDomainId !== primary
          || entry.maximumPenetrationMm !== Math.max(0, -entry.minimumNormalGapMm)
          || !datasetIds.includes(entry.pressureDatasetId) || !datasetIds.includes(entry.normalGapDatasetId)
          || (entry.tangentialSlipDatasetId !== undefined && !datasetIds.includes(entry.tangentialSlipDatasetId))
          || (entry.contactShearDatasetId !== undefined && !datasetIds.includes(entry.contactShearDatasetId))
          || (interaction.type === 'frictional_contact' && (entry.maximumShearMPa === undefined
            || !entry.tangentialSlipDatasetId || !entry.contactShearDatasetId));
      })
      || result.contact.increments.at(-1)?.stepTime !== 1
      || result.contact.increments.some((entry, index, entries) => entry.increment > request.analysis.settings.maximumIncrements
        || index > 0 && (entry.increment <= entries[index - 1].increment || entry.stepTime <= entries[index - 1].stepTime))
      || !result.warnings.some(warning => warning.code === 'SIMULATION_CONTACT_POC')
      || (request.interactions.some(interaction => (interaction.type === 'frictionless_contact' || interaction.type === 'frictional_contact') && interaction.initialAdjustment !== 'none')
        && !result.warnings.some(warning => warning.code === 'SIMULATION_CONTACT_INITIAL_ADJUSTMENT'))
      || (request.interactions.some(interaction => interaction.type === 'frictional_contact')
        && !result.warnings.some(warning => warning.code === 'SIMULATION_CONTACT_FRICTION_POC'))
      || (requestedSliding === 'finite'
        && !result.warnings.some(warning => warning.code === 'SIMULATION_CONTACT_FINITE_SLIDING_POC'))) fail('BRIDGE_V2_CONTACT_RESULT_INVALID');
  } else if (request.analysis.type !== 'nonlinear_static' && (('modal' in result && result.modal !== undefined) || ('buckling' in result && result.buckling !== undefined) || ('contact' in result && result.contact !== undefined) || ('nonlinear' in result && result.nonlinear !== undefined))) fail('BRIDGE_V2_RESULT_INVALID');
  const constraints = new Map(request.constraints.map(constraint => [constraint.id, constraint]));
  const connectors = new Map(request.interactions.filter(interaction => interaction.type === 'rigid_connector').map(interaction => [interaction.id, interaction]));
  const referenceDomains = new Map(request.model.references.map(reference => [reference.semanticReferenceId, reference.domainId]));
  if (result.reactions.length !== constraints.size || !unique(result.reactions.map(reaction => reaction.constraintId))
    || result.reactions.some(reaction => {
      const constraint = constraints.get(reaction.constraintId);
      if (!constraint) return true;
      const expectedReferences = constraint.type === 'remote_displacement' ? connectors.get(constraint.connectorId)?.semanticReferenceIds ?? [] : constraint.semanticReferenceIds;
      if (reaction.semanticReferenceIds.length !== expectedReferences.length || reaction.semanticReferenceIds.some(referenceId => !expectedReferences.includes(referenceId) || referenceDomains.get(referenceId) !== reaction.domainId)) return true;
      if (constraint.type !== 'remote_displacement') return reaction.momentNmm !== null || reaction.connectorId !== null || reaction.referencePointAnalysisMm !== null;
      const connector = connectors.get(constraint.connectorId);
      return !connector || reaction.connectorId !== connector.id || reaction.momentNmm === null
        || reaction.referencePointAnalysisMm?.some((value, index) => value !== connector.referencePointAnalysisMm[index]) !== false
        || reaction.semanticReferenceIds.length !== connector.semanticReferenceIds.length;
    })) fail('BRIDGE_V2_RESULT_REACTION_INVALID');
  if (result.review.engineeringUsePermitted) fail('BRIDGE_V2_RESULT_AUTHORITY_INVALID');
  return result;
}

function interpolateAmplitude(points: Array<{ time: number; scaleFactor: number }>, time: number): number {
  if (!points.length || time <= points[0].time) return points[0]?.scaleFactor ?? Number.NaN;
  for (let index = 1; index < points.length; index++) if (time <= points[index].time) {
    const left = points[index - 1]; const right = points[index]; const ratio = (time - left.time) / (right.time - left.time);
    return left.scaleFactor + ratio * (right.scaleFactor - left.scaleFactor);
  }
  return points.at(-1)!.scaleFactor;
}

const fieldTriangle = z.object({
  facetIndex: z.number().int().nonnegative(), elementIndex: z.number().int().nonnegative(),
  positionsAnalysisMm: z.tuple([vector, vector, vector]),
  displacementsMm: z.tuple([vector, vector, vector]),
  values: z.tuple([finite, finite, finite]),
}).strict();
const fieldDataset = z.object({
  schema: z.literal('tunacad-neutral-simulation-field-dataset/2.0'),
  datasetId: text, jobId: text, domainId: text, analysisType: z.enum(['linear_static', 'modal', 'linear_buckling', 'static_contact', 'nonlinear_static']),
  step: z.union([
    z.object({ index: z.literal(0), label: z.literal('static') }).strict(),
    z.object({ index: z.literal(0), label: z.literal('final_contact_increment') }).strict(),
    z.object({ index: z.number().int().positive(), label: z.literal('final_nonlinear_increment'), stepId: text, totalTime: positive }).strict(),
    z.object({ index: z.number().int().positive(), label: text, modeNumber: z.number().int().positive(), frequencyHz: nonNegative }).strict(),
    z.object({ index: z.number().int().positive(), label: text, bucklingModeNumber: z.number().int().positive(), eigenvalueLoadFactor: positive }).strict(),
  ]),
  component: z.enum(['displacement_magnitude', 'von_mises_stress', 'mode_shape_magnitude', 'buckling_mode_shape_magnitude', 'contact_pressure', 'normal_gap', 'tangential_slip', 'contact_shear', 'equivalent_plastic_strain', 'strain_energy_density']), unit: z.enum(['mm', 'MPa', 'normalized', 'dimensionless']),
  location: z.literal('boundary_facet'), topology: z.literal('triangle_soup'),
  valueRange: z.object({ minimum: finite, maximum: finite, minimumPositionAnalysisMm: vector, maximumPositionAnalysisMm: vector }).strict(),
  deformation: z.object({ vectorsIncluded: z.literal(true), trueScale: z.literal(1), recommendedScale: positive }).strict(),
  mapping: z.object({ domain: z.literal('exact'), cadRegions: z.enum(['partial', 'exact']), semanticReferenceIds: z.array(text).max(512) }).strict(),
  totalTriangles: z.number().int().positive().max(4_000_000), maximumPageTriangles: z.number().int().min(1).max(512), datasetDigest: hash,
}).strict();
const fieldPage = z.object({
  schema: z.literal('tunacad-neutral-simulation-field-page/2.0'), dataset: fieldDataset,
  cursor: z.string().regex(/^\d{1,10}$/), nextCursor: z.string().regex(/^\d{1,10}$/).nullable(),
  triangleOffset: z.number().int().nonnegative(), triangleCount: z.number().int().positive().max(512),
  chunkDigest: hash, triangles: z.array(fieldTriangle).min(1).max(512),
}).strict();

export function validateNeutralSimulationFieldPageV2(value: unknown): NeutralSimulationFieldPageV2 {
  const parsed = fieldPage.safeParse(value);
  if (!parsed.success) fail('BRIDGE_V2_FIELD_PAGE_INVALID');
  const page = parsed.data as NeutralSimulationFieldPageV2;
  if (page.cursor !== String(page.triangleOffset) || page.triangleCount !== page.triangles.length
    || page.triangleCount > page.dataset.maximumPageTriangles || page.triangleOffset + page.triangleCount > page.dataset.totalTriangles
    || page.nextCursor !== (page.triangleOffset + page.triangleCount < page.dataset.totalTriangles ? String(page.triangleOffset + page.triangleCount) : null)
    || page.dataset.unit !== (page.dataset.component === 'displacement_magnitude' || page.dataset.component === 'normal_gap' || page.dataset.component === 'tangential_slip' ? 'mm' : page.dataset.component === 'von_mises_stress' || page.dataset.component === 'contact_pressure' || page.dataset.component === 'contact_shear' || page.dataset.component === 'strain_energy_density' ? 'MPa' : page.dataset.component === 'equivalent_plastic_strain' ? 'dimensionless' : 'normalized')
    || (page.dataset.analysisType === 'modal') !== (page.dataset.component === 'mode_shape_magnitude')
    || (page.dataset.analysisType === 'modal') !== ('modeNumber' in page.dataset.step)
    || (page.dataset.analysisType === 'linear_buckling') !== (page.dataset.component === 'buckling_mode_shape_magnitude')
    || (page.dataset.analysisType === 'linear_buckling') !== ('bucklingModeNumber' in page.dataset.step)
    || (page.dataset.analysisType === 'static_contact') !== (['contact_pressure', 'normal_gap', 'tangential_slip', 'contact_shear'].includes(page.dataset.component) || page.dataset.step.label === 'final_contact_increment')
    || (page.dataset.analysisType === 'nonlinear_static') !== (page.dataset.step.label === 'final_nonlinear_increment')
    || (['equivalent_plastic_strain', 'strain_energy_density'].includes(page.dataset.component) && page.dataset.analysisType !== 'nonlinear_static')
    || page.dataset.valueRange.minimum > page.dataset.valueRange.maximum
    || (page.dataset.component !== 'normal_gap' && page.dataset.valueRange.minimum < 0)
    || page.triangles.some(triangle => triangle.values.some(value => page.dataset.component !== 'normal_gap' && value < 0))
    || digest(page.triangles) !== page.chunkDigest) fail('BRIDGE_V2_FIELD_PAGE_INVALID');
  return page;
}
