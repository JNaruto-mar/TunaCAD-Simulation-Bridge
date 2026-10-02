import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assessExplicitC3D4Mesh, calculix216C3D4CriticalStepS,
  assertCalculiX216ExplicitFixedStep }
  from '../providers/calculix/ExplicitDynamicsMeshAdmission.mts';
import { createExplicitDiagnosticReceipt }
  from '../providers/calculix/ExplicitDynamicsDiagnosticReceipt.mts';
import { sealExplicitDynamics, type ExplicitDynamicsDraft }
  from '../simulation-bridge/explicitDynamicsFoundation.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';

const geometryDigest = digest('controlled no-solver explicit bar');
const draft: ExplicitDynamicsDraft = {
  schema: 'tunacad-explicit-dynamics-foundation/0.1', studyId: 'explicit-diagnostic-only',
  analysis: { type: 'explicit_structural_dynamics',
    assumptions: ['one_linear_elastic_solid', 'small_displacement',
      'zero_initial_conditions', 'undamped', 'no_contact', 'no_mass_scaling'],
    durationS: 1e-5, outputTimesS: [5e-6, 1e-5],
    integration: { kind: 'central_difference_cfl_bound',
      minimumCharacteristicLengthMm: 5, safetyFactor: 0.8,
      maximumTimeStepS: 1e-7, maximumIncrements: 20_000 } },
  model: { projectRevision: 'controlled-r1', domainId: 'bar', partId: 'bar-part',
    bodyId: 'bar-body', geometryDigest, kind: 'straight_rectangular_axial_bar',
    lengthMm: 100, widthMm: 10, heightMm: 10,
    fixedFaceId: 'x-min', loadedFaceId: 'x-max' },
  material: { materialId: 'steel', domainId: 'bar', model: 'isotropic_linear_elastic',
    youngsModulusMPa: 200_000, poissonRatio: 0.3, densityKgM3: 7800,
    source: { kind: 'custom', reference: 'no-solver diagnostic', revision: 'r1' } },
  initialConditions: { displacementMm: [0, 0, 0], velocityMmPerS: [0, 0, 0] },
  restraint: { kind: 'fixed_face', faceId: 'x-min', displacementMm: [0, 0, 0] },
  load: { kind: 'axial_step_face_force', faceId: 'x-max', onsetS: 0,
    forceN: [100, 0, 0], coordinateSystem: 'analysis',
    history: 'constant_after_onset' },
  mesh: { elementFormulation: 'C3D4', maximumNodes: 100_000,
    maximumElements: 50_000 },
  requestedResults: ['loaded_face_axial_displacement_history',
    'fixed_face_axial_reaction_history', 'kinetic_energy_history',
    'strain_energy_history', 'applied_work_history'],
  units: { length: 'mm', time: 's', force: 'N', stress: 'MPa',
    density: 'kg/m^3', velocity: 'mm/s', acceleration: 'mm/s^2', energy: 'N*mm' },
};
const request = sealExplicitDynamics(draft);
const xyz: Array<[number, number, number]> = [
  [0, 0, 0], [100, 0, 0], [100, 10, 0], [0, 10, 0],
  [0, 0, 10], [100, 0, 10], [100, 10, 10], [0, 10, 10],
];
const determinant = (ids: number[]) => {
  const [a, b, c, d] = ids.map(id => xyz[id - 1]);
  const ab = b.map((v, i) => v - a[i]);
  const ac = c.map((v, i) => v - a[i]);
  const ad = d.map((v, i) => v - a[i]);
  return (ab[0] * (ac[1] * ad[2] - ac[2] * ad[1])
    - ab[1] * (ac[0] * ad[2] - ac[2] * ad[0])
    + ab[2] * (ac[0] * ad[1] - ac[1] * ad[0]));
};
const rawTets = [[1, 2, 3, 7], [1, 3, 4, 7], [1, 4, 8, 7],
  [1, 8, 5, 7], [1, 5, 6, 7], [1, 6, 2, 7]];
const elements = rawTets.map((tet, i) => {
  const ids = determinant(tet) > 0 ? tet : [tet[0], tet[2], tet[1], tet[3]];
  return { id: i + 1, type: 'C3D4' as const,
    nodes: ids as [number, number, number, number] };
});
const facets = new Map<string, { ids: [number, number, number]; uses: number }>();
for (const tet of elements) for (let opposite = 0; opposite < 4; opposite++) {
  const ids = tet.nodes.filter((_, index) => index !== opposite) as [number, number, number];
  const key = [...ids].sort((a, b) => a - b).join(',');
  const old = facets.get(key);
  facets.set(key, { ids, uses: (old?.uses ?? 0) + 1 });
}
const mesh = { runtime: 'Gmsh 4.15.2' as const, inputGeometryDigest: geometryDigest,
  nodes: xyz.map((point, i) => ({ id: i + 1, xyzMm: point })), elements,
  surfaceTriangles: [...facets.values()].filter(f => f.uses === 1)
    .map((f, i) => ({ id: i + 1, nodes: f.ids })) };
const admitted = assessExplicitC3D4Mesh(request, mesh);
assert.equal(admitted.nodeCount, 8);
assert.equal(admitted.elementCount, 6);
assert.equal(admitted.materialAssignedElementCount, 6);
assert.ok(Math.abs(admitted.meshMassKg - 0.078) < 1e-12);
assert.ok(admitted.minimumNodalMassKg > 0);
assert.ok(admitted.selectedTimeStepS < admitted.providerCriticalTimeStepS);
assert.ok(admitted.selectedTimeStepS <= 0.8 * admitted.providerCriticalTimeStepS);
const orphan = structuredClone(mesh);
orphan.nodes.push({ id: 9, xyzMm: [50, 5, 5] });
assert.throws(() => assessExplicitC3D4Mesh(request, orphan), /unused node/);
const n = (value: number) => value.toExponential(12);
const forcePerNode = 100 / admitted.loadedFace.nodeIds.length;
const deck = [
  '*HEADING', '*NODE, NSET=NALL', '*ELEMENT, TYPE=C3D4, ELSET=EALL',
  '*NSET, NSET=FIXED', admitted.fixedFace.nodeIds.join(','),
  '*NSET, NSET=LOADED', admitted.loadedFace.nodeIds.join(','),
  '*MATERIAL, NAME=STEEL', '*ELASTIC', '200000,0.3',
  '*DENSITY', n(7800 * 1e-12),
  '*SOLID SECTION, ELSET=EALL, MATERIAL=STEEL',
  '*STEP, INC=' + (admitted.incrementCount + 2) + ', AMPLITUDE=STEP',
  '*DYNAMIC, DIRECT, EXPLICIT=2, ALPHA=0',
  n(admitted.selectedTimeStepS) + ',' + n(request.analysis.durationS),
  '*BOUNDARY', 'FIXED,1,3,0', '*CLOAD',
  ...admitted.loadedFace.nodeIds.map(id => id + ',1,' + n(forcePerNode)),
  '*END STEP', '',
].join('\n');
const receipt = createExplicitDiagnosticReceipt(request, admitted, deck);
assert.deepEqual(createExplicitDiagnosticReceipt(request, admitted, deck), receipt);
assert.ok(receipt.time.exactExpectedIncrements >= admitted.incrementCount);
assert.ok(receipt.time.exactExpectedIncrements <= admitted.incrementCount + 1);
assert.equal(receipt.procedure.valueCount, 2);
assert.equal(receipt.procedure.massScalingPermitted, false);
const rejectDeck = (changed: string) => assert.throws(
  () => createExplicitDiagnosticReceipt(request, admitted, changed),
  /EXPLICIT_DIAGNOSTIC_INVALID/);
rejectDeck(deck.replace('EXPLICIT=2', 'EXPLICIT=1'));
rejectDeck(deck.replace(n(request.analysis.durationS), n(request.analysis.durationS) + ',1e-9'));
rejectDeck(deck.replace(n(7800 * 1e-12), '1e-5'));
rejectDeck(deck.replace('AMPLITUDE=STEP', 'AMPLITUDE=RAMP'));
rejectDeck(deck.replace('FIXED,1,3,0', 'FIXED,1,1,0'));
rejectDeck(deck.replace(n(forcePerNode), n(forcePerNode / 2)));
const oldStep = deck.replace(n(admitted.selectedTimeStepS), n(9.900990099010e-8));
rejectDeck(oldStep);
const insufficient = structuredClone(draft);
insufficient.analysis.integration.maximumIncrements = 110;
assert.throws(() => assessExplicitC3D4Mesh(sealExplicitDynamics(insufficient), mesh),
  /excessive increments/);

// Optional retained real-provider evidence replay. It reads only the bounded
// FRD extract; it never launches Gmsh or CalculiX and never maps NaN to zero.
if (process.env.TUNACAD_EXPLICIT_RETAINED_FRD) {
  const frd = await readFile(process.env.TUNACAD_EXPLICIT_RETAINED_FRD, 'utf8');
  const rows = frd.split(/\r?\n/);
  const nodeStart = rows.findIndex(row => /^\s*2C\s/.test(row));
  const elementStart = rows.findIndex(row => /^\s*3C\s/.test(row));
  assert.ok(nodeStart > 0 && elementStart > nodeStart);
  const pointById = new Map<number, [number, number, number]>();
  for (const row of rows.slice(nodeStart + 1, elementStart)) {
    if (!/^\s*-1\s/.test(row)) continue;
    const [marker, id, x, y, z] = row.trim().split(/\s+/).map(Number);
    assert.equal(marker, -1);
    pointById.set(id, [x, y, z]);
  }
  const tetRows: number[][] = [];
  for (let i = elementStart + 1; i + 1 < rows.length; i++) {
    if (/^\s*-3\s*$/.test(rows[i])) break;
    if (!/^\s*-1\s/.test(rows[i])) continue;
    const values = rows[i + 1].trim().split(/\s+/).map(Number);
    assert.equal(values[0], -2);
    tetRows.push(values.slice(1));
    i++;
  }
  assert.equal(pointById.size, 88);
  assert.equal(tetRows.length, 208);
  const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
  const cross = (a: number[], b: number[]) => [a[1]*b[2]-a[2]*b[1],
    a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  let retainedAltitudeMm = Infinity;
  for (const ids of tetRows) {
    const [a, b, c, d] = ids.map(id => pointById.get(id)!);
    const ab = sub(b,a), ac = sub(c,a), ad = sub(d,a);
    const volume = Math.abs(cross(ab,ac).reduce((sum,v,i) => sum+v*ad[i],0))/6;
    const areas = [cross(sub(c,b),sub(d,b)), cross(ac,ad),
      cross(ab,ad), cross(ab,ac)].map(vec => Math.hypot(...vec)/2);
    retainedAltitudeMm = Math.min(retainedAltitudeMm, 3*volume/Math.max(...areas));
  }
  const retainedCriticalS = calculix216C3D4CriticalStepS(retainedAltitudeMm,
    5_875_097.0448151799);
  assert.ok(Math.abs(retainedCriticalS/3.315458e-8-1) < 2e-6);
  assert.ok(9.900990099010e-8 > retainedCriticalS);
  assert.throws(() => assertCalculiX216ExplicitFixedStep(9.900990099010e-8,
    retainedCriticalS, 0.8, 1e-5, 20_000), /fixed step exceeds CalculiX/);
  const newCount = Math.ceil(1e-5 / (retainedCriticalS * 0.8));
  const newStepS = 1e-5 / newCount;
  assert.equal(newCount, 378);
  assertCalculiX216ExplicitFixedStep(newStepS, retainedCriticalS, 0.8, 1e-5, 20_000);
  const inspectFirst = (label: string, source: string) => {
    const data = source.split(/\r?\n/);
    const at = data.findIndex(row => row.includes('-4  ' + label));
    assert.ok(at > 0);
    const bad: number[] = [];
    let count = 0;
    for (let i = at + 1; i < data.length; i++) {
      if (/^\s*-3\s*$/.test(data[i])) break;
      if (!/^\s*-1\s/.test(data[i])) continue;
      const [marker, id, ...components] = data[i].trim().split(/\s+/).map(Number);
      assert.equal(marker, -1);
      if (components.some(value => !Number.isFinite(value))) bad.push(id);
      count++;
    }
    assert.equal(count, 88);
    return bad;
  };
  assert.deepEqual(inspectFirst('DISP', frd), []);
  assert.deepEqual(inspectFirst('VELO', frd), [1, 2, 3, 4, 45]);
  const requireFinite = (label: string) => {
    const bad = inspectFirst(label, frd);
    if (bad.length) throw new Error('EXPLICIT_FRAME_NONFINITE: ' + label + ' nodes ' + bad.join(','));
  };
  requireFinite('DISP');
  assert.throws(() => requireFinite('VELO'), /EXPLICIT_FRAME_NONFINITE: VELO/);
  const frameTimes = rows.filter(row => /^\s*100CL\s/.test(row))
    .map(row => Number(row.trim().split(/\s+/)[2]));
  assert.ok(frameTimes.length >= 6 && frameTimes.every(time => time === 0));
  console.log(JSON.stringify({ retainedNodes: pointById.size, retainedTets: tetRows.length,
    retainedAltitudeMm, retainedCriticalS, firstVelocityNonfiniteNodes: [1,2,3,4,45],
    capturedFrameHeaders: frameTimes.length, allCapturedTimesZero: true }));
}
const isolated = await mkdtemp(join(tmpdir(), 'tunacad-explicit-receipt-test-'));
try {
  const scratch = join(isolated, 'solver-scratch');
  await mkdir(scratch);
  const path = join(isolated, 'pre-dispatch-receipt.json');
  await writeFile(path, JSON.stringify(receipt) + '\n', { encoding: 'utf8', flag: 'wx' });
  await rm(scratch, { recursive: true });
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), receipt);
} finally {
  await rm(isolated, { recursive: true, force: true });
}
console.log(JSON.stringify({ status: 'PASS', kind: 'no-solver explicit diagnostic',
  meshMassKg: admitted.meshMassKg, expectedIncrements: admitted.incrementCount,
  receiptDigest: receipt.receiptDigest }));
