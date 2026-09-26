import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCalculiXInputDeckV2, mappedThermalFaceAreaMm2 } from '../providers/calculix/CalculiXMultiDomainDeck.mts';
import { CalculiXMultiDomainSolverProvider } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { GmshMultiDomainMeshProvider } from '../providers/gmsh/GmshMultiDomainMeshProvider.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { solveOneDimensionalSurfaceHeatPower } from '../simulation-bridge/steadyThermalValidation.mts';
import { admitV2SimulationRequest, sealNeutralSimulationRequestV2, validateNeutralSimulationRequestV2, validateNeutralSimulationResultV2 } from '../simulation-bridge/v2Validation.mts';
import type { NeutralSimulationRequestV2, NeutralSimulationResultV2, NeutralVector3 } from '../src/simulation/externalSimulationContracts.ts';

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
const reference = solveOneDimensionalSurfaceHeatPower({
  lengthMm: 100, areaMm2: 100, thermalConductivityWPerMK: 50,
  prescribedTemperatureC: 20, heatPowerW: 1,
});
assert.equal(reference.maximumTemperatureC, 40);
assert.equal(reference.totalReactionHeatW, -1);
for (const heatPowerW of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.throws(() => solveOneDimensionalSurfaceHeatPower({
    lengthMm: 100, areaMm2: 100, thermalConductivityWPerMK: 50,
    prescribedTemperatureC: 20, heatPowerW,
  }), { code: 'SIMULATION_THERMAL_FIXTURE_INVALID' });
}
const request = createRequest();
for (const heatPowerW of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
  const malformed = structuredClone(request);
  (malformed.loads[0] as { heatPowerW: number }).heatPowerW = heatPowerW;
  assert.throws(() => validateNeutralSimulationRequestV2(malformed));
}
const wrongField = structuredClone(request);
(wrongField.loads[0] as { heatFluxWPerM2?: number }).heatFluxWPerM2 = 10_000;
assert.throws(() => validateNeutralSimulationRequestV2(wrongField), 'A total-power load cannot also prescribe flux.');
const wrongAnalysis = structuredClone(request);
wrongAnalysis.analysis = { type: 'linear_static' } as typeof wrongAnalysis.analysis;
assert.throws(() => validateNeutralSimulationRequestV2(wrongAnalysis), 'Heat power must be rejected in structural analysis.');

if (!gmsh || !calculix) {
  console.log(JSON.stringify({ status: 'PASS', scope: 'contract-and-analytical-only', realSolve: 'SKIPPED (set Gmsh and CalculiX executable paths)' }));
} else {
  const directory = await mkdtemp(join(tmpdir(), 'tunacad-sim8-heat-power-'));
  try {
    const stepPath = join(directory, 'slab.step');
    const geoPath = join(directory, 'slab.geo');
    await writeFile(geoPath, [
      'SetFactory("OpenCASCADE");',
      'Box(1) = {0, 0, 0, 100, 10, 10};',
      'Save "' + stepPath.replace(/\\/g, '/').replace(/"/g, '\\"') + '";',
    ].join('\n'), 'utf8');
    execFileSync(gmsh, [geoPath, '-0', '-v', '2'], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
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
    const heated = model.boundaryRegions.filter(region => region.semanticReferenceIds.includes('heated-face'));
    const cold = model.boundaryRegions.filter(region => region.semanticReferenceIds.includes('cold-face'));
    assert.equal(heated.length, 1);
    assert.equal(cold.length, 1);
    const heatedFacets = heated[0].facetIndices;
    assert.ok(heatedFacets.length > 0);
    assert.ok(heatedFacets.every(facet => !cold[0].facetIndices.includes(facet)));
    const mappedAreaMm2 = mappedThermalFaceAreaMm2(model, heatedFacets);
    assert.ok(Math.abs(mappedAreaMm2 - 100) < 1e-5);

    const solver = new CalculiXMultiDomainSolverProvider({ executable: calculix, runtimeVersion: '2.16' });
    assert.deepEqual(admitV2SimulationRequest(request, solver.capabilities), { accepted: true });
    const unsupported = structuredClone(solver.capabilities);
    unsupported.study.steadyThermal!.maximumHeatPowerLoads = 0;
    assert.equal(admitV2SimulationRequest(request, unsupported).accepted, false);
    const unadvertised = structuredClone(solver.capabilities);
    unadvertised.study.steadyThermal!.loadTypes = ['surface_heat_flux'];
    assert.equal(admitV2SimulationRequest(request, unadvertised).accepted, false);
    const deck = createCalculiXInputDeckV2(request, model);
    assert.equal(deck, createCalculiXInputDeckV2(request, model));
    assert.match(deck, /^\*HEAT TRANSFER, STEADY STATE\n1,1$/m);
    const deckFlux = Number(deck.match(/^\*DFLUX\nTHERMAL_FLUX_001,S,([^\r\n]+)/m)?.[1]);
    assert.ok(Number.isFinite(deckFlux));
    assert.ok(Math.abs(deckFlux * mappedAreaMm2 - 1) < 1e-9, 'Mapped total power must be exactly one watt.');
    const surfaceSection = deck.match(/^\*SURFACE, NAME=THERMAL_FLUX_001, TYPE=ELEMENT\n([\s\S]*?)(?=^\*)/m)?.[1];
    assert.ok(surfaceSection);
    const deckFaces = surfaceSection.trim().split(/\r?\n/);
    assert.equal(deckFaces.length, heatedFacets.length, 'Only the selected FACE facets receive DFLUX.');
    assert.equal(new Set(deckFaces).size, deckFaces.length);
    assert.doesNotMatch(deck, /^\*FILM$/m);

    const first = await solve(solver, request, model);
    const second = await solve(solver, request, model);
    if (first.analysisType !== 'steady_thermal' || second.analysisType !== 'steady_thermal') throw new Error('Expected thermal results.');
    assert.deepEqual(first.thermal, second.thermal, 'Normalized thermal values must repeat exactly.');
    const thermal = first.thermal!;
    assert.ok(Math.abs(thermal.minimumTemperatureC - 20) <= .01);
    assert.ok(Math.abs(thermal.maximumTemperatureC - reference.maximumTemperatureC) <= .05);
    assert.equal(thermal.totalAppliedHeatW, 1);
    assert.ok(Math.abs(thermal.totalReactionHeatW + 1) <= 1e-6);
    assert.ok(thermal.heatBalanceResidualW <= 1e-6);
    const maximumProfileErrorC = Math.max(...thermal.temperatureSamples.map(sample =>
      Math.abs(sample.temperatureC - (20 + .2 * sample.positionAnalysisMm[0]))));
    assert.ok(maximumProfileErrorC <= .05);
    assert.equal(first.review.engineeringUsePermitted, false);
    console.log(JSON.stringify({
      status: 'PASS', fixture: '100x10x10-mm-total-surface-power-slab',
      versions: { gmsh: '4.15.2', calculix: '2.16' },
      mesh: { nodes: model.nodes.length, elements: model.volumeElements.connectivity.length, heatedFacets: heatedFacets.length, mappedAreaMm2 },
      formulation: { heatPowerW: 1, deckFluxWPerMm2: deckFlux, integratedDeckPowerW: deckFlux * mappedAreaMm2 },
      analytical: { maximumTemperatureC: reference.maximumTemperatureC, reactionHeatW: reference.totalReactionHeatW },
      provider: { maximumTemperatureC: thermal.maximumTemperatureC, appliedHeatW: thermal.totalAppliedHeatW,
        reactionHeatW: thermal.totalReactionHeatW, heatBalanceResidualW: thermal.heatBalanceResidualW },
      maximumProfileErrorC, deterministicThermalResult: true,
    }, null, 2));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function createRequest(): NeutralSimulationRequestV2 {
  const projectRevision = 'sim8-heat-power-r1';
  const geometryDigest = digest({ fixture: '100x10x10-slab-total-power' });
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
    schema: 'tunacad-neutral-simulation-request/2.0', studyId: 'sim8-total-heat-power',
    name: 'SIM-8 total surface heat power', preparedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    analysis: { type: 'steady_thermal', assumptions: ['steady_state', 'isotropic_conduction', 'temperature_independent_properties'] },
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
      id: 'thermal-material', name: 'Constant conductivity fixture', model: 'isotropic_linear_elastic',
      youngsModulusMPa: 1, poissonRatio: 0, thermalConductivityWPerMK: 50,
      source: { kind: 'custom', reference: 'SIM-8 analytical total-power fixture' },
    }],
    materialAssignments: [{ assignmentId: 'slab-material', domainId: 'slab', materialId: 'thermal-material', volumeRegionId: 'slab-volume' }],
    loads: [{ id: 'total-power', name: 'One watt inward', type: 'surface_heat_power', semanticReferenceIds: ['heated-face'], heatPowerW: 1 }],
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
  throw new Error('SIM-8 heat-power fixture timed out.');
}
