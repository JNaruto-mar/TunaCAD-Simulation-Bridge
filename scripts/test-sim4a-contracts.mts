import assert from 'node:assert/strict';
import type { NeutralFemModelV2, NeutralSimulationRequestV2 } from '../src/simulation/externalSimulationContracts.ts';
import { validateRequest } from '../simulation-bridge/requestValidation.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import {
  admitV2MeshRequest,
  admitV2SimulationRequest,
  sealNeutralSimulationRequestV2,
  validateNeutralFemModelV2,
  validateNeutralSimulationRequestV2,
  validateNeutralSimulationResultV2,
} from '../simulation-bridge/v2Validation.mts';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;
const translated = [1, 0, 0, 25, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;
const preparedAt = '2026-09-07T12:00:00.000Z';
const now = Date.parse(preparedAt) + 1000;
const face = (x: number) => ({
  centroidPartLocalMm: [x, 5, 5] as [number, number, number], areaMm2: 100,
  outwardDirection: [x === 0 ? -1 : 1, 0, 0] as [number, number, number], geometryType: 'plane',
});
const shape = {
  valid: true as const, connectedSolidCount: 1 as const, faceCount: 6, edgeCount: 12,
  volumeMm3: 1000, surfaceAreaMm2: 600,
  boundingBoxOwnerLocalMm: { min: [0, 0, 0] as [number, number, number], max: [10, 10, 10] as [number, number, number], size: [10, 10, 10] as [number, number, number] },
};

function makeRequest(): NeutralSimulationRequestV2 {
  return sealNeutralSimulationRequestV2({
    schema: 'tunacad-neutral-simulation-request/2.0', studyId: 'sim4a-repeated-part', name: 'Repeated two-material coupon',
    preparedAt, expiresAt: '2026-09-07T12:20:00.000Z',
    analysis: { type: 'linear_static', assumptions: ['small_displacement', 'small_strain', 'static_loading'] },
    model: {
      projectRevision: 'revision-sim4a', coordinateSpace: 'frozen_analysis',
      domains: [
        { domainId: 'domain-a', partId: 'coupon', bodyId: 'body', occurrenceId: 'coupon:1', geometryDigest: digest({ step: 'coupon' }), transformToAnalysis: [...identity], shape },
        { domainId: 'domain-b', partId: 'coupon', bodyId: 'body', occurrenceId: 'coupon:2', geometryDigest: digest({ step: 'coupon' }), transformToAnalysis: [...translated], shape },
      ],
      references: [
        { semanticReferenceId: 'support-face', domainId: 'domain-a', ownerPartId: 'coupon', ownerBodyId: 'body', occurrenceId: 'coupon:1', geometryKind: 'FACE', role: 'constraint', sourceFeatureId: 'extrude', resolutionState: 'valid', resolvedAtProjectRevision: 'revision-sim4a', faceOwnerLocal: face(0) },
        { semanticReferenceId: 'load-face', domainId: 'domain-b', ownerPartId: 'coupon', ownerBodyId: 'body', occurrenceId: 'coupon:2', geometryKind: 'FACE', role: 'load', sourceFeatureId: 'extrude', resolutionState: 'valid', resolvedAtProjectRevision: 'revision-sim4a', faceOwnerLocal: face(10) },
      ],
    },
    units: { geometry: 'mm', force: 'N', stress: 'MPa', displacement: 'mm', density: 'kg/m^3', acceleration: 'mm/s^2' },
    materials: [
      { id: 'steel', name: 'Steel', model: 'isotropic_linear_elastic', densityKgM3: 7850, youngsModulusMPa: 210000, poissonRatio: 0.3, source: { kind: 'library', reference: 'test-steel' } },
      { id: 'aluminum', name: 'Aluminum', model: 'isotropic_linear_elastic', densityKgM3: 2700, youngsModulusMPa: 70000, poissonRatio: 0.33, source: { kind: 'library', reference: 'test-aluminum' } },
    ],
    materialAssignments: [
      { assignmentId: 'assignment-a', domainId: 'domain-a', materialId: 'steel', volumeRegionId: 'volume-a' },
      { assignmentId: 'assignment-b', domainId: 'domain-b', materialId: 'aluminum', volumeRegionId: 'volume-b' },
    ],
    loads: [{ id: 'load', name: 'Pull', type: 'surface_force', semanticReferenceIds: ['load-face'], forceN: [1000, 0, 0], coordinateSystem: 'analysis' }],
    constraints: [{ id: 'support', name: 'Support', type: 'fixed', semanticReferenceIds: ['support-face'] }],
    interactions: [], mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2, globalSizeMm: 2, maximumNodes: 10000, maximumElements: 5000, qualityMetric: 'provider_normalized', minimumQuality: 0.04 },
    requestedResults: ['von_mises_stress', 'displacement', 'reaction_force'],
  });
}

function reseal(mutator: (request: any) => void): NeutralSimulationRequestV2 {
  const request: any = structuredClone(makeRequest());
  mutator(request);
  delete request.requestDigest;
  delete request.model.modelDigest;
  for (const domain of request.model.domains) delete domain.domainDigest;
  return sealNeutralSimulationRequestV2(request);
}

function expectCode(code: string, operation: () => unknown): void {
  assert.throws(operation, error => error instanceof Error && error.message === code, `Expected ${code}`);
}

const request = makeRequest();
assert.deepEqual(validateNeutralSimulationRequestV2(request, now), request);
assert.equal(request.model.domains[0].geometryDigest, request.model.domains[1].geometryDigest, 'Repeated occurrences may share immutable geometry.');
assert.notEqual(request.model.domains[0].domainDigest, request.model.domains[1].domainDigest, 'Occurrence transform and identity must affect the domain digest.');
expectCode('BRIDGE_PROVIDER_INTERFACE_VERSION_UNSUPPORTED', () => validateRequest(request, now));
assert.deepEqual(admitV2SimulationRequest(request, { interfaceVersion: '1.0' } as any), {
  accepted: false, code: 'PROVIDER_INTERFACE_VERSION_UNSUPPORTED', message: 'A version 2.0 simulation provider is required before geometry transfer.',
});
assert.deepEqual(admitV2MeshRequest({ interfaceVersion: '1.0' } as any), {
  accepted: false, code: 'PROVIDER_INTERFACE_VERSION_UNSUPPORTED', message: 'A version 2.0 mesh provider is required before geometry transfer.',
});
assert.deepEqual(admitV2SimulationRequest(request, {
  interfaceVersion: '2.0', study: { multiDomain: true, perDomainMaterials: true, rigidOccurrenceTransforms: true, maximumDomains: 8, maximumOccurrences: 8, maximumMaterials: 8, interactionTypes: [] },
} as any), { accepted: true });

expectCode('BRIDGE_V2_TRANSFORM_INVALID', () => validateNeutralSimulationRequestV2(reseal(candidate => { candidate.model.domains[1].transformToAnalysis[0] = 2; }), now));
expectCode('BRIDGE_V2_DOMAIN_IDENTITY_INVALID', () => validateNeutralSimulationRequestV2(reseal(candidate => { candidate.model.domains[1].occurrenceId = 'coupon:1'; }), now));
expectCode('BRIDGE_V2_ASSIGNMENT_INVALID', () => validateNeutralSimulationRequestV2(reseal(candidate => { candidate.materialAssignments.pop(); }), now));
expectCode('BRIDGE_V2_ASSIGNMENT_INVALID', () => validateNeutralSimulationRequestV2(reseal(candidate => { candidate.materialAssignments[1].materialId = 'missing'; }), now));
expectCode('BRIDGE_V2_REFERENCE_INVALID', () => validateNeutralSimulationRequestV2(reseal(candidate => { candidate.model.references[1].occurrenceId = 'coupon:1'; }), now));
const staleDigest = structuredClone(request);
staleDigest.model.domains[1].transformToAnalysis[3] = 30;
expectCode('BRIDGE_V2_DOMAIN_DIGEST_INVALID', () => validateNeutralSimulationRequestV2(staleDigest, now));
const inferredInteraction: any = structuredClone(request);
inferredInteraction.interactions = [{ type: 'bonded', source: 'domain-a', target: 'domain-b' }];
expectCode('BRIDGE_V2_REQUEST_INVALID', () => validateNeutralSimulationRequestV2(inferredInteraction, now));

const nodes = [
  [0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10], [5, 0, 0], [5, 5, 0], [0, 5, 0], [0, 0, 5], [0, 5, 5], [5, 0, 5],
  [25, 0, 0], [35, 0, 0], [25, 10, 0], [25, 0, 10], [30, 0, 0], [30, 5, 0], [25, 5, 0], [25, 0, 5], [25, 5, 5], [30, 0, 5],
] as [number, number, number][];
const fem: NeutralFemModelV2 = {
  schema: 'tunacad-neutral-fem-model/2.0', modelId: 'mesh-sim4a', requestDigest: request.requestDigest,
  projectRevision: request.model.projectRevision, modelDigest: request.model.modelDigest, coordinateSpace: 'frozen_analysis', units: 'mm',
  element: { family: 'tetrahedral', geometryOrder: 2, solutionOrder: 2 }, nodes,
  volumeElements: { connectivity: [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]], domainIds: ['domain-a', 'domain-b'], materialIds: ['steel', 'aluminum'], volumeRegionIds: ['volume-a', 'volume-b'] },
  boundaryFacets: { connectivity: [[0, 2, 1, 6, 5, 4], [10, 11, 12, 14, 15, 16]], domainIds: ['domain-a', 'domain-b'], regionIds: ['support-region', 'load-region'] },
  domainRegions: request.model.domains.map((domain, index) => ({
    domainId: domain.domainId, partId: domain.partId, bodyId: domain.bodyId, occurrenceId: domain.occurrenceId,
    domainDigest: domain.domainDigest, geometryDigest: domain.geometryDigest,
    materialId: request.materialAssignments[index].materialId, volumeRegionId: request.materialAssignments[index].volumeRegionId,
    transformToAnalysis: domain.transformToAnalysis, elementIndices: [index], nodeIndices: Array.from({ length: 10 }, (_, node) => node + index * 10),
  })),
  boundaryRegions: [
    { regionId: 'support-region', domainId: 'domain-a', semanticReferenceIds: ['support-face'], sourceFeatureIds: ['extrude'], facetIndices: [0], matchedCadFaceOwnerLocal: face(0), match: { state: 'verified', method: 'geometric_signature', candidateCount: 1, centroidToleranceMm: 0.01, areaRelativeTolerance: 0.01 } },
    { regionId: 'load-region', domainId: 'domain-b', semanticReferenceIds: ['load-face'], sourceFeatureIds: ['extrude'], facetIndices: [1], matchedCadFaceOwnerLocal: face(10), match: { state: 'verified', method: 'geometric_signature', candidateCount: 1, centroidToleranceMm: 0.01, areaRelativeTolerance: 0.01 } },
  ],
  quality: {
    metric: 'mean_ratio', minimum: 0.8, average: 0.9, invalidElementCount: 0, nodeCount: 20, elementCount: 2, boundaryFacetCount: 2,
    cadVolumeMm3: 2000, meshVolumeMm3: 2000, volumeRelativeError: 0,
    perDomain: ['domain-a', 'domain-b'].map(domainId => ({ domainId, nodeCount: 10, elementCount: 1, cadVolumeMm3: 1000, meshVolumeMm3: 1000, volumeRelativeError: 0, minimum: 0.8, average: 0.9, invalidElementCount: 0 as const })),
  },
  provenance: { meshProviderInterfaceVersion: '2.0', adapterId: 'contract-fixture', adapterVersion: '1.0.0', engine: 'synthetic', engineVersion: '1', optionsDigest: digest({ size: 2 }), inputGeometryDigest: request.model.modelDigest, generatedAt: '2026-09-07T12:00:02.000Z' },
};
assert.deepEqual(validateNeutralFemModelV2(fem, request), fem);
expectCode('BRIDGE_V2_FEM_DOMAIN_MAPPING_INVALID', () => validateNeutralFemModelV2({ ...structuredClone(fem), domainRegions: structuredClone(fem.domainRegions).map((region, index) => index === 1 ? { ...region, elementIndices: [0] } : region) }, request));
expectCode('BRIDGE_V2_FEM_DOMAIN_MAPPING_INVALID', () => validateNeutralFemModelV2({ ...structuredClone(fem), volumeElements: { ...structuredClone(fem.volumeElements), materialIds: ['steel', 'steel'] } }, request));
const crossDomainFacet = structuredClone(fem);
crossDomainFacet.boundaryFacets.connectivity[1][0] = 0;
expectCode('BRIDGE_V2_FEM_BOUNDARY_MAPPING_INVALID', () => validateNeutralFemModelV2(crossDomainFacet, request));
expectCode('BRIDGE_V2_FEM_IDENTITY_INVALID', () => validateNeutralFemModelV2({ ...structuredClone(fem), modelDigest: digest({ wrong: true }) }, request));

const result = {
  schema: 'tunacad-neutral-simulation-result/2.0', studyId: request.studyId, jobId: 'job-sim4a', requestDigest: request.requestDigest,
  projectRevision: request.model.projectRevision, modelDigest: request.model.modelDigest, analysisType: 'linear_static', status: 'succeeded', authority: 'engineering',
  metrics: { maximumVonMisesStressMPa: 12, maximumDisplacementMm: 0.1, minimumFactorOfSafety: null },
  perDomain: [
    { domainId: 'domain-a', metrics: { maximumVonMisesStressMPa: 12, maximumDisplacementMm: 0.02, minimumFactorOfSafety: null }, fieldDatasetIds: ['stress-a', 'displacement-a'] },
    { domainId: 'domain-b', metrics: { maximumVonMisesStressMPa: 8, maximumDisplacementMm: 0.1, minimumFactorOfSafety: null }, fieldDatasetIds: ['stress-b', 'displacement-b'] },
  ],
  reactions: [{ constraintId: 'support', forceN: [-1000, 0, 0], semanticReferenceIds: ['support-face'], domainId: 'domain-a' }],
  criticalRegions: [{ id: 'hotspot-b', kind: 'stress', severity: 'warning', value: 8, unit: 'MPa', positionAnalysisMm: [30, 5, 5], semanticReferenceIds: ['load-face'], featureIds: ['extrude'], description: 'Fixture result mapping', inspect: ['domain-b'], mapping: 'analysis_location', domainId: 'domain-b' }],
  failedConstraints: [], warnings: [{ code: 'SIM4A_EXPERIMENTAL', message: 'Contract fixture only.', severity: 'warning' }],
  convergence: { status: 'converged', iterations: 1, residual: 0, providerDeclared: true }, suggestedEngineeringIssues: [],
  provenance: { providerInterfaceVersion: '2.0', adapterId: 'contract-fixture', adapterVersion: '1.0.0', providerRunId: 'run-sim4a', submittedAt: '2026-09-07T12:00:01.000Z', completedAt: '2026-09-07T12:00:02.000Z', normalizedAt: '2026-09-07T12:00:03.000Z' },
  review: { engineerReviewRequired: true, engineeringUsePermitted: false, disclaimer: 'Experimental contract fixture.' },
  mutation: { occurred: false, projectRevisionBefore: request.model.projectRevision, projectRevisionAfter: request.model.projectRevision },
} as const;
assert.deepEqual(validateNeutralSimulationResultV2(result, request), result);
const duplicateResultDomain: any = structuredClone(result);
duplicateResultDomain.perDomain[1].domainId = 'domain-a';
expectCode('BRIDGE_V2_RESULT_DOMAIN_MAPPING_INVALID', () => validateNeutralSimulationResultV2(duplicateResultDomain, request));
const duplicateDataset: any = structuredClone(result);
duplicateDataset.perDomain[1].fieldDatasetIds[0] = 'stress-a';
expectCode('BRIDGE_V2_RESULT_DOMAIN_MAPPING_INVALID', () => validateNeutralSimulationResultV2(duplicateDataset, request));
const falselyPermitted: any = structuredClone(result);
falselyPermitted.review.engineeringUsePermitted = true;
expectCode('BRIDGE_V2_RESULT_AUTHORITY_INVALID', () => validateNeutralSimulationResultV2(falselyPermitted, request));

console.log('SIM-4A v2 contracts preserve repeated-occurrence identity, rigid transforms, per-domain materials, digests, and multi-volume ownership while v1 providers fail closed.');
