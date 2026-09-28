import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCalculiXInputDeckV2, requireRegions } from '../providers/calculix/CalculiXMultiDomainDeck.mts';
import { parseCalculiXHarmonicDatV2 } from '../providers/calculix/CalculiXHarmonic.mts';
import { GmshMultiDomainMeshProvider } from '../providers/gmsh/GmshMultiDomainMeshProvider.mts';
import { sealNeutralSimulationRequestV2 } from '../simulation-bridge/v2Validation.mts';
import { selectHarmonicModeCount } from '../simulation-bridge/harmonicModePolicy.mts';
import type { NeutralFemModelV2, NeutralSimulationRequestV2 } from '../src/simulation/externalSimulationContracts.ts';
import { makeRequest } from './test-sim9-harmonic-contract.mts';

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (!gmsh || !calculix) throw new Error('Explicit Gmsh and CalculiX paths are required.');
const directory = await mkdtemp(join(tmpdir(), 'tunacad-sim9-harmonic-convergence-'));
try {
  const geoPath = join(directory, 'bar.geo');
  const stepPath = join(directory, 'bar.step');
  await writeFile(geoPath, ['SetFactory("OpenCASCADE");', 'Box(1) = {0, 0, 0, 100, 10, 10};',
    'Save "' + stepPath.replace(/\\/g, '/').replace(/"/g, '\\"') + '";'].join('\n'), 'utf8');
  execFileSync(gmsh, [geoPath, '-0', '-v', '2'], { cwd: directory, windowsHide: true, timeout: 30_000 });
  const step = new Uint8Array(await readFile(stepPath));
  const mesher = new GmshMultiDomainMeshProvider({ executable: gmsh, runtimeVersion: '4.15.2' });
  const modelCache = new Map<string, { request: NeutralSimulationRequestV2; model: NeutralFemModelV2 }>();
  const getModel = async (meshSizeMm: number, frequencyHz: number) => {
    const key = meshSizeMm + ':' + frequencyHz;
    const cached = modelCache.get(key);
    if (cached) return cached;
    const draft = makeRequest(frequencyHz);
    draft.mesh.globalSizeMm = meshSizeMm;
    draft.mesh.minimumSizeMm = Math.min(draft.mesh.minimumSizeMm, meshSizeMm / 4);
    const request = sealNeutralSimulationRequestV2(draft);
    const model = await mesher.mesh(request, { descriptor: request.model,
      async exportDomain(domainId, format) {
        assert.equal(domainId, 'bar'); assert.equal(format, 'step'); return step;
      } });
    const pair = { request, model };
    modelCache.set(key, pair);
    return pair;
  };
  let jobIndex = 0;
  async function solve(meshSizeMm: number, frequencyHz: number, modes: number) {
    const { request, model } = await getModel(meshSizeMm, frequencyHz);
    const base = createCalculiXInputDeckV2(request, model);
    const selectedModes = selectHarmonicModeCount(frequencyHz, model.nodes.length,
      model.volumeElements.connectivity.length);
    const marker = '*FREQUENCY,SOLVER=ARPACK,STORAGE=YES\n' + selectedModes + '\n';
    assert.equal(base.split(marker).length, 2, 'Only the harmonic mode-count card may vary.');
    const deck = base.replace(marker, '*FREQUENCY,SOLVER=ARPACK,STORAGE=YES\n' + modes + '\n');
    assert.equal(deck, base.replace(marker, '*FREQUENCY,SOLVER=ARPACK,STORAGE=YES\n' + modes + '\n'));
    const job = 'harmonic-' + (++jobIndex);
    await writeFile(join(directory, job + '.inp'), deck, 'utf8');
    try {
      execFileSync(calculix, ['-i', job], { cwd: directory, windowsHide: true, timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (caught) {
      const output = caught as { stdout?: Buffer; stderr?: Buffer };
      throw new Error('CalculiX ' + job + ' failed: '
        + String(output.stdout ?? '').slice(-1800) + String(output.stderr ?? '').slice(-500));
    }
    const parsed = parseCalculiXHarmonicDatV2(await readFile(join(directory, job + '.dat'), 'utf8'), model, frequencyHz);
    const load = request.loads[0];
    assert.equal(load.type, 'surface_force');
    const loadedNodes = [...new Set(requireRegions(model, load.semanticReferenceIds)
      .flatMap(region => region.facetIndices)
      .flatMap(index => model.boundaryFacets.connectivity[index]))].sort((a, b) => a - b);
    const axialMean = (values: Map<number, [number, number, number]>) =>
      loadedNodes.reduce((sum, node) => sum + values.get(node)![0], 0) / loadedNodes.length;
    const realU = axialMean(parsed.realDisplacementsByNode);
    const imaginaryU = axialMean(parsed.imaginaryDisplacementsByNode);
    const realR = parsed.realReactionN[0];
    const imaginaryR = parsed.imaginaryReactionN[0];
    const reference = axialWaveReference(frequencyHz);
    const sample = {
      meshSizeMm, frequencyHz, modes, nodes: model.nodes.length,
      elements: model.volumeElements.connectivity.length,
      analyticalDisplacementAmplitudeMm: Math.abs(reference.displacementMm),
      providerDisplacementAmplitudeMm: Math.hypot(realU, imaginaryU),
      displacementPhaseRad: phase(realU, imaginaryU),
      analyticalDisplacementPhaseRad: reference.displacementMm > 0 ? 0 : Math.PI,
      displacementRelativeError: Math.abs(realU / reference.displacementMm - 1),
      analyticalReactionAmplitudeN: Math.abs(reference.reactionN),
      providerReactionAmplitudeN: Math.hypot(realR, imaginaryR),
      reactionPhaseRad: phase(realR, imaginaryR),
      analyticalReactionPhaseRad: reference.reactionN > 0 ? 0 : Math.PI,
      reactionRelativeError: Math.abs(realR / reference.reactionN - 1),
      realDisplacementMm: realU, imaginaryDisplacementMm: imaginaryU,
      realReactionN: realR, imaginaryReactionN: imaginaryR,
    };
    console.log(JSON.stringify({ progress: job, ...sample }));
    return sample;
  }
  if (['1', '2', '3', '4'].includes(process.env.SIM9_HARMONIC_EXTRA ?? '')) {
    const extra = [];
    const cases = process.env.SIM9_HARMONIC_EXTRA === '1'
      ? [[10, 7000, 96], [10, 20_000, 96], [5, 20_000, 72], [5, 20_000, 96]]
      : process.env.SIM9_HARMONIC_EXTRA === '2'
        ? [[10, 20_000, 144], [5, 20_000, 144]]
        : process.env.SIM9_HARMONIC_EXTRA === '3'
          ? [[10, 20_000, 192], [5, 20_000, 192]]
          : [[5, 7000, 192], [5, 20_000, 192], [5, 20_000, 192]];
    for (const [meshSizeMm, frequencyHz, modes] of cases) extra.push(await solve(meshSizeMm, frequencyHz, modes));
    if (process.env.SIM9_HARMONIC_EXTRA === '4') {
      assert.deepEqual(extra[1], extra[2], 'Selected fine/192-mode 20 kHz baseline must repeat exactly.');
    }
    console.log(JSON.stringify({ status: 'PASS', fixture: 'SIM-9 harmonic high-mode diagnostic',
      extra, engineeringUsePermitted: false }, null, 2));
  } else {
  const modalSeries = [];
  for (const frequencyHz of [7000, 20_000]) {
    for (const modes of [24, 48, 72]) {
      modalSeries.push(await solve(10, frequencyHz, modes));
    }
  }
  const meshSeries = [];
  for (const frequencyHz of [7000, 20_000]) {
    meshSeries.push(modalSeries.find(entry => entry.frequencyHz === frequencyHz && entry.modes === 48)!);
    for (const meshSizeMm of [7.5, 5]) meshSeries.push(await solve(meshSizeMm, frequencyHz, 48));
  }
  const frequencySeries = [];
  for (const frequencyHz of [6500, 7000, 7500, 19_000, 20_000, 21_000]) {
    frequencySeries.push(modalSeries.find(entry => entry.frequencyHz === frequencyHz && entry.modes === 48)
      ?? await solve(10, frequencyHz, 48));
  }
  const repeated = await solve(10, 20_000, 48);
  const baseline = modalSeries.find(entry => entry.frequencyHz === 20_000 && entry.modes === 48)!;
  assert.deepEqual(repeated, baseline, 'Repeated harmonic results must be deterministic.');
  for (const sample of [...modalSeries, ...meshSeries, ...frequencySeries]) {
    assert.equal(sample.displacementPhaseRad, sample.analyticalDisplacementPhaseRad);
    assert.equal(sample.reactionPhaseRad, sample.analyticalReactionPhaseRad);
  }
  const trends = [7000, 20_000].map(frequencyHz => {
    const byModes = modalSeries.filter(entry => entry.frequencyHz === frequencyHz);
    const byMesh = meshSeries.filter(entry => entry.frequencyHz === frequencyHz);
    const modalFirstDeltaMm = Math.abs(byModes[1].providerDisplacementAmplitudeMm
      - byModes[0].providerDisplacementAmplitudeMm);
    const modalSecondDeltaMm = Math.abs(byModes[2].providerDisplacementAmplitudeMm
      - byModes[1].providerDisplacementAmplitudeMm);
    const meshFirstDeltaMm = Math.abs(byMesh[1].providerDisplacementAmplitudeMm
      - byMesh[0].providerDisplacementAmplitudeMm);
    const meshSecondDeltaMm = Math.abs(byMesh[2].providerDisplacementAmplitudeMm
      - byMesh[1].providerDisplacementAmplitudeMm);
    const maximumMeshReactionDeltaN = Math.max(
      Math.abs(byMesh[1].providerReactionAmplitudeN - byMesh[0].providerReactionAmplitudeN),
      Math.abs(byMesh[2].providerReactionAmplitudeN - byMesh[1].providerReactionAmplitudeN));
    assert(modalSecondDeltaMm < modalFirstDeltaMm * .3,
      'Displacement has not begun stabilizing with retained mode count.');
    assert(meshSecondDeltaMm < meshFirstDeltaMm * .3 && maximumMeshReactionDeltaN < .2,
      'Fixed-mode displacement/reaction has not stabilized with mesh refinement.');
    return { frequencyHz, modalFirstDeltaMm, modalSecondDeltaMm,
      meshFirstDeltaMm, meshSecondDeltaMm, maximumMeshReactionDeltaN,
      reactionModalConvergedAt48: false };
  });
  assert(frequencySeries.slice(0, 3).every((entry, index, series) => index === 0
    || entry.providerDisplacementAmplitudeMm > series[index - 1].providerDisplacementAmplitudeMm));
  assert(frequencySeries.slice(3).every((entry, index, series) => index === 0
    || entry.providerDisplacementAmplitudeMm < series[index - 1].providerDisplacementAmplitudeMm));
  console.log(JSON.stringify({ status: 'PASS', fixture: 'SIM-9 harmonic modal/mesh/frequency convergence',
    versions: { gmsh: '4.15.2', calculix: '2.16' }, modalSeries, meshSeries, frequencySeries,
    trends, repeatIdentical: true, engineeringUsePermitted: false }, null, 2));
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

function axialWaveReference(frequencyHz: number) {
  const c = Math.sqrt(200e9 / 7800);
  const argument = 2 * Math.PI * frequencyHz * .1 / c;
  return { displacementMm: .0005 * Math.tan(argument) / argument,
    reactionN: -100 / Math.cos(argument) };
}

function phase(real: number, imaginary: number) {
  return (Math.atan2(-imaginary, real) + 2 * Math.PI) % (2 * Math.PI);
}
