import { openNativeProviderSettings, fingerprintConfiguredExecutable, providerPathsSchema }
  from './providerSettings.mts';

export function parseProviderSettingsArguments(args: string[]) {
  if (args.length === 1 && args[0] === '--show') return { mode: 'show' as const, changes: {} };
  const changes: Partial<{ gmshExecutable: string; calculixExecutable: string }> = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    const key = flag === '--gmsh' ? 'gmshExecutable' : flag === '--calculix' ? 'calculixExecutable' : null;
    if (!key || key in changes || !value || value.startsWith('--'))
      throw new Error('Usage: configure:providers -- --gmsh <absolute path> [--calculix <absolute path>], or --show');
    changes[key] = value;
  }
  if (!Object.keys(changes).length) throw new Error('Explicit provider selection required; no discovery');
  providerPathsSchema.parse({ gmshExecutable: '', calculixExecutable: '', ...changes });
  return { mode: 'save' as const, changes };
}

/** Native command; no pipeline loading, provider probes, approvals or execution.
 * The owner port is injectable only for isolated Node tests, not CLI arguments. */
export async function runProviderSettingsCommand(args: string[], openOwner = openNativeProviderSettings) {
  const command = parseProviderSettingsArguments(args);
  const owner = await openOwner();
  const previous = await owner.read();
  const expected = command.mode === 'save' ? { ...previous, ...command.changes } : previous;
  if (command.mode === 'save') await owner.save(expected);
  const firstPaths = await owner.read();
  const firstExecutable = firstPaths.gmshExecutable
    ? await fingerprintConfiguredExecutable(firstPaths.gmshExecutable) : null;
  const firstSettings = Object.values(firstPaths).some(Boolean)
    ? await fingerprintConfiguredExecutable(owner.filePath) : null;

  // Store operations close all file handles themselves. Reopen an entirely new
  // native owner/reader, independently validating stored executable pins again.
  const reopened = await openOwner();
  if (reopened === owner || reopened.filePath !== owner.filePath) throw new Error('PROVIDER_SETTINGS_REOPEN_FAILED');
  const paths = await reopened.read();
  const executable = paths.gmshExecutable ? await fingerprintConfiguredExecutable(paths.gmshExecutable) : null;
  const settings = firstSettings ? await fingerprintConfiguredExecutable(reopened.filePath) : null;
  if (JSON.stringify(paths) !== JSON.stringify(expected)
    || JSON.stringify(firstPaths) !== JSON.stringify(paths)
    || JSON.stringify(firstExecutable) !== JSON.stringify(executable)
    || JSON.stringify(firstSettings) !== JSON.stringify(settings)) throw new Error('PROVIDER_SETTINGS_REOPEN_MISMATCH');
  return {
    state: executable ? 'GMSH_PATH_CONFIGURED_VERIFIED' : 'GMSH_PATH_CONFIGURATION_REQUIRED',
    paths, gmsh: executable,
    settings: settings ? { schema: 'tunacad-provider-settings/1', filePath: settings.path,
      identity: 'sha256:' + settings.sha256, sha256: settings.sha256, size: settings.size } : null,
    freshNativeReaderVerified: true, providerExecutions: 0, discoveryUsed: false,
  };
}
