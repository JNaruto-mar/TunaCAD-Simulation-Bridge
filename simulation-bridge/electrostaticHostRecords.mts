import { join } from 'node:path';
import { open, readdir, unlink } from 'node:fs/promises';
import { bindElectrostaticSource, type TrustedElectrostaticSourceReader,
  type ElectrostaticAdmissionLifecycle } from './electrostaticAdmission.mts';
import { type ElectrostaticHostRecords } from './electrostaticLiveSource.mts';
import { FileElectrostaticLedger } from './electrostaticLedger.mts';
import { ElectrostaticHostStorage, ELECTROSTATIC_SOURCE_IDENTITY,
  readElectrostaticHostJson, writeElectrostaticHostOnce } from './electrostaticHostStorage.mts';
import { digest } from './stableDigest.mts';

function invalid(detail: string): never { throw new Error('ELECTROSTATIC_HOST_RECORD_INVALID: ' + detail); }
const key = (studyId: string) => {
  if (typeof studyId !== 'string' || !studyId.length || studyId.length > 256) invalid('study ID bound');
  return digest({ studyId }).slice(7);
};

/** Host records are captured by ID from an already live-validated trusted reader,
 * never imported from caller JSON/digests. Durable records supply immutable
 * study/mesh data, NOT live CAD truth. Use the existing live CAD reader around
 * this store and the protected ledger wrapper for result publication/replay. */
export class FileElectrostaticHostRecords implements ElectrostaticHostRecords {
  constructor(private readonly storage: ElectrostaticHostStorage,
    private readonly currentRuntime: () => Promise<unknown>,
    private readonly capture: TrustedElectrostaticSourceReader | null = null) {}
  private pinPath(studyId: string) { return join(this.storage.paths['source-catalog'], key(studyId) + '.study-pin.json'); }
  async publishStudy(studyId: string) {
    if (!this.capture) invalid('trusted capture unavailable');
    await this.storage.assertReady();
    const path = join(this.storage.paths['source-catalog'], '.study-writer.lock');
    const lock = await open(path, 'wx', 0o600);
    try {
      const before = await bindElectrostaticSource(studyId, this.capture);
      const after = await bindElectrostaticSource(studyId, this.capture);
      if (digest(before.identity) !== digest(after.identity)) invalid('source changed during capture');
      const domain = before.request.model.domains[0];
      const record = { schema: 'tunacad-electrostatic-host-study/0.1',
        sourceIdentityVersion: ELECTROSTATIC_SOURCE_IDENTITY, configurationDigest: this.storage.configurationDigest,
        studyId, request: before.request,
        domainBinding: { domainId: domain.domainId, partId: domain.partId, bodyId: domain.bodyId,
          projectRevision: before.request.model.projectRevision },
        faces: domain.shape.faces, material: before.request.material,
        canonicalGeometryDigest: domain.geometryDigest, mesh: before.mesh, binding: before.identity };
      const recordDigest = digest(record);
      const records = await readdir(this.storage.paths.studies);
      if (records.length >= 16 && !records.includes(recordDigest.slice(7) + '.json')) invalid('study count bound');
      const pins = (await readdir(this.storage.paths['source-catalog'])).filter(name => name.endsWith('.study-pin.json'));
      if (pins.length >= 16 && !pins.includes(key(studyId) + '.study-pin.json')) invalid('study pin count bound');
      await writeElectrostaticHostOnce(join(this.storage.paths.studies, recordDigest.slice(7) + '.json'), record);
      await writeElectrostaticHostOnce(this.pinPath(studyId), { schema: 'tunacad-electrostatic-host-study-pin/0.1',
        studyId, sourceIdentityVersion: ELECTROSTATIC_SOURCE_IDENTITY,
        configurationDigest: this.storage.configurationDigest, recordDigest }, 2048);
      const final = await bindElectrostaticSource(studyId, this.capture);
      if (digest(final.identity) !== digest(before.identity)) invalid('source changed after publication');
      await this.readRecord(studyId); await this.storage.assertReady();
      return recordDigest;
    } finally { await lock.close(); await unlink(path); }
  }
  private async readRecord(studyId: string) {
    await this.storage.verifyConfiguration();
    const pin = await readElectrostaticHostJson(this.pinPath(studyId), 2048);
    if (Object.keys(pin).sort().join(',') !== 'configurationDigest,recordDigest,schema,sourceIdentityVersion,studyId'
      || pin.schema !== 'tunacad-electrostatic-host-study-pin/0.1' || pin.studyId !== studyId
      || pin.configurationDigest !== this.storage.configurationDigest
      || pin.sourceIdentityVersion !== ELECTROSTATIC_SOURCE_IDENTITY
      || !/^sha256:[a-f0-9]{64}$/.test(pin.recordDigest)) invalid('pin/version/configuration mismatch');
    const record = await readElectrostaticHostJson(join(this.storage.paths.studies, pin.recordDigest.slice(7) + '.json'));
    if (digest(record) !== pin.recordDigest || record.schema !== 'tunacad-electrostatic-host-study/0.1'
      || Object.keys(record).sort().join(',') !==
        'binding,canonicalGeometryDigest,configurationDigest,domainBinding,faces,material,mesh,request,schema,sourceIdentityVersion,studyId'
      || record.studyId !== studyId || record.sourceIdentityVersion !== ELECTROSTATIC_SOURCE_IDENTITY
      || record.configurationDigest !== this.storage.configurationDigest) invalid('immutable record/version mismatch');
    // Internal integrity recomputation only. This cannot substitute for the
    // surrounding live CAD reader on admission or retrieval.
    const rebound = await bindElectrostaticSource(studyId, {
      async readCurrentProjectRevision() { return record.request.model.projectRevision; },
      async readSealedRequest() { return record.request; },
      async readValidatedMesh() { return record.mesh; },
      readCurrentRuntimeIdentity: this.currentRuntime,
    });
    const domain = rebound.request.model.domains[0];
    if (digest(rebound.identity) !== digest(record.binding)
      || digest(record.domainBinding) !== digest({ domainId: domain.domainId, partId: domain.partId,
        bodyId: domain.bodyId, projectRevision: rebound.request.model.projectRevision })
      || digest(record.faces) !== digest(domain.shape.faces) || digest(record.material) !== digest(rebound.request.material)
      || record.canonicalGeometryDigest !== domain.geometryDigest) invalid('mesh/deck/runtime/source binding mismatch');
    const finalPin = await readElectrostaticHostJson(this.pinPath(studyId), 2048);
    await this.storage.verifyConfiguration();
    if (digest(finalPin) !== digest(pin)) invalid('study pin changed during read');
    return structuredClone(record);
  }
  async readSealedRequest(studyId: string) { return (await this.readRecord(studyId)).request; }
  /** Resolve a result's sealed request through protected owning-host pins only,
   * not a caller-supplied study/result association. Ambiguity fails closed. */
  async readStudyIdForRequest(requestDigest: string): Promise<string> {
    if (!/^sha256:[a-f0-9]{64}$/.test(requestDigest)) invalid('request digest');
    await this.storage.assertReady();
    const names = (await readdir(this.storage.paths['source-catalog'])).filter(n => n.endsWith('.study-pin.json'));
    if (names.length > 16) invalid('study lookup bound');
    const matches: string[] = [];
    for (const name of names) {
      const pin = await readElectrostaticHostJson(join(this.storage.paths['source-catalog'], name), 2048);
      if (typeof pin.studyId !== 'string' || name !== key(pin.studyId) + '.study-pin.json') invalid('study lookup pin');
      const record = await this.readRecord(pin.studyId);
      if (record.request.requestDigest === requestDigest) matches.push(record.studyId);
    }
    await this.storage.assertReady();
    if (matches.length !== 1) invalid('missing or ambiguous request study');
    return matches[0];
  }
  async readDomainBinding(studyId: string, domainId: string) {
    const record = await this.readRecord(studyId);
    return record.domainBinding.domainId === domainId ? record.domainBinding : null;
  }
  async readValidatedMesh(studyId: string) { return (await this.readRecord(studyId)).mesh; }
  async readCurrentRuntimeIdentity() { await this.storage.verifyConfiguration(); return this.currentRuntime(); }
}

/** No raw ledger is exposed. ACL/config checks bracket every save/replay;
 * existing ledger fresh-live-source, pins, cleanup and sticky quarantine remain
 * authoritative. Failed protection checks never expose the inner result. */
export class ProtectedElectrostaticLedger {
  private readonly ledger: FileElectrostaticLedger;
  constructor(private readonly storage: ElectrostaticHostStorage,
    liveReader: TrustedElectrostaticSourceReader,
    capture: Pick<ElectrostaticAdmissionLifecycle, 'readCompletedLedger'> | null = null) {
    this.ledger = new FileElectrostaticLedger(storage.paths.results,
      storage.paths['completion-catalog'], liveReader, capture);
  }
  async save(jobId: string) {
    await this.storage.assertReady();
    const root = await this.ledger.save(jobId);
    await this.storage.assertReady();
    return root;
  }
  async getResult(jobId: string) {
    try {
      await this.storage.assertReady();
      const result = await this.ledger.getResult(jobId);
      await this.storage.assertReady();
      return result;
    } catch { return null; }
  }
}
