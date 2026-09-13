import assert from 'node:assert/strict';
import { CalculiXMultiDomainSolverProvider, parseCalculiXSteadyThermalDatV2 } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import type { NeutralFemModelV2, NeutralSimulationRequestV2, NeutralSimulationResultV2, SimulationProviderCapabilitiesV2 } from '../src/simulation/externalSimulationContracts.ts';
import { admitV2SimulationRequest, sealNeutralSimulationRequestV2, validateNeutralSimulationRequestV2, validateNeutralSimulationResultV2 } from '../simulation-bridge/v2Validation.mts';
import { solveOneDimensionalSteadyConduction } from '../simulation-bridge/steadyThermalValidation.mts';

const request = createThermalRequest();
assert.deepEqual(validateNeutralSimulationRequestV2(request), request);

const thermalProvider = new CalculiXMultiDomainSolverProvider({ executable: 'C:\\fixture\\ccx216.exe', runtimeVersion: '2.16' });
assert.deepEqual(admitV2SimulationRequest(request, thermalProvider.capabilities), { accepted: true });
const unsupportedCapabilities = structuredClone(thermalProvider.capabilities) as SimulationProviderCapabilitiesV2;
unsupportedCapabilities.analysisTypes = unsupportedCapabilities.analysisTypes.filter(type => type !== 'steady_thermal');
delete unsupportedCapabilities.study.steadyThermal;
assert.equal(admitV2SimulationRequest(request, unsupportedCapabilities).accepted, false, 'A provider without the explicit thermal profile must reject before transfer.');

const boundedCapabilities = structuredClone(thermalProvider.capabilities) as SimulationProviderCapabilitiesV2;
boundedCapabilities.study.steadyThermal = {
  maximumDomains: 1, materialModel: 'constant_isotropic_conductivity', loadTypes: ['surface_heat_flux'],
  maximumHeatFluxLoads: 1, constraintTypes: ['prescribed_temperature'], maximumPrescribedTemperatureConstraints: 1,
  temperatureProfile: 'bounded_samples', maximumTemperatureSamples: 256, heatBalance: true,
};
assert.deepEqual(admitV2SimulationRequest(request, boundedCapabilities), { accepted: true });

const analytical = solveOneDimensionalSteadyConduction({
  lengthMm: 100, areaMm2: 100, thermalConductivityWPerMK: 50,
  prescribedTemperatureC: 20, inwardHeatFluxWPerM2: 10_000, sampleCount: 5,
});
assert.equal(analytical.minimumTemperatureC, 20);
assert.equal(analytical.maximumTemperatureC, 40);
assert.equal(analytical.maximumTemperatureGradientCPerM, 200);
assert.equal(analytical.totalAppliedHeatW, 1);
assert.equal(analytical.totalReactionHeatW, -1);
assert.deepEqual(analytical.temperatureSamples.map(sample => sample.temperatureC), [20, 25, 30, 35, 40]);

const completedAt = new Date().toISOString();
const result: NeutralSimulationResultV2 = {
  schema: 'tunacad-neutral-simulation-result/2.0', studyId: request.studyId, jobId: 'sim8_analytical_fixture',
  requestDigest: request.requestDigest, projectRevision: request.model.projectRevision, modelDigest: request.model.modelDigest,
  analysisType: 'steady_thermal', status: 'succeeded', authority: 'architecture_mock',
  metrics: { maximumVonMisesStressMPa: null, maximumDisplacementMm: null, minimumFactorOfSafety: null },
  perDomain: [{ domainId: 'slab', metrics: { maximumVonMisesStressMPa: null, maximumDisplacementMm: null, minimumFactorOfSafety: null }, fieldDatasetIds: [] }],
  reactions: [], criticalRegions: [], failedConstraints: [],
  warnings: [{ code: 'SIMULATION_STEADY_THERMAL_POC', message: 'Experimental SIM-8 analytical foundation; no external FEM result is claimed.', severity: 'warning' }],
  convergence: { status: 'converged', iterations: null, residual: 0, providerDeclared: false }, suggestedEngineeringIssues: ['Verify conductivity, flux sign, area, and thermal units.'],
  thermal: analytical,
  provenance: { providerInterfaceVersion: '2.0', adapterId: 'tunacad-sim8-analytical-fixture', adapterVersion: '0.1.0-poc', providerRunId: 'sim8_analytical_fixture', submittedAt: completedAt, completedAt, normalizedAt: completedAt },
  review: { engineerReviewRequired: true, engineeringUsePermitted: false, disclaimer: 'SIM-8 contract/analytical fixture only; not an external FEM solve.' },
  mutation: { occurred: false, projectRevisionBefore: request.model.projectRevision, projectRevisionAfter: request.model.projectRevision },
};
assert.deepEqual(validateNeutralSimulationResultV2(result, request), result);
assert.throws(() => validateNeutralSimulationResultV2({ ...result, thermal: { ...analytical, totalReactionHeatW: -0.9 } }, request), /BRIDGE_V2_THERMAL_RESULT_INVALID/);
assert.throws(() => validateNeutralSimulationRequestV2(createThermalRequest({ thermalConductivityWPerMK: undefined })), /BRIDGE_V2_THERMAL_REQUEST_INVALID/);
assert.throws(() => validateNeutralSimulationRequestV2(createThermalRequest({ heatFluxWPerM2: -1 })), /BRIDGE_V2_REQUEST_INVALID/);
assert.throws(() => solveOneDimensionalSteadyConduction({ lengthMm: 100, areaMm2: 100, thermalConductivityWPerMK: 0, prescribedTemperatureC: 20, inwardHeatFluxWPerM2: 10_000 }), { code: 'SIMULATION_THERMAL_FIXTURE_INVALID' });

const parserModel = {
  nodes: [[0, 0, 0], [100, 0, 0]],
  volumeElements: { connectivity: [[0, 1, 0, 1, 0, 1, 0, 1, 0, 1]] },
} as unknown as NeutralFemModelV2;
const parsed = parseCalculiXSteadyThermalDatV2([
  ' temperatures for set NALL and time 1',
  ' 1 20',
  ' 2 40',
  ' heat generation for set THERMAL_REACTION_001 and time 1',
  ' 1 -1',
  ' heat flux (elem, integ.pnt.,qx,qy,qz) for set EALL and time 1',
  ' 1 1 -0.01 0 0',
].join('\n'), parserModel, ['THERMAL_REACTION_001']);
assert.deepEqual([...parsed.temperaturesByNode.values()], [20, 40]);
assert.equal(parsed.maximumHeatFluxMagnitudeWPerMm2, 0.01);
assert.equal(parsed.reactionHeatBySetW.THERMAL_REACTION_001, -1);
assert.throws(() => parseCalculiXSteadyThermalDatV2('temperatures for set NALL\n1 20\n2 40', parserModel, ['THERMAL_REACTION_001']), /complete bounded NT, HFL, and RFL/);
assert.throws(() => parseCalculiXSteadyThermalDatV2([
  'temperatures for set OTHER', '1 20', '2 40',
  'heat generation for set THERMAL_REACTION_001', '1 -1',
  'heat flux (elem, integ.pnt.,qx,qy,qz) for set EALL', '1 1 -0.01 0 0',
].join('\n'), parserModel, ['THERMAL_REACTION_001']), /complete bounded NT, HFL, and RFL/);

console.log('SIM-8 steady-thermal foundation PASS: sealed contract, bounded provider admission, 1D 20-40 C oracle, 1 W heat balance, quarantined NT/HFL/RFL parsing, malformed-result rejection, engineeringUsePermitted=false.');

function createThermalRequest(overrides: { thermalConductivityWPerMK?: number; heatFluxWPerM2?: number } = {}): NeutralSimulationRequestV2 {
  const now = Date.now();
  const conductivity = Object.prototype.hasOwnProperty.call(overrides, 'thermalConductivityWPerMK') ? overrides.thermalConductivityWPerMK : 50;
  const heatFlux = overrides.heatFluxWPerM2 ?? 10_000;
  return sealNeutralSimulationRequestV2({
    schema: 'tunacad-neutral-simulation-request/2.0', studyId: 'sim8-1d-conduction', name: 'SIM-8 one-dimensional slab',
    preparedAt: new Date(now).toISOString(), expiresAt: new Date(now + 20 * 60_000).toISOString(),
    analysis: { type: 'steady_thermal', assumptions: ['steady_state', 'isotropic_conduction', 'temperature_independent_properties'] },
    model: { projectRevision: 'sim8-revision', coordinateSpace: 'frozen_analysis', domains: [{
      domainId: 'slab', partId: 'slab-part', bodyId: 'slab-body', occurrenceId: 'slab-occurrence', geometryDigest: `sha256:${'1'.repeat(64)}`,
      transformToAnalysis: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      shape: { valid: true, connectedSolidCount: 1, faceCount: 6, edgeCount: 12, volumeMm3: 10_000, surfaceAreaMm2: 4_200, boundingBoxOwnerLocalMm: { min: [0, 0, 0], max: [100, 10, 10], size: [100, 10, 10] } },
    }], references: [
      { semanticReferenceId: 'cold-face', domainId: 'slab', ownerPartId: 'slab-part', ownerBodyId: 'slab-body', occurrenceId: 'slab-occurrence', geometryKind: 'FACE', role: 'constraint', sourceFeatureId: null, resolutionState: 'valid', resolvedAtProjectRevision: 'sim8-revision', faceOwnerLocal: { centroidPartLocalMm: [0, 5, 5], areaMm2: 100, outwardDirection: [-1, 0, 0], geometryType: 'plane' } },
      { semanticReferenceId: 'heated-face', domainId: 'slab', ownerPartId: 'slab-part', ownerBodyId: 'slab-body', occurrenceId: 'slab-occurrence', geometryKind: 'FACE', role: 'load', sourceFeatureId: null, resolutionState: 'valid', resolvedAtProjectRevision: 'sim8-revision', faceOwnerLocal: { centroidPartLocalMm: [100, 5, 5], areaMm2: 100, outwardDirection: [1, 0, 0], geometryType: 'plane' } },
    ] },
    units: { geometry: 'mm', force: 'N', stress: 'MPa', displacement: 'mm', density: 'kg/m^3', acceleration: 'mm/s^2', temperature: 'degC', heatFlux: 'W/m^2', heatFlow: 'W', thermalConductivity: 'W/(m*K)' },
    materials: [{ id: 'thermal-material', name: 'Constant conductivity fixture', model: 'isotropic_linear_elastic', youngsModulusMPa: 1, poissonRatio: 0, ...(conductivity === undefined ? {} : { thermalConductivityWPerMK: conductivity }), source: { kind: 'custom', reference: 'SIM-8 analytical fixture' } }],
    materialAssignments: [{ assignmentId: 'slab-material', domainId: 'slab', materialId: 'thermal-material', volumeRegionId: 'slab-volume' }],
    loads: [{ id: 'inward-flux', name: 'Inward heat flux', type: 'surface_heat_flux', semanticReferenceIds: ['heated-face'], heatFluxWPerM2: heatFlux }],
    constraints: [{ id: 'cold-temperature', name: 'Cold face', type: 'prescribed_temperature', semanticReferenceIds: ['cold-face'], temperatureC: 20 }],
    interactions: [], mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2, globalSizeMm: 10, minimumSizeMm: 2.5, maximumNodes: 100_000, maximumElements: 50_000, qualityMetric: 'provider_normalized', minimumQuality: 0.04 },
    requestedResults: ['temperature', 'heat_flux', 'reaction_heat_flow'],
  });
}
