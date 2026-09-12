import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCalculiXInputDeckV2 } from '../providers/calculix/CalculiXMultiDomainDeck.mts';
import { parseCalculiXNonlinearDatV2, parseCalculiXNonlinearStaV2 } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { admitV2SimulationRequest, sealNeutralSimulationRequestV2, validateNeutralSimulationRequestV2 } from '../simulation-bridge/v2Validation.mts';
import type { NeutralFemModelV2, NeutralSimulationRequestV2, NeutralVector3 } from '../src/simulation/externalSimulationContracts.ts';

const midpoint = (a: NeutralVector3, b: NeutralVector3): NeutralVector3 => [0, 1, 2].map(axis => (a[axis] + b[axis]) / 2) as NeutralVector3;
const corners: [NeutralVector3, NeutralVector3, NeutralVector3, NeutralVector3] = [[0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10]];
const nodes = [...corners, midpoint(corners[0], corners[1]), midpoint(corners[1], corners[2]), midpoint(corners[2], corners[0]), midpoint(corners[0], corners[3]), midpoint(corners[2], corners[3]), midpoint(corners[1], corners[3])];
const revision = 'sim7a-contract-r1';
const face = (centroidPartLocalMm: NeutralVector3, outwardDirection: NeutralVector3) => ({ centroidPartLocalMm, areaMm2: 50, outwardDirection, geometryType: 'plane', edgeCount: 3 });

const request = sealNeutralSimulationRequestV2({
  schema: 'tunacad-neutral-simulation-request/2.0', studyId: 'sim7a-contract', name: 'SIM-7A geometric nonlinear contract',
  preparedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
  analysis: {
    type: 'nonlinear_static', assumptions: ['finite_deformation', 'finite_strain', 'quasi_static', 'isotropic_linear_elastic'],
    settings: {
      steps: [
        { id: 'half-load', name: 'Ramp to half load', duration: 1, loadAmplitudes: [{ loadId: 'tip-load', interpolation: 'piecewise_linear', points: [{ time: 0, scaleFactor: 0 }, { time: 1, scaleFactor: 0.5 }] }] },
        { id: 'full-load', name: 'Ramp to full load', duration: 2, loadAmplitudes: [{ loadId: 'tip-load', interpolation: 'piecewise_linear', points: [{ time: 0, scaleFactor: 0.5 }, { time: 0.5, scaleFactor: 0.75 }, { time: 1, scaleFactor: 1 }] }] },
      ],
      initialIncrement: 0.1, minimumIncrement: 0.001, maximumIncrement: 0.25, maximumIncrements: 100,
      maximumIterations: 24, cutbackFactor: 0.25, maximumCutbacks: 6,
    },
  },
  model: {
    projectRevision: revision, coordinateSpace: 'frozen_analysis',
    domains: [{
      domainId: 'beam', partId: 'beam-part', bodyId: 'beam-body', occurrenceId: 'beam:1', geometryDigest: digest({ tetra: true }),
      transformToAnalysis: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      shape: { valid: true, connectedSolidCount: 1, faceCount: 4, edgeCount: 6, volumeMm3: 1000 / 6, surfaceAreaMm2: 236.60254, boundingBoxOwnerLocalMm: { min: [0, 0, 0], max: [10, 10, 10], size: [10, 10, 10] } },
    }],
    references: [
      { semanticReferenceId: 'fixed-face', domainId: 'beam', ownerPartId: 'beam-part', ownerBodyId: 'beam-body', occurrenceId: 'beam:1', geometryKind: 'FACE', role: 'constraint', sourceFeatureId: 'tetra', resolutionState: 'valid', resolvedAtProjectRevision: revision, faceOwnerLocal: face([0, 10 / 3, 10 / 3], [-1, 0, 0]) },
      { semanticReferenceId: 'load-face', domainId: 'beam', ownerPartId: 'beam-part', ownerBodyId: 'beam-body', occurrenceId: 'beam:1', geometryKind: 'FACE', role: 'load', sourceFeatureId: 'tetra', resolutionState: 'valid', resolvedAtProjectRevision: revision, faceOwnerLocal: face([10 / 3, 10 / 3, 10 / 3], [1, 1, 1]) },
    ],
  },
  units: { geometry: 'mm', force: 'N', stress: 'MPa', displacement: 'mm', density: 'kg/m^3', acceleration: 'mm/s^2' },
  materials: [{ id: 'steel', name: 'Steel', model: 'isotropic_linear_elastic', youngsModulusMPa: 210000, poissonRatio: 0.3, source: { kind: 'custom', reference: 'SIM-7A fixture' } }],
  materialAssignments: [{ assignmentId: 'beam-steel', domainId: 'beam', materialId: 'steel', volumeRegionId: 'beam-volume' }],
  loads: [{ id: 'tip-load', name: 'Tip load', type: 'surface_force', semanticReferenceIds: ['load-face'], forceN: [0, 0, -100], coordinateSystem: 'analysis' }],
  constraints: [{ id: 'fixed-support', name: 'Fixed support', type: 'fixed', semanticReferenceIds: ['fixed-face'] }],
  interactions: [], mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2, globalSizeMm: 2, maximumNodes: 10000, maximumElements: 5000, qualityMetric: 'provider_normalized', minimumQuality: 0.04 },
  requestedResults: ['von_mises_stress', 'displacement', 'reaction_force', 'load_displacement_history', 'increment_convergence'],
});

const model: NeutralFemModelV2 = {
  schema: 'tunacad-neutral-fem-model/2.0', modelId: 'sim7a-model', requestDigest: request.requestDigest, projectRevision: revision,
  modelDigest: request.model.modelDigest, coordinateSpace: 'frozen_analysis', units: 'mm', element: { family: 'tetrahedral', geometryOrder: 2, solutionOrder: 2 }, nodes,
  volumeElements: { connectivity: [Array.from({ length: 10 }, (_, index) => index)], domainIds: ['beam'], materialIds: ['steel'], volumeRegionIds: ['beam-volume'] },
  boundaryFacets: { connectivity: [[0, 2, 3, 6, 8, 7], [1, 3, 2, 9, 8, 5]], domainIds: ['beam', 'beam'], regionIds: ['fixed-region', 'load-region'] },
  domainRegions: [{ domainId: 'beam', partId: 'beam-part', bodyId: 'beam-body', occurrenceId: 'beam:1', domainDigest: request.model.domains[0].domainDigest, geometryDigest: request.model.domains[0].geometryDigest, materialId: 'steel', volumeRegionId: 'beam-volume', transformToAnalysis: request.model.domains[0].transformToAnalysis, elementIndices: [0], nodeIndices: Array.from({ length: 10 }, (_, index) => index) }],
  boundaryRegions: [
    { regionId: 'fixed-region', domainId: 'beam', semanticReferenceIds: ['fixed-face'], sourceFeatureIds: ['tetra'], facetIndices: [0], matchedCadFaceOwnerLocal: request.model.references[0].faceOwnerLocal, match: { state: 'verified', method: 'geometric_signature', candidateCount: 1, centroidToleranceMm: 0.01, areaRelativeTolerance: 0.01 } },
    { regionId: 'load-region', domainId: 'beam', semanticReferenceIds: ['load-face'], sourceFeatureIds: ['tetra'], facetIndices: [1], matchedCadFaceOwnerLocal: request.model.references[1].faceOwnerLocal, match: { state: 'verified', method: 'geometric_signature', candidateCount: 1, centroidToleranceMm: 0.01, areaRelativeTolerance: 0.01 } },
  ],
  quality: { metric: 'mean_ratio', minimum: 0.5, average: 0.7, invalidElementCount: 0, nodeCount: 10, elementCount: 1, boundaryFacetCount: 2, cadVolumeMm3: 1000 / 6, meshVolumeMm3: 1000 / 6, volumeRelativeError: 0, perDomain: [{ domainId: 'beam', nodeCount: 10, elementCount: 1, cadVolumeMm3: 1000 / 6, meshVolumeMm3: 1000 / 6, volumeRelativeError: 0, minimum: 0.5, average: 0.7, invalidElementCount: 0 }] },
  provenance: { meshProviderInterfaceVersion: '2.0', adapterId: 'fixture', adapterVersion: '1', engine: 'synthetic', engineVersion: '1', optionsDigest: digest({ size: 2 }), inputGeometryDigest: request.model.modelDigest, generatedAt: new Date().toISOString() },
};

assert.deepEqual(validateNeutralSimulationRequestV2(request), request);
const capabilities: any = {
  interfaceVersion: '2.0', analysisTypes: ['nonlinear_static'], normalizedResults: true, asynchronous: true, cancellation: true,
  fieldResults: { paginated: true, maximumPageTriangles: 128, components: ['displacement_magnitude', 'von_mises_stress'], topology: 'triangle_soup' },
  study: {
    multiDomain: true, perDomainMaterials: true, rigidOccurrenceTransforms: true, maximumDomains: 16, maximumOccurrences: 16, maximumParts: 16, maximumBodies: 16,
    maximumMaterials: 16, maximumReferenceBindings: 512, materialModels: ['isotropic_linear_elastic'], loadTypes: ['surface_force'], maximumLoads: 64, maximumReferencesPerLoad: 32,
    constraintTypes: ['fixed'], maximumConstraints: 64, maximumReferencesPerConstraint: 32, contactModes: ['none'], interactionTypes: [], maximumInteractions: 32, maximumReferencesPerInteractionSide: 32,
    nonlinearStatic: { maximumDomains: 1, maximumSteps: 8, maximumAmplitudePoints: 32, amplitudeModes: ['shared_shape_per_step'], loadTypes: ['surface_force'], constraintTypes: ['fixed'], geometricNonlinearity: true, materialModels: ['isotropic_linear_elastic'], materialNonlinearity: false, hardeningModels: [], plasticStrainResults: false, energyResults: false, automaticIncrements: true, incrementHistory: true, loadDisplacementHistory: true },
  },
};
assert.deepEqual(admitV2SimulationRequest(request, capabilities), { accepted: true });
const deck = createCalculiXInputDeckV2(request, model);
assert.equal((deck.match(/^\*STEP, NLGEOM, INC=100$/gm) ?? []).length, 2);
assert.match(deck, /\*AMPLITUDE, NAME=NL_AMPLITUDE_001, TIME=STEP TIME\n0,0,1,0\.5/);
assert.match(deck, /\*CONTROLS, PARAMETERS=TIME INCREMENTATION\n4,8,9,24,10,4,,6,,\n0\.25,0\.25,0\.75,0\.85,,,1\.5,/);
assert.match(deck, /\*CLOAD, OP=NEW, AMPLITUDE=NL_AMPLITUDE_002/);

const plasticSource: any = structuredClone(request);
plasticSource.studyId = 'sim7b-contract'; plasticSource.name = 'SIM-7B isotropic hardening contract';
plasticSource.analysis.assumptions[3] = 'isotropic_elastic_plastic';
plasticSource.materials[0] = {
  ...plasticSource.materials[0], model: 'isotropic_elastic_plastic', yieldStrengthMPa: 250,
  plasticity: { hardening: 'isotropic', curve: [
    { trueStressMPa: 250, plasticStrain: 0 }, { trueStressMPa: 300, plasticStrain: 0.02 }, { trueStressMPa: 340, plasticStrain: 0.08 },
  ] },
};
plasticSource.requestedResults.push('equivalent_plastic_strain', 'strain_energy_density', 'internal_energy');
delete plasticSource.requestDigest; delete plasticSource.model.modelDigest; plasticSource.model.domains.forEach((domain: any) => delete domain.domainDigest);
const plasticRequest = sealNeutralSimulationRequestV2(plasticSource);
assert.deepEqual(validateNeutralSimulationRequestV2(plasticRequest), plasticRequest);
const plasticCapabilities: any = structuredClone(capabilities);
plasticCapabilities.study.materialModels.push('isotropic_elastic_plastic');
plasticCapabilities.study.nonlinearStatic.materialModels.push('isotropic_elastic_plastic');
plasticCapabilities.study.nonlinearStatic.materialNonlinearity = true;
plasticCapabilities.study.nonlinearStatic.hardeningModels = ['isotropic'];
plasticCapabilities.study.nonlinearStatic.plasticStrainResults = true;
plasticCapabilities.study.nonlinearStatic.energyResults = true;
plasticCapabilities.fieldResults.components.push('equivalent_plastic_strain', 'strain_energy_density');
assert.deepEqual(admitV2SimulationRequest(plasticRequest, plasticCapabilities), { accepted: true });
assert.equal(admitV2SimulationRequest(plasticRequest, capabilities).accepted, false, 'Plasticity must fail provider admission when material nonlinearity is not declared.');
const plasticDeck = createCalculiXInputDeckV2(plasticRequest, { ...model, requestDigest: plasticRequest.requestDigest });
assert.match(plasticDeck, /TunaCAD SIM-7B material-nonlinear static/);
assert.match(plasticDeck, /\*PLASTIC, HARDENING=ISOTROPIC\n250,0\n300,0\.02\n340,0\.08/);
assert.equal((plasticDeck.match(/^\*EL PRINT, ELSET=EALL, FREQUENCY=1\nPEEQ$/gm) ?? []).length, 2);
assert.equal((plasticDeck.match(/^\*EL PRINT, ELSET=EALL, FREQUENCY=1\nENER$/gm) ?? []).length, 2);
assert.equal((plasticDeck.match(/^\*EL PRINT, ELSET=EALL, TOTALS=ONLY, FREQUENCY=1\nELSE$/gm) ?? []).length, 2);
const cyclicSource: any = structuredClone(plasticRequest);
cyclicSource.studyId = 'sim7b-load-unload-reload-contract'; cyclicSource.name = 'SIM-7B two-step material path contract';
cyclicSource.analysis.settings.steps = [
  { id: 'plastic-loading', name: 'Load beyond yield', duration: 1, loadAmplitudes: [{ loadId: 'tip-load', interpolation: 'piecewise_linear', points: [{ time: 0, scaleFactor: 0 }, { time: 1, scaleFactor: 1 }] }] },
  { id: 'unload-reload', name: 'Unload and reload', duration: 1, loadAmplitudes: [{ loadId: 'tip-load', interpolation: 'piecewise_linear', points: [{ time: 0, scaleFactor: 1 }, { time: .5, scaleFactor: 0 }, { time: 1, scaleFactor: 1 }] }] },
];
delete cyclicSource.requestDigest; delete cyclicSource.model.modelDigest; cyclicSource.model.domains.forEach((domain: any) => delete domain.domainDigest);
const cyclicRequest = sealNeutralSimulationRequestV2(cyclicSource);
assert.deepEqual(validateNeutralSimulationRequestV2(cyclicRequest), cyclicRequest);
assert.deepEqual(admitV2SimulationRequest(cyclicRequest, plasticCapabilities), { accepted: true });
const cyclicDeck = createCalculiXInputDeckV2(cyclicRequest, { ...model, requestDigest: cyclicRequest.requestDigest });
assert.match(cyclicDeck, /\*AMPLITUDE, NAME=NL_AMPLITUDE_002, TIME=STEP TIME\n0,1,0\.5,0,1,1/);
const invalidPlastic: any = structuredClone(plasticRequest);
invalidPlastic.materials[0].plasticity.curve[1].plasticStrain = 0;
delete invalidPlastic.requestDigest; delete invalidPlastic.model.modelDigest; invalidPlastic.model.domains.forEach((domain: any) => delete domain.domainDigest);
assert.throws(() => validateNeutralSimulationRequestV2(sealNeutralSimulationRequestV2(invalidPlastic)), /BRIDGE_V2_MATERIAL_INVALID/);

const status = parseCalculiXNonlinearStaV2([
  '1 1 1 4 0.5 0.5 0.5', '1 2 1 3 1.0 1.0 0.5',
  '2 1 1 5 2.0 1.0 1.0', '2 2 2 8 3.0 2.0 1.0',
].join('\n'), [1, 2]);
assert.deepEqual(status.map(step => step.increments.length), [2, 2]);
assert.equal(status[1].increments[1].attempt, 2);

const frame = (time: number, displacement: number, reaction: number) => [
  ` displacements (vx,vy,vz) for set NALL and time ${time}`,
  ` 1 ${displacement} 0 0`,
  ' forces (fx,fy,fz) for set REACTION_001 and time ' + time,
  ` 1 ${reaction} 0 0`,
  ' stresses (elem, integ.pnt.,sxx,syy,szz,sxy,sxz,syz) for set EALL and time ' + time,
  ' 1 1 10 0 0 0 0 0',
].join('\n');
const frames = parseCalculiXNonlinearDatV2(`${frame(0.5, 0.1, -50)}\n${frame(1, 0.2, -100)}\n`, model, ['REACTION_001']);
assert.equal(frames.length, 2); assert.equal(frames[1].byDomain.get('beam')?.maximumDisplacementMm, 0.2); assert.deepEqual(frames[1].reactions.REACTION_001, [-100, 0, 0]);
const materialFrame = parseCalculiXNonlinearDatV2(`${frame(1, 0.3, -100)}\n equivalent plastic strain (elem, integ.pnt.,peeq) for set EALL and time 1\n 1 1 0.0125\n internal energy density (elem, integ.pnt.,ener) for set EALL and time 1\n 1 1 3.25\n total internal energy for set EALL and time 1\n 42.5\n\n`, model, ['REACTION_001'])[0];
assert.equal(materialFrame.equivalentPlasticStrainByElement.get(0), 0.0125);
assert.equal(materialFrame.energyDensityByElement.get(0), 3.25);
assert.equal(materialFrame.totalInternalEnergyNmm, 42.5, 'Blank records must not overwrite a scalar CalculiX total.');

const malformed: any = structuredClone(request); malformed.analysis.settings.steps[0].loadAmplitudes[0].points[1].time = 0;
delete malformed.requestDigest; delete malformed.model.modelDigest; malformed.model.domains.forEach((domain: any) => delete domain.domainDigest);
assert.throws(() => validateNeutralSimulationRequestV2(sealNeutralSimulationRequestV2(malformed)), /BRIDGE_V2_NONLINEAR_REQUEST_INVALID/);
const distinctAmplitude: any = structuredClone(request);
distinctAmplitude.model.references.push({ ...distinctAmplitude.model.references.find((entry: any) => entry.semanticReferenceId === 'load-face'), semanticReferenceId: 'load-face-2' });
distinctAmplitude.loads.push({ ...distinctAmplitude.loads[0], id: 'tip-load-2', name: 'Second tip load', semanticReferenceIds: ['load-face-2'], forceN: [0, -50, 0] });
for (const step of distinctAmplitude.analysis.settings.steps) step.loadAmplitudes.push({
  loadId: 'tip-load-2', interpolation: 'piecewise_linear', points: [{ time: 0, scaleFactor: 0 }, { time: 1, scaleFactor: step.id === 'half-load' ? 0.25 : 0.75 }],
});
delete distinctAmplitude.requestDigest; delete distinctAmplitude.model.modelDigest; distinctAmplitude.model.domains.forEach((domain: any) => delete domain.domainDigest);
const sealedDistinctAmplitude = sealNeutralSimulationRequestV2(distinctAmplitude);
assert.deepEqual(validateNeutralSimulationRequestV2(sealedDistinctAmplitude), sealedDistinctAmplitude);
assert.equal(admitV2SimulationRequest(sealedDistinctAmplitude, capabilities).accepted, false, 'Distinct per-load amplitude shapes must fail provider admission before geometry transfer.');
const matrix = JSON.parse(readFileSync(new URL('../qualification/sim7a-windows-gmsh-4.15.2-calculix-2.16.json', import.meta.url), 'utf8'));
assert.equal(matrix.matrixId, 'sim7a-windows-x64-gmsh-4.15.2-calculix-2.16');
assert.deepEqual(matrix.lanes.filter((lane: any) => lane.state === 'pending').map((lane: any) => lane.id), ['independent-engineering-review']);
console.log('SIM-7A/B nonlinear contract, capability admission, deterministic NLGEOM/isotropic-hardening decks, controls, amplitudes, and bounded history parsers passed.');
