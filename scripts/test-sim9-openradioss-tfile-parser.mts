import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseOpenRadiossAxialTFile } from '../simulation-bridge/openRadiossTFileParser.mts';

// No solver is launched. The retained authentic output is supplied from isolated
// local storage; it must never be copied into the public Bridge repository.
const file = process.env.OPENRADIOSS_RETAINED_TFILE;
if (!file) throw new Error('OPENRADIOSS_RETAINED_TFILE is required');
const retained = readFileSync(file);
const text = retained.toString('utf8');
const nodes = [1, 2, 3, 4, 5, 6, 7, 8, 45, 46];
const frameMarker = 'ZZZZZEOR    1R\r\n  4.31235100E-06';
const fifth = text.indexOf(frameMarker);
assert.ok(fifth > 0, 'Authentic fifth frame present');
const prefix = text.slice(0, fifth);
const parsed = parseOpenRadiossAxialTFile(prefix, nodes, 3.35405078e-6);
assert.equal(parsed.frames.length, 4);
assert.deepEqual(parsed.channelCodes, [1, 4, 7, 620]);
assert.equal(parsed.frames[1].nodal.get(5)?.dxMm, 3.55100371e-5);
assert.equal(parsed.frames[1].nodal.get(1)?.reacXN, 0);
assert.equal(parsed.frames[1].global[0], 0.00148384799); // IE
assert.equal(parsed.frames[1].global[1], 0.00183382378); // KE
assert.equal(parsed.frames[1].global[8], 0.00339110704); // EFW
assert.throws(() => parseOpenRadiossAxialTFile(retained, nodes, 3.35405078e-6), /Incomplete 40R record: 15\/40/);
assert.throws(() => parseOpenRadiossAxialTFile(prefix, nodes, 1e-5), /do not cover required result interval/);
assert.throws(() => parseOpenRadiossAxialTFile(prefix.slice(0, -1), nodes, 3.35405078e-6), /complete line/);
assert.throws(() => parseOpenRadiossAxialTFile(prefix.replace('         1         4         7       620',
  '         1         4         7         7'), nodes, 3.35405078e-6), /nodal channel/);
assert.throws(() => parseOpenRadiossAxialTFile(prefix.replace('         1         4         7       620',
  '         4         1         7       620'), nodes, 3.35405078e-6), /nodal channel/);
assert.throws(() => parseOpenRadiossAxialTFile(prefix.replace('         2node_2', '         1node_1'),
  nodes, 3.35405078e-6), /node/);
assert.throws(() => parseOpenRadiossAxialTFile(prefix.replace('         2node_2', '         9node_9'),
  nodes, 3.35405078e-6), /node/);
assert.throws(() => parseOpenRadiossAxialTFile(prefix.replace('         2node_2', '         Xnode_X')
  .replace('         3node_3', '         2node_2').replace('         Xnode_X', '         3node_3'),
  nodes, 3.35405078e-6), /node/);
assert.throws(() => parseOpenRadiossAxialTFile(prefix.replace('ZZZZZEOR   22R', 'ZZZZZEOR   21R'),
  nodes, 3.35405078e-6), /global frame record/);
assert.throws(() => parseOpenRadiossAxialTFile(prefix.replace('  1.48384799E-03', '           NaN'),
  nodes, 3.35405078e-6), /Malformed or non-finite/);
assert.throws(() => parseOpenRadiossAxialTFile(prefix.replace('  1.48384799E-03', '      Infinity'),
  nodes, 3.35405078e-6), /Malformed or non-finite/);
assert.throws(() => parseOpenRadiossAxialTFile(prefix.replace('  1.43745033E-06', '  0.00000000E+00'),
  nodes, 3.35405078e-6), /frame time/);
assert.throws(() => parseOpenRadiossAxialTFile(prefix, [...nodes].reverse(), 3.35405078e-6), /node/);
console.log('PASS: authentic complete prefix, strict incomplete-tail rejection, interval, header/cardinality, identity/order, non-finite and frame-time checks');
