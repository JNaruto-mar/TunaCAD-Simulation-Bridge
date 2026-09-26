import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createCalculiXInputDeckV2 } from '../providers/calculix/CalculiXMultiDomainDeck.mts';
import { createCalculiXConstrainedThermalStressDeck, normalizeConstrainedThermalStressResult } from '../providers/calculix/CalculiXConstrainedThermalStress.mts';
import { transferThermalFieldSameMesh } from '../providers/calculix/CalculiXFreeThermalExpansion.mts';
import { parseCalculiXSteadyThermalDatV2 } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { GmshMultiDomainMeshProvider } from '../providers/gmsh/GmshMultiDomainMeshProvider.mts';
import { LOCAL_PROVIDER_RESOURCE_LIMITS, monitorWorkingDirectory, readUtf8FileBounded, spawnProviderProcess, terminateChildProcess } from '../providers/processLifecycle.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { solveFullyConstrainedThermalStress } from '../simulation-bridge/steadyThermalValidation.mts';
import { sealNeutralSimulationRequestV2, validateNeutralSimulationRequestV2 } from '../simulation-bridge/v2Validation.mts';
import type { NeutralSimulationRequestV2, NeutralVector3 } from '../src/simulation/externalSimulationContracts.ts';

const reference = solveFullyConstrainedThermalStress({
  youngsModulusMPa: 210_000, poissonRatio: .3, thermalExpansionPerK: 12e-6,
  temperatureChangeK: 20, endFaceAreaMm2: 100,
});
assert.ok(Math.abs(reference.normalStressMPa + 126) < 1e-12);
assert.ok(Math.abs(reference.endFaceReactionMagnitudeN - 12_600) < 1e-9);
assert.equal(reference.displacementMm, 0);
assert.throws(() => solveFullyConstrainedThermalStress({
  youngsModulusMPa: 210_000, poissonRatio: .5, thermalExpansionPerK: 12e-6,
  temperatureChangeK: 20, endFaceAreaMm2: 100,
}), { code: 'SIMULATION_THERMAL_FIXTURE_INVALID' });
const request = createRequest();
assert.deepEqual(validateNeutralSimulationRequestV2(request), request);

if (process.env.TUNACAD_SIM8_REAL === '1') {
  const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
  const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
  if (!gmsh || !calculix) throw new Error('Set Gmsh and CalculiX executable paths for the focused constrained-stress fixture.');
  const directory = await mkdtemp(join(tmpdir(), 'tunacad-sim8-constrained-stress-'));
  try {
    const stepPath = join(directory, 'slab.step');
    const geoPath = join(directory, 'slab.geo');
    await writeFile(geoPath, ['SetFactory("OpenCASCADE");', 'Box(1) = {0, 0, 0, 100, 10, 10};',
      'Save "' + stepPath.replace(/\\/g, '/').replace(/"/g, '\\"') + '";'].join('\n'), 'utf8');
    execFileSync(gmsh, [geoPath, '-0', '-v', '2'], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const step = new Uint8Array(await readFile(stepPath));
    const mesher = new GmshMultiDomainMeshProvider({ executable: gmsh, runtimeVersion: '4.15.2' });
    const model = await mesher.mesh(request, { descriptor: request.model,
      async exportDomain(domainId, format) {
        assert.equal(domainId, 'slab'); assert.equal(format, 'step'); return step;
      } });
    const thermalRaw = await runDeck(calculix, directory, 'thermal', createCalculiXInputDeckV2(request, model));
    const parsedThermal = parseCalculiXSteadyThermalDatV2(thermalRaw, model, ['THERMAL_REACTION_001']);
    const thermalProfileErrorC = Math.max(...[...parsedThermal.temperaturesByNode].map(([node, temperature]) =>
      Math.abs(temperature - (20 + .2 * model.nodes[node][0]))));
    const thermalHeatBalanceErrorW = Math.abs(1 + parsedThermal.reactionHeatBySetW.THERMAL_REACTION_001);
    assert.ok(thermalProfileErrorC <= .01);
    assert.ok(thermalHeatBalanceErrorW <= 1e-5);
    const transfer = transferThermalFieldSameMesh(model, model, parsedThermal.temperaturesByNode);
    const initialTemperatureSumC = [...transfer.temperaturesByNodeC.values()].reduce((sum, final) => sum + final - 20, 0);
    assert.ok(Math.abs(transfer.temperatureSumC - initialTemperatureSumC - 20 * model.nodes.length) < 1e-8);
    const structural = createCalculiXConstrainedThermalStressDeck(model, transfer, request.materials[0], 20);
    assert.deepEqual(structural, createCalculiXConstrainedThermalStressDeck(model, transfer, request.materials[0], 20));
    assert.match(structural.deck, /^\*BOUNDARY\nNALL,1,3,0$/m);
    assert.match(structural.deck, /^\*EXPANSION, ZERO=0\n0\.000012$/m);
    assert.equal((structural.deck.match(/^\*TEMPERATURE$/gm) ?? []).length, 1);
    const initialCards = structural.deck.split('*INITIAL CONDITIONS, TYPE=TEMPERATURE\n')[1].split('\n*STEP')[0].trim().split('\n');
    const finalCards = structural.deck.split('\n*TEMPERATURE\n')[1].split('\n*NODE PRINT')[0].trim().split('\n');
    assert.equal(initialCards.length, model.nodes.length);
    assert.equal(finalCards.length, model.nodes.length);
    for (let node = 0; node < model.nodes.length; node += 1) {
      const [initialId, initialC] = initialCards[node].split(',').map(Number);
      const [finalId, finalC] = finalCards[node].split(',').map(Number);
      assert.equal(initialId, node + 1);
      assert.equal(finalId, node + 1);
      assert.ok(Math.abs(finalC - initialC - 20) < 1e-9);
      assert.equal(finalC, transfer.temperaturesByNodeC.get(node));
    }
    const structuralRaw = await runDeck(calculix, directory, 'constrained', structural.deck);
    const result = normalizeConstrainedThermalStressResult(structuralRaw, model, transfer);
    assert.throws(() => normalizeConstrainedThermalStressResult('', model, transfer), /complete finite per-domain SIM-4A output/);
    assert.deepEqual(result, normalizeConstrainedThermalStressResult(structuralRaw, model, transfer),
      'Signed-stress normalization must be deterministic.');
    const stressErrorMPa = Math.max(...result.meanNormalStressMPa.map(value => Math.abs(value - reference.normalStressMPa)));
    const reactionMagnitudeN = Math.abs(result.endFaceReactionForceN[0]);
    const reactionErrorN = Math.abs(reactionMagnitudeN - reference.endFaceReactionMagnitudeN);
    assert.ok(stressErrorMPa <= 1, 'All three constrained normal stresses must match the hydrostatic oracle.');
    assert.ok(reactionErrorN <= 150, 'End FACE reaction must match the analytical stress-area resultant within 1.2%.');
    assert.ok(result.maximumConstrainedDisplacementMm <= 1e-8);
    assert.ok(Math.hypot(...result.wholeBodyReactionForceN) <= .01, 'Whole-body reaction must remain in global equilibrium.');
    assert.ok(result.maximumVonMisesStressMPa <= .1, 'Hydrostatic stress should have near-zero von Mises stress.');
    assert.equal(result.transferredTemperatureDigest, transfer.temperatureDigest);
    assert.equal(result.transferredNodeCount, model.nodes.length);
    assert.equal(result.engineeringUsePermitted, false);
    console.log(JSON.stringify({ status: 'PASS', fixture: 'same-mesh-fully-constrained-thermal-stress',
      versions: { gmsh: '4.15.2', calculix: '2.16' },
      mesh: { nodes: model.nodes.length, elements: model.volumeElements.connectivity.length },
      analytical: reference,
      provider: { meanNormalStressMPa: result.meanNormalStressMPa, endFaceReactionForceN: result.endFaceReactionForceN,
        wholeBodyReactionForceN: result.wholeBodyReactionForceN,
        maximumConstrainedDisplacementMm: result.maximumConstrainedDisplacementMm,
        maximumVonMisesStressMPa: result.maximumVonMisesStressMPa },
      transfer: { mode: 'same-mesh-exact-node-identity', transferredNodeCount: result.transferredNodeCount,
        temperatureDigest: result.transferredTemperatureDigest, finalTemperatureSumC: result.transferredTemperatureSumC,
        initialTemperatureSumC, pointwiseTemperatureChangeK: 20,
        thermalProfileErrorC, thermalHeatBalanceErrorW },
      comparison: { stressErrorMPa, reactionErrorN, deterministicDeck: true, deterministicNormalization: true } }, null, 2));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
} else {
  console.log('SIM-8 constrained-stress analytical/contract PASS; set TUNACAD_SIM8_REAL=1 for the focused two-stage solve.');
}

async function runDeck(executable: string, directory: string, name: string, deck: string): Promise<string> {
  if (Buffer.byteLength(deck, 'utf8') > LOCAL_PROVIDER_RESOURCE_LIMITS.maximumResultFileBytes) throw new Error('SIMULATION_INPUT_LIMIT');
  await writeFile(join(directory, name + '.inp'), deck, 'utf8');
  const child = spawnProviderProcess(executable, ['-i', name], {
    cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: dirname(executable) + (process.platform === 'win32' ? ';' : ':') + (process.env.PATH ?? '') },
  });
  let diagnostic = ''; let exceeded = false;
  const collect = (chunk: unknown) => { diagnostic = (diagnostic + String(chunk)).slice(-LOCAL_PROVIDER_RESOURCE_LIMITS.maximumDiagnosticCharacters); };
  child.stdout?.on('data', collect); child.stderr?.on('data', collect);
  const stopMonitor = monitorWorkingDirectory({ child, directory, onExceeded: async () => { exceeded = true; await terminateChildProcess(child); } });
  const timeout = setTimeout(() => { exceeded = true; void terminateChildProcess(child); }, 30_000); timeout.unref();
  try {
    const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    if (exceeded || code !== 0) throw new Error('SIM-8 ' + name + ' solve failed: ' + diagnostic.slice(-1500));
    return readUtf8FileBounded(join(directory, name + '.dat'));
  } finally {
    clearTimeout(timeout); stopMonitor(); await terminateChildProcess(child);
  }
}

function createRequest(): NeutralSimulationRequestV2 {
  const revision = 'sim8-constrained-stress-r1';
  const face = (id: string, role: 'load' | 'constraint', x: number) => ({
    semanticReferenceId: id, domainId: 'slab', ownerPartId: 'slab-part', ownerBodyId: 'slab-body', occurrenceId: 'slab-occurrence',
    geometryKind: 'FACE' as const, role, sourceFeatureId: 'slab-box', resolutionState: 'valid' as const, resolvedAtProjectRevision: revision,
    faceOwnerLocal: { centroidPartLocalMm: [x, 5, 5] as NeutralVector3, areaMm2: 100,
      outwardDirection: [x === 0 ? -1 : 1, 0, 0] as NeutralVector3, geometryType: 'plane', edgeCount: 4,
      boundingBoxMm: { min: [x, 0, 0] as NeutralVector3, max: [x, 10, 10] as NeutralVector3 } },
  });
  return sealNeutralSimulationRequestV2({
    schema: 'tunacad-neutral-simulation-request/2.0', studyId: 'sim8-constrained-thermal-stress', name: 'SIM-8 constrained thermal stress',
    preparedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    analysis: { type: 'steady_thermal', assumptions: ['steady_state', 'isotropic_conduction', 'temperature_independent_properties'] },
    model: { projectRevision: revision, coordinateSpace: 'frozen_analysis',
      domains: [{ domainId: 'slab', partId: 'slab-part', bodyId: 'slab-body', occurrenceId: 'slab-occurrence',
        geometryDigest: digest({ fixture: '100x10x10-slab-step' }), transformToAnalysis: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        shape: { valid: true, connectedSolidCount: 1, faceCount: 6, edgeCount: 12, volumeMm3: 10_000,
          surfaceAreaMm2: 4_200, boundingBoxOwnerLocalMm: { min: [0, 0, 0], max: [100, 10, 10], size: [100, 10, 10] } } }],
      references: [face('cold-face', 'constraint', 0), face('heated-face', 'load', 100)] },
    units: { geometry: 'mm', force: 'N', stress: 'MPa', displacement: 'mm', density: 'kg/m^3', acceleration: 'mm/s^2',
      temperature: 'degC', heatFlux: 'W/m^2', heatFlow: 'W', thermalConductivity: 'W/(m*K)' },
    materials: [{ id: 'thermal-material', name: 'Isotropic thermoelastic fixture', model: 'isotropic_linear_elastic',
      youngsModulusMPa: 210_000, poissonRatio: .3, thermalConductivityWPerMK: 50, thermalExpansionPerK: 12e-6,
      source: { kind: 'custom', reference: 'SIM-8 constrained-stress fixture' } }],
    materialAssignments: [{ assignmentId: 'slab-material', domainId: 'slab', materialId: 'thermal-material', volumeRegionId: 'slab-volume' }],
    loads: [{ id: 'inward-flux', name: 'Inward heat flux', type: 'surface_heat_flux', semanticReferenceIds: ['heated-face'], heatFluxWPerM2: 10_000 }],
    constraints: [{ id: 'cold-temperature', name: 'Cold face', type: 'prescribed_temperature',
      semanticReferenceIds: ['cold-face'], temperatureC: 20 }],
    interactions: [], mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2, globalSizeMm: 10,
      minimumSizeMm: 2.5, maximumNodes: 100_000, maximumElements: 50_000, qualityMetric: 'provider_normalized', minimumQuality: .04 },
    requestedResults: ['temperature', 'heat_flux', 'reaction_heat_flow'],
  });
}
