import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCalculiXInputDeckV2 } from '../providers/calculix/CalculiXMultiDomainDeck.mts';
import { CalculiXMultiDomainSolverProvider } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { GmshMultiDomainMeshProvider } from '../providers/gmsh/GmshMultiDomainMeshProvider.mts';
import { validateNeutralSimulationResultV2 } from '../simulation-bridge/v2Validation.mts';
import type { NeutralFemModelV2, NeutralSimulationRequestV2 } from '../src/simulation/externalSimulationContracts.ts';
import { makeRequest } from './test-sim9-implicit-dynamics-contract.mts';

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (!gmsh || !calculix) throw new Error('Explicit Gmsh and CalculiX executable paths are required.');
const directory = await mkdtemp(join(tmpdir(), 'tunacad-sim9-dynamics-'));
try {
  const geoPath = join(directory, 'bar.geo');
  const stepPath = join(directory, 'bar.step');
  await writeFile(geoPath, ['SetFactory("OpenCASCADE");', 'Box(1) = {0, 0, 0, 100, 10, 10};',
    'Save "' + stepPath.replace(/\\/g, '/').replace(/"/g, '\\"') + '";'].join('\n'), 'utf8');
  execFileSync(gmsh, [geoPath, '-0', '-v', '2'], { cwd: directory, windowsHide: true });
  const step = new Uint8Array(await readFile(stepPath));
  const request = makeRequest();
  const mesher = new GmshMultiDomainMeshProvider({ executable: gmsh, runtimeVersion: '4.15.2' });
  const model = await mesher.mesh(request, {
    descriptor: request.model,
    async exportDomain(domainId, format) {
      assert.equal(domainId, 'bar');
      assert.equal(format, 'step');
      return step;
    },
  });
  const deck = createCalculiXInputDeckV2(request, model);
  assert.equal(deck, createCalculiXInputDeckV2(request, model));
  assert.match(deck, /^\*DYNAMIC, ALPHA=0$/m);
  assert.match(deck, /^\*TIME POINTS, NAME=DYNAMICS_OUTPUT$/m);
  assert.match(deck, /^\*NODE PRINT, NSET=REACTION_001, TOTALS=ONLY, GLOBAL=YES, TIME POINTS=DYNAMICS_OUTPUT$/m);
  const solver = new CalculiXMultiDomainSolverProvider({ executable: calculix, runtimeVersion: '2.16' });
  const first = await solve(solver, request, model);
  const repeat = await solve(solver, request, model);
  assert.equal(first.analysisType, 'implicit_transient_dynamics');
  assert.equal(repeat.analysisType, 'implicit_transient_dynamics');
  assert.deepEqual(first.implicitDynamics, repeat.implicitDynamics);
  assert.equal(first.review.engineeringUsePermitted, false);
  const waveTransitS = .1 / Math.sqrt(200e9 / 7800);
  const staticDisplacementMm = .0005;
  const reference = (timeS: number) => {
    const phase = timeS / waveTransitS;
    const tipMm = staticDisplacementMm * (phase <= 2 ? phase : 4 - phase);
    const supportReactionN = phase < 1 || phase > 3 ? 0 : -200;
    return { tipMm, supportReactionN, workNmm: 100 * tipMm };
  };
  const comparisons = first.implicitDynamics.frames.map(frame => {
    const expected = reference(frame.timeS);
    const tipMm = frame.loadedFaceMeanDisplacementMm[0];
    const tipErrorMm = tipMm - expected.tipMm;
    const reactionErrorN = frame.supportReactionForceN[0] - expected.supportReactionN;
    assert(Math.abs(tipErrorMm) < 8e-5, 'Provider tip displacement exceeds the bounded axial-wave reference.');
    assert(Math.abs(reactionErrorN) < 35, 'Support reaction exceeds the bounded axial-wave reference.');
    assert(frame.energyBalanceResidualNmm < Math.max(1e-5, frame.appliedWorkNmm * .05));
    return { timeS: frame.timeS, analyticalTipMm: expected.tipMm, providerTipMm: tipMm, tipErrorMm,
      analyticalReactionN: expected.supportReactionN, providerReactionN: frame.supportReactionForceN[0],
      reactionErrorN, kineticEnergyNmm: frame.kineticEnergyNmm, strainEnergyNmm: frame.strainEnergyNmm,
      appliedWorkNmm: frame.appliedWorkNmm, energyBalanceResidualNmm: frame.energyBalanceResidualNmm };
  });
  const missing = structuredClone(first);
  missing.implicitDynamics.frames.pop();
  assert.throws(() => validateNeutralSimulationResultV2(missing, request), /BRIDGE_V2_DYNAMICS_RESULT_INVALID/);
  const reordered = structuredClone(first);
  reordered.implicitDynamics.frames.reverse();
  assert.throws(() => validateNeutralSimulationResultV2(reordered, request), /BRIDGE_V2_DYNAMICS_RESULT_INVALID/);
  const malformed = structuredClone(first);
  malformed.implicitDynamics.frames[1].kineticEnergyNmm = NaN;
  assert.throws(() => validateNeutralSimulationResultV2(malformed, request), /BRIDGE_V2_RESULT_INVALID/);
  console.log(JSON.stringify({ status: 'PASS', fixture: 'SIM-9 one-domain implicit dynamics provider',
    versions: { gmsh: '4.15.2', calculix: '2.16' },
    mesh: { nodes: model.nodes.length, elements: model.volumeElements.connectivity.length },
    formulation: 'implicit Newmark alpha=0; C3D10 consistent density; step FACE force',
    comparisons, deterministicDeck: true, deterministicFrames: true, malformedHistoriesRejected: true,
    engineeringUsePermitted: false }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}

async function solve(solver: CalculiXMultiDomainSolverProvider, request: NeutralSimulationRequestV2, model: NeutralFemModelV2) {
  const { providerRunId } = await solver.submit(request, model);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const status = await solver.getStatus(providerRunId);
    if (status.status === 'failed') throw new Error((status.failure?.code ?? 'SIMULATION_FAILED') + ': ' + status.failure?.message);
    if (status.status === 'succeeded') {
      const result = await solver.getResult(providerRunId);
      if (!result) throw new Error('Dynamics provider completed without a result.');
      validateNeutralSimulationResultV2(result, request);
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  await solver.cancel(providerRunId);
  throw new Error('Focused dynamics fixture timed out.');
}
