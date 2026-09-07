import assert from 'node:assert/strict';
import { createInputDeck } from '../providers/calculix/CalculiXSolverProvider.mts';
import { digest, validateRequest } from '../simulation-bridge/requestValidation.mts';
import type { NeutralFemMesh, NeutralSimulationRequest } from '../src/simulation/externalSimulationContracts.ts';

const mesh = {
  nodes: [
    [0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10],
    [5, 0, 0], [5, 5, 0], [0, 5, 0], [0, 0, 5], [0, 5, 5], [5, 0, 5],
  ],
  element: { family: 'tetrahedral', geometryOrder: 2, solutionOrder: 2 },
  volumeElements: { connectivity: [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]], regionIds: ['solid'] },
  boundaryFacets: { connectivity: [[0, 1, 2, 4, 5, 6]], regionIds: ['driven-region'] },
  boundaryRegions: [{
    regionId: 'driven-region', semanticReferenceIds: ['driven-face'], sourceFeatureIds: [], facetIndices: [0],
    matchedCadFace: {}, match: { state: 'verified', method: 'geometric_signature', candidateCount: 1, centroidToleranceMm: 0.1, areaRelativeTolerance: 0.01 },
  }],
} as unknown as NeutralFemMesh;

const request = {
  studyId: 'prescribed-displacement-unit',
  analysis: { type: 'linear_static' },
  material: { model: 'isotropic_linear_elastic', youngsModulusMPa: 200_000, poissonRatio: 0.3 },
  loads: [],
  constraints: [{
    id: 'driven', name: 'Driven face', type: 'prescribed_displacement', semanticReferenceIds: ['driven-face'],
    displacementMm: [0.25, null, -0.1],
  }],
} as unknown as NeutralSimulationRequest;

const deck = createInputDeck(request, mesh);
assert.match(deck, /\*NSET, NSET=PRESCRIBED_001\n1,2,3,5,6,7(?:\n|$)/);
assert.match(deck, /\*BOUNDARY\nPRESCRIBED_001,1,1,0\.25\nPRESCRIBED_001,3,3,-0\.1(?:\n|$)/);
assert.doesNotMatch(deck, /PRESCRIBED_001,2,2/, 'A null Y component must remain free.');
assert.doesNotMatch(deck, /\*CLOAD|\*DLOAD/, 'A displacement-driven study must not invent an external load section.');

const zeroComponent = structuredClone(request);
zeroComponent.constraints[0].displacementMm = [0, null, null];
assert.throws(() => createInputDeck(zeroComponent, mesh), { code: 'SIMULATION_LOAD_INVALID' });

const allFree = structuredClone(request);
allFree.constraints[0].displacementMm = [null, null, null];
assert.throws(() => createInputDeck(allFree, mesh), { code: 'SIMULATION_CONSTRAINT_INVALID' });

const excessive = structuredClone(request);
excessive.constraints[0].displacementMm = [1_000_001, null, null];
assert.throws(() => createInputDeck(excessive, mesh), { code: 'SIMULATION_CONSTRAINT_INVALID' });

const overlapping = {
  ...structuredClone(request),
  loads: [{ id: 'force', name: 'Force', type: 'surface_force', semanticReferenceIds: ['driven-face'], forceN: [1, 0, 0] }],
  constraints: [
    ...structuredClone(request.constraints),
    { id: 'fixed', name: 'Fixed', type: 'fixed', semanticReferenceIds: ['driven-face'] },
  ],
} as unknown as NeutralSimulationRequest;
assert.throws(() => createInputDeck(overlapping, mesh), { code: 'SIMULATION_CONSTRAINT_INVALID' });

const now = Date.now();
const geometryWithoutDigest = {
  projectRevision: 'prescribed-r1', partId: 'part', bodyId: 'body', coordinateSpace: 'part_definition_local' as const,
  shape: { valid: true as const, connectedSolidCount: 1 as const, faceCount: 4, edgeCount: 6, volumeMm3: 100, surfaceAreaMm2: 100,
    boundingBoxMm: { min: [0, 0, 0] as [number, number, number], max: [10, 10, 10] as [number, number, number], size: [10, 10, 10] as [number, number, number] } },
  references: [{
    semanticReferenceId: 'driven-face', ownerPartId: 'part', geometryKind: 'FACE' as const, role: 'constraint' as const,
    sourceFeatureId: null, resolutionState: 'valid' as const, resolvedAtProjectRevision: 'prescribed-r1',
    face: { centroidPartLocalMm: [0, 0, 0] as [number, number, number], areaMm2: 50, outwardDirection: [-1, 0, 0] as [number, number, number], geometryType: 'plane' },
  }],
};
const unsignedBridgeRequest = {
  schema: 'tunacad-neutral-simulation-request/1.0' as const, studyId: 'prescribed-bridge', name: 'Prescribed Bridge admission',
  preparedAt: new Date(now).toISOString(), expiresAt: new Date(now + 20 * 60_000).toISOString(),
  analysis: { type: 'linear_static' as const, assumptions: ['small_displacement', 'small_strain', 'static_loading', 'homogeneous_material'] as const },
  geometry: { ...geometryWithoutDigest, geometryDigest: digest(geometryWithoutDigest) },
  units: { geometry: 'mm' as const, force: 'N' as const, stress: 'MPa' as const, displacement: 'mm' as const, density: 'kg/m^3' as const, acceleration: 'mm/s^2' as const },
  material: { id: 'steel', name: 'Steel', model: 'isotropic_linear_elastic' as const, youngsModulusMPa: 200_000, poissonRatio: 0.3, source: { kind: 'custom' as const, reference: 'test' } },
  loads: [], constraints: request.constraints, contacts: { mode: 'none' as const },
  mesh: { dimensionality: '3d' as const, elementFamily: 'tetrahedral' as const, order: 2 as const, globalSizeMm: 1, maximumNodes: 10_000, maximumElements: 10_000, qualityMetric: 'provider_normalized' as const, minimumQuality: 0.04 },
  requestedResults: ['von_mises_stress', 'displacement', 'reaction_force'] as const,
};
assert.equal(validateRequest({ ...unsignedBridgeRequest, requestDigest: digest(unsignedBridgeRequest) }, now).loads.length, 0);
const zeroOnlyBridgeRequest = { ...unsignedBridgeRequest, constraints: [{ ...request.constraints[0], displacementMm: [0, null, null] }] };
assert.throws(() => validateRequest({ ...zeroOnlyBridgeRequest, requestDigest: digest(zeroOnlyBridgeRequest) }, now), /BRIDGE_REQUEST_INVALID/);

console.log('Prescribed-displacement translation passed: component selection, displacement-driven Bridge admission, bounds, and overlap rejection are enforced.');
