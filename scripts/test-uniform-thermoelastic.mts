import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { uniformThermoelasticFixture, uniformThermoelasticBenchmark as b } from './fixtures/uniformThermoelasticFixture.mts';
import { reseal } from './fixtures/centrifugalStaticFixture.mts';
import { createCalculiXInputDeckV2 } from '../providers/calculix/CalculiXMultiDomainDeck.mts';
import { CalculiXMultiDomainSolverProvider, parseCalculiXDatV2, normalizeLinearStaticResult } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { validateNeutralSimulationRequestV2, validateNeutralFemModelV2, admitV2SimulationRequest,
  validateNeutralSimulationResultV2, validateNeutralSimulationFieldPageV2 } from '../simulation-bridge/v2Validation.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { createNeutralMeshJobRequestV2 } from '../src/simulation/multiDomainFemModel.ts';

const caps = new CalculiXMultiDomainSolverProvider({ executable: resolve('ccx-fixture.exe'), runtimeVersion: '2.16' }).capabilities;
for (const final of [100, -60]) {
  const { request, model } = uniformThermoelasticFixture(final);
  validateNeutralSimulationRequestV2(request); validateNeutralFemModelV2(model, request);
  assert.equal(admitV2SimulationRequest(request, caps).accepted, true);
  const old = structuredClone(caps); old.study.loadTypes = old.study.loadTypes.filter(type => type !== 'uniform_temperature_change');
  assert.equal(admitV2SimulationRequest(request, old).accepted, false);
  const meshing = createNeutralMeshJobRequestV2(request);
  assert.equal(meshing.boundaryRegions.length, 1);
  assert.equal(meshing.boundaryRegions[0].semanticReferenceId, 'fixed');
  const deck = createCalculiXInputDeckV2(request, model);
  assert.match(deck, /\*EXPANSION, ZERO=20\n0\.000012/);
  assert.match(deck, /\*INITIAL CONDITIONS, TYPE=TEMPERATURE\nNALL,20/);
  assert.match(deck, new RegExp('\\*STEP\\n\\*STATIC[\\s\\S]*\\*TEMPERATURE\\nNALL,' + final));
  assert.equal((deck.match(/^\*TEMPERATURE$/gm) ?? []).length, 1);
  assert.doesNotMatch(deck, /\*HEAT TRANSFER|\*COUPLED|\*CLOAD|\*DLOAD|NLGEOM/);
  assert.equal(deck, createCalculiXInputDeckV2(request, model));
  const fixed = [0, 2, 3, 6, 8, 7], sign = Math.sign(final - 20);
  // Deliberately synthetic parser fields: numerical physics awaits authorization.
  const dat = ['displacements for set NALL and time 1',
    ...model.nodes.map((_, node) => `${node + 1} ${fixed.includes(node) ? '0' : sign * .001} 0 0`),
    'stresses for set EALL and time 1', '1 1 10 0 0 0 0 0',
    'total force for set REACTION_001 and time 1', '0 0 0'].join('\n');
  const run: any = { request, model, providerRunId: 'synthetic-thermal-parser', submittedAt: request.preparedAt };
  const parse = (text: string) => parseCalculiXDatV2(text, model, ['REACTION_001']);
  const normalize = (text: string) => normalizeLinearStaticResult(run, parse(text), 'unit', '1', '2.16');
  const normalized = normalize(dat);
  validateNeutralSimulationResultV2(normalized.result, request);
  assert.equal(normalized.result.review.engineeringUsePermitted, false);
  assert(normalized.result.warnings.some(w => w.code === 'SIMULATION_THERMOELASTIC_PREVIEW'));
  assert.equal(normalized.datasets.size, 2);
  assert.equal(normalized.result.reactions[0].forceN[0], 0);
  for (const { descriptor, triangles } of normalized.datasets.values()) {
    assert(['mm', 'MPa'].includes(descriptor.unit)); assert.equal(triangles.length, 16);
    assert.equal(descriptor.datasetDigest, digest(triangles));
    const page = { schema: 'tunacad-neutral-simulation-field-page/2.0', dataset: descriptor, cursor: '0', nextCursor: null,
      triangleOffset: 0, triangleCount: triangles.length, chunkDigest: digest(triangles), triangles };
    validateNeutralSimulationFieldPageV2(page);
    const corrupt = structuredClone(page); corrupt.triangles[0].values[0] = NaN;
    assert.throws(() => validateNeutralSimulationFieldPageV2(corrupt));
  }
  assert.throws(() => normalize(dat.replace(`2 ${sign * .001} 0 0`, '')), /complete|node/);
  assert.throws(() => normalize(dat.replace('1 0 0 0', '1 .001 0 0')), /stationary/);
  assert.throws(() => normalize(dat.replace('1 1 10 0 0 0 0 0', '')), /complete|stress|element/);
  assert.throws(() => normalize(dat.replace('1 1 10 0 0 0 0 0', '1 1 NaN 0 0 0 0 0')));
  assert.throws(() => normalize(dat.replace('0 0 0', 'NaN 0 0')));
  assert.throws(() => normalize(dat.replace(/0 0 0$/, '1 0 0')), /equilibrium/);
  const zeroStress = normalize(dat.replace('1 1 10 0 0 0 0 0', '1 1 0 0 0 0 0 0'));
  validateNeutralSimulationResultV2(zeroStress.result, request);
  assert.equal(zeroStress.result.metrics.minimumFactorOfSafety, null);
}
const { request, model } = uniformThermoelasticFixture();
const invalid = [
  (r: any) => { delete r.materials[0].thermalExpansionPerK; },
  ...[0, -1, NaN, Infinity, .01001, .001].map(alpha => (r: any) => { r.materials[0].thermalExpansionPerK = alpha; }),
  ...[20, -274, 1001, Infinity, NaN].map(t => (r: any) => { r.loads[0].finalTemperatureC = t; }),
  (r: any) => { r.loads[0].referenceTemperatureC = -100; r.loads[0].finalTemperatureC = 1000; },
  (r: any) => { r.analysis.type = 'modal'; }, (r: any) => { r.model.domains.push(r.model.domains[0]); },
  (r: any) => { r.materials[0].youngsModulusMPa = 1e6 + 1; },
  (r: any) => { r.loads.push({ ...r.loads[0], id: 'second' }); },
  (r: any) => { r.loads[0].temperatureField = [20, 80]; },
  (r: any) => { r.constraints = []; }, (r: any) => { r.constraints[0].semanticReferenceIds = ['missing']; },
  (r: any) => { r.model.references[0].resolutionState = 'stale'; },
  (r: any) => { r.constraints[0].type = 'prescribed_temperature'; r.constraints[0].temperatureC = 20; },
  (r: any) => { r.mesh.maximumNodes = 100001; }, (r: any) => { r.mesh.maximumElements = 50001; },
  (r: any) => { delete r.units.temperature; },
];
for (const change of invalid) { const bad = structuredClone(request); change(bad); assert.throws(() => validateNeutralSimulationRequestV2(reseal(bad))); }
const tampered = structuredClone(request); if (tampered.loads[0].type === 'uniform_temperature_change') tampered.loads[0].finalTemperatureC++;
assert.throws(() => validateNeutralSimulationRequestV2(tampered), /DIGEST/);
const wrongMapping = structuredClone(model); wrongMapping.boundaryRegions[0].semanticReferenceIds = ['missing'];
assert.throws(() => createCalculiXInputDeckV2(request, wrongMapping));
// Independent constitutive references; these checks do not claim an FE solve.
const strain = b.material.thermalExpansionPerK * (b.finalTemperatureC - b.referenceTemperatureC);
assert.equal(strain, .00096);
assert(Math.abs(strain * b.geometryMm.length - .096) < 1e-15);
assert(Math.abs(-b.material.youngsModulusMPa * strain + 201.6) < 1e-12);
assert(Math.abs(-b.material.youngsModulusMPa * strain / (1 - 2 * b.material.poissonRatio) + 504) < 1e-12);
console.log('PASS uniform thermoelastic: heating/cooling, source-bound contract/admission, C3D10 deck, parser, complete fields/digests, zero-stress safety-factor handling, fixed FACE and equilibrium rejection, analytical references; nativeRuns=0.');
