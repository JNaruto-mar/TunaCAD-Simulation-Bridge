import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { open, readdir, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export function hasEnforcedProviderProcessQuotas(platform = process.platform, architecture = process.arch): boolean {
  return platform === 'win32' && architecture === 'x64';
}

export const LOCAL_PROVIDER_RESOURCE_LIMITS = Object.freeze({
  maximumStepBytes: 32 * 1024 * 1024,
  maximumWorkingDirectoryBytes: 512 * 1024 * 1024,
  maximumResultFileBytes: 256 * 1024 * 1024,
  maximumDiagnosticCharacters: 12_000,
  processTerminationGraceMs: 2_000,
  workingDirectoryPollMs: 250,
  cpuTimeLimitMs: hasEnforcedProviderProcessQuotas() ? 120_000 : null,
  memoryLimitBytes: hasEnforcedProviderProcessQuotas() ? 1024 * 1024 * 1024 : null,
});

export function spawnProviderProcess(
  executable: string,
  args: string[],
  options: SpawnOptions,
  quotas: { cpuTimeLimitMs: number | null; memoryLimitBytes: number | null } = LOCAL_PROVIDER_RESOURCE_LIMITS,
): ChildProcess {
  if (!hasEnforcedProviderProcessQuotas() || quotas.cpuTimeLimitMs === null || quotas.memoryLimitBytes === null) {
    return spawn(executable, args, options);
  }
  const windowsDirectory = process.env.SystemRoot ?? 'C:\\Windows';
  const powershell = join(windowsDirectory, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const runner = fileURLToPath(new URL('./windowsJobObjectRunner.ps1', import.meta.url));
  const encodedArguments = Buffer.from(JSON.stringify(args), 'utf8').toString('base64');
  return spawn(powershell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', runner,
    '-Executable', executable,
    '-WorkingDirectory', String(options.cwd ?? process.cwd()),
    '-CpuTimeLimitMs', String(quotas.cpuTimeLimitMs),
    '-MemoryLimitBytes', String(quotas.memoryLimitBytes),
    '-ArgumentListBase64', encodedArguments,
  ], options);
}

export async function terminateChildProcess(child: ChildProcess, graceMs = LOCAL_PROVIDER_RESOURCE_LIMITS.processTerminationGraceMs): Promise<boolean> {
  if (hasExited(child)) return true;
  child.kill('SIGTERM');
  if (await waitForExit(child, graceMs)) return true;
  child.kill('SIGKILL');
  return waitForExit(child, graceMs);
}

export function monitorWorkingDirectory(options: {
  child: ChildProcess;
  directory: string;
  maximumBytes?: number;
  onExceeded(bytes: number): Promise<void>;
}): () => void {
  const maximumBytes = options.maximumBytes ?? LOCAL_PROVIDER_RESOURCE_LIMITS.maximumWorkingDirectoryBytes;
  let stopped = false;
  let checking = false;
  const timer = setInterval(() => {
    if (stopped || checking) return;
    if (hasExited(options.child)) { stopped = true; clearInterval(timer); return; }
    checking = true;
    void directorySizeBytes(options.directory, maximumBytes + 1).then(async bytes => {
      if (!stopped && bytes > maximumBytes) {
        stopped = true;
        clearInterval(timer);
        await options.onExceeded(bytes);
      }
    }).catch(() => undefined).finally(() => { checking = false; });
  }, LOCAL_PROVIDER_RESOURCE_LIMITS.workingDirectoryPollMs);
  timer.unref();
  return () => { stopped = true; clearInterval(timer); };
}

export async function readUtf8FileBounded(path: string, maximumBytes = LOCAL_PROVIDER_RESOURCE_LIMITS.maximumResultFileBytes): Promise<string> {
  const handle = await open(path, 'r');
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > maximumBytes) throwOutputLimit(maximumBytes);
    const bytes = Buffer.alloc(metadata.size + 1);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maximumBytes || offset > metadata.size) throwOutputLimit(maximumBytes);
    return bytes.subarray(0, offset).toString('utf8');
  } finally {
    await handle.close();
  }
}

export async function removeWorkingDirectory(directory: string): Promise<boolean> {
  try {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    return true;
  } catch {
    return false;
  }
}

export async function directorySizeBytes(directory: string, stopAfterBytes = Number.POSITIVE_INFINITY): Promise<number> {
  let total = 0;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) total += await directorySizeBytes(path, Math.max(0, stopAfterBytes - total));
    else if (entry.isFile()) total += (await stat(path)).size;
    if (total >= stopAfterBytes) return total;
  }
  return total;
}

function hasExited(child: ChildProcess): boolean { return child.exitCode !== null || child.signalCode !== null; }

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) return Promise.resolve(true);
  return new Promise(resolve => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      child.off('error', onExit);
      resolve(value);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref();
    child.once('exit', onExit);
    child.once('error', onExit);
  });
}

function lifecycleError(code: string, message: string): Error & { code: string } { return Object.assign(new Error(message), { code }); }
function throwOutputLimit(maximumBytes: number): never {
  throw lifecycleError('SIMULATION_OUTPUT_LIMIT', `Provider result file exceeds the ${maximumBytes}-byte limit.`);
}
