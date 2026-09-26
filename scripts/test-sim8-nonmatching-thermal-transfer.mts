import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createCalculiXInputDeckV2 } from '../providers/calculix/CalculiXMultiDomainDeck.mts';
import { createCalculiXFreeThermalExpansionDeck, normalizeFreeThermalExpansionResult } from '../providers/calculix/CalculiXFreeThermalExpansion.mts';
import { parseCalculiXSteadyThermalDatV2 } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { GmshMultiDomainMeshProvider } from '../providers/gmsh/GmshMultiDomainMeshProvider.mts';
import { LOCAL_PROVIDER_RESOURCE_LIMITS, monitorWorkingDirectory, readUtf8FileBounded, spawnProviderProcess, terminateChildProcess } from '../providers/processLifecycle.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { solveFreeExpansionOfLinearSlab } from '../simulation-bridge/steadyThermalValidation.mts';
import { projectThermalFieldBetweenMeshes } from '../simulation-bridge/thermalMeshTransfer.mts';
import { sealNeutralSimulationRequestV2, validateNeutralSimulationRequestV2 } from '../simulation-bridge/v2Validation.mts';
import type { NeutralSimulationRequestV2, NeutralVector3 } from '../src/simulation/externalSimulationContracts.ts';

const analyticalExpansionMm = solveFreeExpansionOfLinearSlab({
  lengthMm: 100, thermalExpansionPerK: 12e-6, initialTemperatureC: 20,
  baseTemperatureC: 20, endTemperatureC: 40,
});
assert.equal(analyticalExpansionMm, .012);
const sourceRequest = createRequest(10);
const targetRequest = createRequest(8);
assert.deepEqual(validateNeutralSimulationRequestV2(sourceRequest), sourceRequest);
assert.deepEqual(validateNeutralSimulationRequestV2(targetRequest), targetRequest);
assert.equal(sourceRequest.model.modelDigest, targetRequest.model.modelDigest);
assert.notEqual(sourceRequest.requestDigest, targetRequest.requestDigest);

if (process.env.TUNACAD_SIM8_REAL === '1') {
  const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
  const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
  if (!gmsh || !calculix) throw new Error('Set Gmsh and CalculiX executable paths for the focused nonmatching transfer fixture.');
  const directory = await mkdtemp(join(tmpdir(), 'tunacad-sim8-mesh-transfer-'));
  try {
    const stepPath = join(directory, 'slab.step');
    const geoPath = join(directory, 'slab.geo');
    await writeFile(geoPath, ['SetFactory("OpenCASCADE");', 'Box(1) = {0, 0, 0, 100, 10, 10};',
      'Save "' + stepPath.replace(/\\/g, '/').replace(/"/g, '\\"') + '";'].join('\n'), 'utf8');
    execFileSync(gmsh, [geoPath, '-0', '-v', '2'], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const step = new Uint8Array(await readFile(stepPath));
    const mesher = new GmshMultiDomainMeshProvider({ executable: gmsh, runtimeVersion: '4.15.2' });
    const geometry = (request: NeutralSimulationRequestV2) => ({ descriptor: request.model,
      async exportDomain(domainId: string, format: 'step') {
        assert.equal(domainId, 'slab'); assert.equal(format, 'step'); return step;
      } });
    const source = await mesher.mesh(sourceRequest, geometry(sourceRequest));
    const target = await mesher.mesh(targetRequest, geometry(targetRequest));
    assert.notEqual(source.modelId, target.modelId);
    assert.notEqual(source.nodes.length, target.nodes.length);
    assert.notEqual(source.volumeElements.connectivity.length, target.volumeElements.connectivity.length);
    const thermalRaw = await runDeck(calculix, directory, 'thermal', createCalculiXInputDeckV2(sourceRequest, source));
    const thermal = parseCalculiXSteadyThermalDatV2(thermalRaw, source, ['THERMAL_REACTION_001']);
    const thermalHeatBalanceErrorW = Math.abs(1 + thermal.reactionHeatBySetW.THERMAL_REACTION_001);
    assert.ok(thermalHeatBalanceErrorW <= 1e-5);
    const transfer = projectThermalFieldBetweenMeshes(source, target, thermal.temperaturesByNode, 20);
    assert.deepEqual(transfer, projectThermalFieldBetweenMeshes(source, target, thermal.temperaturesByNode, 20),
      'Quadratic projection must be deterministic on the same two meshes.');
    assert.equal(transfer.nodeCount, target.nodes.length);
    assert.equal(transfer.sourceNodeCount, source.nodes.length);
    const sourceProfileErrorC = Math.max(...[...thermal.temperaturesByNode].map(([node, value]) =>
      Math.abs(value - (20 + .2 * source.nodes[node][0]))));
    const targetProfileErrorC = Math.max(...[...transfer.temperaturesByNodeC].map(([node, value]) =>
      Math.abs(value - (20 + .2 * target.nodes[node][0]))));
    const targetValues = [...transfer.temperaturesByNodeC.values()];
    assert.ok(sourceProfileErrorC <= .01 && targetProfileErrorC <= .02);
    assert.ok(Math.min(...targetValues) >= 19.99 && Math.max(...targetValues) <= 40.01);
    assert.ok(transfer.conservationErrorKmm3 <= Math.max(1e-5, Math.abs(transfer.sourceIntegratedTemperatureRiseKmm3) * 1e-5));
    assert.ok(Math.abs(transfer.sourceVolumeMm3 - transfer.targetVolumeMm3) <= 1e-3);
    assert.throws(() => projectThermalFieldBetweenMeshes(source, target, new Map([...thermal.temperaturesByNode].slice(1)), 20),
      /SIMULATION_THERMAL_TRANSFER_MESH_MISMATCH/);
    assert.throws(() => projectThermalFieldBetweenMeshes(source, { ...target, modelDigest: target.modelDigest + '-changed' }, thermal.temperaturesByNode, 20),
      /SIMULATION_THERMAL_TRANSFER_MESH_MISMATCH/);
    assert.throws(() => projectThermalFieldBetweenMeshes(source, { ...target,
      nodes: target.nodes.map((point, index) => index === 0 ? [200, point[1], point[2]] as NeutralVector3 : point) }, thermal.temperaturesByNode, 20),
    /SIMULATION_THERMAL_TRANSFER_TARGET_OUTSIDE_SOURCE/);
    const structural = createCalculiXFreeThermalExpansionDeck(target, transfer, targetRequest.materials[0], 20);
    assert.deepEqual(structural, createCalculiXFreeThermalExpansionDeck(target, transfer, targetRequest.materials[0], 20));
    const structuralRaw = await runDeck(calculix, directory, 'expansion', structural.deck);
    const result = normalizeFreeThermalExpansionResult(structuralRaw, target, transfer, structural.endNode, structural.reactionSets);
    assert.deepEqual(result, normalizeFreeThermalExpansionResult(structuralRaw, target, transfer, structural.endNode, structural.reactionSets));
    const displacementErrorMm = Math.abs(result.endDisplacementMm[0] - analyticalExpansionMm);
    const reactionMagnitudeN = Math.hypot(...result.resultantReactionForceN);
    assert.ok(displacementErrorMm <= .0005);
    assert.ok(reactionMagnitudeN <= .01);
    assert.ok(result.maximumVonMisesStressMPa <= .1);
    assert.equal(result.transferredTemperatureDigest, transfer.temperatureDigest);
    assert.equal(result.transferredNodeCount, target.nodes.length);
    assert.equal(result.engineeringUsePermitted, false);
    console.log(JSON.stringify({ status: 'PASS', fixture: 'nonmatching-C3D10-thermal-to-free-expansion',
      versions: { gmsh: '4.15.2', calculix: '2.16' },
      meshes: { sourceNodes: source.nodes.length, sourceElements: source.volumeElements.connectivity.length,
        targetNodes: target.nodes.length, targetElements: target.volumeElements.connectivity.length },
      transfer: { method: transfer.method, sourceProfileErrorC, targetProfileErrorC,
        sourceTemperatureRangeC: [Math.min(...thermal.temperaturesByNode.values()), Math.max(...thermal.temperaturesByNode.values())],
        targetTemperatureRangeC: [Math.min(...targetValues), Math.max(...targetValues)],
        sourceVolumeMm3: transfer.sourceVolumeMm3, targetVolumeMm3: transfer.targetVolumeMm3,
        sourceIntegratedTemperatureRiseKmm3: transfer.sourceIntegratedTemperatureRiseKmm3,
        targetIntegratedTemperatureRiseKmm3: transfer.targetIntegratedTemperatureRiseKmm3,
        conservationErrorKmm3: transfer.conservationErrorKmm3,
        temperatureDigest: transfer.temperatureDigest, thermalHeatBalanceErrorW },
      structural: { analyticalEndExpansionMm: analyticalExpansionMm, providerEndDisplacementMm: result.endDisplacementMm[0],
        displacementErrorMm, reactionMagnitudeN, maximumVonMisesStressMPa: result.maximumVonMisesStressMPa },
      deterministicProjection: true, deterministicDeck: true, deterministicNormalization: true }, null, 2));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
} else {
  console.log('SIM-8 nonmatching transfer analytical/contract PASS; set TUNACAD_SIM8_REAL=1 for one focused two-mesh solve.');
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

function createRequest(globalSizeMm: number): NeutralSimulationRequestV2 {
  const revision = 'sim8-nonmatching-transfer-r1';
  const face = (id: string, role: 'load' | 'constraint', x: number) => ({
    semanticReferenceId: id, domainId: 'slab', ownerPartId: 'slab-part', ownerBodyId: 'slab-body', occurrenceId: 'slab-occurrence',
    geometryKind: 'FACE' as const, role, sourceFeatureId: 'slab-box', resolutionState: 'valid' as const, resolvedAtProjectRevision: revision,
    faceOwnerLocal: { centroidPartLocalMm: [x, 5, 5] as NeutralVector3, areaMm2: 100,
      outwardDirection: [x === 0 ? -1 : 1, 0, 0] as NeutralVector3, geometryType: 'plane', edgeCount: 4,
      boundingBoxMm: { min: [x, 0, 0] as NeutralVector3, max: [x, 10, 10] as NeutralVector3 } },
  });
  return sealNeutralSimulationRequestV2({
    schema: 'tunacad-neutral-simulation-request/2.0', studyId: 'sim8-nonmatching-transfer', name: 'SIM-8 nonmatching thermal transfer',
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
    materials: [{ id: 'thermal-material', name: 'Isotropic thermoelastic transfer fixture', model: 'isotropic_linear_elastic',
      youngsModulusMPa: 210_000, poissonRatio: .3, thermalConductivityWPerMK: 50, thermalExpansionPerK: 12e-6,
      source: { kind: 'custom', reference: 'SIM-8 nonmatching-transfer fixture' } }],
    materialAssignments: [{ assignmentId: 'slab-material', domainId: 'slab', materialId: 'thermal-material', volumeRegionId: 'slab-volume' }],
    loads: [{ id: 'inward-flux', name: 'Inward heat flux', type: 'surface_heat_flux', semanticReferenceIds: ['heated-face'], heatFluxWPerM2: 10_000 }],
    constraints: [{ id: 'cold-temperature', name: 'Cold face', type: 'prescribed_temperature',
      semanticReferenceIds: ['cold-face'], temperatureC: 20 }],
    interactions: [], mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2, globalSizeMm,
      minimumSizeMm: globalSizeMm / 4, maximumNodes: 100_000, maximumElements: 50_000, qualityMetric: 'provider_normalized', minimumQuality: .04 },
    requestedResults: ['temperature', 'heat_flux', 'reaction_heat_flow'],
  });
}
