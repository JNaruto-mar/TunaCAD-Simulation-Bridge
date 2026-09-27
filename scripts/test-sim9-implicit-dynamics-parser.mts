import assert from 'node:assert/strict';
import { parseCalculiXImplicitDynamicsDatV2 } from '../providers/calculix/CalculiXImplicitDynamics.mts';
import type { NeutralFemModelV2 } from '../src/simulation/externalSimulationContracts.ts';

const model = { nodes: [[0, 0, 0], [1, 0, 0]] } as NeutralFemModelV2;
const times = [1, 2];
const frame = (time: number) => [
  ` displacements (vx,vy,vz) for set NALL and time  ${time}`, '',
  ' 1 0 0 0', ` 2 ${time} 0 0`, '',
  ` total force (fx,fy,fz) for set REACTION_001 and time  ${time}`, '',
  ' -1 0 0', '',
  ` total kinetic energy for set EALL and time  ${time}`, '',
  ' 1', '',
  ` total internal energy for set EALL and time  ${time}`, '',
  ' 1', '',
].join('\n');
const valid = frame(1) + frame(2);
assert.deepEqual(parseCalculiXImplicitDynamicsDatV2(valid, model, times).map(item => item.timeS), times);
const rejects = [
  frame(1), frame(2) + frame(1), frame(2) + frame(1),
  frame(2) + frame(1),
  valid.replace(' 2 1 0 0', ''),
  valid.replace(' 2 1 0 0', ' 1 1 0 0'),
  valid.replace(' 2 1 0 0', ' 2 NaN 0 0'),
  valid.replace(' 1\n\n total internal energy', ' -1\n\n total internal energy'),
  valid.replace('total kinetic energy for set EALL', 'total kinetic energy for set OTHER'),
  valid + ' unrelated trailing artifact',
];
for (const text of rejects) assert.throws(() => parseCalculiXImplicitDynamicsDatV2(text, model, times));
console.log(JSON.stringify({ status: 'PASS', fixture: 'SIM-9 dynamics strict frame parser',
  malformedHistoriesRejected: rejects.length }));
