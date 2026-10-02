import assert from 'node:assert/strict';
import { CalculiXMultiDomainSolverProvider } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { explicitAxialBarReference, sealExplicitDynamics,
  validateExplicitDynamics, type ExplicitDynamicsDraft }
  from '../simulation-bridge/explicitDynamicsFoundation.mts';
import { validateNeutralSimulationRequestV2 } from '../simulation-bridge/v2Validation.mts';

const E = 200_000, density = 7800, length = 100, area = 100, force = 100;
const stiffness = E * area / length;
const massNs2PerMm = density * area * length * 1e-9 / 3000;
const omega = Math.sqrt(stiffness / massNs2PerMm);
const period = 2 * Math.PI / omega;
const axialWave = 1000 * Math.sqrt(E * 1e6 / density);
const pWave = axialWave * Math.sqrt((1 - 0.3) / ((1 + 0.3) * (1 - 0.6)));
const stableLimit = 0.8 * 5 / pWave;
const draft: ExplicitDynamicsDraft = {
  schema: 'tunacad-explicit-dynamics-foundation/0.1', studyId: 'explicit-axial-bar',
  analysis: {
    type: 'explicit_structural_dynamics',
    assumptions: ['one_linear_elastic_solid', 'small_displacement',
      'zero_initial_conditions', 'undamped', 'no_contact', 'no_mass_scaling'],
    durationS: period, outputTimesS: [period / 4, period / 2, period],
    integration: { kind: 'central_difference_cfl_bound',
      minimumCharacteristicLengthMm: 5, safetyFactor: 0.8,
      maximumTimeStepS: stableLimit / 2, maximumIncrements: 1000 },
  },
  model: { projectRevision: 'bar-r1', domainId: 'bar', partId: 'bar-part',
    bodyId: 'bar-body', geometryDigest: 'sha256:' + '1'.repeat(64),
    kind: 'straight_rectangular_axial_bar', lengthMm: length,
    widthMm: 10, heightMm: 10, fixedFaceId: 'x-min', loadedFaceId: 'x-max' },
  material: { materialId: 'steel', domainId: 'bar',
    model: 'isotropic_linear_elastic', youngsModulusMPa: E,
    poissonRatio: 0.3, densityKgM3: density,
    source: { kind: 'custom', reference: 'analytical bar', revision: 'r1' } },
  initialConditions: { displacementMm: [0, 0, 0], velocityMmPerS: [0, 0, 0] },
  restraint: { kind: 'fixed_face', faceId: 'x-min', displacementMm: [0, 0, 0] },
  load: { kind: 'axial_step_face_force', faceId: 'x-max', onsetS: 0,
    forceN: [force, 0, 0], coordinateSystem: 'analysis',
    history: 'constant_after_onset' },
  mesh: { elementFormulation: 'C3D4', maximumNodes: 100_000,
    maximumElements: 50_000 },
  requestedResults: ['loaded_face_axial_displacement_history',
    'fixed_face_axial_reaction_history', 'kinetic_energy_history',
    'strain_energy_history', 'applied_work_history'],
  units: { length: 'mm', time: 's', force: 'N', stress: 'MPa',
    density: 'kg/m^3', velocity: 'mm/s', acceleration: 'mm/s^2',
    energy: 'N*mm' },
};
const request = sealExplicitDynamics(draft);
assert.deepEqual(validateExplicitDynamics(request), request);
assert.deepEqual(sealExplicitDynamics(structuredClone(draft)), request);
assert.throws(() => validateExplicitDynamics({ ...request, material:
  { ...request.material, densityKgM3: 8000 } }));
const provider = new CalculiXMultiDomainSolverProvider({
  executable: 'C:\\controlled\\ccx216.exe', runtimeVersion: '2.16',
});
assert.equal(provider.capabilities.analysisTypes.includes(
  'explicit_structural_dynamics' as never), false);
assert.throws(() => validateNeutralSimulationRequestV2(request));

function rejects(mutator: (value: any) => void) {
  const changed = structuredClone(draft);
  mutator(changed);
  assert.throws(() => sealExplicitDynamics(changed));
}
rejects(r => { r.analysis.assumptions[4] = 'contact'; });
rejects(r => { r.analysis.contact = true; });
rejects(r => { r.material.model = 'elastic_plastic'; });
rejects(r => { r.analysis.massScaling = 2; });
rejects(r => { r.initialConditions.velocityMmPerS = [1, 0, 0]; });
rejects(r => { r.analysis.assumptions[1] = 'large_deformation'; });
rejects(r => { r.analysis.damping = { ratio: 0.02 }; });
rejects(r => { r.mesh.elementFormulation = 'C3D10'; });
rejects(r => { r.model.domains = [{}, {}]; });
rejects(r => { r.material.densityKgM3 = 0; });
rejects(r => { r.material.domainId = 'other'; });
rejects(r => { r.load.faceId = r.restraint.faceId; });
rejects(r => { r.load.forceN = [100, 1, 0]; });
rejects(r => { r.load.history = 'impact_pulse'; });
rejects(r => { r.load.onsetS = 0.1; });
rejects(r => { r.analysis.outputTimesS = [period / 2, period / 4, period]; });
rejects(r => { r.analysis.outputTimesS = [period / 4, period / 2]; });
rejects(r => { r.analysis.outputTimesS = Array.from({ length: 17 },
  (_, i) => period * (i + 1) / 17); });
rejects(r => { r.analysis.integration.maximumTimeStepS = stableLimit * 1.01; });
rejects(r => { r.analysis.integration.maximumIncrements = 10; });
rejects(r => { r.analysis.integration.safetyFactor = 1; });
rejects(r => { r.units.energy = 'J'; });
rejects(r => { r.requestedResults = ['displacement']; });

const reference = explicitAxialBarReference(request);
const near = (actual: number, expected: number, tolerance: number) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, String(actual) + ' versus ' + String(expected));
near(reference.axialWaveSpeedMmPerS, axialWave, 1e-9);
near(reference.axialTransitTimeS, length / axialWave, 1e-15);
near(reference.stableTimeStepLimitS, stableLimit, 1e-15);
near(reference.staticDisplacementMm, 0.0005, 1e-15);
near(reference.periodS, 71.63933479e-6, 1e-13);
const [quarter, half, full] = reference.samples;
near(quarter.displacementMm, 0.0005, 1e-15);
near(quarter.supportReactionN, -100, 1e-10);
near(quarter.kineticEnergyNmm, 0.025, 1e-12);
near(quarter.strainEnergyNmm, 0.025, 1e-12);
near(half.displacementMm, 0.001, 1e-15);
near(half.supportReactionN, -200, 1e-10);
near(half.kineticEnergyNmm, 0, 1e-12);
near(half.strainEnergyNmm, 0.1, 1e-12);
near(full.displacementMm, 0, 1e-12);
reference.samples.forEach(sample => {
  near(sample.forceBalanceResidualN, 0, 1e-9);
  near(sample.workEnergyResidualNmm, 0, 1e-12);
});
assert.equal(reference.providerAdmission, 'closed');
assert.equal(reference.engineeringUsePermitted, false);
assert.deepEqual(explicitAxialBarReference(request), reference);
console.log(JSON.stringify({ status: 'PASS', fixture: 'SIM-9 explicit axial bar foundation',
  waveSpeedMmPerS: reference.axialWaveSpeedMmPerS,
  transitTimeS: reference.axialTransitTimeS, stableTimeStepLimitS: stableLimit,
  periodS: reference.periodS, samples: reference.samples,
  providerAdmission: reference.providerAdmission }, null, 2));
