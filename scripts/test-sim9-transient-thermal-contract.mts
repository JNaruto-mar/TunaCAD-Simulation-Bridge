import assert from 'node:assert/strict';
import type { NeutralSimulationRequestV2, SimulationProviderCapabilitiesV2 } from '../src/simulation/externalSimulationContracts.ts';
import { CalculiXMultiDomainSolverProvider } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { admitV2SimulationRequest, sealNeutralSimulationRequestV2, validateNeutralSimulationRequestV2, validateNeutralSimulationResultV2 } from '../simulation-bridge/v2Validation.mts';

type TransientRequest = Extract<NeutralSimulationRequestV2, { analysis: { type: 'transient_thermal' } }>;
const request = makeRequest();
assert.deepEqual(validateNeutralSimulationRequestV2(request), request);

const capabilities = new CalculiXMultiDomainSolverProvider({ executable: 'C:\\fixture\\ccx216.exe', runtimeVersion: '2.16' }).capabilities;
assert.deepEqual(admitV2SimulationRequest(request, capabilities), { accepted: true });
const missingProfile = structuredClone(capabilities) as SimulationProviderCapabilitiesV2;
delete missingProfile.study.transientThermal;
assert.equal(admitV2SimulationRequest(request, missingProfile).accepted, false);
assert.throws(() => validateNeutralSimulationResultV2({}, request), /BRIDGE_V2_RESULT_INVALID/);

function rejected(change: (draft: TransientRequest) => void): void {
  const draft = structuredClone(request);
  change(draft);
  assert.throws(() => validateNeutralSimulationRequestV2(sealNeutralSimulationRequestV2(draft)),
    /BRIDGE_V2_(TRANSIENT_THERMAL_REQUEST_INVALID|REQUEST_INVALID)/);
}
rejected(draft => { delete draft.materials[0].densityKgM3; });
rejected(draft => { delete draft.materials[0].specificHeatJPerKgK; });
rejected(draft => { draft.materials[0].specificHeatJPerKgK = -1; });
rejected(draft => { draft.analysis.settings.outputTimesS = [400, 100, 1200]; });
rejected(draft => { draft.analysis.settings.outputTimesS = [100, 400]; });
rejected(draft => { draft.analysis.settings.maximumIncrementS = 0; });
rejected(draft => { draft.analysis.settings.maximumIncrementS = 101; });
rejected(draft => { draft.analysis.settings.maximumIncrementS = 1; });
rejected(draft => { draft.analysis.settings.maximumIncrements = 0; });
rejected(draft => { draft.analysis.settings.maximumIncrements = 1001; });
rejected(draft => { draft.analysis.settings.maximumIncrements = 1.5; });
rejected(draft => { draft.analysis.settings.initialTemperatureC = 19; });
rejected(draft => { delete draft.units.specificHeat; });
rejected(draft => { draft.requestedResults = ['temperature_history']; });
rejected(draft => { draft.materials[0].thermalConductivityCurve = [
  { temperatureC: 20, conductivityWPerMK: 50 }, { temperatureC: 40, conductivityWPerMK: 60 },
]; });
rejected(draft => { draft.loads = []; draft.model.references = draft.model.references.filter(reference => reference.role !== 'load'); });

// The new heat-capacity/time fields cannot silently alter the older steady
// thermal interpretation. A steady request without them still validates.
const steady = structuredClone(request) as NeutralSimulationRequestV2 & { analysis: unknown };
steady.analysis = { type: 'steady_thermal', assumptions: ['steady_state', 'isotropic_conduction', 'temperature_independent_properties'] };
steady.requestedResults = ['temperature', 'heat_flux', 'reaction_heat_flow'];
assert.throws(() => validateNeutralSimulationRequestV2(sealNeutralSimulationRequestV2(steady)),
  /BRIDGE_V2_TRANSIENT_THERMAL_REQUEST_INVALID/);
delete steady.materials[0].specificHeatJPerKgK;
delete steady.units.time;
delete steady.units.specificHeat;
assert.deepEqual(validateNeutralSimulationRequestV2(sealNeutralSimulationRequestV2(steady)).analysis.type, 'steady_thermal');

// Exact Fourier-series solution for a 100 mm slab initially at 20 C:
// T(0,t)=20 C, inward q=10 kW/m2 at x=L for t>0, other faces insulated.
// k=50 W/(m*K), rho=7800 kg/m3, cp=500 J/(kg*K).
// Steady endpoint is 40 C; diffusion time L^2/alpha is 780 s.
const lengthM = .1;
const areaM2 = 1e-4;
const conductivity = 50;
const density = 7800;
const specificHeat = 500;
const flux = 10_000;
const diffusivity = conductivity / (density * specificHeat);
assert(Math.abs(lengthM ** 2 / diffusivity - 780) < 1e-10);

function temperature(xM: number, timeS: number): number {
  let transient = 0;
  for (let n = 0; n < 128; n += 1) {
    const wave = (n + .5) * Math.PI / lengthM;
    transient += (n % 2 ? -1 : 1) * Math.sin(wave * xM)
      * Math.exp(-diffusivity * wave ** 2 * timeS) / wave ** 2;
  }
  return 20 + flux * xM / conductivity - 2 * flux * transient / (conductivity * lengthM);
}
function reactionHeatW(timeS: number): number {
  let transientGradient = 0;
  for (let n = 0; n < 128; n += 1) {
    const wave = (n + .5) * Math.PI / lengthM;
    transientGradient += (n % 2 ? -1 : 1) * Math.exp(-diffusivity * wave ** 2 * timeS) / wave;
  }
  return -areaM2 * (flux - 2 * flux * transientGradient / lengthM);
}
function storedEnergyJ(timeS: number): number {
  const intervals = 200;
  let weightedRise = 0;
  for (let i = 0; i <= intervals; i += 1) {
    const weight = i === 0 || i === intervals ? 1 : i % 2 ? 4 : 2;
    weightedRise += weight * (temperature(lengthM * i / intervals, timeS) - 20);
  }
  return density * specificHeat * areaM2 * lengthM * weightedRise / (3 * intervals);
}

const frames = request.analysis.settings.outputTimesS.map(timeS => ({
  timeS, tipTemperatureC: temperature(lengthM, timeS),
  reactionHeatW: reactionHeatW(timeS), storedEnergyJ: storedEnergyJ(timeS),
}));
assert.deepEqual(frames.map(frame => frame.timeS), [100, 400, 1200]);
assert(frames.every(frame => frame.tipTemperatureC > 20 && frame.tipTemperatureC < 40));
assert(frames.every((frame, index) => index === 0 || frame.tipTemperatureC > frames[index - 1].tipTemperatureC));
assert(frames.every(frame => Math.abs(temperature(0, frame.timeS) - 20) < 1e-12));
assert(frames.every(frame => frame.reactionHeatW <= 0 && frame.reactionHeatW >= -1));
assert(Math.abs(temperature(lengthM, 20_000) - 40) < 1e-10);
const deltaS = .01;
const energyRateW = (storedEnergyJ(400 + deltaS) - storedEnergyJ(400 - deltaS)) / (2 * deltaS);
const balanceErrorW = Math.abs(1 + reactionHeatW(400) - energyRateW);
assert(balanceErrorW < 1e-7, 'Analytical transient energy rate must balance applied plus reacted heat.');

console.log('SIM-9 transient contract/analytical fixture PASS:', JSON.stringify({
  diffusivityM2PerS: diffusivity, diffusionTimeS: lengthM ** 2 / diffusivity,
  frames, energyRateWAt400S: energyRateW, energyBalanceErrorWAt400S: balanceErrorW,
  providerAdmitted: true, engineeringUsePermitted: false,
}));

function makeRequest(): TransientRequest {
  const now = Date.now();
  return sealNeutralSimulationRequestV2({
    schema: 'tunacad-neutral-simulation-request/2.0', studyId: 'sim9-transient-slab', name: 'SIM-9 transient slab',
    preparedAt: new Date(now).toISOString(), expiresAt: new Date(now + 20 * 60_000).toISOString(),
    analysis: { type: 'transient_thermal',
      assumptions: ['transient', 'isotropic_conduction', 'temperature_independent_properties', 'uniform_initial_temperature', 'step_boundary_conditions'],
      settings: { initialTemperatureC: 20, durationS: 1200, outputTimesS: [100, 400, 1200] } },
    model: { projectRevision: 'sim9-revision', coordinateSpace: 'frozen_analysis', domains: [{
      domainId: 'slab', partId: 'slab-part', bodyId: 'slab-body', occurrenceId: 'slab-occurrence',
      geometryDigest: 'sha256:' + '1'.repeat(64), transformToAnalysis: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      shape: { valid: true, connectedSolidCount: 1, faceCount: 6, edgeCount: 12, volumeMm3: 10_000, surfaceAreaMm2: 4_200,
        boundingBoxOwnerLocalMm: { min: [0, 0, 0], max: [100, 10, 10], size: [100, 10, 10] } },
    }], references: [
      { semanticReferenceId: 'cold-face', domainId: 'slab', ownerPartId: 'slab-part', ownerBodyId: 'slab-body', occurrenceId: 'slab-occurrence',
        geometryKind: 'FACE', role: 'constraint', sourceFeatureId: null, resolutionState: 'valid', resolvedAtProjectRevision: 'sim9-revision',
        faceOwnerLocal: { centroidPartLocalMm: [0, 5, 5], areaMm2: 100, outwardDirection: [-1, 0, 0], geometryType: 'plane' } },
      { semanticReferenceId: 'heated-face', domainId: 'slab', ownerPartId: 'slab-part', ownerBodyId: 'slab-body', occurrenceId: 'slab-occurrence',
        geometryKind: 'FACE', role: 'load', sourceFeatureId: null, resolutionState: 'valid', resolvedAtProjectRevision: 'sim9-revision',
        faceOwnerLocal: { centroidPartLocalMm: [100, 5, 5], areaMm2: 100, outwardDirection: [1, 0, 0], geometryType: 'plane' } },
    ] },
    units: { geometry: 'mm', force: 'N', stress: 'MPa', displacement: 'mm', density: 'kg/m^3', acceleration: 'mm/s^2',
      temperature: 'degC', heatFlux: 'W/m^2', heatFlow: 'W', thermalConductivity: 'W/(m*K)', time: 's', specificHeat: 'J/(kg*K)' },
    materials: [{ id: 'thermal-material', name: 'Constant-property fixture', model: 'isotropic_linear_elastic',
      youngsModulusMPa: 1, poissonRatio: 0, densityKgM3: 7800, specificHeatJPerKgK: 500,
      thermalConductivityWPerMK: 50, source: { kind: 'custom', reference: 'SIM-9 analytical fixture' } }],
    materialAssignments: [{ assignmentId: 'slab-material', domainId: 'slab', materialId: 'thermal-material', volumeRegionId: 'slab-volume' }],
    loads: [{ id: 'inward-flux', name: 'Inward heat flux', type: 'surface_heat_flux', semanticReferenceIds: ['heated-face'], heatFluxWPerM2: 10_000 }],
    constraints: [{ id: 'cold-temperature', name: 'Cold face', type: 'prescribed_temperature', semanticReferenceIds: ['cold-face'], temperatureC: 20 }],
    interactions: [], mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2, globalSizeMm: 10, minimumSizeMm: 2.5,
      maximumNodes: 100_000, maximumElements: 50_000, qualityMetric: 'provider_normalized', minimumQuality: 0.04 },
    requestedResults: ['temperature_history', 'heat_flow_history'],
  }) as TransientRequest;
}
