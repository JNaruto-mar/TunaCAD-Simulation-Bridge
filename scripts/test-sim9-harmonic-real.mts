import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCalculiXInputDeckV2 } from '../providers/calculix/CalculiXMultiDomainDeck.mts';
import { parseCalculiXHarmonicDatV2 } from '../providers/calculix/CalculiXHarmonic.mts';
import { CalculiXMultiDomainSolverProvider } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { GmshMultiDomainMeshProvider } from '../providers/gmsh/GmshMultiDomainMeshProvider.mts';
import { validateNeutralSimulationResultV2 } from '../simulation-bridge/v2Validation.mts';
import type { NeutralFemModelV2, NeutralSimulationRequestV2 } from '../src/simulation/externalSimulationContracts.ts';
import { makeRequest } from './test-sim9-harmonic-contract.mts';

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (!gmsh || !calculix) throw new Error('Explicit Gmsh and CalculiX executable paths are required.');
const directory = await mkdtemp(join(tmpdir(), 'tunacad-sim9-harmonic-'));
try {
  const geoPath = join(directory, 'bar.geo');
  const stepPath = join(directory, 'bar.step');
  await writeFile(geoPath, ['SetFactory("OpenCASCADE");', 'Box(1) = {0, 0, 0, 100, 10, 10};',
    'Save "' + stepPath.replace(/\\/g, '/').replace(/"/g, '\\"') + '";'].join('\n'), 'utf8');
  execFileSync(gmsh, [geoPath, '-0', '-v', '2'], { cwd: directory, windowsHide: true });
  const step = new Uint8Array(await readFile(stepPath));
  const mesher = new GmshMultiDomainMeshProvider({ executable: gmsh, runtimeVersion: '4.15.2' });
  const solver = new CalculiXMultiDomainSolverProvider({ executable: calculix, runtimeVersion: '2.16' });
  const comparisons = [];
  for (const frequencyHz of [7000, 20_000]) {
    const request = makeRequest(frequencyHz);
    const model = await mesher.mesh(request, { descriptor: request.model,
      async exportDomain(domainId, format) {
        assert.equal(domainId, 'bar'); assert.equal(format, 'step'); return step;
      } });
    const deck = createCalculiXInputDeckV2(request, model);
    assert.equal(deck, createCalculiXInputDeckV2(request, model));
    assert.match(deck, /^\*FREQUENCY,SOLVER=ARPACK,STORAGE=YES$/m);
    assert.match(deck, /^\*STEADY STATE DYNAMICS,HARMONIC=YES$/m);
    assert.match(deck, new RegExp('^' + frequencyHz + ',' + frequencyHz + ',2,1$', 'm'));
    const result = await solve(solver, request, model);
    const repeat = await solve(solver, request, model);
    assert.deepEqual(result.harmonic, repeat.harmonic);
    assert.equal(result.review.engineeringUsePermitted, false);
    const speedMPerS = Math.sqrt(200e9 / 7800);
    const waveArgument = 2 * Math.PI * frequencyHz * .1 / speedMPerS;
    const analyticalSignedDisplacementMm = .0005 * Math.tan(waveArgument) / waveArgument;
    const analyticalSignedReactionN = -100 / Math.cos(waveArgument);
    const measuredDisplacementMm = result.harmonic!.loadedFaceMeanDisplacement.realMm[0];
    const measuredReactionN = result.harmonic!.supportReaction.realN[0];
    const displacementRelativeError = Math.abs(measuredDisplacementMm / analyticalSignedDisplacementMm - 1);
    const reactionRelativeError = Math.abs(measuredReactionN / analyticalSignedReactionN - 1);
    assert(displacementRelativeError < .25, 'Harmonic displacement exceeds bounded 1D axial-wave reference.');
    assert(reactionRelativeError < .1, 'Harmonic support reaction exceeds bounded 1D axial-wave reference.');
    assert(Math.abs(result.harmonic!.loadedFaceMeanDisplacement.imaginaryMm[0]) < 1e-8);
    assert(Math.abs(result.harmonic!.supportReaction.imaginaryN[0]) < 1e-5);
    assert.equal(result.harmonic!.loadedFaceMeanDisplacement.phaseLagRad, frequencyHz < 10_000 ? 0 : Math.PI);
    assert.equal(result.harmonic!.supportReaction.phaseLagRad, frequencyHz < 10_000 ? Math.PI : 0);
    const missing = structuredClone(result);
    delete (missing as { harmonic?: unknown }).harmonic;
    assert.throws(() => validateNeutralSimulationResultV2(missing, request), /BRIDGE_V2_HARMONIC_RESULT_INVALID/);
    const malformed = structuredClone(result);
    malformed.harmonic!.supportReaction.imaginaryN[0] = NaN;
    assert.throws(() => validateNeutralSimulationResultV2(malformed, request), /BRIDGE_V2_RESULT_INVALID/);
    comparisons.push({ frequencyHz, nodes: model.nodes.length, elements: model.volumeElements.connectivity.length,
      analyticalSignedDisplacementMm, measuredDisplacementMm, displacementRelativeError,
      analyticalSignedReactionN, measuredReactionN, reactionRelativeError,
      displacementAmplitudeMm: result.harmonic!.loadedFaceMeanDisplacement.amplitudeMm,
      displacementPhaseLagRad: result.harmonic!.loadedFaceMeanDisplacement.phaseLagRad,
      reactionAmplitudeN: result.harmonic!.supportReaction.amplitudeN,
      reactionPhaseLagRad: result.harmonic!.supportReaction.phaseLagRad });
  }
  const fakeModel = { nodes: [[0, 0, 0], [1, 0, 0]] } as NeutralFemModelV2;
  const complete = ['MODE NO    EIGENVALUE                       FREQUENCY',
    '1 1.000000E+08 1.000000E+04 5.000000E+03 0.000000E+00',
    '2 4.000000E+08 2.000000E+04 3.000000E+04 0.000000E+00',
    'MODE NO    FREQUENCY               FACTOR',
    'displacements (vx,vy,vz) for set NALL and time  0.7000000E+04',
    '1 1.000000E-03 0.000000E+00 0.000000E+00', '2 1.000000E-03 0.000000E+00 0.000000E+00',
    'total force (fx,fy,fz) for set REACTION_001 and time  0.7000000E+04',
    '-1.000000E+02 0.000000E+00 0.000000E+00',
    'displacements (vx,vy,vz) for set NALL and time  0.7000000E+04',
    '1 0.000000E+00 0.000000E+00 0.000000E+00', '2 0.000000E+00 0.000000E+00 0.000000E+00',
    'total force (fx,fy,fz) for set REACTION_001 and time  0.7000000E+04',
    '0.000000E+00 0.000000E+00 0.000000E+00'].join('\n');
  assert.equal(parseCalculiXHarmonicDatV2(complete, fakeModel, 7000).realDisplacementsByNode.size, 2);
  assert.throws(() => parseCalculiXHarmonicDatV2(complete.replace('2 1.000000E-03', '1 1.000000E-03'), fakeModel, 7000));
  assert.throws(() => parseCalculiXHarmonicDatV2(complete.replace('0.7000000E+04', '0.8000000E+04'), fakeModel, 7000));
  assert.throws(() => parseCalculiXHarmonicDatV2(complete.replace('1.000000E-03', 'NaN'), fakeModel, 7000));
  assert.throws(() => parseCalculiXHarmonicDatV2(complete.split('\n').slice(0, -1).join('\n'), fakeModel, 7000));
  assert.throws(() => parseCalculiXHarmonicDatV2(complete + '\n' + complete, fakeModel, 7000));
  assert.throws(() => parseCalculiXHarmonicDatV2(complete.replace('for set NALL', 'for set OTHER'), fakeModel, 7000));
  assert.throws(() => parseCalculiXHarmonicDatV2(complete.replace('3.000000E+04', '6.000000E+03'), fakeModel, 7000),
    /modal coverage/);
  assert.throws(() => parseCalculiXHarmonicDatV2(complete.replace('5.000000E+03', '7.000000E+03'), fakeModel, 7000),
    /undamped resonance/);
  console.log(JSON.stringify({ status: 'PASS', fixture: 'SIM-9 one-frequency undamped harmonic axial bar',
    versions: { gmsh: '4.15.2', calculix: '2.16' }, comparisons,
    deterministicDeck: true, deterministicResults: true, malformedComplexDataRejected: true,
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
      if (!result) throw new Error('Harmonic provider completed without a result.');
      validateNeutralSimulationResultV2(result, request);
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  await solver.cancel(providerRunId);
  throw new Error('Focused harmonic fixture timed out.');
}
