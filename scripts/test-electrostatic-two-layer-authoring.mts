import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyTwoLayerAuthoring } from '../simulation-bridge/electrostaticTwoLayerAuthoring.mts';

const names = ['xMin', 'xMax', 'yMin', 'yMax', 'zMin', 'zMax'];
const faces = (prefix: string) => Object.fromEntries(names.map(name =>
  [name, prefix + '-' + name]));
const inventory = {
  projectRevision: 'cad-r1',
  domains: [
    { domainId: 'layer-a', partId: 'part-a', bodyId: 'body-a',
      faces: faces('a'), worldMatrix: [] },
    { domainId: 'layer-b', partId: 'part-b', bodyId: 'body-b',
      faces: faces('b'), worldMatrix: [] },
  ],
} as any;
const authoring = {
  schema: 'tunacad-electrostatic-two-layer-authoring/0.1',
  domainIds: ['layer-a', 'layer-b'],
  electrodes: [
    { domainId: 'layer-a', faceId: 'a-xMin', potentialV: 0, unit: 'V' },
    { domainId: 'layer-b', faceId: 'b-xMax', potentialV: 100, unit: 'V' },
  ],
  interfaceFaces: [
    { domainId: 'layer-a', faceId: 'a-xMax' },
    { domainId: 'layer-b', faceId: 'b-xMin' },
  ],
};
const altered = (change: (copy: any) => void) => {
  const copy = structuredClone(authoring); change(copy); return copy;
};

test('exact two-domain electrical choices are live-bound and caller mesh/deck/physics is rejected', () => {
  assert.deepEqual(verifyTwoLayerAuthoring(authoring, inventory), authoring);
  assert.throws(() => verifyTwoLayerAuthoring(
    altered(c => c.domainIds.pop()), inventory));
  assert.throws(() => verifyTwoLayerAuthoring(
    altered(c => c.electrodes[0].faceId = 'stale-face'), inventory));
  assert.throws(() => verifyTwoLayerAuthoring(
    altered(c => c.interfaceFaces[1].faceId = 'stale-interface'), inventory));
  assert.throws(() => verifyTwoLayerAuthoring(
    altered(c => c.electrodes[1].potentialV = c.electrodes[0].potentialV), inventory));
  assert.throws(() => verifyTwoLayerAuthoring(
    altered(c => c.electrodes[1].unit = 'mV'), inventory));
  assert.throws(() => verifyTwoLayerAuthoring(
    altered(c => c.mesh = { claimsConformal: true }), inventory));
  assert.throws(() => verifyTwoLayerAuthoring(
    altered(c => c.providerRequest = {}), inventory));
  assert.throws(() => verifyTwoLayerAuthoring(
    altered(c => c.freeChargeC = 1), inventory));
  assert.throws(() => verifyTwoLayerAuthoring(
    altered(c => c.canonicalDigest = 'sha256:caller'), inventory));
  const stale = structuredClone(inventory);
  stale.domains[1].faces.xMin = 'remapped-interface';
  assert.throws(() => verifyTwoLayerAuthoring(authoring, stale));
  const missing = structuredClone(inventory);
  missing.domains.pop();
  assert.throws(() => verifyTwoLayerAuthoring(authoring, missing));
});
