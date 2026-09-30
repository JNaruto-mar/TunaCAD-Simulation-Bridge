import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { NeutralFemMesh } from '../src/simulation/externalSimulationContracts.ts';
import { createCalculiXElectrostaticTwoLayerDeck,
  recoverCalculiXElectrostaticTwoLayer } from '../providers/calculix/CalculiXElectrostaticTwoLayer.mts';
import { verifyAndComposeTwoLayerMesh } from '../providers/gmsh/ElectrostaticTwoLayerMesh.mts';
import { electrostaticNativeEvidenceSchema, electrostaticRuntimeSchema,
  type ElectrostaticNativeOutcome, type ElectrostaticRuntimeIdentity } from './electrostaticAdmission.mts';
import { type ElectrostaticCadReaders, type ElectrostaticHostRecords } from './electrostaticLiveSource.mts';
import { ElectrostaticHostStorage, readElectrostaticHostJson,
  writeElectrostaticHostOnce } from './electrostaticHostStorage.mts';
import { verifyTwoLayerLiveSource } from './electrostaticTwoLayerSource.mts';
import { validateElectrostaticTwoLayer } from './electrostaticTwoLayerFoundation.mts';
import { digest } from './stableDigest.mts';

const jobPattern = /^electrical_[a-f0-9-]{36}$/;
const fail = (why: string): never => { throw new Error('ELECTROSTATIC_TWO_LAYER_ADMISSION_INVALID: ' + why); };
export interface TrustedTwoLayerSourceReader {
  /** Owning host readers, never constructed from submitted/caller JSON. */
  cad: ElectrostaticCadReaders;
  records: ElectrostaticHostRecords;
  readSealedRequest(studyId: string): Promise<unknown>;
  readLocalMeshes(studyId: string): Promise<[NeutralFemMesh, NeutralFemMesh]>;
  readCurrentRuntimeIdentity(): Promise<unknown>;
  meshSizeMm: number;
}
export type TwoLayerSourceSnapshot = Awaited<ReturnType<typeof bindTwoLayerSource>>;
export interface TwoLayerNativeDriver {
  execute(input: { jobId: string; source: TwoLayerSourceSnapshot; signal: AbortSignal;
    onProgress(phase: string): void }): Promise<ElectrostaticNativeOutcome>;
}
export interface TwoLayerJobStatus {
  jobId: string; state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  phase: string; cleanupConfirmed: boolean; failureCode: string | null;
}
type TwoLayerElectrical = ReturnType<typeof recoverCalculiXElectrostaticTwoLayer>;
export interface CompletedTwoLayerElectricalResult {
  schema: 'tunacad-electrostatic-two-layer-completed-result/0.1';
  jobId: string; studyId: string; completedProviderState: 'completed_converged';
  binding: TwoLayerSourceSnapshot['identity']; normalizedElectricalResultDigest: string;
  completionDigest: string; electrical: TwoLayerElectrical; resultDigest: string;
  status: 'proof_of_concept'; engineeringUsePermitted: false; providerAdmission: 'closed';
}
interface Job {
  studyId: string; status: TwoLayerJobStatus; controller: AbortController;
  revoked: boolean; result: CompletedTwoLayerElectricalResult | null;
  done: Promise<void>;
}

/** Fresh live CAD/material/FACE/export reads bracket the independently stored
 * local meshes and current executable identity. No caller-supplied proof is
 * accepted by this binder. */
export async function bindTwoLayerSource(studyId: string, reader: TrustedTwoLayerSourceReader) {
  const request = validateElectrostaticTwoLayer(await reader.readSealedRequest(studyId));
  if (request.studyId !== studyId) fail('study ID mismatch');
  const before = await verifyTwoLayerLiveSource(request, reader.records, reader.cad);
  const local = structuredClone(await reader.readLocalMeshes(studyId));
  if (!Array.isArray(local) || local.length !== 2) fail('two trusted local meshes required');
  const verified = verifyAndComposeTwoLayerMesh(request, local, reader.meshSizeMm);
  const generated = createCalculiXElectrostaticTwoLayerDeck(request, verified);
  const runtime = electrostaticRuntimeSchema.parse(await reader.readCurrentRuntimeIdentity());
  const after = await verifyTwoLayerLiveSource(request, reader.records, reader.cad);
  if (digest(before) !== digest(after) || before.projectRevision !== request.model.projectRevision)
    fail('source changed during bind');
  const domains = request.model.domains.map((entry, i) => {
    const d = entry as { domainId: string; partId: string; bodyId: string;
      geometryDigest: string; shape: { faces: Record<string, string> } };
    const material = request.materials[i] as { materialId: string;
      absolutePermittivityFPerM: number; source: unknown };
    return ({
    domainId: d.domainId, partId: d.partId, bodyId: d.bodyId,
    canonicalGeometryDigest: d.geometryDigest, faceDigest: digest(d.shape.faces),
    materialId: material.materialId,
    absolutePermittivityFPerM: material.absolutePermittivityFPerM,
    materialDigest: digest(material),
    provenanceDigest: digest(material.source),
  }); });
  const unsigned = {
    requestDigest: request.requestDigest, studyId, projectRevision: request.model.projectRevision,
    modelDigest: digest(request.model), domains,
    electrodeDigest: digest(request.prescribedPotentials),
    electrodeFaceIds: request.prescribedPotentials.map(e => (e as { faceId: string }).faceId),
    interfaceFaceIds: [request.model.interface.leftFaceId, request.model.interface.rightFaceId],
    nativeInterfaceDigest: before.nativeInterfaceDigest,
    localMeshDigests: local.map(m => digest({
      nodes: m.nodes, volumeElements: m.volumeElements,
      boundaryFacets: m.boundaryFacets, boundaryRegions: m.boundaryRegions,
      volumeRegions: m.volumeRegions, sourceGeometryDigest: m.geometryDigest,
    })),
    fragmentMeshDigest: verified.meshDigest,
    conformalInterfaceEvidenceDigest: digest(verified.interfaceEvidence),
    deckDigest: generated.deckDigest, runtime,
  };
  return { request, verified, deck: generated.deck,
    identity: { ...unsigned, sourceDigest: digest(unsigned) } };
}

/** Bounded protected host ledger: immutable content-addressed result plus a
 * separate completion pin and sticky quarantine tombstone. A stored digest is
 * never sufficient without fresh native source, mesh, deck and runtime reads. */
export class TwoLayerElectrostaticLifecycle {
  #jobs = new Map<string, Job>();
  #quarantined = new Set<string>();
  constructor(private readonly reader: TrustedTwoLayerSourceReader,
    private readonly driver: TwoLayerNativeDriver,
    private readonly storage: ElectrostaticHostStorage) {}
  private paths(id: string) {
    if (!jobPattern.test(id)) fail('invalid job ID');
    return {
      record: join(this.storage.paths.results, id + '.json'),
      pin: join(this.storage.paths['completion-catalog'], id + '.pin.json'),
      quarantine: join(this.storage.paths['completion-catalog'], id + '.quarantine.json'),
    };
  }
  submit(studyId: string): TwoLayerJobStatus {
    if (typeof studyId !== 'string' || !studyId.trim() || studyId.length > 160
      || [...studyId].some(c => c.charCodeAt(0) < 32)) fail('invalid study ID');
    if (this.#jobs.size >= 16 || [...this.#jobs.values()].filter(j =>
      j.status.state === 'queued' || j.status.state === 'running').length >= 2) fail('job limit');
    const id = 'electrical_' + randomUUID();
    const job: Job = { studyId, controller: new AbortController(), revoked: false,
      result: null, status: { jobId: id, state: 'queued', phase: 'queued',
        cleanupConfirmed: true, failureCode: null }, done: Promise.resolve() };
    this.#jobs.set(id, job);
    job.done = Promise.resolve().then(() => this.execute(job));
    return structuredClone(job.status);
  }
  getStatus(id: string) {
    const job = this.#jobs.get(id); if (!job) fail('job not found');
    return structuredClone(job.status);
  }
  async cancel(id: string) {
    const job = this.#jobs.get(id); if (!job) fail('job not found');
    if (job.status.state === 'queued' || job.status.state === 'running') {
      job.revoked = true; job.controller.abort(); job.result = null;
      await job.done;
      await this.quarantine(id);
    }
    return structuredClone(job.status);
  }
  async getResult(id: string): Promise<CompletedTwoLayerElectricalResult | null> {
    if (!jobPattern.test(id) || this.#quarantined.has(id)) return null;
    const job = this.#jobs.get(id);
    if (job && (job.revoked || job.status.state !== 'succeeded'
      || !job.status.cleanupConfirmed)) return null;
    try {
      const paths = this.paths(id);
      await this.storage.assertReady();
      try { const tombstone = await readElectrostaticHostJson(paths.quarantine, 2048);
        if (tombstone.jobId === id && tombstone.quarantined === true) return null;
        fail('malformed quarantine tombstone');
      } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
      const pin = await readElectrostaticHostJson(paths.pin, 2048);
      if (pin.schema !== 'tunacad-electrostatic-two-layer-completion-pin/0.1'
        || pin.jobId !== id || pin.configurationDigest !== this.storage.configurationDigest
        || !/^sha256:[a-f0-9]{64}$/.test(pin.recordDigest)) fail('completion pin invalid');
      const record = await readElectrostaticHostJson(paths.record);
      if (digest(record) !== pin.recordDigest
        || record.schema !== 'tunacad-electrostatic-two-layer-ledger/0.1'
        || record.jobId !== id || typeof record.studyId !== 'string') fail('record digest/identity invalid');
      const before = await bindTwoLayerSource(record.studyId, this.reader);
      this.validateRecord(record, before, id);
      const after = await bindTwoLayerSource(record.studyId, this.reader);
      this.validateRecord(record, after, id);
      if (job && (job.revoked || job.status.state !== 'succeeded')) return null;
      const pinAgain = await readElectrostaticHostJson(paths.pin, 2048);
      if (digest(pinAgain) !== digest(pin)) fail('pin changed during trusted read');
      await this.storage.assertReady();
      return structuredClone(record.result);
    } catch {
      await this.quarantine(id);
      if (job) { job.result = null; job.status = { ...job.status, state: 'failed',
        phase: 'retrieval_quarantined', failureCode: 'ELECTROSTATIC_TWO_LAYER_REBIND_INVALID' }; }
      return null;
    }
  }
  private validateRecord(record: any, source: TwoLayerSourceSnapshot, id: string) {
    const result = record.result, completion = record.completion;
    if (record.studyId !== source.request.studyId || !result || !completion
      || result.schema !== 'tunacad-electrostatic-two-layer-completed-result/0.1'
      || result.jobId !== id || result.studyId !== record.studyId
      || result.completedProviderState !== 'completed_converged'
      || result.status !== 'proof_of_concept' || result.engineeringUsePermitted !== false
      || result.providerAdmission !== 'closed' || result.binding.sourceDigest !== source.identity.sourceDigest
      || digest(result.binding) !== digest(source.identity)
      || result.normalizedElectricalResultDigest !== result.electrical.resultDigest
      || digest((({ resultDigest, ...rest }) => rest)(result.electrical)) !== result.electrical.resultDigest
      || digest((({ resultDigest, ...rest }) => rest)(result)) !== result.resultDigest
      || result.completionDigest !== digest(completion)
      || completion.jobId !== id || completion.state !== 'completed_converged'
      || completion.cleanupConfirmed !== true || completion.sourceDigest !== source.identity.sourceDigest
      || completion.normalizedElectricalResultDigest !== result.electrical.resultDigest
      || completion.rawOutputDigest !== result.electrical.rawOutputDigest
      || digest(completion.runtime) !== digest(source.identity.runtime)
      || result.electrical.requestDigest !== source.request.requestDigest
      || result.electrical.meshDigest !== source.identity.fragmentMeshDigest
      || result.electrical.interfaceEvidence.sharedFacetDigest
        !== source.verified.interfaceEvidence.sharedFacetDigest) fail('completion/source/result mismatch');
    electrostaticNativeEvidenceSchema.parse(completion.nativeEvidence);
  }
  private async quarantine(id: string) {
    this.#quarantined.add(id);
    try { await this.storage.assertReady();
      await writeElectrostaticHostOnce(this.paths(id).quarantine, {
        schema: 'tunacad-electrostatic-two-layer-quarantine/0.1',
        jobId: id, quarantined: true }, 2048);
    } catch { /* In-memory revocation remains sticky; no result is exposed. */ }
  }
  private async execute(job: Job) {
    if (job.revoked) { job.status = { ...job.status, state: 'cancelled', phase: 'cancelled_cleaned' }; return; }
    job.status = { ...job.status, state: 'running', phase: 'binding_live_source' };
    let outcome: ElectrostaticNativeOutcome | null = null, invoked = false;
    try {
      await this.storage.assertReady();
      const source = await bindTwoLayerSource(job.studyId, this.reader);
      const again = await bindTwoLayerSource(job.studyId, this.reader);
      if (source.identity.sourceDigest !== again.identity.sourceDigest)
        fail('source changed before dispatch');
      if (job.revoked) throw new Error('CANCELLED');
      job.status = { ...job.status, phase: 'native_solver', cleanupConfirmed: false };
      invoked = true;
      outcome = await this.driver.execute({ jobId: job.status.jobId, source,
        signal: job.controller.signal, onProgress: phase => {
          if (!job.revoked && job.status.state === 'running') job.status = { ...job.status, phase };
        } });
      if (job.revoked || job.controller.signal.aborted) throw new Error('CANCELLED');
      if (outcome.jobId !== job.status.jobId
        || outcome.sourceDigest !== source.identity.sourceDigest
        || digest(outcome.runtime) !== digest(source.identity.runtime)
        || outcome.cleanupConfirmed !== true) fail('native identity or cleanup');
      if (outcome.state !== 'completed_converged') fail(outcome.failureCode);
      const nativeEvidence = electrostaticNativeEvidenceSchema.parse(
        'nativeEvidence' in outcome ? outcome.nativeEvidence : fail('missing native evidence'));
      const electrical = recoverCalculiXElectrostaticTwoLayer(
        source.request, source.verified, outcome.output);
      const current = await bindTwoLayerSource(job.studyId, this.reader);
      const final = await bindTwoLayerSource(job.studyId, this.reader);
      if (job.revoked || job.controller.signal.aborted) throw new Error('CANCELLED');
      if (current.identity.sourceDigest !== source.identity.sourceDigest
        || final.identity.sourceDigest !== source.identity.sourceDigest)
        fail('source changed before completion');
      const completion = {
        schema: 'tunacad-electrostatic-two-layer-provider-completion/0.1',
        jobId: job.status.jobId, sourceDigest: source.identity.sourceDigest,
        state: 'completed_converged' as const, cleanupConfirmed: true as const,
        normalizedElectricalResultDigest: electrical.resultDigest,
        rawOutputDigest: electrical.rawOutputDigest, nativeEvidence,
        runtime: source.identity.runtime,
      };
      const unsigned = {
        schema: 'tunacad-electrostatic-two-layer-completed-result/0.1' as const,
        jobId: job.status.jobId, studyId: job.studyId,
        completedProviderState: 'completed_converged' as const, binding: source.identity,
        normalizedElectricalResultDigest: electrical.resultDigest,
        completionDigest: digest(completion), electrical,
        status: 'proof_of_concept' as const, engineeringUsePermitted: false as const,
        providerAdmission: 'closed' as const,
      };
      const result = { ...unsigned, resultDigest: digest(unsigned) };
      const record = { schema: 'tunacad-electrostatic-two-layer-ledger/0.1',
        jobId: job.status.jobId, studyId: job.studyId, completion, result };
      this.validateRecord(record, source, job.status.jobId);
      const paths = this.paths(job.status.jobId);
      await this.storage.assertReady();
      await writeElectrostaticHostOnce(paths.record, record);
      const pin = { schema: 'tunacad-electrostatic-two-layer-completion-pin/0.1',
        jobId: job.status.jobId, configurationDigest: this.storage.configurationDigest,
        recordDigest: digest(record) };
      if (job.revoked || job.controller.signal.aborted) throw new Error('CANCELLED');
      await writeElectrostaticHostOnce(paths.pin, pin, 2048);
      await this.storage.assertReady();
      if (job.revoked || job.controller.signal.aborted) throw new Error('CANCELLED');
      job.result = result;
      job.status = { ...job.status, state: 'succeeded', phase: 'succeeded_cleaned_persisted',
        cleanupConfirmed: true, failureCode: null };
    } catch (error) {
      job.result = null;
      const cleaned = outcome?.cleanupConfirmed ?? !invoked;
      job.status = { ...job.status, state: job.revoked ? 'cancelled' : 'failed',
        phase: cleaned ? (job.revoked ? 'cancelled_cleaned' : 'failed_cleaned') : 'cleanup_pending',
        cleanupConfirmed: cleaned,
        failureCode: job.revoked ? (cleaned ? null : 'ELECTROSTATIC_TWO_LAYER_CLEANUP_FAILED')
          : error instanceof Error ? error.message.slice(0, 200) : 'ELECTROSTATIC_TWO_LAYER_FAILED' };
      await this.quarantine(job.status.jobId);
    }
  }
}
