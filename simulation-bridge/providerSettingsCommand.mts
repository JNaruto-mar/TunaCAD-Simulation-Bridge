import { openNativeProviderSettings, fingerprintConfiguredExecutable, providerPathsSchema }
  from './providerSettings.mts';
import {isAbsolute} from 'node:path';

export function parseProviderSettingsArguments(args: string[]) {
  if (args.length === 1 && args[0] === '--show') return { mode: 'show' as const, changes: {} };
  if(args.length===1&&args[0]==='--clear-electrostatic-storage-parent')
    return {mode:'storage' as const,changes:{},electrostaticStorageParent:null};
  if(args.length===2&&args[0]==='--electrostatic-storage-parent'){
    const value=args[1];if(!value||value.startsWith('--'))throw Error('Existing absolute Electrostatics storage parent required');
    // Shape validation here, filesystem/ancestry validation in the native store.
    if(!isAbsolute(value)||/[\x00-\x1f\x7f]/.test(value)||value.length>1000)throw Error('Existing absolute Electrostatics storage parent required');
    return {mode:'storage' as const,changes:{},electrostaticStorageParent:value};
  }
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
  const expected = command.mode === 'save' ? { ...await owner.read(), ...command.changes } : null;
  if (expected) await owner.save(expected);
  if(command.mode==='storage')await owner.saveElectrostaticStorageParent(command.electrostaticStorageParent);
  const first = await owner.readVerified();
  const firstPaths = first.paths, firstExecutable = first.fingerprints.gmsh;
  const firstSettings = Object.values(firstPaths).some(Boolean)||Boolean(first.electrostaticStorageParent)
    ? await fingerprintConfiguredExecutable(owner.filePath) : null;

  // Store operations close all file handles themselves. Reopen an entirely new
  // native owner/reader, independently validating stored executable pins again.
  const reopened = await openOwner();
  if (reopened === owner || reopened.filePath !== owner.filePath) throw new Error('PROVIDER_SETTINGS_REOPEN_FAILED');
  const fresh = await reopened.readVerified();
  const paths = fresh.paths, executable = fresh.fingerprints.gmsh;
  const settings = firstSettings ? await fingerprintConfiguredExecutable(reopened.filePath) : null;
  if (expected && JSON.stringify(paths) !== JSON.stringify(expected)
    || JSON.stringify(firstPaths) !== JSON.stringify(paths)
    || JSON.stringify(firstExecutable) !== JSON.stringify(executable)
    || first.electrostaticStorageParent!==fresh.electrostaticStorageParent
    || command.mode==='storage'&&(fresh.electrostaticStorageParent??null)!==command.electrostaticStorageParent
    || JSON.stringify(firstSettings) !== JSON.stringify(settings)) throw new Error('PROVIDER_SETTINGS_REOPEN_MISMATCH');
  return {
    state: executable ? 'GMSH_PATH_CONFIGURED_VERIFIED' : 'GMSH_PATH_CONFIGURATION_REQUIRED',
    paths, gmsh: executable,
    settings: settings ? { schema: 'tunacad-provider-settings/1', filePath: settings.path,
      identity: 'sha256:' + settings.sha256, sha256: settings.sha256, size: settings.size } : null,
    freshNativeReaderVerified: true, providerExecutions: 0, discoveryUsed: false,
    electrostaticStorageConfigured:Boolean(fresh.electrostaticStorageParent),
  };
}
