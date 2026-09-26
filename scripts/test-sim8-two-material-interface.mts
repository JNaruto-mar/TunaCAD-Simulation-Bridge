import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCalculiXInputDeckV2 } from '../providers/calculix/CalculiXMultiDomainDeck.mts';
import { CalculiXMultiDomainSolverProvider } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { GmshMultiDomainMeshProvider } from '../providers/gmsh/GmshMultiDomainMeshProvider.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { solveTwoMaterialSeriesConduction } from '../simulation-bridge/steadyThermalValidation.mts';
import { admitV2SimulationRequest, sealNeutralSimulationRequestV2, validateNeutralSimulationRequestV2, validateNeutralSimulationResultV2 } from '../simulation-bridge/v2Validation.mts';
import type { NeutralSimulationDomainV2, NeutralSimulationRequestV2, NeutralVector3 } from '../src/simulation/externalSimulationContracts.ts';

const reference = solveTwoMaterialSeriesConduction({
  firstLengthMm: 50, secondLengthMm: 50, areaMm2: 100,
  firstConductivityWPerMK: 50, secondConductivityWPerMK: 100,
  prescribedTemperatureC: 20, inwardHeatFluxWPerM2: 10_000,
});
assert.equal(reference.temperatureSamples[1].temperatureC, 30);
assert.equal(reference.maximumTemperatureC, 35);
assert.equal(reference.totalAppliedHeatW, 1);
assert.equal(reference.totalReactionHeatW, -1);
assert.throws(() => solveTwoMaterialSeriesConduction({
  firstLengthMm: 50, secondLengthMm: 50, areaMm2: 100,
  firstConductivityWPerMK: 0, secondConductivityWPerMK: 100,
  prescribedTemperatureC: 20, inwardHeatFluxWPerM2: 10_000,
}), { code: 'SIMULATION_THERMAL_FIXTURE_INVALID' });

const request = createRequest();
assert.deepEqual(validateNeutralSimulationRequestV2(request), request);
const solver = new CalculiXMultiDomainSolverProvider({ executable: process.env.TUNACAD_CALCULIX_EXECUTABLE ?? 'C:\\fixture\\ccx216.exe', runtimeVersion: '2.16' });
assert.deepEqual(admitV2SimulationRequest(request, solver.capabilities), { accepted: true });
const disconnected = sealNeutralSimulationRequestV2({ ...request, interactions: [] });
assert.throws(() => validateNeutralSimulationRequestV2(disconnected), /BRIDGE_V2_REFERENCE_INVALID/);
const wrongMaterial = sealNeutralSimulationRequestV2({ ...request,
  materialAssignments: request.materialAssignments.map(assignment => ({ ...assignment, materialId: 'first-material' })) });
assert.throws(() => validateNeutralSimulationRequestV2(wrongMaterial), /BRIDGE_V2_MATERIAL_INVALID/);

if (import.meta.url === pathToFileURL(process.argv[1]).href && process.env.TUNACAD_SIM8_REAL === '1') {
  const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
  const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
  if (!gmsh || !calculix) throw new Error('Set Gmsh and CalculiX executable paths for the focused two-material fixture.');
  const directory = await mkdtemp(join(tmpdir(), 'tunacad-sim8-interface-'));
  try {
    const stepPath = join(directory, 'slab.step');
    const geoPath = join(directory, 'slab.geo');
    await writeFile(geoPath, [
      'SetFactory("OpenCASCADE");',
      'Box(1) = {0, 0, 0, 50, 10, 10};',
      'Save "' + stepPath.replace(/\\/g, '/').replace(/"/g, '\\"') + '";',
    ].join('\n'), 'utf8');
    execFileSync(gmsh, [geoPath, '-0', '-v', '2'], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const step = new Uint8Array(await readFile(stepPath));
    const mesher = new GmshMultiDomainMeshProvider({ executable: gmsh, runtimeVersion: '4.15.2' });
    const model = await mesher.mesh(request, { descriptor: request.model,
      async exportDomain(domainId, format) {
        assert.ok(domainId === 'first' || domainId === 'second');
        assert.equal(format, 'step');
        return step;
      } });
    const deck = createCalculiXInputDeckV2(request, model);
    assert.equal(deck, createCalculiXInputDeckV2(request, model), 'The two-material deck must be deterministic.');
    assert.match(deck, /^\*MATERIAL, NAME=THERMAL_MATERIAL_001\n\*CONDUCTIVITY\n0\.05$/m);
    assert.match(deck, /^\*MATERIAL, NAME=THERMAL_MATERIAL_002\n\*CONDUCTIVITY\n0\.1$/m);
    assert.match(deck, /^\*SOLID SECTION, ELSET=THERMAL_DOMAIN_001, MATERIAL=THERMAL_MATERIAL_001$/m);
    assert.match(deck, /^\*SOLID SECTION, ELSET=THERMAL_DOMAIN_002, MATERIAL=THERMAL_MATERIAL_002$/m);
    const submission = await solver.submit(request, model);
    const result = await waitForResult(solver, submission.providerRunId);
    validateNeutralSimulationResultV2(result, request);
    const repeatedSubmission = await solver.submit(request, model);
    const repeatedResult = await waitForResult(solver, repeatedSubmission.providerRunId);
    validateNeutralSimulationResultV2(repeatedResult, request);
    if (result.analysisType !== 'steady_thermal' || repeatedResult.analysisType !== 'steady_thermal') throw new Error('The provider returned a non-thermal result.');
    assert.deepEqual(repeatedResult.thermal, result.thermal, 'The normalized two-material thermal result must repeat exactly on the same mesh.');
    const thermal = result.thermal!;
    const interfaceSample = thermal.temperatureSamples.find(sample => Math.abs(sample.positionAnalysisMm[0] - 50) < 1e-8);
    assert.ok(interfaceSample, 'The normalized result must retain a shared-interface temperature witness.');
    const interfaceErrorC = Math.abs(interfaceSample.temperatureC - 30);
    const endErrorC = Math.abs(thermal.maximumTemperatureC - 35);
    const heatBalanceErrorW = thermal.heatBalanceResidualW;
    assert.ok(interfaceErrorC <= .01, 'The shared-interface temperature must match the series-conduction oracle.');
    assert.ok(endErrorC <= .01, 'The free-end temperature must match the series-conduction oracle.');
    assert.ok(Math.abs(thermal.totalReactionHeatW + 1) <= 1e-5, 'The base reaction must conserve one watt.');
    assert.ok(heatBalanceErrorW <= 1e-5, 'Global heat flow must close within 1e-5 watt.');
    assert.ok(Math.abs(thermal.maximumTemperatureGradientCPerM - 200) <= 1, 'Per-material gradient must match the higher 200 C/m slope.');
    assert.equal(result.perDomain.length, 2);
    assert.equal(result.review.engineeringUsePermitted, false);
    console.log(JSON.stringify({ status: 'PASS', fixture: 'two-material-shared-interface-series-slab',
      versions: { gmsh: '4.15.2', calculix: '2.16' },
      mesh: { nodes: model.nodes.length, elements: model.volumeElements.connectivity.length },
      analytical: { baseTemperatureC: 20, interfaceTemperatureC: 30, endTemperatureC: 35, heatFlowW: 1, maximumGradientCPerM: 200 },
      provider: { interfaceTemperatureC: interfaceSample.temperatureC, endTemperatureC: thermal.maximumTemperatureC,
        appliedHeatW: thermal.totalAppliedHeatW, baseReactionHeatW: thermal.totalReactionHeatW,
        maximumGradientCPerM: thermal.maximumTemperatureGradientCPerM, heatBalanceResidualW: heatBalanceErrorW },
      comparison: { interfaceErrorC, endErrorC, heatBalanceErrorW, repeatNormalizedThermalExact: true } }, null, 2));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
} else if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('SIM-8 two-material analytical/admission PASS; set TUNACAD_SIM8_REAL=1 for one focused provider solve.');
}

export function createRequest(): NeutralSimulationRequestV2 {
  const now = Date.now();
  const shape = { valid: true as const, connectedSolidCount: 1 as const, faceCount: 6, edgeCount: 12, volumeMm3: 5_000,
    surfaceAreaMm2: 2_200, boundingBoxOwnerLocalMm: {
      min: [0, 0, 0] as NeutralVector3, max: [50, 10, 10] as NeutralVector3, size: [50, 10, 10] as NeutralVector3 } };
  const domain = (id: string, x: number): Omit<NeutralSimulationDomainV2, 'domainDigest'> => ({
    domainId: id, partId: id + '-part', bodyId: id + '-body', occurrenceId: id + '-occurrence',
    geometryDigest: digest({ fixture: '50x10x10-mm-step' }), transformToAnalysis: [1, 0, 0, x, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    shape,
  });
  const face = (domainId: string, id: string, role: 'load' | 'constraint' | 'interaction', x: number, normal: number) => ({
    semanticReferenceId: id, domainId, ownerPartId: domainId + '-part', ownerBodyId: domainId + '-body',
    occurrenceId: domainId + '-occurrence', geometryKind: 'FACE' as const, role,
    sourceFeatureId: 'series-box', resolutionState: 'valid' as const, resolvedAtProjectRevision: 'sim8-interface-r1',
    faceOwnerLocal: { centroidPartLocalMm: [x, 5, 5] as NeutralVector3, areaMm2: 100,
      outwardDirection: [normal, 0, 0] as NeutralVector3, geometryType: 'plane',
      edgeCount: 4, boundingBoxMm: { min: [x, 0, 0] as NeutralVector3, max: [x, 10, 10] as NeutralVector3 } },
  });
  return sealNeutralSimulationRequestV2({
    schema: 'tunacad-neutral-simulation-request/2.0', studyId: 'sim8-two-material-interface', name: 'SIM-8 two-material series slab',
    preparedAt: new Date(now).toISOString(), expiresAt: new Date(now + 20 * 60_000).toISOString(),
    analysis: { type: 'steady_thermal', assumptions: ['steady_state', 'isotropic_conduction', 'temperature_independent_properties'] },
    model: { projectRevision: 'sim8-interface-r1', coordinateSpace: 'frozen_analysis',
      domains: [domain('first', 0), domain('second', 50)],
      references: [
        face('first', 'base-face', 'constraint', 0, -1),
        face('first', 'first-interface-face', 'interaction', 50, 1),
        face('second', 'second-interface-face', 'interaction', 0, -1),
        face('second', 'end-face', 'load', 50, 1),
      ] },
    units: { geometry: 'mm', force: 'N', stress: 'MPa', displacement: 'mm', density: 'kg/m^3', acceleration: 'mm/s^2',
      temperature: 'degC', heatFlux: 'W/m^2', heatFlow: 'W', thermalConductivity: 'W/(m*K)' },
    materials: [
      { id: 'first-material', name: 'k50', model: 'isotropic_linear_elastic', youngsModulusMPa: 1, poissonRatio: 0,
        thermalConductivityWPerMK: 50, source: { kind: 'custom', reference: 'SIM-8 two-material fixture' } },
      { id: 'second-material', name: 'k100', model: 'isotropic_linear_elastic', youngsModulusMPa: 1, poissonRatio: 0,
        thermalConductivityWPerMK: 100, source: { kind: 'custom', reference: 'SIM-8 two-material fixture' } },
    ],
    materialAssignments: [
      { assignmentId: 'first-assignment', domainId: 'first', materialId: 'first-material', volumeRegionId: 'first-volume' },
      { assignmentId: 'second-assignment', domainId: 'second', materialId: 'second-material', volumeRegionId: 'second-volume' },
    ],
    loads: [{ id: 'end-flux', name: 'Inward heat flux at x=100', type: 'surface_heat_flux',
      semanticReferenceIds: ['end-face'], heatFluxWPerM2: 10_000 }],
    constraints: [{ id: 'base-temperature', name: 'Base at 20 C', type: 'prescribed_temperature',
      semanticReferenceIds: ['base-face'], temperatureC: 20 }],
    interactions: [{ id: 'perfect-interface', name: 'Conformal perfect thermal interface', type: 'shared_topology',
      secondaryReferenceIds: ['first-interface-face'], primaryReferenceIds: ['second-interface-face'],
      adjustment: 'none', positionToleranceMm: .01 }],
    mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2, globalSizeMm: 10,
      minimumSizeMm: 2, maximumNodes: 100_000, maximumElements: 50_000, qualityMetric: 'provider_normalized', minimumQuality: .04 },
    requestedResults: ['temperature', 'heat_flux', 'reaction_heat_flow'],
  });
}

async function waitForResult(solver: CalculiXMultiDomainSolverProvider, providerRunId: string) {
  const deadline = Date.now() + solver.capabilities.execution.totalTimeoutMs;
  while (Date.now() < deadline) {
    const status = await solver.getStatus(providerRunId);
    if (status.status === 'failed') throw new Error((status.failure?.code ?? 'SIMULATION_FAILED') + ': ' + (status.failure?.message ?? 'Unknown failure.'));
    if (status.status === 'succeeded') {
      const result = await solver.getResult(providerRunId);
      if (!result) throw new Error('CalculiX completed without a normalized two-material result.');
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  await solver.cancel(providerRunId);
  throw new Error('Focused SIM-8 interface fixture timed out.');
}
