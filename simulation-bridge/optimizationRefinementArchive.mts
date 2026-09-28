import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { digest } from './stableDigest.mts';
import { validateNeutralFemModelV2 } from './v2Validation.mts';
import { bindOptimizationSnapshot, cadParameterSnapshotSchema } from './optimizationFoundation.mts';
import { readVerifiedOptimizationStressField } from './optimizationVerifiedStressField.mts';
import { assessOptimizationPeak, optimizationRefinementRecordSchema,
  optimizationNumericalEvidenceSchema, admitOptimizationNumericalEvidence,
  type TrustedOptimizationNumericalCandidateReader,
  type TrustedOptimizationEvidenceReader } from './optimizationEvidenceAdmission.mts';

/** Host/provider-owned completion readers. Never create these from MCP JSON.
 * The mesh definition must come from the mesher's actual submitted options. */
export interface TrustedRefinementCaptureSource extends TrustedOptimizationNumericalCandidateReader {
  readCompletedStudyId(jobId: string): Promise<string>;
  readValidatedFemModel(jobId: string): Promise<any>;
  readMeshDefinition(jobId: string): Promise<{
    mode: 'global' | 'local_diagnostic'; globalSizeMm: number; localSizeMm: number | null;
    definition: unknown;
  }>;
  readCurrentRuntimeTuple(): Promise<unknown>;
}
/** Independent trusted completion ledger. Its durable implementation belongs
 * to the host's protected state store, NOT to request input or archive files.
 * An archive blob cannot establish its own authenticity by supplying a hash. */
export interface TrustedOptimizationArchiveCatalog {
  pinOnce(kind: 'refinement' | 'evidence', id: string, blobDigest: string): Promise<void>;
  readPinned(kind: 'refinement' | 'evidence', id: string): Promise<string | null>;
}
/** Separate host-owned completion ledger, outside the archive blob directory.
 * Its directory must be protected as trusted host state (not upload/request
 * storage). OS-level alteration of that trust root is outside digest security.
 * No paths or hashes from an MCP caller are accepted here. */
export class FileOptimizationArchiveCatalog implements TrustedOptimizationArchiveCatalog {
  private readonly directory: string;
  constructor(directory: string) { this.directory = resolve(directory); }
  private path(kind: string, id: string) { return join(this.directory, digest({ kind, id }).slice(7) + '.json'); }
  async readPinned(kind: 'refinement' | 'evidence', id: string) {
    try {
      const path = this.path(kind, id), info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 2048) invalid('catalog entry invalid');
      const row = JSON.parse(await readFile(path, 'utf8'));
      if (row.kind !== kind || row.id !== id || !/^sha256:[a-f0-9]{64}$/.test(row.blobDigest)) invalid('catalog identity invalid');
      return row.blobDigest as string;
    } catch (error: any) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async pinOnce(kind: 'refinement' | 'evidence', id: string, blobDigest: string) {
    if (!/^sha256:[a-f0-9]{64}$/.test(blobDigest)) invalid('catalog digest invalid');
    await mkdir(this.directory, { recursive: true });
    try { await writeFile(this.path(kind, id), JSON.stringify({ kind, id, blobDigest }),
      { encoding: 'utf8', flag: 'wx', mode: 0o600 }); }
    catch (error: any) {
      if (error.code !== 'EEXIST') throw error;
      if (await this.readPinned(kind, id) !== blobDigest) invalid('catalog completion root changed');
    }
  }
}
function invalid(message: string): never {
  throw new Error('SIM9_OPTIMIZATION_ARCHIVE_INVALID: ' + message);
}
const maxBytes = 32 * 1024 * 1024;
const clone = <T>(value: T): T => structuredClone(value);

/** Opt-in normalized-evidence storage; no raw solver artifacts or provider
 * paths. Caller-facing operations accept IDs only, never trusted snapshots.
 * Content-addressed, exclusive writes + independently pinned completion roots.
 * This does not advertise optimization admission to Bridge/MCP. */
export class OptimizationRefinementArchive {
  private readonly directory: string;
  private readonly source: TrustedRefinementCaptureSource;
  private readonly catalog: TrustedOptimizationArchiveCatalog;
  constructor(directory: string, source: TrustedRefinementCaptureSource,
    catalog: TrustedOptimizationArchiveCatalog) {
    this.directory = resolve(directory);
    this.source = source; this.catalog = catalog;
  }
  private path(hash: string) {
    if (!/^sha256:[a-f0-9]{64}$/.test(hash)) invalid('invalid trusted catalog root');
    return join(this.directory, hash.slice(7) + '.json');
  }
  private async write(kind: 'refinement' | 'evidence', id: string, value: unknown) {
    const hash = digest(value), bytes = JSON.stringify(value);
    if (Buffer.byteLength(bytes) > maxBytes) invalid('archive size bound');
    const pinned = await this.catalog.readPinned(kind, id);
    if (pinned && pinned !== hash) invalid('immutable completion root changed');
    await mkdir(this.directory, { recursive: true });
    try { await writeFile(this.path(hash), bytes, { encoding: 'utf8', flag: 'wx', mode: 0o600 }); }
    catch (error: any) {
      if (error.code !== 'EEXIST') throw error;
      if (digest(await this.readBlob(hash)) !== hash) invalid('existing blob altered');
    }
    await this.catalog.pinOnce(kind, id, hash);
    return hash;
  }
  private async readBlob(hash: string) {
    const path = this.path(hash), info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) invalid('invalid archive file');
    let value: any;
    try { value = JSON.parse(await readFile(path, 'utf8')); }
    catch { invalid('missing or malformed archive'); }
    if (digest(value) !== hash) invalid('archive content digest changed');
    return value;
  }
  private async read(kind: 'refinement' | 'evidence', id: string) {
    const hash = await this.catalog.readPinned(kind, id);
    if (!hash) invalid('missing trusted completion root');
    return this.readBlob(hash);
  }
  private async captureSnapshot(jobId: string) {
    const studyId = await this.source.readCompletedStudyId(jobId);
    const request: any = clone(await this.source.readStudyRequest(studyId));
    const result: any = clone(await this.source.readCompletedResult(jobId));
    const model = clone(await this.source.readValidatedFemModel(jobId));
    const runtime: any = clone(await this.source.readCurrentRuntimeTuple());
    if (runtime?.gmsh !== '4.15.2' || runtime?.calculix !== '2.16' || runtime?.nodeMajor !== 24
      || request?.analysis?.type !== 'linear_static' || request.model.domains.length !== 1
      || result?.status !== 'succeeded' || result.convergence?.status !== 'converged'
      || result.jobId !== jobId || result.studyId !== studyId
      || model?.provenance?.engine !== 'Gmsh' || model.provenance.engineVersion !== runtime.gmsh) {
      invalid('completed provider state or runtime missing');
    }
    validateNeutralFemModelV2(model, request);
    const domain = request.model.domains[0];
    const parameter = cadParameterSnapshotSchema.parse(await this.source.readCadParameter(
      request.model.projectRevision, 'thickness-extrude', 'thickness'));
    const assignment = request.materialAssignments.find((item: any) => item.domainId === domain.domainId);
    const material = request.materials.find((item: any) => item.id === assignment?.materialId);
    const datasetId = result.perDomain.find((item: any) => item.domainId === domain.domainId)
      ?.fieldDatasetIds.find((id: string) => id.endsWith(':stress'));
    if (!datasetId) invalid('domain stress field missing');
    const pages: any[] = [];
    const field = await readVerifiedOptimizationStressField(jobId, datasetId, async (cursor, limit) => {
      const page = clone(await this.source.readStressFieldPage(jobId, datasetId, cursor, limit));
      pages.push(page);
      return page;
    });
    const source = { studyId, structuralJobId: jobId, requestDigest: request.requestDigest,
      resultDigest: digest(result), projectRevision: request.model.projectRevision,
      modelDigest: request.model.modelDigest, domainId: domain.domainId, partId: domain.partId,
      bodyId: domain.bodyId, materialId: material.id, materialProvenance: material.source,
      semanticReferenceId: 'load-face', stressFieldDatasetId: datasetId,
      stressFieldDatasetDigest: field.descriptor.datasetDigest,
      stressFieldDescriptorDigest: digest(field.descriptor) };
    const peaks = result.criticalRegions.filter((item: any) =>
      item.domainId === domain.domainId && item.kind === 'stress');
    if (peaks.length !== 1 || peaks[0].unit !== 'MPa'
      || field.maximumSurfaceStressMPa > peaks[0].value + 1e-6) invalid('raw peak missing or inconsistent');
    // Provider reports a raw-maximum element centroid. Resolve it against the
    // validated domain-owned FEM model; do not guess the nearest boundary facet.
    const region = model.domainRegions.find((item: any) => item.domainId === domain.domainId);
    const matches = region.elementIndices.filter((index: number) => {
      const corners = model.volumeElements.connectivity[index].slice(0, 4);
      const centroid = [0, 1, 2].map(axis => corners.reduce((sum: number, node: number) =>
        sum + model.nodes[node][axis], 0) / 4);
      return centroid.every((value, axis) => Math.abs(value - peaks[0].positionAnalysisMm[axis]) <= 1e-10);
    });
    if (matches.length !== 1) invalid('peak element cannot be resolved uniquely');
    const definition = clone(await this.source.readMeshDefinition(jobId));
    if (definition.globalSizeMm !== request.mesh.globalSizeMm
      || (definition.mode === 'global') !== (definition.localSizeMm === null)
      || digest(definition.definition) !== model.provenance.optionsDigest) invalid('mesh definition mismatch');
    const record = optimizationRefinementRecordSchema.parse({
      schema: 'tunacad-optimization-refinement-record/0.1', source,
      metric: 'raw_domain_maximum_von_mises', unit: 'MPa', cadVolumeMm3: domain.shape.volumeMm3,
      rawMaximumStressMPa: peaks[0].value, peakPositionAnalysisMm: peaks[0].positionAnalysisMm,
      criticalRegion: assessOptimizationPeak(request, peaks[0].positionAnalysisMm,
        definition.localSizeMm ?? definition.globalSizeMm),
      mesh: { mode: definition.mode, globalSizeMm: definition.globalSizeMm,
        localSizeMm: definition.localSizeMm, nodeCount: model.quality.nodeCount,
        elementCount: model.quality.elementCount, optionsDigest: model.provenance.optionsDigest },
    });
    await bindOptimizationSnapshot({ inputDigest: digest(record), source,
      variable: { kind: 'cad_length', featureId: parameter.featureId, parameterId: parameter.parameterId,
        baselineMm: parameter.valueMm, minimumMm: 8, maximumMm: 12, unit: 'mm',
        snapshotDigest: digest(parameter), provenance: parameter.provenance },
      objective: { kind: 'minimize_domain_volume', domainId: domain.domainId,
        baselineVolumeMm3: record.cadVolumeMm3, unit: 'mm^3' },
      constraint: { kind: 'domain_von_mises_upper_bound', domainId: domain.domainId,
        semanticReferenceId: source.semanticReferenceId, stressFieldDatasetId: datasetId,
        baselineStressMPa: record.rawMaximumStressMPa, upperBoundMPa: 2, unit: 'MPa' },
    }, this.source);
    return { schema: 'tunacad-optimization-refinement-archive/0.1', record,
      recordDigest: digest(record), runtime, parameter, request, result, model,
      meshDefinition: definition, pages, peak: { elementIndex: matches[0],
        indexing: 'zero_based_composed_fem', positionAnalysisMm: peaks[0].positionAnalysisMm },
      completedProviderState: 'succeeded_converged' };
  }
  async captureCompletedRefinement(jobId: string) {
    const before = await this.captureSnapshot(jobId), after = await this.captureSnapshot(jobId);
    if (digest(before) !== digest(after)) invalid('source changed during capture');
    return { blobDigest: await this.write('refinement', jobId, before), recordDigest: before.recordDigest };
  }
  async readRefinement(jobId: string) {
    const value = await this.read('refinement', jobId);
    if (value.schema !== 'tunacad-optimization-refinement-archive/0.1'
      || value.record.source.structuralJobId !== jobId
      || digest(value.record) !== value.recordDigest
      || digest(await this.source.readCurrentRuntimeTuple()) !== digest(value.runtime)
      || await this.source.readCurrentProjectRevision() !== value.record.source.projectRevision
      || digest(await this.source.readStudyRequest(value.record.source.studyId)) !== digest(value.request)
      || digest(await this.source.readCompletedResult(jobId)) !== digest(value.result)
      || digest(await this.source.readCadParameter(value.record.source.projectRevision,
        value.parameter.featureId, value.parameter.parameterId)) !== digest(value.parameter)) {
      invalid('stale revision, parameter, runtime or completion identity');
    }
    return clone(value);
  }
  /** Readers reload on EVERY call, including the guard's second verification.
   * They do not accept records or expected hashes from caller JSON. */
  readers(): TrustedOptimizationNumericalCandidateReader & TrustedOptimizationEvidenceReader {
    const read = (id: string) => this.readRefinement(id);
    return {
      readCurrentProjectRevision: () => this.source.readCurrentProjectRevision(),
      readCurrentRuntimeTuple: () => this.source.readCurrentRuntimeTuple(),
      readCadParameter: (...args) => this.source.readCadParameter(...args),
      readCadChangeSet: (...args) => this.source.readCadChangeSet(...args),
      readStudyRequest: id => this.source.readStudyRequest(id),
      readCompletedResult: async id => (await read(id)).result,
      readStressFieldDescriptor: async (id, dataset) => {
        const row = await read(id);
        return row.pages[0].dataset.datasetId === dataset ? row.pages[0].dataset : null;
      },
      readStressFieldPage: async (id, dataset, cursor, limit) => {
        if (limit !== 128) invalid('archive pages require the bounded 128-triangle verifier');
        const row = await read(id);
        return row.pages.find((page: any) => page.cursor === cursor && page.dataset.datasetId === dataset) ?? null;
      },
      readRefinementRecord: async id => (await read(id)).record,
      readMeshSummary: async id => {
        const row = await read(id);
        return { jobId: id, requestDigest: row.request.requestDigest, resultDigest: digest(row.result),
          nodeCount: row.model.quality.nodeCount, elementCount: row.model.quality.elementCount,
          optionsDigest: row.model.provenance.optionsDigest };
      },
      readEvidence: async id => this.read('evidence', id),
    };
  }
  /** Trusted host calls this with its own sealed manifest; never exposed to MCP.
   * Missing jobs/changed roots cannot be pinned merely by supplying digests. */
  async pinCompletedEvidence(value: unknown, candidateArchive: OptimizationRefinementArchive) {
    const evidence = optimizationNumericalEvidenceSchema.parse(value);
    for (const [lane, archive] of [[evidence.baseline, this], [evidence.candidate, candidateArchive]] as const) {
      for (const ref of [...lane.global, ...lane.diagnostics]) {
        const row = await archive.readRefinement(ref.jobId);
        if (row.recordDigest !== ref.recordDigest) invalid('evidence references another record');
      }
    }
    return this.write('evidence', evidence.evidenceId, evidence);
  }
  async admit(evidenceId: string, baseline: unknown, candidate: unknown,
    candidateArchive: OptimizationRefinementArchive) {
    const evidence = await this.read('evidence', evidenceId);
    const reader = this.readers(), candidateReader = candidateArchive.readers();
    const combined = { ...reader,
      readRefinementRecord: async (id: string) => evidence.candidate.global.concat(evidence.candidate.diagnostics)
        .some((ref: any) => ref.jobId === id) ? candidateReader.readRefinementRecord(id) : reader.readRefinementRecord(id),
      readMeshSummary: async (id: string) => evidence.candidate.global.concat(evidence.candidate.diagnostics)
        .some((ref: any) => ref.jobId === id) ? candidateReader.readMeshSummary(id) : reader.readMeshSummary(id),
    };
    return admitOptimizationNumericalEvidence(baseline, candidate,
      { evidenceId, evidenceDigest: digest(evidence) }, reader, candidateReader, combined);
  }
}
