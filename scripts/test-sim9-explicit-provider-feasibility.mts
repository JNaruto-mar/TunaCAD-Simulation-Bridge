import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnProviderProcess, terminateChildProcess }
  from '../providers/processLifecycle.mts';
import { assessExplicitC3D4Mesh, type ExplicitC3D4Mesh }
  from '../providers/calculix/ExplicitDynamicsMeshAdmission.mts';
import { createExplicitDiagnosticReceipt }
  from '../providers/calculix/ExplicitDynamicsDiagnosticReceipt.mts';
import { sealExplicitDynamics, type ExplicitDynamicsDraft }
  from '../simulation-bridge/explicitDynamicsFoundation.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const ccx = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (!gmsh || !ccx) throw new Error('Explicit installed Gmsh and CalculiX paths required.');
const geo = ['SetFactory("OpenCASCADE");', 'Box(1) = {0,0,0,100,10,10};',
  'Mesh.MeshSizeMin = 10;', 'Mesh.MeshSizeMax = 10;',
  'Mesh.ElementOrder = 1;', 'Mesh.MshFileVersion = 2.2;', ''].join('\n');
const geometryDigest = digest(geo);
const durationS = 1e-5;
const draft: ExplicitDynamicsDraft = {
  schema: 'tunacad-explicit-dynamics-foundation/0.1', studyId: 'explicit-provider-probe',
  analysis: { type: 'explicit_structural_dynamics',
    assumptions: ['one_linear_elastic_solid', 'small_displacement',
      'zero_initial_conditions', 'undamped', 'no_contact', 'no_mass_scaling'],
    durationS, outputTimesS: [durationS / 2, durationS],
    integration: { kind: 'central_difference_cfl_bound',
      minimumCharacteristicLengthMm: 5, safetyFactor: 0.8,
      maximumTimeStepS: 1e-7, maximumIncrements: 20_000 } },
  model: { projectRevision: 'controlled-gmsh-geometry-r1',
    domainId: 'bar', partId: 'bar-part', bodyId: 'bar-body',
    geometryDigest, kind: 'straight_rectangular_axial_bar',
    lengthMm: 100, widthMm: 10, heightMm: 10,
    fixedFaceId: 'x-min', loadedFaceId: 'x-max' },
  material: { materialId: 'steel', domainId: 'bar',
    model: 'isotropic_linear_elastic', youngsModulusMPa: 200_000,
    poissonRatio: 0.3, densityKgM3: 7800,
    source: { kind: 'custom', reference: 'controlled explicit probe', revision: 'r1' } },
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
const directory = await mkdtemp(join(tmpdir(), 'tunacad-explicit-feasibility-'));
const run = async (executable: string, args: string[], maximumMs: number) => {
  const child = spawnProviderProcess(executable, args, { cwd: directory,
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let head = '', tail = '';
  const capture = (part: unknown) => {
    const chunk = String(part);
    head = (head + chunk).slice(0, 64_000);
    tail = (tail + chunk).slice(-64_000);
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  const timer = setTimeout(() => { void terminateChildProcess(child); }, maximumMs);
  const exitCode = await new Promise<number | null>((done, reject) => {
    child.once('error', reject);
    child.once('exit', done);
  }).finally(() => clearTimeout(timer));
  return { exitCode, output: head + '\n[bounded tail]\n' + tail };
};
function parseMsh(text: string): ExplicitC3D4Mesh {
  const lines = text.trim().split(/\r?\n/);
  const section = (name: string) => {
    const at = lines.indexOf('$' + name);
    if (at < 0 || !Number.isSafeInteger(Number(lines[at + 1])))
      throw new Error('Missing MSH2 section ' + name);
    const count = Number(lines[at + 1]);
    return lines.slice(at + 2, at + 2 + count);
  };
  const nodes = section('Nodes').map(line => {
    const row = line.trim().split(/\s+/).map(Number);
    return { id: row[0], xyzMm: row.slice(1, 4) as [number, number, number] };
  });
  const elements: ExplicitC3D4Mesh['elements'] = [];
  const surfaceTriangles: ExplicitC3D4Mesh['surfaceTriangles'] = [];
  for (const line of section('Elements')) {
    const row = line.trim().split(/\s+/).map(Number);
    const [id, type, tagCount] = row;
    const connectivity = row.slice(3 + tagCount);
    if (type === 4 && connectivity.length === 4)
      elements.push({ id, type: 'C3D4', nodes: connectivity as [number, number, number, number] });
    else if (type === 2 && connectivity.length === 3)
      surfaceTriangles.push({ id, nodes: connectivity as [number, number, number] });
    else if (![1, 15].includes(type)) throw new Error('Unsupported Gmsh element type ' + type);
  }
  return { runtime: 'Gmsh 4.15.2', inputGeometryDigest: geometryDigest,
    nodes, elements, surfaceTriangles };
}
const wrap = (ids: number[]) => Array.from({ length: Math.ceil(ids.length / 12) },
  (_, i) => ids.slice(i * 12, i * 12 + 12).join(','));
const number = (value: number) => value.toExponential(12);
const readBounded = async (path: string, maximumBytes: number) => {
  if (!existsSync(path)) return { text: '', bytes: 0 };
  const bytes = (await stat(path)).size;
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(bytes, maximumBytes));
    const read = await handle.read(buffer, 0, buffer.length, 0);
    return { text: buffer.subarray(0, read.bytesRead).toString('utf8'), bytes };
  } finally { await handle.close(); }
};
try {
  await writeFile(join(directory, 'bar.geo'), geo, 'utf8');
  const meshing = await run(gmsh, ['bar.geo', '-3', '-order', '1',
    '-format', 'msh2', '-o', 'bar.msh', '-nopopup'], 60_000);
  assert.equal(meshing.exitCode, 0, meshing.output);
  const mesh = parseMsh(await readFile(join(directory, 'bar.msh'), 'utf8'));
  const admitted = assessExplicitC3D4Mesh(request, mesh);
  const rejects = (change: (draft: any) => void) => {
    const altered = structuredClone(mesh); change(altered);
    assert.throws(() => assessExplicitC3D4Mesh(request, altered),
      /EXPLICIT_MESH_ADMISSION_INVALID/);
  };
  rejects(m => { m.elements[0].type = 'C3D10'; });
  rejects(m => { m.elements.push(structuredClone(m.elements[0])); });
  rejects(m => { [m.elements[0].nodes[0], m.elements[0].nodes[1]]
    = [m.elements[0].nodes[1], m.elements[0].nodes[0]]; });
  rejects(m => { m.elements[0].nodes[3] = m.elements[0].nodes[0]; });
  rejects(m => { m.inputGeometryDigest = digest('substituted'); });
  rejects(m => { m.surfaceTriangles = m.surfaceTriangles.filter((face: any) =>
    !face.nodes.every((id: number) => m.nodes.find((n: any) => n.id === id).xyzMm[0] === 0)); });
  const tight = structuredClone(draft);
  tight.analysis.integration.maximumTimeStepS = 6e-7;
  tight.analysis.integration.maximumIncrements = 20;
  assert.throws(() => assessExplicitC3D4Mesh(sealExplicitDynamics(tight), mesh),
    /EXPLICIT_MESH_ADMISSION_INVALID: actual-mesh CFL requires excessive increments/);
  const faceLoad = request.load.forceN[0] / admitted.loadedFace.nodeIds.length;
  const printFrequency = 1;
  const deck = [
    '*HEADING', 'TunaCAD explicit C3D4 feasibility only',
    '*NODE, NSET=NALL',
    ...mesh.nodes.map(n => n.id + ',' + n.xyzMm.map(number).join(',')),
    '*ELEMENT, TYPE=C3D4, ELSET=EALL',
    ...mesh.elements.map(e => e.id + ',' + e.nodes.join(',')),
    '*NSET, NSET=FIXED', ...wrap(admitted.fixedFace.nodeIds),
    '*NSET, NSET=LOADED', ...wrap(admitted.loadedFace.nodeIds),
    '*MATERIAL, NAME=STEEL', '*ELASTIC', '200000,0.3',
    '*DENSITY', number(request.material.densityKgM3 * 1e-12),
    '*SOLID SECTION, ELSET=EALL, MATERIAL=STEEL',
    '*STEP, INC=' + (admitted.incrementCount + 2) + ', AMPLITUDE=STEP',
    '*DYNAMIC, DIRECT, EXPLICIT=2, ALPHA=0',
    number(admitted.selectedTimeStepS) + ',' + number(durationS),
    '*BOUNDARY', 'FIXED,1,3,0',
    '*CLOAD', ...admitted.loadedFace.nodeIds.map(id => id + ',1,' + number(faceLoad)),
    '*NODE FILE, FREQUENCY=' + printFrequency, 'U,V',
    '*NODE PRINT, NSET=NALL, GLOBAL=YES, FREQUENCY=' + printFrequency, 'U',
    '*NODE PRINT, NSET=FIXED, TOTALS=ONLY, GLOBAL=YES, FREQUENCY=' + printFrequency, 'RF',
    '*EL PRINT, ELSET=EALL, TOTALS=ONLY, FREQUENCY=' + printFrequency, 'ELKE,ELSE',
    '*END STEP', '',
  ].join('\n');
  assert.match(deck, /\*DYNAMIC, DIRECT, EXPLICIT=2, ALPHA=0\n[^\n]+,[^\n]+\n\*BOUNDARY/);
  await writeFile(join(directory, 'explicit_probe.inp'), deck, 'utf8');
  // Deliberately outside the solver scratch directory: normal cleanup must not
  // erase the bounded admission evidence when CalculiX fails.
  const receipt = createExplicitDiagnosticReceipt(request, admitted, deck);
  const evidenceDirectory = await mkdtemp(join(tmpdir(), 'tunacad-explicit-diagnostic-'));
  const receiptPath = join(evidenceDirectory, 'pre-dispatch-receipt.json');
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n',
    { encoding: 'utf8', flag: 'wx' });
  console.log(JSON.stringify({ phase: 'PRE_DISPATCH', receiptPath,
    receiptDigest: receipt.receiptDigest, selectedTimeStepS: admitted.selectedTimeStepS,
    expectedIncrements: admitted.incrementCount, deckStepIncrementLimit:
      admitted.incrementCount + 2, meshMassKg: admitted.meshMassKg }));
  const solve = await run(ccx, ['-i', 'explicit_probe'], 60_000);
  const files = await readdir(directory);
  const dat = await readBounded(join(directory, 'explicit_probe.dat'), 256_000);
  const frd = await readBounded(join(directory, 'explicit_probe.frd'), 512_000);
  const diagnostics = solve.output + '\n[bounded first-frame .dat]\n'
    + dat.text;
  await writeFile(join(evidenceDirectory, 'bounded-provider-diagnostics.txt'),
    diagnostics, { encoding: 'utf8', flag: 'wx' });
  await writeFile(join(evidenceDirectory, 'bounded-first-frame-fields.frd.txt'),
    frd.text, { encoding: 'utf8', flag: 'wx' });
  await writeFile(join(evidenceDirectory, 'provider-exit.json'),
    JSON.stringify({ exitCode: solve.exitCode,
      outputFiles: files.filter(name => name.startsWith('explicit_probe.')),
      datBytes: dat.bytes, capturedDatBytes: Math.min(dat.bytes, 256_000),
      frdBytes: frd.bytes, capturedFrdBytes: Math.min(frd.bytes, 512_000),
      accelerationDirectlyAvailable: false }, null, 2) + '\n',
    { encoding: 'utf8', flag: 'wx' });
  const massScaleFiles = files.filter(name => /WarnElementMassScaled/i.test(name));
  const massScalingWarning = /mass.scal(?:ed|ing)|mass redistribution/i.test(diagnostics);
  assert.equal(massScaleFiles.length, 0, 'no mass-scaling marker file');
  assert.equal(massScalingWarning, false, 'no mass-scaling warning');
  assert.equal(solve.exitCode, 0, solve.output);
  assert.ok(files.includes('explicit_probe.frd'), 'explicit displacement field requested');
  assert.match(diagnostics, /displacements/i);
  assert.match(diagnostics, /forces/i);
  assert.match(diagnostics, /kinetic energy/i);
  assert.match(diagnostics, /internal energy/i);
  console.log(JSON.stringify({ status: 'PASS', evidence: 'installed-ccx216-explicit-feasibility',
    syntax: '*DYNAMIC, DIRECT, EXPLICIT=2, ALPHA=0; initial increment,duration only',
    mesh: { nodes: admitted.nodeCount, elements: admitted.elementCount,
      minimumVolumeMm3: admitted.minimumVolumeMm3,
      fixedFacetCount: admitted.fixedFace.facetCount,
      loadFacetCount: admitted.loadedFace.facetCount },
    minimumCharacteristicLengthMm: admitted.minimumCharacteristicLengthMm,
    governingWaveSpeedMmPerS: admitted.governingWaveSpeedMmPerS,
    trustedStabilityLimitS: admitted.trustedStabilityLimitS,
    selectedTimeStepS: admitted.selectedTimeStepS,
    incrementCount: admitted.incrementCount,
    durationS, massScalingOccurred: false,
    outputFiles: files.filter(name => name.startsWith('explicit_probe.')),
    providerAdmission: 'closed' }, null, 2));
} finally {
  if (dirname(resolve(directory)) !== resolve(tmpdir()))
    throw new Error('Refuse fixture cleanup outside system temp.');
  await rm(directory, { recursive: true, force: true });
}
