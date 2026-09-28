import { randomUUID } from 'node:crypto';
import * as z from 'zod/v4';
import type { NeutralFemMesh } from '../src/simulation/externalSimulationContracts.ts';
import { createCalculiXElectrostaticSlabDeck, recoverCalculiXElectrostaticSlab } from '../providers/calculix/CalculiXElectrostaticSlab.mts';
import { validateElectrostaticFoundation, type ElectrostaticFoundation } from './electrostaticFoundation.mts';
import { digest } from './stableDigest.mts';

const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const electrostaticRuntimeSchema = z.object({
  providerId: z.literal('tunacad-calculix-electrostatic-development'),
  providerVersion: z.literal('0.1.0'), engine: z.literal('CalculiX'),
  engineVersion: z.literal('2.16'), executableDigest: hash,
  nodeMajor: z.literal(24), platform: z.literal('win32'), architecture: z.literal('x64'),
}).strict();
export type ElectrostaticRuntimeIdentity = z.infer<typeof electrostaticRuntimeSchema>;
export const electrostaticNativeEvidenceSchema = z.object({
  exitCode: z.literal(0), completedStep: z.literal(1), completedTime: z.literal(1),
  statusDigest: hash, diagnosticDigest: hash,
}).strict();
export type ElectrostaticNativeEvidence = z.infer<typeof electrostaticNativeEvidenceSchema>;

/** Host-owned readers, never built from caller JSON/digests. Requests and meshes
 * must be independently retrieved from the host's immutable stores; revision
 * and runtime reads describe the CURRENT source, not the submitted assertion. */
export interface TrustedElectrostaticSourceReader {
  readCurrentProjectRevision(studyId: string): Promise<string>;
  readSealedRequest(studyId: string): Promise<unknown>;
  readValidatedMesh(studyId: string): Promise<NeutralFemMesh>;
  readCurrentRuntimeIdentity(): Promise<unknown>;
}
export interface ElectrostaticSourceSnapshot {
  request: ElectrostaticFoundation;
  mesh: NeutralFemMesh;
  deck: string;
  identity: {
    sourceDigest: string; requestDigest: string; projectRevision: string;
    modelDigest: string; geometryDigest: string; meshDigest: string; deckDigest: string;
    domainId: string; materialId: string; materialDigest: string;
    absolutePermittivityFPerM: number; electrodeDigest: string;
    electrodeFaceIds: string[];
    runtime: ElectrostaticRuntimeIdentity;
  };
}
export interface ElectrostaticExecutionInput {
  jobId: string; source: ElectrostaticSourceSnapshot; signal: AbortSignal;
  onProgress(phase: string): void;
}
export type ElectrostaticNativeOutcome = {
  jobId: string; sourceDigest: string; runtime: ElectrostaticRuntimeIdentity;
  cleanupConfirmed: boolean;
} & (
  { state: 'completed_converged'; output: string; nativeEvidence: ElectrostaticNativeEvidence; failureCode?: never }
  | { state: 'failed' | 'cancelled'; output?: never; failureCode: string }
);
/** Trusted adapter injection, like trusted readers: not a request/API parameter. */
export interface ElectrostaticExecutionDriver {
  execute(input: ElectrostaticExecutionInput): Promise<ElectrostaticNativeOutcome>;
}
export interface ElectrostaticJobStatus {
  jobId: string; state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  phase: string; cleanupConfirmed: boolean; failureCode: string | null;
}
type ElectricalResult = ReturnType<typeof recoverCalculiXElectrostaticSlab>;
export interface CompletedElectrostaticResult {
  schema: 'tunacad-electrostatic-completed-result/0.1';
  jobId: string; completedProviderState: 'completed_converged';
  binding: ElectrostaticSourceSnapshot['identity'];
  normalizedElectricalResultDigest: string; completionDigest: string;
  electrical: ElectricalResult; resultDigest: string;
  status: 'proof_of_concept'; engineeringUsePermitted: false; providerAdmission: 'closed';
}
interface Job {
  studyId: string; status: ElectrostaticJobStatus; controller: AbortController;
  source: ElectrostaticSourceSnapshot | null; result: CompletedElectrostaticResult | null;
  completion: Record<string, unknown> | null; completionDigest: string | null;
  resultDigest: string | null; done: Promise<void>; finishedAtMs: number | null;
}

export async function bindElectrostaticSource(studyId: string, reader: TrustedElectrostaticSourceReader): Promise<ElectrostaticSourceSnapshot> {
  const revisionBefore = await reader.readCurrentProjectRevision(studyId);
  const request = validateElectrostaticFoundation(await reader.readSealedRequest(studyId));
  const mesh = structuredClone(await reader.readValidatedMesh(studyId));
  const runtime = electrostaticRuntimeSchema.parse(await reader.readCurrentRuntimeIdentity());
  const revisionAfter = await reader.readCurrentProjectRevision(studyId);
  if (request.studyId !== studyId || request.model.projectRevision !== revisionBefore
    || revisionBefore !== revisionAfter) throw new Error('ELECTROSTATIC_SOURCE_CHANGED');
  const generated = createCalculiXElectrostaticSlabDeck(request, mesh);
  const domain = request.model.domains[0];
  const unsigned = {
    requestDigest: request.requestDigest, projectRevision: revisionBefore,
    modelDigest: digest(request.model), geometryDigest: domain.geometryDigest,
    meshDigest: generated.meshDigest, deckDigest: generated.deckDigest, domainId: domain.domainId,
    materialId: request.material.materialId, materialDigest: digest(request.material),
    absolutePermittivityFPerM: request.material.absolutePermittivityFPerM,
    electrodeDigest: digest(request.prescribedPotentials),
    electrodeFaceIds: request.prescribedPotentials.map(group => group.faceIds[0]), runtime,
  };
  return { request, mesh, deck: generated.deck, identity: { ...unsigned, sourceDigest: digest(unsigned) } };
}

/** Bounded host-owned in-memory completion ledger. No caller supplied proof or
 * digest can publish a result; public methods accept a study/job ID only.
 * This is NOT registered with Bridge/browser/MCP capability admission. */
export class ElectrostaticAdmissionLifecycle {
  #jobs = new Map<string, Job>();
  private readonly reader: TrustedElectrostaticSourceReader;
  private readonly driver: ElectrostaticExecutionDriver;
  constructor(reader: TrustedElectrostaticSourceReader, driver: ElectrostaticExecutionDriver) {
    this.reader = reader; this.driver = driver;
  }

  submit(studyId: string): ElectrostaticJobStatus {
    if (typeof studyId !== 'string' || !/^[^\u0000-\u001f\u007f]{1,160}$/.test(studyId)
      || !studyId.trim()) throw new Error('ELECTROSTATIC_STUDY_ID_INVALID');
    this.prune();
    if (this.#jobs.size >= 16 || [...this.#jobs.values()].filter(job =>
      job.finishedAtMs === null || !job.status.cleanupConfirmed).length >= 2) {
      throw new Error('ELECTROSTATIC_JOB_LIMIT');
    }
    const jobId = 'electrical_' + randomUUID();
    const job: Job = {
      studyId, status: { jobId, state: 'queued', phase: 'queued', cleanupConfirmed: true, failureCode: null },
      controller: new AbortController(), source: null, result: null, completion: null,
      completionDigest: null, resultDigest: null, done: Promise.resolve(), finishedAtMs: null,
    };
    this.#jobs.set(jobId, job);
    // Assignment precedes execution, so queued cancellation can await the same
    // job completion barrier without a start/cleanup race.
    job.done = Promise.resolve().then(() => this.execute(job));
    return structuredClone(job.status);
  }

  getStatus(jobId: string): ElectrostaticJobStatus { return structuredClone(this.require(jobId).status); }

  async cancel(jobId: string): Promise<ElectrostaticJobStatus> {
    const job = this.require(jobId);
    if (job.status.state === 'queued' || job.status.state === 'running') {
      this.clear(job);
      job.status = { ...job.status, state: 'cancelled', phase: 'cancelling' };
      job.controller.abort();
      await job.done;
    }
    return structuredClone(job.status);
  }

  async getResult(jobId: string): Promise<CompletedElectrostaticResult | null> {
    const job = this.require(jobId);
    if (job.status.state !== 'succeeded' || !job.result || !job.source
      || !job.completion || !job.completionDigest || !job.resultDigest) return null;
    try {
      const before = await bindElectrostaticSource(job.studyId, this.reader);
      const after = await bindElectrostaticSource(job.studyId, this.reader);
      if (job.status.state !== 'succeeded') return null;
      const { resultDigest, ...unsigned } = job.result;
      const { resultDigest: electricalDigest, ...electricalUnsigned } = job.result.electrical;
      if (before.identity.sourceDigest !== job.source.identity.sourceDigest
        || after.identity.sourceDigest !== before.identity.sourceDigest
        || digest(job.completion) !== job.completionDigest
        || job.result.completionDigest !== job.completionDigest
        || digest(unsigned) !== job.resultDigest || resultDigest !== job.resultDigest
        || digest(electricalUnsigned) !== electricalDigest
        || electricalDigest !== job.result.normalizedElectricalResultDigest
        || job.result.jobId !== jobId
        || job.result.completedProviderState !== 'completed_converged'
        || digest(job.result.binding) !== digest(job.source.identity)
        || job.completion.jobId !== jobId || job.completion.normalizedElectricalResultDigest !== electricalDigest
        || job.completion.sourceDigest !== before.identity.sourceDigest
        || job.completion.cleanupConfirmed !== true || !job.status.cleanupConfirmed) {
        throw new Error('ELECTROSTATIC_COMPLETION_INVALID');
      }
      return structuredClone(job.result);
    } catch {
      this.clear(job);
      job.status = { ...job.status, state: 'failed', phase: 'stale_source_quarantined',
        failureCode: 'ELECTROSTATIC_SOURCE_OR_COMPLETION_INVALID' };
      job.finishedAtMs = Date.now();
      return null;
    }
  }

  /** Trusted persistence capture, not a request/import API. Only an existing
   * freshly rebound successful job can supply its private completion record. */
  async readCompletedLedger(jobId: string) {
    const result = await this.getResult(jobId);
    const job = this.require(jobId);
    if (!result || job.status.state !== 'succeeded' || !job.completion
      || !job.status.cleanupConfirmed) return null;
    return structuredClone({ studyId: job.studyId, result, completion: job.completion });
  }

  private async execute(job: Job): Promise<void> {
    if (job.status.state !== 'queued') { this.finishCancellation(job, true); return; }
    job.status = { ...job.status, state: 'running', phase: 'binding_trusted_source' };
    let outcome: ElectrostaticNativeOutcome | null = null;
    let invoked = false;
    try {
      const source = await bindElectrostaticSource(job.studyId, this.reader);
      const repeated = await bindElectrostaticSource(job.studyId, this.reader);
      if (source.identity.sourceDigest !== repeated.identity.sourceDigest) throw new Error('ELECTROSTATIC_SOURCE_CHANGED');
      if (job.controller.signal.aborted) { this.finishCancellation(job, true); return; }
      job.source = structuredClone(source);
      job.status = { ...job.status, phase: 'native_solver', cleanupConfirmed: false };
      invoked = true;
      outcome = await this.driver.execute({
        jobId: job.status.jobId, source: structuredClone(source), signal: job.controller.signal,
        onProgress: phase => {
          if (job.status.state === 'running') job.status = { ...job.status, phase };
        },
      });
      if (job.controller.signal.aborted) {
        this.finishCancellation(job, outcome.cleanupConfirmed); return;
      }
      if (outcome.jobId !== job.status.jobId || outcome.sourceDigest !== source.identity.sourceDigest
        || digest(outcome.runtime) !== digest(source.identity.runtime) || !outcome.cleanupConfirmed) {
        throw new Error('ELECTROSTATIC_NATIVE_BINDING_OR_CLEANUP_INVALID');
      }
      if (outcome.state !== 'completed_converged') throw new Error(outcome.failureCode);
      const nativeEvidence = electrostaticNativeEvidenceSchema.parse(outcome.nativeEvidence);
      job.status = { ...job.status, phase: 'validating_completion', cleanupConfirmed: true };
      const electrical = recoverCalculiXElectrostaticSlab(source.request, source.mesh, outcome.output);
      const current = await bindElectrostaticSource(job.studyId, this.reader);
      const final = await bindElectrostaticSource(job.studyId, this.reader);
      if (job.controller.signal.aborted) {
        this.finishCancellation(job, true); return;
      }
      if (current.identity.sourceDigest !== source.identity.sourceDigest
        || final.identity.sourceDigest !== source.identity.sourceDigest) throw new Error('ELECTROSTATIC_SOURCE_CHANGED');
      const completion = {
        schema: 'tunacad-electrostatic-provider-completion/0.1', jobId: job.status.jobId,
        sourceDigest: source.identity.sourceDigest, state: 'completed_converged',
        normalizedElectricalResultDigest: electrical.resultDigest,
        rawOutputDigest: electrical.rawOutputDigest, nativeEvidence,
        runtime: source.identity.runtime, cleanupConfirmed: true,
      };
      const unsigned = {
        schema: 'tunacad-electrostatic-completed-result/0.1' as const,
        jobId: job.status.jobId, completedProviderState: 'completed_converged' as const,
        binding: source.identity, normalizedElectricalResultDigest: electrical.resultDigest,
        completionDigest: digest(completion), electrical,
        status: 'proof_of_concept' as const, engineeringUsePermitted: false as const,
        providerAdmission: 'closed' as const,
      };
      if (Buffer.byteLength(JSON.stringify(unsigned)) > 16 * 1024 * 1024) throw new Error('ELECTROSTATIC_RESULT_LIMIT');
      job.completion = completion; job.completionDigest = digest(completion);
      job.resultDigest = digest(unsigned); job.result = { ...unsigned, resultDigest: job.resultDigest };
      job.status = { ...job.status, state: 'succeeded', phase: 'succeeded_cleaned',
        cleanupConfirmed: true, failureCode: null };
      job.finishedAtMs = Date.now();
    } catch (error) {
      const cleaned = outcome?.cleanupConfirmed ?? !invoked;
      if (job.controller.signal.aborted) { this.finishCancellation(job, cleaned); return; }
      this.clear(job);
      job.status = { ...job.status, state: 'failed',
        phase: cleaned ? 'failed_cleaned' : 'cleanup_pending', cleanupConfirmed: cleaned,
        failureCode: error instanceof Error ? error.message.slice(0, 200) : 'ELECTROSTATIC_PROVIDER_FAILED' };
      job.finishedAtMs = Date.now();
    }
  }
  private clear(job: Job) { job.result = null; job.resultDigest = null; job.completion = null; job.completionDigest = null; }
  private finishCancellation(job: Job, cleaned: boolean) {
    this.clear(job);
    job.status = { ...job.status, state: 'cancelled', phase: cleaned ? 'cancelled_cleaned' : 'cleanup_pending',
      cleanupConfirmed: cleaned, failureCode: cleaned ? null : 'ELECTROSTATIC_CLEANUP_FAILED' };
    job.finishedAtMs = Date.now();
  }
  private prune() {
    for (const [id, job] of this.#jobs) if (job.finishedAtMs !== null && job.status.cleanupConfirmed
      && Date.now() - job.finishedAtMs > 20 * 60_000) this.#jobs.delete(id);
  }
  private require(jobId: string): Job {
    this.prune(); const job = this.#jobs.get(jobId);
    if (!job) throw new Error('ELECTROSTATIC_JOB_NOT_FOUND');
    return job;
  }
}
