import assert from 'node:assert/strict';
import { test } from 'node:test';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { electricalFieldPage } from '../providers/calculix/CalculiXElectrostaticFields.mts';
import { buildTwoLayerElectricalFields, twoLayerElectricalViewerResult }
  from '../providers/calculix/CalculiXElectrostaticTwoLayerFields.mts';
import { electricalTriangleSchema, loadElectricalDataset } from '../simulation-bridge/electrostaticFields.mts';

const jobId = 'electrical_00000000-0000-4000-8000-000000000001';
const request = { requestDigest: digest('request'), model: {
  domains: [{ domainId: 'layer-a' }, { domainId: 'layer-b' }],
}, materials: [
  { materialId: 'dielectric-a', absolutePermittivityFPerM: 2e-11 },
  { materialId: 'dielectric-b', absolutePermittivityFPerM: 4e-11 },
] } as any;
const nodes = Array.from({ length: 20 }, (_, i) =>
  [i < 10 ? 0 : 0.4, i % 10, 0]);
const model = {
  nodes, volumeElements: { connectivity: [
    Array.from({ length: 10 }, (_, i) => i),
    Array.from({ length: 10 }, (_, i) => i + 10),
  ] },
  domainRegions: [
    { domainId: 'layer-a', elementIndices: [0] },
    { domainId: 'layer-b', elementIndices: [1] },
  ],
  boundaryFacets: { connectivity: [[0, 1, 2, 4, 5, 6], [10, 11, 12, 14, 15, 16]] },
  boundaryRegions: [
    { domainId: 'layer-a', facetIndices: [0] },
    { domainId: 'layer-b', facetIndices: [1] },
  ],
};
const verified = { model, meshDigest: digest('verified-mesh') } as any;
const electricalUnsigned = {
  requestDigest: request.requestDigest, meshDigest: verified.meshDigest,
  domainIds: ['layer-a', 'layer-b'],
  electrodes: [{ faceId: 'left', chargeC: -2e-10 },
    { faceId: 'right', chargeC: 2e-10 }],
  capacitanceF: 2e-12, electrostaticEnergyJ: 1e-8,
  consistency: { interfaceDisplacementJumpCPerM2: 0,
    netElectrodeChargeC: 0 },
  nodalElectricPotential: nodes.map((position, i) => ({
    nodeId: i + 1, positionM: position.map(x => x / 1000),
    domainIds: [i < 10 ? 'layer-a' : 'layer-b'],
    electricPotentialV: i < 10 ? 25 : 75,
  })),
  electricFields: Array.from({ length: 8 }, (_, i) => ({
    elementId: Math.floor(i / 4) + 1, integrationPoint: i % 4 + 1,
    domainId: i < 4 ? 'layer-a' : 'layer-b',
    electricFieldVPerM: [i < 4 ? -100000 : -50000, 0, 0],
    electricDisplacementCPerM2: [-2e-6, 0, 0],
  })),
};
const electrical = { ...electricalUnsigned, resultDigest: digest(electricalUnsigned) };
const completedUnsigned = {
  completedProviderState: 'completed_converged',
  binding: { requestDigest: request.requestDigest,
    fragmentMeshDigest: verified.meshDigest, sourceDigest: digest('canonical-source') },
  normalizedElectricalResultDigest: electrical.resultDigest,
  electrical,
};
const completed = { ...completedUnsigned, resultDigest: digest(completedUnsigned) } as any;

test('two-domain electrical fields retain ownership, units, sampling and page integrity', async () => {
  const fields = buildTwoLayerElectricalFields(jobId, completed, request, verified);
  assert.equal(fields.size, 6);
  const viewer = twoLayerElectricalViewerResult(request, completed, fields);
  assert.equal(viewer.perDomain[0].materialId, 'dielectric-a');
  assert.equal(viewer.perDomain[1].absolutePermittivityFPerM, 4e-11);
  assert.equal(viewer.twoLayerSummary?.capacitanceF, 2e-12);
  assert.equal(viewer.twoLayerSummary?.interfaceNormalDJumpCPerM2, 0);
  const a = fields.get(jobId + ':layer-a:electrostatic:electric_field_magnitude')!;
  const b = fields.get(jobId + ':layer-b:electrostatic:electric_field_magnitude')!;
  assert.equal(a.descriptor.unit, 'V/m');
  assert.equal(a.descriptor.sampling, 'element_average_of_four_integration_points');
  assert.equal(a.descriptor.domainId, 'layer-a');
  assert.equal(b.descriptor.domainId, 'layer-b');
  assert.equal(a.descriptor.valueRange.maximum, 100000);
  assert.equal(b.descriptor.valueRange.maximum, 50000);
  assert.equal(fields.get(jobId + ':layer-a:electrostatic:electric_potential')!.descriptor.unit, 'V');
  assert.equal(fields.get(jobId + ':layer-b:electrostatic:electric_displacement_magnitude')!.descriptor.unit, 'C/m^2');
  const bounded = { ...a.triangles[0], elementIndex: 7999,
    nodeIds: [15998, 15999, 16000] };
  assert.equal(electricalTriangleSchema.parse(bounded).elementIndex, 7999);
  assert.throws(() => electricalTriangleSchema.parse({ ...bounded, elementIndex: 8000 }));
  assert.throws(() => electricalTriangleSchema.parse({ ...bounded,
    nodeIds: [15998, 15999, 16001] }));
  for (const field of fields.values()) {
    const loaded = await loadElectricalDataset(field.descriptor,
      async (cursor, limit) => electricalFieldPage(field, cursor, limit), 2);
    assert.equal(loaded.triangles.length, 4);
    assert.ok(loaded.triangles.every(t => t.elementIndex ===
      (field.descriptor.domainId === 'layer-a' ? 0 : 1)));
  }
  await assert.rejects(() => loadElectricalDataset(a.descriptor,
    async (cursor, limit) => electricalFieldPage(b, cursor, limit), 2));
  await assert.rejects(() => loadElectricalDataset(a.descriptor,
    async (cursor, limit) => {
      const page = electricalFieldPage(a, cursor, limit);
      page.triangles[0].values[0] += 1;
      return page;
    }, 2));
  assert.throws(() => buildTwoLayerElectricalFields(jobId, completed, request,
    { ...verified, meshDigest: digest('substituted') }));
});
