import * as z from 'zod/v4';
import type {
  MeshProviderCapabilities,
  MeshProviderCapabilitiesV2,
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
const material = z.object({
  id: text, name: text, model: z.literal('isotropic_linear_elastic'),
  densityKgM3: positive.max(100000).optional(),
  youngsModulusMPa: positive.max(100000000), poissonRatio: finite.min(0).lt(0.5),
  yieldStrengthMPa: positive.optional(),
  source: z.object({ kind: z.enum(['library', 'custom']), reference: text, revision: text.optional() }).strict(),
}).strict();
const meshRequest = z.object({
  dimensionality: z.literal('3d'), elementFamily: z.literal('tetrahedral'), order: z.literal(2),
  globalSizeMm: positive.max(1000000), minimumSizeMm: positive.optional(),
  maximumNodes: z.number().int().min(10).max(2_000_000), maximumElements: z.number().int().min(10).max(1_000_000),
  qualityMetric: z.literal('provider_normalized'), minimumQuality: finite.min(0.04).max(1),
}).strict();

const requestSchema = z.object({
  schema: z.literal('tunacad-neutral-simulation-request/2.0'),
  studyId: text, name: text, preparedAt: z.iso.datetime(), expiresAt: z.iso.datetime(), requestDigest: hash,
  analysis: z.object({
    type: z.literal('linear_static'),
    assumptions: z.tuple([z.literal('small_displacement'), z.literal('small_strain'), z.literal('static_loading')]),
  }).strict(),
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
    }).strict()).min(2).max(128),
    references: z.array(z.object({
      semanticReferenceId: text, domainId: text, ownerPartId: text, ownerBodyId: text, occurrenceId: text,
      geometryKind: z.literal('FACE'), role: z.enum(['load', 'constraint', 'interaction']),
      sourceFeatureId: text.nullable(), resolutionState: z.literal('valid'), resolvedAtProjectRevision: text,
      faceOwnerLocal: face,
    }).strict()).min(1).max(512),
  }).strict(),
  units: z.object({
    geometry: z.literal('mm'), force: z.literal('N'), stress: z.literal('MPa'), displacement: z.literal('mm'),
    density: z.literal('kg/m^3'), acceleration: z.literal('mm/s^2'),
  }).strict(),
  materials: z.array(material).min(1).max(128),
  materialAssignments: z.array(z.object({ assignmentId: text, domainId: text, materialId: text, volumeRegionId: text }).strict()).min(1).max(128),
  loads: z.array(z.discriminatedUnion('type', [
    z.object({ id: text, name: text, type: z.literal('surface_force'), semanticReferenceIds: uniqueReferences, forceN: vector, coordinateSystem: z.literal('analysis') }).strict()
      .refine(value => Math.hypot(...(value.forceN as [number, number, number])) > 1e-14 && Math.hypot(...(value.forceN as [number, number, number])) <= 1e12),
    z.object({ id: text, name: text, type: z.literal('pressure'), semanticReferenceIds: uniqueReferences, pressureMPa: finite.refine(value => value !== 0 && Math.abs(value) <= 1e6) }).strict(),
    z.object({ id: text, name: text, type: z.literal('gravity'), accelerationMmPerS2: vector, coordinateSystem: z.literal('analysis') }).strict()
      .refine(value => Math.hypot(...(value.accelerationMmPerS2 as [number, number, number])) > 1e-9 && Math.hypot(...(value.accelerationMmPerS2 as [number, number, number])) <= 1e9),
  ])).max(64),
  constraints: z.array(z.discriminatedUnion('type', [
    z.object({ id: text, name: text, type: z.literal('fixed'), semanticReferenceIds: uniqueReferences }).strict(),
    z.object({
      id: text, name: text, type: z.literal('prescribed_displacement'), semanticReferenceIds: uniqueReferences,
      displacementMm: z.tuple([finite.min(-1e6).max(1e6).nullable(), finite.min(-1e6).max(1e6).nullable(), finite.min(-1e6).max(1e6).nullable()])
        .refine(value => value.some(component => component !== null)),
      coordinateSystem: z.literal('analysis'),
    }).strict(),
  ])).min(1).max(64),
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
  ])).max(32),
  mesh: meshRequest,
  requestedResults: z.array(z.enum(['von_mises_stress', 'displacement', 'reaction_force', 'factor_of_safety', 'critical_regions'])).min(1).max(5),
}).strict();

function unique(values: string[]): boolean {
  return new Set(values).size === values.length;
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
    ...request.constraints.flatMap(constraint => constraint.semanticReferenceIds.map(id => [`constraint:${id}`, id] as const)),
    ...request.interactions.flatMap(interaction => [...interaction.secondaryReferenceIds, ...interaction.primaryReferenceIds].map(id => [`interaction:${id}`, id] as const)),
  ];
  if (required.length !== references.size || required.some(([key]) => !references.has(key))) fail('BRIDGE_V2_REFERENCE_INVALID');
  const loaded = new Set(required.filter(([key]) => key.startsWith('load:')).map(([, id]) => id));
  if (required.some(([key, id]) => key.startsWith('constraint:') && loaded.has(id))) fail('BRIDGE_V2_REFERENCE_INVALID');
  for (const interaction of request.interactions) {
    const secondaryDomains = new Set(interaction.secondaryReferenceIds.map(id => references.get(`interaction:${id}`)?.domainId));
    const primaryDomains = new Set(interaction.primaryReferenceIds.map(id => references.get(`interaction:${id}`)?.domainId));
    if (secondaryDomains.size !== 1 || primaryDomains.size !== 1 || [...secondaryDomains][0] === [...primaryDomains][0]
      || interaction.secondaryReferenceIds.some(id => interaction.primaryReferenceIds.includes(id))) fail('BRIDGE_V2_INTERACTION_INVALID');
  }
  const entryIds = [...request.loads, ...request.constraints, ...request.interactions].map(entry => entry.id);
  if (!unique(entryIds)) fail('BRIDGE_V2_REQUEST_INVALID');
  if (!request.loads.length && !request.constraints.some(constraint => constraint.type === 'prescribed_displacement'
    && constraint.displacementMm.some(component => component !== null && Math.abs(component) > 1e-14))) fail('BRIDGE_V2_REQUEST_INVALID');
  const maximumSize = Math.max(...domains.flatMap(domain => domain.shape.boundingBoxOwnerLocalMm.size));
  if (request.mesh.globalSizeMm < maximumSize / 200
    || (request.mesh.minimumSizeMm !== undefined && request.mesh.minimumSizeMm < request.mesh.globalSizeMm / 20)) fail('BRIDGE_V2_MESH_BUDGET_INVALID');
  return request;
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
    || profile.fieldResults.topology !== 'triangle_soup' || !profile.fieldResults.components.includes('displacement_magnitude') || !profile.fieldResults.components.includes('von_mises_stress')
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
      || constraint.semanticReferenceIds.length > profile.study.maximumReferencesPerConstraint)
    || !profile.study.contactModes.includes('none')
    || request.constraints.some(constraint => new Set(constraint.semanticReferenceIds.map(referenceId => referenceDomains.get(referenceId))).size !== 1)
    || request.interactions.length > profile.study.maximumInteractions
    || request.interactions.some(interaction => !profile.study.interactionTypes.includes(interaction.type)
      || interaction.primaryReferenceIds.length > profile.study.maximumReferencesPerInteractionSide
      || interaction.secondaryReferenceIds.length > profile.study.maximumReferencesPerInteractionSide)) {
    return { accepted: false, code: 'PROVIDER_V2_CAPABILITY_UNSUPPORTED', message: 'The provider does not exactly support this SIM-4A study envelope.' };
  }
  return { accepted: true };
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
  }).strict()).min(2).max(128),
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
    }).strict()).min(2),
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
const resultSchema = z.object({
  schema: z.literal('tunacad-neutral-simulation-result/2.0'), studyId: text, jobId: text, requestDigest: hash,
  projectRevision: text, modelDigest: hash, analysisType: z.literal('linear_static'), status: z.enum(['succeeded', 'failed', 'cancelled']),
  authority: z.enum(['engineering', 'architecture_mock']), metrics: resultMetrics,
  perDomain: z.array(z.object({ domainId: text, metrics: resultMetrics, fieldDatasetIds: z.array(text).max(64) }).strict()).min(2).max(128),
  reactions: z.array(z.object({ constraintId: text, forceN: vector, semanticReferenceIds: z.array(text), domainId: text }).strict()).max(512),
  criticalRegions: z.array(z.object({
    id: text, kind: z.enum(['stress', 'displacement', 'constraint', 'mesh', 'provider']), severity: z.enum(['info', 'warning', 'critical']),
    value: finite.nullable(), unit: z.enum(['MPa', 'mm', 'N']).nullable(), positionAnalysisMm: vector.nullable(), semanticReferenceIds: z.array(text),
    featureIds: z.array(text), description: text, inspect: z.array(text), mapping: z.enum(['durable_reference', 'analysis_location', 'unmapped']), domainId: text,
  }).strict()).max(10000),
  failedConstraints: z.array(z.object({ constraintId: text, code: text, message: text }).strict()),
  warnings: z.array(z.object({ code: text, message: text, severity: z.enum(['info', 'warning', 'critical']) }).strict()),
  convergence: z.object({ status: z.enum(['converged', 'not_converged', 'not_evaluated']), iterations: z.number().int().nonnegative().nullable(), residual: nonNegative.nullable(), providerDeclared: z.boolean() }).strict(),
  suggestedEngineeringIssues: z.array(text),
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
  if (result.review.engineeringUsePermitted) fail('BRIDGE_V2_RESULT_AUTHORITY_INVALID');
  return result;
}

const fieldTriangle = z.object({
  facetIndex: z.number().int().nonnegative(), elementIndex: z.number().int().nonnegative(),
  positionsAnalysisMm: z.tuple([vector, vector, vector]),
  displacementsMm: z.tuple([vector, vector, vector]),
  values: z.tuple([finite, finite, finite]),
}).strict();
const fieldDataset = z.object({
  schema: z.literal('tunacad-neutral-simulation-field-dataset/2.0'),
  datasetId: text, jobId: text, domainId: text, analysisType: z.literal('linear_static'),
  step: z.object({ index: z.literal(0), label: z.literal('static') }).strict(),
  component: z.enum(['displacement_magnitude', 'von_mises_stress']), unit: z.enum(['mm', 'MPa']),
  location: z.literal('boundary_facet'), topology: z.literal('triangle_soup'),
  valueRange: z.object({ minimum: nonNegative, maximum: nonNegative, minimumPositionAnalysisMm: vector, maximumPositionAnalysisMm: vector }).strict(),
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
    || page.dataset.unit !== (page.dataset.component === 'displacement_magnitude' ? 'mm' : 'MPa')
    || page.dataset.valueRange.minimum > page.dataset.valueRange.maximum
    || digest(page.triangles) !== page.chunkDigest) fail('BRIDGE_V2_FIELD_PAGE_INVALID');
  return page;
}
