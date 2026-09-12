import assert from 'node:assert/strict';
import { loadExternalPipeline } from '../simulation-bridge/providers.mts';
import { GmshMeshProvider } from '../providers/gmsh/GmshMeshProvider.mts';
import { CalculiXSolverProvider } from '../providers/calculix/CalculiXSolverProvider.mts';
import { ComposedSimulationProvider } from '../providers/ComposedSimulationProvider.mts';

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (!gmsh || !calculix) throw new Error('Set TUNACAD_GMSH_EXECUTABLE and TUNACAD_CALCULIX_EXECUTABLE to absolute executable paths.');

const pipeline = await loadExternalPipeline(gmsh, calculix);
assert.equal(pipeline.readiness.ready, true);
assert.ok(pipeline.providerV2);
assert.equal(pipeline.readiness.providerV2?.capabilities.interfaceVersion, '2.0');
assert.equal(pipeline.providerV2?.capabilities.study.maximumDomains, 16);
assert.equal(pipeline.providerV2?.capabilities.study.perDomainMaterials, true);
assert.deepEqual(pipeline.providerV2?.capabilities.study.interactionTypes, ['bonded_tie', 'shared_topology', 'rigid_connector', 'frictionless_contact', 'frictional_contact']);
assert.equal(pipeline.providerV2?.capabilities.fieldResults.paginated, true);
assert.deepEqual(pipeline.providerV2?.capabilities.analysisTypes, ['linear_static', 'modal', 'linear_buckling', 'static_contact', 'nonlinear_static']);
assert.deepEqual(pipeline.providerV2?.capabilities.study.modal, { maximumModes: 24, frequencyBounds: true, massFormulations: ['consistent'], constrainedOnly: false, maximumFreeFreeDomains: 1 });
assert.ok(pipeline.providerV2?.capabilities.fieldResults.components.includes('mode_shape_magnitude'));
assert.deepEqual(pipeline.providerV2?.capabilities.study.buckling, { maximumModes: 12, maximumDomains: 1, preloadCaseRequired: true, loadTypes: ['surface_force'], constraintTypes: ['fixed'] });
assert.ok(pipeline.providerV2?.capabilities.fieldResults.components.includes('buckling_mode_shape_magnitude'));
assert.ok(pipeline.providerV2?.capabilities.fieldResults.components.includes('contact_pressure'));
assert.ok(pipeline.providerV2?.capabilities.fieldResults.components.includes('normal_gap'));
assert.ok(pipeline.providerV2?.capabilities.fieldResults.components.includes('tangential_slip'));
assert.ok(pipeline.providerV2?.capabilities.fieldResults.components.includes('contact_shear'));
assert.ok(pipeline.providerV2?.capabilities.fieldResults.components.includes('equivalent_plastic_strain'));
assert.ok(pipeline.providerV2?.capabilities.fieldResults.components.includes('strain_energy_density'));
assert.deepEqual(pipeline.providerV2?.capabilities.study.contact?.tangentialBehaviors, ['frictionless', 'coulomb_penalty']);
assert.deepEqual(pipeline.providerV2?.capabilities.study.contact?.sliding, ['small', 'finite']);
assert.equal(pipeline.providerV2?.capabilities.study.contact?.nonlinearIncrementReporting, true);
assert.deepEqual(pipeline.providerV2?.capabilities.study.contact?.initialAdjustments, ['none', 'bounded_to_contact']);
assert.deepEqual(pipeline.providerV2?.capabilities.study.nonlinearStatic, { maximumDomains: 1, maximumSteps: 8, maximumAmplitudePoints: 32, amplitudeModes: ['shared_shape_per_step'], loadTypes: ['surface_force', 'pressure', 'gravity'], constraintTypes: ['fixed'], geometricNonlinearity: true, materialModels: ['isotropic_linear_elastic', 'isotropic_elastic_plastic'], materialNonlinearity: true, hardeningModels: ['isotropic'], plasticStrainResults: true, energyResults: true, automaticIncrements: true, incrementHistory: true, loadDisplacementHistory: true });
assert.equal(pipeline.providerV2?.capabilities.qualification.evidence, null, 'Composed v2 evidence remains null until the Gmsh and CalculiX adapters share one reviewed umbrella matrix.');
assert.deepEqual(pipeline.provider?.capabilities.study.loadTypes, ['surface_force', 'pressure', 'gravity']);
assert.equal(pipeline.provider?.capabilities.study.maximumLoads, 64);
assert.deepEqual(pipeline.provider?.capabilities.study.constraintTypes, ['fixed', 'prescribed_displacement']);
assert.equal(pipeline.provider?.capabilities.study.maximumConstraints, 64);
const quotaSupportedHost = process.platform === 'win32' && process.arch === 'x64';
assert.equal(pipeline.provider?.capabilities.qualification.status, quotaSupportedHost ? 'proof_of_concept' : 'unsupported');
assert.equal(pipeline.provider?.capabilities.qualification.engineeringUsePermitted, false);
if (quotaSupportedHost && Number.parseInt(process.versions.node.split('.')[0] ?? '', 10) === 24) {
  assert.deepEqual(pipeline.provider?.capabilities.qualification.evidence?.pendingLaneIds, ['independent-engineering-review']);
} else {
  assert.equal(pipeline.provider?.capabilities.qualification.evidence, null);
}
assert.equal(pipeline.provider?.capabilities.execution.resourceLimits?.maximumInputGeometryBytes, 32 * 1024 * 1024);
assert.equal(pipeline.provider?.capabilities.execution.resourceLimits?.cpuTimeLimitMs, quotaSupportedHost ? 120_000 : null);
assert.equal(pipeline.provider?.capabilities.execution.resourceLimits?.memoryLimitBytes, quotaSupportedHost ? 1024 * 1024 * 1024 : null);
const outsideRecordedMatrix = new ComposedSimulationProvider({
  id: 'outside-matrix', version: 'test',
  meshProvider: new GmshMeshProvider({ executable: gmsh, runtimeVersion: '4.15.1' }),
  solverProvider: new CalculiXSolverProvider({ executable: calculix, runtimeVersion: '2.15' }),
});
assert.equal(outsideRecordedMatrix.capabilities.qualification.status, quotaSupportedHost ? 'proof_of_concept' : 'unsupported');
assert.equal(outsideRecordedMatrix.capabilities.qualification.evidence, null, 'Unrecorded provider versions must not inherit qualification evidence.');

console.log(JSON.stringify({
  ready: pipeline.readiness.ready,
  v2Ready: Boolean(pipeline.providerV2),
  gmsh: { ready: pipeline.readiness.meshing.ready, version: pipeline.readiness.meshing.runtimeVersion },
  calculix: { ready: pipeline.readiness.solving.ready, version: pipeline.readiness.solving.runtimeVersion },
  qualification: pipeline.provider?.capabilities.qualification,
  admission: pipeline.provider?.capabilities.study,
  resourceLimits: pipeline.provider?.capabilities.execution.resourceLimits,
}, null, 2));
