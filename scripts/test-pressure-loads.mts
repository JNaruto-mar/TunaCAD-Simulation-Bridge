import assert from 'node:assert/strict';
import { pressureSurfaceLoads } from '../providers/calculix/CalculiXSolverProvider.mts';
import type { NeutralFemMesh, NeutralVector3 } from '../src/simulation/externalSimulationContracts.ts';

const mesh = {
  nodes: [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1],
    [0.5, 0, 0], [0.5, 0.5, 0], [0, 0.5, 0],
    [0, 0, 0.5], [0, 0.5, 0.5], [0.5, 0, 0.5],
  ],
  volumeElements: { connectivity: [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]], regionIds: ['solid'] },
  boundaryFacets: { connectivity: [[0, 1, 2, 4, 5, 6]], regionIds: ['loaded'] },
} as unknown as NeutralFemMesh;

const compression = pressureSurfaceLoads(mesh, [0], 2);
assert.deepEqual([...compression.keys()].sort((a, b) => a - b), [4, 5, 6], 'A constant quadratic-triangle traction belongs on its three midside nodes.');
assertVectorClose(sum(compression), [0, 0, 1], 'Positive pressure on the z=0 face must act inward (+Z).');
assertVectorClose(sum(pressureSurfaceLoads(mesh, [0], -2)), [0, 0, -1], 'Negative pressure must reverse into outward suction (-Z).');
assert.throws(() => pressureSurfaceLoads(mesh, [0], 0), { code: 'SIMULATION_LOAD_INVALID' });

const ambiguous = structuredClone(mesh);
ambiguous.volumeElements.connectivity.push([...ambiguous.volumeElements.connectivity[0]]);
ambiguous.volumeElements.regionIds.push('duplicate');
assert.throws(() => pressureSurfaceLoads(ambiguous, [0], 2), { code: 'SIMULATION_FACE_MAPPING_AMBIGUOUS' });

console.log('Pressure translation passed: positive compression, negative suction, quadratic nodal distribution, and unique volume adjacency are enforced.');

function sum(loads: Map<number, NeutralVector3>): NeutralVector3 {
  return [...loads.values()].reduce<NeutralVector3>((total, force) => [total[0] + force[0], total[1] + force[1], total[2] + force[2]], [0, 0, 0]);
}

function assertVectorClose(actual: NeutralVector3, expected: NeutralVector3, message: string): void {
  assert.ok(actual.every((value, axis) => Math.abs(value - expected[axis]) < 1e-12), `${message} Received ${actual.join(', ')}.`);
}
