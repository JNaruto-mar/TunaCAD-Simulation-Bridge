import assert from 'node:assert/strict';
import {
  VACUUM_PERMITTIVITY_F_PER_M, parallelPlateElectrostaticReference,
  sealElectrostaticFoundation, validateElectrostaticFoundation,
  type ElectrostaticFoundationDraft,
} from '../simulation-bridge/electrostaticFoundation.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { validateNeutralSimulationRequestV2, validateNeutralSimulationResultV2 } from '../simulation-bridge/v2Validation.mts';
import { CalculiXMultiDomainSolverProvider } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { createCalculiXInputDeckV2 } from '../providers/calculix/CalculiXMultiDomainDeck.mts';

const draft: ElectrostaticFoundationDraft = {
  schema: 'tunacad-electrostatic-foundation/0.1', studyId: 'dielectric-slab-reference',
  analysis: {
    type: 'electrostatic', assumptions: [
      'homogeneous_linear_isotropic_dielectric', 'zero_free_volume_charge',
      'bounded_domain', 'no_coupling', 'ideal_parallel_plate_no_fringing',
    ],
  },
  model: {
    projectRevision: 'declared-slab-r1',
    domains: [{
      domainId: 'dielectric', partId: 'slab-part', bodyId: 'slab-body',
      geometryDigest: digest({ declaredDimensionsM: [0.001, 0.01, 0.01] }),
      shape: {
        kind: 'ideal_parallel_plate_slab', lengthM: 0.001, widthM: 0.01, heightM: 0.01,
        lengthUnit: 'm', longitudinalAxis: 'x',
        faces: { xMin: 'face-left', xMax: 'face-right', yMin: 'face-bottom',
          yMax: 'face-top', zMin: 'face-back', zMax: 'face-front' },
      },
    }],
  },
  material: {
    materialId: 'linear-dielectric', domainId: 'dielectric',
    model: 'homogeneous_linear_isotropic_dielectric',
    absolutePermittivityFPerM: 4 * VACUUM_PERMITTIVITY_F_PER_M,
    permittivityUnit: 'F/m',
    source: { kind: 'custom', reference: 'analytical epsilon_r=4; not certified', revision: 'r1' },
  },
  prescribedPotentials: [
    { groupId: 'left-electrode', domainId: 'dielectric', faceIds: ['face-left'],
      kind: 'prescribed_electric_potential', potentialV: 0, unit: 'V' },
    { groupId: 'right-electrode', domainId: 'dielectric', faceIds: ['face-right'],
      kind: 'prescribed_electric_potential', potentialV: 100, unit: 'V' },
  ],
  lateralBoundary: {
    kind: 'zero_normal_electric_displacement', appliesTo: 'all_four_lateral_faces',
    normalElectricDisplacementCPerM2: 0, unit: 'C/m^2',
  },
  output: {
    normalizedAxialPositions: [0, 0.25, 0.5, 0.75, 1],
    units: { electricPotential: 'V', electricField: 'V/m',
      electricDisplacement: 'C/m^2', electrodeCharge: 'C', capacitance: 'F',
      electrostaticEnergy: 'J', electrostaticEnergyDensity: 'J/m^3' },
  },
};
const request = sealElectrostaticFoundation(draft);
const reference = parallelPlateElectrostaticReference(request);
function near(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) <= Math.max(Math.abs(expected) * 1e-12, 1e-30),
    actual + ' differs from ' + expected);
}
assert.deepEqual(validateElectrostaticFoundation(request), request);
assert.deepEqual(sealElectrostaticFoundation(structuredClone(draft)), request);
const reordered = structuredClone(draft);
reordered.prescribedPotentials.reverse();
assert.deepEqual(sealElectrostaticFoundation(reordered), request);
assert.deepEqual(parallelPlateElectrostaticReference(request), reference);
assert.deepEqual(reference.samples.map(item => item.electricPotentialV), [0, 25, 50, 75, 100]);
assert.deepEqual(reference.samples.map(item => item.xM), [0, 0.00025, 0.0005, 0.00075, 0.001]);
for (const sample of reference.samples) {
  near(sample.electricFieldVPerM[0], -100_000);
  near(sample.electricDisplacementCPerM2[0], -3.54167512512e-6);
  near(sample.electrostaticEnergyDensityJPerM3, 0.177083756256);
  assert.deepEqual(sample.electricFieldVPerM.slice(1), [0, 0]);
}
near(reference.areaM2, 1e-4);
near(reference.volumeM3, 1e-7);
near(reference.capacitanceF, 3.54167512512e-12);
near(reference.electrodes[0].chargeC, -3.54167512512e-10);
near(reference.electrodes[1].chargeC, 3.54167512512e-10);
near(reference.electrostaticEnergyJ, 1.77083756256e-8);
near(reference.consistency.capacitanceEnergyJ, reference.electrostaticEnergyJ);
near(reference.consistency.electrodeEnergyJ, reference.electrostaticEnergyJ);
assert.equal(reference.consistency.netElectrodeChargeC, 0);
const { referenceDigest, ...unsignedReference } = reference;
assert.equal(referenceDigest, digest(unsignedReference));
assert.equal(reference.providerAdmission, 'closed');
assert.equal(reference.engineeringUsePermitted, false);
assert.equal(reference.authority, 'analytical_reference_only');
assert.ok(!JSON.stringify(reference).match(/temperature|heat_flux|thermal|stress|displacement_magnitude/));

// Gauge offset does not change physical fields, charges, capacitance or energy.
const offset = structuredClone(draft);
offset.prescribedPotentials[0].potentialV = 500;
offset.prescribedPotentials[1].potentialV = 600;
const shifted = parallelPlateElectrostaticReference(sealElectrostaticFoundation(offset));
near(shifted.electrostaticEnergyJ, reference.electrostaticEnergyJ);
near(shifted.consistency.electrodeEnergyJ, reference.electrostaticEnergyJ);
assert.deepEqual(shifted.samples[0].electricFieldVPerM, reference.samples[0].electricFieldVPerM);
assert.deepEqual(shifted.electrodes.map(item => item.chargeC), reference.electrodes.map(item => item.chargeC));
near(shifted.capacitanceF, reference.capacitanceF);
const reverse = structuredClone(draft);
reverse.prescribedPotentials[1].potentialV = -100;
const reversed = parallelPlateElectrostaticReference(sealElectrostaticFoundation(reverse));
near(reversed.samples[2].electricFieldVPerM[0], 100_000);
near(reversed.electrodes[1].chargeC, -reference.electrodes[1].chargeC);
near(reversed.electrostaticEnergyJ, reference.electrostaticEnergyJ);
const zero = structuredClone(draft);
zero.prescribedPotentials[1].potentialV = 0;
const unexcited = parallelPlateElectrostaticReference(sealElectrostaticFoundation(zero));
assert.equal(unexcited.electrostaticEnergyJ, 0);
assert.equal(Math.abs(unexcited.electrodes[0].chargeC), 0);
near(unexcited.capacitanceF, reference.capacitanceF);
const doubledPermittivity = structuredClone(draft);
doubledPermittivity.material.absolutePermittivityFPerM *= 2;
const doubled = parallelPlateElectrostaticReference(sealElectrostaticFoundation(doubledPermittivity));
near(doubled.capacitanceF, 2 * reference.capacitanceF);
near(doubled.electrodes[1].chargeC, 2 * reference.electrodes[1].chargeC);
near(doubled.electrostaticEnergyJ, 2 * reference.electrostaticEnergyJ);
const maximumSamples = structuredClone(draft);
maximumSamples.output.normalizedAxialPositions = Array.from({ length: 65 }, (_, i) => i / 64);
assert.equal(parallelPlateElectrostaticReference(sealElectrostaticFoundation(maximumSamples)).samples.length, 65);

let rejected = 0;
function reject(label: string, mutation: (value: any) => void) {
  const invalid = structuredClone(draft);
  mutation(invalid);
  assert.throws(() => sealElectrostaticFoundation(invalid), undefined, label);
  rejected++;
}
reject('bad potential units', x => x.prescribedPotentials[0].unit = 'mV');
reject('relative permittivity not absolute', x => x.material.permittivityUnit = 'dimensionless');
reject('bad field units', x => x.output.units.electricField = 'N');
reject('bad displacement units', x => x.output.units.electricDisplacement = 'C');
reject('bad charge units', x => x.output.units.electrodeCharge = 'A');
reject('bad capacitance units', x => x.output.units.capacitance = 'pF');
reject('bad energy units', x => x.output.units.electrostaticEnergy = 'N*mm');
reject('CAD mm silently interpreted as metres', x => x.model.domains[0].shape.lengthUnit = 'mm');
for (const value of [0, -1, NaN, Infinity, 1e-16, 1]) {
  reject('invalid/bounded permittivity ' + value, x => x.material.absolutePermittivityFPerM = value);
}
reject('missing permittivity', x => delete x.material.absolutePermittivityFPerM);
reject('nonlinear dielectric', x => x.material.model = 'nonlinear_dielectric');
reject('anisotropic tensor', x => x.material.permittivityTensor = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
reject('temperature dependency', x => x.material.temperatureCurve = []);
reject('unversioned material', x => x.material.source.revision = '');
reject('two domains', x => x.model.domains.push(structuredClone(x.model.domains[0])));
reject('no domain', x => x.model.domains = []);
reject('material domain mismatch', x => x.material.domainId = 'another');
reject('electrode domain mismatch', x => x.prescribedPotentials[0].domainId = 'another');
reject('duplicate groups', x => x.prescribedPotentials[1].groupId = x.prescribedPotentials[0].groupId);
reject('conflicting same face', x => x.prescribedPotentials[1].faceIds = ['face-left']);
reject('duplicate electrode face list', x => x.prescribedPotentials[0].faceIds.push('face-left'));
reject('multiple faces per electrode unsupported', x => x.prescribedPotentials[0].faceIds.push('extra-face'));
reject('lateral electrode', x => x.prescribedPotentials[1].faceIds = ['face-top']);
reject('unmatched face', x => x.prescribedPotentials[0].faceIds = ['unknown']);
reject('duplicate geometry face aliases', x => x.model.domains[0].shape.faces.yMin = 'face-left');
reject('missing geometry face', x => delete x.model.domains[0].shape.faces.zMax);
reject('missing electrode', x => x.prescribedPotentials.pop());
reject('third potential group', x => x.prescribedPotentials.push(structuredClone(x.prescribedPotentials[1])));
reject('nonfinite voltage', x => x.prescribedPotentials[0].potentialV = Infinity);
reject('excess voltage', x => x.prescribedPotentials[0].potentialV = 1_000_001);
reject('zero thickness', x => x.model.domains[0].shape.lengthM = 0);
reject('unbounded geometry', x => x.model.domains[0].shape.widthM = 101);
reject('nonfinite geometry', x => x.model.domains[0].shape.heightM = NaN);
reject('geometry hash missing', x => x.model.domains[0].geometryDigest = 'unsealed');
reject('free volume charge', x => x.freeVolumeChargeCPerM3 = 1);
reject('unsupported electrode charge input', x => x.prescribedPotentials[0].chargeC = 1);
reject('open domain', x => x.analysis.assumptions[2] = 'open_domain');
reject('coupling', x => x.coupling = { structural: true });
reject('thermal terminology', x => x.material.thermalConductivity = 1);
reject('fringing', x => x.analysis.assumptions[4] = 'with_fringing');
reject('non-insulated sides', x => x.lateralBoundary.normalElectricDisplacementCPerM2 = 1);
reject('wrong insulation semantics', x => x.lateralBoundary.kind = 'fixed_potential');
reject('unordered samples', x => x.output.normalizedAxialPositions = [0, 0.75, 0.25, 1]);
reject('duplicate samples', x => x.output.normalizedAxialPositions = [0, 0.5, 0.5, 1]);
reject('incomplete interval', x => x.output.normalizedAxialPositions = [0.1, 1]);
reject('extrapolation', x => x.output.normalizedAxialPositions = [0, 1.1]);
reject('too few samples', x => x.output.normalizedAxialPositions = [0]);
reject('unbounded samples', x => x.output.normalizedAxialPositions = Array.from({ length: 66 }, (_, i) => i / 65));
reject('transient input', x => x.output.outputTimesSeconds = [0, 1]);
reject('unknown request keys', x => x.extra = true);
const tampered = structuredClone(request);
tampered.prescribedPotentials[1].potentialV = 101;
assert.throws(() => validateElectrostaticFoundation(tampered), /digest mismatch/);
assert.throws(() => parallelPlateElectrostaticReference(tampered), /digest mismatch/);
const badDigest = structuredClone(request);
badDigest.requestDigest = 'sha256:' + '0'.repeat(64);
assert.throws(() => validateElectrostaticFoundation(badDigest), /digest mismatch/);
rejected += 3;

// Focused fail-closed guards only: constructing capabilities does not run ccx.
const provider = new CalculiXMultiDomainSolverProvider({
  executable: 'C:\\fixture-not-launched\\ccx216.exe', runtimeVersion: '2.16',
});
assert.ok(!(provider.capabilities.analysisTypes as readonly string[]).includes('electrostatic'));
assert.throws(() => validateNeutralSimulationRequestV2(request));
assert.throws(() => createCalculiXInputDeckV2(request as never, {} as never));
assert.throws(() => validateNeutralSimulationRequestV2(reference));
assert.throws(() => validateNeutralSimulationResultV2(reference, request as never));
console.log(JSON.stringify({
  status: 'PASS', scope: 'electrostatic_contract_and_analytical_reference_only',
  rejectedCases: rejected, providerAdmission: 'closed', solverExecutions: 0,
  capacitanceF: reference.capacitanceF, fieldX_VPerM: reference.samples[0].electricFieldVPerM[0],
  positiveElectrodeChargeC: reference.electrodes[1].chargeC,
  electrostaticEnergyJ: reference.electrostaticEnergyJ,
}));
