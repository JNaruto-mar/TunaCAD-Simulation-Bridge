import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beginBlock, bcsBlock, solidTetra4Block, RADIOSSS_FIELD_RULER } from '../simulation-bridge/openRadiossStarterSerialization.mts';

const field = (row: string, index: number, width = 10) => row.slice(index * width, (index + 1) * width);
assert.equal(RADIOSSS_FIELD_RULER, '#---1----|----2----|----3----|----4----|----5----|----6----|----7----|----8----|----9----|---10----|');
const begin = beginBlock('ExplicitBarProbe');
const unitRow = '                  Mg                  mm                   s';
assert.deepEqual(begin, ['/BEGIN', 'ExplicitBarProbe', '      2026', unitRow, unitRow]);
assert.equal(begin[3].length, 60);
assert.deepEqual([0, 1, 2].map(i => field(begin[3], i, 20).trim()), ['Mg', 'mm', 's']);
assert.deepEqual(begin[4], begin[3]);
const bcs = bcsBlock(1);
assert.deepEqual(bcs, ['/BCS/1', 'Fixed translations', '   111 000         0         1']);
assert.deepEqual([0, 1, 2].map(i => field(bcs[2], i).trim()), ['111 000', '0', '1']);
assert.equal(bcs[2].slice(3, 6), '111');
assert.equal(bcs[2].slice(7, 10), '000');
const prop = solidTetra4Block();
assert.equal(prop[0], '/PROP/SOLID/1');
assert.deepEqual(Array.from({ length: 8 }, (_, i) => Number(field(prop[2], i))), [0, 1, 0, 0, 0, 0, 1000, 1]);
assert.equal(prop[2].length, 100);
assert.equal(prop[2].slice(80).trim(), '0');
assert.deepEqual(prop.slice(3, 5).map(row => row.length), [100, 100]);
assert.equal(prop[5], '         0         0         0');

const script = resolve(dirname(fileURLToPath(import.meta.url)), 'probe-sim9-openradioss-standalone.mts');
const probe = JSON.parse(execFileSync(process.execPath, [script], { encoding: 'utf8', env: process.env })) as {
  directory: string;
  receipt: { starterPath: string; enginePath: string; mesh: { integratedMassMg: number }; faces: { fixed: { nodeIds: number[] }; forceSumN: number } } };
const deck = readFileSync(probe.receipt.starterPath, 'utf8');
const lines = deck.split('\n');
const block = (keyword: string) => {
  const at = lines.indexOf(keyword);
  assert.ok(at >= 0, `Missing ${keyword}`);
  const next = lines.findIndex((line, i) => i > at && /^\//.test(line));
  return lines.slice(at, next < 0 ? undefined : next);
};
assert.deepEqual(lines.slice(0, 7), ['#RADIOSS STARTER', RADIOSSS_FIELD_RULER, ...begin]);
assert.deepEqual(block('/BCS/1'), bcs);
assert.deepEqual(block('/PROP/SOLID/1'), prop);
for (const keyword of ['/NODE', '/TETRA4/1', '/MAT/LAW1/1', '/PART/1', '/GRNOD/NODE/1',
  '/FUNCT/1', '/TH/NODE/1', '/END']) assert.ok(lines.includes(keyword));
assert.equal(block('/NODE').length - 1, 88);
assert.equal(block('/TETRA4/1').length - 1, 208);
for (const row of block('/NODE').slice(1)) {
  assert.equal(row.length, 70);
  assert.ok(Number.isSafeInteger(Number(field(row, 0))) && Number(field(row, 0)) > 0);
  for (let i = 0; i < 3; i++) assert.ok(Number.isFinite(Number(field(row.slice(10), i, 20))));
}
for (const row of block('/TETRA4/1').slice(1)) {
  assert.equal(row.length, 50);
  for (let i = 0; i < 5; i++) assert.ok(Number.isSafeInteger(Number(field(row, i))) && Number(field(row, i)) > 0);
}
assert.deepEqual(block('/GRNOD/NODE/1').slice(2).join('').match(/\d+/g)?.map(Number), [1, 2, 3, 4, 45]);
assert.deepEqual(probe.receipt.faces.fixed.nodeIds, [1, 2, 3, 4, 45]);
const material = block('/MAT/LAW1/1');
assert.equal(Number(material[2]), 7.8e-9);
assert.equal(Number(field(material[3], 0, 20)), 200000);
assert.equal(Number(field(material[3], 1, 20)), 0.3);
assert.deepEqual(block('/PART/1'), ['/PART/1', 'One elastic bar', '         1         1']);
assert.ok(Math.abs(probe.receipt.mesh.integratedMassMg - 7.8e-5) < 1e-12);
assert.equal(7.8e-5 * 1000, 0.078);
assert.equal(1 * 1000 * 1e-3, 1); // Mg*mm/s² = N; N/mm² = MPa.
assert.equal(probe.receipt.faces.forceSumN, 100);
let serializedForce = 0;
for (let i = 10; i <= 14; i++) {
  const group = block(`/GRNOD/NODE/${i}`);
  assert.equal(group.length, 3);
  assert.equal(Number(group[2]), [5, 6, 7, 8, 46][i - 10]);
  const load = block(`/CLOAD/${i}`);
  assert.equal(load.length, 3);
  assert.equal(field(load[2], 0).trim(), '1');
  assert.equal(field(load[2], 1).trim(), 'X');
  assert.equal(field(load[2], 4).trim(), String(i));
  serializedForce += Number(load[2].slice(-20));
}
assert.ok(Math.abs(serializedForce - 100) < 1e-10);
assert.equal(block('/FUNCT/1')[3].slice(0, 20).trim(), '1.000000000000e-5');
const engine = readFileSync(probe.receipt.enginePath, 'utf8');
assert.ok(engine.includes('1.000000000000e-5'));
assert.ok(engine.includes('1.000000000000e-6'));
assert.ok(!/\/(?:AMS|ADMAS|DAMP|DYREL|KEREL|INTER|INIVEL)/i.test(deck + engine));
console.log(JSON.stringify({ pass: true, ruler: RADIOSSS_FIELD_RULER,
  nodes: 88, elements: 208, massMg: probe.receipt.mesh.integratedMassMg,
  forceN: serializedForce, deck: probe.receipt.starterPath }));
