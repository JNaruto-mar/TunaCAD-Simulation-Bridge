import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { NeutralFemMesh } from '../src/simulation/externalSimulationContracts.ts';
import { GmshMeshProvider } from '../providers/gmsh/GmshMeshProvider.mts';
import { CalculiXElectrostaticExecution } from '../providers/calculix/CalculiXElectrostaticExecution.mts';
import { ELECTROSTATIC_SLAB_LIMITS, electrostaticSlabMeshInputs } from '../providers/calculix/CalculiXElectrostaticSlab.mts';
import { ElectrostaticAdmissionLifecycle, type CompletedElectrostaticResult } from '../simulation-bridge/electrostaticAdmission.mts';
import { parallelPlateElectrostaticReference } from '../simulation-bridge/electrostaticFoundation.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { hasEnforcedProviderProcessQuotas, monitorWorkingDirectory, removeWorkingDirectory,
  spawnProviderProcess, terminateChildProcess } from '../providers/processLifecycle.mts';
import { slabRequest } from './sim9-electrostatic-fixture.mts';

// Only numerical resolution changes. Three meshes + one native repeat of the
// selected 0.85 mm baseline; no historical suite or broader physics.
// Sizes 3/2/1.5 mm produce the SAME mesh under the unchanged Gmsh defaults.
// Refine below that plateau rather than claiming distinct levels from labels.
const levelsMm = [1, 0.85, 0.7] as const;
const baselineMm = 0.85;
const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (!gmsh || !calculix || !hasEnforcedProviderProcessQuotas()) throw new Error('Explicit paths and Windows x64 quotas required.');
const directory = await mkdtemp(join(tmpdir(), 'tunacad-electrical-refinement-'));
const mesher = new GmshMeshProvider({ executable: gmsh, runtimeVersion: '4.15.2' });
const native = new CalculiXElectrostaticExecution(calculix);
const meshRuns: string[] = [];
const jobs: { lifecycle: ElectrostaticAdmissionLifecycle; jobId: string }[] = [];
const relative = (actual: number, expected: number) => Math.abs(actual - expected) / Math.abs(expected);
try {
  assert.match(await runGmsh(['--version']), /(?:^|\s)4\.15\.2(?:\s|$)/);
  const stepPath = join(directory, 'slab.step');
  const geoPath = join(directory, 'slab.geo');
  await writeFile(geoPath, 'SetFactory("OpenCASCADE");\nBox(1)={0,0,0,1,10,10};\nSave "'
    + stepPath.replaceAll('\\', '/') + '";\n', 'utf8');
  await runGmsh([geoPath, '-0', '-v', '2']);
  const step = new Uint8Array(await readFile(stepPath));
  const request = slabRequest(digest(Array.from(step)));
  const reference = parallelPlateElectrostaticReference(request);
  const referenceQ = reference.electrodes[1].chargeC;
  const referenceE = Math.abs(reference.samples[0].electricFieldVPerM[0]);
  const rows: ReturnType<typeof measure>[] = [];
  let baseline: { mesh: NeutralFemMesh; result: CompletedElectrostaticResult; lifecycle: ElectrostaticAdmissionLifecycle } | null = null;
  for (const meshSizeMm of levelsMm) {
    console.log(JSON.stringify({ progress: 'mesh_and_solve', meshSizeMm }));
    const { meshRequest, descriptor } = electrostaticSlabMeshInputs(request, meshSizeMm);
    const id = (await mesher.submit(meshRequest, { descriptor, async export() { return step; } })).meshRunId;
    meshRuns.push(id);
    const meshDeadline = Date.now() + 60_000;
    let mesh: NeutralFemMesh | null = null;
    while (Date.now() < meshDeadline) {
      const status = await mesher.getStatus(id);
      if (status.status === 'failed' || status.status === 'cancelled') throw new Error(JSON.stringify(status));
      if (status.status === 'succeeded') { mesh = await mesher.getMesh(id); break; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(mesh, 'Bounded refinement mesh missing');
    const ownedMesh = mesh;
    const lifecycle = new ElectrostaticAdmissionLifecycle({
      async readCurrentProjectRevision() { return request.model.projectRevision; },
      async readSealedRequest() { return structuredClone(request); },
      async readValidatedMesh() { return structuredClone(ownedMesh); },
      async readCurrentRuntimeIdentity() { return native.readCurrentRuntimeIdentity(); },
    }, native);
    const result = await solve(lifecycle);
    const row = measure(meshSizeMm, mesh, result);
    assert.ok(row.maximumNodalPotentialErrorV <= ELECTROSTATIC_SLAB_LIMITS.maximumPotentialErrorV);
    assert.ok(row.maximumFieldMagnitudeRelativeError <= 1e-4);
    assert.ok(Math.max(...row.chargeRelativeErrors) <= ELECTROSTATIC_SLAB_LIMITS.chargeRelativeTolerance);
    assert.ok(row.capacitanceRelativeError <= 1e-4);
    assert.ok(row.energyRelativeError <= ELECTROSTATIC_SLAB_LIMITS.energyRelativeTolerance);
    assert.ok(row.relativeNetChargeImbalance <= 1e-4);
    assert.ok(row.relativeFieldVsChargeEnergyResidual <= 1e-4);
    rows.push(row);
    console.log(JSON.stringify({ progress: 'level_pass', ...row }));
    if (meshSizeMm === baselineMm) baseline = { mesh, result, lifecycle };
  }
  // Exact linear field is representable on every straight-sided quadratic
  // mesh. Stability across resolutions is the gate, NOT an inferred order.
  assert.ok(rows[1].nodes > rows[0].nodes && rows[2].nodes > rows[1].nodes);
  assert.ok(rows[1].elements > rows[0].elements && rows[2].elements > rows[1].elements);
  const spread = (values: number[], expected: number) => (Math.max(...values) - Math.min(...values)) / Math.abs(expected);
  const stability = {
    capacitanceRelativeSpread: spread(rows.map(row => row.capacitanceF), reference.capacitanceF),
    energyRelativeSpread: spread(rows.map(row => row.energyJ), reference.electrostaticEnergyJ),
    leftChargeRelativeSpread: spread(rows.map(row => row.leftChargeC), referenceQ),
    rightChargeRelativeSpread: spread(rows.map(row => row.rightChargeC), referenceQ),
    maximumPotentialErrorV: Math.max(...rows.map(row => row.maximumNodalPotentialErrorV)),
    maximumRelativeChargeImbalance: Math.max(...rows.map(row => row.relativeNetChargeImbalance)),
    maximumRelativeEnergyResidual: Math.max(...rows.map(row => row.relativeFieldVsChargeEnergyResidual)),
  };
  assert.ok(stability.capacitanceRelativeSpread <= 1e-4);
  assert.ok(stability.energyRelativeSpread <= 1e-4);
  assert.ok(stability.leftChargeRelativeSpread <= 1e-4 && stability.rightChargeRelativeSpread <= 1e-4);
  assert.ok(baseline);
  console.log(JSON.stringify({ progress: 'repeat_selected_baseline', meshSizeMm: baselineMm }));
  const repeated = await solve(baseline.lifecycle);
  // UUID/native diagnostic completion roots differ by design. The complete
  // electrical normalization, raw DAT digest and its result root must not.
  assert.deepEqual(repeated.electrical, baseline.result.electrical);
  assert.deepEqual(repeated.binding, baseline.result.binding);
  assert.notEqual(repeated.jobId, baseline.result.jobId);
  const repeatRow = measure(baselineMm, baseline.mesh, repeated);
  const evidence = {
    schema: 'tunacad-electrostatic-refinement-evidence/0.1', status: 'PASS',
    provenance: 'real_provider_backed_host_reader_fixture',
    physicsStatus: 'proof_of_concept', engineeringUsePermitted: false, providerAdmission: 'closed',
    versions: { gmsh: '4.15.2', runtime: baseline.result.binding.runtime, node: process.versions.node },
    requestDigest: request.requestDigest, projectRevision: request.model.projectRevision,
    geometryDigest: request.model.domains[0].geometryDigest, materialDigest: baseline.result.binding.materialDigest,
    reference: { potentialV: reference.samples.map(sample => sample.electricPotentialV),
      fieldMagnitudeVPerM: referenceE, leftChargeC: -referenceQ, rightChargeC: referenceQ,
      capacitanceF: reference.capacitanceF, energyJ: reference.electrostaticEnergyJ },
    limits: { potentialErrorV: 0.002, relativeFieldChargeCapacitanceEnergyAndSpread: 1e-4,
      relativeNetChargeAndEnergyResidual: 1e-4, maximumNodes: 8000, maximumElements: 4000 },
    rows, stability, selectedBaselineMm: baselineMm, repeat: repeatRow,
    repeatability: { nativeBaselineRepeats: 1, identicalElectricalResult: true,
      identicalRawOutputDigest: true, identicalElectricalDigest: true, identicalSourceBinding: true,
      remeshingRepeated: false, jobAndCompletionDigestsExpectedToDiffer: true },
    meshExecutions: 3, completedNativeSolves: jobs.length, cleanupConfirmed: true,
    convergenceOrder: null, interpretation: 'stable_exact_linear_solution_with_native_output_rounding',
  };
  assert.equal(jobs.length, 4);
  console.log(JSON.stringify(evidence, null, 2));

  function measure(meshSizeMm: number, mesh: NeutralFemMesh, result: CompletedElectrostaticResult) {
    const electrical = result.electrical;
    const maximumNodalPotentialErrorV = Math.max(...electrical.nodalElectricPotential.map(node =>
      Math.abs(node.electricPotentialV - node.positionM[0] * 100000)));
    const magnitudes = electrical.electricFields.map(field => field.electricFieldMagnitudeVPerM);
    const chargeRelativeErrors = electrical.electrodes.map((electrode, i) =>
      relative(electrode.chargeC, reference.electrodes[i].chargeC));
    return {
      meshSizeMm, nodes: mesh.nodes.length, elements: mesh.volumeElements.connectivity.length, elementType: 'DC3D10',
      maximumNodalPotentialErrorV,
      fieldMagnitudeMinVPerM: Math.min(...magnitudes), fieldMagnitudeMaxVPerM: Math.max(...magnitudes),
      maximumFieldMagnitudeRelativeError: Math.max(...magnitudes.map(value => relative(value, referenceE))),
      leftChargeC: electrical.electrodes[0].chargeC, rightChargeC: electrical.electrodes[1].chargeC,
      netChargeImbalanceC: electrical.consistency.netElectrodeChargeC,
      relativeNetChargeImbalance: Math.abs(electrical.consistency.netElectrodeChargeC) / Math.abs(referenceQ),
      capacitanceF: electrical.capacitanceF, energyJ: electrical.electrostaticEnergyJ,
      chargeRelativeErrors, capacitanceRelativeError: relative(electrical.capacitanceF, reference.capacitanceF),
      energyRelativeError: relative(electrical.electrostaticEnergyJ, reference.electrostaticEnergyJ),
      fieldVsChargeEnergyResidualJ: electrical.consistency.fieldMinusChargeEnergyJ,
      relativeFieldVsChargeEnergyResidual: Math.abs(electrical.consistency.fieldMinusChargeEnergyJ) / reference.electrostaticEnergyJ,
      potentialSamplesV: electrical.samples.map(sample => sample.electricPotentialV),
      jobId: result.jobId, meshDigest: result.binding.meshDigest, deckDigest: result.binding.deckDigest,
      electricalResultDigest: result.normalizedElectricalResultDigest, rawOutputDigest: electrical.rawOutputDigest,
      completionDigest: result.completionDigest, completedResultDigest: result.resultDigest,
    };
  }
} finally {
  for (const job of jobs) await job.lifecycle.cancel(job.jobId);
  for (const id of meshRuns) await mesher.cancel(id);
  if (!await removeWorkingDirectory(directory)) throw new Error('Electrical refinement fixture cleanup pending');
}

async function solve(lifecycle: ElectrostaticAdmissionLifecycle) {
  const job = lifecycle.submit('electrical-provider-slab'); jobs.push({ lifecycle, jobId: job.jobId });
  assert.equal(await lifecycle.getResult(job.jobId), null);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const status = lifecycle.getStatus(job.jobId);
    if (status.state !== 'queued' && status.state !== 'running') {
      assert.equal(status.phase, 'succeeded_cleaned', JSON.stringify(status));
      assert.equal(status.cleanupConfirmed, true);
      const result = await lifecycle.getResult(job.jobId); assert.ok(result);
      assert.equal((await readdir(tmpdir())).filter(name =>
        name.startsWith('tunacad-electrical-job-' + job.jobId + '-')).length, 0);
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await lifecycle.cancel(job.jobId); throw new Error('Bounded electrical refinement solve timed out');
}
async function runGmsh(args: string[]) {
  const child = spawnProviderProcess(gmsh!, args, { cwd: directory, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: dirname(gmsh!) + ';' + (process.env.PATH ?? '') },
  }, { cpuTimeLimitMs: 30_000, memoryLimitBytes: 512 * 1024 * 1024 });
  let diagnostic = ''; let exceeded = false;
  const collect = (chunk: unknown) => diagnostic = (diagnostic + String(chunk)).slice(-12000);
  child.stdout?.on('data', collect); child.stderr?.on('data', collect);
  const stop = monitorWorkingDirectory({ child, directory, maximumBytes: 64 * 1024 * 1024,
    async onExceeded() { exceeded = true; await terminateChildProcess(child); } });
  const timer = setTimeout(() => { exceeded = true; void terminateChildProcess(child); }, 30_000); timer.unref();
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject); child.once('close', resolve);
    });
    if (exceeded || code !== 0) throw new Error('Electrical refinement geometry failed: ' + diagnostic);
    return diagnostic;
  } finally { clearTimeout(timer); stop(); await terminateChildProcess(child); }
}
