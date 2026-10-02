// Standalone, one-run diagnostic deck preparation only. Never launches a solver.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beginBlock, bcsBlock, solidTetra4Block, RADIOSSS_FIELD_RULER } from '../simulation-bridge/openRadiossStarterSerialization.mts';

const source = process.env.TUNACAD_EXPLICIT_RETAINED_FRD;
const starterExe = process.env.OPENRADIOSS_STARTER_PATH;
const engineExe = process.env.OPENRADIOSS_ENGINE_PATH;
if (!source || !starterExe || !engineExe) {
  throw new Error('Diagnostic source and installed executable paths must be provided through environment variables');
}
const name = 'ExplicitBarProbe';
const mmTolerance = 1e-6;
const formatInt = (value: number) => String(value).padStart(10);
const formatFloat = (value: number) => value.toExponential(12).padStart(20);
const sha256 = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');

const frd = await readFile(source, 'utf8');
const rows = frd.split(/\r?\n/);
const nodeStart = rows.findIndex(row => /^\s*2C\s/.test(row));
const elementStart = rows.findIndex(row => /^\s*3C\s/.test(row));
assert.ok(nodeStart >= 0 && elementStart > nodeStart);
const nodes = new Map<number, [number, number, number]>();
for (const row of rows.slice(nodeStart + 1, elementStart)) {
  if (!/^\s*-1\s/.test(row)) continue;
  const [mark, id, x, y, z] = row.trim().split(/\s+/).map(Number);
  assert.equal(mark, -1);
  assert.ok(Number.isSafeInteger(id) && id > 0 && !nodes.has(id));
  assert.ok([x, y, z].every(Number.isFinite));
  nodes.set(id, [x, y, z]);
}
const elements: Array<{ id: number; ids: [number, number, number, number] }> = [];
for (let i = elementStart + 1; i + 1 < rows.length; i++) {
  if (/^\s*-3\s*$/.test(rows[i])) break;
  if (!/^\s*-1\s/.test(rows[i])) continue;
  const header = rows[i].trim().split(/\s+/).map(Number);
  const connectivity = rows[++i].trim().split(/\s+/).map(Number);
  assert.equal(header[0], -1);
  assert.equal(connectivity[0], -2);
  assert.equal(connectivity.length, 5);
  const ids = connectivity.slice(1) as [number, number, number, number];
  assert.ok(ids.every(id => nodes.has(id)));
  assert.equal(new Set(ids).size, 4);
  elements.push({ id: header[1], ids });
}
assert.equal(nodes.size, 88);
assert.equal(elements.length, 208);
assert.equal(new Set(elements.map(e => e.id)).size, 208);
const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
const cross = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
const signedVolume = (ids: number[]) => {
  const [a, b, c, d] = ids.map(id => nodes.get(id)!);
  return dot(sub(b, a), cross(sub(c, a), sub(d, a))) / 6;
};
let orientationReversals = 0;
let totalVolume = 0;
const facetUses = new Map<string, { ids: [number, number, number]; uses: number }>();
for (const element of elements) {
  const volume = signedVolume(element.ids);
  assert.ok(Number.isFinite(volume) && Math.abs(volume) > 1e-10);
  if (volume < 0) {
    [element.ids[1], element.ids[2]] = [element.ids[2], element.ids[1]];
    orientationReversals++;
  }
  totalVolume += Math.abs(volume);
  for (let opposite = 0; opposite < 4; opposite++) {
    const ids = element.ids.filter((_, i) => i !== opposite) as [number, number, number];
    const key = [...ids].sort((a, b) => a - b).join(',');
    const previous = facetUses.get(key);
    facetUses.set(key, { ids, uses: (previous?.uses ?? 0) + 1 });
  }
}
assert.ok(Math.abs(totalVolume - 10000) < 1e-5);
const boundary = [...facetUses.values()].filter(f => f.uses === 1);
const face = (x: number) => {
  const facets = boundary.filter(f => f.ids.every(id => Math.abs(nodes.get(id)![0] - x) <= mmTolerance));
  const nodeIds = [...new Set(facets.flatMap(f => f.ids))].sort((a, b) => a - b);
  const weights = new Map<number, number>();
  let area = 0;
  for (const f of facets) {
    const [a, b, c] = f.ids.map(id => nodes.get(id)!);
    const normal = cross(sub(b, a), sub(c, a));
    const triangleArea = Math.hypot(...normal) / 2;
    assert.ok(triangleArea > 0 && Number.isFinite(triangleArea));
    area += triangleArea;
    for (const id of f.ids) weights.set(id, (weights.get(id) ?? 0) + triangleArea / 3);
  }
  assert.ok(Math.abs(area - 100) < 1e-8);
  assert.equal(nodeIds.length, 5);
  return { facets: facets.length, nodeIds, weights, area };
};
const fixed = face(0);
const loaded = face(100);
assert.equal([...fixed.nodeIds].filter(id => loaded.nodeIds.includes(id)).length, 0);
const forceByNode = loaded.nodeIds.map((id, index) => {
  const preceding = loaded.nodeIds.slice(0, index).reduce(
    (sum, earlier) => sum + Number((100 * loaded.weights.get(earlier)! / loaded.area).toExponential(12)), 0);
  const forceN = index === loaded.nodeIds.length - 1
    ? Number((100 - preceding).toExponential(12))
    : Number((100 * loaded.weights.get(id)! / loaded.area).toExponential(12));
  return { id, forceN };
});
const forceSumN = forceByNode.reduce((sum, f) => sum + f.forceN, 0);
assert.ok(Math.abs(forceSumN - 100) < 1e-12);
const densityMgPerMm3 = 7.8e-9;
const massMg = totalVolume * densityMgPerMm3;
const massKg = massMg * 1000;
assert.ok(Math.abs(massKg - 0.078) < 1e-12);

const starter: string[] = [
  '#RADIOSS STARTER', RADIOSSS_FIELD_RULER, ...beginBlock(name),
  '/NODE',
];
for (const [id, xyz] of [...nodes].sort((a, b) => a[0] - b[0]))
  starter.push(formatInt(id) + xyz.map(formatFloat).join(''));
starter.push('/TETRA4/1');
for (const element of elements.sort((a, b) => a.id - b.id))
  starter.push([element.id, ...element.ids].map(formatInt).join(''));
starter.push(
  '/MAT/LAW1/1', 'Steel elastic', formatFloat(densityMgPerMm3),
  formatFloat(200000) + formatFloat(0.3),
  ...solidTetra4Block(),
  '/PART/1', 'One elastic bar', formatInt(1) + formatInt(1),
  '/GRNOD/NODE/1', 'Fixed x min', fixed.nodeIds.map(formatInt).join(''),
  ...bcsBlock(1),
  '/FUNCT/1', 'Axial step from t zero', formatFloat(0) + formatFloat(1),
  formatFloat(1e-5) + formatFloat(1),
);
for (let index = 0; index < forceByNode.length; index++) {
  const { id, forceN } = forceByNode[index];
  const groupId = 10 + index;
  starter.push(`/GRNOD/NODE/${groupId}`, `Load node ${id}`, formatInt(id),
    `/CLOAD/${groupId}`, `Axial force on ${id}`,
    formatInt(1) + 'X'.padStart(10) + formatInt(0) + formatInt(0)
      + formatInt(groupId) + formatInt(0) + formatFloat(1) + formatFloat(forceN));
}
starter.push('/TH/NODE/1', 'Bounded axial bar nodes',
  ['DX', 'VX', 'AX', 'REACX'].map(v => v.padEnd(10)).join(''));
for (const id of [...fixed.nodeIds, ...loaded.nodeIds])
  starter.push(formatInt(id) + formatInt(0) + `node_${id}`);
starter.push('/END', '');
const engine = [
  `/RUN/${name}/1`, formatFloat(1e-5), '/VERS/2026',
  '/DT/NODA', formatFloat(0.9) + formatFloat(0),
  '/TFILE/4', formatFloat(1e-6), '/PRINT/-1', '',
].join('\n');
const starterText = starter.join('\n');
const forbidden = /\/(?:AMS|ADMAS|DAMP|DYREL|KEREL|INTER|INIVEL|IMPLICIT|DT\/[^\r\n]*\/(?:CST|AMS|DEL|SET))/i;
assert.ok(!forbidden.test(starterText + '\n' + engine));
assert.ok(engine.includes('/DT/NODA\n'));
const directory = await mkdtemp(join(tmpdir(), 'tunacad-openradioss-explicit-probe-'));
const starterPath = join(directory, `${name}_0000.rad`);
const enginePath = join(directory, `${name}_0001.rad`);
await writeFile(starterPath, starterText, 'utf8');
await writeFile(enginePath, engine, 'utf8');
const receipt = {
  schema: 'tunacad-openradioss-standalone-probe/0.1',
  status: 'prepared_only_no_solver_dispatched',
  sourceFrd: source, sourceSha256: sha256(frd),
  starterPath, starterSha256: sha256(starterText),
  enginePath, engineSha256: sha256(engine),
  binaryPaths: { starterExe, engineExe },
  binarySha256: {
    starter: sha256(await readFile(starterExe)),
    engine: sha256(await readFile(engineExe)),
  },
  mesh: { nodes: nodes.size, elements: elements.length, positiveVolumeMm3: totalVolume,
    orientationReversals, expectedMassMg: 7.8e-5, integratedMassMg: massMg, expectedMassKg: 0.078, integratedMassKg: massKg },
  faces: { fixed: { nodeIds: fixed.nodeIds, areaMm2: fixed.area, facets: fixed.facets },
    loaded: { nodeIds: loaded.nodeIds, areaMm2: loaded.area, facets: loaded.facets },
    forceByNode, forceSumN },
  material: { E_MPa: 200000, nu: 0.3, density_Mg_mm3: densityMgPerMm3 },
  time: { durationS: 1e-5, historyIntervalS: 1e-6,
    historyFormat: 'binary_ieee32_TFILE_4',
    titlesCard: 'omitted_to_preserve_raw_reaction_impulse',
    control: '/DT/NODA; scale=0.9; minimum=0', maximumIncrements: 20000 },
  invariants: { zeroInitialState: true, noMassScalingCards: true,
    noDampingContactPlasticityOrMultidomain: true },
};
await writeFile(join(directory, 'pre-dispatch-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
process.stdout.write(JSON.stringify({ directory, receipt }, null, 2) + '\n');
