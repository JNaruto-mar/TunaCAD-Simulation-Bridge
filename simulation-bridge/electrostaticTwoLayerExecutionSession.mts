import type { TwoLayerApproval } from './electrostaticTwoLayerApproval.mts';
import { twoLayerApprovalSchema } from './electrostaticTwoLayerApproval.mts';
import { TWO_LAYER_PUBLIC_EXECUTION_ENABLED,twoLayerGrantSchema,twoLayerStatusSchema,twoLayerBinding,validateTwoLayerViewer } from './electrostaticTwoLayerWorkflow.mts';
import { validateElectricalPage } from './electrostaticFields.mts';
import type { HostTwoLayerProviderAdmission } from './electrostaticTwoLayerHostAdmission.mts';

type Provider=Pick<HostTwoLayerProviderAdmission,'submit'|'getStatus'|'cancel'|'getResult'|'getElectricalPresentation'|'getElectricalFieldPage'>;
/** Shared across all studies in a host transport. Session replacement cannot
 * reset the existing 16-job / two-active-job ceilings. Unconfirmed cleanup
 * deliberately retains its slot rather than admitting overlapping work. */
export class TwoLayerExecutionQuota {
  #attempts=0; #active=new Set<symbol>();
  acquire(owner:symbol){if(this.#attempts>=16||this.#active.size>=2)throw Error('Two-layer shared job limit');this.#attempts++;this.#active.add(owner);}
  release(owner:symbol){this.#active.delete(owner);}
}
/** Host-owned session, no submitted provider/request/mesh/deck. A controlled
 * integration harness may supply a private admission decision; production
 * never does. This is not a public admission or native-approval bypass. */
export class TwoLayerExecutionSession {
  private readonly approval:TwoLayerApproval;
  #jobId:string|null=null; #attempted=false; #revoked=false; #reads=0;
  #slot=Symbol(); #quota:TwoLayerExecutionQuota;
  #resultDigest:string|null=null;
  constructor(approval:TwoLayerApproval,private readonly options:{
    provider:Provider; assertSession:()=>void; verifySource:()=>Promise<void>;
    authorize:(grant:ReturnType<typeof twoLayerGrantSchema.parse>)=>Promise<unknown>;
    privateExecutionAdmitted?:()=>boolean;
    quota?:TwoLayerExecutionQuota; now?:()=>number;
  }){this.approval=twoLayerApprovalSchema.parse(structuredClone(approval));this.#quota=options.quota??new TwoLayerExecutionQuota();}
  admission(){this.options.assertSession();return {schema:'tunacad-two-layer-execution-admission/0.1',publicAdmission:'closed',engineeringUsePermitted:false,executionAvailable:TWO_LAYER_PUBLIC_EXECUTION_ENABLED||this.options.privateExecutionAdmitted?.()===true,requirements:['human-interactive separate-approval evidence','normal source-bound end-to-end acceptance','deliberate public transport admission review']};}
  private current(){this.options.assertSession();if(this.#revoked)throw Error('Two-layer job session revoked');}
  private owned(jobId:string,count=true){this.current();if(jobId!==this.#jobId)throw Error('Two-layer job is not owned by this study/session');if(count&&++this.#reads>4096)throw Error('Two-layer bounded job-read limit');}
  private async fresh(){this.current();await this.options.verifySource();this.current();}
  private envelope(status:unknown){const s=twoLayerStatusSchema.parse(status);if(s.jobId!==this.#jobId)throw Error('Two-layer provider job mismatch');if(s.cleanupConfirmed&&!['queued','running'].includes(s.state))this.#quota.release(this.#slot);return {schema:'tunacad-two-layer-job/0.1' as const,...twoLayerBinding(this.approval),status:s,engineeringUsePermitted:false as const,publicAdmission:'closed' as const};}
  async submit(grant:unknown){
    this.current();if(!this.admission().executionAvailable)throw Error('ELECTROSTATIC_TWO_LAYER_PUBLIC_EXECUTION_CLOSED');
    if(this.#attempted)throw Error('Two-layer submission already attempted; prepare a new study');
    const parsed=twoLayerGrantSchema.parse(grant);
    this.#quota.acquire(this.#slot);
    this.#attempted=true;
    let dispatching=false;
    try{
      await this.fresh();const authorization=await this.options.authorize(parsed) as any;await this.fresh();
      if(authorization?.state!=='pre_dispatch_admitted_no_solver'||authorization.studyId!==this.approval.studyId||authorization.sourceDigest!==this.approval.sourceDigest||authorization.providerDispatched!==false||!Number.isFinite(authorization.authorizationExpiresAt)||(this.options.now??Date.now)()>authorization.authorizationExpiresAt)throw Error('Two-layer submission authorization expired or mismatched');
      dispatching=true;const job=twoLayerStatusSchema.parse(await this.options.provider.submit(this.approval.studyId));this.#jobId=job.jobId;
      await this.fresh();return this.envelope(job);
    }catch(error){if(this.#jobId)this.envelope(await this.options.provider.cancel(this.#jobId));else if(!dispatching)this.#quota.release(this.#slot);throw error;}
  }
  async status(jobId:string){this.owned(jobId);await this.fresh();const status=await this.options.provider.getStatus(jobId);await this.fresh();return this.envelope(status);}
  async cancel(jobId:string){this.owned(jobId,false);const status=await this.options.provider.cancel(jobId);this.current();this.#resultDigest=null;return this.envelope(status);}
  async result(jobId:string){
    this.owned(jobId);await this.fresh();const r=await this.options.provider.getResult(jobId);await this.fresh();if(!r)return null;
    if(r.jobId!==jobId||r.studyId!==this.approval.studyId||r.binding.sourceDigest!==this.approval.sourceDigest||r.binding.requestDigest!==this.approval.requestDigest||r.binding.projectRevision!==this.approval.projectRevision||r.binding.fragmentMeshDigest!==this.approval.mesh.digest||r.engineeringUsePermitted!==false||r.providerAdmission!=='closed'||r.completedProviderState!=='completed_converged')throw Error('Two-layer protected completion binding mismatch');
    const viewer=validateTwoLayerViewer(await this.options.provider.getElectricalPresentation(jobId),this.approval,jobId,r.resultDigest);await this.fresh();
    if(this.#resultDigest&&this.#resultDigest!==r.resultDigest)throw Error('Two-layer immutable completion changed');this.#resultDigest=r.resultDigest;
    return {schema:'tunacad-two-layer-result-attachment/0.1' as const,attachment:{state:'current' as const,...twoLayerBinding(this.approval),jobId,resultDigest:r.resultDigest},result:viewer};
  }
  async field(jobId:string,datasetId:string,cursor:string,limit:number){
    this.owned(jobId);if(!Number.isInteger(limit)||limit<1||limit>128||!/^(0|[1-9][0-9]{0,5})$/.test(cursor))throw Error('Two-layer field page bounds');
    const attached=await this.result(jobId);if(!attached)throw Error('Two-layer completed fields unavailable');
    const descriptor=attached.result.fieldDatasets.find(d=>d.datasetId===datasetId);if(!descriptor)throw Error('Two-layer dataset is not owned by completed job');
    await this.fresh();const page=await validateElectricalPage(await this.options.provider.getElectricalFieldPage(jobId,datasetId,cursor,limit),descriptor,cursor,limit);await this.fresh();return {page,attachment:attached.attachment};
  }
  /** Session loss cancels active work, never deletes records or restores approvals. */
  async forget(){this.#revoked=true;this.#resultDigest=null;if(this.#jobId)this.envelope(await this.options.provider.cancel(this.#jobId));}
}
