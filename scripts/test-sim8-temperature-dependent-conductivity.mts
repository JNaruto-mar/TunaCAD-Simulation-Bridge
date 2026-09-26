import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCalculiXInputDeckV2 } from '../providers/calculix/CalculiXMultiDomainDeck.mts';
import { CalculiXMultiDomainSolverProvider } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { GmshMultiDomainMeshProvider } from '../providers/gmsh/GmshMultiDomainMeshProvider.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { integratedThermalConductivity, interpolateThermalConductivity } from '../simulation-bridge/thermalConductivity.mts';
import { solveOneDimensionalTemperatureDependentConduction } from '../simulation-bridge/steadyThermalValidation.mts';
import { admitV2SimulationRequest, sealNeutralSimulationRequestV2, validateNeutralSimulationRequestV2, validateNeutralSimulationResultV2 } from '../simulation-bridge/v2Validation.mts';
import type { NeutralSimulationRequestV2, NeutralSimulationResultV2, NeutralVector3 } from '../src/simulation/externalSimulationContracts.ts';

const curve = [
  { temperatureC: 20, conductivityWPerMK: 25 },
  { temperatureC: 40, conductivityWPerMK: 75 },
];
assert.equal(interpolateThermalConductivity(curve, 20), 25);
assert.equal(interpolateThermalConductivity(curve, 30), 50);
assert.equal(interpolateThermalConductivity(curve, 40), 75);
assert.equal(integratedThermalConductivity(curve, 20, 40), 1000);
assert.equal(interpolateThermalConductivity([
  { temperatureC: 20, conductivityWPerMK: 25 },
  { temperatureC: 30, conductivityWPerMK: 55 },
  { temperatureC: 40, conductivityWPerMK: 75 },
], 25), 40);
assert.throws(() => interpolateThermalConductivity(curve, 41), { code: 'SIMULATION_THERMAL_CONDUCTIVITY_OUT_OF_RANGE' });
const reference = solveOneDimensionalTemperatureDependentConduction({
  lengthMm: 100, areaMm2: 100, prescribedTemperatureC: 20, inwardHeatFluxWPerM2: 10_000, conductivityCurve: curve,
});
assert.ok(Math.abs(reference.maximumTemperatureC - 40) < 1e-12);
assert.equal(reference.maximumTemperatureGradientCPerM, 400);
assert.throws(() => solveOneDimensionalTemperatureDependentConduction({
  lengthMm: 100, areaMm2: 100, prescribedTemperatureC: 20,
  inwardHeatFluxWPerM2: 20_000, conductivityCurve: curve,
}), { code: 'SIMULATION_THERMAL_FIXTURE_INVALID' });
const request = createRequest();
for (const invalidCurve of [
  [{ temperatureC: 20, conductivityWPerMK: 25 }],
  [{ temperatureC: 20, conductivityWPerMK: 25 }, { temperatureC: 20, conductivityWPerMK: 75 }],
  [{ temperatureC: 40, conductivityWPerMK: 25 }, { temperatureC: 20, conductivityWPerMK: 75 }],
  [{ temperatureC: 20, conductivityWPerMK: 75 }, { temperatureC: 40, conductivityWPerMK: 25 }],
  [{ temperatureC: 20, conductivityWPerMK: 0 }, { temperatureC: 40, conductivityWPerMK: 75 }],
  [{ temperatureC: 20, conductivityWPerMK: 1 }, { temperatureC: 40, conductivityWPerMK: 25 }],
  [{ temperatureC: 20, conductivityWPerMK: 25 }, { temperatureC: 40, conductivityWPerMK: Number.NaN }],
]) {
  const malformed = structuredClone(request);
  malformed.materials[0].thermalConductivityCurve = invalidCurve;
  assert.throws(() => validateNeutralSimulationRequestV2(malformed));
}
const mixed = structuredClone(request);
mixed.materials[0].thermalConductivityWPerMK = 50;
assert.throws(() => validateNeutralSimulationRequestV2(mixed), 'Constant and tabular conductivity cannot coexist.');
const outOfRangeBase = structuredClone(request);
outOfRangeBase.constraints[0] = { ...outOfRangeBase.constraints[0], temperatureC: 10 } as typeof outOfRangeBase.constraints[0];
assert.throws(() => validateNeutralSimulationRequestV2(outOfRangeBase));
const unsupportedConvection = structuredClone(request);
unsupportedConvection.loads = [{ id: 'convection', name: 'Convection', type: 'surface_convection',
  semanticReferenceIds: ['heated-face'], filmCoefficientWPerM2K: 100, sinkTemperatureC: 0 }];
assert.throws(() => validateNeutralSimulationRequestV2(unsupportedConvection));
const unsupportedStructural = structuredClone(request);
unsupportedStructural.analysis = { type: 'linear_static' } as typeof unsupportedStructural.analysis;
assert.throws(() => validateNeutralSimulationRequestV2(unsupportedStructural));

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (!gmsh || !calculix) {
  console.log(JSON.stringify({ status: 'PASS', scope: 'analytical-and-contract-only', realSolve: 'SKIPPED (set Gmsh and CalculiX executable paths)' }));
} else {
  const directory = await mkdtemp(join(tmpdir(), 'tunacad-sim8-variable-k-'));
  try {
    const stepPath = join(directory, 'slab.step');
    await writeFile(join(directory, 'slab.geo'), [
      'SetFactory("OpenCASCADE");', 'Box(1) = {0, 0, 0, 100, 10, 10};',
      'Save "' + stepPath.replace(/\\/g, '/').replace(/"/g, '\\"') + '";',
    ].join('\n'), 'utf8');
    execFileSync(gmsh, [join(directory, 'slab.geo'), '-0', '-v', '2'],
      { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const step = new Uint8Array(await readFile(stepPath));
    const mesher = new GmshMultiDomainMeshProvider({ executable: gmsh, runtimeVersion: '4.15.2' });
    const model = await mesher.mesh(request, {
      descriptor: request.model,
      async exportDomain(domainId, format) {
        assert.equal(domainId, 'slab');
        assert.equal(format, 'step');
        return step;
      },
    });
    const solver = new CalculiXMultiDomainSolverProvider({ executable: calculix, runtimeVersion: '2.16' });
    assert.deepEqual(admitV2SimulationRequest(request, solver.capabilities), { accepted: true });
    const unadvertised = structuredClone(solver.capabilities);
    delete unadvertised.study.steadyThermal!.temperatureDependentConductivity;
    assert.equal(admitV2SimulationRequest(request, unadvertised).accepted, false);
    const insufficientPoints = structuredClone(solver.capabilities);
    insufficientPoints.study.steadyThermal!.temperatureDependentConductivity!.maximumPoints = 1;
    assert.equal(admitV2SimulationRequest(request, insufficientPoints).accepted, false);
    const deck = createCalculiXInputDeckV2(request, model);
    assert.equal(deck, createCalculiXInputDeckV2(request, model));
    assert.match(deck, /^\*CONDUCTIVITY\n0\.025,20\n0\.075,40$/m);
    assert.match(deck, /^\*HEAT TRANSFER, STEADY STATE\n1,1$/m);
    assert.match(deck, /^\*DFLUX\nTHERMAL_FLUX_001,S,0\.01$/m);
    assert.doesNotMatch(deck, /^\*CONDUCTIVITY\n0\.05$/m);
    const first = await solve(solver, request, model);
    const second = await solve(solver, request, model);
    if (first.analysisType !== 'steady_thermal' || second.analysisType !== 'steady_thermal') throw new Error('Expected thermal results.');
    assert.deepEqual(first.thermal, second.thermal, 'Normalized thermal result must repeat exactly.');
    assert.deepEqual(first.convergence, second.convergence, 'Normalized nonlinear convergence must repeat exactly.');
    assert.equal(first.convergence.status, 'converged');
    assert.ok(first.convergence.iterations !== null && first.convergence.iterations > 1, 'Nonlinear thermal iterations must be recovered.');
    const missingConvergence = structuredClone(first);
    missingConvergence.convergence.iterations = null;
    assert.throws(() => validateNeutralSimulationResultV2(missingConvergence, request));
    const outsideCurve = structuredClone(first);
    outsideCurve.thermal.maximumTemperatureC = 41;
    assert.throws(() => validateNeutralSimulationResultV2(outsideCurve, request));
    const thermal = first.thermal!;
    const maximumProfileErrorC = Math.max(...thermal.temperatureSamples.map(sample => {
      const x = sample.positionAnalysisMm[0];
      const analytical = 20 + (-25 + Math.sqrt(625 + 50 * x)) / 2.5;
      return Math.abs(sample.temperatureC - analytical);
    }));
    assert.ok(Math.abs(thermal.maximumTemperatureC - reference.maximumTemperatureC) <= .1);
    assert.ok(maximumProfileErrorC <= .1);
    assert.equal(thermal.totalAppliedHeatW, 1);
    assert.ok(Math.abs(thermal.totalReactionHeatW + 1) <= 1e-6);
    assert.ok(thermal.heatBalanceResidualW <= 1e-6);
    assert.ok(Math.abs(thermal.maximumTemperatureGradientCPerM - 400) / 400 <= .05);
    assert.equal(first.review.engineeringUsePermitted, false);
    console.log(JSON.stringify({
      status: 'PASS', fixture: '100x10x10-mm-k-of-temperature-slab',
      versions: { gmsh: '4.15.2', calculix: '2.16' },
      mesh: { nodes: model.nodes.length, elements: model.volumeElements.connectivity.length },
      reference: { endTemperatureC: reference.maximumTemperatureC, maximumGradientCPerM: 400, reactedHeatW: -1 },
      provider: { endTemperatureC: thermal.maximumTemperatureC, maximumGradientCPerM: thermal.maximumTemperatureGradientCPerM,
        reactedHeatW: thermal.totalReactionHeatW, heatBalanceResidualW: thermal.heatBalanceResidualW,
        nonlinearIterations: first.convergence.iterations },
      maximumProfileErrorC, deterministicNormalizedThermal: true,
    }, null, 2));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function createRequest(): NeutralSimulationRequestV2 {
  const projectRevision = 'sim8-variable-k-r1';
  const geometryDigest = digest({ fixture: '100x10x10-slab-temperature-dependent-conductivity' });
  const face = (id: string, role: 'load' | 'constraint', x: number) => ({
    semanticReferenceId: id, domainId: 'slab', ownerPartId: 'slab-part', ownerBodyId: 'slab-body', occurrenceId: 'slab-occurrence',
    geometryKind: 'FACE' as const, role, sourceFeatureId: 'slab-box', resolutionState: 'valid' as const, resolvedAtProjectRevision: projectRevision,
    faceOwnerLocal: {
      centroidPartLocalMm: [x, 5, 5] as NeutralVector3, areaMm2: 100,
      outwardDirection: [x === 0 ? -1 : 1, 0, 0] as NeutralVector3, geometryType: 'plane', edgeCount: 4,
      boundingBoxMm: { min: [x, 0, 0] as NeutralVector3, max: [x, 10, 10] as NeutralVector3 },
    },
  });
  return sealNeutralSimulationRequestV2({
    schema: 'tunacad-neutral-simulation-request/2.0', studyId: 'sim8-temperature-dependent-k',
    name: 'SIM-8 temperature-dependent conductivity', preparedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    analysis: { type: 'steady_thermal', assumptions: ['steady_state', 'isotropic_conduction', 'tabulated_temperature_dependent_conductivity'] },
    model: {
      projectRevision, coordinateSpace: 'frozen_analysis',
      domains: [{
        domainId: 'slab', partId: 'slab-part', bodyId: 'slab-body', occurrenceId: 'slab-occurrence', geometryDigest,
        transformToAnalysis: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        shape: {
          valid: true, connectedSolidCount: 1, faceCount: 6, edgeCount: 12, volumeMm3: 10_000, surfaceAreaMm2: 4_200,
          boundingBoxOwnerLocalMm: { min: [0, 0, 0], max: [100, 10, 10], size: [100, 10, 10] },
        },
      }],
      references: [face('cold-face', 'constraint', 0), face('heated-face', 'load', 100)],
    },
    units: {
      geometry: 'mm', force: 'N', stress: 'MPa', displacement: 'mm', density: 'kg/m^3', acceleration: 'mm/s^2',
      temperature: 'degC', heatFlux: 'W/m^2', heatFlow: 'W', thermalConductivity: 'W/(m*K)',
    },
    materials: [{
      id: 'thermal-material', name: 'Increasing tabular conductivity', model: 'isotropic_linear_elastic',
      youngsModulusMPa: 1, poissonRatio: 0, thermalConductivityCurve: curve,
      source: { kind: 'custom', reference: 'SIM-8 analytical variable-k fixture' },
    }],
    materialAssignments: [{ assignmentId: 'slab-material', domainId: 'slab', materialId: 'thermal-material', volumeRegionId: 'slab-volume' }],
    loads: [{ id: 'inward-flux', name: 'Inward flux', type: 'surface_heat_flux', semanticReferenceIds: ['heated-face'], heatFluxWPerM2: 10_000 }],
    constraints: [{ id: 'cold-temperature', name: 'Cold face', type: 'prescribed_temperature', semanticReferenceIds: ['cold-face'], temperatureC: 20 }],
    interactions: [],
    mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2, globalSizeMm: 8, minimumSizeMm: 2,
      maximumNodes: 100_000, maximumElements: 50_000, qualityMetric: 'provider_normalized', minimumQuality: .04 },
    requestedResults: ['temperature', 'heat_flux', 'reaction_heat_flow'],
  });
}

async function solve(solver: CalculiXMultiDomainSolverProvider, request: NeutralSimulationRequestV2,
  model: Awaited<ReturnType<GmshMultiDomainMeshProvider['mesh']>>): Promise<NeutralSimulationResultV2> {
  const submission = await solver.submit(request, model);
  const deadline = Date.now() + solver.capabilities.execution.totalTimeoutMs;
  while (Date.now() < deadline) {
    const status = await solver.getStatus(submission.providerRunId);
    if (status.status === 'failed') throw new Error((status.failure?.code ?? 'SIMULATION_FAILED') + ': ' + (status.failure?.message ?? 'Unknown failure.'));
    if (status.status === 'succeeded') {
      const result = await solver.getResult(submission.providerRunId);
      assert.ok(result);
      validateNeutralSimulationResultV2(result, request);
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  await solver.cancel(submission.providerRunId);
  throw new Error('SIM-8 variable-k fixture timed out.');
}
