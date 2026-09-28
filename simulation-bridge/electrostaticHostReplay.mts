import { ElectrostaticHostStorage } from './electrostaticHostStorage.mts';
import { FileElectrostaticHostRecords, ProtectedElectrostaticLedger } from './electrostaticHostRecords.mts';
import type { TrustedElectrostaticSourceReader } from './electrostaticAdmission.mts';
import type { ElectrostaticHostRecords } from './electrostaticLiveSource.mts';
import { buildElectricalFields, electricalFieldPage } from '../providers/calculix/CalculiXElectrostaticFields.mts';

/** Owning-host bootstrap only: root/runtime/live-reader are trusted host wiring,
 * never API request values. There is no result import, solver, approval bypass,
 * legacy migration or ACL repair. Stored records cannot replace live CAD truth.
 * A new process needs only protected files and an independently reopened CAD
 * source; no lifecycle instance or cached completion is accepted. */
export class ElectrostaticHostReplay {
  private constructor(readonly storage: ElectrostaticHostStorage,
    private readonly records: FileElectrostaticHostRecords,
    private readonly ledger: ProtectedElectrostaticLedger) {}

  static async open(root: string, currentRuntime: () => Promise<unknown>,
    liveReader: (records: ElectrostaticHostRecords) => TrustedElectrostaticSourceReader) {
    const storage = await ElectrostaticHostStorage.open(root);
    const records = new FileElectrostaticHostRecords(storage, currentRuntime);
    return new this(storage, records, new ProtectedElectrostaticLedger(storage, liveReader(records)));
  }

  async getResult(jobId: string) {
    return this.ledger.getResult(jobId); // Protected checks + fresh live source bracket replay.
  }

  async getFieldManifest(jobId: string) {
    const result = await this.getResult(jobId);
    if (!result) return null;
    const studyId = await this.records.readStudyIdForRequest(result.binding.requestDigest);
    const mesh = await this.records.readValidatedMesh(studyId);
    const fields = buildElectricalFields(jobId, result, mesh);
    const after = await this.getResult(jobId);
    if (!after || after.resultDigest !== result.resultDigest) return null;
    return { resultDigest: result.resultDigest,
      fieldDatasets: [...fields.values()].map(f => structuredClone(f.descriptor)) };
  }

  async getFieldDataset(jobId: string, datasetId: string, cursor = '0', limit = 128) {
    const result = await this.getResult(jobId);
    if (!result) throw new Error('ELECTROSTATIC_REPLAY_FIELD_QUARANTINED');
    const studyId = await this.records.readStudyIdForRequest(result.binding.requestDigest);
    const mesh = await this.records.readValidatedMesh(studyId);
    const field = buildElectricalFields(jobId, result, mesh).get(datasetId);
    if (!field) throw new Error('ELECTROSTATIC_REPLAY_DATASET_MISMATCH');
    const page = electricalFieldPage(field, cursor, limit);
    const after = await this.getResult(jobId);
    if (!after || after.resultDigest !== result.resultDigest) throw new Error('ELECTROSTATIC_REPLAY_FIELD_QUARANTINED');
    return structuredClone(page);
  }
}
