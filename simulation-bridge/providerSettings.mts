import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import * as z from 'zod/v4';
import { readNativeSimulationLocation } from './nativeSimulationStorage.mts';
import type { ExternalProviderPaths } from './providers.mts';

const pathSchema = (provider: 'gmsh' | 'calculix') => z.string().max(1000).refine(value =>
  value === '' || (isAbsolute(value) && !/[\x00-\x1f\x7f]/.test(value)
    && (provider === 'gmsh' ? /^gmsh(?:\.exe)?$/i : /^ccx(?:\d+(?:\.\d+)*|[_-][A-Za-z0-9][A-Za-z0-9._-]*)?(?:\.exe)?$/i).test(basename(value))),
  'Explicit absolute provider executable path required');
export const providerPathsSchema = z.object({
  gmshExecutable: pathSchema('gmsh'), calculixExecutable: pathSchema('calculix'),
}).strict();
const fingerprintSchema = z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().positive().max(512 * 1024 * 1024) }).strict();
const recordSchema = z.object({ schema: z.literal('tunacad-provider-settings/1'),
  paths: providerPathsSchema, fingerprints: z.object({
    gmsh: fingerprintSchema.nullable(), calculix: fingerprintSchema.nullable(),
  }).strict() }).strict();
const empty = (): ExternalProviderPaths => ({ gmshExecutable: '', calculixExecutable: '' });

/** Fingerprints only the explicitly configured file. Never searches or executes. */
export async function fingerprintConfiguredExecutable(path: string) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size <= 0 || before.size > 512 * 1024 * 1024)
    throw new Error('PROVIDER_SETTINGS_INVALID_EXECUTABLE');
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (info.ino !== before.ino || info.size !== before.size || info.mtimeMs !== before.mtimeMs)
      throw new Error('PROVIDER_SETTINGS_EXECUTABLE_CHANGED');
    const hash = createHash('sha256');
    for await (const bytes of file.createReadStream({ autoClose: false })) hash.update(bytes);
    const after = await file.stat();
    const current = await lstat(path);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs
      || current.ino !== before.ino || current.mtimeMs !== before.mtimeMs || current.isSymbolicLink())
      throw new Error('PROVIDER_SETTINGS_EXECUTABLE_CHANGED');
    return { path, sha256: hash.digest('hex'), size: before.size };
  } finally { await file.close(); }
}

async function checkAncestry(directory: string) {
  for (let current = directory; ; current = dirname(current)) {
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('PROVIDER_SETTINGS_UNSAFE_STORAGE');
    if (current === dirname(current)) break;
  }
}

/** Node-owned adapter. Its path is never accepted through a browser route.
 * Local configuration is mutable, not a trusted simulation completion record. */
export function createProviderSettingsStore(filePath: string) {
  if (!isAbsolute(filePath)) throw new Error('PROVIDER_SETTINGS_ABSOLUTE_STORAGE_REQUIRED');
  async function read() {
    let info;
    try { info = await lstat(filePath); }
    catch (error: any) { if (error.code === 'ENOENT') return empty(); throw error; }
    await checkAncestry(dirname(filePath));
    if (!info.isFile() || info.isSymbolicLink() || info.size > 8192) throw new Error('PROVIDER_SETTINGS_INVALID_RECORD');
    const file = await open(filePath, 'r');
    let record;
    try {
      const current = await file.stat();
      if (current.ino !== info.ino || current.size !== info.size) throw new Error('PROVIDER_SETTINGS_CHANGED');
      record = recordSchema.parse(JSON.parse(await file.readFile('utf8')));
      const after = await file.stat();
      if (after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw new Error('PROVIDER_SETTINGS_CHANGED');
    } finally { await file.close(); }
    for (const [name, key] of [['gmsh', 'gmshExecutable'], ['calculix', 'calculixExecutable']] as const) {
      const path = record.paths[key], expected = record.fingerprints[name];
      if (!path) { if (expected) throw new Error('PROVIDER_SETTINGS_FINGERPRINT_MISMATCH'); continue; }
      const actual = await fingerprintConfiguredExecutable(path);
      if (!expected || JSON.stringify(actual) !== JSON.stringify(expected))
        throw new Error('PROVIDER_SETTINGS_FINGERPRINT_MISMATCH: explicitly save the changed executable again');
    }
    return record.paths;
  }
  async function save(value: ExternalProviderPaths) {
    const paths = providerPathsSchema.parse(value);
    const record = { schema: 'tunacad-provider-settings/1', paths, fingerprints: {
      gmsh: paths.gmshExecutable ? await fingerprintConfiguredExecutable(paths.gmshExecutable) : null,
      calculix: paths.calculixExecutable ? await fingerprintConfiguredExecutable(paths.calculixExecutable) : null,
    } };
    await checkAncestry(dirname(filePath));
    try { const info = await lstat(filePath); if (!info.isFile() || info.isSymbolicLink()) throw new Error('PROVIDER_SETTINGS_UNSAFE_STORAGE'); }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    const temporary = filePath + '.' + randomUUID() + '.new';
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(record)); await file.sync(); } finally { await file.close(); }
      await rename(temporary, filePath);
      return await read();
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  return Object.freeze({ filePath, read, save });
}

/** Same OS known-folder policy as native simulation storage, but separate from
 * immutable protected-v1 records. No env/browser storage-root override. */
export async function openNativeProviderSettings() {
  const location = await readNativeSimulationLocation();
  const directory = join(location.base, 'TunaCAD', 'Simulation');
  const store = createProviderSettingsStore(join(directory, 'provider-settings.json'));
  return Object.freeze({ filePath: store.filePath, read: store.read,
    async save(paths: ExternalProviderPaths) {
      // Only explicit save provisions the fixed per-user namespace.
      await checkAncestry(location.base);
      for (const path of [join(location.base, 'TunaCAD'), directory]) {
        try { await mkdir(path); } catch (error: any) { if (error.code !== 'EEXIST') throw error; }
        await checkAncestry(path);
      }
      return store.save(paths);
    },
  });
}

/** Explicit environment overrides are supported, never discovery/fallback.
 * Empty variables mean unset. Invalid paths fail closed, not another binary. */
export function resolveConfiguredProviderPaths(saved: ExternalProviderPaths, environment: NodeJS.ProcessEnv) {
  return providerPathsSchema.parse({
    gmshExecutable: environment.TUNACAD_GMSH_EXECUTABLE || saved.gmshExecutable,
    calculixExecutable: environment.TUNACAD_CALCULIX_EXECUTABLE || saved.calculixExecutable,
  });
}
