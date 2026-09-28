import { lstat, mkdir, open, readdir, unlink } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import * as z from 'zod/v4';
import { digest } from './stableDigest.mts';
import { bindElectrostaticSource, electrostaticNativeEvidenceSchema,
  type ElectrostaticAdmissionLifecycle, type TrustedElectrostaticSourceReader,
  type CompletedElectrostaticResult, type ElectrostaticSourceSnapshot } from './electrostaticAdmission.mts';

const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const jobIdSchema = z.string().regex(/^electrical_[a-f0-9-]{36}$/);
const pinSchema = z.object({ schema: z.literal('tunacad-electrostatic-ledger-pin/0.1'),
  jobId: jobIdSchema, recordDigest: hash }).strict();
const revocationSchema = z.object({ schema: z.literal('tunacad-electrostatic-ledger-quarantine/0.1'),
  jobId: jobIdSchema, quarantined: z.literal(true) }).strict();
const maximumRecordBytes = 16 * 1024 * 1024;
const maximumJobs = 16;
function invalid(detail: string): never { throw new Error('ELECTROSTATIC_LEDGER_INVALID: ' + detail); }
interface LedgerRecord {
  schema: 'tunacad-electrostatic-ledger/0.1'; jobId: string; studyId: string;
  source: { partId: string; bodyId: string; material: unknown; faces: unknown };
  completion: Record<string, unknown>; result: CompletedElectrostaticResult;
}
function sourceMetadata(snapshot: ElectrostaticSourceSnapshot) {
  const domain = snapshot.request.model.domains[0];
  return { partId: domain.partId, bodyId: domain.bodyId,
    material: snapshot.request.material, faces: domain.shape.faces };
}

/** Opt-in host-only filesystem ledger. Blob directory and independent protected
 * completion-pin/quarantine directory MUST be distinct trusted host roots, not
 * uploads/request data or repo files. Neither paths nor roots are API inputs.
 * Hashes are integrity checks, not signatures against compromise of BOTH roots.
 * Public operations take job IDs only; there is no caller record import. */
export class FileElectrostaticLedger {
  private readonly blobs: string;
  private readonly catalog: string;
  private readonly reader: TrustedElectrostaticSourceReader;
  private readonly capture: Pick<ElectrostaticAdmissionLifecycle, 'readCompletedLedger'> | null;
  #quarantined = new Set<string>();
  constructor(blobDirectory: string, trustedCatalogDirectory: string,
    reader: TrustedElectrostaticSourceReader,
    capture: Pick<ElectrostaticAdmissionLifecycle, 'readCompletedLedger'> | null = null) {
    this.blobs = resolve(blobDirectory); this.catalog = resolve(trustedCatalogDirectory);
    const nested = (a: string, b: string) => { const r = relative(a, b); return !r || (!r.startsWith('..') && !r.includes(':')); };
    if (nested(this.blobs, this.catalog) || nested(this.catalog, this.blobs)) invalid('storage roots must be separate');
    this.reader = reader; this.capture = capture;
  }
  private pinPath(id: string) { return join(this.catalog, digest({ jobId: jobIdSchema.parse(id) }).slice(7) + '.pin.json'); }
  private quarantinePath(id: string) { return join(this.catalog, digest({ jobId: jobIdSchema.parse(id) }).slice(7) + '.quarantine.json'); }
  private blobPath(root: string) { return join(this.blobs, hash.parse(root).slice(7) + '.json'); }
  private async directory(path: string) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) invalid('invalid storage directory');
  }
  private async read(path: string, maximumBytes: number): Promise<unknown> {
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || before.size > maximumBytes) invalid('file shape/size');
    const handle = await open(path, 'r');
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size !== before.size || info.size > maximumBytes || info.ino !== before.ino) invalid('file identity changed');
      // Fixed buffer + one sentinel byte prevents concurrent growth from
      // turning a checked file into an unbounded read.
      const buffer = new Uint8Array(new ArrayBuffer(before.size + 1));
      let size = 0;
      while (size < buffer.length) {
        const next = await handle.read(buffer, size, buffer.length - size, null);
        if (!next.bytesRead) break; size += next.bytesRead;
      }
      if (size > before.size) invalid('immutable file grew during read');
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size)));
    } finally { await handle.close(); }
  }
  private async writeOnce(path: string, value: unknown, maximumBytes: number) {
    const bytes = JSON.stringify(value);
    if (Buffer.byteLength(bytes) > maximumBytes) invalid('record budget');
    let handle;
    try { handle = await open(path, 'wx', 0o600); }
    catch (error: any) {
      if (error.code !== 'EEXIST') throw error;
      if (digest(await this.read(path, maximumBytes)) !== digest(value)) invalid('immutable record changed');
      return;
    }
    try { await handle.writeFile(bytes, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    // Exclusive writes are never overwritten. A crash/truncated write before
    // pin publication remains unauthenticated or malformed and fails closed.
  }
  private async readPin(id: string) {
    const root = await lstat(this.catalog);
    if (!root.isDirectory() || root.isSymbolicLink()) invalid('invalid catalog root');
    const pin = pinSchema.parse(await this.read(this.pinPath(id), 2048));
    if (pin.jobId !== id) invalid('catalog job mismatch');
    return pin;
  }
  private async isQuarantined(id: string) {
    if (this.#quarantined.has(id)) return true;
    try {
      const row = revocationSchema.parse(await this.read(this.quarantinePath(id), 2048));
      if (row.jobId !== id) invalid('quarantine identity mismatch');
      return true;
    } catch (error: any) {
      if (error.code === 'ENOENT') return false;
      // Malformed quarantine state is NOT interpreted as permission.
      throw error;
    }
  }
  private async quarantine(id: string) {
    // Do not create unlimited disk tombstones for unknown jobs. Existing pins
    // authenticate ownership of the bounded catalog slot.
    try {
      const info = await lstat(this.pinPath(id));
      if (!info) return;
      if (this.#quarantined.size < maximumJobs) this.#quarantined.add(id);
      await this.directory(this.catalog);
      await this.writeOnce(this.quarantinePath(id), {
        schema: 'tunacad-electrostatic-ledger-quarantine/0.1', jobId: id, quarantined: true,
      }, 2048);
    } catch { /* Nothing is exposed; unconfirmed quarantine stays fail-closed. */ }
  }
  private validate(record: LedgerRecord, id: string, source: ElectrostaticSourceSnapshot) {
    if (!record || Object.keys(record).sort().join(',') !== 'completion,jobId,result,schema,source,studyId'
      || record.schema !== 'tunacad-electrostatic-ledger/0.1' || record.jobId !== id
      || record.studyId !== source.request.studyId) invalid('record identity/schema');
    const result = record.result; const completion = record.completion;
    if (!result || !completion) invalid('incomplete result/completion');
    const { resultDigest, ...unsigned } = result;
    const { resultDigest: electricalDigest, ...electricalUnsigned } = result.electrical ?? {};
    if (result.schema !== 'tunacad-electrostatic-completed-result/0.1'
      || result.jobId !== id || result.completedProviderState !== 'completed_converged'
      || result.status !== 'proof_of_concept' || result.engineeringUsePermitted !== false
      || result.providerAdmission !== 'closed' || digest(unsigned) !== resultDigest
      || digest(electricalUnsigned) !== electricalDigest
      || electricalDigest !== result.normalizedElectricalResultDigest
      || digest(result.binding) !== digest(source.identity)
      || digest(record.source) !== digest(sourceMetadata(source))
      || result.completionDigest !== digest(completion)
      || completion.schema !== 'tunacad-electrostatic-provider-completion/0.1'
      || completion.jobId !== id || completion.sourceDigest !== source.identity.sourceDigest
      || completion.state !== 'completed_converged' || completion.cleanupConfirmed !== true
      || completion.normalizedElectricalResultDigest !== electricalDigest
      || completion.rawOutputDigest !== result.electrical.rawOutputDigest
      || digest(completion.runtime) !== digest(source.identity.runtime)
      || result.electrical.requestDigest !== source.request.requestDigest
      || result.electrical.projectRevision !== source.request.model.projectRevision
      || result.electrical.meshDigest !== source.identity.meshDigest
      || result.electrical.geometryDigest !== source.identity.geometryDigest
      || result.electrical.domainId !== source.identity.domainId
      || digest(result.electrical.materialProvenance) !== digest(source.request.material.source)) invalid('completion/result/source mismatch');
    electrostaticNativeEvidenceSchema.parse(completion.nativeEvidence);
  }
  async save(jobId: string): Promise<string> {
    jobIdSchema.parse(jobId);
    if (!this.capture || await this.isQuarantined(jobId)) invalid('capture unavailable/quarantined');
    await this.directory(this.catalog);
    // Exclusive host writer lock protects the 16-record bound across instances
    // and processes. Crash-left lock blocks new saves (no automatic deletion);
    // existing pinned records can still replay through all fresh checks.
    const path = join(this.catalog, '.writer.lock');
    const lock = await open(path, 'wx', 0o600);
    try { return await this.saveLocked(jobId); }
    finally { await lock.close(); await unlink(path); }
  }
  private async saveLocked(jobId: string): Promise<string> {
    jobIdSchema.parse(jobId);
    if (!this.capture || await this.isQuarantined(jobId)) invalid('capture unavailable/quarantined');
    const captured = await this.capture.readCompletedLedger(jobId);
    if (!captured) invalid('job not successfully completed and cleaned');
    const before = await bindElectrostaticSource(captured.studyId, this.reader);
    const record: LedgerRecord = { schema: 'tunacad-electrostatic-ledger/0.1', jobId,
      studyId: captured.studyId, source: sourceMetadata(before),
      completion: captured.completion, result: captured.result };
    this.validate(record, jobId, before);
    const after = await bindElectrostaticSource(captured.studyId, this.reader);
    this.validate(record, jobId, after);
    await this.directory(this.blobs); await this.directory(this.catalog);
    const files = await readdir(this.catalog);
    const alreadyPinned = files.includes(this.pinPath(jobId).split(/[\\/]/).at(-1)!);
    if (!alreadyPinned && files.filter(name => name.endsWith('.pin.json')).length >= maximumJobs) invalid('job count bound');
    if ((await readdir(this.blobs)).length >= maximumJobs
      && !(await readdir(this.blobs)).includes(this.blobPath(digest(record)).split(/[\\/]/).at(-1)!)) invalid('blob count bound');
    const recordDigest = digest(record);
    await this.writeOnce(this.blobPath(recordDigest), record, maximumRecordBytes);
    await this.writeOnce(this.pinPath(jobId), { schema: 'tunacad-electrostatic-ledger-pin/0.1', jobId, recordDigest }, 2048);
    // Rebind after durable write too. A source change during persistence never
    // authorizes replay and leaves a durable quarantine marker when pinned.
    if (!await this.getResult(jobId)) invalid('post-save rebind failed');
    return recordDigest;
  }
  async getResult(jobId: string): Promise<CompletedElectrostaticResult | null> {
    jobIdSchema.parse(jobId);
    try {
      if (await this.isQuarantined(jobId)) return null;
      const pin = await this.readPin(jobId);
      const root = await lstat(this.blobs);
      if (!root.isDirectory() || root.isSymbolicLink()) invalid('invalid blob directory');
      const record = await this.read(this.blobPath(pin.recordDigest), maximumRecordBytes) as LedgerRecord;
      if (digest(record) !== pin.recordDigest) invalid('record digest mismatch');
      const before = await bindElectrostaticSource(record.studyId, this.reader);
      this.validate(record, jobId, before);
      const after = await bindElectrostaticSource(record.studyId, this.reader);
      this.validate(record, jobId, after);
      const finalPin = await this.readPin(jobId);
      if (finalPin.recordDigest !== pin.recordDigest) invalid('completion pin changed during replay');
      if (await this.isQuarantined(jobId)) return null;
      return structuredClone(record.result);
    } catch { await this.quarantine(jobId); return null; }
  }
}
