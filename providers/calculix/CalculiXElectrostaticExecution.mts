import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import {
  hasEnforcedProviderProcessQuotas, monitorWorkingDirectory, readUtf8FileBounded,
  removeWorkingDirectory, spawnProviderProcess, terminateChildProcess,
} from '../processLifecycle.mts';
import { ELECTROSTATIC_SLAB_LIMITS } from './CalculiXElectrostaticSlab.mts';
import {
  electrostaticRuntimeSchema, type ElectrostaticExecutionDriver, type ElectrostaticExecutionInput,
  type ElectrostaticNativeOutcome, type ElectrostaticRuntimeIdentity, type ElectrostaticNativeEvidence,
} from '../../simulation-bridge/electrostaticAdmission.mts';
import { digest } from '../../simulation-bridge/stableDigest.mts';

// CalculiX prints "no convergence" for INTERMEDIATE iterations before a
// successful final iteration. Settings and iteration progress are not terminal
// failure evidence. Native errors/exit + the completed final .sta row decide.
const nativeFailure = /\*ERROR|solution\s+(?:did not converge|failed to converge)|too many increments/i;

/** Streaming binary fingerprint; no caller-supplied executable digest is trusted. */
export async function electrostaticExecutableDigest(path: string): Promise<string> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > 256 * 1024 * 1024) throw new Error('ELECTROSTATIC_EXECUTABLE_LIMIT');
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    if (bytes > 256 * 1024 * 1024) throw new Error('ELECTROSTATIC_EXECUTABLE_LIMIT');
    hash.update(chunk);
  }
  if (bytes !== metadata.size) throw new Error('ELECTROSTATIC_EXECUTABLE_CHANGED');
  return 'sha256:' + hash.digest('hex');
}

/** Complete single-step scalar solve only. Runtime version is independently
 * probed by the adapter: ccx216 does not print its version on the solve path. */
export function assertElectrostaticNativeCompletion(code: number | null, diagnostic: string, sta: string): ElectrostaticNativeEvidence {
  if (code !== 0 || nativeFailure.test(diagnostic)) {
    throw new Error('ELECTROSTATIC_NATIVE_FAILED_OR_NONCONVERGED');
  }
  if (!/Job finished/i.test(diagnostic)) throw new Error('ELECTROSTATIC_NATIVE_COMPLETION_MISSING');
  if (Buffer.byteLength(sta) > 64 * 1024) throw new Error('ELECTROSTATIC_STATUS_LIMIT');
  const rows = sta.split(/\r?\n/).filter(line => /^\s*\d/.test(line));
  if (rows.length !== 1) throw new Error('ELECTROSTATIC_NATIVE_FINAL_STEP_MISSING');
  const tokens = rows[0].trim().split(/\s+/);
  if (tokens.length !== 7 || tokens.some(value => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eEdD][+-]?\d+)?$/.test(value))) {
    throw new Error('ELECTROSTATIC_NATIVE_FINAL_STEP_MALFORMED');
  }
  const values = tokens.map(value => Number(value.replace(/[dD]/g, 'E')));
  if (values.some(value => !Number.isFinite(value)) || values[0] !== 1 || values[1] !== 1
    || values[2] !== 1 || !Number.isSafeInteger(values[3]) || values[3] < 0
    || values[4] !== 1 || values[5] !== 1 || values[6] !== 1) {
    throw new Error('ELECTROSTATIC_NATIVE_FINAL_STEP_INCOMPLETE');
  }
  return { exitCode: 0, completedStep: 1, completedTime: 1,
    statusDigest: digest(sta), diagnosticDigest: digest(diagnostic) };
}

/** Private development adapter. Reuses normal Bridge process/resource/cleanup
 * helpers; never registers an electrostatic capability or accepts an API proof. */
export class CalculiXElectrostaticExecution implements ElectrostaticExecutionDriver {
  private readonly executable: string;
  private verifiedExecutableDigest: string | null = null;
  constructor(executable: string) {
    if (!/^ccx(?:\d+(?:\.\d+)*)?(?:\.exe)?$/i.test(basename(executable))) throw new Error('ELECTROSTATIC_EXECUTABLE_INVALID');
    this.executable = resolve(executable);
  }
  async readCurrentRuntimeIdentity(): Promise<ElectrostaticRuntimeIdentity> {
    if (!hasEnforcedProviderProcessQuotas()) throw new Error('ELECTROSTATIC_HOST_UNSUPPORTED');
    const executableDigest = await electrostaticExecutableDigest(this.executable);
    if (this.verifiedExecutableDigest !== executableDigest) {
      const child = spawnProviderProcess(this.executable, ['-v'], {
        cwd: dirname(this.executable), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PATH: dirname(this.executable) + ';' + (process.env.PATH ?? '') },
      }, { cpuTimeLimitMs: 5_000, memoryLimitBytes: 512 * 1024 * 1024 });
      let diagnostic = ''; let exceeded = false;
      const collect = (chunk: unknown) => {
        diagnostic += String(chunk);
        if (Buffer.byteLength(diagnostic) > 4096) { exceeded = true; void terminateChildProcess(child); }
      };
      child.stdout?.on('data', collect); child.stderr?.on('data', collect);
      const timer = setTimeout(() => { exceeded = true; void terminateChildProcess(child); }, 5_000); timer.unref();
      try {
        await new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('close', () => resolve()); });
        // ccx216 -v returns nonzero even for a valid metadata response. This
        // exception applies ONLY to -v; a solve still requires exit code zero.
        if (exceeded || !/This is Version 2\.16(?:\s|$)/.test(diagnostic)
          || await electrostaticExecutableDigest(this.executable) !== executableDigest) {
          throw new Error('ELECTROSTATIC_RUNTIME_VERSION_INVALID');
        }
        this.verifiedExecutableDigest = executableDigest;
      } finally { clearTimeout(timer); await terminateChildProcess(child); }
    }
    return electrostaticRuntimeSchema.parse({
      providerId: 'tunacad-calculix-electrostatic-development', providerVersion: '0.1.0',
      engine: 'CalculiX', engineVersion: '2.16', executableDigest,
      nodeMajor: Number(process.versions.node.split('.')[0]), platform: process.platform, architecture: process.arch,
    });
  }
  async execute(input: ElectrostaticExecutionInput): Promise<ElectrostaticNativeOutcome> {
    const base = { jobId: input.jobId, sourceDigest: input.source.identity.sourceDigest, runtime: input.source.identity.runtime };
    let directory: string | null = null;
    let child: ReturnType<typeof spawnProviderProcess> | null = null;
    let stopMonitor = () => undefined; let timer: NodeJS.Timeout | null = null;
    let exceeded = false; let cleanupConfirmed = true;
    let state: 'completed_converged' | 'failed' | 'cancelled' = 'failed';
    let output = ''; let failureCode = 'ELECTROSTATIC_NATIVE_FAILED';
    let nativeEvidence: ElectrostaticNativeEvidence | null = null;
    const abort = () => { if (child) void terminateChildProcess(child); };
    try {
      if (input.signal.aborted) { state = 'cancelled'; failureCode = 'ELECTROSTATIC_CANCELLED'; }
      else {
        if (!/^electrical_[a-f0-9-]{36}$/.test(input.jobId)
          || digest(input.source.deck) !== input.source.identity.deckDigest
          || digest(await this.readCurrentRuntimeIdentity()) !== digest(base.runtime)) {
          throw new Error('ELECTROSTATIC_RUNTIME_OR_DECK_CHANGED');
        }
        directory = await mkdtemp(join(tmpdir(), 'tunacad-electrical-job-' + input.jobId + '-'));
        await writeFile(join(directory, 'electrical.inp'), input.source.deck, 'utf8');
        if (input.signal.aborted) { state = 'cancelled'; failureCode = 'ELECTROSTATIC_CANCELLED'; }
        else {
          child = spawnProviderProcess(this.executable, ['-i', 'electrical'], {
            cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, OMP_NUM_THREADS: '1', CCX_NPROC_RESULTS: '1',
              PATH: dirname(this.executable) + ';' + (process.env.PATH ?? '') },
          }, { cpuTimeLimitMs: 30_000, memoryLimitBytes: 512 * 1024 * 1024 });
          input.signal.addEventListener('abort', abort, { once: true });
          let diagnostic = ''; let nativeObserved = false;
          const collect = (chunk: unknown) => {
            // Preserve the version banner AND final completion diagnostic.
            // A tail-only buffer can discard the runtime identity on valid
            // verbose solves. Exceeding this bound kills/quarantines the job.
            const combined = diagnostic + String(chunk);
            if (Buffer.byteLength(combined) > 256 * 1024) {
              exceeded = true; void terminateChildProcess(child!); return;
            }
            diagnostic = combined;
            if (!nativeObserved && diagnostic.trim()) {
              nativeObserved = true; input.onProgress('native_solver_started');
            }
          };
          child.stdout?.on('data', collect); child.stderr?.on('data', collect);
          stopMonitor = monitorWorkingDirectory({ child, directory, maximumBytes: 64 * 1024 * 1024,
            async onExceeded() { exceeded = true; await terminateChildProcess(child!); } });
          timer = setTimeout(() => { exceeded = true; void terminateChildProcess(child!); }, 30_000); timer.unref();
          const completion = new Promise<number | null>((resolve, reject) => {
            child!.once('error', reject); child!.once('close', resolve);
          });
          if (input.signal.aborted) abort();
          const code = await completion;
          if (input.signal.aborted) { state = 'cancelled'; failureCode = 'ELECTROSTATIC_CANCELLED'; }
          else {
            if (exceeded) throw new Error('ELECTROSTATIC_RESOURCE_LIMIT');
            if (code !== 0 || nativeFailure.test(diagnostic)) {
              throw new Error('ELECTROSTATIC_NATIVE_FAILED_OR_NONCONVERGED: exit=' + String(code)
                + '; marker=' + (diagnostic.match(nativeFailure)?.[0] ?? 'none'));
            }
            const sta = await readUtf8FileBounded(join(directory, 'electrical.sta'), 64 * 1024);
            nativeEvidence = assertElectrostaticNativeCompletion(code, diagnostic, sta);
            output = await readUtf8FileBounded(join(directory, 'electrical.dat'), ELECTROSTATIC_SLAB_LIMITS.maximumOutputBytes);
            if (digest(await this.readCurrentRuntimeIdentity()) !== digest(base.runtime)) throw new Error('ELECTROSTATIC_RUNTIME_CHANGED');
            if (input.signal.aborted) { state = 'cancelled'; failureCode = 'ELECTROSTATIC_CANCELLED'; output = ''; }
            else state = 'completed_converged';
          }
        }
      }
    } catch (error) {
      state = input.signal.aborted ? 'cancelled' : 'failed';
      failureCode = input.signal.aborted ? 'ELECTROSTATIC_CANCELLED'
        : error instanceof Error ? error.message.slice(0, 200) : 'ELECTROSTATIC_NATIVE_FAILED';
      output = '';
    } finally {
      if (timer) clearTimeout(timer); stopMonitor();
      input.signal.removeEventListener('abort', abort);
      const terminated = child ? await terminateChildProcess(child) : true;
      cleanupConfirmed = terminated && (!directory || await removeWorkingDirectory(directory));
      if (input.signal.aborted) { state = 'cancelled'; failureCode = 'ELECTROSTATIC_CANCELLED'; output = ''; }
      if (!cleanupConfirmed) { output = ''; if (state !== 'cancelled') state = 'failed'; failureCode = 'ELECTROSTATIC_CLEANUP_FAILED'; }
    }
    return state === 'completed_converged'
      ? { ...base, state, output, nativeEvidence: nativeEvidence!, cleanupConfirmed }
      : { ...base, state, failureCode, cleanupConfirmed };
  }
}
