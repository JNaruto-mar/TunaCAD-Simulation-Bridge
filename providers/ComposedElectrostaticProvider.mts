import { randomUUID } from 'node:crypto';
import type { ExternalMeshProvider, NeutralFemMesh, SimulationProviderStatus } from '../src/simulation/externalSimulationContracts.ts';
import { ElectrostaticAdmissionLifecycle, type TrustedElectrostaticSourceReader,
  type ElectrostaticExecutionDriver, type ElectrostaticRuntimeIdentity } from '../simulation-bridge/electrostaticAdmission.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { validateElectrostaticFoundation, type ElectrostaticFoundation } from '../simulation-bridge/electrostaticFoundation.mts';
import { electrostaticStepGeometryDigest } from '../simulation-bridge/electrostaticStepIdentity.mts';
import { electrostaticSlabMeshInputs } from './calculix/CalculiXElectrostaticSlab.mts';
import { buildElectricalFields, electricalFieldPage } from './calculix/CalculiXElectrostaticFields.mts';
import type { ElectrostaticDispatchCapabilities, ElectrostaticDispatchProvider } from '../simulation-bridge/electrostaticDispatchContract.mts';

interface Run {
  id: string; request: ElectrostaticFoundation; step: Uint8Array | null;
  controller: AbortController; status: SimulationProviderStatus; done: Promise<void>;
  meshRunId?: string; lifecycle?: ElectrostaticAdmissionLifecycle; electricalId?: string;
  revoked: boolean; mesh?:NeutralFemMesh; meshFingerprint?:string; completionDigest?:string;
  approval: { preparationId: string; authorizationId: string };
  dispatchDigest?: string;
  cancellation?: Promise<SimulationProviderStatus>;
  executionFailure?:unknown;
  cleanupFailure?:unknown;
  archived?:boolean;
  fields?: ReturnType<typeof buildElectricalFields>;
  fieldResultDigest?: string;
}
/** Reuses the validated mesher/electrical lifecycle and their per-job scratch.
 * Host records describe approved immutable transferred geometry, NOT current
 * browser CAD. Live CAD checks bracket browser transfer/result publication. */
export class ComposedElectrostaticProvider implements ElectrostaticDispatchProvider {
  private readonly runs = new Map<string, Run>();
  constructor(readonly capabilities: ElectrostaticDispatchCapabilities,
    private readonly mesher: ExternalMeshProvider & { confirmCleanup(id: string): Promise<boolean> },
    private readonly driver: ElectrostaticExecutionDriver,
    private readonly currentRuntime: () => Promise<ElectrostaticRuntimeIdentity>,
    _legacyStorageParent?: string) {} // Compatibility argument only; never opened or modified.

  async submit(value: ElectrostaticFoundation, step: Uint8Array, approval: Run['approval']) {
    const request = validateElectrostaticFoundation(value);
    if (!(step instanceof Uint8Array) || step.length > this.capabilities.maximumStepBytes
      || await electrostaticStepGeometryDigest(step) !== request.model.domains[0].geometryDigest) {
      throw new Error('BRIDGE_ELECTROSTATIC_SOURCE_MISMATCH');
    }
    // Eviction requires a verified durable project save and confirmed cleanup.
    if(this.runs.size>=4)for(const [id,old] of this.runs){if(old.archived&&old.status.status==='succeeded'&&!old.cleanupFailure){this.runs.delete(id);break;}}
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
    if (run.revoked || run.status.status !== 'succeeded' || !run.lifecycle || !run.electricalId) return null;
    const result = await run.lifecycle.getResult(run.electricalId);
    if (run.revoked || run.status.status !== 'succeeded') return null;
    if (!result) { this.fail(run, 'ELECTROSTATIC_DURABLE_RESULT_QUARANTINED'); return null; }
    try {
      if (!run.dispatchDigest || !run.mesh || result.resultDigest!==run.completionDigest) throw new Error('completion identity mismatch');
      const expected = { schema: 'tunacad-electrostatic-approved-dispatch/0.1', ...run.approval,
        providerRunId: run.id, electricalJobId: result.jobId, requestDigest: run.request.requestDigest,
        canonicalSourceDigest: run.request.model.domains[0].geometryDigest, resultDigest: result.resultDigest };
      if (digest(expected) !== run.dispatchDigest || digest(run.mesh)!==run.meshFingerprint) throw new Error('dispatch/mesh mismatch');
      const mesh=run.mesh;
      if (!run.fields || run.fieldResultDigest !== result.resultDigest) {
        run.fields = buildElectricalFields(run.id, result, mesh);
        run.fieldResultDigest = result.resultDigest;
      }
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
  async captureNewPortableFields(id:string,signal:AbortSignal){
    signal.throwIfAborted();const before=await this.getResult(id),run=this.require(id);
    if(!before||run.revoked||!run.fields)throw Error('PORTABLE_EXPORT_COMPLETION_REQUIRED');
    const datasets=[];let bytes=16384,triangles=0;
    for(const descriptor of before.fieldDatasets){
      signal.throwIfAborted();const field=run.fields.get(descriptor.datasetId);
      if(!field||digest(field.descriptor)!==digest(descriptor))throw Error('PORTABLE_EXPORT_ELECTRICAL_FIELDS_MISMATCH');
      bytes+=Buffer.byteLength(JSON.stringify(field));triangles+=field.triangles.length;
      if(bytes>32*1024*1024||triangles>100000)throw Error('PORTABLE_EXPORT_ELECTRICAL_FIELD_BUDGET');
      datasets.push(structuredClone(field));
    }
    // Immutable in-memory collection avoids hundreds of repeated ACL helpers;
    // BOTH boundary checks freshly verify completion/source/runtime bindings.
    const after=await this.getResult(id);signal.throwIfAborted();
    if(!after||run.revoked||after.dispatchDigest!==before.dispatchDigest)throw Error('PORTABLE_EXPORT_COMPLETION_CHANGED');
    return {result:after,datasets};
  }
  async cancel(id: string) {
    const run = this.require(id);
    if(run.status.status==='succeeded'&&!run.revoked){
      await run.done;
      const clean=(!run.meshRunId||await this.mesher.confirmCleanup(run.meshRunId).catch(()=>false))
        &&(!run.lifecycle||!run.electricalId||run.lifecycle.getStatus(run.electricalId).cleanupConfirmed);
      if(run.status.status==='succeeded'&&clean&&!run.cleanupFailure)return structuredClone(run.status);
    }
    if (!run.cancellation) {
      run.revoked = true; run.controller.abort();
      run.cancellation = (async () => {
        const failures:unknown[]=[];
        // One failing cleanup must not prevent the other native stage draining.
        try{if(run.meshRunId)await this.mesher.cancel(run.meshRunId);}catch(error){failures.push(error);}
        try{if(run.lifecycle&&run.electricalId)await run.lifecycle.cancel(run.electricalId);}catch(error){failures.push(error);}
        try{await run.done;}catch(error){failures.push(error);}
        const cleaned=(!run.meshRunId||await this.mesher.confirmCleanup(run.meshRunId).catch(()=>false))
          &&(!run.lifecycle||!run.electricalId||run.lifecycle.getStatus(run.electricalId).cleanupConfirmed);
        if(run.cleanupFailure)failures.push(run.cleanupFailure);
        if(!cleaned)failures.push(Error('ELECTROSTATIC_CLEANUP_PENDING'));
        if(failures.length){
          run.status={...run.status,status:'cancelled',phase:'cancelled_cleanup_pending',progress:null};
          throw new AggregateError(failures,'ELECTROSTATIC_CLEANUP_PENDING',{cause:run.executionFailure??failures[0]});
        }
        // The revoked source reader cannot produce another completed result.
        run.status = { ...run.status, status: 'cancelled', phase:'cancelled_cleaned', progress: null };
        return structuredClone(run.status);
      })();
    }
    return structuredClone(await run.cancellation);
  }
  async acknowledgeSavedProject(id:string){
    const run=this.require(id);if(run.status.status!=='succeeded'||run.cleanupFailure)throw Error('BRIDGE_PROVIDER_CLEANUP_UNCONFIRMED');
    const status=await this.releaseResources(id);if(status.status!=='succeeded')throw Error('BRIDGE_PROVIDER_CLEANUP_UNCONFIRMED');run.archived=true;
  }
  async releaseResources(id:string){
    const run=this.require(id),before=structuredClone(run.status);
    if(!['succeeded','failed','cancelled'].includes(before.status))throw Error('BRIDGE_JOB_NOT_TERMINAL');
    const after=await this.cancel(id);
    if(after.status==='succeeded')return after; // Retain the verified numerical reader.
    const status=before.status==='failed'?{...after,status:'failed' as const,phase:'failed_cleaned',failure:before.failure??after.failure}:after;
    this.runs.delete(id); // Runtime handle only; immutable evidence is untouched.
    return status;
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
      run.lifecycle = new ElectrostaticAdmissionLifecycle(reader, this.driver);
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
      const completed=await run.lifecycle.getResult(run.electricalId);
      if(!completed||!run.lifecycle.getStatus(run.electricalId).cleanupConfirmed)throw Error('ELECTROSTATIC_COMPLETION_OR_CLEANUP_INVALID');
      run.mesh=structuredClone(mesh);run.meshFingerprint=digest(run.mesh);run.completionDigest=completed.resultDigest;
      const dispatch = { schema: 'tunacad-electrostatic-approved-dispatch/0.1', ...run.approval,
        providerRunId: run.id, electricalJobId: completed.jobId, requestDigest: run.request.requestDigest,
        canonicalSourceDigest: run.request.model.domains[0].geometryDigest, resultDigest: completed.resultDigest };
      run.dispatchDigest = digest(dispatch);
      active();
      run.status = { ...run.status, status: 'succeeded', phase: 'succeeded_cleaned',
        progress: 1, updatedAt: new Date().toISOString() };
    } catch (error) {
      run.executionFailure??=error;
      this.fail(run, error instanceof Error ? error.message : 'ELECTROSTATIC_DISPATCH_FAILED');
      // Contain cleanup errors in the terminal job state; never let run.done
      // reject unobserved and crash the owner before it can release resources.
      const cleanup=await Promise.allSettled([
        Promise.resolve().then(()=>run.meshRunId?this.mesher.cancel(run.meshRunId):undefined),
        Promise.resolve().then(()=>run.lifecycle&&run.electricalId?run.lifecycle.cancel(run.electricalId):undefined),
      ]);
      const failures=cleanup.flatMap(r=>r.status==='rejected'?[r.reason]:[]);
      if(failures.length)run.cleanupFailure=new AggregateError(failures,'ELECTROSTATIC_CLEANUP_PENDING',{cause:error});
    } finally {
      const cleaned = (!run.meshRunId || await this.mesher.confirmCleanup(run.meshRunId).catch(() => false))
        && (!run.lifecycle || !run.electricalId || run.lifecycle.getStatus(run.electricalId).cleanupConfirmed);
      if (!cleaned||run.cleanupFailure){
        if(!run.status.failure)this.fail(run,'ELECTROSTATIC_CLEANUP_PENDING');
        run.status={...run.status,phase:'cleanup_pending'};
      }
      if (run.revoked) run.status = { ...run.status, status: 'cancelled',
        phase: cleaned&&!run.cleanupFailure ? 'cancelled_cleaned' : 'cancelled_cleanup_pending' };
    }
  }
}
