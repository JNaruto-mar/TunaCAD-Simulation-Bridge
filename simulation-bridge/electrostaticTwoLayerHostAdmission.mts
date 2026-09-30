import { join } from 'node:path';
import type { ElectrostaticCadReaders } from './electrostaticLiveSource.mts';
import { bindTwoLayerSource, TwoLayerElectrostaticLifecycle,
  type TwoLayerNativeDriver, type TwoLayerSourceSnapshot } from './electrostaticTwoLayerAdmission.mts';
import { validateElectrostaticTwoLayer } from './electrostaticTwoLayerFoundation.mts';
import { electrostaticRuntimeSchema } from './electrostaticAdmission.mts';
import { FileElectrostaticTwoLayerHostRecords } from './electrostaticTwoLayerHostRecords.mts';
import { buildTwoLayerElectricalFields, twoLayerElectricalViewerResult }
  from '../providers/calculix/CalculiXElectrostaticTwoLayerFields.mts';
import { electricalFieldPage } from '../providers/calculix/CalculiXElectrostaticFields.mts';
import { ElectrostaticHostStorage, ELECTROSTATIC_SOURCE_IDENTITY,
  readElectrostaticHostJson } from './electrostaticHostStorage.mts';
import { digest } from './stableDigest.mts';

function invalid(reason: string): never {
  throw new Error('ELECTROSTATIC_TWO_LAYER_HOST_ADMISSION_INVALID: ' + reason);
}
export function liveTwoLayerPreparationReceiptPath(storage: ElectrostaticHostStorage, studyId: string) {
  if (typeof studyId !== 'string' || !studyId.trim() || studyId.length > 160
    || [...studyId].some(c => c.charCodeAt(0) < 32)) invalid('study ID');
  return join(storage.paths['source-catalog'],
    digest({ family: 'two-layer-live-host-preparation', studyId }).slice(7) + '.preparation.json');
}
export interface TwoLayerLivePreparationReceipt {
  schema: 'tunacad-electrostatic-two-layer-live-preparation/0.1';
  sourceIdentityVersion: typeof ELECTROSTATIC_SOURCE_IDENTITY;
  configurationDigest: string;
  studyId: string;
  recordDigest: string;
  requestDigest: string;
  sourceDigest: string;
  fragmentMeshDigest: string;
  conformityEvidenceDigest: string;
  receiptDigest: string;
}
export async function readLiveTwoLayerPreparationReceipt(
  storage: ElectrostaticHostStorage, studyId: string): Promise<TwoLayerLivePreparationReceipt> {
  await storage.assertReady();
  const value = await readElectrostaticHostJson(liveTwoLayerPreparationReceiptPath(storage, studyId), 4096);
  if (!value || Object.keys(value).sort().join(',') !==
    'configurationDigest,conformityEvidenceDigest,fragmentMeshDigest,receiptDigest,recordDigest,requestDigest,schema,sourceDigest,sourceIdentityVersion,studyId'
    || value.schema !== 'tunacad-electrostatic-two-layer-live-preparation/0.1'
    || value.sourceIdentityVersion !== ELECTROSTATIC_SOURCE_IDENTITY
    || value.configurationDigest !== storage.configurationDigest
    || value.studyId !== studyId
    || !['recordDigest', 'requestDigest', 'sourceDigest', 'fragmentMeshDigest',
      'conformityEvidenceDigest', 'receiptDigest'].every(key =>
      /^sha256:[a-f0-9]{64}$/.test(value[key])))
    invalid('missing/malformed protected live-preparation receipt');
  const { receiptDigest, ...unsigned } = value;
  if (digest(unsigned) !== receiptDigest) invalid('preparation receipt digest');
  return value as TwoLayerLivePreparationReceipt;
}

/** Pure bounded check shared by real protected admission and no-solver
 * mutation tests. It never treats a receipt or declared conformity as proof
 * without the separately fresh, protected host-record replay and source bind. */
export function verifyTwoLayerHostAdmission(
  receipt: TwoLayerLivePreparationReceipt,
  protectedRecordDigest: string,
  protectedRecord: any,
  source: TwoLayerSourceSnapshot) {
  const request = validateElectrostaticTwoLayer(source.request);
  const mesh = source.verified;
  const identity = source.identity;
  const evidence = mesh.interfaceEvidence;
  electrostaticRuntimeSchema.parse(identity.runtime);
  const { sourceDigest: _sourceDigest, ...unsignedIdentity } = identity;
  if (digest(unsignedIdentity) !== identity.sourceDigest)
    invalid('fresh source identity digest');
  if (receipt.schema !== 'tunacad-electrostatic-two-layer-live-preparation/0.1'
    || receipt.sourceIdentityVersion !== ELECTROSTATIC_SOURCE_IDENTITY
    || receipt.studyId !== request.studyId
    || receipt.recordDigest !== protectedRecordDigest
    || receipt.requestDigest !== request.requestDigest
    || receipt.sourceDigest !== identity.sourceDigest
    || receipt.fragmentMeshDigest !== mesh.meshDigest
    || receipt.conformityEvidenceDigest !== digest(evidence)
    || digest((({ receiptDigest, ...rest }) => rest)(receipt)) !== receipt.receiptDigest)
    invalid('receipt does not bind the current protected source');
  if (protectedRecord?.schema !== 'tunacad-electrostatic-two-layer-host-study/0.1'
    || protectedRecord.studyId !== request.studyId || protectedRecord.meshSizeMm !== 1
    || protectedRecord.sourceIdentityVersion !== ELECTROSTATIC_SOURCE_IDENTITY
    || protectedRecord.configurationDigest !== receipt.configurationDigest
    || digest(protectedRecord) !== protectedRecordDigest
    || protectedRecord.request?.requestDigest !== request.requestDigest
    || digest(protectedRecord.binding) !== digest(identity)
    || digest(protectedRecord.domains) !== digest(request.model.domains.map((d, i) => ({
      domainId: d.domainId, partId: d.partId, bodyId: d.bodyId,
      projectRevision: request.model.projectRevision,
      canonicalGeometryDigest: d.geometryDigest, material: request.materials[i],
    })))
    || digest(protectedRecord.electrodeFaceIds) !== digest(identity.electrodeFaceIds)
    || digest(protectedRecord.interfaceFaceIds) !== digest(identity.interfaceFaceIds)
    || protectedRecord.validatedMesh?.fragmentMeshDigest !== mesh.meshDigest
    || protectedRecord.validatedMesh?.deckDigest !== identity.deckDigest
    || digest(protectedRecord.validatedMesh?.runtime) !== digest(identity.runtime)
    || digest(protectedRecord.validatedMesh?.interfaceEvidence) !== digest(evidence)
    || !Array.isArray(protectedRecord.localMeshes)
    || protectedRecord.localMeshes.length !== 2
    || protectedRecord.localMeshes.some((local: any, i: number) =>
      local?.provenance?.adapterId !== 'tunacad-gmsh-occt-fragment'
      || local.provenance.engine !== 'Gmsh'
      || local.provenance.engineVersion !== '4.15.2'
      || local.provenance.optionsDigest !== digest({
        globalSizeMm: 1,
        sourceDigests: request.model.domains.map(d => d.geometryDigest),
      })
      || local.provenance.inputGeometryDigest !== request.model.domains[i].geometryDigest
      || local.geometryDigest !== request.model.domains[i].geometryDigest
      || local.projectRevision !== request.model.projectRevision
      || local.requestDigest !== request.requestDigest))
    invalid('protected record/current source mismatch');
  const areaMm2 = request.model.interface.areaM2 * 1e6;
  if (!Number.isSafeInteger(evidence.sharedNodeCount) || evidence.sharedNodeCount < 6
    || !Number.isSafeInteger(evidence.facetCount) || evidence.facetCount < 2
    || !/^sha256:[a-f0-9]{64}$/.test(evidence.sharedNodeDigest)
    || !/^sha256:[a-f0-9]{64}$/.test(evidence.sharedFacetDigest)
    || !Number.isFinite(evidence.areaMm2)
    || Math.abs(evidence.areaMm2 - areaMm2) > areaMm2 * 1e-6
    || protectedRecord.validatedMesh.nodes !== mesh.model.nodes.length
    || protectedRecord.validatedMesh.elements !== mesh.model.volumeElements.connectivity.length
    || identity.conformalInterfaceEvidenceDigest !== digest(evidence)
    || identity.fragmentMeshDigest !== mesh.meshDigest
    || identity.requestDigest !== request.requestDigest
    || identity.projectRevision !== request.model.projectRevision
    || identity.domains.length !== 2
    || identity.domains.some((entry: any, i: number) =>
      entry.domainId !== request.model.domains[i].domainId
      || entry.canonicalGeometryDigest !== request.model.domains[i].geometryDigest
      || entry.materialDigest !== digest(request.materials[i])
      || entry.provenanceDigest !== digest(request.materials[i].source))
    || identity.electrodeFaceIds.length !== 2
    || identity.interfaceFaceIds.length !== 2
    || identity.runtime.providerId !== 'tunacad-calculix-electrostatic-development'
    || identity.runtime.engineVersion !== '2.16')
    invalid('out-of-scope or incomplete two-domain conformity/runtime');
  return { studyId: request.studyId, requestDigest: request.requestDigest,
    sourceDigest: identity.sourceDigest, fragmentMeshDigest: mesh.meshDigest,
    deckDigest: identity.deckDigest, runtime: identity.runtime };
}

/** Private host-only admission facade. No request/mesh argument and no
 * browser/MCP/public route. The existing lifecycle performs another fresh
 * bind after submission and owns cancellation, cleanup and quarantine. */
export class HostTwoLayerProviderAdmission {
  readonly #records: FileElectrostaticTwoLayerHostRecords;
  readonly #lifecycle: TwoLayerElectrostaticLifecycle;
  constructor(private readonly storage: ElectrostaticHostStorage,
    cad: ElectrostaticCadReaders, currentRuntime: () => Promise<unknown>,
    driver: TwoLayerNativeDriver) {
    this.#records = new FileElectrostaticTwoLayerHostRecords(storage, cad, currentRuntime);
    this.#lifecycle = new TwoLayerElectrostaticLifecycle(this.#records, driver, storage);
  }
  async submit(studyId: string) {
    await verifyTwoLayerHostAdmissionFresh(this.storage, this.#records, studyId);
    return this.#lifecycle.submit(studyId);
  }
  getStatus(jobId: string) { return this.#lifecycle.getStatus(jobId); }
  cancel(jobId: string) { return this.#lifecycle.cancel(jobId); }
  getResult(jobId: string) { return this.#lifecycle.getResult(jobId); }
  private async presentation(jobId: string) {
    const result = await this.#lifecycle.getResult(jobId);
    if (!result) return null;
    const source = await bindTwoLayerSource(result.studyId, this.#records);
    if (source.identity.sourceDigest !== result.binding.sourceDigest)
      invalid('electrical presentation source changed');
    const fields = buildTwoLayerElectricalFields(jobId, result, source.request, source.verified);
    if ((await this.#lifecycle.getResult(jobId))?.resultDigest !== result.resultDigest)
      invalid('electrical completion changed during presentation');
    return { summary: twoLayerElectricalViewerResult(source.request, result, fields), fields };
  }
  /** Private authenticated field access; no browser/MCP/public route. */
  async getElectricalPresentation(jobId: string) {
    return (await this.presentation(jobId))?.summary ?? null;
  }
  async getElectricalFieldPage(jobId: string, datasetId: string,
    cursor = '0', limit = 128) {
    const presentation = await this.presentation(jobId);
    if (!presentation) return null;
    const field = presentation.fields.get(datasetId);
    if (!field) invalid('dataset not owned by completed job');
    return electricalFieldPage(field, cursor, limit);
  }
}

/** Exact-scope no-dispatch rebind shared with the private submit path. */
export async function verifyTwoLayerHostAdmissionFresh(
  storage: ElectrostaticHostStorage,
  records: FileElectrostaticTwoLayerHostRecords, studyId: string) {
    const receipt = await readLiveTwoLayerPreparationReceipt(storage, studyId);
    const firstRecord = await records.readAdmissionRecord(studyId);
    const first = await bindTwoLayerSource(studyId, records);
    const admitted = verifyTwoLayerHostAdmission(
      receipt, firstRecord.recordDigest, firstRecord.record, first);
    const secondRecord = await records.readAdmissionRecord(studyId);
    const second = await bindTwoLayerSource(studyId, records);
    const confirmed = verifyTwoLayerHostAdmission(
      receipt, secondRecord.recordDigest, secondRecord.record, second);
    if (digest(admitted) !== digest(confirmed)) invalid('source changed before dispatch');
    return confirmed;
}
