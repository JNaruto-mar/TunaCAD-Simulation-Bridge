import { electrostaticFoundationDraftSchema, type ElectrostaticFoundation,
  type ElectrostaticFoundationDraft } from './electrostaticContract.mts';
import { ElectrostaticLiveSourceReader, electrostaticBrowserDigest,
  type ElectrostaticCadReaders } from './electrostaticLiveSource.mts';
import { electrostaticStepGeometryDigest } from './electrostaticStepIdentity.mts';

export interface ElectrostaticApprovalSummary {
  analysisType: 'electrostatic'; studyId: string; projectRevision: string;
  canonicalSourceDigest: string; requestDigest: string;
  domainId: string; partId: string; bodyId: string;
  material: ElectrostaticFoundation['material'];
  electrodes: ElectrostaticFoundation['prescribedPotentials'];
  voltageDifferenceV: number;
  units: ElectrostaticFoundation['output']['units'];
  status: 'proof_of_concept'; engineeringUsePermitted: false;
}
export interface ElectrostaticTransferAuthorization {
  authorizationId: string; requestDigest: string;
  projectRevision: string; canonicalSourceDigest: string;
}
export interface ElectrostaticPreparationCadReaders extends ElectrostaticCadReaders {
  /** Host-owned source mutation notification; never a caller assertion. */
  subscribeSourceChanges?(listener: () => void): () => void;
}
/** Trusted host transport, not MCP arguments. authorize must return only after
 * the separate Bridge human approval. It receives JSON identities, NEVER STEP.
 * The existing provider/lifecycle owns solving and result quarantine. */
export interface ElectrostaticApprovedTransfer {
  authorize(request: ElectrostaticFoundation, signal: AbortSignal):
    Promise<ElectrostaticTransferAuthorization>;
  transfer(authorization: ElectrostaticTransferAuthorization,
    request: ElectrostaticFoundation, geometry: Uint8Array, signal: AbortSignal): Promise<void>;
  revoke(authorization: ElectrostaticTransferAuthorization): Promise<void>;
}
type State = 'prepared' | 'awaiting_bridge_approval' | 'transferred'
  | 'cancelled' | 'invalidated';
interface Preparation {
  id: string; request: ElectrostaticFoundation; reader: ElectrostaticLiveSourceReader;
  readTransferSnapshot(): Promise<{ request: ElectrostaticFoundation; geometry: Uint8Array }>;
  unsubscribeSourceChanges(): void;
  expiresAt: number; state: State; controller: AbortController;
}
function fail(detail: string): never {
  throw new Error('ELECTROSTATIC_PREPARATION_INVALID: ' + detail);
}

/** Option 1 boundary: no STEP retained in preparation, no provider operations.
 * Only the browser's human confirmation controller may call confirmAndTransfer.
 * Local export for source inspection is allowed before both approvals. */
export class ElectrostaticGeometryApproval {
  private readonly preparations = new Map<string, Preparation>();
  constructor(private readonly cad: ElectrostaticPreparationCadReaders,
    private readonly now: () => number = Date.now) {}

  async prepare(input: ElectrostaticFoundationDraft) {
    const draft = electrostaticFoundationDraftSchema.parse(structuredClone(input));
    const before = await this.cad.getProjectRevision();
    if (draft.model.projectRevision !== before) fail('stale preparation revision');
    const domain = draft.model.domains[0];
    const body = await this.cad.inspectBody(domain.bodyId) as {
      bodyId?: string; ownerPartId?: string; projectRevision?: string;
    };
    if (body?.bodyId !== domain.bodyId || body.ownerPartId !== domain.partId
      || body.projectRevision !== before) fail('missing/ambiguous live domain');
    // Independently derive ownership from the live body, not the supplied hash.
    const binding = { domainId: domain.domainId, partId: body.ownerPartId,
      bodyId: body.bodyId, projectRevision: before };
    let bytes: Uint8Array | null = await this.cad.exportGeometry(domain.bodyId);
    try { domain.geometryDigest = await electrostaticStepGeometryDigest(bytes); }
    finally { bytes = null; } // preparation retains identities only
    if (await this.cad.getProjectRevision() !== before) fail('changed during local inspection');
    const request = { ...draft, requestDigest: await electrostaticBrowserDigest(draft) };
    const records = {
      async readSealedRequest() { return structuredClone(request); },
      async readDomainBinding() { return structuredClone(binding); },
      async readValidatedMesh() { return fail('preparation must not mesh'); },
      async readCurrentRuntimeIdentity() { return fail('preparation must not dispatch'); },
    };
    const reader = new ElectrostaticLiveSourceReader(records, this.cad);
    // Reuse the unchanged trusted guard. Capture a fresh local export ONLY
    // inside the post-dual-approval call; no bytes live in preparation records.
    const readTransferSnapshot = async () => {
      const capture: { geometry: Uint8Array | null } = { geometry: null };
      const verifiedReader = new ElectrostaticLiveSourceReader(records, {
        getProjectRevision: () => this.cad.getProjectRevision(),
        inspectBody: bodyId => this.cad.inspectBody(bodyId),
        readPartMaterial: partId => this.cad.readPartMaterial(partId),
        resolveFace: (partId, faceId) => this.cad.resolveFace(partId, faceId),
        exportGeometry: async bodyId => {
          const bytes = await this.cad.exportGeometry(bodyId);
          capture.geometry = new Uint8Array(bytes);
          return bytes;
        },
      });
      try {
        const verified = await verifiedReader.readSealedRequest(request.studyId);
        if (!capture.geometry) return fail('missing fresh local export');
        return { request: verified, geometry: capture.geometry };
      } finally { capture.geometry = null; }
    };
    await reader.readSealedRequest(request.studyId);
    this.prune();
    if (this.preparations.size >= 8) fail('preparation limit reached');
    const id = 'simprep_electrical-' + crypto.randomUUID();
    const preparation: Preparation = { id, request, reader, readTransferSnapshot,
      expiresAt: this.now() + 120_000, state: 'prepared', controller: new AbortController(),
      unsubscribeSourceChanges: () => {} };
    this.preparations.set(id, preparation);
    preparation.unsubscribeSourceChanges = this.cad.subscribeSourceChanges?.(() =>
      this.invalidate(preparation)) ?? (() => {});
    return { preparationId: id, approvalSummary: this.summary(request) };
  }
  async approvalSummary(id: string) {
    const preparation = this.require(id, 'prepared');
    try {
      await preparation.reader.readSealedRequest(preparation.request.studyId);
      this.require(id, 'prepared');
      return this.summary(preparation.request);
    } catch (error) { this.invalidate(preparation); throw error; }
  }
  getState(id: string): State {
    const preparation = this.preparations.get(id);
    if (!preparation) return fail('unknown preparation');
    if (this.now() >= preparation.expiresAt && ['prepared', 'awaiting_bridge_approval'].includes(preparation.state)) {
      this.invalidate(preparation);
    }
    return preparation.state;
  }
  /** Host result retrieval must freshly rebind live CAD; persisted Bridge
   * records cannot override browser source truth. No STEP is transferred here. */
  async rebindTransferredSource(id: string): Promise<ElectrostaticFoundation> {
    const preparation = this.require(id, 'transferred');
    try { return await preparation.reader.readSealedRequest(preparation.request.studyId); }
    catch (error) { this.invalidate(preparation); throw error; }
  }
  cancel(id: string) {
    const preparation = this.preparations.get(id);
    if (!preparation) return fail('unknown preparation');
    if (preparation.state !== 'transferred') {
      preparation.state = 'cancelled'; preparation.controller.abort();
      preparation.unsubscribeSourceChanges();
    }
  }
  /** Human browser confirmation only; never register as an MCP method.
   * No bytes are handed to transport.authorize. It must first obtain the
   * separate Bridge approval; stale/late/denied approvals cannot authorize STEP.
   * Each preparation is one-use, including concurrent confirmations. */
  async confirmAndTransfer(id: string, transport: ElectrostaticApprovedTransfer) {
    const preparation = this.require(id, 'prepared');
    preparation.state = 'awaiting_bridge_approval';
    let authorization: ElectrostaticTransferAuthorization | null = null;
    let geometry: Uint8Array | null = null;
    try {
      await preparation.reader.readSealedRequest(preparation.request.studyId);
      this.require(id, 'awaiting_bridge_approval');
      authorization = await transport.authorize(structuredClone(preparation.request),
        preparation.controller.signal);
      this.require(id, 'awaiting_bridge_approval');
      if (!authorization || !authorization.authorizationId
        || authorization.requestDigest !== preparation.request.requestDigest
        || authorization.projectRevision !== preparation.request.model.projectRevision
        || authorization.canonicalSourceDigest !== preparation.request.model.domains[0].geometryDigest) {
        fail('Bridge approval identity mismatch');
      }
      // BOTH approvals now exist. No cached preparation STEP is reused.
      const snapshot = await preparation.readTransferSnapshot();
      this.require(id, 'awaiting_bridge_approval');
      if (snapshot.request.requestDigest !== preparation.request.requestDigest) fail('changed approved request');
      geometry = snapshot.geometry;
      // Re-read material/FACEs/native topology and digest after obtaining the
      // transfer bytes as well; the transport must not delay/export anew.
      await preparation.reader.readSealedRequest(preparation.request.studyId);
      this.require(id, 'awaiting_bridge_approval');
      if (await electrostaticStepGeometryDigest(geometry) !== authorization.canonicalSourceDigest) {
        fail('changed transfer geometry');
      }
      this.require(id, 'awaiting_bridge_approval');
      await transport.transfer(structuredClone(authorization), structuredClone(preparation.request),
        geometry, preparation.controller.signal);
      this.require(id, 'awaiting_bridge_approval');
      preparation.state = 'transferred';
      preparation.unsubscribeSourceChanges();
    } catch (error) {
      this.invalidate(preparation);
      if (authorization) {
        try { await transport.revoke(authorization); }
        catch { /* Keep invalidated/cancelled; never retry geometry transfer. */ }
      }
      throw error;
    } finally { geometry = null; }
  }
  private require(id: string, expected: State): Preparation {
    const preparation = this.preparations.get(id);
    if (!preparation || this.getState(id) !== expected || preparation.controller.signal.aborted) {
      return fail('expired, cancelled, invalidated or already consumed preparation');
    }
    return preparation;
  }
  private invalidate(preparation: Preparation) {
    if (preparation.state !== 'cancelled') preparation.state = 'invalidated';
    preparation.controller.abort();
    preparation.unsubscribeSourceChanges();
  }
  private prune() {
    for (const [id, preparation] of this.preparations) {
      this.getState(id);
      if (['cancelled', 'invalidated'].includes(preparation.state)
        || (preparation.state === 'transferred' && this.now() - preparation.expiresAt > 20 * 60_000)) this.preparations.delete(id);
    }
  }
  private summary(request: ElectrostaticFoundation): ElectrostaticApprovalSummary {
    const domain = request.model.domains[0];
    return structuredClone({ analysisType: 'electrostatic', studyId: request.studyId,
      projectRevision: request.model.projectRevision, canonicalSourceDigest: domain.geometryDigest,
      requestDigest: request.requestDigest, domainId: domain.domainId, partId: domain.partId,
      bodyId: domain.bodyId, material: request.material, electrodes: request.prescribedPotentials,
      voltageDifferenceV: request.prescribedPotentials[1].potentialV - request.prescribedPotentials[0].potentialV,
      units: request.output.units, status: 'proof_of_concept', engineeringUsePermitted: false });
  }
}
