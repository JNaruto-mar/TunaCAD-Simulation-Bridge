import assert from 'node:assert/strict';
import { extractCalculiXStressHistory } from '../providers/calculix/CalculiXFatigueStressHistory.mts';

const selection = { domainId: 'coupon', elementId: 1,
  integrationPoint: 1, axisAnalysis: [1, 0, 0] as [number, number, number] };
function frame(stress: number) {
  return `displacements (vx,vy,vz) for set NALL and time 1\n 1 0 0 0\n\nstresses (elem, integ.pnt.,xx,yy,zz,xy,xz,yz) for set EALL and time 1\n 1 1 ${stress} 0 0 0 0 0\n\n`;
}
const frames = [frame(-.001), frame(.001), frame(-.001)];
const parse = (text: string) => extractCalculiXStressHistory(text, [1, 1, 1], [1, 2, 3], selection);
assert.deepEqual(parse(frames.join('')), [
  { timeS: 0, stressMPa: -.001 },
  { timeS: 1, stressMPa: .001 },
  { timeS: 2, stressMPa: -.001 },
]);
const bad = [
  frames.slice(0, 2).join(''),
  frames.join('').replace(' 1 1 0.001 0 0 0 0 0', ''),
  frames.join('').replace(' 1 1 0.001 0 0 0 0 0', ' 2 1 0.001 0 0 0 0 0'),
  frames.join('').replace(' 1 1 0.001 0 0 0 0 0', ' 1 2 0.001 0 0 0 0 0'),
  frames.join('').replace(' 1 1 0.001 0 0 0 0 0', ' 1 1 NaN 0 0 0 0 0'),
  frames.join('').replace(' 1 1 0.001 0 0 0 0 0', ' 1 1 0.001 0 0 0 0 0\n 1 1 0.001 0 0 0 0 0'),
];
for (const text of bad) assert.throws(() => parse(text), /SIM9_FATIGUE_HISTORY_(INCOMPLETE|INVALID)/);
assert.throws(() => extractCalculiXStressHistory(frames.join(''), [1, 1, 1], [1, 1.5, 3], selection),
  /SIM9_FATIGUE_HISTORY_INVALID/);
console.log(JSON.stringify({ status: 'PASS', fixture: 'selected CalculiX integration-point parser',
  rejectionCases: bad.length + 1 }));
