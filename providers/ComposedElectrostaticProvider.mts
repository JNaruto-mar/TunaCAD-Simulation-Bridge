import { randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { ExternalMeshProvider, NeutralFemMesh, SimulationProviderStatus } from '../src/simulation/externalSimulationContracts.ts';
import { ElectrostaticAdmissionLifecycle, type TrustedElectrostaticSourceReader,
  type ElectrostaticExecutionDriver, type ElectrostaticRuntimeIdentity } from '../simulation-bridge/electrostaticAdmission.mts';
import { ElectrostaticHostStorage, readElectrostaticHostJson, writeElectrostaticHostOnce } from '../simulation-bridge/electrostaticHostStorage.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { FileElectrostaticHostRecords, ProtectedElectrostaticLedger } from '../simulation-bridge/electrostaticHostRecords.mts';
import { validateElectrostaticFoundation, type ElectrostaticFoundation } from '../simulation-bridge/electrostaticFoundation.mts';
import { electrostaticStepGeometryDigest } from '../simulation-bridge/electrostaticStepIdentity.mts';
import { electrostaticSlabMeshInputs } from './calculix/CalculiXElectrostaticSlab.mts';
import { buildElectricalFields, electricalFieldPage } from './calculix/CalculiXElectrostaticFields.mts';
import type { ElectrostaticDispatchCapabilities, ElectrostaticDispatchProvider } from '../simulation-bridge/electrostaticDispatchContract.mts';

interface Run {
  id: string; request: ElectrostaticFoundation; step: Uint8Array | null;
  controller: AbortController; status: SimulationProviderStatus; done: Promise<void>;
  meshRunId?: string; lifecycle?: ElectrostaticAdmissionLifecycle; electricalId?: string;
  ledger?: ProtectedElectrostaticLedger; revoked: boolean; archiveRoot?: string;
  approval: { preparationId: string; authorizationId: string };
  storage?: ElectrostaticHostStorage; dispatchDigest?: string;
  cancellation?: Promise<SimulationProviderStatus>;
  records?: FileElectrostaticHostRecords;
  fields?: ReturnType<typeof buildElectricalFields>;
  fieldResultDigest?: string;
}
/** Reuses the validated mesher, electrical lifecycle and protected ledger.
 * Host records describe approved immutable transferred geometry, NOT current
 * browser CAD. Live CAD checks bracket browser transfer/result publication. */
export class ComposedElectrostaticProvider implements ElectrostaticDispatchProvider {
  private readonly runs = new Map<string, Run>();
  constructor(readonly capabilities: ElectrostaticDispatchCapabilities,
    private readonly mesher: ExternalMeshProvider & { confirmCleanup(id: string): Promise<boolean> },
    private readonly driver: ElectrostaticExecutionDriver,
    private readonly currentRuntime: () => Promise<ElectrostaticRuntimeIdentity>,
    private readonly storageParent: string) {}

  async submit(value: ElectrostaticFoundation, step: Uint8Array, approval: Run['approval']) {
    const request = validateElectrostaticFoundation(value);
    if (!(step instanceof Uint8Array) || step.length > this.capabilities.maximumStepBytes
      || await electrostaticStepGeometryDigest(step) !== request.model.domains[0].geometryDigest) {
      throw new Error('BRIDGE_ELECTROSTATIC_SOURCE_MISMATCH');
    }
    if (!isAbsolute(this.storageParent) || !(await lstat(this.storageParent)).isDirectory()) {
      throw new Error('BRIDGE_ELECTROSTATIC_STORAGE_UNAVAILABLE');
    }
    if (this.runs.size >= 4 || [...this.runs.values()].some(run =>
      ['running', 'queued'].includes(run.status.status))) throw new Error('BRIDGE_BUSY');
    const id = 'electrical_' + randomUUID(), acceptedAt = new Date().toISOString();
    if (!/^simprep_electrical-[a-f0-9-]{36}$/.test(approval.preparationId)
      || !/^[a-f0-9]{64}$/.test(approval.authorizationId)) throw new Error('BRIDGE_ELECTROSTATIC_APPROVAL_INVALID');
    const run: Run = { id, request, approval: structuredClone(approval), step: new Uint8Array(step), controller: new AbortController(),
      revoked: false, status: { providerRunId: id, status: 'queued', phase: 'queued',
        progress: 0, updatedAt: acceptedAt }, done: Promise.resolve() };
    this.runs.set(id, run);
    run.done = Promise.resolve().then(() => this.execute(run));
    return { providerRunId: id, acceptedAt };
  }
  async getStatus(id: string) { return structuredClone(this.require(id).status); }
  async getResult(id: string) {
    const run = this.require(id);
    if (run.revoked || run.status.status !== 'succeeded' || !run.ledger || !run.electricalId) return null;
    const result = await run.ledger.getResult(run.electricalId);
    if (run.revoked || run.status.status !== 'succeeded') return null;
    if (!result) { this.fail(run, 'ELECTROSTATIC_DURABLE_RESULT_QUARANTINED'); return null; }
    try {
      if (!run.storage || !run.dispatchDigest) throw new Error('missing dispatch pin');
      await run.storage.assertReady();
      const pin = await readElectrostaticHostJson(join(run.storage.paths['source-catalog'], 'dispatch.pin.json'), 4096);
      const expected = { schema: 'tunacad-electrostatic-approved-dispatch/0.1', ...run.approval,
        providerRunId: run.id, electricalJobId: result.jobId, requestDigest: run.request.requestDigest,
        canonicalSourceDigest: run.request.model.domains[0].geometryDigest, resultDigest: result.resultDigest };
      if (digest(pin) !== run.dispatchDigest || digest(expected) !== run.dispatchDigest) throw new Error('dispatch pin mismatch');
      if (!run.records) throw new Error('missing trusted mesh records');
      const mesh = await run.records.readValidatedMesh(run.request.studyId);
      if (!run.fields || run.fieldResultDigest !== result.resultDigest) {
        run.fields = buildElectricalFields(run.id, result, mesh);
        run.fieldResultDigest = result.resultDigest;
      }
      await run.storage.assertReady();
      if (run.revoked) return null;
      const output = { schema: 'tunacad-electrostatic-dispatch-result/0.1' as const,
        ...run.approval, providerRunId: run.id, completion: result,
        fieldDatasets: [...run.fields.values()].map(field => structuredClone(field.descriptor)) };
      return { ...output, dispatchDigest: digest(output) };
    } catch { this.fail(run, 'ELECTROSTATIC_DISPATCH_PIN_QUARANTINED'); return null; }
  }
  async getFieldDataset(id: string, datasetId: string, cursor = '0', limit = 128) {
    const result = await this.getResult(id), run = this.require(id);
    const field = run.fields?.get(datasetId);
    if (!result || run.revoked || !field || !result.fieldDatasets.some(d => d.datasetId === datasetId)) {
      throw new Error('BRIDGE_ELECTROSTATIC_FIELD_QUARANTINED');
    }
    return structuredClone(electricalFieldPage(field, cursor, limit));
  }
  async cancel(id: string) {
    const run = this.require(id);
    if (!run.cancellation) {
      run.revoked = true; run.controller.abort();
      run.cancellation = (async () => {
        if (run.meshRunId) await this.mesher.cancel(run.meshRunId);
        if (run.lifecycle && run.electricalId) await run.lifecycle.cancel(run.electricalId);
        await run.done;
        // Trigger sticky ledger quarantine against the revoked trusted source.
        if (run.ledger && run.electricalId) await run.ledger.getResult(run.electricalId);
        run.status = { ...run.status, status: 'cancelled', progress: null };
        return structuredClone(run.status);
      })();
    }
    return structuredClone(await run.cancellation);
  }
  private require(id: string) { const run = this.runs.get(id); if (!run) throw new Error('BRIDGE_NOT_FOUND'); return run; }
  private fail(run: Run, code: string) {
    const safeCode = /^[A-Z][A-Z_]{1,159}/.exec(code)?.[0] ?? 'ELECTROSTATIC_DISPATCH_FAILED';
    run.status = { ...run.status, status: 'failed', phase: 'quarantined', progress: null,
      failure: { code: safeCode, message: 'Electrical completion is unavailable or quarantined.' }, updatedAt: new Date().toISOString() };
  }
  private async execute(run: Run) {
    let mesh: NeutralFemMesh | null = null;
    const active = () => { if (run.revoked || run.controller.signal.aborted) throw new Error('ELECTROSTATIC_CANCELLED'); };
    try {
      active();
      const { meshRequest, descriptor } = electrostaticSlabMeshInputs(run.request, 2);
      run.status = { ...run.status, status: 'running', phase: 'meshing_approved_step' };
      const submitted = await this.mesher.submit(meshRequest, { descriptor,
        async export(format) {
          active();
          if (format !== 'step' || !run.step) throw new Error('ELECTROSTATIC_TRANSFER_INVALID');
          return new Uint8Array(run.step);
        } });
      run.meshRunId = submitted.meshRunId;
      active();
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        active();
        const state = await this.mesher.getStatus(run.meshRunId);
        if (state.status === 'succeeded') { mesh = await this.mesher.getMesh(run.meshRunId); break; }
        if (['failed', 'cancelled'].includes(state.status)) throw new Error(state.failure?.code ?? 'ELECTROSTATIC_MESH_FAILED');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (!mesh || !await this.mesher.confirmCleanup(run.meshRunId)) throw new Error('ELECTROSTATIC_MESH_OR_CLEANUP_INVALID');
      active();
      // All reads authenticate the approved transfer and current runtime.
      // They deliberately make no assertion about current browser CAD truth.
      const readApproved = async () => {
        active();
        if (!run.step || await electrostaticStepGeometryDigest(run.step) !== run.request.model.domains[0].geometryDigest) {
          throw new Error('ELECTROSTATIC_APPROVED_SOURCE_CHANGED');
        }
        return structuredClone(run.request);
      };
      const reader: TrustedElectrostaticSourceReader = {
        async readCurrentProjectRevision() { return (await readApproved()).model.projectRevision; },
        readSealedRequest: readApproved,
        async readValidatedMesh() { await readApproved(); return structuredClone(mesh!); },
        readCurrentRuntimeIdentity: this.currentRuntime,
      };
      run.archiveRoot = join(this.storageParent, run.id);
      const storage = await ElectrostaticHostStorage.provisionNew(run.archiveRoot);
      run.storage = storage;
      active();
      const records = new FileElectrostaticHostRecords(storage, this.currentRuntime, reader);
      run.records = records;
      await records.publishStudy(run.request.studyId);
      const durableReader: TrustedElectrostaticSourceReader = {
        async readCurrentProjectRevision() { return (await readApproved()).model.projectRevision; },
        async readSealedRequest(id) {
          const current = await readApproved(), stored = await records.readSealedRequest(id);
          if (stored.requestDigest !== current.requestDigest) throw new Error('ELECTROSTATIC_DURABLE_SOURCE_MISMATCH');
          return stored;
        },
        async readValidatedMesh(id) { await readApproved(); return records.readValidatedMesh(id); },
        readCurrentRuntimeIdentity: this.currentRuntime,
      };
      run.lifecycle = new ElectrostaticAdmissionLifecycle(durableReader, this.driver);
      active();
      run.electricalId = run.lifecycle.submit(run.request.studyId).jobId;
      run.status = { ...run.status, phase: 'electrical_provider_lifecycle' };
      const completionDeadline = Date.now() + 120_000;
      while (Date.now() < completionDeadline) {
        active();
        const state = run.lifecycle.getStatus(run.electricalId);
        if (state.state === 'succeeded') break;
        if (['failed', 'cancelled'].includes(state.state)) throw new Error(state.failureCode ?? 'ELECTROSTATIC_PROVIDER_FAILED');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (!await run.lifecycle.getResult(run.electricalId)) throw new Error('ELECTROSTATIC_COMPLETION_MISSING');
      active();
      run.status = { ...run.status, phase: 'persisting_validated_completion' };
      run.ledger = new ProtectedElectrostaticLedger(storage, durableReader, run.lifecycle);
      await run.ledger.save(run.electricalId);
      active();
      if (!await run.ledger.getResult(run.electricalId)) throw new Error('ELECTROSTATIC_DURABLE_REPLAY_FAILED');
      active();
      const completed = await run.ledger.getResult(run.electricalId);
      if (!completed) throw new Error('ELECTROSTATIC_DURABLE_REPLAY_FAILED');
      const dispatch = { schema: 'tunacad-electrostatic-approved-dispatch/0.1', ...run.approval,
        providerRunId: run.id, electricalJobId: completed.jobId, requestDigest: run.request.requestDigest,
        canonicalSourceDigest: run.request.model.domains[0].geometryDigest, resultDigest: completed.resultDigest };
      await writeElectrostaticHostOnce(join(storage.paths['source-catalog'], 'dispatch.pin.json'), dispatch, 4096);
      run.dispatchDigest = digest(dispatch);
      active();
      run.status = { ...run.status, status: 'succeeded', phase: 'succeeded_cleaned_persisted',
        progress: 1, updatedAt: new Date().toISOString() };
    } catch (error) {
      if (run.meshRunId) await this.mesher.cancel(run.meshRunId);
      if (run.lifecycle && run.electricalId) await run.lifecycle.cancel(run.electricalId);
      this.fail(run, error instanceof Error ? error.message : 'ELECTROSTATIC_DISPATCH_FAILED');
    } finally {
      const cleaned = (!run.meshRunId || await this.mesher.confirmCleanup(run.meshRunId).catch(() => false))
        && (!run.lifecycle || !run.electricalId || run.lifecycle.getStatus(run.electricalId).cleanupConfirmed);
      if (!cleaned) this.fail(run, 'ELECTROSTATIC_CLEANUP_PENDING');
      if (run.revoked) run.status = { ...run.status, status: 'cancelled',
        phase: cleaned ? 'cancelled_cleaned' : 'cancelled_cleanup_pending' };
    }
  }
}
