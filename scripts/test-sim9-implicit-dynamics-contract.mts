import assert from 'node:assert/strict';
import type { NeutralSimulationRequestV2, SimulationProviderCapabilitiesV2 } from '../src/simulation/externalSimulationContracts.ts';
import { CalculiXMultiDomainSolverProvider } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { createCalculiXInputDeckV2 } from '../providers/calculix/CalculiXMultiDomainDeck.mts';
import { admitV2SimulationRequest, sealNeutralSimulationRequestV2, validateNeutralSimulationRequestV2,
  validateNeutralSimulationResultV2 } from '../simulation-bridge/v2Validation.mts';

type DynamicsRequest = Extract<NeutralSimulationRequestV2, { analysis: { type: 'implicit_transient_dynamics' } }>;
// One consistent-mass axial trial mode u(x)=x/L for a fixed-free bar.
// This is an exact SDOF reduced-order step-response reference, not an
// exact 3D continuum or CalculiX result.
const lengthMm = 100;
const areaMm2 = 100;
const youngsModulusMPa = 200_000;
const densityKgM3 = 7800;
const appliedForceN = 100;
const stiffnessNPerMm = youngsModulusMPa * areaMm2 / lengthMm;
const generalizedMassKg = densityKgM3 * areaMm2 * lengthMm * 1e-9 / 3;
const generalizedMassNs2PerMm = generalizedMassKg / 1000;
const angularFrequencyRadS = Math.sqrt(stiffnessNPerMm / generalizedMassNs2PerMm);
const periodS = 2 * Math.PI / angularFrequencyRadS;
const staticDisplacementMm = appliedForceN / stiffnessNPerMm;
const outputTimesS = [periodS / 4, periodS / 2, periodS];
const request = makeRequest();
assert.deepEqual(validateNeutralSimulationRequestV2(request), request);
assert.deepEqual(request.analysis.settings.outputTimesS, outputTimesS);

const capabilities = new CalculiXMultiDomainSolverProvider({
  executable: 'C:\\fixture\\ccx216.exe', runtimeVersion: '2.16',
}).capabilities;
assert.equal(capabilities.analysisTypes.includes('implicit_transient_dynamics'), true);
assert.deepEqual(admitV2SimulationRequest(request, capabilities).accepted, true);
const falselyAdvertised = structuredClone(capabilities) as SimulationProviderCapabilitiesV2;
falselyAdvertised.study.implicitDynamics = undefined;
assert.deepEqual(admitV2SimulationRequest(request, falselyAdvertised).accepted, false,
  'A capability advertisement without the exact dynamics profile is insufficient.');
assert.throws(() => validateNeutralSimulationResultV2({}, request), /BRIDGE_V2_RESULT_INVALID/);
assert.throws(() => createCalculiXInputDeckV2(request, {} as never));

function rejected(change: (draft: DynamicsRequest) => void): void {
  const draft = structuredClone(request);
  change(draft);
  assert.throws(() => validateNeutralSimulationRequestV2(sealNeutralSimulationRequestV2(draft)),
    /BRIDGE_V2_[A-Z_]*INVALID/);
}
rejected(draft => { delete draft.materials[0].densityKgM3; });
rejected(draft => { draft.materials[0].densityKgM3 = -1; });
rejected(draft => { draft.analysis.settings.outputTimesS = [outputTimesS[1], outputTimesS[0], periodS]; });
rejected(draft => { draft.analysis.settings.outputTimesS = outputTimesS.slice(0, 2); });
rejected(draft => { draft.analysis.settings.outputTimesS = [0, ...outputTimesS]; });
rejected(draft => { draft.analysis.settings.outputTimesS = Array.from({ length: 17 }, (_, index) => periodS * (index + 1) / 17); });
rejected(draft => { draft.analysis.settings.durationS = -1; });
rejected(draft => { draft.analysis.assumptions[2] = 'damped' as 'undamped'; });
rejected(draft => { draft.loads = []; draft.model.references = draft.model.references.filter(reference => reference.role !== 'load'); });
rejected(draft => { draft.loads[0] = { ...draft.loads[0], type: 'pressure' } as typeof draft.loads[0]; });
rejected(draft => { draft.constraints = []; draft.model.references = draft.model.references.filter(reference => reference.role !== 'constraint'); });
rejected(draft => { draft.constraints[0] = { ...draft.constraints[0], type: 'prescribed_displacement' } as typeof draft.constraints[0]; });
rejected(draft => { draft.loads[0].semanticReferenceIds = ['fixed-face']; });
rejected(draft => { draft.materials.push(structuredClone(draft.materials[0])); });
rejected(draft => { draft.materials[0].specificHeatJPerKgK = 500; });
rejected(draft => { delete draft.units.time; });
rejected(draft => { draft.units.temperature = 'degC'; });
rejected(draft => { draft.requestedResults = ['displacement_history']; });

const samples = outputTimesS.map(timeS => {
  const phase = angularFrequencyRadS * timeS;
  const displacementMm = staticDisplacementMm * (1 - Math.cos(phase));
  const velocityMmPerS = staticDisplacementMm * angularFrequencyRadS * Math.sin(phase);
  const accelerationMmPerS2 = staticDisplacementMm * angularFrequencyRadS ** 2 * Math.cos(phase);
  const reactionForceN = -stiffnessNPerMm * displacementMm;
  const kineticEnergyNmm = generalizedMassNs2PerMm * velocityMmPerS ** 2 / 2;
  const strainEnergyNmm = stiffnessNPerMm * displacementMm ** 2 / 2;
  const appliedWorkNmm = appliedForceN * displacementMm;
  assert(Math.abs(appliedForceN + reactionForceN - generalizedMassNs2PerMm * accelerationMmPerS2) < 1e-9);
  assert(Math.abs(kineticEnergyNmm + strainEnergyNmm - appliedWorkNmm) < 1e-12);
  return { timeS, displacementMm, velocityMmPerS, reactionForceN,
    kineticEnergyNmm, strainEnergyNmm, appliedWorkNmm };
});
assert(Math.abs(samples[0].displacementMm - staticDisplacementMm) < 1e-12);
assert(Math.abs(samples[1].displacementMm - 2 * staticDisplacementMm) < 1e-12);
assert(Math.abs(samples[1].kineticEnergyNmm) < 1e-12);
assert(Math.abs(samples[2].displacementMm) < 1e-12);
console.log(JSON.stringify({ status: 'PASS', fixture: 'SIM-9 implicit dynamics contract and axial SDOF reference',
  scope: 'one constrained linear-elastic undamped step-force solid; zero initial conditions; provider bounded',
  stiffnessNPerMm, generalizedMassKg, angularFrequencyRadS,
  frequencyHz: angularFrequencyRadS / (2 * Math.PI), periodS, staticDisplacementMm, samples,
  providerAdmitted: true, engineeringUsePermitted: false }, null, 2));

export function makeRequest(): DynamicsRequest {
  const now = Date.now();
  return sealNeutralSimulationRequestV2({
    schema: 'tunacad-neutral-simulation-request/2.0', studyId: 'sim9-implicit-axial-bar',
    name: 'SIM-9 implicit axial bar', preparedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 20 * 60_000).toISOString(),
    analysis: { type: 'implicit_transient_dynamics',
      assumptions: ['linear_elasticity', 'small_displacement', 'undamped', 'zero_initial_conditions', 'step_force'],
      settings: { durationS: periodS, outputTimesS } },
    model: { projectRevision: 'sim9-dynamics-r1', coordinateSpace: 'frozen_analysis', domains: [{
      domainId: 'bar', partId: 'bar-part', bodyId: 'bar-body', occurrenceId: 'bar-occurrence',
      geometryDigest: 'sha256:' + '1'.repeat(64),
      transformToAnalysis: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      shape: { valid: true, connectedSolidCount: 1, faceCount: 6, edgeCount: 12,
        volumeMm3: 10_000, surfaceAreaMm2: 4200,
        boundingBoxOwnerLocalMm: { min: [0, 0, 0], max: [100, 10, 10], size: [100, 10, 10] } },
    }], references: [
      { semanticReferenceId: 'fixed-face', domainId: 'bar', ownerPartId: 'bar-part',
        ownerBodyId: 'bar-body', occurrenceId: 'bar-occurrence', geometryKind: 'FACE',
        role: 'constraint', sourceFeatureId: null, resolutionState: 'valid',
        resolvedAtProjectRevision: 'sim9-dynamics-r1',
        faceOwnerLocal: { centroidPartLocalMm: [0, 5, 5], areaMm2: 100,
          outwardDirection: [-1, 0, 0], geometryType: 'plane' } },
      { semanticReferenceId: 'loaded-face', domainId: 'bar', ownerPartId: 'bar-part',
        ownerBodyId: 'bar-body', occurrenceId: 'bar-occurrence', geometryKind: 'FACE',
        role: 'load', sourceFeatureId: null, resolutionState: 'valid',
        resolvedAtProjectRevision: 'sim9-dynamics-r1',
        faceOwnerLocal: { centroidPartLocalMm: [100, 5, 5], areaMm2: 100,
          outwardDirection: [1, 0, 0], geometryType: 'plane' } },
    ] },
    units: { geometry: 'mm', force: 'N', stress: 'MPa', displacement: 'mm',
      density: 'kg/m^3', acceleration: 'mm/s^2', time: 's' },
    materials: [{ id: 'steel', name: 'Linear elastic reference', model: 'isotropic_linear_elastic',
      youngsModulusMPa, poissonRatio: .3, densityKgM3,
      source: { kind: 'custom', reference: 'SIM-9 axial SDOF analytical fixture' } }],
    materialAssignments: [{ assignmentId: 'bar-steel', domainId: 'bar',
      materialId: 'steel', volumeRegionId: 'bar-volume' }],
    loads: [{ id: 'step-force', name: 'Axial step force', type: 'surface_force',
      semanticReferenceIds: ['loaded-face'], forceN: [appliedForceN, 0, 0], coordinateSystem: 'analysis' }],
    constraints: [{ id: 'fixed-end', name: 'Fixed end', type: 'fixed', semanticReferenceIds: ['fixed-face'] }],
    interactions: [], mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2,
      globalSizeMm: 10, minimumSizeMm: 2.5, maximumNodes: 100_000,
      maximumElements: 50_000, qualityMetric: 'provider_normalized', minimumQuality: .04 },
    requestedResults: ['displacement_history', 'reaction_force_history',
      'kinetic_energy_history', 'strain_energy_history'],
  }) as DynamicsRequest;
}
