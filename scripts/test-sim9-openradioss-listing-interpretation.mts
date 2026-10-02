// Retained-output audit only. Never launches Starter, Engine, or a mesh generator.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bcsBlock, solidTetra4Block } from '../simulation-bridge/openRadiossStarterSerialization.mts';

const directory = process.env.OPENRADIOSS_RETAINED_PROBE_DIRECTORY;
if (!directory) throw new Error('OPENRADIOSS_RETAINED_PROBE_DIRECTORY is required');
const starter = readFileSync(join(directory, 'ExplicitBarProbe_0000.rad'), 'utf8').split(/\r?\n/);
const engine = readFileSync(join(directory, 'ExplicitBarProbe_0001.rad'), 'utf8').split(/\r?\n/);
const listing = readFileSync(join(directory, 'ExplicitBarProbe_0000.out'), 'utf8');
const receipt = JSON.parse(readFileSync(join(directory, 'pre-dispatch-receipt.json'), 'utf8'));
const block = (keyword: string) => {
  const first = starter.indexOf(keyword);
  assert.ok(first >= 0, `Missing ${keyword}`);
  const next = starter.findIndex((line, i) => i > first && line.startsWith('/'));
  return starter.slice(first, next < 0 ? undefined : next);
};

assert.deepEqual(receipt.faces.fixed.nodeIds, [1, 2, 3, 4, 45]);
assert.deepEqual(block('/GRNOD/NODE/1'), ['/GRNOD/NODE/1', 'Fixed x min',
  '         1         2         3         4        45']);
assert.deepEqual(block('/BCS/1'), bcsBlock(1));
const bcs = block('/BCS/1')[2];
assert.equal(bcs.slice(3, 6), '111');
assert.equal(bcs.slice(7, 10), '000');
assert.equal(Number(bcs.slice(10, 20)), 0);
assert.equal(Number(bcs.slice(20, 30)), 1);
const nodeRows = block('/NODE').slice(1);
for (const id of receipt.faces.fixed.nodeIds as number[]) {
  const node = nodeRows.find(row => Number(row.slice(0, 10)) === id);
  assert.ok(node);
  assert.equal(Number(node.slice(10, 30)), 0);
}
assert.match(listing, /IPRI\s*: PRINTOUT FLAG[^\r\n]*\s0\s*$/m);
assert.match(listing, /NUMBCS: NUMBER OF BOUNDARY CONDITIONS[^\r\n]*\s1\s*$/m);
assert.match(listing, /NORMAL TERMINATION/);
assert.match(listing, /0 ERROR\(S\)/);
assert.match(listing, /0 WARNING\(S\)/);
// Frozen printbcs.F prints node rows only when IPRI >= 2; IPRI=0 is not nonapplication evidence.
const bcsListing = listing.match(/BOUNDARY CONDITIONS\s*\r?\n\s*-+\s*\r?\n\s*NODE\s+TRANS\. ROTAT\.\s+SKEW([\s\S]*?)CONCENTRATED LOADS/);
assert.ok(bcsListing);
assert.equal(bcsListing[1].trim(), '');

assert.deepEqual(block('/PROP/SOLID/1'), solidTetra4Block());
assert.ok(!starter.some(line => /^\/DEF_SOLID(?:\/|$)/.test(line)));
assert.match(listing, /ITET4\s*: DEFAULT TETRA4 FORMULATION FLAG[^\r\n]*\s0\s*$/m);
assert.match(listing, /TETRA4 FORMULATION FLAG[^\r\n]*=\s*1000\s*$/m);
assert.match(listing, /Part id,name:\s*1 One elastic bar[^\r\n]*Elm type: TETRA4/);
assert.match(listing, /Isolid\s+Ismstr\s+Icpre\s+Iframe\s+IHKT\s+Itetra4\s+Itetra10[^\r\n]*\r?\n\s*1\s+1\s+0\s+1\s+0\s+0\s+0/);
// Frozen hm_read_prop14.F stores 1000 in IGEO(20). Frozen sgrtails.F reads
// IGEO(20), maps 1000 to its internal part-group code 0, and places that in
// IPARG(41); initia.F prints IPARG(41) in the part review.
assert.equal(Number(block('/PROP/SOLID/1')[2].slice(60, 70)), 1000);

assert.equal(engine.filter(line => line === '/DT/NODA').length, 1);
assert.ok(!engine.some(line => /^\/(?:DT\/NODA\/(?:CST|CST1|CST2|SET|STOP)|DT\/AMS|AMS|ADMAS)/i.test(line)));
const dt = engine[engine.indexOf('/DT/NODA') + 1];
assert.equal(Number(dt.slice(0, 20)), 0.9);
assert.equal(Number(dt.slice(20, 40)), 0);
assert.match(listing, /TOTAL ADDED MASS\s*=\s*0\.000000000000/);
assert.match(listing, /INITIAL ADDED MASS ESTIMATION for \/DT\/NODA\/CST/);
console.log(JSON.stringify({ pass: true, propertyDeclared: 1000,
  partReview: 0, fixedNodes: receipt.faces.fixed.nodeIds,
  listingPrintLevel: 0, dtCard: '/DT/NODA', dtScale: 0.9, dtMinimum: 0 }));
