import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startSimulationBridge } from '../simulation-bridge/server.mts';
import { LocalSimulationBridgeProvider } from '../../../src/simulation/localSimulationBridgeProvider.ts';
import { slabRequest } from './sim9-electrostatic-fixture.mts';

const hash = (digit: string) => 'sha256:' + digit.repeat(64);
const approval = {
  schema: 'tunacad-electrostatic-two-layer-approval/0.1' as const,
  studyId: 'two-layer-controlled', projectRevision: 'cad-r1', sourceEpoch: 3,
  sessionBinding: hash('1'), sourceDigest: hash('2'), requestDigest: hash('3'),
  preparationReceiptDigest: hash('4'),
  domains: [
    { domainId: 'a', bodyId: 'body-a', materialId: 'material-a',
      absolutePermittivityFPerM: 2e-11, permittivityUnit: 'F/m' as const,
      provenance: { kind: 'custom' as const, reference: 'mat-a', revision: 'r1' } },
    { domainId: 'b', bodyId: 'body-b', materialId: 'material-b',
      absolutePermittivityFPerM: 5e-11, permittivityUnit: 'F/m' as const,
      provenance: { kind: 'custom' as const, reference: 'mat-b', revision: 'r1' } },
  ] as any,
  electrodes: [
    { domainId: 'a', faceId: 'a-xMin', potentialV: 0, unit: 'V' as const },
    { domainId: 'b', faceId: 'b-xMax', potentialV: 100, unit: 'V' as const },
  ] as any,
  interfaceFaces: ['a-xMax', 'b-xMin'] as [string, string],
  mesh: { digest: hash('5'), nodes: 2956, elements: 1641,
    sharedNodes: 533, matchedFacets: 246, interfaceAreaMm2: 100 },
};

test('local Bridge terminal authorization is exact-scope, single-use and never a provider job', async () => {
  let clockOffset = 0;
  let decide: ((yes: boolean) => void) | null = null;
  let shown: any = null;
  const bridge = await startSimulationBridge({ port: 0, provider: null,
    providerElectrical: { submit() { throw new Error('SOLVER_MUST_NOT_RUN'); } } as any,
    allowedOrigin: 'http://localhost:8080', now: () => Date.now() + clockOffset,
    readiness: { ready: false, provider: null, electrostatic: {} as any,
      meshing: { ready: true, adapterVersion: 'test', runtimeVersion: '4.15.2',
        geometryFormats: ['step'], elementFamilies: ['tetrahedral'] },
      solving: { ready: true, adapterVersion: 'test', runtimeVersion: '2.16',
        analysisTypes: ['electrostatic'] } },
    approve: async (request, signal) => { shown = request;
      return new Promise<boolean>(resolve => { decide = resolve;
        signal.addEventListener('abort', () => resolve(false), { once: true }); }); },
  });
  const originFetch: typeof fetch = (input, init) => fetch(input, { ...init,
    headers: { ...Object.fromEntries(new Headers(init?.headers)),
      Origin: 'http://localhost:8080' } });
  const raw = (path: string, method: string, body: unknown, token: string) =>
    originFetch(bridge.url + path, { method,
      headers: { Authorization: 'Bearer ' + token,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    const paired = await LocalSimulationBridgeProvider.pair(
      bridge.pairingCode, bridge.url, originFetch);
    const probe = await raw('/v1/two-layer/authorizations', 'POST',
      { ...approval, freeChargeC: 1 },
      // Pairing's client keeps the token private; a wrong token must fail
      // even before the strict unsupported-physics schema is evaluated.
      '0'.repeat(64));
    assert.equal(probe.status, 401);
    const pending = paired.twoLayerAuthorization.authorize(approval);
    for (let i = 0; !decide && i < 100; i++)
      await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(decide, 'separate terminal callback reached');
    assert.equal(shown.schema, approval.schema);
    assert.equal(shown.studyId, approval.studyId);
    assert.equal(shown.preparationReceiptDigest, approval.preparationReceiptDigest);
    decide!(true);
    const grant = await pending;
    assert.equal((await raw('/v1/two-layer/authorizations', 'POST',
      { ...approval, freeChargeC: 1 }, grant.bridgeSessionToken)).status, 400,
      'unsupported electrical physics rejected before terminal approval');
    const path = '/v1/two-layer/authorizations/' + grant.authorizationId + '/consume';
    assert.equal((await raw('/v1/authorizations/' + grant.authorizationId,
      'GET', undefined, grant.bridgeSessionToken)).status, 404,
      'single-domain authorization URL cannot inspect a two-layer grant');
    assert.equal((await raw('/v1/jobs', 'POST', {}, grant.bridgeSessionToken)).status, 403,
      'approval cannot authorize generic provider jobs');
    assert.equal((await raw(path, 'POST', { ...approval, studyId: 'other-study' },
      grant.bridgeSessionToken)).status, 403);
    const accepted = await raw(path, 'POST', approval, grant.bridgeSessionToken);
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).state, 'used');
    assert.equal((await raw(path, 'POST', approval, grant.bridgeSessionToken)).status, 403,
      'single-use approval');
    assert.equal((await raw('/v1/authorizations', 'POST', approval,
      grant.bridgeSessionToken)).status, 400,
      'two-layer descriptor cannot enter single-domain/general approval');
    const single = await raw('/v1/authorizations', 'POST', {
      schema: 'tunacad-electrostatic-authorization/0.1',
      preparationId: 'simprep_electrical-00000000-0000-4000-8000-000000000001',
      request: slabRequest(),
    }, grant.bridgeSessionToken);
    assert.equal(single.status, 202);
    const singleId = (await single.json()).authorizationId;
    assert.equal((await raw('/v1/two-layer/authorizations/' + singleId + '/consume',
      'POST', approval, grant.bridgeSessionToken)).status, 404,
      'single-domain approval cannot authorize the two-layer route');
    decide!(false);
    await new Promise(resolve => setTimeout(resolve, 0));
    const second = paired.twoLayerAuthorization.authorize({ ...approval,
      studyId: 'two-layer-expiring' });
    for (let i = 0; shown?.studyId !== 'two-layer-expiring' && i < 100; i++)
      await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(shown?.studyId, 'two-layer-expiring');
    decide!(true);
    const expiredGrant = await second;
    clockOffset = 3 * 60_000;
    assert.equal((await raw('/v1/two-layer/authorizations/' +
      expiredGrant.authorizationId + '/consume', 'POST',
      { ...approval, studyId: 'two-layer-expiring' },
      expiredGrant.bridgeSessionToken)).status, 403);
  } finally { await bridge.close(); }
});
