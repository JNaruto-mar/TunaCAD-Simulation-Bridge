import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createCalculiXInputDeckV2 } from '../providers/calculix/CalculiXMultiDomainDeck.mts';
import { createCalculiXFreeThermalExpansionDeck, normalizeFreeThermalExpansionResult, transferThermalFieldSameMesh } from '../providers/calculix/CalculiXFreeThermalExpansion.mts';
import { parseCalculiXSteadyThermalDatV2 } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { GmshMultiDomainMeshProvider } from '../providers/gmsh/GmshMultiDomainMeshProvider.mts';
import { LOCAL_PROVIDER_RESOURCE_LIMITS, monitorWorkingDirectory, readUtf8FileBounded, spawnProviderProcess, terminateChildProcess } from '../providers/processLifecycle.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { solveFreeExpansionOfLinearSlab } from '../simulation-bridge/steadyThermalValidation.mts';
import { sealNeutralSimulationRequestV2, validateNeutralSimulationRequestV2 } from '../simulation-bridge/v2Validation.mts';
import type { NeutralFemModelV2, NeutralSimulationRequestV2, NeutralVector3 } from '../src/simulation/externalSimulationContracts.ts';

const referenceExpansionMm = solveFreeExpansionOfLinearSlab({
  lengthMm: 100, thermalExpansionPerK: 12e-6, initialTemperatureC: 20,
  baseTemperatureC: 20, endTemperatureC: 40,
});
assert.ok(Math.abs(referenceExpansionMm - .012) < 1e-12);
assert.throws(() => solveFreeExpansionOfLinearSlab({
  lengthMm: 100, thermalExpansionPerK: 0, initialTemperatureC: 20,
  baseTemperatureC: 20, endTemperatureC: 40,
}), { code: 'SIMULATION_THERMAL_FIXTURE_INVALID' });
const request = createRequest();
assert.deepEqual(validateNeutralSimulationRequestV2(request), request);
const invalidCoefficient = sealNeutralSimulationRequestV2({ ...request, materials: [{ ...request.materials[0], thermalExpansionPerK: -1 }] });
assert.throws(() => validateNeutralSimulationRequestV2(invalidCoefficient), /BRIDGE_V2_REQUEST_INVALID/);

if (process.env.TUNACAD_SIM8_REAL === '1') {
  const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
  const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
  if (!gmsh || !calculix) throw new Error('Set Gmsh and CalculiX executable paths for the focused free-expansion fixture.');
  const directory = await mkdtemp(join(tmpdir(), 'tunacad-sim8-free-expansion-'));
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
    const thermalDeck = createCalculiXInputDeckV2(request, model);
    const thermalRaw = await runDeck(calculix, directory, 'thermal', thermalDeck);
    const parsedThermal = parseCalculiXSteadyThermalDatV2(thermalRaw, model, ['THERMAL_REACTION_001']);
    const thermalProfileErrorC = Math.max(...[...parsedThermal.temperaturesByNode].map(([node, temperature]) =>
      Math.abs(temperature - (20 + .2 * model.nodes[node][0]))));
    const thermalReactionW = parsedThermal.reactionHeatBySetW.THERMAL_REACTION_001;
    assert.ok(thermalProfileErrorC <= .01);
    assert.ok(Math.abs(1 + thermalReactionW) <= 1e-5);
    const transfer = transferThermalFieldSameMesh(model, model, parsedThermal.temperaturesByNode);
    assert.equal(transfer.nodeCount, model.nodes.length);
    assert.equal(transfer.temperatureSumC, [...parsedThermal.temperaturesByNode.values()].reduce((sum, value) => sum + value, 0));
    assert.throws(() => transferThermalFieldSameMesh(model, { ...model, modelId: model.modelId + '-different' }, parsedThermal.temperaturesByNode),
      /SIMULATION_THERMAL_TRANSFER_MESH_MISMATCH/);
    assert.throws(() => transferThermalFieldSameMesh(model, { ...model,
      volumeElements: { ...model.volumeElements, materialIds: model.volumeElements.materialIds.map(() => 'different-material') } }, parsedThermal.temperaturesByNode),
    /SIMULATION_THERMAL_TRANSFER_MESH_MISMATCH/);
    assert.throws(() => transferThermalFieldSameMesh(model, model, new Map([...parsedThermal.temperaturesByNode].slice(1))),
      /SIMULATION_THERMAL_TRANSFER_MESH_MISMATCH/);
    const structural = createCalculiXFreeThermalExpansionDeck(model, transfer, request.materials[0], 20);
    assert.deepEqual(structural, createCalculiXFreeThermalExpansionDeck(model, transfer, request.materials[0], 20),
      'The same transferred field must yield a deterministic structural deck.');
    assert.match(structural.deck, /^\*EXPANSION, ZERO=20\n0\.000012$/m);
    assert.equal((structural.deck.match(/^\*TEMPERATURE$/gm) ?? []).length, 1);
    assert.equal((structural.deck.match(/^\d+,[+-]?(?:\d|\.)+$/gm) ?? []).length >= model.nodes.length, true);
    const structuralRaw = await runDeck(calculix, directory, 'expansion', structural.deck);
    const normalized = normalizeFreeThermalExpansionResult(structuralRaw, model, transfer, structural.endNode, structural.reactionSets);
    assert.deepEqual(normalized, normalizeFreeThermalExpansionResult(structuralRaw, model, transfer, structural.endNode, structural.reactionSets),
      'Result normalization must be deterministic.');
    const providerDisplacementMm = normalized.endDisplacementMm[0];
    const displacementErrorMm = Math.abs(providerDisplacementMm - referenceExpansionMm);
    const reactionMagnitudeN = Math.hypot(...normalized.resultantReactionForceN);
    assert.ok(displacementErrorMm <= .0005, 'Free expansion must match the axial analytical integral.');
    assert.ok(reactionMagnitudeN <= .01, 'Three-two-one rigid stabilization must produce near-zero resultant reaction.');
    assert.ok(normalized.maximumVonMisesStressMPa <= .1, 'Free expansion must not create material stress.');
    assert.equal(normalized.transferredTemperatureDigest, transfer.temperatureDigest);
    assert.equal(normalized.transferredNodeCount, model.nodes.length);
    assert.equal(normalized.engineeringUsePermitted, false);
    console.log(JSON.stringify({ status: 'PASS', fixture: 'same-mesh-free-thermal-expansion',
      versions: { gmsh: '4.15.2', calculix: '2.16' },
      mesh: { nodes: model.nodes.length, elements: model.volumeElements.connectivity.length },
      analytical: { coefficientPerK: 12e-6, initialTemperatureC: 20, finalBaseTemperatureC: 20,
        finalEndTemperatureC: 40, endExpansionMm: referenceExpansionMm },
      provider: { endDisplacementMm: providerDisplacementMm, resultantReactionForceN: normalized.resultantReactionForceN,
        reactionMagnitudeN, maximumVonMisesStressMPa: normalized.maximumVonMisesStressMPa },
      transfer: { mode: 'same-mesh-exact-node-identity', sourceModelId: transfer.sourceModelId,
        targetModelId: transfer.targetModelId, nodeCount: transfer.nodeCount, temperatureDigest: transfer.temperatureDigest,
        temperatureSumC: transfer.temperatureSumC, thermalProfileErrorC, thermalHeatBalanceErrorW: Math.abs(1 + thermalReactionW) },
      comparison: { displacementErrorMm, deterministicDeck: true, deterministicNormalization: true } }, null, 2));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
} else {
  console.log('SIM-8 free-expansion analytical/contract PASS; set TUNACAD_SIM8_REAL=1 for the focused two-stage provider solve.');
}

async function runDeck(executable: string, directory: string, name: string, deck: string): Promise<string> {
  if (Buffer.byteLength(deck, 'utf8') > LOCAL_PROVIDER_RESOURCE_LIMITS.maximumResultFileBytes) throw new Error('SIMULATION_INPUT_LIMIT');
  await writeFile(join(directory, name + '.inp'), deck, 'utf8');
  const child = spawnProviderProcess(executable, ['-i', name], {
    cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: dirname(executable) + (process.platform === 'win32' ? ';' : ':') + (process.env.PATH ?? '') },
  });
  let diagnostic = '';
  let exceeded = false;
  const collect = (chunk: unknown) => { diagnostic = (diagnostic + String(chunk)).slice(-LOCAL_PROVIDER_RESOURCE_LIMITS.maximumDiagnosticCharacters); };
  child.stdout?.on('data', collect); child.stderr?.on('data', collect);
  const stopMonitor = monitorWorkingDirectory({ child, directory, onExceeded: async () => { exceeded = true; await terminateChildProcess(child); } });
  const timeout = setTimeout(() => { exceeded = true; void terminateChildProcess(child); }, 30_000); timeout.unref();
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    if (exceeded || code !== 0) throw new Error('SIM-8 ' + name + ' solve failed: ' + diagnostic.slice(-1500));
    return readUtf8FileBounded(join(directory, name + '.dat'));
  } finally {
    clearTimeout(timeout); stopMonitor();
    await terminateChildProcess(child);
  }
}

function createRequest(): NeutralSimulationRequestV2 {
  const projectRevision = 'sim8-free-expansion-r1';
  const face = (semanticReferenceId: string, role: 'load' | 'constraint', x: number) => ({
    semanticReferenceId, domainId: 'slab', ownerPartId: 'slab-part', ownerBodyId: 'slab-body', occurrenceId: 'slab-occurrence',
    geometryKind: 'FACE' as const, role, sourceFeatureId: 'slab-box', resolutionState: 'valid' as const, resolvedAtProjectRevision: projectRevision,
    faceOwnerLocal: { centroidPartLocalMm: [x, 5, 5] as NeutralVector3, areaMm2: 100,
      outwardDirection: [x === 0 ? -1 : 1, 0, 0] as NeutralVector3, geometryType: 'plane', edgeCount: 4,
      boundingBoxMm: { min: [x, 0, 0] as NeutralVector3, max: [x, 10, 10] as NeutralVector3 } },
  });
  return sealNeutralSimulationRequestV2({
    schema: 'tunacad-neutral-simulation-request/2.0', studyId: 'sim8-free-thermal-expansion', name: 'SIM-8 free expansion',
    preparedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    analysis: { type: 'steady_thermal', assumptions: ['steady_state', 'isotropic_conduction', 'temperature_independent_properties'] },
    model: { projectRevision, coordinateSpace: 'frozen_analysis',
      domains: [{ domainId: 'slab', partId: 'slab-part', bodyId: 'slab-body', occurrenceId: 'slab-occurrence',
        geometryDigest: digest({ fixture: '100x10x10-slab-step' }), transformToAnalysis: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        shape: { valid: true, connectedSolidCount: 1, faceCount: 6, edgeCount: 12, volumeMm3: 10_000,
          surfaceAreaMm2: 4_200, boundingBoxOwnerLocalMm: { min: [0, 0, 0], max: [100, 10, 10], size: [100, 10, 10] } } }],
      references: [face('cold-face', 'constraint', 0), face('heated-face', 'load', 100)] },
    units: { geometry: 'mm', force: 'N', stress: 'MPa', displacement: 'mm', density: 'kg/m^3', acceleration: 'mm/s^2',
      temperature: 'degC', heatFlux: 'W/m^2', heatFlow: 'W', thermalConductivity: 'W/(m*K)' },
    materials: [{ id: 'thermal-material', name: 'Isotropic thermoelastic fixture', model: 'isotropic_linear_elastic',
      youngsModulusMPa: 210_000, poissonRatio: .3, thermalConductivityWPerMK: 50, thermalExpansionPerK: 12e-6,
      source: { kind: 'custom', reference: 'SIM-8 free-expansion fixture' } }],
    materialAssignments: [{ assignmentId: 'slab-material', domainId: 'slab', materialId: 'thermal-material', volumeRegionId: 'slab-volume' }],
    loads: [{ id: 'inward-flux', name: 'Inward heat flux', type: 'surface_heat_flux', semanticReferenceIds: ['heated-face'], heatFluxWPerM2: 10_000 }],
    constraints: [{ id: 'cold-temperature', name: 'Cold face', type: 'prescribed_temperature', semanticReferenceIds: ['cold-face'], temperatureC: 20 }],
    interactions: [], mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2, globalSizeMm: 10,
      minimumSizeMm: 2.5, maximumNodes: 100_000, maximumElements: 50_000, qualityMetric: 'provider_normalized', minimumQuality: .04 },
    requestedResults: ['temperature', 'heat_flux', 'reaction_heat_flow'],
  });
}
