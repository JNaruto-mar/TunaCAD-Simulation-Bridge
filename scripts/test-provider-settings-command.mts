import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviderSettingsStore } from '../simulation-bridge/providerSettings.mts';
import { parseProviderSettingsArguments, runProviderSettingsCommand } from '../simulation-bridge/providerSettingsCommand.mts';

const root = await mkdtemp(join(tmpdir(), 'tunacad-settings-command-test-'));
let checks = 0, opens = 0;
try {
  const gmsh = join(root, 'gmsh.exe'), ccx = join(root, 'ccx216.exe'), file = join(root, 'provider-settings.json');
  await writeFile(gmsh, 'non-executable test file'); await writeFile(ccx, 'non-executable ccx test file');
  const openOwner = async () => { opens++; return createProviderSettingsStore(file); };
  for (const args of [[], ['--gmsh'], ['--discover'], ['--root', root], ['--gmsh', gmsh, '--gmsh', gmsh],
    ['--gmsh', 'relative'], ['--show', '--gmsh', gmsh], ['--gmsh', ccx]]) {
    assert.throws(() => parseProviderSettingsArguments(args)); checks++;
  }
  await assert.rejects(() => runProviderSettingsCommand(['--discover'], openOwner));
  assert.equal(opens, 0); checks++;
  // Preserve the other explicit provider when saving just Gmsh.
  await (await openOwner()).save({ gmshExecutable: '', calculixExecutable: ccx });
  const saved = await runProviderSettingsCommand(['--gmsh', gmsh], openOwner);
  assert.equal(opens, 3); checks++;
  assert.equal(saved.state, 'GMSH_PATH_CONFIGURED_VERIFIED'); checks++;
  assert.deepEqual(saved.paths, { gmshExecutable: gmsh, calculixExecutable: ccx }); checks++;
  assert.equal(saved.freshNativeReaderVerified, true); checks++;
  const record = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(record.fingerprints.gmsh.sha256, saved.gmsh!.sha256); checks++;
  assert.equal(record.fingerprints.gmsh.size, saved.gmsh!.size); checks++;
  const shown = await runProviderSettingsCommand(['--show'], openOwner);
  assert.deepEqual(shown, saved); checks++;
  await writeFile(gmsh, 'altered binary');
  await assert.rejects(() => runProviderSettingsCommand(['--show'], openOwner), /FINGERPRINT_MISMATCH/); checks++;
  console.log(JSON.stringify({ pass: true, checks, providerExecutions: 0, nativeSettingsModified: false }));
} finally {
  assert.equal(root.startsWith(join(tmpdir(), 'tunacad-settings-command-test-')), true);
  await rm(root, { recursive: true, force: true });
}
