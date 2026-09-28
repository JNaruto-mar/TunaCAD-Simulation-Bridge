import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { GmshMeshProvider } from '../providers/gmsh/GmshMeshProvider.mts';
import { ELECTROSTATIC_SLAB_LIMITS, electrostaticSlabMeshInputs,
  createCalculiXElectrostaticSlabDeck, recoverCalculiXElectrostaticSlab } from '../providers/calculix/CalculiXElectrostaticSlab.mts';
import { hasEnforcedProviderProcessQuotas, monitorWorkingDirectory,
  readUtf8FileBounded, removeWorkingDirectory, spawnProviderProcess, terminateChildProcess } from '../providers/processLifecycle.mts';
import { parallelPlateElectrostaticReference } from '../simulation-bridge/electrostaticFoundation.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { slabRequest } from './sim9-electrostatic-fixture.mts';

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (!gmsh || !calculix) throw new Error('Explicit Gmsh/CalculiX environment paths required.');
if (!hasEnforcedProviderProcessQuotas()) throw new Error('This real fixture requires enforced Windows x64 quotas.');
const directory = await mkdtemp(join(tmpdir(), 'tunacad-electrical-slab-'));
let mesher: GmshMeshProvider | null = null; let runId: string | null = null;
try {
  const gmshVersion = await run(gmsh, ['--version']);
  const ccxVersion = await run(calculix, ['-v']);
  assert.match(gmshVersion, /(?:^|\s)4\.15\.2(?:\s|$)/);
  assert.match(ccxVersion, /(?:Version\s*)?2\.16(?:\s|$)/i);
  const stepPath = join(directory, 'slab.step'); const geoPath = join(directory, 'slab.geo');
  await writeFile(geoPath, 'SetFactory("OpenCASCADE");\nBox(1) = {0,0,0,1,10,10};\nSave "'
    + stepPath.replaceAll('\\', '/') + '";\n', 'utf8');
  await run(gmsh, [geoPath, '-0', '-v', '2']);
  const step = new Uint8Array(await readFile(stepPath));
  const request = slabRequest(digest(Array.from(step)));
  const { meshRequest, descriptor } = electrostaticSlabMeshInputs(request, 2);
  mesher = new GmshMeshProvider({ executable: gmsh, runtimeVersion: '4.15.2' });
  const submission = await mesher.submit(meshRequest, { descriptor, async export(format) {
    assert.equal(format, 'step'); return step;
  } });
  runId = submission.meshRunId;
  const deadline = Date.now() + 60_000;
  let mesh = null;
  while (Date.now() < deadline) {
    const status = await mesher.getStatus(runId);
    if (status.status === 'failed' || status.status === 'cancelled') throw new Error(JSON.stringify(status));
    if (status.status === 'succeeded') { mesh = await mesher.getMesh(runId); break; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!mesh) throw new Error('Bounded electrical meshing incomplete.');
  const generated = createCalculiXElectrostaticSlabDeck(request, mesh);
  assert.deepEqual(createCalculiXElectrostaticSlabDeck(request, mesh), generated);
  await writeFile(join(directory, 'electrical.inp'), generated.deck, 'utf8');
  const diagnostic = await run(calculix, ['-i', 'electrical']);
  assert.match(diagnostic, /Job finished/i, 'Native completion required before reading results.');
  const dat = await readUtf8FileBounded(join(directory, 'electrical.dat'), ELECTROSTATIC_SLAB_LIMITS.maximumOutputBytes);
  const recovered = recoverCalculiXElectrostaticSlab(request, mesh, dat);
  assert.deepEqual(recoverCalculiXElectrostaticSlab(request, mesh, dat), recovered);
  const analytical = parallelPlateElectrostaticReference(request);
  const relativeError = (actual: number, expected: number) => Math.abs(actual - expected) / Math.abs(expected);
  recovered.samples.forEach((sample, i) => assert.ok(Math.abs(sample.electricPotentialV
    - analytical.samples[i].electricPotentialV) <= ELECTROSTATIC_SLAB_LIMITS.maximumPotentialErrorV));
  const fieldError = Math.max(...recovered.electricFields.map(field => relativeError(field.electricFieldVPerM[0], -100000)));
  assert.ok(fieldError <= 1e-4);
  let rejected = 0;
  const reject = (label: string, text: string) => {
    assert.throws(() => recoverCalculiXElectrostaticSlab(request, mesh!, text), /ELECTROSTATIC_SLAB_INVALID/, label); rejected++;
  };
  // Replay native data with tampering, not new native solves.
  reject('missing final field block', dat.slice(0, dat.toLowerCase().indexOf('heat flux')));
  reject('wrong electrode FACE set', dat.replace('ELECTRODE_LEFT', 'ELECTRODE_WRONG'));
  reject('nonfinite native field', dat.replace(/(\n\s+\d+\s+[1-4]\s+)[-\d.EeDd+]+(\s+[-\d.EeDd+]+\s+[-\d.EeDd+]+)/, '$1NaN$2'));
  reject('duplicate native output', dat + dat);
  const firstField = recovered.electricFields[0];
  console.log(JSON.stringify({
    status: 'PASS', fixture: '1x10x10-mm-electrostatic-parallel-plate',
    versions: { gmsh: '4.15.2', calculix: '2.16', node: process.versions.node },
    mesh: { globalSizeMm: 2, nodes: mesh.nodes.length, elements: mesh.volumeElements.connectivity.length, element: 'DC3D10' },
    provider: { potentialsV: recovered.samples.map(sample => sample.electricPotentialV),
      fieldVPerM: firstField.electricFieldVPerM, fieldMagnitudeVPerM: firstField.electricFieldMagnitudeVPerM,
      displacementCPerM2: firstField.electricDisplacementCPerM2,
      electrodeChargesC: recovered.electrodes.map(item => item.chargeC),
      capacitanceF: recovered.capacitanceF, energyJ: recovered.electrostaticEnergyJ },
    analytical: { potentialsV: analytical.samples.map(sample => sample.electricPotentialV),
      fieldVPerM: analytical.samples[0].electricFieldVPerM, displacementCPerM2: analytical.samples[0].electricDisplacementCPerM2,
      electrodeChargesC: analytical.electrodes.map(item => item.chargeC),
      capacitanceF: analytical.capacitanceF, energyJ: analytical.electrostaticEnergyJ },
    comparison: { maximumNodalPotentialErrorV: Math.max(...recovered.nodalElectricPotential.map(sample =>
      Math.abs(sample.electricPotentialV - sample.positionM[0] * 100000))),
      maximumFieldRelativeError: fieldError,
      chargeRelativeErrors: recovered.electrodes.map((item, i) => relativeError(item.chargeC, analytical.electrodes[i].chargeC)),
      capacitanceRelativeError: relativeError(recovered.capacitanceF, analytical.capacitanceF),
      energyRelativeError: relativeError(recovered.electrostaticEnergyJ, analytical.electrostaticEnergyJ) },
    balance: recovered.consistency,
    repeatability: { deterministicDeck: true, deterministicNormalization: true, repeatedNativeSolves: 0 },
    tamperedNativeOutputRejected: rejected, nativeSolves: 1,
    deckDigest: generated.deckDigest, resultDigest: recovered.resultDigest,
    providerAdmission: 'closed', engineeringUsePermitted: false,
  }, null, 2));
} finally {
  if (mesher && runId) await mesher.cancel(runId);
  if (!await removeWorkingDirectory(directory)) throw new Error('Electrical fixture cleanup pending.');
}

async function run(executable: string, args: string[]): Promise<string> {
  const child = spawnProviderProcess(executable, args, {
    cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, OMP_NUM_THREADS: '1', CCX_NPROC_RESULTS: '1',
      PATH: dirname(executable) + ';' + (process.env.PATH ?? '') },
  }, { cpuTimeLimitMs: 30_000, memoryLimitBytes: 512 * 1024 * 1024 });
  let diagnostic = ''; let exceeded = false;
  const collect = (chunk: unknown) => diagnostic = (diagnostic + String(chunk)).slice(-12000);
  child.stdout?.on('data', collect); child.stderr?.on('data', collect);
  const monitor = monitorWorkingDirectory({ child, directory, maximumBytes: 64 * 1024 * 1024,
    async onExceeded() { exceeded = true; await terminateChildProcess(child); } });
  const timer = setTimeout(() => { exceeded = true; void terminateChildProcess(child); }, 30_000);
  timer.unref();
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject); child.once('exit', resolve);
    });
    // ccx216 reports its version with a nonzero exit status; this exception
    // applies ONLY to the metadata probe, never geometry export or a solve.
    const versionProbe = args.length === 1 && args[0] === '-v' && /This is Version 2\.16(?:\s|$)/.test(diagnostic);
    if (exceeded || (code !== 0 && !versionProbe)) throw new Error('Bounded native operation failed (' + code + '): ' + diagnostic);
    return diagnostic;
  } finally { clearTimeout(timer); monitor(); await terminateChildProcess(child); }
}
