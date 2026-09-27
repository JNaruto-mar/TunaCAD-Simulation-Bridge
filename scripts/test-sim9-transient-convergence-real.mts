import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCalculiXInputDeckV2 } from '../providers/calculix/CalculiXMultiDomainDeck.mts';
import { CalculiXMultiDomainSolverProvider } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { GmshMultiDomainMeshProvider } from '../providers/gmsh/GmshMultiDomainMeshProvider.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { admitV2SimulationRequest, sealNeutralSimulationRequestV2, validateNeutralSimulationResultV2 } from '../simulation-bridge/v2Validation.mts';
import type { NeutralFemModelV2, NeutralSimulationRequestV2, NeutralSimulationResultV2, NeutralVector3 } from '../src/simulation/externalSimulationContracts.ts';

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (!gmsh || !calculix) throw new Error('Explicit Gmsh 4.15.2 and CalculiX 2.16 paths are required for this focused SIM-9 convergence fixture.');

const reference = [
  { timeS: 100, tipC: 28.08012969857412, reactionW: -0.09657220908934742, energyJ: 97.51574463183621 },
  { timeS: 400, tipC: 35.42601595212687, reactionW: -0.6407665447371693, energyJ: 276.4370169831787 },
  { timeS: 1200, tipC: 39.63588577265686, reactionW: -0.9714025354577828, energyJ: 380.95970965525646 },
] as const;
type Values = { tipC: number; reactionW: number; energyJ: number };
type Case = { meshSizeMm: number; maximumIncrementS: number; nodes: number; elements: number;
  frames: Array<{ timeS: number } & Values> };

const directory = await mkdtemp(join(tmpdir(), 'tunacad-sim9-convergence-'));
try {
  const geoPath = join(directory, 'slab.geo');
  const stepPath = join(directory, 'slab.step');
  await writeFile(geoPath, ['SetFactory("OpenCASCADE");', 'Box(1) = {0, 0, 0, 100, 10, 10};',
    'Save "' + stepPath.replace(/\\/g, '/').replace(/"/g, '\\"') + '";'].join('\n'), 'utf8');
  execFileSync(gmsh, [geoPath, '-0', '-v', '2'], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const step = new Uint8Array(await readFile(stepPath));
  const mesher = new GmshMultiDomainMeshProvider({ executable: gmsh, runtimeVersion: '4.15.2' });
  const solver = new CalculiXMultiDomainSolverProvider({ executable: calculix, runtimeVersion: '2.16' });
  const cases: Case[] = [];
  const configurations = [
    { meshSizeMm: 10, maximumIncrementS: 20 },
    { meshSizeMm: 10, maximumIncrementS: 10 },
    { meshSizeMm: 10, maximumIncrementS: 5 },
    { meshSizeMm: 8, maximumIncrementS: 5 },
    { meshSizeMm: 6, maximumIncrementS: 5 },
  ] as const;
  let finalRequest: NeutralSimulationRequestV2 | null = null;
  let finalModel: NeutralFemModelV2 | null = null;
  let finalResult: NeutralSimulationResultV2 | null = null;
  for (const config of configurations) {
    const request = createRequest(config.meshSizeMm, config.maximumIncrementS);
    const model = await mesher.mesh(request, { descriptor: request.model,
      async exportDomain(domainId, format) {
        assert.equal(domainId, 'slab');
        assert.equal(format, 'step');
        return step;
      } });
    assert.deepEqual(admitV2SimulationRequest(request, solver.capabilities), { accepted: true });
    const deck = createCalculiXInputDeckV2(request, model);
    assert.equal(deck, createCalculiXInputDeckV2(request, model));
    assert.match(deck, new RegExp('^' + config.maximumIncrementS + ',1200,', 'm'));
    const result = await solve(solver, request, model);
    assert.equal(result.analysisType, 'transient_thermal');
    if (!('transientThermal' in result)) throw new Error('Provider returned no SIM-9 frame history.');
    const frames = result.transientThermal.frames.map(frame => ({
      timeS: frame.timeS, tipC: frame.maximumTemperatureC,
      reactionW: frame.totalReactionHeatW, energyJ: frame.storedThermalEnergyJ,
    }));
    assert.deepEqual(frames.map(frame => frame.timeS), reference.map(frame => frame.timeS));
    const current = { ...config, nodes: model.nodes.length, elements: model.volumeElements.connectivity.length, frames };
    cases.push(current);
    if (config.meshSizeMm === 6) { finalRequest = request; finalModel = model; finalResult = result; }
    console.log('SIM9_CONVERGENCE_CASE_DONE=' + JSON.stringify({ meshSizeMm: config.meshSizeMm,
      maximumIncrementS: config.maximumIncrementS, nodes: current.nodes, elements: current.elements }));
  }
  assert(finalRequest && finalModel && finalResult);
  const repeated = await solve(solver, finalRequest, finalModel);
  assert.equal(repeated.analysisType, 'transient_thermal');
  assert.deepEqual(repeated.transientThermal, finalResult.transientThermal,
    'The selected fine mesh/time-step normalized history must repeat exactly.');

  const timeCases = cases.slice(0, 3);
  const meshCases = [cases[2], cases[3], cases[4]];
  assert(timeCases.every(item => item.nodes === timeCases[0].nodes && item.elements === timeCases[0].elements));
  assert(meshCases[0].elements < meshCases[1].elements && meshCases[1].elements < meshCases[2].elements);
  const quantities = ['tipC', 'reactionW', 'energyJ'] as const;
  const errorNorm = (item: Case, key: keyof Values): number =>
    Math.hypot(...item.frames.map((frame, index) => frame[key] - reference[index][key]));
  const changeNorm = (a: Case, b: Case, key: keyof Values): number =>
    Math.hypot(...a.frames.map((frame, index) => frame[key] - b.frames[index][key]));
  const trend = Object.fromEntries(quantities.map(key => [key, {
    timeErrorNorms: timeCases.map(item => errorNorm(item, key)),
    timeSuccessiveChanges: [changeNorm(timeCases[0], timeCases[1], key), changeNorm(timeCases[1], timeCases[2], key)],
    meshErrorNorms: meshCases.map(item => errorNorm(item, key)),
    meshSuccessiveChanges: [changeNorm(meshCases[0], meshCases[1], key), changeNorm(meshCases[1], meshCases[2], key)],
  }])) as Record<(typeof quantities)[number], {
    timeErrorNorms: number[]; timeSuccessiveChanges: number[];
    meshErrorNorms: number[]; meshSuccessiveChanges: number[];
  }>;
  console.log('SIM9_CONVERGENCE_DATA=' + JSON.stringify({ cases, trend, reference }));

  for (const key of quantities) {
    const metric = trend[key];
    assert(metric.timeErrorNorms[2] < metric.timeErrorNorms[0], key + ' time refinement must reduce analytical error.');
    assert(metric.timeSuccessiveChanges[1] < metric.timeSuccessiveChanges[0],
      key + ' time refinement changes must contract.');
    // This one-dimensional slab is already spatially resolved at the coarsest
    // level. Require a stable mesh plateau, not a fictitious monotonic decrease
    // in analytical error while temporal discretization still dominates.
    assert(metric.meshSuccessiveChanges[1] <= metric.timeSuccessiveChanges[1] * .01,
      key + ' fine-mesh change must be negligible relative to time-step change.');
    assert(Math.abs(metric.meshErrorNorms[2] - metric.meshErrorNorms[0]) <= metric.timeErrorNorms[2] * .01,
      key + ' analytical error must remain stable across mesh refinement.');
  }
  const baseline = cases[4];
  for (const [index, frame] of baseline.frames.entries()) {
    assert(Math.abs(frame.tipC - reference[index].tipC) <= .25);
    assert(Math.abs(frame.reactionW - reference[index].reactionW) <= .04);
    assert(Math.abs(frame.energyJ - reference[index].energyJ) <= 4);
  }
  assert(trend.tipC.meshSuccessiveChanges[1] < .3);
  assert(trend.reactionW.meshSuccessiveChanges[1] < .05);
  assert(trend.energyJ.meshSuccessiveChanges[1] < 6);
  console.log('SIM9_CONVERGENCE_PASS=' + JSON.stringify({
    timeStepsS: timeCases.map(item => item.maximumIncrementS),
    meshSizesMm: meshCases.map(item => item.meshSizeMm),
    selectedBaseline: { meshSizeMm: baseline.meshSizeMm, maximumIncrementS: baseline.maximumIncrementS,
      nodes: baseline.nodes, elements: baseline.elements },
    exactRepeat: true, engineeringUsePermitted: false,
  }));
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
  throw new Error('SIM-9 transient convergence fixture timed out.');
}

function createRequest(meshSizeMm: number, maximumIncrementS: number): NeutralSimulationRequestV2 {
  const projectRevision = 'sim9-convergence-r1';
  const face = (semanticReferenceId: string, role: 'load' | 'constraint', x: number) => ({
    semanticReferenceId, domainId: 'slab', ownerPartId: 'slab-part', ownerBodyId: 'slab-body', occurrenceId: 'slab-occurrence',
    geometryKind: 'FACE' as const, role, sourceFeatureId: 'slab-box', resolutionState: 'valid' as const, resolvedAtProjectRevision: projectRevision,
    faceOwnerLocal: { centroidPartLocalMm: [x, 5, 5] as NeutralVector3, areaMm2: 100,
      outwardDirection: [x === 0 ? -1 : 1, 0, 0] as NeutralVector3, geometryType: 'plane',
      edgeCount: 4, boundingBoxMm: { min: [x, 0, 0] as NeutralVector3, max: [x, 10, 10] as NeutralVector3 } },
  });
  return sealNeutralSimulationRequestV2({
    schema: 'tunacad-neutral-simulation-request/2.0', studyId: 'sim9-transient-convergence', name: 'SIM-9 transient convergence slab',
    preparedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    analysis: { type: 'transient_thermal',
      assumptions: ['transient', 'isotropic_conduction', 'temperature_independent_properties', 'uniform_initial_temperature', 'step_boundary_conditions'],
      settings: { initialTemperatureC: 20, durationS: 1200, outputTimesS: [100, 400, 1200], maximumIncrementS } },
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
    interactions: [], mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2, globalSizeMm: meshSizeMm, minimumSizeMm: meshSizeMm / 4,
      maximumNodes: 100_000, maximumElements: 50_000, qualityMetric: 'provider_normalized', minimumQuality: 0.04 },
    requestedResults: ['temperature_history', 'heat_flow_history'],
  });
}
