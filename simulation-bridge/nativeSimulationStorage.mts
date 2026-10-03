import { lstat, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, win32 } from 'node:path';
import { tmpdir } from 'node:os';
import { ElectrostaticHostStorage, readNativeWindowsLocalApplicationData } from './electrostaticHostStorage.mts';
import { openPrivateExplicitMeshStore } from './privateExplicitMeshStore.mts';
import { openPrivateExplicitExportStore } from './privateExplicitExportStore.mts';

export const NATIVE_SIMULATION_STORAGE_POLICY = 'windows-local-application-data/1';
function invalid(detail: string): never { throw new Error('NATIVE_SIMULATION_STORAGE_INVALID: ' + detail); }

/** Pure location policy. Its input is obtained by the native OS reader below,
 * never from a browser, authoring request, fixture or storage-root override. */
export function nativeSimulationLocation(localApplicationData: string) {
  if (!/^[a-z]:\\/i.test(localApplicationData) || localApplicationData.length > 800
    || /[\x00-\x1f]/.test(localApplicationData)
    || localApplicationData.split(/[\\/]/).some(part => part === '..' || part === '.'))
    invalid('invalid Windows LocalApplicationData known folder');
  const base = win32.resolve(localApplicationData);
  if (base === win32.parse(base).root) invalid('drive root is not application data');
  // A global native simulation namespace, not a bootstrap/fixture directory.
  const root = win32.join(base, 'TunaCAD', 'Simulation', 'protected-v1');
  const inside = (parent: string) => {
    const suffix = win32.relative(win32.resolve(parent), root);
    return !suffix || (!suffix.startsWith('..') && !win32.isAbsolute(suffix));
  };
  if (inside(tmpdir()) || inside(process.cwd())) invalid('temporary/repository location forbidden');
  return Object.freeze({ policy: NATIVE_SIMULATION_STORAGE_POLICY, base, root });
}

export async function readNativeSimulationLocation() {
  if (process.platform !== 'win32') invalid('Windows native storage only');
  // Fixed command, no interpolated paths or environment overrides. GetFolderPath
  // follows the current user's registered OS application-data location.
  return nativeSimulationLocation((await readNativeWindowsLocalApplicationData()).trim());
}

async function verifyDirectoryAncestry(path: string) {
  for (let current = path; ; current = dirname(current)) {
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) invalid('reparse/non-directory ancestry');
    if (current === dirname(current)) break;
  }
}

/** Persistent native owner. Existing stores are verified, never repaired,
 * imported, migrated or resealed. Provisioning is explicit and creates only
 * the OS-derived namespace; it cannot accept a caller filesystem location. */
export async function openNativeSimulationStorage(options: { provisionIfMissing?: boolean } = {}) {
  if (Object.keys(options).some(key => key !== 'provisionIfMissing')
    || (options.provisionIfMissing !== undefined && typeof options.provisionIfMissing !== 'boolean'))
    invalid('caller root/configuration override forbidden');
  const location = await readNativeSimulationLocation();
  await verifyDirectoryAncestry(location.base);
  let absent = false;
  try { await lstat(location.root); }
  catch (error: any) { if (error.code !== 'ENOENT') throw error; absent = true; }
  if (absent && !options.provisionIfMissing) invalid('not provisioned; explicit native provisioning required');
  if (absent) {
    // Never recursively create an arbitrary path or change ancestor permissions.
    for (const directory of [join(location.base, 'TunaCAD'), join(location.base, 'TunaCAD', 'Simulation')]) {
      await verifyDirectoryAncestry(dirname(directory));
      try { await mkdir(directory); }
      catch (error: any) { if (error.code !== 'EEXIST') throw error; }
      await verifyDirectoryAncestry(directory);
    }
  }
  const storage = absent
    ? await ElectrostaticHostStorage.provisionNew(location.root)
    : await ElectrostaticHostStorage.open(location.root);
  if (!(storage instanceof ElectrostaticHostStorage)) invalid('native protected storage adapter required');
  const meshStore = await openPrivateExplicitMeshStore(storage.root);
  const exportStore = await openPrivateExplicitExportStore(storage.root);
  return Object.freeze({ location, storage, meshStore, exportStore, provisioned: absent,
    async inventory() {
      await storage.assertReady();
      const pins = (await readdir(storage.paths['source-catalog']))
        .filter(name => /^explicit-mesh-[a-f0-9]{64}\.pin\.json$/.test(name)).sort();
      const records = (await readdir(storage.paths.studies))
        .filter(name => /^explicit-mesh-[a-f0-9]{64}\.json$/.test(name)).sort();
      const artifacts = (await readdir(storage.paths.results))
        .filter(name => /^explicit-mesh-[a-f0-9]{64}\.json$/.test(name)).sort();
      await storage.assertReady();
      // Presence alone never proves binding. Only readExact with a freshly read
      // live study/source/export may authenticate an existing captured mesh.
      return { pinFiles: pins.length, recordFiles: records.length, artifactFiles: artifacts.length,
        exactMeshBinding: 'MESH_BINDING_PENDING' as const, fixtureFallback: false };
    },
  });
}
