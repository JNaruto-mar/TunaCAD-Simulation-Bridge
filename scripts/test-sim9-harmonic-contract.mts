import assert from 'node:assert/strict';
import type { NeutralSimulationRequestV2, SimulationProviderCapabilitiesV2 } from '../src/simulation/externalSimulationContracts.ts';
import { CalculiXMultiDomainSolverProvider } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { createCalculiXInputDeckV2 } from '../providers/calculix/CalculiXMultiDomainDeck.mts';
import { admitV2SimulationRequest, sealNeutralSimulationRequestV2, validateNeutralSimulationRequestV2,
  validateNeutralSimulationResultV2 } from '../simulation-bridge/v2Validation.mts';

type HarmonicRequest = Extract<NeutralSimulationRequestV2, { analysis: { type: 'harmonic_response' } }>;
const lengthMm = 100;
const areaMm2 = 100;
const youngsModulusMPa = 200_000;
const densityKgM3 = 7800;
const peakForceN = 100;
const stiffnessNPerMm = youngsModulusMPa * areaMm2 / lengthMm;
const generalizedMassKg = densityKgM3 * areaMm2 * lengthMm * 1e-9 / 3;
const generalizedMassNs2PerMm = generalizedMassKg / 1000;
const naturalFrequencyHz = Math.sqrt(stiffnessNPerMm / generalizedMassNs2PerMm) / (2 * Math.PI);
const staticDisplacementMm = peakForceN / stiffnessNPerMm;

/** Exact one-coordinate Galerkin reference for u(x)=q*x/L, not an exact
 * continuum or 3D finite-element harmonic result. */
function reference(frequencyHz: number) {
  const ratio = frequencyHz / naturalFrequencyHz;
  const dynamicStiffnessNPerMm = stiffnessNPerMm * (1 - ratio ** 2);
  if (Math.abs(dynamicStiffnessNPerMm) <= stiffnessNPerMm * 1e-12) {
    return { frequencyHz, status: 'undamped_resonance_singular' as const,
      displacementAmplitudeMm: null, displacementPhaseLagRad: null,
      supportReactionAmplitudeN: null, supportReactionPhaseLagRad: null };
  }
  const displacementAmplitudeMm = peakForceN / Math.abs(dynamicStiffnessNPerMm);
  return { frequencyHz, status: 'finite' as const,
    displacementAmplitudeMm,
    displacementPhaseLagRad: dynamicStiffnessNPerMm > 0 ? 0 : Math.PI,
    supportReactionAmplitudeN: stiffnessNPerMm * displacementAmplitudeMm,
    supportReactionPhaseLagRad: dynamicStiffnessNPerMm > 0 ? Math.PI : 0 };
}

const request = makeRequest(naturalFrequencyHz / 2);
assert.deepEqual(validateNeutralSimulationRequestV2(request), request);
assert.deepEqual(request.analysis.settings, { frequencyHz: naturalFrequencyHz / 2,
  forcePhaseRad: 0, initialConditions: 'not_applicable' });
const solver = new CalculiXMultiDomainSolverProvider({
  executable: 'C:\\fixture\\ccx216.exe', runtimeVersion: '2.16',
});
assert.equal(solver.capabilities.analysisTypes.includes('harmonic_response'), true);
assert.deepEqual(admitV2SimulationRequest(request, solver.capabilities).accepted, true);
const falselyAdvertised = structuredClone(solver.capabilities) as SimulationProviderCapabilitiesV2;
delete falselyAdvertised.study.harmonic;
assert.equal(admitV2SimulationRequest(request, falselyAdvertised).accepted, false,
  'A provider without a complete harmonic profile must not be admitted.');
assert.throws(() => createCalculiXInputDeckV2(request, {} as never));
assert.throws(() => validateNeutralSimulationResultV2({}, request), /BRIDGE_V2_RESULT_INVALID/);

function rejected(change: (draft: HarmonicRequest) => void) {
  const draft = structuredClone(request);
  change(draft);
  assert.throws(() => validateNeutralSimulationRequestV2(sealNeutralSimulationRequestV2(draft)),
    /BRIDGE_V2_[A-Z_]*INVALID/);
}
rejected(draft => { draft.analysis.settings.frequencyHz = 0; });
rejected(draft => { draft.analysis.settings.frequencyHz = -1; });
rejected(draft => { draft.analysis.settings.frequencyHz = NaN; });
rejected(draft => { draft.analysis.settings.frequencyHz = Infinity; });
rejected(draft => { draft.analysis.settings.frequencyHz = 1_000_001; });
rejected(draft => { draft.analysis.settings.frequencyHz = [100, 200] as never; });
rejected(draft => { (draft.analysis.settings as unknown as Record<string, unknown>).frequenciesHz = [100, 200]; });
rejected(draft => { draft.analysis.settings.forcePhaseRad = Math.PI as 0; });
rejected(draft => { (draft.analysis.settings as unknown as Record<string, unknown>).dampingModel = 'rayleigh'; });
rejected(draft => { (draft.analysis.settings as unknown as Record<string, unknown>).initialVelocityMmPerS = [1, 0, 0]; });
rejected(draft => { draft.analysis.settings.initialConditions = 'nonzero' as 'not_applicable'; });
rejected(draft => { draft.analysis.assumptions[2] = 'rayleigh_damped' as 'undamped'; });
rejected(draft => { draft.analysis.assumptions[3] = 'transient' as 'steady_state_harmonic'; });
rejected(draft => { draft.model.domains.push(structuredClone(draft.model.domains[0])); });
rejected(draft => { draft.materials.push(structuredClone(draft.materials[0])); });
rejected(draft => { delete draft.materials[0].densityKgM3; });
rejected(draft => { draft.materials[0].densityKgM3 = -1; });
rejected(draft => { draft.materials[0].model = 'isotropic_elastic_plastic'; });
rejected(draft => { draft.materials[0].thermalConductivityWPerMK = 45; });
rejected(draft => { draft.loads.push(structuredClone(draft.loads[0])); });
rejected(draft => { draft.loads[0] = { ...draft.loads[0], type: 'pressure' } as typeof draft.loads[0]; });
rejected(draft => { if (draft.loads[0].type === 'surface_force') draft.loads[0].forceN = [0, 0, 0]; });
rejected(draft => { draft.constraints = []; });
rejected(draft => { draft.constraints[0] = { ...draft.constraints[0], type: 'prescribed_displacement' } as typeof draft.constraints[0]; });
rejected(draft => { if (draft.constraints[0].type === 'fixed') draft.constraints[0].semanticReferenceIds = ['loaded-face']; });
rejected(draft => { draft.requestedResults = ['displacement_amplitude']; });
rejected(draft => { delete draft.units.time; });

const samples = [.5, .9, 1, 1.1, 1.5].map(ratio => {
  const sample = reference(ratio * naturalFrequencyHz);
  if (ratio !== 1) assert.deepEqual(validateNeutralSimulationRequestV2(makeRequest(sample.frequencyHz)).analysis.settings,
    { frequencyHz: sample.frequencyHz, forcePhaseRad: 0, initialConditions: 'not_applicable' });
  return { frequencyRatio: ratio, ...sample };
});
for (const [ratio, amplitude, phase] of [
  [.5, staticDisplacementMm / .75, 0],
  [.9, staticDisplacementMm / .19, 0],
  [1.1, staticDisplacementMm / .21, Math.PI],
  [1.5, staticDisplacementMm / 1.25, Math.PI],
]) {
  const sample = samples.find(entry => entry.frequencyRatio === ratio)!;
  assert.equal(sample.status, 'finite');
  assert(Math.abs(sample.displacementAmplitudeMm! - amplitude) < 1e-12);
  assert.equal(sample.displacementPhaseLagRad, phase);
  assert(Math.abs(sample.supportReactionAmplitudeN! - stiffnessNPerMm * amplitude) < 1e-8);
  assert.equal(sample.supportReactionPhaseLagRad, phase === 0 ? Math.PI : 0);
}
assert.equal(samples[2].status, 'undamped_resonance_singular');
assert.equal(samples[2].displacementAmplitudeMm, null);
assert(samples[1].displacementAmplitudeMm! > samples[0].displacementAmplitudeMm!);
assert(samples[3].displacementAmplitudeMm! > samples[4].displacementAmplitudeMm!);
console.log(JSON.stringify({ status: 'PASS', fixture: 'SIM-9 harmonic axial SDOF contract',
  scope: 'one undamped linear-elastic solid, one fixed FACE, one cosine-force FACE, one frequency',
  stiffnessNPerMm, generalizedMassKg, naturalFrequencyHz, staticDisplacementMm, samples,
  invalidCasesRejected: 27, providerAdmitted: true, malformedResultRejected: true,
  engineeringUsePermitted: false }, null, 2));

export function makeRequest(frequencyHz: number): HarmonicRequest {
  const now = Date.now();
  return sealNeutralSimulationRequestV2({
    schema: 'tunacad-neutral-simulation-request/2.0', studyId: 'sim9-harmonic-axial-bar',
    name: 'SIM-9 harmonic axial bar', preparedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 20 * 60_000).toISOString(),
    analysis: { type: 'harmonic_response',
      assumptions: ['linear_elasticity', 'small_displacement', 'undamped', 'steady_state_harmonic', 'cosine_force'],
      settings: { frequencyHz, forcePhaseRad: 0, initialConditions: 'not_applicable' } },
    model: { projectRevision: 'sim9-harmonic-r1', coordinateSpace: 'frozen_analysis', domains: [{
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
        resolvedAtProjectRevision: 'sim9-harmonic-r1',
        faceOwnerLocal: { centroidPartLocalMm: [0, 5, 5], areaMm2: 100,
          outwardDirection: [-1, 0, 0], geometryType: 'plane' } },
      { semanticReferenceId: 'loaded-face', domainId: 'bar', ownerPartId: 'bar-part',
        ownerBodyId: 'bar-body', occurrenceId: 'bar-occurrence', geometryKind: 'FACE',
        role: 'load', sourceFeatureId: null, resolutionState: 'valid',
        resolvedAtProjectRevision: 'sim9-harmonic-r1',
        faceOwnerLocal: { centroidPartLocalMm: [100, 5, 5], areaMm2: 100,
          outwardDirection: [1, 0, 0], geometryType: 'plane' } },
    ] },
    units: { geometry: 'mm', force: 'N', stress: 'MPa', displacement: 'mm',
      density: 'kg/m^3', acceleration: 'mm/s^2', time: 's' },
    materials: [{ id: 'steel', name: 'Linear elastic reference', model: 'isotropic_linear_elastic',
      youngsModulusMPa, poissonRatio: .3, densityKgM3,
      source: { kind: 'custom', reference: 'SIM-9 harmonic axial SDOF analytical fixture' } }],
    materialAssignments: [{ assignmentId: 'bar-steel', domainId: 'bar',
      materialId: 'steel', volumeRegionId: 'bar-volume' }],
    loads: [{ id: 'cosine-force', name: 'Axial cosine force amplitude', type: 'surface_force',
      semanticReferenceIds: ['loaded-face'], forceN: [peakForceN, 0, 0], coordinateSystem: 'analysis' }],
    constraints: [{ id: 'fixed-end', name: 'Fixed end', type: 'fixed', semanticReferenceIds: ['fixed-face'] }],
    interactions: [], mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2,
      globalSizeMm: 10, minimumSizeMm: 2.5, maximumNodes: 100_000,
      maximumElements: 50_000, qualityMetric: 'provider_normalized', minimumQuality: .04 },
    requestedResults: ['displacement_amplitude', 'displacement_phase', 'reaction_force_amplitude'],
  }) as HarmonicRequest;
}
