import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { evaluateStationaryModeIReference, stationaryModeIReferenceSchema,
  type StationaryModeIReferenceInput } from '../src/simulation/stationaryModeIReference.ts';

const input: StationaryModeIReferenceInput = {
  schema: 'tunacad-stationary-mode-i-analytical-reference/0.1',
  provenance: { kind: 'user_defined_analytical_geometry', reference: 'Phase 0 center-cracked plate analytical benchmark' },
  geometry: { type: 'center_cracked_through_thickness_plate', fullWidthMm: 100, fullHeightMm: 400,
    thicknessMm: 1, halfCrackLengthMm: 10, centerMm: [0, 0, 0],
    crackDirection: [1, 0, 0], openingNormal: [0, 1, 0], thicknessDirection: [0, 0, 1] },
  material: { model: 'homogeneous_isotropic_linear_elastic', youngsModulusMPa: 210000, poissonRatio: .3,
    provenance: 'Benchmark elastic constants; not a toughness qualification' },
  loading: { type: 'balanced_remote_uniform_tension', nominalGrossStressMPa: 10 },
  assumption: 'thin_plate_plane_stress_reference', units: { length: 'mm', stress: 'MPa', stressIntensity: 'MPa_sqrt_m' },
};
const result = evaluateStationaryModeIReference(input);
assert(Math.abs(result.geometryFactor - 1.0254083207377767) < 1e-12);
assert(Math.abs(result.kiMPaSqrtM - 1.8174889268422305) < 1e-12);
assert.equal(result.remoteForceMagnitudePerEndN, 1000);
assert(Math.abs(result.kiMPaSqrtMm / result.kiMPaSqrtM - Math.sqrt(1000)) < 1e-12);
assert.equal(result.engineeringUsePermitted, false);
assert.equal(result.origin, 'analytical_reference_not_fem');
assert.equal(result.status, 'analytical_checks_passed_fem_unvalidated');
assert.equal(result.toughnessComparison, null);
assert.deepEqual(evaluateStationaryModeIReference(input), result);
assert.notEqual(result.input, input);
const changed = structuredClone(input);
changed.loading.nominalGrossStressMPa = 20;
assert.equal(evaluateStationaryModeIReference(changed).kiMPaSqrtM, result.kiMPaSqrtM * 2);
changed.geometry.centerMm = [10, -20, 30];
changed.geometry.crackDirection = [0, 1, 0]; changed.geometry.openingNormal = [-1, 0, 0];
assert.equal(evaluateStationaryModeIReference(changed).kiMPaSqrtM, result.kiMPaSqrtM * 2);
changed.material.youngsModulusMPa = 70000;
assert.equal(evaluateStationaryModeIReference(changed).kiMPaSqrtM, result.kiMPaSqrtM * 2);

let rejected = 0;
function reject(edit: (draft: any) => void) {
  const draft = structuredClone(input); edit(draft);
  assert.equal(stationaryModeIReferenceSchema.safeParse(draft).success, false);
  assert.throws(() => evaluateStationaryModeIReference(draft)); rejected++;
}
for (const value of [NaN, Infinity, -Infinity, 0, -10, 1e-300, 1001, '10']) reject(d => { d.loading.nominalGrossStressMPa = value; });
for (const key of ['fullWidthMm', 'fullHeightMm', 'thicknessMm', 'halfCrackLengthMm']) {
  for (const value of [NaN, Infinity, 0, -1]) reject(d => { d.geometry[key] = value; });
}
reject(d => { d.geometry.halfCrackLengthMm = 26; });
reject(d => { d.geometry.halfCrackLengthMm = 50; });
reject(d => { d.geometry.fullHeightMm = 399; });
reject(d => { d.geometry.thicknessMm = 2; });
reject(d => { d.geometry.crackDirection = [2, 0, 0]; });
reject(d => { d.geometry.openingNormal = [1, 0, 0]; });
reject(d => { d.geometry.thicknessDirection = [0, 0, -1]; });
reject(d => { d.geometry.centerMm = [0, 0, Infinity]; });
reject(d => { d.material.youngsModulusMPa = 0; });
reject(d => { d.material.poissonRatio = .5; });
reject(d => { d.material.model = 'plastic'; });
reject(d => { d.units.stressIntensity = 'MPa_sqrt_mm'; });
reject(d => { d.assumption = 'plane_strain'; });
reject(d => { d.geometry.crackCount = 2; });
reject(d => { d.loading.shearMPa = 1; });
reject(d => { d.engineeringUsePermitted = true; });
reject(d => { d.provenance.kind = 'verified_native_result'; });
reject(d => { d.approvalToken = 'not-admitted'; });
reject(d => { d.provenance.reference = '\n'; });

const toughness = { valueMPaSqrtM: 50, designation: 'K_IC', materialCondition: 'user supplied', orientation: 'L-T',
  temperatureC: 20, specimenThicknessMm: 25, testMethod: 'user supplied test report', provenance: 'not independently verified' };
const comparison = evaluateStationaryModeIReference({ ...input, toughness }).toughnessComparison!;
assert.equal(comparison.analyticalReferenceRatio, result.kiMPaSqrtM / 50);
assert.equal(comparison.applicability, 'not_established');
assert.equal(comparison.certifiesStructuralSafety, false);
for (const value of [0, -1, 1e-300, NaN, Infinity]) reject(d => { d.toughness = { ...toughness, valueMPaSqrtM: value }; });
reject(d => { d.toughness = { valueMPaSqrtM: 50 }; });
reject(d => { d.toughness = { ...toughness, applicable: true }; });

// The reference cannot prepare a job, access protected evidence or execute tools.
const source = await readFile(new URL('../src/simulation/stationaryModeIReference.ts', import.meta.url), 'utf8');
assert.doesNotMatch(source, /node:|child_process|\bfetch\s*\(|\bspawn\s*\(|\bexec\s*\(/);
assert.deepEqual([...source.matchAll(/^import .* from ['"]([^'"]+)/gm)].map(match => match[1]), ['zod/v4']);
console.log(`PASS: analytical values/units, strict contracts (${rejected} invalid inputs), orientation, provenance, toughness caveats and non-execution boundary. No native tools used.`);
