import assert from 'node:assert/strict';
import {
  sealElectrostaticTwoLayer, validateElectrostaticTwoLayer,
  twoLayerSeriesCapacitorReference, type ElectrostaticTwoLayerDraft,
} from '../simulation-bridge/electrostaticTwoLayerFoundation.mts';
import { VACUUM_PERMITTIVITY_F_PER_M } from '../simulation-bridge/electrostaticFoundation.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { validateNeutralSimulationRequestV2 } from '../simulation-bridge/v2Validation.mts';

const surfaceDigest = digest({ declaredInterface: 'x=0.0004, y/z=[0,0.01]' });
const aFaces = { xMin: 'a-x-min', xMax: 'a-x-max', yMin: 'a-y-min',
  yMax: 'a-y-max', zMin: 'a-z-min', zMax: 'a-z-max' };
const bFaces = { xMin: 'b-x-min', xMax: 'b-x-max', yMin: 'b-y-min',
  yMax: 'b-y-max', zMin: 'b-z-min', zMax: 'b-z-max' };
const draft: ElectrostaticTwoLayerDraft = {
  schema: 'tunacad-electrostatic-two-layer-foundation/0.1',
  studyId: 'two-layer-series-capacitor',
  analysis: { type: 'electrostatic', assumptions: [
    'two_linear_isotropic_dielectrics', 'zero_free_volume_and_interface_charge',
    'bounded_domain', 'no_coupling', 'ideal_parallel_plate_no_fringing',
  ] },
  model: {
    projectRevision: 'declared-r1',
    domains: [
      { domainId: 'a', partId: 'part-a', bodyId: 'body-a',
        geometryDigest: digest({ x: [0, 0.0004], y: [0, 0.01], z: [0, 0.01] }),
        shape: { kind: 'origin_aligned_rectangular_dielectric_layer',
          xMinM: 0, xMaxM: 0.0004, widthM: 0.01, heightM: 0.01,
          lengthUnit: 'm', longitudinalAxis: 'x', faces: aFaces,
          interfaceSurfaceDigest: surfaceDigest } },
      { domainId: 'b', partId: 'part-b', bodyId: 'body-b',
        geometryDigest: digest({ x: [0.0004, 0.001], y: [0, 0.01], z: [0, 0.01] }),
        shape: { kind: 'origin_aligned_rectangular_dielectric_layer',
          xMinM: 0.0004, xMaxM: 0.001, widthM: 0.01, heightM: 0.01,
          lengthUnit: 'm', longitudinalAxis: 'x', faces: bFaces,
          interfaceSurfaceDigest: surfaceDigest } },
    ],
    interface: {
      kind: 'declared_conformal_planar_dielectric_interface',
      leftDomainId: 'a', leftFaceId: aFaces.xMax,
      rightDomainId: 'b', rightFaceId: bFaces.xMin,
      planeXM: 0.0004, areaM2: 0.0001, surfaceDigest,
      lengthUnit: 'm', areaUnit: 'm^2', normalFromLeftToRight: [1, 0, 0],
    },
  },
  materials: [
    { materialId: 'mat-a', domainId: 'a', model: 'homogeneous_linear_isotropic_dielectric',
      absolutePermittivityFPerM: 2 * VACUUM_PERMITTIVITY_F_PER_M,
      permittivityUnit: 'F/m',
      source: { kind: 'custom', reference: 'epsilon-r-2', revision: 'r1' } },
    { materialId: 'mat-b', domainId: 'b', model: 'homogeneous_linear_isotropic_dielectric',
      absolutePermittivityFPerM: 6 * VACUUM_PERMITTIVITY_F_PER_M,
      permittivityUnit: 'F/m',
      source: { kind: 'custom', reference: 'epsilon-r-6', revision: 'r1' } },
  ],
  prescribedPotentials: [
    { groupId: 'left', domainId: 'a', faceId: aFaces.xMin,
      kind: 'prescribed_electric_potential', potentialV: 0, unit: 'V' },
    { groupId: 'right', domainId: 'b', faceId: bFaces.xMax,
      kind: 'prescribed_electric_potential', potentialV: 100, unit: 'V' },
  ],
  lateralBoundary: {
    kind: 'zero_normal_electric_displacement',
    faces: [
      ...(['yMin', 'yMax', 'zMin', 'zMax'] as const).map(k => ({ domainId: 'a', faceId: aFaces[k] })),
      ...(['yMin', 'yMax', 'zMin', 'zMax'] as const).map(k => ({ domainId: 'b', faceId: bFaces[k] })),
    ] as ElectrostaticTwoLayerDraft['lateralBoundary']['faces'],
    normalElectricDisplacementCPerM2: 0, unit: 'C/m^2',
  },
  output: {
    axialPositionsM: [0, 0.0002, 0.0004, 0.0007, 0.001],
    units: {
      electricPotential: 'V', electricField: 'V/m',
      electricDisplacement: 'C/m^2', electrodeCharge: 'C',
      capacitance: 'F', electrostaticEnergy: 'J', electrostaticEnergyDensity: 'J/m^3',
    },
  },
};
function near(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) <= Math.max(1e-30, Math.abs(expected) * 1e-12),
    actual + ' differs from ' + expected);
}
const request = sealElectrostaticTwoLayer(draft);
const result = twoLayerSeriesCapacitorReference(request);
assert.deepEqual(validateElectrostaticTwoLayer(request), request);
assert.deepEqual(sealElectrostaticTwoLayer(structuredClone(draft)), request);
assert.deepEqual(twoLayerSeriesCapacitorReference(request), result);
near(result.areaM2, 1e-4);
near(result.layers[0].voltageDropV, 66.66666666666667);
near(result.layers[1].voltageDropV, 33.333333333333336);
near(result.layers[0].electricFieldVPerM[0], -166666.66666666666);
near(result.layers[1].electricFieldVPerM[0], -55555.555555555555);
near(result.layers[0].electricDisplacementCPerM2[0], -2.9513959376e-6);
near(result.layers[1].electricDisplacementCPerM2[0], -2.9513959376e-6);
near(result.interface.electricPotentialV, 66.66666666666667);
assert.equal(result.interface.normalElectricDisplacementJumpCPerM2, 0);
for (const [actual, expected] of result.samples.map(s => s.electricPotentialV)
  .map((v, i) => [v, [0, 33.333333333333336, 66.66666666666667, 83.33333333333334, 100][i]]))
  near(actual, expected);
assert.equal(result.samples[2].domainId, null);
assert.deepEqual(result.samples[2].interfaceFieldLimitsVPerM,
  { left: result.layers[0].electricFieldVPerM, right: result.layers[1].electricFieldVPerM });
near(result.electrodes[0].chargeC, -2.9513959376e-10);
near(result.electrodes[1].chargeC, 2.9513959376e-10);
near(result.capacitanceF, 2.9513959376e-12);
near(result.layers[0].electrostaticEnergyJ, 9.837986458666667e-9);
near(result.layers[1].electrostaticEnergyJ, 4.918993229333333e-9);
near(result.electrostaticEnergyJ, 1.4756979688e-8);
near(result.consistency.capacitanceEnergyJ, result.electrostaticEnergyJ);
near(result.consistency.electrodeEnergyJ, result.electrostaticEnergyJ);
near(result.consistency.summedVoltageDropMinusAppliedV, 0);
assert.equal(result.consistency.netElectrodeChargeC, 0);
assert.equal(result.providerAdmission, 'closed');
assert.equal(result.engineeringUsePermitted, false);
assert.throws(() => validateNeutralSimulationRequestV2(request));
const { referenceDigest, ...unsignedReference } = result;
assert.equal(referenceDigest, digest(unsignedReference));
assert.ok(!JSON.stringify(result).match(/temperature|heat_flux|thermal|stress/));

const shift = structuredClone(draft);
shift.prescribedPotentials[0].potentialV = 500;
shift.prescribedPotentials[1].potentialV = 600;
const shifted = twoLayerSeriesCapacitorReference(sealElectrostaticTwoLayer(shift));
near(shifted.electrostaticEnergyJ, result.electrostaticEnergyJ);
assert.deepEqual(shifted.layers.map(x => x.electricFieldVPerM),
  result.layers.map(x => x.electricFieldVPerM));
const reverse = structuredClone(draft);
reverse.prescribedPotentials[1].potentialV = -100;
const reversed = twoLayerSeriesCapacitorReference(sealElectrostaticTwoLayer(reverse));
near(reversed.electrodes[1].chargeC, -result.electrodes[1].chargeC);
near(reversed.electrostaticEnergyJ, result.electrostaticEnergyJ);

let rejected = 0;
function reject(mutate: (r: any) => void) {
  const changed = structuredClone(draft);
  mutate(changed);
  assert.throws(() => sealElectrostaticTwoLayer(changed));
  rejected++;
}
reject(r => { r.model.domains.pop(); });
reject(r => { r.model.domains.push(structuredClone(r.model.domains[0])); });
reject(r => { r.model.domains[1].shape.xMinM += 0.00001; }); // gap
reject(r => { r.model.domains[1].shape.xMinM -= 0.00001; }); // overlap
reject(r => { r.model.domains[1].shape.widthM += 0.001; });
reject(r => { r.model.interface.areaM2 = 0.0002; });
reject(r => { r.model.interface.planeXM += 0.0001; });
reject(r => { r.model.interface.rightFaceId = r.model.domains[1].shape.yMin; });
reject(r => { r.model.domains[1].shape.interfaceSurfaceDigest = digest('nonconformal'); });
reject(r => { r.model.domains[1].shape.faces.yMax = aFaces.yMax; });
reject(r => { r.model.domains[1].domainId = 'a'; });
reject(r => { r.materials[1].domainId = 'a'; });
reject(r => { r.materials[0].absolutePermittivityFPerM = 0; });
reject(r => { r.materials[0].absolutePermittivityFPerM = Number.NaN; });
reject(r => { r.materials[0].permittivityUnit = 'F/mm'; });
reject(r => { r.materials[0].nonlinearCurve = [[0, 1]]; });
reject(r => { r.prescribedPotentials[0].faceId = aFaces.xMax; });
reject(r => { r.prescribedPotentials[1].groupId = 'left'; });
reject(r => { r.prescribedPotentials[0].unit = 'kV'; });
reject(r => { r.lateralBoundary.faces[0] = r.lateralBoundary.faces[1]; });
reject(r => { r.output.axialPositionsM.splice(2, 1); });
reject(r => { r.output.units.electricField = 'N/C'; });
reject(r => { r.analysis.freeVolumeChargeCPerM3 = 1; });
reject(r => { r.analysis.coupling = 'thermal'; });
reject(r => { r.analysis.dielectricModel = 'nonlinear'; });
reject(r => { r.model.interface.normalFromLeftToRight = [-1, 0, 0]; });
const tampered = structuredClone(request);
tampered.materials[1].absolutePermittivityFPerM *= 2;
assert.throws(() => validateElectrostaticTwoLayer(tampered), /digest mismatch/);
assert.throws(() => validateElectrostaticTwoLayer({ ...request, requestDigest: digest('other') }),
  /digest mismatch/);
console.log(JSON.stringify({
  test: 'SIM-9 two-layer electrostatic contract and analytical foundation',
  rejectedCases: rejected + 2, potentialV: result.samples.map(s => s.electricPotentialV),
  fieldsVPerM: result.layers.map(x => x.electricFieldVPerM[0]),
  capacitanceF: result.capacitanceF, energyJ: result.electrostaticEnergyJ,
  providerAdmission: result.providerAdmission,
}));
