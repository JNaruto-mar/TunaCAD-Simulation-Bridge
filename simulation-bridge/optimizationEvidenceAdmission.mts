import * as z from 'zod/v4';
import { digest } from './stableDigest.mts';
import { readVerifiedOptimizationStressField } from './optimizationVerifiedStressField.mts';
import { bindOptimizationSnapshot, optimizationFoundationSchema,
  validateOptimizationFoundation, type TrustedOptimizationSourceReader } from './optimizationFoundation.mts';
import { compareOptimizationCandidate, validateOptimizationCandidate,
  type TrustedOptimizationCandidateReader } from './optimizationCandidate.mts';

const id = z.string().min(1).max(160);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const positive = z.number().finite().positive();
const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
/** Captured in a trusted evidence store at completion, from the validated FEM
 * model and completed full raw-stress result, never from caller JSON. */
export const optimizationRefinementRecordSchema = z.object({
  schema: z.literal('tunacad-optimization-refinement-record/0.1'),
  source: optimizationFoundationSchema.shape.source,
  metric: z.literal('raw_domain_maximum_von_mises'), unit: z.literal('MPa'),
  cadVolumeMm3: positive, rawMaximumStressMPa: positive,
  peakPositionAnalysisMm: vector,
  criticalRegion: z.object({
    kind: z.enum(['none', 'restraint_edge', 'load_edge']),
    distanceMm: z.number().finite().nonnegative(),
  }).strict(),
  mesh: z.object({
    mode: z.enum(['global', 'local_diagnostic']),
    globalSizeMm: positive, localSizeMm: positive.nullable(),
    nodeCount: z.number().int().positive().max(15000),
    elementCount: z.number().int().positive().max(7500),
    optionsDigest: hash,
  }).strict(),
}).strict();
export type OptimizationRefinementRecord = z.infer<typeof optimizationRefinementRecordSchema>;
const ref = z.object({ jobId: id, recordDigest: hash }).strict();
const lane = z.object({
  selectedSourceDigest: hash,
  global: z.array(ref).length(3),
  diagnostics: z.array(ref).max(2),
}).strict();
export const optimizationNumericalEvidenceSchema = z.object({
  schema: z.literal('tunacad-optimization-numerical-evidence/0.1'),
  evidenceId: id, baselineInputDigest: hash, candidateInputDigest: hash,
  comparisonDigest: hash,
  policy: z.literal('raw-maximum-stability/1'),
  runtime: z.object({ gmsh: z.literal('4.15.2'), calculix: z.literal('2.16'),
    nodeMajor: z.literal(24) }).strict(),
  baseline: lane, candidate: lane,
}).strict();
export type OptimizationNumericalEvidence = z.infer<typeof optimizationNumericalEvidenceSchema>;
export interface TrustedOptimizationEvidenceReader {
  readEvidence(evidenceId: string): Promise<unknown>;
  readRefinementRecord(jobId: string): Promise<unknown>;
  /** Independently retained validated-FEM summary, not the proposed record. */
  readMeshSummary(jobId: string): Promise<unknown>;
  readCurrentRuntimeTuple(): Promise<unknown>;
}
const meshSummarySchema = z.object({
  jobId: id, requestDigest: hash, resultDigest: hash,
  nodeCount: z.number().int().positive(), elementCount: z.number().int().positive(),
  optionsDigest: hash,
}).strict();
export interface TrustedOptimizationNumericalSourceReader extends TrustedOptimizationSourceReader {
  readStressFieldPage(jobId: string, datasetId: string, cursor: string, limit: number): Promise<unknown>;
}
export interface TrustedOptimizationNumericalCandidateReader extends TrustedOptimizationCandidateReader,
  TrustedOptimizationNumericalSourceReader {}
function invalid(reason: string): never {
  throw new Error('SIM9_OPTIMIZATION_EVIDENCE_INVALID: ' + reason);
}
/** Bounded rectangular-FACE fixture assessment, derived from sealed geometry,
 * not an evidence-supplied claim that a rising peak is outside a critical zone. */
export function assessOptimizationPeak(request: any, point: [number, number, number], resolutionMm: number) {
  if (digest(request.model.domains[0].transformToAnalysis)
    !== digest([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])) invalid('unsupported peak-assessment transform');
  const distances: Array<{ kind: 'restraint_edge' | 'load_edge'; distanceMm: number }> = [];
  for (const reference of request.model.references) {
    if (reference.role !== 'constraint' && reference.role !== 'load') continue;
    const box = reference.faceOwnerLocal?.boundingBoxMm;
    if (!box || !vector.safeParse(box.min).success || !vector.safeParse(box.max).success) invalid('critical FACE assessment missing');
    if (reference.faceOwnerLocal.geometryType !== 'plane'
      || reference.faceOwnerLocal.edgeCount !== 4) invalid('unsupported critical FACE geometry');
    const axes = [0, 1, 2].filter(axis => box.max[axis] > box.min[axis]);
    const normal = [0, 1, 2].filter(axis => box.max[axis] === box.min[axis]);
    if (axes.length !== 2 || normal.length !== 1) invalid('unsupported critical FACE assessment');
    const [a, b] = axes, n = normal[0];
    if (!Number.isFinite(reference.faceOwnerLocal.areaMm2) || Math.abs(reference.faceOwnerLocal.areaMm2
      - (box.max[a] - box.min[a]) * (box.max[b] - box.min[b])) > 1e-8) invalid('critical FACE area mismatch');
    const clamp = (axis: number) => Math.min(box.max[axis], Math.max(box.min[axis], point[axis]));
    const edgeDistanceSquared = Math.min(
      ...[box.min[a], box.max[a]].map(edge => (point[a] - edge) ** 2 + (point[b] - clamp(b)) ** 2),
      ...[box.min[b], box.max[b]].map(edge => (point[b] - edge) ** 2 + (point[a] - clamp(a)) ** 2));
    distances.push({ kind: reference.role === 'constraint' ? 'restraint_edge' : 'load_edge',
      distanceMm: Math.sqrt((point[n] - box.min[n]) ** 2 + edgeDistanceSquared) });
  }
  if (!distances.some(item => item.kind === 'restraint_edge')
    || !distances.some(item => item.kind === 'load_edge')) invalid('load/restraint peak assessment missing');
  distances.sort((a, b) => a.distanceMm - b.distanceMm || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
  const nearest = distances[0];
  return { kind: nearest.distanceMm <= 2 * resolutionMm ? nearest.kind : 'none',
    distanceMm: nearest.distanceMm };
}

/** Separate evidence gate: the existing immutable comparison remains nominal.
 * Missing/changed evidence throws; authentic but unstable evidence returns FAIL
 * with robustFeasible=false, never a substitute stress metric or admitted score. */
export async function admitOptimizationNumericalEvidence(
  baselineValue: unknown, candidateValue: unknown,
  reference: { evidenceId: string; evidenceDigest: string },
  baselineReader: TrustedOptimizationNumericalSourceReader,
  candidateReader: TrustedOptimizationNumericalCandidateReader,
  evidenceReader: TrustedOptimizationEvidenceReader,
) {
  const baseline = validateOptimizationFoundation(baselineValue);
  const candidate = validateOptimizationCandidate(candidateValue, baseline);
  if (baseline.constraint.upperBoundMPa !== 2 || baseline.variable.parameterId !== 'thickness') {
    invalid('only the existing thickness/raw-domain-maximum 2 MPa scope is admitted');
  }
  if (!id.safeParse(reference.evidenceId).success || !hash.safeParse(reference.evidenceDigest).success) invalid('evidence reference');
  const comparison = await compareOptimizationCandidate(baseline, candidate, baselineReader, candidateReader);
  const readEvidence = async () => {
    const parsed = optimizationNumericalEvidenceSchema.safeParse(
      await evidenceReader.readEvidence(reference.evidenceId));
    if (!parsed.success) invalid('missing, malformed, or unsupported numerical evidence');
    const evidence = parsed.data;
    if (digest(evidence) !== reference.evidenceDigest || evidence.evidenceId !== reference.evidenceId
      || evidence.baselineInputDigest !== baseline.inputDigest
      || evidence.candidateInputDigest !== candidate.inputDigest
      || evidence.comparisonDigest !== digest(comparison)
      || evidence.baseline.selectedSourceDigest !== digest(baseline.source)
      || evidence.candidate.selectedSourceDigest !== digest(candidate.source)) invalid('stale or mismatched evidence identity/digest');
    if (digest(await evidenceReader.readCurrentRuntimeTuple()) !== digest(evidence.runtime)) invalid('runtime tuple changed');
    return evidence;
  };
  const evidence = await readEvidence();
  const verifyLane = async (kind: 'baseline' | 'candidate') => {
    const selected = kind === 'baseline' ? baseline.source : candidate.source;
    const reader = kind === 'baseline' ? baselineReader : candidateReader;
    const variable = kind === 'baseline' ? baseline.variable : {
      ...baseline.variable, baselineMm: candidate.variable.valueMm,
      snapshotDigest: candidate.variable.snapshotDigest, provenance: candidate.variable.provenance,
    };
    const volume = kind === 'baseline' ? baseline.objective.baselineVolumeMm3 : candidate.objective.volumeMm3;
    const selectedRequest = await reader.readStudyRequest(selected.studyId);
    const physics = (raw: unknown) => {
      if (!raw || typeof raw !== 'object') invalid('request missing');
      const request = raw as any;
      const { requestDigest, model, studyId, name, preparedAt, expiresAt, mesh, ...rest } = request;
      if (digest({ model, studyId, name, preparedAt, expiresAt, mesh, ...rest }) !== requestDigest) invalid('request digest');
      const { globalSizeMm, minimumSizeMm, ...policy } = mesh;
      return digest({ ...rest, mesh: policy });
    };
    const selectedPhysics = physics(selectedRequest);
    const verifyRecord = async (entry: z.infer<typeof ref>, mode: 'global' | 'local_diagnostic') => {
      const parsed = optimizationRefinementRecordSchema.safeParse(
        await evidenceReader.readRefinementRecord(entry.jobId));
      if (!parsed.success) invalid('missing or malformed refinement record');
      const record = parsed.data, source = record.source;
      if (digest(record) !== entry.recordDigest || source.structuralJobId !== entry.jobId
        || record.mesh.mode !== mode || record.cadVolumeMm3 !== volume
        || source.projectRevision !== selected.projectRevision || source.modelDigest !== selected.modelDigest
        || source.domainId !== selected.domainId || source.partId !== selected.partId
        || source.bodyId !== selected.bodyId || source.materialId !== selected.materialId
        || source.semanticReferenceId !== selected.semanticReferenceId
        || digest(source.materialProvenance) !== digest(selected.materialProvenance)
        || (mode === 'global') !== (record.mesh.localSizeMm === null)) invalid('refinement identity, metric, or mesh mismatch');
      const meshParsed = meshSummarySchema.safeParse(await evidenceReader.readMeshSummary(entry.jobId));
      if (!meshParsed.success) invalid('validated mesh summary missing');
      const mesh = meshParsed.data;
      if (mesh.jobId !== source.structuralJobId || mesh.requestDigest !== source.requestDigest
        || mesh.resultDigest !== source.resultDigest || mesh.nodeCount !== record.mesh.nodeCount
        || mesh.elementCount !== record.mesh.elementCount
        || mesh.optionsDigest !== record.mesh.optionsDigest) invalid('refinement mesh summary altered');
      await bindOptimizationSnapshot({
        inputDigest: entry.recordDigest, source, variable,
        objective: { ...baseline.objective, baselineVolumeMm3: volume },
        constraint: { ...baseline.constraint, stressFieldDatasetId: source.stressFieldDatasetId,
          baselineStressMPa: record.rawMaximumStressMPa },
      }, reader);
      try {
        const verifiedField = await readVerifiedOptimizationStressField(
          source.structuralJobId, source.stressFieldDatasetId,
          (cursor, limit) => reader.readStressFieldPage(source.structuralJobId,
            source.stressFieldDatasetId, cursor, limit));
        if (digest(verifiedField.descriptor) !== source.stressFieldDescriptorDigest
          || verifiedField.descriptor.datasetDigest !== source.stressFieldDatasetDigest
          || verifiedField.maximumSurfaceStressMPa > record.rawMaximumStressMPa + 1e-6) {
          invalid('stress field differs from bound raw maximum');
        }
      } catch { invalid('incomplete or changed stress field pages'); }
      const request = await reader.readStudyRequest(source.studyId) as any;
      const result = await reader.readCompletedResult(source.structuralJobId) as any;
      const peaks = result.criticalRegions?.filter((peak: any) =>
        peak.domainId === source.domainId && peak.kind === 'stress');
      if (physics(request) !== selectedPhysics || request.mesh.globalSizeMm !== record.mesh.globalSizeMm
        || record.mesh.nodeCount > request.mesh.maximumNodes
        || record.mesh.elementCount > request.mesh.maximumElements
        || peaks?.length !== 1 || peaks[0].unit !== 'MPa'
        || peaks[0].value !== record.rawMaximumStressMPa
        || digest(peaks[0].positionAnalysisMm) !== digest(record.peakPositionAnalysisMm)) invalid('physics, counts, or raw peak localization changed');
      const assessment = assessOptimizationPeak(request, record.peakPositionAnalysisMm,
        record.mesh.localSizeMm ?? record.mesh.globalSizeMm);
      if (assessment.kind !== record.criticalRegion.kind
        || Math.abs(assessment.distanceMm - record.criticalRegion.distanceMm) > 1e-8) invalid('critical-region assessment altered');
      return record;
    };
    const global: OptimizationRefinementRecord[] = [], diagnostics: OptimizationRefinementRecord[] = [];
    const entries = [...evidence[kind].global, ...evidence[kind].diagnostics];
    if (new Set(entries.map(entry => entry.jobId)).size !== entries.length) invalid('duplicate refinement jobs');
    for (const entry of evidence[kind].global) global.push(await verifyRecord(entry, 'global'));
    for (const entry of evidence[kind].diagnostics) diagnostics.push(await verifyRecord(entry, 'local_diagnostic'));
    if (digest(global[2].source) !== digest(selected)
      || global.some((row, i) => i > 0 && (row.mesh.globalSizeMm >= global[i - 1].mesh.globalSizeMm
        || row.mesh.nodeCount <= global[i - 1].mesh.nodeCount
        || row.mesh.elementCount <= global[i - 1].mesh.elementCount))) invalid('selected result or ordered distinct refinement mismatch');
    if (global.some(row => row.criticalRegion.kind !== 'none') && diagnostics.length !== 2) invalid('critical-region stability diagnostics missing');
    if (diagnostics.length && (diagnostics.length !== 2
      || diagnostics[0].mesh.globalSizeMm !== diagnostics[1].mesh.globalSizeMm
      || diagnostics[1].mesh.localSizeMm! >= diagnostics[0].mesh.localSizeMm!
      || diagnostics[1].mesh.nodeCount <= diagnostics[0].mesh.nodeCount
      || diagnostics[1].mesh.elementCount <= diagnostics[0].mesh.elementCount)) invalid('local diagnostic refinement order');
    return { global, diagnostics };
  };
  const before = { baseline: await verifyLane('baseline'), candidate: await verifyLane('candidate') };
  const evaluate = (records: Awaited<ReturnType<typeof verifyLane>>) => {
    const stresses = records.global.map(row => row.rawMaximumStressMPa);
    const changes = [Math.abs(stresses[1] - stresses[0]), Math.abs(stresses[2] - stresses[1])];
    const spreadMPa = Math.max(...stresses) - Math.min(...stresses);
    const selectedMarginMPa = 2 - stresses[2];
    const reasons: string[] = [];
    if (changes[1] / stresses[2] > .05 || changes[1] > changes[0]) reasons.push('GLOBAL_STRESS_UNSTABLE');
    if (selectedMarginMPa <= 2 * spreadMPa || selectedMarginMPa <= 2 * changes[1]) reasons.push('REFINEMENT_CHANGE_EXCEEDS_MARGIN');
    const paths = [records.global, records.diagnostics];
    for (const path of paths) {
      if (path.length < 2) continue;
      const last = path.at(-1)!, previous = path.at(-2)!;
      const change = Math.abs(last.rawMaximumStressMPa - previous.rawMaximumStressMPa);
      if (path === records.diagnostics
        && (change / last.rawMaximumStressMPa > .05 || change > changes[1])) reasons.push('LOCAL_STRESS_UNSTABLE');
      if (2 - last.rawMaximumStressMPa <= 2 * change) reasons.push('REFINEMENT_CHANGE_EXCEEDS_MARGIN');
      if (last.criticalRegion.kind !== 'none'
        && (last.criticalRegion.kind !== previous.criticalRegion.kind
          || last.criticalRegion.distanceMm < previous.criticalRegion.distanceMm)
        && last.rawMaximumStressMPa > previous.rawMaximumStressMPa
        && (change / last.rawMaximumStressMPa > .05 || change > changes[1])) {
        reasons.push('PEAK_APPROACHES_CRITICAL_REGION');
      }
    }
    if ([...records.global, ...records.diagnostics].some(row => row.rawMaximumStressMPa >= 2)) reasons.push('STRESS_LIMIT_NOT_ROBUST');
    return { observedMeshSpreadMPa: spreadMPa, selectedMarginMPa,
      latestGlobalChangeMPa: changes[1], reasons: [...new Set(reasons)].sort() };
  };
  const baselineGate = evaluate(before.baseline), candidateGate = evaluate(before.candidate);
  const after = { baseline: await verifyLane('baseline'), candidate: await verifyLane('candidate') };
  if (digest(before) !== digest(after) || digest(await readEvidence()) !== digest(evidence)
    || digest(await compareOptimizationCandidate(baseline, candidate, baselineReader, candidateReader)) !== digest(comparison)) {
    invalid('evidence or source changed during admission');
  }
  const robustFeasible = comparison.candidateFeasible
    && baselineGate.reasons.length === 0 && candidateGate.reasons.length === 0;
  return {
    schema: 'tunacad-optimization-evidence-admission/0.1' as const,
    evidenceDigest: reference.evidenceDigest, comparisonDigest: digest(comparison),
    objectiveImprovementMm3: comparison.objectiveDeltaMm3,
    nominalFeasible: comparison.candidateFeasible, robustFeasible,
    classification: robustFeasible ? 'numerically_supported_robust_feasibility'
      : comparison.candidateFeasible ? 'nominal_only_insufficient_numerical_evidence' : 'nominal_infeasible',
    numericalEvidenceGate: robustFeasible ? 'PASS' : 'FAIL',
    baseline: baselineGate, candidate: candidateGate,
    uncertaintyMeaning: 'observed mesh sensitivity, not a certified error bound',
    providerAdmission: 'closed' as const, engineeringUsePermitted: false as const,
  };
}
