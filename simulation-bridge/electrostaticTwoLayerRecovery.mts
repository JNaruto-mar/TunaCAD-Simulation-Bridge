import { twoLayerRecoverySchema, twoLayerAttachmentSchema, validateTwoLayerRecoveredViewer, type TwoLayerRecovery } from './electrostaticTwoLayerWorkflow.mts';
import { electricalFieldPage } from '../providers/calculix/CalculiXElectrostaticFields.mts';
import { validateElectricalPage } from './electrostaticFields.mts';
import type { HostTwoLayerProviderAdmission } from './electrostaticTwoLayerHostAdmission.mts';
import type { TwoLayerAttachment } from './electrostaticTwoLayerWorkflow.mts';

type ReadOnlyProvider = Pick<HostTwoLayerProviderAdmission,
  'getResultReadOnly' | 'getElectricalPresentationReadOnly' | 'getElectricalFieldPageReadOnly'>;

/** A bounded view lease for one completed protected job. It has no submit,
 * cancel, approval or provider-dispatch method. */
export class TwoLayerReadOnlyRecoverySession {
  readonly claim: TwoLayerRecovery;
  #reads = 0;
  #revoked = false;
  #snapshot: Awaited<ReturnType<HostTwoLayerProviderAdmission['getElectricalPresentationSnapshotReadOnly']>> = null;
  #attachment: TwoLayerAttachment | null = null;
  constructor(claim: TwoLayerRecovery, private readonly provider: ReadOnlyProvider,
    private readonly options: { assertSession: () => void; verifySource: () => Promise<void>; now?: () => number }) {
    this.claim = twoLayerRecoverySchema.parse(structuredClone(claim));
  }
  revoke() { this.#revoked = true; }
  private current() {
    this.options.assertSession();
    if (this.#revoked || (this.options.now ?? Date.now)() >= this.claim.expiresAt)
      throw Error('Two-layer read-only recovery expired or session changed');
    if (++this.#reads > 4096) throw Error('Two-layer bounded recovery-read limit');
  }
  private async fresh() { this.current(); await this.options.verifySource(); this.current(); }
  private owned(jobId: string) {
    if (jobId !== this.claim.jobId) throw Error('Two-layer recovered job ownership mismatch');
  }
  async result(jobId: string) {
    this.owned(jobId); await this.fresh();
    const r = await this.provider.getResultReadOnly(jobId);
    await this.fresh();
    if (!r || r.studyId !== this.claim.studyId || r.resultDigest !== this.claim.resultDigest
      || r.binding.sourceDigest !== this.claim.sourceDigest
      || r.binding.requestDigest !== this.claim.requestDigest
      || r.binding.projectRevision !== this.claim.projectRevision
      || r.binding.fragmentMeshDigest !== this.claim.meshDigest
      || r.completedProviderState !== 'completed_converged'
      || r.engineeringUsePermitted !== false || r.providerAdmission !== 'closed')
      throw Error('Two-layer recovered completion/source mismatch');
    const snapshot = 'getElectricalPresentationSnapshotReadOnly' in this.provider
      ? await (this.provider as HostTwoLayerProviderAdmission).getElectricalPresentationSnapshotReadOnly(jobId) : null;
    const viewer = validateTwoLayerRecoveredViewer(
      snapshot?.summary ?? await this.provider.getElectricalPresentationReadOnly(jobId), this.claim);
    await this.fresh();
    this.#snapshot = snapshot;
    const attachment = twoLayerAttachmentSchema.parse({ state: 'current',
        studyId: this.claim.studyId, projectRevision: this.claim.projectRevision,
        sourceDigest: this.claim.sourceDigest, requestDigest: this.claim.requestDigest,
        sessionBinding: this.claim.sessionBinding, sourceEpoch: this.claim.sourceEpoch,
        jobId, resultDigest: this.claim.resultDigest });
    this.#attachment = attachment;
    return { schema: 'tunacad-two-layer-result-attachment/0.1' as const, attachment, result: viewer };
  }
  async field(jobId: string, datasetId: string, cursor: string, limit: number) {
    this.owned(jobId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 128
      || !/^(0|[1-9][0-9]{0,5})$/.test(cursor)) throw Error('Two-layer field page bounds');
    if (this.#snapshot && this.#attachment) {
      const field = this.#snapshot.fields.get(datasetId);
      const expected = this.#snapshot.summary.fieldDatasets.find(d => d.datasetId === datasetId);
      if (!field || !expected) throw Error('Two-layer dataset is not owned by recovered job');
      await this.fresh();
      const r = await this.provider.getResultReadOnly(jobId);
      if (!r || r.studyId !== this.claim.studyId || r.resultDigest !== this.claim.resultDigest
        || r.binding.sourceDigest !== this.claim.sourceDigest
        || r.binding.requestDigest !== this.claim.requestDigest
        || r.binding.projectRevision !== this.claim.projectRevision
        || r.binding.fragmentMeshDigest !== this.claim.meshDigest
        || r.completedProviderState !== 'completed_converged'
        || r.engineeringUsePermitted !== false || r.providerAdmission !== 'closed')
        throw Error('Two-layer recovered completion/source mismatch');
      const page = await validateElectricalPage(
        electricalFieldPage(field, cursor, limit), expected, cursor, limit);
      await this.fresh();
      return { attachment: this.#attachment, page };
    }
    const attached = await this.result(jobId);
    const descriptor = attached.result.fieldDatasets.find(d => d.datasetId === datasetId);
    if (!descriptor) throw Error('Two-layer dataset is not owned by recovered job');
    await this.fresh();
    const page = await validateElectricalPage(
      await this.provider.getElectricalFieldPageReadOnly(jobId, datasetId, cursor, limit),
      descriptor, cursor, limit);
    await this.fresh();
    return { attachment: attached.attachment, page };
  }
}
