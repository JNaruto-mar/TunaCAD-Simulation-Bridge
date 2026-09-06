import assert from 'node:assert/strict';
import { createInputDeck, gravityResultant, parseCalculiXDat } from '../providers/calculix/CalculiXSolverProvider.mts';
import type { NeutralFemMesh, NeutralSimulationRequest, NeutralVector3 } from '../src/simulation/externalSimulationContracts.ts';

const mesh = {
  nodes: [
    [0, 0, 0], [1000, 0, 0], [0, 1000, 0], [0, 0, 1000],
    [500, 0, 0], [500, 500, 0], [0, 500, 0],
    [0, 0, 500], [0, 500, 500], [500, 0, 500],
  ],
  element: { family: 'tetrahedral', geometryOrder: 2, solutionOrder: 2 },
  volumeElements: { connectivity: [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]], regionIds: ['solid'] },
  boundaryFacets: { connectivity: [[0, 1, 2, 4, 5, 6]], regionIds: ['fixed-region'] },
  boundaryRegions: [{
    regionId: 'fixed-region', semanticReferenceIds: ['fixed-face'], sourceFeatureIds: [], facetIndices: [0],
    matchedCadFace: {}, match: { state: 'verified', method: 'geometric_signature', candidateCount: 1, centroidToleranceMm: 0.1, areaRelativeTolerance: 0.01 },
  }],
} as unknown as NeutralFemMesh;

const acceleration: NeutralVector3 = [0, 0, -1000];
assertVectorClose(
  gravityResultant(mesh, 6000, acceleration),
  [0, 0, -1000],
  'A 1,000 kg tetrahedron accelerated at 1 m/s^2 must produce 1,000 N.',
);
assert.throws(() => gravityResultant(mesh, 0, acceleration), { code: 'SIMULATION_MATERIAL_INVALID' });
assert.throws(() => gravityResultant(mesh, 100_001, acceleration), { code: 'SIMULATION_MATERIAL_INVALID' });
assert.throws(() => gravityResultant(mesh, 6000, [0, 0, 0]), { code: 'SIMULATION_LOAD_INVALID' });
assert.throws(() => gravityResultant(mesh, 6000, [0, 0, 1_000_000_001]), { code: 'SIMULATION_LOAD_INVALID' });

const request = {
  studyId: 'gravity-unit',
  analysis: { type: 'linear_static' },
  material: { model: 'isotropic_linear_elastic', densityKgM3: 6000, youngsModulusMPa: 200_000, poissonRatio: 0.3 },
  loads: [{ id: 'gravity', name: 'Gravity', type: 'gravity', accelerationMmPerS2: acceleration }],
  constraints: [{ id: 'fixed', name: 'Fixed', type: 'fixed', semanticReferenceIds: ['fixed-face'] }],
} as unknown as NeutralSimulationRequest;
const deck = createInputDeck(request, mesh);
assert.match(deck, /\*DENSITY\n6e-9(?:\n|$)/, 'kg/m^3 must convert to tonne/mm^3 for the mm/N/s deck.');
assert.match(deck, /\*DLOAD\nEALL,GRAV,1000,0,0,-1(?:\n|$)/, 'Gravity must use magnitude plus a normalized part-local direction.');
assert.doesNotMatch(deck, /\*CLOAD/, 'A gravity-only study must not emit an empty nodal-load section.');

const missingDensity = structuredClone(request);
delete missingDensity.material.densityKgM3;
assert.throws(() => createInputDeck(missingDensity, mesh), { code: 'SIMULATION_MATERIAL_INVALID' });

const parsed = parseCalculiXDat([
  'displacements for set NALL', '1 0.1 0 0',
  'stresses for set EALL', '1 1 10 0 0 0 0 0',
  'total force for set FIXED_001', '0 0 1000',
  'total volume for set EALL', '', '1.666666666666667E+08', '',
].join('\n'), mesh, ['FIXED_001'], true);
assert.equal(parsed.totalVolumeMm3, 166_666_666.6666667);
assert.throws(() => parseCalculiXDat([
  'displacements for set NALL', '1 0.1 0 0',
  'stresses for set EALL', '1 1 10 0 0 0 0 0',
  'total force for set FIXED_001', '0 0 1000',
].join('\n'), mesh, ['FIXED_001'], true), /requested volume output/);

console.log('Gravity translation passed: density units, tetrahedral volume, part-local direction, total resultant, and negative cases are enforced.');

function assertVectorClose(actual: NeutralVector3, expected: NeutralVector3, message: string): void {
  assert.ok(actual.every((value, axis) => Math.abs(value - expected[axis]) < 1e-9), `${message} Received ${actual.join(', ')}.`);
}
