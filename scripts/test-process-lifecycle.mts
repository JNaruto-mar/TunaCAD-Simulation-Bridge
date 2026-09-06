import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  directorySizeBytes,
  hasEnforcedProviderProcessQuotas,
  monitorWorkingDirectory,
  readUtf8FileBounded,
  removeWorkingDirectory,
  spawnProviderProcess,
  terminateChildProcess,
} from '../providers/processLifecycle.mts';

assert.equal(hasEnforcedProviderProcessQuotas('win32', 'x64'), true);
assert.equal(hasEnforcedProviderProcessQuotas('linux', 'x64'), false);
assert.equal(hasEnforcedProviderProcessQuotas('darwin', 'arm64'), false);
assert.equal(hasEnforcedProviderProcessQuotas('win32', 'arm64'), false);

if (process.platform === 'win32') {
  const quotaDirectory = await mkdtemp(join(tmpdir(), 'tunacad-provider-job-object-'));
  try {
    const cpuBound = spawnProviderProcess(process.execPath, ['-e', 'for (;;) {}'], {
      cwd: quotaDirectory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    }, { cpuTimeLimitMs: 300, memoryLimitBytes: 256 * 1024 * 1024 });
    const cpuExit = await waitForChild(cpuBound, 10_000);
    assert.notEqual(cpuExit.code, 0, 'Windows Job Object CPU quota must terminate a CPU-bound provider.');

    const memoryBound = spawnProviderProcess(process.execPath, ['-e', "const chunks=[]; setInterval(() => chunks.push(Buffer.alloc(16*1024*1024, 1)), 1)"], {
      cwd: quotaDirectory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    }, { cpuTimeLimitMs: 10_000, memoryLimitBytes: 96 * 1024 * 1024 });
    const memoryExit = await waitForChild(memoryBound, 10_000);
    assert.notEqual(memoryExit.code, 0, 'Windows Job Object process-memory quota must terminate or fail the over-limit provider.');
  } finally {
    assert.equal(await removeWorkingDirectory(quotaDirectory), true);
  }
}

const sleeping = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' });
assert.equal(await terminateChildProcess(sleeping, 2_000), true);
assert.ok(sleeping.exitCode !== null || sleeping.signalCode !== null, 'Cancellation must wait until the child process exits.');

const boundedDirectory = await mkdtemp(join(tmpdir(), 'tunacad-provider-bounded-read-'));
try {
  const resultPath = join(boundedDirectory, 'result.dat');
  await writeFile(resultPath, '0123456789', 'utf8');
  assert.equal(await readUtf8FileBounded(resultPath, 10), '0123456789');
  await assert.rejects(() => readUtf8FileBounded(resultPath, 9), { code: 'SIMULATION_OUTPUT_LIMIT' });
} finally {
  assert.equal(await removeWorkingDirectory(boundedDirectory), true);
}

const growingDirectory = await mkdtemp(join(tmpdir(), 'tunacad-provider-disk-limit-'));
const writer = spawn(process.execPath, ['-e', [
  "const { appendFileSync } = require('node:fs');",
  "const { join } = require('node:path');",
  "const path = join(process.argv[1], 'growth.bin');",
  'setInterval(() => appendFileSync(path, Buffer.alloc(4096)), 5);',
].join(' '), growingDirectory], { windowsHide: true, stdio: 'ignore' });
let observedBytes = 0;
let resolveExceeded!: () => void;
const exceeded = new Promise<void>(resolve => { resolveExceeded = resolve; });
const stop = monitorWorkingDirectory({
  child: writer,
  directory: growingDirectory,
  maximumBytes: 8_192,
  async onExceeded(bytes) {
    observedBytes = bytes;
    await terminateChildProcess(writer, 2_000);
    resolveExceeded();
  },
});
try {
  await Promise.race([
    exceeded,
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('Working-directory monitor did not enforce its limit.')), 5_000)),
  ]);
  assert.ok(observedBytes > 8_192);
  assert.ok(writer.exitCode !== null || writer.signalCode !== null);
  assert.ok(await directorySizeBytes(growingDirectory) >= observedBytes);
} finally {
  stop();
  await terminateChildProcess(writer, 2_000);
  assert.equal(await removeWorkingDirectory(growingDirectory), true);
}

console.log('Provider lifecycle test passed: graceful/forced termination, bounded reads, disk monitoring, and cleanup are enforced.');

function waitForChild(child: ReturnType<typeof spawnProviderProcess>, timeoutMs: number): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      void terminateChildProcess(child).finally(() => reject(new Error('Resource-limited process did not terminate before the acceptance deadline.')));
    }, timeoutMs);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
}
