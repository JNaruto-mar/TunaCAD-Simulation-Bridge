import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCalculiXInputDeckV2 } from '../providers/calculix/CalculiXMultiDomainDeck.mts';
import { CalculiXMultiDomainSolverProvider, parseCalculiXTransientThermalDatV2 } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { GmshMultiDomainMeshProvider } from '../providers/gmsh/GmshMultiDomainMeshProvider.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { sealNeutralSimulationRequestV2, admitV2SimulationRequest, validateNeutralSimulationResultV2, validateNeutralSimulationFieldPageV2 } from '../simulation-bridge/v2Validation.mts';
import type { NeutralFemModelV2, NeutralSimulationRequestV2, NeutralSimulationResultV2, NeutralVector3 } from '../src/simulation/externalSimulationContracts.ts';

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (!gmsh || !calculix) throw new Error('Set the explicit Gmsh and CalculiX executable paths for the focused SIM-9 real fixture.');
const directory = await mkdtemp(join(tmpdir(), 'tunacad-sim9-transient-'));
try {
  const geoPath = join(directory, 'slab.geo');
  const stepPath = join(directory, 'slab.step');
  await writeFile(geoPath, ['SetFactory("OpenCASCADE");', 'Box(1) = {0, 0, 0, 100, 10, 10};',
    'Save "' + stepPath.replace(/\\/g, '/').replace(/"/g, '\\"') + '";'].join('\n'), 'utf8');
  execFileSync(gmsh, [geoPath, '-0', '-v', '2'], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const step = new Uint8Array(await readFile(stepPath));
  const request = createRequest();
  const mesher = new GmshMultiDomainMeshProvider({ executable: gmsh, runtimeVersion: '4.15.2' });
  const model = await mesher.mesh(request, {
    descriptor: request.model,
    async exportDomain(domainId, format) {
      assert.equal(domainId, 'slab');
      assert.equal(format, 'step');
      return step;
    },
  });
  assert.equal(model.domainRegions.length, 1);
  assert(model.nodes.length > 10 && model.volumeElements.connectivity.length > 1);
  const deck = createCalculiXInputDeckV2(request, model);
  assert.equal(deck, createCalculiXInputDeckV2(request, model), 'Transient deck must be byte deterministic.');
  assert.match(deck, /^\*HEAT TRANSFER$/m);
  assert.doesNotMatch(deck, /HEAT TRANSFER, STEADY STATE/);
  assert.match(deck, /^\*DENSITY\n0\.0000078$/m);
  assert.match(deck, /^\*SPECIFIC HEAT\n500$/m);
  assert.match(deck, /^\*INITIAL CONDITIONS, TYPE=TEMPERATURE\nNALL,20$/m);
  assert.match(deck, /^\*TIME POINTS, NAME=TRANSIENT_OUTPUT\n100,400,1200$/m);
  assert.match(deck, /^\*STEP, INC=1000, AMPLITUDE=STEP$/m);
  assert.match(deck, /^\*NODE PRINT, NSET=NALL, TIME POINTS=TRANSIENT_OUTPUT\nNT$/m);
  assert.match(deck, /^\*NODE PRINT, NSET=THERMAL_REACTION_001, TIME POINTS=TRANSIENT_OUTPUT\nRFL$/m);
  assert.match(deck, /^\*EL PRINT, ELSET=EALL, TIME POINTS=TRANSIENT_OUTPUT\nHFL$/m);

  const solver = new CalculiXMultiDomainSolverProvider({ executable: calculix, runtimeVersion: '2.16' });
  assert.deepEqual(admitV2SimulationRequest(request, solver.capabilities), { accepted: true });
  if (process.argv.includes('--lifecycle-only')) {
    await testPartialHistoryLifecycle(solver, request, model);
  } else if (process.argv.includes('--fields-only')) {
    const first = transientResult(await solve(solver, request, model));
    const pages: Record<string, { dataset: unknown; triangles: unknown[] }> = {};
    const ids = first.perDomain[0].fieldDatasetIds;
    assert.equal(ids.length, 6);
    for (const [index, id] of ids.entries()) {
      assert.equal(id, first.jobId + ':slab:frame:' + String(Math.floor(index / 2) + 1).padStart(3, '0')
        + (index % 2 ? ':heat-flux' : ':temperature'));
      const triangles: unknown[] = [];
      let cursor = '0';
      let descriptor: Awaited<ReturnType<typeof solver.getFieldDataset>>['dataset'] | undefined;
      while (true) {
        const page = await solver.getFieldDataset(first.jobId, id, cursor, 17);
        validateNeutralSimulationFieldPageV2(page);
        assert.equal(page.cursor, cursor);
        assert.equal(page.triangleOffset, triangles.length);
        assert(page.triangleCount > 0 && page.triangleCount <= 17);
        assert.equal(page.chunkDigest, digest(page.triangles));
        assert.deepEqual(page.dataset, descriptor ?? page.dataset);
        assert.equal(page.dataset.analysisType, 'transient_thermal');
        assert.equal(page.dataset.step.index, Math.floor(index / 2) + 1);
        assert.equal(page.dataset.step.timeS, [100, 400, 1200][Math.floor(index / 2)]);
        assert.equal(page.dataset.component, index % 2 ? 'heat_flux_magnitude' : 'temperature');
        assert.equal(page.dataset.unit, index % 2 ? 'W/m^2' : 'degC');
        descriptor ??= page.dataset;
        triangles.push(...page.triangles);
        if (page.nextCursor === null) break;
        assert.equal(page.nextCursor, String(triangles.length));
        cursor = page.nextCursor;
      }
      assert(descriptor);
      assert.equal(triangles.length, descriptor.totalTriangles);
      assert.equal(digest(triangles), descriptor.datasetDigest);
      const repeated = await solver.getFieldDataset(first.jobId, id, '0', 17);
      assert.equal(repeated.chunkDigest, digest(triangles.slice(0, 17)));
      pages[id] = { dataset: descriptor, triangles };
    }
    const tampered = structuredClone(first);
    tampered.perDomain[0].fieldDatasetIds.reverse();
    assert.throws(() => validateNeutralSimulationResultV2(tampered, request), /BRIDGE_V2_TRANSIENT_RESULT_INVALID/);
    const missing = structuredClone(first);
    missing.perDomain[0].fieldDatasetIds.pop();
    assert.throws(() => validateNeutralSimulationResultV2(missing, request), /BRIDGE_V2_TRANSIENT_RESULT_INVALID/);
    const page = await solver.getFieldDataset(first.jobId, ids[0], '0', 17);
    const altered = structuredClone(page);
    altered.triangles[0].values[0] += 1;
    assert.throws(() => validateNeutralSimulationFieldPageV2(altered), /BRIDGE_V2_FIELD_PAGE_INVALID/);
    console.log(JSON.stringify({ status: 'PASS', fixture: 'SIM-9 transient per-frame NT/HFL pages',
      versions: { gmsh: '4.15.2', calculix: '2.16' },
      mesh: { nodes: model.nodes.length, elements: model.volumeElements.connectivity.length },
      requestedTimesS: first.transientThermal.frames.map(frame => frame.timeS),
      datasetCount: ids.length, triangleCounts: ids.map(id => pages[id].triangles.length),
      deterministicPages: true, malformedResultAndChunkRejected: true, engineeringUsePermitted: false }));
    if (process.env.TUNACAD_SIM9_VIEWER_PAYLOAD === '1') console.log('SIM9_VIEWER_PAYLOAD=' + JSON.stringify({ result: first, pages }));
  } else {
  const first = transientResult(await solve(solver, request, model));
  const repeat = transientResult(await solve(solver, request, model));
  assert.deepEqual(first.transientThermal, repeat.transientThermal, 'Repeated normalized frame values must match exactly.');
  assert.equal(first.review.engineeringUsePermitted, false);
  assert(first.warnings.some(warning => warning.code === 'SIMULATION_TRANSIENT_THERMAL_POC'));
  const frames = first.transientThermal!.frames;
  assert.deepEqual(frames.map(frame => frame.timeS), [100, 400, 1200]);
  const reference = [
    { timeS: 100, tipTemperatureC: 28.08012969857412, reactionHeatW: -0.09657220908934742, storedEnergyJ: 97.51574463183621 },
    { timeS: 400, tipTemperatureC: 35.42601595212687, reactionHeatW: -0.6407665447371693, storedEnergyJ: 276.4370169831787 },
    { timeS: 1200, tipTemperatureC: 39.63588577265686, reactionHeatW: -0.9714025354577828, storedEnergyJ: 380.95970965525646 },
  ];
  const comparisons = frames.map((frame, index) => {
    const expected = reference[index];
    const tipErrorC = frame.maximumTemperatureC - expected.tipTemperatureC;
    const reactionErrorW = frame.totalReactionHeatW - expected.reactionHeatW;
    const storedEnergyErrorJ = frame.storedThermalEnergyJ - expected.storedEnergyJ;
    assert(Math.abs(tipErrorC) <= .5, 'SIM-9 tip temperature exceeds the bounded 0.5 C development gate.');
    assert(Math.abs(reactionErrorW) <= .08, 'SIM-9 base reaction exceeds the bounded 0.08 W development gate.');
    assert(Math.abs(storedEnergyErrorJ) <= 8, 'SIM-9 stored energy exceeds the bounded 8 J development gate.');
    assert(Math.abs(frame.minimumTemperatureC - 20) <= .01);
    assert(Math.abs(frame.totalAppliedHeatW - 1) <= 1e-8);
    assert(frame.temperatureSamples.length >= 2 && frame.temperatureSamples.length <= 256);
    assert(frame.maximumHeatFluxMagnitudeWPerM2 > 0);
    return { timeS: frame.timeS, analyticalTipC: expected.tipTemperatureC,
      providerTipC: frame.maximumTemperatureC, tipErrorC,
      analyticalReactionW: expected.reactionHeatW, providerReactionW: frame.totalReactionHeatW, reactionErrorW,
      analyticalStoredEnergyJ: expected.storedEnergyJ, providerStoredEnergyJ: frame.storedThermalEnergyJ, storedEnergyErrorJ };
  });
  // At 400 s, Fourier-series storage rate is 0.35923345534 W.
  // This is an independent reference, not a tautological provider balance.
  const energyRateBalanceErrorW = Math.abs(1 + frames[1].totalReactionHeatW - 0.35923345534172313);
  assert(energyRateBalanceErrorW <= .08, 'SIM-9 provider applied-plus-reacted heat must match analytical storage rate.');
  const missing = structuredClone(first);
  missing.transientThermal!.frames.pop();
  assert.throws(() => validateNeutralSimulationResultV2(missing, request), /BRIDGE_V2_TRANSIENT_RESULT_INVALID/);
  const unordered = structuredClone(first);
  unordered.transientThermal!.frames.reverse();
  assert.throws(() => validateNeutralSimulationResultV2(unordered, request), /BRIDGE_V2_TRANSIENT_RESULT_INVALID/);
  const nonfinite = structuredClone(first);
  nonfinite.transientThermal!.frames[0].temperatureSamples[0].temperatureC = NaN;
  assert.throws(() => validateNeutralSimulationResultV2(nonfinite, request), /BRIDGE_V2_RESULT_INVALID/);
  testMalformedFrames(model);
  console.log(JSON.stringify({ status: 'PASS', fixture: 'SIM-9 one-domain transient slab',
    versions: { gmsh: '4.15.2', calculix: '2.16' },
    mesh: { nodes: model.nodes.length, elements: model.volumeElements.connectivity.length },
    comparisons, energyRateBalanceErrorW, deterministicDeck: true,
    deterministicNormalizedHistory: true, engineeringUsePermitted: first.review.engineeringUsePermitted }, null, 2));
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

async function solve(solver: CalculiXMultiDomainSolverProvider, request: NeutralSimulationRequestV2, model: NeutralFemModelV2): Promise<NeutralSimulationResultV2> {
  const submission = await solver.submit(request, model);
  const deadline = Date.now() + solver.capabilities.execution.totalTimeoutMs;
  while (Date.now() < deadline) {
    const status = await solver.getStatus(submission.providerRunId);
    if (status.status === 'failed') throw new Error((status.failure?.code ?? 'SIMULATION_FAILED') + ': ' + (status.failure?.message ?? 'Unknown failure.'));
    if (status.status === 'succeeded') {
      const result = await solver.getResult(submission.providerRunId);
      if (!result) throw new Error('CalculiX completed without a normalized SIM-9 result.');
      validateNeutralSimulationResultV2(result, request);
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  await solver.cancel(submission.providerRunId);
  throw new Error('Focused SIM-9 CalculiX fixture timed out.');
}

function transientResult(result: NeutralSimulationResultV2): Extract<NeutralSimulationResultV2, { analysisType: 'transient_thermal' }> {
  assert.equal(result.analysisType, 'transient_thermal');
  return result as Extract<NeutralSimulationResultV2, { analysisType: 'transient_thermal' }>;
}

function testMalformedFrames(model: NeutralFemModelV2): void {
  const block = (time: number) => [
    ' temperatures for set NALL and time ' + time,
    ...model.nodes.map((_, index) => (index + 1) + ' ' + (20 + index / model.nodes.length)),
    ' heat generation for set THERMAL_REACTION_001 and time ' + time,
    ' 1 -0.5',
    ' heat flux (elem, integ.pnt.,qx,qy,qz) for set EALL and time ' + time,
    ...model.volumeElements.connectivity.map((_, index) => (index + 1) + ' 1 -0.01 0 0'),
  ].join('\n');
  const source = [100, 400, 1200].map(block).join('\n');
  assert.equal(parseCalculiXTransientThermalDatV2(source, model, [100, 400, 1200]).length, 3);
  assert.throws(() => parseCalculiXTransientThermalDatV2([block(100), block(1200), block(400)].join('\n'), model, [100, 400, 1200]), /unordered/);
  assert.throws(() => parseCalculiXTransientThermalDatV2(source.replace('and time 400', 'and time 450'), model, [100, 400, 1200]), /extra/);
  assert.throws(() => parseCalculiXTransientThermalDatV2(source.replace(' heat flux (elem, integ.pnt.,qx,qy,qz) for set EALL and time 400',
    ' heat flux (elem, integ.pnt.,qx,qy,qz) for set OTHER and time 400'), model, [100, 400, 1200]), /unexpected/);
  assert.throws(() => parseCalculiXTransientThermalDatV2(source.replace(' 1 -0.5', ' 1 NaN'), model, [100, 400, 1200]), /non-finite/);
  assert.throws(() => parseCalculiXTransientThermalDatV2(source.replace(' 1 -0.5', ' 1 -0.5\n 1 -0.5'),
    model, [100, 400, 1200]), /duplicate/);
  assert.throws(() => parseCalculiXTransientThermalDatV2(source.replace('1 1 -0.01 0 0', '1 1 -0.01 0 NaN'),
    model, [100, 400, 1200]), /non-finite/);
  assert.throws(() => parseCalculiXTransientThermalDatV2([block(100), block(400)].join('\n'),
    model, [100, 400, 1200]), /lacks a complete requested/);
  assert.throws(() => parseCalculiXTransientThermalDatV2(
    [block(100), block(400).split(' heat generation')[0], block(1200)].join('\n'),
    model, [100, 400, 1200]), /lacks a complete requested/);
  assert.throws(() => parseCalculiXTransientThermalDatV2(
    [block(100), block(400).replace(' 1 -0.5', ' 1 NaN'), block(1200)].join('\n'),
    model, [100, 400, 1200]), /non-finite/);
}

async function testPartialHistoryLifecycle(
  solver: CalculiXMultiDomainSolverProvider, request: NeutralSimulationRequestV2, model: NeutralFemModelV2,
): Promise<void> {
  testMalformedFrames(model);
  const cancelledRequest = transientVariant(request, 'active-cancellation', 1.2);
  const cancelledModel = bindModel(model, cancelledRequest);
  const beforeCancellation = await providerDirectories();
  const cancelledSubmission = await solver.submit(cancelledRequest, cancelledModel);
  const cancellationDirectory = await newProviderDirectory(beforeCancellation);
  const cancelledPartial = await waitForFirstFrame(cancellationDirectory, cancelledModel, solver,
    cancelledSubmission.providerRunId, true);
  assert.equal(await solver.getResult(cancelledSubmission.providerRunId), null);
  assert.throws(() => parseCalculiXTransientThermalDatV2(cancelledPartial, cancelledModel, [100, 400, 1200]),
    /lacks a complete requested|duplicate or incomplete RFL\/HFL rows|complete bounded NT, HFL, and RFL/);
  const cancelledStatus = await solver.cancel(cancelledSubmission.providerRunId);
  assert.equal(cancelledStatus.status, 'cancelled');
  assert.equal(cancelledStatus.phase, 'cancelled_cleaned');
  await assertQuarantined(solver, cancelledSubmission.providerRunId);
  await waitForDirectoryRemoval(cancellationDirectory);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal((await solver.getStatus(cancelledSubmission.providerRunId)).status, 'cancelled');
  await assertQuarantined(solver, cancelledSubmission.providerRunId);

  const failedRequest = transientVariant(request, 'increment-exhaustion', 20, 6);
  const failedModel = bindModel(model, failedRequest);
  assert.match(createCalculiXInputDeckV2(failedRequest, failedModel), /^\*STEP, INC=6, AMPLITUDE=STEP$/m);
  const beforeFailure = await providerDirectories();
  const failedSubmission = await solver.submit(failedRequest, failedModel);
  const failureDirectory = await newProviderDirectory(beforeFailure);
  const failedPartial = await waitForFirstFrame(failureDirectory, failedModel, solver,
    failedSubmission.providerRunId, false);
  assert.throws(() => parseCalculiXTransientThermalDatV2(failedPartial, failedModel, [100, 400, 1200]),
    /lacks a complete requested/);
  const failedStatus = await waitForTerminal(solver, failedSubmission.providerRunId);
  assert.equal(failedStatus.status, 'failed');
  assert.equal(failedStatus.failure?.code, 'SIMULATION_SOLVER_FAILED');
  assert.match(failedStatus.failure?.message ?? '', /max\. # of increments reached|too many increments|increment/i);
  await assertQuarantined(solver, failedSubmission.providerRunId);
  await waitForDirectoryRemoval(failureDirectory);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal((await solver.getStatus(failedSubmission.providerRunId)).status, 'failed');
  await assertQuarantined(solver, failedSubmission.providerRunId);
  console.log(JSON.stringify({ status: 'PASS', fixture: 'SIM-9 transient slab partial NT/HFL/RFL lifecycle',
    versions: { gmsh: '4.15.2', calculix: '2.16' },
    mesh: { nodes: model.nodes.length, elements: model.volumeElements.connectivity.length },
    cancellation: { firstFrameObserved: true, status: cancelledStatus.status, phase: cancelledStatus.phase,
      resultQuarantined: true, lateResultQuarantined: true, temporaryDirectoryRemoved: true },
    nonconvergence: { firstFrameObserved: true, status: failedStatus.status, code: failedStatus.failure?.code,
      resultQuarantined: true, lateResultQuarantined: true, temporaryDirectoryRemoved: true },
    malformedFramesRejected: ['missing-final', 'truncated-intermediate', 'nonfinite-intermediate'],
    engineeringUsePermitted: false }, null, 2));
}

function transientVariant(
  request: NeutralSimulationRequestV2, label: string, maximumIncrementS: number, maximumIncrements?: number,
): NeutralSimulationRequestV2 {
  const draft = structuredClone(request);
  if (draft.analysis.type !== 'transient_thermal') throw new Error('Expected a SIM-9 transient request.');
  draft.studyId = 'sim9-' + label;
  draft.name = 'SIM-9 ' + label;
  draft.analysis.settings.maximumIncrementS = maximumIncrementS;
  draft.analysis.settings.maximumIncrements = maximumIncrements;
  return sealNeutralSimulationRequestV2(draft);
}

function bindModel(model: NeutralFemModelV2, request: NeutralSimulationRequestV2): NeutralFemModelV2 {
  const bound = structuredClone(model);
  bound.requestDigest = request.requestDigest;
  return bound;
}

async function providerDirectories(): Promise<string[]> {
  return (await readdir(tmpdir())).filter(name => name.startsWith('tunacad-calculix-v2-')).sort();
}
async function newProviderDirectory(before: string[]): Promise<string> {
  const added = (await providerDirectories()).filter(name => !before.includes(name));
  assert.equal(added.length, 1, 'Exactly one transient provider directory should be created.');
  return added[0];
}
async function waitForFirstFrame(
  directoryName: string, model: NeutralFemModelV2, solver: CalculiXMultiDomainSolverProvider,
  providerRunId: string, requireRunning: boolean,
): Promise<string> {
  const resultPath = join(tmpdir(), directoryName, 'tunacadv2.dat');
  const deadline = Date.now() + 30_000;
  let lastObservation = 'no DAT data yet';
  while (Date.now() < deadline) {
    try {
      const contents = await readFile(resultPath, 'utf8');
      assert(Buffer.byteLength(contents, 'utf8') <= 32 * 1024 * 1024);
      const lines = contents.split(/\r?\n/);
      const nextFrame = lines.findIndex(line => {
        if (!/\bfor set\b/i.test(line) || !/\band time\b/i.test(line)) return false;
        const rawTime = /\band time\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?)/i.exec(line)?.[1];
        return rawTime !== undefined && Number(rawTime.replace(/[dD]/g, 'E')) > 100.0001;
      });
      const firstFrameText = (nextFrame < 0 ? lines : lines.slice(0, nextFrame)).join('\n');
      const frame = parseCalculiXTransientThermalDatV2(firstFrameText, model, [100]);
      assert.equal(frame.length, 1);
      const status = await solver.getStatus(providerRunId);
      if (requireRunning) assert.equal(status.status, 'running',
        'The transient fixture completed before active cancellation.');
      return contents;
    } catch (caught) {
      if (caught instanceof assert.AssertionError) throw caught;
      lastObservation = caught instanceof Error ? caught.message : String(caught);
    }
    const status = await solver.getStatus(providerRunId);
    if (requireRunning && status.status !== 'running') {
      throw new Error('Transient solve reached ' + status.status
        + ' before active cancellation after a complete first frame: ' + lastObservation);
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for the complete 100 s transient NT/HFL/RFL frame: ' + lastObservation);
}
async function waitForTerminal(solver: CalculiXMultiDomainSolverProvider, providerRunId: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const status = await solver.getStatus(providerRunId);
    if (status.status !== 'running' && status.status !== 'queued') return status;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for the deliberate SIM-9 non-convergence status.');
}
async function waitForDirectoryRemoval(directoryName: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!(await providerDirectories()).includes(directoryName)) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('SIM-9 provider temporary directory was not cleaned up: ' + directoryName);
}
async function assertQuarantined(solver: CalculiXMultiDomainSolverProvider, providerRunId: string): Promise<void> {
  assert.equal(await solver.getResult(providerRunId), null);
  await assert.rejects(() => solver.getFieldDataset(providerRunId, providerRunId + ':slab:temperature'),
    /Unknown or expired/);
}

function createRequest(): NeutralSimulationRequestV2 {
  const projectRevision = 'sim9-real-r1';
  const face = (semanticReferenceId: string, role: 'load' | 'constraint', x: number) => ({
    semanticReferenceId, domainId: 'slab', ownerPartId: 'slab-part', ownerBodyId: 'slab-body', occurrenceId: 'slab-occurrence',
    geometryKind: 'FACE' as const, role, sourceFeatureId: 'slab-box', resolutionState: 'valid' as const, resolvedAtProjectRevision: projectRevision,
    faceOwnerLocal: { centroidPartLocalMm: [x, 5, 5] as NeutralVector3, areaMm2: 100,
      outwardDirection: [x === 0 ? -1 : 1, 0, 0] as NeutralVector3, geometryType: 'plane',
      edgeCount: 4, boundingBoxMm: { min: [x, 0, 0] as NeutralVector3, max: [x, 10, 10] as NeutralVector3 } },
  });
  return sealNeutralSimulationRequestV2({
    schema: 'tunacad-neutral-simulation-request/2.0', studyId: 'sim9-real-transient-slab', name: 'SIM-9 transient slab',
    preparedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    analysis: { type: 'transient_thermal',
      assumptions: ['transient', 'isotropic_conduction', 'temperature_independent_properties', 'uniform_initial_temperature', 'step_boundary_conditions'],
      settings: { initialTemperatureC: 20, durationS: 1200, outputTimesS: [100, 400, 1200] } },
    model: { projectRevision, coordinateSpace: 'frozen_analysis', domains: [{
      domainId: 'slab', partId: 'slab-part', bodyId: 'slab-body', occurrenceId: 'slab-occurrence',
      geometryDigest: digest({ fixture: '100x10x10-slab-step' }), transformToAnalysis: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      shape: { valid: true, connectedSolidCount: 1, faceCount: 6, edgeCount: 12, volumeMm3: 10_000, surfaceAreaMm2: 4_200,
        boundingBoxOwnerLocalMm: { min: [0, 0, 0], max: [100, 10, 10], size: [100, 10, 10] } },
    }], references: [face('cold-face', 'constraint', 0), face('heated-face', 'load', 100)] },
    units: { geometry: 'mm', force: 'N', stress: 'MPa', displacement: 'mm', density: 'kg/m^3', acceleration: 'mm/s^2',
      temperature: 'degC', heatFlux: 'W/m^2', heatFlow: 'W', thermalConductivity: 'W/(m*K)', time: 's', specificHeat: 'J/(kg*K)' },
    materials: [{ id: 'thermal-material', name: 'Constant-property fixture', model: 'isotropic_linear_elastic', youngsModulusMPa: 1,
      poissonRatio: 0, densityKgM3: 7800, specificHeatJPerKgK: 500, thermalConductivityWPerMK: 50,
      source: { kind: 'custom', reference: 'SIM-9 analytical fixture' } }],
    materialAssignments: [{ assignmentId: 'slab-material', domainId: 'slab', materialId: 'thermal-material', volumeRegionId: 'slab-volume' }],
    loads: [{ id: 'inward-flux', name: 'Inward heat flux', type: 'surface_heat_flux', semanticReferenceIds: ['heated-face'], heatFluxWPerM2: 10_000 }],
    constraints: [{ id: 'cold-temperature', name: 'Cold face', type: 'prescribed_temperature', semanticReferenceIds: ['cold-face'], temperatureC: 20 }],
    interactions: [], mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2, globalSizeMm: 10, minimumSizeMm: 2.5,
      maximumNodes: 100_000, maximumElements: 50_000, qualityMetric: 'provider_normalized', minimumQuality: 0.04 },
    requestedResults: ['temperature_history', 'heat_flow_history'],
  });
}
