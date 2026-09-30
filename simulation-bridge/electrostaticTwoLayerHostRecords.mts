import { open, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElectrostaticCadReaders, ElectrostaticHostRecords } from './electrostaticLiveSource.mts';
import { bindTwoLayerSource, type TrustedTwoLayerSourceReader } from './electrostaticTwoLayerAdmission.mts';
import { ElectrostaticHostStorage, ELECTROSTATIC_SOURCE_IDENTITY,
  readElectrostaticHostJson, writeElectrostaticHostOnce } from './electrostaticHostStorage.mts';
import { digest } from './stableDigest.mts';

function invalid(detail: string): never {
  throw new Error('ELECTROSTATIC_TWO_LAYER_HOST_RECORD_INVALID: ' + detail);
}
const key = (studyId: string) => {
  if (typeof studyId !== 'string' || !studyId.length || studyId.length > 160
    || [...studyId].some(c => c.charCodeAt(0) < 32)) invalid('study ID');
  return digest({ studyId, family: 'electrostatic-two-layer' }).slice(7);
};

/** Protected host record of the already live-validated 1 mm two-layer study.
 * This is not an alternative source of CAD truth: every read recomposes the
 * persisted mesh and rebinds both current native CAD bodies and runtime. */
export class FileElectrostaticTwoLayerHostRecords implements TrustedTwoLayerSourceReader, ElectrostaticHostRecords {
  readonly records: ElectrostaticHostRecords = this;
  readonly meshSizeMm = 1;
  constructor(private readonly storage: ElectrostaticHostStorage,
    readonly cad: ElectrostaticCadReaders,
    private readonly currentRuntime: () => Promise<unknown>,
    private readonly capture: TrustedTwoLayerSourceReader | null = null) {}
  private pinPath(studyId: string) {
    return join(this.storage.paths['source-catalog'], key(studyId) + '.two-layer-study-pin.json');
  }
  async publishStudy(studyId: string, assertUnchanged?: () => Promise<void>) {
    if (!this.capture || this.capture.meshSizeMm !== this.meshSizeMm) invalid('trusted 1 mm capture required');
    await this.storage.assertReady();
    const lockPath = join(this.storage.paths['source-catalog'], '.two-layer-study-writer.lock');
    const lock = await open(lockPath, 'wx', 0o600);
    try {
      const before = await bindTwoLayerSource(studyId, this.capture);
      const meshes = structuredClone(await this.capture.readLocalMeshes(studyId));
      const captured = await bindTwoLayerSource(studyId, {
        cad: this.capture.cad, records: this.capture.records,
        readSealedRequest: id => this.capture!.readSealedRequest(id),
        readLocalMeshes: async () => meshes,
        readCurrentRuntimeIdentity: () => this.capture!.readCurrentRuntimeIdentity(),
        meshSizeMm: this.meshSizeMm,
      });
      const after = await bindTwoLayerSource(studyId, this.capture);
      if (digest(before.identity) !== digest(captured.identity)
        || digest(before.identity) !== digest(after.identity))
        invalid('source/mesh changed during capture');
      const request = before.request;
      const record = JSON.parse(JSON.stringify({
        schema: 'tunacad-electrostatic-two-layer-host-study/0.1',
        sourceIdentityVersion: ELECTROSTATIC_SOURCE_IDENTITY,
        configurationDigest: this.storage.configurationDigest,
        studyId, request, meshSizeMm: this.meshSizeMm, localMeshes: meshes,
        domains: request.model.domains.map((d: any, i: number) => ({
          domainId: d.domainId, partId: d.partId, bodyId: d.bodyId,
          projectRevision: request.model.projectRevision,
          canonicalGeometryDigest: d.geometryDigest,
          material: request.materials[i],
        })),
        electrodeFaceIds: before.identity.electrodeFaceIds,
        interfaceFaceIds: before.identity.interfaceFaceIds,
        validatedMesh: {
          localMeshDigests: before.identity.localMeshDigests,
          fragmentMeshDigest: before.identity.fragmentMeshDigest,
          interfaceEvidence: before.verified.interfaceEvidence,
          nodes: before.verified.model.nodes.length,
          elements: before.verified.model.volumeElements.connectivity.length,
          deckDigest: before.identity.deckDigest,
          runtime: before.identity.runtime,
        },
        binding: before.identity,
      }));
      const recordDigest = digest(record);
      const names = await readdir(this.storage.paths.studies);
      if (names.filter(name => name.endsWith('.two-layer.json')).length >= 16
        && !names.includes(recordDigest.slice(7) + '.two-layer.json')) invalid('study count bound');
      const pins = await readdir(this.storage.paths['source-catalog']);
      if (pins.filter(name => name.endsWith('.two-layer-study-pin.json')).length >= 16
        && !pins.includes(key(studyId) + '.two-layer-study-pin.json')) invalid('pin count bound');
      await assertUnchanged?.();
      await writeElectrostaticHostOnce(
        join(this.storage.paths.studies, recordDigest.slice(7) + '.two-layer.json'), record);
      // An unpinned content-addressed record is inert. Check immediately
      // before the publication pin so mid-capture CAD changes expose nothing.
      await assertUnchanged?.();
      await writeElectrostaticHostOnce(this.pinPath(studyId), {
        schema: 'tunacad-electrostatic-two-layer-host-study-pin/0.1',
        studyId, sourceIdentityVersion: ELECTROSTATIC_SOURCE_IDENTITY,
        configurationDigest: this.storage.configurationDigest, recordDigest,
      }, 2048);
      await this.readRecord(studyId);
      await this.storage.assertReady();
      return { recordDigest, sourceDigest: before.identity.sourceDigest };
    } finally {
      await lock.close();
      await unlink(lockPath);
    }
  }
  private async readPinnedRecord(studyId: string) {
    await this.storage.verifyConfiguration();
    const pin = await readElectrostaticHostJson(this.pinPath(studyId), 2048);
    if (Object.keys(pin).sort().join(',') !== 'configurationDigest,recordDigest,schema,sourceIdentityVersion,studyId'
      || pin.schema !== 'tunacad-electrostatic-two-layer-host-study-pin/0.1'
      || pin.studyId !== studyId
      || pin.sourceIdentityVersion !== ELECTROSTATIC_SOURCE_IDENTITY
      || pin.configurationDigest !== this.storage.configurationDigest
      || !/^sha256:[a-f0-9]{64}$/.test(pin.recordDigest)) invalid('study pin/version/configuration');
    const record = await readElectrostaticHostJson(
      join(this.storage.paths.studies, pin.recordDigest.slice(7) + '.two-layer.json'));
    if (digest(record) !== pin.recordDigest
      || record.schema !== 'tunacad-electrostatic-two-layer-host-study/0.1'
      || Object.keys(record).sort().join(',') !==
        'binding,configurationDigest,domains,electrodeFaceIds,interfaceFaceIds,localMeshes,meshSizeMm,request,schema,sourceIdentityVersion,studyId,validatedMesh'
      || record.studyId !== studyId || record.meshSizeMm !== this.meshSizeMm
      || record.sourceIdentityVersion !== ELECTROSTATIC_SOURCE_IDENTITY
      || record.configurationDigest !== this.storage.configurationDigest
      || !Array.isArray(record.domains) || record.domains.length !== 2)
      invalid('incomplete/tampered study record');
    return { pin, record };
  }
  private async readRecord(studyId: string) {
    const { pin, record } = await this.readPinnedRecord(studyId);
    const domainBinding = async (_studyId: string, domainId: string) => {
      const rows = record.domains.filter((d: any) => d.domainId === domainId);
      if (rows.length !== 1) return null;
      const d = rows[0];
      return { domainId: d.domainId, partId: d.partId, bodyId: d.bodyId,
        projectRevision: d.projectRevision };
    };
    const rebound = await bindTwoLayerSource(studyId, {
      cad: this.cad,
      records: {
        readDomainBinding: domainBinding,
        readSealedRequest: async () => record.request,
        readValidatedMesh: async () => invalid('single-domain mesh unavailable'),
        readCurrentRuntimeIdentity: this.currentRuntime,
      },
      readSealedRequest: async () => record.request,
      readLocalMeshes: async () => record.localMeshes,
      readCurrentRuntimeIdentity: this.currentRuntime,
      meshSizeMm: this.meshSizeMm,
    });
    const expectedDomains = rebound.request.model.domains.map((d: any, i: number) => ({
      domainId: d.domainId, partId: d.partId, bodyId: d.bodyId,
      projectRevision: rebound.request.model.projectRevision,
      canonicalGeometryDigest: d.geometryDigest,
      material: rebound.request.materials[i],
    }));
    if (digest(record.binding) !== digest(rebound.identity)
      || digest(record.domains) !== digest(expectedDomains)
      || digest(record.electrodeFaceIds) !== digest(rebound.identity.electrodeFaceIds)
      || digest(record.interfaceFaceIds) !== digest(rebound.identity.interfaceFaceIds)
      || digest(record.validatedMesh) !== digest({
        localMeshDigests: rebound.identity.localMeshDigests,
        fragmentMeshDigest: rebound.identity.fragmentMeshDigest,
        interfaceEvidence: rebound.verified.interfaceEvidence,
        nodes: rebound.verified.model.nodes.length,
        elements: rebound.verified.model.volumeElements.connectivity.length,
        deckDigest: rebound.identity.deckDigest, runtime: rebound.identity.runtime,
      })) invalid('live CAD/mesh/interface/deck/runtime mismatch');
    const pinAgain = await readElectrostaticHostJson(this.pinPath(studyId), 2048);
    await this.storage.verifyConfiguration();
    if (digest(pinAgain) !== digest(pin)) invalid('study pin changed during read');
    return structuredClone(record);
  }
  /** Admission reads the protected pin and a fresh live-source rebound
   * together; a caller-supplied request, mesh or digest is not accepted. */
  async readAdmissionRecord(studyId: string) {
    const { pin } = await this.readPinnedRecord(studyId);
    const record = await this.readRecord(studyId);
    return { recordDigest: pin.recordDigest, record };
  }
  async readSealedRequest(studyId: string) { return (await this.readRecord(studyId)).request; }
  /** The outer binder recomposes and freshly rebinds these protected meshes. */
  async readLocalMeshes(studyId: string) {
    return structuredClone((await this.readPinnedRecord(studyId)).record.localMeshes);
  }
  async readDomainBinding(studyId: string, domainId: string) {
    const { record } = await this.readPinnedRecord(studyId);
    const rows = record.domains.filter((d: any) => d.domainId === domainId);
    if (rows.length !== 1) return null;
    const d = rows[0];
    return { domainId: d.domainId, partId: d.partId, bodyId: d.bodyId,
      projectRevision: d.projectRevision };
  }
  async readValidatedMesh(): Promise<never> { return invalid('two-domain mesh has no single mesh'); }
  async readCurrentRuntimeIdentity() {
    await this.storage.verifyConfiguration();
    return this.currentRuntime();
  }
}
