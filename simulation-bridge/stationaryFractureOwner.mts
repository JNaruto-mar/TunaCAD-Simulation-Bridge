import * as z from 'zod/v4';
import { randomBytes } from 'node:crypto';
import { digest } from './stableDigest.mts';
import type {RetainFracturePilotEvidence} from './fracturePilotEvidenceStore.mts';
import { createNativeStationaryFracturePilot, createControlledStationaryFracturePilot,
  inspectApprovedFractureModel, type ApprovedFractureModel, type FracturePilotHost } from '../providers/StationaryFracturePilotAdapter.mts';

const PROVIDER = 'gmsh-4.15.2+calculix-2.16-stationary-fracture/0.1' as const;
const RESULT = 'stationary-mode-i-owned-U-RF-COD/0.1' as const;
const prepareSchema = z.object({ jobId: z.string().min(1).max(160),
  providerId: z.literal(PROVIDER), expectedResultType: z.literal(RESULT) }).strict();
export type FractureOwnerProof = { challenge: string; proof: string };
export type FractureOperationApproval = {
  schema: 'tunacad-stationary-fracture-operation-approval/0.1';
  operation: 'geometry_transfer' | 'native_execution';
  providerId: typeof PROVIDER; expectedResultType: typeof RESULT;
  binding: Awaited<ReturnType<ReturnType<typeof createControlledStationaryFracturePilot>['describeBinding']>>;
  engineeringUsePermitted: false;
};
export const isFractureOperation = (r: { schema: string }): r is FractureOperationApproval =>
  r.schema === 'tunacad-stationary-fracture-operation-approval/0.1';
export type FractureOwnerConfiguration = {
  // Trusted source registry, NOT JSON supplied by a browser. Must return current
  // source/export data for this paired owner; never trust a cached revision.
  readCurrentModel(jobId: string, sessionIdentity: string): Promise<ApprovedFractureModel>;
  retainPilotEvidence?:RetainFracturePilotEvidence;
};
export type ControlledFractureOwnerConfiguration = FractureOwnerConfiguration & {
  purpose: 'controlled_owner_fixture';
  stage: Parameters<typeof createControlledStationaryFracturePilot>[1]['stage'];
  verifyRuntime?:()=>Promise<void>;
};
export interface FractureOwnerContext {
  now(): number;
  authenticate(operation: string, body: unknown, proof: FractureOwnerProof): string;
  sessionIdentity(): string | null;
  reserveJob(): void;
  beginRun(): () => void;
  review(request: FractureOperationApproval, signal: AbortSignal): Promise<object>;
  consume(request: FractureOperationApproval, receipt: object): void;
  verify(request: FractureOperationApproval, receipt: object, consumed: boolean): void;
  revokeReceipt(receipt: object): void;
}
function fail(message: string): never { throw new Error('BRIDGE_FRACTURE_' + message); }

/** Internal authenticated owner handlers, composed ONLY by the paired Bridge.
 * No HTTP/discovery route, environment flag, imported evidence or caller driver.
 * Both modes use identical handlers; constructor-only controlled mode can never
 * produce native provenance. The Bridge, not this owner, owns approval records. */
export function createStationaryFractureOwner(context: FractureOwnerContext,
  config: FractureOwnerConfiguration, controlled?: ControlledFractureOwnerConfiguration) {
  if (controlled && controlled.purpose !== 'controlled_owner_fixture') fail('INVALID_TEST_CONFIGURATION');
  type Pilot = ReturnType<typeof createControlledStationaryFracturePilot>;
  type Binding = Awaited<ReturnType<Pilot['describeBinding']>>;
  type Job = { id: string; modelId: string; session: string; expiresAt: number; controller: AbortController;
    pilot: Pilot; binding: Binding; receipts: Partial<Record<FractureOperationApproval['operation'], object>>;
    result?: object; state: 'prepared' | 'running' | 'complete' | 'failed' | 'cancelled'; attempts: number; reviewing: boolean };
  const jobs = new WeakMap<object, Job>(), owned = new Set<Job>(), modelIds = new Set<string>();
  let revoked = false;
  const request = (j: Job, operation: FractureOperationApproval['operation']): FractureOperationApproval => ({
    schema: 'tunacad-stationary-fracture-operation-approval/0.1', operation,
    providerId: PROVIDER, expectedResultType: RESULT, binding: j.binding, engineeringUsePermitted: false });
  function live(j: Job) {
    if (revoked || context.sessionIdentity() !== j.session || context.now() >= j.expiresAt
      || j.controller.signal.aborted || ['cancelled', 'failed'].includes(j.state)) {
      dispose(j); fail('STALE_JOB');
    }
  }
  async function current(j: Job) {
    live(j);
    try {
      const model = await config.readCurrentModel(j.modelId, j.session);
      await j.pilot.verifyRuntime();
      live(j);
      if (model.jobId !== j.modelId || model.sessionBinding !== j.session
        || digest(inspectApprovedFractureModel(model)) !== digest(j.binding.snapshot)) fail('SOURCE_BINDING_MISMATCH');
      return model;
    } catch (error) { j.state = 'failed'; dispose(j); throw error; }
  }
  function get(handle: object, operation: string, proof: FractureOwnerProof) {
    const j = jobs.get(handle);
    if (!j) fail('FORGED_HANDLE');
    const identity = context.authenticate(operation, { ownerJobId: j.id }, proof);
    if (identity !== j.session) fail('SESSION_MISMATCH');
    live(j); return j;
  }
  function dispose(j: Job) {
    j.controller.abort(); j.pilot.dispose(); j.result = undefined;
    for (const receipt of Object.values(j.receipts)) context.revokeReceipt(receipt);
    j.receipts = {};
  }
  return Object.freeze({
    async prepare(value: unknown, proof: FractureOwnerProof) {
      const input = prepareSchema.parse(value);
      const session = context.authenticate('prepare', input, proof);
      if (revoked || modelIds.has(input.jobId)) fail('REPLAY');
      // Reserve before async source loading: bounded attempts, no parallel preparation race.
      context.reserveJob(); modelIds.add(input.jobId);
      const controller = new AbortController();
      const initial = await config.readCurrentModel(input.jobId, session);
      if (context.sessionIdentity() !== session || initial.jobId !== input.jobId || initial.sessionBinding !== session) fail('SESSION_MISMATCH');
      const snapshot = inspectApprovedFractureModel(initial);
      let job: Job | undefined;
      const host: FracturePilotHost = {
        ...(config.retainPilotEvidence?{retainEvidence:async(event:any)=>{
          if(!job)fail('PREPARATION_REQUIRED');
          await config.retainPilotEvidence!({...event,ownerJobId:job!.id,
            bindingDigest:job!.binding.bindingDigest,runtimePinDigest:job!.binding.runtimePinDigest});
        }}:{}),
        async readApprovedModel() {
          if (job) return current(job);
          if (revoked || context.sessionIdentity() !== session || controller.signal.aborted) fail('STALE_JOB');
          const model = await config.readCurrentModel(input.jobId, session);
          if (revoked || context.sessionIdentity() !== session || digest(inspectApprovedFractureModel(model)) !== digest(snapshot)) fail('SOURCE_BINDING_MISMATCH');
          return model;
        },
        async consumeApproval(operation, bindingDigest, signal) {
          if (!job || signal.aborted || bindingDigest !== job.binding.bindingDigest) fail('APPROVAL_BINDING_MISMATCH');
          await current(job);
          const receipt = job.receipts[operation]; if (!receipt) fail('APPROVAL_REQUIRED');
          context.consume(request(job, operation), receipt); return receipt;
        },
        async verifyConsumed(operation, bindingDigest, receipt) {
          if (!job || receipt !== job.receipts[operation] || bindingDigest !== job.binding.bindingDigest) fail('APPROVAL_BINDING_MISMATCH');
          await current(job); context.verify(request(job, operation), receipt, true);
        },
      };
      let pilot: Pilot | undefined;
      try {
        pilot = controlled ? createControlledStationaryFracturePilot(host, { stage: controlled.stage, now: context.now,verifyRuntime:controlled.verifyRuntime })
          : await createNativeStationaryFracturePilot(host);
        const binding = await pilot.describeBinding();
        job = { id: randomBytes(32).toString('hex'), modelId: input.jobId, session, expiresAt: context.now() + 20 * 60000,
          controller, pilot, binding, receipts: {}, state: 'prepared', attempts: 0, reviewing: false };
        await current(job);
        const handle = Object.freeze({}); jobs.set(handle, job); owned.add(job);
        return { handle, ownerJobId: job.id, request: structuredClone(request(job, 'geometry_transfer')),
          evidenceMode: controlled ? 'controlled_provider_fixture' : 'native_owned_process' };
      } catch (error) { controller.abort(); pilot?.dispose(); throw error; }
    },
    async reviewTransfer(handle: object, proof: FractureOwnerProof) {
      const j = get(handle, 'reviewTransfer', proof);
      if (j.state !== 'prepared' || j.receipts.geometry_transfer || j.reviewing) fail('REPLAY');
      j.reviewing = true;
      try {
        await current(j);
        const receipt = await context.review(request(j, 'geometry_transfer'), j.controller.signal);
        try { await current(j); context.verify(request(j, 'geometry_transfer'), receipt, false);
          j.receipts.geometry_transfer = receipt;
        } catch (error) { context.revokeReceipt(receipt); throw error; }
      } catch (error) { j.state = 'failed'; dispose(j); throw error; }
      finally { j.reviewing = false; }
    },
    async reviewExecution(handle: object, proof: FractureOwnerProof) {
      const j = get(handle, 'reviewExecution', proof);
      if (j.state !== 'prepared' || !j.receipts.geometry_transfer || j.receipts.native_execution || j.reviewing) fail('APPROVAL_REQUIRED_OR_REPLAY');
      j.reviewing = true;
      try {
        await current(j);
        context.verify(request(j, 'geometry_transfer'), j.receipts.geometry_transfer, false);
        const receipt = await context.review(request(j, 'native_execution'), j.controller.signal);
        try { await current(j); context.verify(request(j, 'native_execution'), receipt, false);
          context.verify(request(j, 'geometry_transfer'), j.receipts.geometry_transfer, false);
          j.receipts.native_execution = receipt;
        } catch (error) { context.revokeReceipt(receipt); throw error; }
      } catch (error) { j.state = 'failed'; dispose(j); throw error; }
      finally { j.reviewing = false; }
    },
    async run(handle: object, proof: FractureOwnerProof) {
      const j = get(handle, 'run', proof); await current(j);
      if (j.state !== 'prepared' || j.attempts) fail('REPLAY');
      for (const operation of ['geometry_transfer', 'native_execution'] as const) {
        const receipt = j.receipts[operation]; if (!receipt) fail('APPROVAL_REQUIRED');
        context.verify(request(j, operation), receipt, false);
      }
      const end = context.beginRun(); j.state = 'running'; j.attempts++;
      try { j.result = await j.pilot.run(j.controller.signal); await current(j); j.state = 'complete'; }
      catch (error) { j.state = j.controller.signal.aborted ? 'cancelled' : 'failed'; dispose(j); throw error; }
      finally { end(); }
    },
    async result(handle: object, proof: FractureOwnerProof) {
      const j = get(handle, 'result', proof); await current(j);
      if (j.state !== 'complete' || !j.result) fail('RESULT_UNAVAILABLE');
      const result = await j.pilot.extract(j.result); await current(j);
      return result;
    },
    async snapshotEvidence(handle: object, proof: FractureOwnerProof) {
      const j = get(handle, 'snapshotEvidence', proof); await current(j);
      if (j.state !== 'complete' || !j.result) fail('RESULT_UNAVAILABLE');
      const evidence = await j.pilot.snapshotEvidence(j.result); await current(j); return evidence;
    },
    async status(handle: object, proof: FractureOwnerProof) {
      const j = get(handle, 'status', proof);
      await current(j);
      try{for(const operation of ['geometry_transfer','native_execution'] as const){
        const receipt=j.receipts[operation];if(receipt)context.verify(request(j,operation),receipt,['running','complete'].includes(j.state));
      }}catch(error){j.state='failed';dispose(j);throw error;}
      return { state: j.state, ...j.pilot.status(),engineeringUsePermitted:false,
        ownerJobId:j.id,request:structuredClone(request(j,'geometry_transfer')),
        evidenceMode:controlled?'controlled_provider_fixture':'native_owned_process',verified:true,expiresAt:j.expiresAt};
    },
    cancel(handle: object, proof: FractureOwnerProof) {
      const j = get(handle, 'cancel', proof); j.state = 'cancelled'; dispose(j);
    },
    expire() {
      for (const j of owned) if (context.now() >= j.expiresAt || context.sessionIdentity() !== j.session) {
        j.state = 'cancelled'; dispose(j); owned.delete(j);
      }
    },
    revoke() { revoked = true; for (const j of owned) { j.state = 'cancelled'; dispose(j); } owned.clear(); },
  });
}
