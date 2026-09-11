import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { NeutralFemModelV2, NeutralSimulationRequestV2 } from '../src/simulation/externalSimulationContracts.ts';
import { createCalculiXInputDeckV2 } from '../providers/calculix/CalculiXMultiDomainDeck.mts';
import { parseCalculiXContactFrdV2, parseCalculiXContactStaV2 } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import {
  admitV2SimulationRequest,
  sealNeutralSimulationRequestV2,
  validateNeutralFemModelV2,
  validateNeutralSimulationRequestV2,
  validateNeutralSimulationResultV2,
} from '../simulation-bridge/v2Validation.mts';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;
const translated10 = [1, 0, 0, 10, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;
const preparedTimestamp = Date.now();
const preparedAt = new Date(preparedTimestamp).toISOString();
const expiresAt = new Date(preparedTimestamp + 20 * 60_000).toISOString();
const revision = 'revision-sim6a';
const shape = {
  valid: true as const, connectedSolidCount: 1 as const, faceCount: 4, edgeCount: 6, volumeMm3: 500 / 3, surfaceAreaMm2: 350,
  boundingBoxOwnerLocalMm: { min: [0, 0, 0] as const, max: [10, 10, 10] as const, size: [10, 10, 10] as const },
};
const face = (centroid: [number, number, number], outwardDirection: [number, number, number], areaMm2 = 50) => ({
  centroidPartLocalMm: centroid, areaMm2, outwardDirection, geometryType: 'plane',
});
const binding = (semanticReferenceId: string, domainId: 'domain-a' | 'domain-b', role: 'load' | 'constraint' | 'interaction', faceOwnerLocal: ReturnType<typeof face>) => ({
  semanticReferenceId, domainId, ownerPartId: domainId === 'domain-a' ? 'foundation' : 'slider', ownerBodyId: 'body', occurrenceId: `${domainId}:1`,
  geometryKind: 'FACE' as const, role, sourceFeatureId: 'tetra', resolutionState: 'valid' as const, resolvedAtProjectRevision: revision, faceOwnerLocal,
});

function makeRequest(): NeutralSimulationRequestV2 {
  return sealNeutralSimulationRequestV2({
    schema: 'tunacad-neutral-simulation-request/2.0', studyId: 'sim6a-frictionless-patch', name: 'Frictionless contact contract patch',
    preparedAt, expiresAt,
    analysis: {
      type: 'static_contact', assumptions: ['small_displacement', 'small_strain', 'quasi_static', 'frictionless_contact'],
      settings: { initialIncrement: 0.1, minimumIncrement: 0.001, maximumIncrement: 0.2, maximumIncrements: 50 },
    },
    model: {
      projectRevision: revision, coordinateSpace: 'frozen_analysis',
      domains: [
        { domainId: 'domain-a', partId: 'foundation', bodyId: 'body', occurrenceId: 'domain-a:1', geometryDigest: digest({ solid: 'a' }), transformToAnalysis: [...identity], shape },
        { domainId: 'domain-b', partId: 'slider', bodyId: 'body', occurrenceId: 'domain-b:1', geometryDigest: digest({ solid: 'b' }), transformToAnalysis: [...translated10], shape },
      ],
      references: [
        binding('support-face', 'domain-a', 'constraint', face([2, 3, 3], [-1, 0, 0], 86.6)),
        binding('primary-face', 'domain-a', 'interaction', face([10, 10 / 3, 10 / 3], [1, 0, 0])),
        binding('secondary-face', 'domain-b', 'interaction', face([0, 10 / 3, 10 / 3], [-1, 0, 0])),
        binding('guide-face', 'domain-b', 'constraint', face([5, 0, 10 / 3], [0, -1, 0])),
        binding('load-face', 'domain-b', 'load', face([20 / 3, 10 / 3, 10 / 3], [1, 1, 1], 86.6)),
      ],
    },
    units: { geometry: 'mm', force: 'N', stress: 'MPa', displacement: 'mm', density: 'kg/m^3', acceleration: 'mm/s^2' },
    materials: [
      { id: 'steel-a', name: 'Steel A', model: 'isotropic_linear_elastic', densityKgM3: 7850, youngsModulusMPa: 210000, poissonRatio: 0.3, source: { kind: 'library', reference: 'test-steel' } },
      { id: 'steel-b', name: 'Steel B', model: 'isotropic_linear_elastic', densityKgM3: 7850, youngsModulusMPa: 210000, poissonRatio: 0.3, source: { kind: 'library', reference: 'test-steel' } },
    ],
    materialAssignments: [
      { assignmentId: 'assignment-a', domainId: 'domain-a', materialId: 'steel-a', volumeRegionId: 'volume-a' },
      { assignmentId: 'assignment-b', domainId: 'domain-b', materialId: 'steel-b', volumeRegionId: 'volume-b' },
    ],
    loads: [{ id: 'compress', name: 'Close contact', type: 'surface_force', semanticReferenceIds: ['load-face'], forceN: [-100, 0, 0], coordinateSystem: 'analysis' }],
    constraints: [
      { id: 'support', name: 'Foundation support', type: 'fixed', semanticReferenceIds: ['support-face'] },
      { id: 'guide', name: 'Slider guide', type: 'prescribed_displacement', semanticReferenceIds: ['guide-face'], displacementMm: [null, 0, 0], coordinateSystem: 'analysis' },
    ],
    interactions: [{
      id: 'contact', name: 'Patch contact', type: 'frictionless_contact', secondaryReferenceIds: ['secondary-face'], primaryReferenceIds: ['primary-face'],
      formulation: 'node_to_surface_penalty', sliding: 'small',
      normalBehavior: { type: 'linear_penalty', stiffnessMPaPerMm: 10_500_000, tensionCutoffMPa: 3, searchDistanceFactor: 0.01 },
      tangentialBehavior: { type: 'frictionless' }, initialAdjustment: 'none',
    }],
    mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2, globalSizeMm: 2, maximumNodes: 10000, maximumElements: 5000, qualityMetric: 'provider_normalized', minimumQuality: 0.04 },
    requestedResults: ['von_mises_stress', 'displacement', 'reaction_force', 'contact_status', 'contact_pressure', 'normal_gap', 'tangential_slip', 'contact_force'],
  });
}

const midpoint = (a: number[], b: number[]): [number, number, number] => [0, 1, 2].map(axis => (a[axis] + b[axis]) / 2) as [number, number, number];
const tetra10 = (corners: [number, number, number][]) => [...corners,
  midpoint(corners[0], corners[1]), midpoint(corners[1], corners[2]), midpoint(corners[2], corners[0]),
  midpoint(corners[0], corners[3]), midpoint(corners[2], corners[3]), midpoint(corners[1], corners[3]),
];

function makeFem(request: NeutralSimulationRequestV2): NeutralFemModelV2 {
  const nodes = [
    ...tetra10([[0, 0, 0], [10, 0, 0], [10, 10, 0], [10, 0, 10]]),
    ...tetra10([[10, 0, 0], [20, 0, 0], [10, 10, 0], [10, 0, 10]]),
  ];
  const region = (regionId: string, domainId: 'domain-a' | 'domain-b', reference: string, facetIndices: number[], matchedCadFaceOwnerLocal: ReturnType<typeof face>) => ({
    regionId, domainId, semanticReferenceIds: [reference], sourceFeatureIds: ['tetra'], facetIndices, matchedCadFaceOwnerLocal,
    match: { state: 'verified' as const, method: 'geometric_signature' as const, candidateCount: 1 as const, centroidToleranceMm: 0.01, areaRelativeTolerance: 0.01 },
  });
  const referenceFace = (referenceId: string) => request.model.references.find(reference => reference.semanticReferenceId === referenceId)!.faceOwnerLocal;
  return {
    schema: 'tunacad-neutral-fem-model/2.0', modelId: 'mesh-sim6a', requestDigest: request.requestDigest,
    projectRevision: revision, modelDigest: request.model.modelDigest, coordinateSpace: 'frozen_analysis', units: 'mm',
    element: { family: 'tetrahedral', geometryOrder: 2, solutionOrder: 2 }, nodes,
    volumeElements: { connectivity: [Array.from({ length: 10 }, (_, index) => index), Array.from({ length: 10 }, (_, index) => index + 10)], domainIds: ['domain-a', 'domain-b'], materialIds: ['steel-a', 'steel-b'], volumeRegionIds: ['volume-a', 'volume-b'] },
    boundaryFacets: {
      connectivity: [
        [0, 3, 2, 7, 8, 6], [1, 2, 3, 5, 8, 9],
        [10, 12, 13, 16, 18, 17], [10, 11, 13, 14, 19, 17], [11, 13, 12, 19, 18, 15],
      ],
      domainIds: ['domain-a', 'domain-a', 'domain-b', 'domain-b', 'domain-b'],
      regionIds: ['support-region', 'primary-region', 'secondary-region', 'guide-region', 'load-region'],
    },
    domainRegions: request.model.domains.map((domain, index) => ({
      domainId: domain.domainId, partId: domain.partId, bodyId: domain.bodyId, occurrenceId: domain.occurrenceId,
      domainDigest: domain.domainDigest, geometryDigest: domain.geometryDigest, materialId: request.materialAssignments[index].materialId,
      volumeRegionId: request.materialAssignments[index].volumeRegionId, transformToAnalysis: domain.transformToAnalysis,
      elementIndices: [index], nodeIndices: Array.from({ length: 10 }, (_, node) => node + index * 10),
    })),
    boundaryRegions: [
      region('support-region', 'domain-a', 'support-face', [0], referenceFace('support-face')),
      region('primary-region', 'domain-a', 'primary-face', [1], referenceFace('primary-face')),
      region('secondary-region', 'domain-b', 'secondary-face', [2], referenceFace('secondary-face')),
      ...(request.model.references.some(reference => reference.semanticReferenceId === 'guide-face')
        ? [region('guide-region', 'domain-b', 'guide-face', [3], referenceFace('guide-face'))] : []),
      region('load-region', 'domain-b', 'load-face', [4], referenceFace('load-face')),
    ],
    quality: {
      metric: 'mean_ratio', minimum: 0.5, average: 0.7, invalidElementCount: 0, nodeCount: 20, elementCount: 2, boundaryFacetCount: 5,
      cadVolumeMm3: 1000 / 3, meshVolumeMm3: 1000 / 3, volumeRelativeError: 0,
      perDomain: ['domain-a', 'domain-b'].map(domainId => ({ domainId, nodeCount: 10, elementCount: 1, cadVolumeMm3: 500 / 3, meshVolumeMm3: 500 / 3, volumeRelativeError: 0, minimum: 0.5, average: 0.7, invalidElementCount: 0 as const })),
    },
    provenance: { meshProviderInterfaceVersion: '2.0', adapterId: 'sim6a-fixture', adapterVersion: '1.0.0', engine: 'synthetic', engineVersion: '1', optionsDigest: digest({ size: 2 }), inputGeometryDigest: request.model.modelDigest, generatedAt: '2026-09-10T10:00:02.000Z' },
  };
}

function reseal(mutator: (candidate: any) => void): NeutralSimulationRequestV2 {
  const candidate: any = structuredClone(makeRequest());
  mutator(candidate); delete candidate.requestDigest; delete candidate.model.modelDigest;
  for (const domain of candidate.model.domains) delete domain.domainDigest;
  return sealNeutralSimulationRequestV2(candidate);
}
function expectMessage(message: string, operation: () => unknown): void {
  assert.throws(operation, error => error instanceof Error && error.message.includes(message), `Expected ${message}`);
}

const request = makeRequest();
const fem = makeFem(request);
assert.deepEqual(validateNeutralSimulationRequestV2(request, preparedTimestamp + 1000), request);
assert.deepEqual(validateNeutralFemModelV2(fem, request), fem);

const capabilities: any = {
  interfaceVersion: '2.0', analysisTypes: ['static_contact'], normalizedResults: true, asynchronous: true, cancellation: true,
  fieldResults: { paginated: true, maximumPageTriangles: 128, components: ['displacement_magnitude', 'von_mises_stress', 'contact_pressure', 'normal_gap'], topology: 'triangle_soup' },
  study: {
    multiDomain: true, perDomainMaterials: true, rigidOccurrenceTransforms: true, maximumDomains: 2, maximumOccurrences: 2, maximumParts: 2, maximumBodies: 2,
    maximumMaterials: 2, maximumReferenceBindings: 8, materialModels: ['isotropic_linear_elastic'], loadTypes: ['surface_force'], maximumLoads: 2,
    maximumReferencesPerLoad: 2, constraintTypes: ['fixed', 'prescribed_displacement'], maximumConstraints: 4, maximumReferencesPerConstraint: 2,
    contactModes: ['none'], interactionTypes: ['frictionless_contact'], maximumInteractions: 2, maximumReferencesPerInteractionSide: 2,
    contact: { maximumDomains: 2, maximumInteractions: 2, interactionTypes: ['frictionless_contact'], formulations: ['node_to_surface_penalty'], sliding: ['small'], normalBehaviors: ['linear_penalty'], tangentialBehaviors: ['frictionless'], initialAdjustments: ['none'], nonlinearIncrementReporting: true },
  },
};
assert.deepEqual(admitV2SimulationRequest(request, capabilities), { accepted: true });
const withoutContactProfile = structuredClone(capabilities); delete withoutContactProfile.study.contact;
assert.equal(admitV2SimulationRequest(request, withoutContactProfile).accepted, false);

expectMessage('BRIDGE_V2_CONTACT_GEOMETRY_INVALID', () => validateNeutralSimulationRequestV2(reseal(candidate => {
  candidate.model.references.find((entry: any) => entry.semanticReferenceId === 'secondary-face').faceOwnerLocal.outwardDirection = [1, 0, 0];
}), preparedTimestamp + 1000));
expectMessage('BRIDGE_V2_CONTACT_REQUEST_INVALID', () => validateNeutralSimulationRequestV2(reseal(candidate => {
  candidate.analysis.settings.minimumIncrement = 0.15;
}), preparedTimestamp + 1000));

const deck = createCalculiXInputDeckV2(request, fem);
assert.match(deck, /\*CONTACT PAIR, INTERACTION=CONTACT_BEHAVIOR_001, TYPE=NODE TO SURFACE, SMALL SLIDING/);
assert.match(deck, /\*SURFACE BEHAVIOR, PRESSURE-OVERCLOSURE=LINEAR\n10500000,3,0\.01/);
assert.match(deck, /\*STEP, INC=50\n\*STATIC\n0\.1,1,0\.001,0\.2/);
assert.match(deck, /\*CONTACT FILE, FREQUENCY=1000000\nCDIS,CSTR/);
assert.doesNotMatch(deck, /\*FRICTION|ADJUST=/);

const unsupportedFem = makeFem(request);
unsupportedFem.boundaryRegions = unsupportedFem.boundaryRegions.filter(region => region.regionId !== 'guide-region');
expectMessage('BRIDGE_V2_FEM_BOUNDARY_MAPPING_INVALID', () => createCalculiXInputDeckV2(request, unsupportedFem));
const underconstrained = reseal(candidate => {
  candidate.constraints.find((entry: any) => entry.id === 'guide').displacementMm = [null, null, 0];
});
expectMessage('free rigid-body modes', () => createCalculiXInputDeckV2(underconstrained, makeFem(underconstrained)));

const contactResult: any = {
  schema: 'tunacad-neutral-simulation-result/2.0', studyId: request.studyId, jobId: 'job-sim6a', requestDigest: request.requestDigest,
  projectRevision: revision, modelDigest: request.model.modelDigest, analysisType: 'static_contact', status: 'succeeded', authority: 'engineering',
  metrics: { maximumVonMisesStressMPa: 12, maximumDisplacementMm: 0.01, minimumFactorOfSafety: null },
  perDomain: [
    { domainId: 'domain-a', metrics: { maximumVonMisesStressMPa: 12, maximumDisplacementMm: 0.001, minimumFactorOfSafety: null }, fieldDatasetIds: ['disp-a', 'stress-a'] },
    { domainId: 'domain-b', metrics: { maximumVonMisesStressMPa: 8, maximumDisplacementMm: 0.01, minimumFactorOfSafety: null }, fieldDatasetIds: ['disp-b', 'stress-b', 'pressure-contact', 'gap-contact'] },
  ],
  reactions: [
    { constraintId: 'support', domainId: 'domain-a', semanticReferenceIds: ['support-face'], forceN: [100, 0, 0], momentNmm: null, connectorId: null, referencePointAnalysisMm: null },
    { constraintId: 'guide', domainId: 'domain-b', semanticReferenceIds: ['guide-face'], forceN: [0, 0, 0], momentNmm: null, connectorId: null, referencePointAnalysisMm: null },
  ],
  criticalRegions: [], failedConstraints: [],
  warnings: [{ code: 'SIMULATION_CONTACT_POC', message: 'SIM-6A contact remains proof-of-concept output.', severity: 'warning' }],
  convergence: { status: 'converged', iterations: 13, residual: 0, providerDeclared: true }, suggestedEngineeringIssues: [],
  contact: {
    formulation: 'node_to_surface_penalty', sliding: 'small',
    interfaces: [{ interactionId: 'contact', secondaryDomainId: 'domain-b', primaryDomainId: 'domain-a', status: 'active', maximumPressureMPa: 2.5, minimumNormalGapMm: -0.0001, maximumPenetrationMm: 0.0001, maximumTangentialSlipMm: 0.002, forceOnSecondaryN: [-100, 0, 0], pressureDatasetId: 'pressure-contact', normalGapDatasetId: 'gap-contact' }],
    increments: [
      { increment: 1, attempt: 1, iterations: 4, stepTime: 0.1, incrementSize: 0.1 },
      { increment: 2, attempt: 1, iterations: 5, stepTime: 0.3, incrementSize: 0.2 },
      { increment: 3, attempt: 1, iterations: 4, stepTime: 1, incrementSize: 0.7 },
    ],
  },
  provenance: { providerInterfaceVersion: '2.0', adapterId: 'sim6a-fixture', adapterVersion: '1.0.0', providerRunId: 'run-sim6a', submittedAt: preparedAt, completedAt: preparedAt, normalizedAt: preparedAt },
  review: { engineerReviewRequired: true, engineeringUsePermitted: false, disclaimer: 'SIM-6A proof-of-concept; independent engineering review is required.' },
  mutation: { occurred: false, projectRevisionBefore: revision, projectRevisionAfter: revision },
};
assert.deepEqual(validateNeutralSimulationResultV2(contactResult, request), contactResult);
const incompleteContactResult = structuredClone(contactResult); incompleteContactResult.contact.increments.at(-1).stepTime = 0.9;
expectMessage('BRIDGE_V2_CONTACT_RESULT_INVALID', () => validateNeutralSimulationResultV2(incompleteContactResult, request));

const contactField = parseCalculiXContactFrdV2(`
 -4  CONTACTR
 -1  11  -1.0E-4  1.2E-3  1.6E-3  2.5  0  0
 -1  13   0.0E+0  0  0  0.0  0  0
 -3
`);
assert.deepEqual(contactField.get(10), { normalGapMm: -0.0001, tangentialSlipMm: 0.002, pressureMPa: 2.5 });
assert.deepEqual(contactField.get(12), { normalGapMm: 0, tangentialSlipMm: 0, pressureMPa: 0 });
assert.equal(parseCalculiXContactFrdV2('-4 CONTACTR\n-1 11 0.01 0 0 0 0 0\n-3').get(10)?.normalGapMm, 0.01, 'Positive COPEN is a valid separated contact node.');
assert.equal(parseCalculiXContactFrdV2('-4 CONTACTR\n-1 11 0.01 0 0 -0.000001 0 0\n-3').get(10)?.pressureMPa, -0.000001, 'The bounded CalculiX tension regularizer is preserved for request-aware validation.');
expectMessage('invalid gap or pressure magnitude', () => parseCalculiXContactFrdV2('-4 CONTACTR\n-1 11 0.01 0 0 -2e12 0 0\n-3'));
assert.equal(parseCalculiXContactFrdV2('-4 CONTACT\n-5 COPEN 1 4 1 1\n-3').size, 0, 'An explicit empty final contact block is a valid fully open state.');

assert.deepEqual(parseCalculiXContactStaV2(`
 1 1 1U 7 0 0.0 0.1
 1 1 1 4 0 0.1 0.1
 1 2 1 5 0 0.3 0.2
 1 3 1 4 0 1.0 0.7
`), [
  { increment: 1, attempt: 1, iterations: 4, stepTime: 0.1, incrementSize: 0.1 },
  { increment: 2, attempt: 1, iterations: 5, stepTime: 0.3, incrementSize: 0.2 },
  { increment: 3, attempt: 1, iterations: 4, stepTime: 1, incrementSize: 0.7 },
]);
expectMessage('complete, ordered', () => parseCalculiXContactStaV2('1 1 1 4 0 0.5 0.5'));

const matrix = JSON.parse(readFileSync(new URL('../qualification/sim6a-windows-gmsh-4.15.2-calculix-2.16.json', import.meta.url), 'utf8'));
assert.equal(matrix.matrixId, 'sim6a-windows-x64-gmsh-4.15.2-calculix-2.16');
assert.equal(matrix.qualification.status, 'proof_of_concept');
assert.equal(matrix.qualification.engineeringUsePermitted, false);
assert.deepEqual(matrix.lanes.filter((lane: any) => lane.state === 'passed').map((lane: any) => lane.id), ['contract-and-admission', 'deterministic-contact-deck', 'bounded-contact-normalization', 'real-patch-equilibrium', 'opening-and-closing', 'penetration-and-refinement-trends']);
assert.deepEqual(matrix.lanes.filter((lane: any) => lane.state === 'pending').map((lane: any) => lane.id), ['nonconvergence-and-cancellation', 'independent-engineering-review']);

console.log('SIM-6A frictionless small-sliding contact contract, admission, rigid-body stability, deterministic deck, and bounded parsers passed.');
