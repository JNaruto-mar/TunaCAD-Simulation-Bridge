import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  differentiateVerifiedReactionImpulse, identifyConversionArtifacts,
  inspectOpenRadiossConverter, parseOpenRadiossConvertedCsv,
  planOpenRadiossConversion,
} from '../simulation-bridge/openRadiossBinaryHistoryRecovery.mts';

const converter = process.env.OPENRADIOSS_CONVERTER_PATH;
if (!converter) throw new Error('OPENRADIOSS_CONVERTER_PATH is required');
const identity = await inspectOpenRadiossConverter(converter);
assert.ok(identity.sha256.length === 64 && identity.bytes > 1024);
const plan = planOpenRadiossConversion(converter, 'C:\\R\\ExplicitBarProbeT01');
assert.deepEqual(plan.args, ['C:\\R\\ExplicitBarProbeT01']);
assert.equal(plan.outputPath, 'C:\\R\\ExplicitBarProbeT01.csv');
assert.throws(() => planOpenRadiossConversion(converter, 'C:\\R\\bad.csv'), /T-file name/);
assert.throws(() => planOpenRadiossConversion(converter, `${'C:\\R\\'}${'x'.repeat(90)}T01`), /T-file name|path exceeds/);
assert.throws(() => identifyConversionArtifacts(Buffer.from([1]), Buffer.from('ok'), 1), /converter failed/);
const artifacts = identifyConversionArtifacts(Buffer.from([1]), Buffer.from('ok'), 0);
assert.equal(artifacts.inputSha256.length, 64);
assert.equal(artifacts.csvSha256.length, 64);

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),
  'probe-sim9-openradioss-standalone.mts'), 'utf8');
assert.match(source, /'\/TFILE\/4', formatFloat\(1e-6\)/);
assert.doesNotMatch(source, /'\/TFILE\/3'/);
assert.match(source, /'DX', 'VX', 'AX', 'REACX'/);
assert.doesNotMatch(source, /'\/TH\/TITLE'/);

const nodeIds = [1, 2, 3, 4, 5, 6, 7, 8, 45, 46];
const globalNames = [
  'INTERNAL ENERGY', 'KINETIC ENERGY', 'X-MOMENTUM', 'Y-MOMENTUM', 'Z-MOMENTUM',
  'MASS', 'TIME STEP', 'ROTATION ENERGY', 'EXTERNAL WORK', 'SPRING ENERGY',
  'CONTACT ENERGY', 'HOURGLASS ENERGY', 'ELASTIC CONTACT ENERGY',
  'FRICTIONAL CONTACT ENERGY', 'DAMPING CONTACT ENERGY ', 'PLASTIC WORK',
  'ADDED MASS', 'PERCENTAGE ADDED MASS', 'INLET MASS', 'OUTLET MASS',
  'INLET ENERGY', 'OUTLET ENERGY',
];
const header = ['time', ...globalNames].map(name => `"${name}"`);
for (const id of nodeIds) {
  for (let channel = 0; channel < 4; channel++) {
    header.push(`"Bounded axial bar nodes ${id} node_${id} var ${header.length}"`);
  }
}
assert.equal(header.length, 63);
const frame = (timeS: number) => {
  const numbers = Array(63).fill(0);
  numbers[0] = timeS;
  numbers[1] = timeS * 2; // IE
  numbers[2] = timeS * 3; // KE
  numbers[6] = 7.8e-5; // mass Mg
  numbers[9] = timeS * 5; // work
  for (let i = 0; i < 10; i++) numbers[23 + i * 4 + 3] = timeS * i; // CSV reaction column; provenance unverified
  return numbers.join(',');
};
const csv = [header.join(','), frame(0), frame(1e-6), frame(2e-6)].join('\n') + '\n';
const parsed = parseOpenRadiossConvertedCsv(csv, nodeIds, 2e-6);
assert.equal(parsed.frames.length, 3);
assert.equal(parsed.columnCount, 63);
assert.equal(parsed.reactionProvenance, 'unverified_converter_column');
assert.equal(parsed.frames[1].global.massMg, 7.8e-5);
assert.equal(parsed.frames[1].global.kineticEnergyNmm, 3e-6);
assert.equal(parsed.frames[1].nodes.get(5)?.reactionCsvValue, 4e-6);
assert.throws(() => parseOpenRadiossConvertedCsv(csv.replace(frame(2e-6), frame(2e-6).split(',').slice(0, -1).join(',')),
  nodeIds, 2e-6), /Incomplete or excess/);
assert.throws(() => parseOpenRadiossConvertedCsv(csv.replace(frame(2e-6) + '\n', ''), nodeIds, 2e-6), /required positive-time/);
assert.throws(() => parseOpenRadiossConvertedCsv(csv.replace(frame(1e-6), frame(0)), nodeIds, 2e-6), /frame time/);
assert.throws(() => parseOpenRadiossConvertedCsv(csv.replace('node_5 var 39', 'node_6 var 39'), nodeIds, 2e-6), /node\/channel/);
assert.throws(() => parseOpenRadiossConvertedCsv(csv.replace('KINETIC ENERGY', 'INTERNAL ENERGY'), nodeIds, 2e-6), /global/);
const nonfiniteEnergy = csv.replace(frame(1e-6), frame(1e-6).split(',').map((v, i) => i === 2 ? 'NaN' : v).join(','));
assert.throws(() => parseOpenRadiossConvertedCsv(nonfiniteEnergy, nodeIds, 2e-6), /non-finite/);
const mutateMass = (value: string) => csv.replace(frame(1e-6),
  frame(1e-6).split(',').map((v, i) => i === 6 ? value : v).join(','));
assert.throws(() => parseOpenRadiossConvertedCsv(mutateMass('Infinity'), nodeIds, 2e-6), /non-finite/);
assert.throws(() => parseOpenRadiossConvertedCsv(mutateMass('0'), nodeIds, 2e-6), /total mass/);
assert.throws(() => parseOpenRadiossConvertedCsv(csv.slice(0, -1), nodeIds, 2e-6), /final line/);
const noScaling = csv.replace(frame(1e-6), frame(1e-6).split(',').map((v, i) => i === 17 ? '1e-3' : v).join(','));
assert.throws(() => parseOpenRadiossConvertedCsv(noScaling, nodeIds, 2e-6), /mass scaling/);

const derived = differentiateVerifiedReactionImpulse([0, 1, 2, 3], [0, 1, 4, 9]);
assert.deepEqual(derived.map(row => row.derivedReactionN), [1, 2, 4, 5]);
assert.deepEqual(derived.map(row => row.rawImpulseNs), [0, 1, 4, 9]);
assert.throws(() => differentiateVerifiedReactionImpulse([0, 1, 1], [0, 1, 2]), /unordered/);
assert.throws(() => differentiateVerifiedReactionImpulse([0, 1], [0, Infinity]), /non-finite/);
console.log(JSON.stringify({ pass: true, converterSha256: identity.sha256,
  deck: '/TFILE/4', titles: 'omitted to avoid converter-side impulse differentiation',
  csvSchema: 'time + 22 globals + 10 nodes x 4 channels',
  reactionProvenance: 'unverified_converter_column; raw binary impulse cross-check still required' }));
