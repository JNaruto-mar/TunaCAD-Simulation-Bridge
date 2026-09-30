import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TwoLayerElectrostaticLifecycle } from '../simulation-bridge/electrostaticTwoLayerAdmission.mts';

test('queued cancellation cannot inspect or dispatch the two-layer source', async () => {
  let sourceReads = 0, dispatches = 0;
  const unavailable = async () => { sourceReads++; throw new Error('unexpected source read'); };
  const reader = {
    cad: {} as any, records: {} as any,
    readSealedRequest: unavailable, readLocalMeshes: unavailable,
    readCurrentRuntimeIdentity: unavailable, meshSizeMm: 2,
  } as any;
  const driver = { async execute() { dispatches++; throw new Error('unexpected dispatch'); } };
  const storage = { async assertReady() { throw new Error('storage not needed for queued cancellation'); } } as any;
  const lifecycle = new TwoLayerElectrostaticLifecycle(reader, driver, storage);
  const queued = lifecycle.submit('two-layer-cancel-before-dispatch');
  assert.equal(queued.state, 'queued');
  assert.equal(await lifecycle.getResult(queued.jobId), null);
  const cancelled = await lifecycle.cancel(queued.jobId);
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(cancelled.cleanupConfirmed, true);
  assert.equal(await lifecycle.getResult(queued.jobId), null);
  assert.equal(sourceReads, 0);
  assert.equal(dispatches, 0);
});
