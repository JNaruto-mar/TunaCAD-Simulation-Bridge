import { randomUUID } from 'node:crypto';
import { bindFatigueToStructuralHistory, type FatigueStructuralBinding,
  type TrustedStructuralHistoryReader } from './fatigueStructuralBinding.mts';
import { evaluateFatigueReference, validateFatigueReferenceInput,
  type FatigueReferenceInput, type FatigueReferenceResult } from './fatigueReference.mts';
import { digest } from './stableDigest.mts';

export type FatigueJobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export interface FatigueJobStatus {
  jobId: string;
  state: FatigueJobState;
  updatedAt: string;
  failureCode: 'SIM9_FATIGUE_SOURCE_INVALID' | 'SIM9_FATIGUE_ADMISSION_INVALID' | null;
}
export type AdmittedFatigueResult = Omit<FatigueReferenceResult, 'schema' | 'sourceVerification'> & {
  schema: 'tunacad-fatigue-admitted-result/0.1';
  fatigueJobId: string;
  structuralJobId: string;
  structuralResultDigest: string;
  fieldDatasetDigest: string;
  bindingProofDigest: string;
  sourceVerification: 'verified_trusted_structural_history';
  calculation: 'bounded_analytical_s_n_reference';
};
interface Job {
  input: FatigueReferenceInput;
  status: FatigueJobStatus;
  proofDigest: string | null;
  result: AdmittedFatigueResult | null;
  resultDigest: string | null;
  finishedAtMs: number | null;
}
const maximumJobs = 64;
const resultRetentionMs = 20 * 60_000;

/** Provider-only, in-memory admission. A caller cannot supply a binding proof:
 * each proof is minted by fresh reads from the trusted structural provider. */
export class FatigueAdmissionLifecycle {
  private readonly jobs = new Map<string, Job>();
  private readonly reader: TrustedStructuralHistoryReader;
  constructor(reader: TrustedStructuralHistoryReader) { this.reader = reader; }

  submit(value: unknown): FatigueJobStatus {
    const input = structuredClone(validateFatigueReferenceInput(value));
    this.pruneExpired();
    if (this.jobs.size >= maximumJobs) throw new Error('SIM9_FATIGUE_ADMISSION_LIMIT: job capacity reached.');
    const jobId = 'fatigue_' + randomUUID();
    const status: FatigueJobStatus = {
      jobId, state: 'queued', updatedAt: new Date().toISOString(), failureCode: null,
    };
    const job: Job = { input, status, proofDigest: null, result: null,
      resultDigest: null, finishedAtMs: null };
    this.jobs.set(jobId, job);
    queueMicrotask(() => void this.execute(job));
    return structuredClone(status);
  }

  getStatus(jobId: string): FatigueJobStatus {
    return structuredClone(this.require(jobId).status);
  }

  cancel(jobId: string): FatigueJobStatus {
    const job = this.require(jobId);
    if (job.status.state === 'queued' || job.status.state === 'running') {
      this.transition(job, 'cancelled', null);
    }
    return structuredClone(job.status);
  }

  async getResult(jobId: string): Promise<AdmittedFatigueResult | null> {
    const job = this.require(jobId);
    if (job.status.state !== 'succeeded' || !job.result || !job.proofDigest
      || !job.resultDigest) return null;
    try {
      const current = await bindFatigueToStructuralHistory(job.input, this.reader);
      if (job.status.state !== 'succeeded' || digest(current) !== job.proofDigest
        || digest(job.result) !== job.resultDigest
        || current.inputDigest !== job.input.inputDigest
        || digest(job.input.material.snPoints) !== job.result.snCurveDigest
        || JSON.stringify(job.input.material.provenance) !== JSON.stringify(job.result.materialProvenance)) {
        this.transition(job, 'failed', 'SIM9_FATIGUE_SOURCE_INVALID');
        return null;
      }
      return structuredClone(job.result);
    } catch {
      this.transition(job, 'failed', 'SIM9_FATIGUE_SOURCE_INVALID');
      return null;
    }
  }

  private async execute(job: Job): Promise<void> {
    if (job.status.state !== 'queued') return;
    this.transition(job, 'running', null);
    try {
      const before = await bindFatigueToStructuralHistory(job.input, this.reader);
      if (job.status.state !== 'running') return;
      const reference = evaluateFatigueReference(job.input);
      const after = await bindFatigueToStructuralHistory(job.input, this.reader);
      if (job.status.state !== 'running') return;
      if (!this.sameProof(job.input, before, after, reference)) {
        this.transition(job, 'failed', 'SIM9_FATIGUE_SOURCE_INVALID');
        return;
      }
      const { schema: _schema, sourceVerification: _sourceVerification, ...calculation } = reference;
      const result: AdmittedFatigueResult = {
        ...calculation,
        schema: 'tunacad-fatigue-admitted-result/0.1',
        fatigueJobId: job.status.jobId,
        structuralJobId: before.structuralJobId,
        structuralResultDigest: before.structuralResultDigest,
        fieldDatasetDigest: before.fieldDatasetDigest,
        bindingProofDigest: digest(before),
        sourceVerification: 'verified_trusted_structural_history',
        calculation: 'bounded_analytical_s_n_reference',
      };
      job.proofDigest = digest(before);
      job.result = result;
      job.resultDigest = digest(result);
      this.transition(job, 'succeeded', null, false);
    } catch {
      if (job.status.state === 'running') this.transition(job, 'failed', 'SIM9_FATIGUE_ADMISSION_INVALID');
    }
  }

  private sameProof(input: FatigueReferenceInput, before: FatigueStructuralBinding,
    after: FatigueStructuralBinding, reference: FatigueReferenceResult): boolean {
    return before.verification === 'matched_trusted_result_and_history_snapshot'
      && before.providerAdmission === 'closed'
      && digest(before) === digest(after)
      && before.inputDigest === input.inputDigest
      && reference.inputDigest === input.inputDigest
      && reference.sourceVerification === 'caller_supplied_digest_not_provider_verified'
      && reference.engineeringUsePermitted === false
      && reference.snCurveDigest === digest(input.material.snPoints)
      && JSON.stringify(reference.materialProvenance) === JSON.stringify(input.material.provenance)
      && reference.materialId === input.material.materialId;
  }

  private transition(job: Job, state: FatigueJobState,
    failureCode: FatigueJobStatus['failureCode'], clear = true): void {
    if (clear) { job.proofDigest = null; job.result = null; job.resultDigest = null; }
    job.finishedAtMs = state === 'queued' || state === 'running' ? null : Date.now();
    job.status = { ...job.status, state, updatedAt: new Date().toISOString(), failureCode };
  }
  private pruneExpired(): void {
    for (const [id, job] of this.jobs) {
      if (job.finishedAtMs !== null && Date.now() - job.finishedAtMs > resultRetentionMs) this.jobs.delete(id);
    }
  }
  private require(jobId: string): Job {
    this.pruneExpired();
    const job = this.jobs.get(jobId);
    if (!job) throw new Error('SIM9_FATIGUE_JOB_NOT_FOUND');
    return job;
  }
}
