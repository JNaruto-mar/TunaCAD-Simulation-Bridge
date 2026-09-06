import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { promisify } from 'node:util';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { ComposedSimulationProvider } from '../providers/ComposedSimulationProvider.mts';
import { GmshMeshProvider } from '../providers/gmsh/GmshMeshProvider.mts';
import { CalculiXSolverProvider } from '../providers/calculix/CalculiXSolverProvider.mts';
const execute = promisify(execFile);

export interface ExternalProviderPaths { gmshExecutable: string; calculixExecutable: string }

export async function loadExternalPipeline(gmshExecutable?: string, calculixExecutable?: string) {
  const discovered = discoverExternalProviderPaths();
  const paths: ExternalProviderPaths = {
    gmshExecutable: normalizeConfiguredPath(gmshExecutable || discovered.gmshExecutable, 'gmsh'),
    calculixExecutable: normalizeConfiguredPath(calculixExecutable || discovered.calculixExecutable, 'calculix'),
  };
  const [gmshVersion, calculixVersion] = await Promise.all([probeGmsh(paths.gmshExecutable), probeCalculiX(paths.calculixExecutable)]);
  const mesh = gmshVersion ? new GmshMeshProvider({ executable: paths.gmshExecutable, runtimeVersion: gmshVersion }) : null;
  const solver = calculixVersion ? new CalculiXSolverProvider({ executable: paths.calculixExecutable, runtimeVersion: calculixVersion }) : null;
  const provider = mesh && solver ? new ComposedSimulationProvider({ id: 'tunacad-local-simulation-bridge', version: '1.1-poc', meshProvider: mesh, solverProvider: solver }) : null;
  return {
    provider,
    paths,
    readiness: {
      ready: !!provider,
      provider: provider ? { id: provider.id, version: provider.version, capabilities: provider.capabilities } : null,
      meshing: { ready: !!mesh, adapterVersion: mesh?.version ?? 'unavailable', runtimeVersion: gmshVersion, geometryFormats: mesh ? ['step'] : [], elementFamilies: mesh ? ['tetrahedral'] : [] },
      solving: { ready: !!solver, adapterVersion: solver?.version ?? 'unavailable', runtimeVersion: calculixVersion, analysisTypes: solver ? ['linear_static'] : [] },
      configuration: { ...paths, discoveryUsed: (!gmshExecutable && !!paths.gmshExecutable) || (!calculixExecutable && !!paths.calculixExecutable) },
    },
  };
}

export async function testExternalProviderPaths(paths: ExternalProviderPaths) { return loadExternalPipeline(paths.gmshExecutable, paths.calculixExecutable); }

export function discoverExternalProviderPaths(): ExternalProviderPaths {
  return { gmshExecutable: findExecutable('gmsh.exe', gmshCandidates()), calculixExecutable: findExecutable('ccx.exe', calculixCandidates()) };
}

async function probeGmsh(executable: string): Promise<string | null> {
  if (!validExecutable(executable, /^gmsh(?:\.exe)?$/i)) return null;
  try {
    const { stdout, stderr } = await execute(executable, ['-info'], probeOptions(executable));
    const output = `${stdout}\n${stderr}`;
    if (!/gmsh/i.test(output)) return null;
    return /Version\s*[:=]?\s*([0-9]+(?:\.[0-9]+)+)/i.exec(output)?.[1] ?? /([0-9]+(?:\.[0-9]+){1,3})/.exec(output)?.[1] ?? null;
  } catch { return null; }
}

async function probeCalculiX(executable: string): Promise<string | null> {
  if (!validExecutable(executable, /^ccx(?:\d+(?:\.\d+)*|[_-][A-Za-z0-9][A-Za-z0-9._-]*)?(?:\.exe)?$/i)) return null;
  try {
    const { stdout, stderr } = await execute(executable, ['-v'], probeOptions(executable));
    return calculixVersion(`${stdout}\n${stderr}`);
  } catch (error) {
    return calculixVersion(`${(error as { stdout?: string }).stdout ?? ''}\n${(error as { stderr?: string }).stderr ?? ''}`);
  }
}

function calculixVersion(output: string): string | null {
  if (!/calculix|version/i.test(output)) return null;
  return /Version\s+([0-9]+(?:\.[0-9]+)+)/i.exec(output)?.[1] ?? /([0-9]+(?:\.[0-9]+){1,3})/.exec(output)?.[1] ?? null;
}

function probeOptions(executable: string) {
  return { windowsHide: true, timeout: 10_000, maxBuffer: 64 * 1024, env: { ...process.env, PATH: `${dirname(executable)}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}` } };
}
function normalizeConfiguredPath(value: string | undefined, provider: 'gmsh' | 'calculix'): string {
  if (!value?.trim()) return '';
  const absolute = resolve(value.trim());
  const expected = provider === 'gmsh' ? /^gmsh(?:\.exe)?$/i : /^ccx(?:\d+(?:\.\d+)*|[_-][A-Za-z0-9][A-Za-z0-9._-]*)?(?:\.exe)?$/i;
  return isAbsolute(absolute) && expected.test(basename(absolute)) ? absolute : '';
}
function validExecutable(executable: string, name: RegExp): boolean { return !!executable && isAbsolute(executable) && name.test(basename(executable)) && existsSync(executable); }
function findExecutable(name: string, candidates: string[]): string {
  const fromPath = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':').filter(Boolean).map(directory => join(directory, name));
  return [...fromPath, ...candidates].find(existsSync) ?? '';
}
function gmshCandidates(): string[] {
  if (process.platform !== 'win32') return ['/usr/bin/gmsh', '/usr/local/bin/gmsh'];
  const roots = [process.env.ProgramFiles, process.env.LOCALAPPDATA].filter((value): value is string => !!value);
  return roots.flatMap(root => [join(root, 'gmsh', 'gmsh.exe'), join(root, 'Gmsh', 'gmsh.exe'), ...listDirectories(root, /^gmsh/i).map(directory => join(root, directory, 'gmsh.exe'))]);
}
function calculixCandidates(): string[] {
  if (process.platform !== 'win32') return ['/usr/bin/ccx', '/usr/local/bin/ccx'];
  const roots = [process.env.ProgramFiles, process.env.LOCALAPPDATA].filter((value): value is string => !!value);
  return roots.flatMap(root => [join(root, 'CalculiX', 'ccx.exe'), join(root, 'calculix', 'ccx.exe'), ...listDirectories(root, /^calculix/i).flatMap(directory => {
    const location = join(root, directory); return [join(location, 'ccx.exe'), ...listFiles(location, /^ccx(?:\d+(?:\.\d+)*|[_-][A-Za-z0-9][A-Za-z0-9._-]*)?\.exe$/i).map(file => join(location, file))];
  })]);
}
function listDirectories(root: string, pattern: RegExp): string[] {
  try { return readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() && pattern.test(entry.name)).map(entry => entry.name); } catch { return []; }
}
function listFiles(root: string, pattern: RegExp): string[] {
  try { return readdirSync(root, { withFileTypes: true }).filter(entry => entry.isFile() && pattern.test(entry.name)).map(entry => entry.name); } catch { return []; }
}
