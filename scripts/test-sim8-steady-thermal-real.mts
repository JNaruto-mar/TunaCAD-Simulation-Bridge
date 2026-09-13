import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCalculiXInputDeckV2 } from '../providers/calculix/CalculiXMultiDomainDeck.mts';
import { CalculiXMultiDomainSolverProvider } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { GmshMultiDomainMeshProvider } from '../providers/gmsh/GmshMultiDomainMeshProvider.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { solveOneDimensionalSteadyConduction } from '../simulation-bridge/steadyThermalValidation.mts';
import { admitV2SimulationRequest, sealNeutralSimulationRequestV2, validateNeutralSimulationResultV2 } from '../simulation-bridge/v2Validation.mts';
import type { NeutralSimulationRequestV2, NeutralSimulationResultV2, NeutralVector3 } from '../src/simulation/externalSimulationContracts.ts';

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (!gmsh || !calculix) throw new Error('Set TUNACAD_GMSH_EXECUTABLE and TUNACAD_CALCULIX_EXECUTABLE to run SIM-8 real acceptance.');

const directory = await mkdtemp(join(tmpdir(), 'tunacad-sim8-real-'));
try {
  const stepPath = join(directory, 'slab.step');
  const geoPath = join(directory, 'slab.geo');
  const output = stepPath.replace(/\\/g, '/').replace(/"/g, '\\"');
  await writeFile(geoPath, [
    'SetFactory("OpenCASCADE");',
    'Box(1) = {0, 0, 0, 100, 10, 10};',
    'Save "' + output + '";',
  ].join('\n'), 'utf8');
  execFileSync(gmsh, [geoPath, '-0', '-v', '2'], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const step = new Uint8Array(await readFile(stepPath));
  const request = createRequest();
  const mesher = new GmshMultiDomainMeshProvider({ executable: gmsh, runtimeVersion: '4.15.2' });
  const model = await mesher.mesh(request, {
    descriptor: request.model,
    async exportDomain(domainId, format) {
      assert.equal(domainId, 'slab');
      assert.equal(format, 'step');
      return step;
    },
  });
  assert.equal(model.domainRegions.length, 1);
  assert.ok(model.nodes.length > 10 && model.volumeElements.connectivity.length > 1);

  const solver = new CalculiXMultiDomainSolverProvider({ executable: calculix, runtimeVersion: '2.16' });
  assert.deepEqual(admitV2SimulationRequest(request, solver.capabilities), { accepted: true });
  const deck = createCalculiXInputDeckV2(request, model);
  assert.equal(deck, createCalculiXInputDeckV2(request, model), 'SIM-8 deck generation must be byte deterministic.');
  assert.match(deck, /^\*ELEMENT, TYPE=DC3D10, ELSET=DOMAIN_001$/m);
  assert.match(deck, /^\*CONDUCTIVITY\n0\.05$/m);
  assert.match(deck, /^\*HEAT TRANSFER, STEADY STATE\n1,1$/m);
  assert.match(deck, /^\*BOUNDARY\nTHERMAL_TEMPERATURE_001,11,11,20$/m);
  assert.match(deck, /^\*DFLUX\nTHERMAL_FLUX_001,S,0\.01$/m);
  assert.match(deck, /^\*NODE PRINT, NSET=NALL\nNT$/m);
  assert.match(deck, /^\*NODE PRINT, NSET=THERMAL_REACTION_001\nRFL$/m);
  assert.match(deck, /^\*EL PRINT, ELSET=EALL\nHFL$/m);
  assert.doesNotMatch(deck, /^\*STATIC$/m);
  assert.doesNotMatch(deck, /^\*ELASTIC$/m);

  const submission = await solver.submit(request, model);
  const result = await waitForResult(solver, submission.providerRunId);
  validateNeutralSimulationResultV2(result, request);
  const thermal = result.thermal!;
  const reference = solveOneDimensionalSteadyConduction({
    lengthMm: 100, areaMm2: 100, thermalConductivityWPerMK: 50,
    prescribedTemperatureC: 20, inwardHeatFluxWPerM2: 10_000, sampleCount: 5,
  });
  assert.ok(Math.abs(thermal.minimumTemperatureC - reference.minimumTemperatureC) <= 0.01);
  assert.ok(Math.abs(thermal.maximumTemperatureC - reference.maximumTemperatureC) <= 0.05);
  assert.ok(Math.abs(thermal.maximumTemperatureGradientCPerM - reference.maximumTemperatureGradientCPerM) / reference.maximumTemperatureGradientCPerM <= 0.01);
  assert.equal(thermal.totalAppliedHeatW, reference.totalAppliedHeatW);
  assert.ok(Math.abs(thermal.totalReactionHeatW - reference.totalReactionHeatW) <= 1e-6);
  assert.ok(thermal.heatBalanceResidualW <= 1e-6);
  assert.ok(thermal.temperatureSamples.length >= 2 && thermal.temperatureSamples.length <= 256);
  const maximumProfileErrorC = Math.max(...thermal.temperatureSamples.map(sample =>
    Math.abs(sample.temperatureC - (20 + 0.2 * sample.positionAnalysisMm[0]))));
  assert.ok(maximumProfileErrorC <= 0.05, 'The recovered NT samples must follow the analytical linear profile.');
  assert.equal(result.perDomain[0].fieldDatasetIds.length, 0);
  assert.ok(result.warnings.some(warning => warning.code === 'SIMULATION_STEADY_THERMAL_POC'));
  assert.equal(result.review.engineeringUsePermitted, false);

  console.log(JSON.stringify({
    status: 'PASS',
    fixture: '100x10x10-mm-one-dimensional-conduction',
    versions: { gmsh: '4.15.2', calculix: '2.16' },
    mesh: { nodes: model.nodes.length, elements: model.volumeElements.connectivity.length },
    calculated: {
      minimumTemperatureC: thermal.minimumTemperatureC,
      maximumTemperatureC: thermal.maximumTemperatureC,
      maximumTemperatureGradientCPerM: thermal.maximumTemperatureGradientCPerM,
      totalAppliedHeatW: thermal.totalAppliedHeatW,
      totalReactionHeatW: thermal.totalReactionHeatW,
      heatBalanceResidualW: thermal.heatBalanceResidualW,
      boundedTemperatureSampleCount: thermal.temperatureSamples.length,
    },
    analytical: {
      minimumTemperatureC: reference.minimumTemperatureC,
      maximumTemperatureC: reference.maximumTemperatureC,
      maximumTemperatureGradientCPerM: reference.maximumTemperatureGradientCPerM,
      totalAppliedHeatW: reference.totalAppliedHeatW,
      totalReactionHeatW: reference.totalReactionHeatW,
    },
    maximumProfileErrorC,
    engineeringUsePermitted: result.review.engineeringUsePermitted,
  }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}

function createRequest(): NeutralSimulationRequestV2 {
  const projectRevision = 'sim8-real-r1';
  const geometryDigest = digest({ fixture: '100x10x10-slab-step' });
  const face = (semanticReferenceId: string, role: 'load' | 'constraint', x: number) => ({
    semanticReferenceId, domainId: 'slab', ownerPartId: 'slab-part', ownerBodyId: 'slab-body', occurrenceId: 'slab-occurrence',
    geometryKind: 'FACE' as const, role, sourceFeatureId: 'slab-box', resolutionState: 'valid' as const, resolvedAtProjectRevision: projectRevision,
    faceOwnerLocal: {
      centroidPartLocalMm: [x, 5, 5] as NeutralVector3, areaMm2: 100,
      outwardDirection: [x === 0 ? -1 : 1, 0, 0] as NeutralVector3, geometryType: 'plane', edgeCount: 4,
      boundingBoxMm: { min: [x, 0, 0] as NeutralVector3, max: [x, 10, 10] as NeutralVector3 },
    },
  });
  return sealNeutralSimulationRequestV2({
    schema: 'tunacad-neutral-simulation-request/2.0',
    studyId: 'sim8-real-one-dimensional-conduction',
    name: 'SIM-8 real one-dimensional conduction slab',
    preparedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    analysis: { type: 'steady_thermal', assumptions: ['steady_state', 'isotropic_conduction', 'temperature_independent_properties'] },
    model: {
      projectRevision,
      coordinateSpace: 'frozen_analysis',
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
      source: { kind: 'custom', reference: 'SIM-8 analytical fixture' },
    }],
    materialAssignments: [{ assignmentId: 'slab-material', domainId: 'slab', materialId: 'thermal-material', volumeRegionId: 'slab-volume' }],
    loads: [{ id: 'inward-flux', name: 'Inward heat flux', type: 'surface_heat_flux', semanticReferenceIds: ['heated-face'], heatFluxWPerM2: 10_000 }],
    constraints: [{ id: 'cold-temperature', name: 'Cold face', type: 'prescribed_temperature', semanticReferenceIds: ['cold-face'], temperatureC: 20 }],
    interactions: [],
    mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2, globalSizeMm: 8, minimumSizeMm: 2, maximumNodes: 100_000, maximumElements: 50_000, qualityMetric: 'provider_normalized', minimumQuality: 0.04 },
    requestedResults: ['temperature', 'heat_flux', 'reaction_heat_flow'],
  });
}

async function waitForResult(solver: CalculiXMultiDomainSolverProvider, providerRunId: string): Promise<NeutralSimulationResultV2> {
  const deadline = Date.now() + solver.capabilities.execution.totalTimeoutMs;
  while (Date.now() < deadline) {
    const status = await solver.getStatus(providerRunId);
    if (status.status === 'failed') throw new Error((status.failure?.code ?? 'SIMULATION_FAILED') + ': ' + (status.failure?.message ?? 'Unknown failure.'));
    if (status.status === 'succeeded') {
      const result = await solver.getResult(providerRunId);
      if (!result) throw new Error('CalculiX completed without a normalized SIM-8 result.');
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  await solver.cancel(providerRunId);
  throw new Error('SIM-8 real CalculiX fixture timed out.');
}
