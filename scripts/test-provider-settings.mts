import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviderSettingsStore, fingerprintConfiguredExecutable,
  providerPathsSchema, resolveConfiguredProviderPaths } from '../simulation-bridge/providerSettings.mts';
import { loadExternalPipeline } from '../simulation-bridge/providers.mts';
import { startSimulationBridge } from '../simulation-bridge/server.mts';

// Fake non-executable bytes in isolated storage only. These are never launched,
// never selected as real configuration, and never written to native app data.
const directory = await mkdtemp(join(tmpdir(), 'tunacad-provider-settings-test-'));
let checks = 0;
const check = (action: () => void) => { action(); checks++; };
try {
  const gmsh = join(directory, 'gmsh.exe'), ccx = join(directory, 'ccx216.exe');
  await writeFile(gmsh, 'non-executable fixture gmsh'); await writeFile(ccx, 'non-executable fixture ccx');
  const paths = { gmshExecutable: gmsh, calculixExecutable: ccx };
  const store = createProviderSettingsStore(join(directory, 'provider-settings.json'));
  check(() => assert.throws(() => providerPathsSchema.parse({ ...paths, gmshExecutable: 'gmsh.exe' })));
  check(() => assert.throws(() => providerPathsSchema.parse({ ...paths, storageRoot: directory })));
  check(() => assert.throws(() => providerPathsSchema.parse({ ...paths, gmshExecutable: ccx })));
  check(() => assert.throws(() => resolveConfiguredProviderPaths(paths, { TUNACAD_GMSH_EXECUTABLE: 'relative' })));
  check(() => assert.deepEqual(resolveConfiguredProviderPaths(paths, {}), paths));
  check(() => assert.deepEqual(resolveConfiguredProviderPaths(paths, { TUNACAD_GMSH_EXECUTABLE: gmsh }), paths));
  check(() => assert.deepEqual(resolveConfiguredProviderPaths(paths, { TUNACAD_GMSH_EXECUTABLE: '' }), paths));
  const absent = await store.read();
  check(() => assert.equal(absent.gmshExecutable, ''));
  await store.save(paths);
  const reopened = await createProviderSettingsStore(store.filePath).read();
  check(() => assert.deepEqual(reopened, paths));
  const original = await readFile(store.filePath, 'utf8');
  const fingerprint = await fingerprintConfiguredExecutable(gmsh);
  check(() => assert.equal(JSON.parse(original).fingerprints.gmsh.sha256, fingerprint.sha256));
  await store.save(paths);
  const repeated = await readFile(store.filePath, 'utf8');
  check(() => assert.equal(repeated, original));
  await writeFile(gmsh, 'changed binary');
  await assert.rejects(store.read, /FINGERPRINT_MISMATCH/); checks++;
  await writeFile(gmsh, 'non-executable fixture gmsh');
  await writeFile(store.filePath, JSON.stringify({ ...JSON.parse(original), extra: true }));
  await assert.rejects(store.read); checks++;
  await writeFile(store.filePath, original);
  await assert.rejects(() => store.save({ ...paths, gmshExecutable: join(directory, 'missing', 'gmsh.exe') })); checks++;
  const afterFailedSave = await readFile(store.filePath, 'utf8');
  check(() => assert.equal(afterFailedSave, original));
  await store.save({ gmshExecutable: gmsh, calculixExecutable: '' });
  const partial = await store.read();
  check(() => assert.deepEqual(partial, { gmshExecutable: gmsh, calculixExecutable: '' }));

  // Empty explicit configuration must not discover/install/probe another binary.
  const pipeline = await loadExternalPipeline('', '', { discovery: false });
  check(() => assert.equal(pipeline.readiness.configuration.discoveryUsed, false));
  check(() => assert.equal(pipeline.readiness.ready, false));
  let saves = 0, probes = 0;
  const origin = 'http://127.0.0.1:8080';
  const bridge = await startSimulationBridge({ ...pipeline, port: 0, allowedOrigin: origin,
    approve: async () => { throw new Error('No approval requested by settings'); },
    saveProviderSettings: async value => { saves++; return store.save(value); },
    configureProviders: async () => { probes++; throw new Error('No execution allowed'); },
  });
  try {
    const post = (route: string, body: unknown, token = '') => fetch(bridge.url + route, { method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify(body) });
    const unauthenticated = await post('/v1/providers/settings', paths);
    check(() => assert.equal(unauthenticated.status, 401));
    const challenge = 'a'.repeat(64);
    const paired = await (await post('/v1/pair', { challenge,
      proof: createHmac('sha256', bridge.pairingCode).update('client:' + challenge).digest('hex') })).json() as any;
    const saved = await post('/v1/providers/settings', paths, paired.sessionToken);
    check(() => assert.equal(saved.status, 200));
    const response = await saved.json() as any;
    check(() => assert.deepEqual(response.paths, paths));
    const persisted = await store.read();
    check(() => assert.deepEqual(persisted, paths));
    const malformed = await post('/v1/providers/settings', { ...paths, storageRoot: directory }, paired.sessionToken);
    check(() => assert.notEqual(malformed.status, 200));
    check(() => assert.equal(saves, 1)); check(() => assert.equal(probes, 0));
  } finally { await bridge.close(); }
  console.log(JSON.stringify({ pass: true, checks, providerExecutions: 0,
    nativeSettingsModified: false, scope: 'explicit paths, save/reload/fingerprints, authenticated save-only route' }));
} finally {
  // Exact mkdtemp directory only; never application data or a simulation store.
  assert.equal(directory.startsWith(join(tmpdir(), 'tunacad-provider-settings-test-')), true);
  await rm(directory, { recursive: true, force: true });
}
