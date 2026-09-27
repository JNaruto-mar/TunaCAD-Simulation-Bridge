import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asV1Mesh, createCalculiXInputDeckV2, requireRegions } from '../providers/calculix/CalculiXMultiDomainDeck.mts';
import { parseCalculiXImplicitDynamicsDatV2 } from '../providers/calculix/CalculiXImplicitDynamics.mts';
import { consistentSurfaceLoads } from '../providers/calculix/CalculiXSolverProvider.mts';
import { GmshMultiDomainMeshProvider } from '../providers/gmsh/GmshMultiDomainMeshProvider.mts';
import { sealNeutralSimulationRequestV2 } from '../simulation-bridge/v2Validation.mts';
import type { NeutralFemModelV2, NeutralSimulationRequestV2 } from '../src/simulation/externalSimulationContracts.ts';
import { makeRequest } from './test-sim9-implicit-dynamics-contract.mts';

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (!gmsh || !calculix) throw new Error('Explicit Gmsh and CalculiX executable paths are required.');
const directory = await mkdtemp(join(tmpdir(), 'tunacad-sim9-dynamics-convergence-'));
try {
  const stepPath = join(directory, 'bar.step');
  const geoPath = join(directory, 'bar.geo');
  await writeFile(geoPath, ['SetFactory("OpenCASCADE");', 'Box(1) = {0, 0, 0, 100, 10, 10};',
    'Save "' + stepPath.replace(/\\/g, '/').replace(/"/g, '\\"') + '";'].join('\n'), 'utf8');
  execFileSync(gmsh, [geoPath, '-0', '-v', '2'], { cwd: directory, windowsHide: true });
  const step = new Uint8Array(await readFile(stepPath));
  const mesher = new GmshMultiDomainMeshProvider({ executable: gmsh, runtimeVersion: '4.15.2' });
  const meshSizesMm = [10, 7.5, 5];
  const timeStepDivisors = [64, 128, 256];
  const models = new Map<number, { request: NeutralSimulationRequestV2; model: NeutralFemModelV2 }>();
  for (const sizeMm of meshSizesMm) {
    const draft = makeRequest();
    draft.mesh.globalSizeMm = sizeMm;
    draft.mesh.minimumSizeMm = Math.min(draft.mesh.minimumSizeMm, sizeMm / 4);
    const request = sealNeutralSimulationRequestV2(draft);
    const model = await mesher.mesh(request, {
      descriptor: request.model,
      async exportDomain(domainId, format) {
        assert.equal(domainId, 'bar');
        assert.equal(format, 'step');
        return step;
      },
    });
    models.set(sizeMm, { request, model });
  }
  type Sample = Awaited<ReturnType<typeof run>>;
  const timeSeries: Sample[] = [];
  for (const divisor of timeStepDivisors) {
    const { request, model } = models.get(10)!;
    timeSeries.push(await run(request, model, divisor, 'time-' + divisor));
  }
  const meshSeries: Sample[] = [];
  for (const sizeMm of meshSizesMm) {
    if (sizeMm === 10) {
      meshSeries.push(timeSeries[2]);
    } else {
      const { request, model } = models.get(sizeMm)!;
      meshSeries.push(await run(request, model, 256, 'mesh-' + String(sizeMm).replace('.', '-')));
    }
  }
  const selected = timeSeries[1]; // Current provider's 1/128-duration maximum increment.
  const repeated = await run(models.get(10)!.request, models.get(10)!.model, 128, 'repeat');
  assert.deepEqual(selected.frames, repeated.frames, 'Repeated solver histories must be deterministic.');
  const timeTrend = trend(timeSeries);
  const meshTrend = trend(meshSeries);
  assert(timeTrend.displacementStable && timeTrend.reactionStable && timeTrend.energyStable,
    'Time-step refinement has not stabilized displacement, reaction, and energy.');
  assert(meshTrend.displacementStable && meshTrend.reactionStable && meshTrend.energyStable,
    'Mesh refinement has not stabilized displacement, reaction, and energy.');
  console.log(JSON.stringify({
    status: 'PASS', fixture: 'SIM-9 axial-bar implicit-dynamics time-step and mesh convergence',
    versions: { gmsh: '4.15.2', calculix: '2.16' },
    requestedTimesS: selected.frames.map(frame => frame.timeS),
    analytical: selected.frames.map(frame => ({ timeS: frame.timeS, ...reference(frame.timeS) })),
    timeSeries, meshSeries, timeTrend, meshTrend,
    selectedBaseline: { meshSizeMm: 10, maximumIncrementDivisor: 128,
      nodes: selected.nodes, elements: selected.elements },
    repeatedFramesIdentical: true, engineeringUsePermitted: false,
  }, null, 2));

  async function run(request: NeutralSimulationRequestV2, model: NeutralFemModelV2, divisor: number, label: string) {
    assert.equal(request.analysis.type, 'implicit_transient_dynamics');
    assert.equal(request.loads[0]?.type, 'surface_force');
    const baseDeck = createCalculiXInputDeckV2(request, model);
    const duration = request.analysis.settings.durationS;
    const dynamicLine = [duration / (2 * divisor), duration, duration / 1_000_000, duration / divisor]
      .map(value => value.toExponential(9)).join(',');
    assert(dynamicLine.length < 80, 'CalculiX input card must remain below its record limit.');
    const deck = baseDeck.replace(/(\*DYNAMIC, ALPHA=0\r?\n)[^\r\n]+/, '$1' + dynamicLine);
    assert.notEqual(deck, baseDeck);
    assert.equal(deck, baseDeck.replace(/(\*DYNAMIC, ALPHA=0\r?\n)[^\r\n]+/, '$1' + dynamicLine));
    const job = 'dynamics-' + label;
    await writeFile(join(directory, job + '.inp'), deck, 'utf8');
    try {
      execFileSync(calculix, ['-i', job], { cwd: directory, windowsHide: true,
        timeout: 120_000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (caught) {
      const output = caught as { stdout?: Buffer; stderr?: Buffer };
      throw new Error('CalculiX ' + job + ' failed: '
        + String(output.stdout ?? '').slice(-2500) + String(output.stderr ?? '').slice(-500));
    }
    const parsed = parseCalculiXImplicitDynamicsDatV2(await readFile(join(directory, job + '.dat'), 'utf8'),
      model, request.analysis.settings.outputTimesS);
    const load = request.loads[0];
    assert.equal(load.type, 'surface_force');
    const facets = [...new Set(requireRegions(model, load.semanticReferenceIds)
      .flatMap(region => region.facetIndices))].sort((a, b) => a - b);
    const nodes = [...new Set(facets.flatMap(index => model.boundaryFacets.connectivity[index]))];
    const nodalLoads = consistentSurfaceLoads(asV1Mesh(model), facets, load.forceN);
    const frames = parsed.map(frame => {
      const axialDisplacementMm = nodes.reduce((sum, node) =>
        sum + frame.displacementsByNode.get(node)![0], 0) / nodes.length;
      const appliedWorkNmm = [...nodalLoads].reduce((sum, [node, force]) => {
        const u = frame.displacementsByNode.get(node)!;
        return sum + force.reduce((work, component, axis) => work + component * u[axis], 0);
      }, 0);
      const energyResidualNmm = Math.abs(frame.kineticEnergyNmm + frame.strainEnergyNmm - appliedWorkNmm);
      return { timeS: frame.timeS, axialDisplacementMm,
        supportReactionN: frame.supportReactionForceN[0], kineticEnergyNmm: frame.kineticEnergyNmm,
        strainEnergyNmm: frame.strainEnergyNmm, appliedWorkNmm, energyResidualNmm,
        displacementErrorMm: axialDisplacementMm - reference(frame.timeS).displacementMm,
        reactionErrorN: frame.supportReactionForceN[0] - reference(frame.timeS).reactionN };
    });
    return { meshSizeMm: request.mesh.globalSizeMm, maximumIncrementDivisor: divisor,
      nodes: model.nodes.length, elements: model.volumeElements.connectivity.length, frames };
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

function reference(timeS: number) {
  const waveTransitS = .1 / Math.sqrt(200e9 / 7800);
  const phase = timeS / waveTransitS;
  const displacementMm = .0005 * (phase <= 2 ? phase : 4 - phase);
  return { displacementMm, reactionN: phase < 1 || phase > 3 ? 0 : -200,
    workNmm: 100 * displacementMm };
}

function trend(series: Array<{ frames: Array<{ axialDisplacementMm: number; supportReactionN: number;
  energyResidualNmm: number; appliedWorkNmm: number }> }>) {
  const coarse = series[0].frames;
  const middle = series[1].frames;
  const fine = series[2].frames;
  const maximumPairDelta = (key: 'axialDisplacementMm' | 'supportReactionN' | 'energyResidualNmm',
    left: typeof coarse, right: typeof coarse) =>
    Math.max(...left.map((frame, index) => Math.abs(frame[key] - right[index][key])));
  const displacementCoarseToMiddleMm = maximumPairDelta('axialDisplacementMm', coarse, middle);
  const displacementMiddleToFineMm = maximumPairDelta('axialDisplacementMm', middle, fine);
  const reactionCoarseToMiddleN = maximumPairDelta('supportReactionN', coarse, middle);
  const reactionMiddleToFineN = maximumPairDelta('supportReactionN', middle, fine);
  const energyCoarseToMiddleNmm = maximumPairDelta('energyResidualNmm', coarse, middle);
  const energyMiddleToFineNmm = maximumPairDelta('energyResidualNmm', middle, fine);
  return {
    displacementCoarseToMiddleMm, displacementMiddleToFineMm,
    reactionCoarseToMiddleN, reactionMiddleToFineN,
    energyCoarseToMiddleNmm, energyMiddleToFineNmm,
    displacementStable: displacementMiddleToFineMm <= 2e-5,
    reactionStable: reactionMiddleToFineN <= 35,
    energyStable: fine.every(frame => frame.energyResidualNmm <= Math.max(1e-5, Math.abs(frame.appliedWorkNmm) * .05)),
  };
}
