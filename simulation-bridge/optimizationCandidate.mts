import * as z from 'zod/v4';
import { digest } from './stableDigest.mts';
import {
  bindOptimizationFoundation, bindOptimizationSnapshot,
  optimizationFoundationSchema, validateOptimizationFoundation,
  type OptimizationFoundation, type TrustedOptimizationSourceReader,
} from './optimizationFoundation.mts';

const id = z.string().min(1).max(160).regex(/^[^\u0000-\u001f\u007f]*$/);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const positive = z.number().finite().positive();

/** One independently solved candidate. There is no generation or solve API. */
export const optimizationCandidateSchema = z.object({
  schema: z.literal('tunacad-optimization-candidate/0.1'),
  inputDigest: hash,
  baselineInputDigest: hash,
  cadChangeSetDigest: hash,
  source: optimizationFoundationSchema.shape.source,
  variable: z.object({
    featureId: id, parameterId: id, valueMm: positive.max(1_000_000),
    unit: z.literal('mm'), snapshotDigest: hash,
    provenance: optimizationFoundationSchema.shape.variable.shape.provenance,
  }).strict(),
  objective: z.object({
    kind: z.literal('minimize_domain_volume'),
    domainId: id, volumeMm3: positive.max(1_000_000_000_000),
    unit: z.literal('mm^3'),
  }).strict(),
  constraint: z.object({
    kind: z.literal('domain_von_mises_upper_bound'),
    domainId: id, semanticReferenceId: id, stressFieldDatasetId: id,
    observedStressMPa: z.number().finite().min(0).max(10_000_000),
    unit: z.literal('MPa'),
  }).strict(),
}).strict();
export type OptimizationCandidate = z.infer<typeof optimizationCandidateSchema>;
export type OptimizationCandidateDraft = Omit<OptimizationCandidate, 'inputDigest'>;
export const singleParameterCadChangeSchema = z.object({
  schema: z.literal('tunacad-cad-single-parameter-change/0.1'),
  baselineProjectRevision: id, candidateProjectRevision: id,
  baselineModelDigest: hash, candidateModelDigest: hash,
  changedParameter: z.object({
    domainId: id, partId: id, bodyId: id,
    featureId: id, parameterId: id,
    fromMm: positive.max(1_000_000), toMm: positive.max(1_000_000),
    unit: z.literal('mm'),
  }).strict(),
  otherChanges: z.literal(false),
}).strict();
export type SingleParameterCadChange = z.infer<typeof singleParameterCadChangeSchema>;
export interface TrustedOptimizationCandidateReader extends TrustedOptimizationSourceReader {
  readCadChangeSet(baselineRevision: string, candidateRevision: string): Promise<unknown>;
}

export interface OptimizationComparison {
  schema: 'tunacad-optimization-comparison/0.1';
  baselineInputDigest: string;
  candidateInputDigest: string;
  baselineProofDigest: string;
  candidateProofDigest: string;
  cadChangeSetDigest: string;
  baseline: { studyId: string; jobId: string; projectRevision: string;
    parameterMm: number; volumeMm3: number; maximumVonMisesStressMPa: number };
  candidate: { studyId: string; jobId: string; projectRevision: string;
    parameterMm: number; volumeMm3: number; maximumVonMisesStressMPa: number };
  stressUpperBoundMPa: number;
  stressConstraintSatisfied: boolean;
  objectiveDeltaMm3: number;
  objectiveChangePercent: number;
  objectiveOutcome: 'improved' | 'tied' | 'regressed';
  candidateFeasible: boolean;
  sourceVerification: 'two_independently_bound_immutable_studies';
  providerAdmission: 'closed';
  engineeringUsePermitted: false;
}

function invalid(reason: string): never {
  throw new Error('SIM9_OPTIMIZATION_CANDIDATE_INVALID: ' + reason);
}
export function sealOptimizationCandidate(draft: OptimizationCandidateDraft): OptimizationCandidate {
  return { ...draft, inputDigest: digest(draft) };
}
export function validateOptimizationCandidate(value: unknown, baselineValue: unknown): OptimizationCandidate {
  const baseline = validateOptimizationFoundation(baselineValue);
  const parsed = optimizationCandidateSchema.safeParse(value);
  if (!parsed.success) invalid('malformed or unsupported candidate');
  const candidate = parsed.data;
  const { inputDigest, ...unsigned } = candidate;
  if (inputDigest !== digest(unsigned)
    || candidate.baselineInputDigest !== baseline.inputDigest) invalid('candidate or baseline input digest mismatch');
  const { source, variable, objective, constraint } = candidate;
  if (source.studyId === baseline.source.studyId
    || source.structuralJobId === baseline.source.structuralJobId
    || source.projectRevision === baseline.source.projectRevision
    || source.requestDigest === baseline.source.requestDigest
    || source.modelDigest === baseline.source.modelDigest
    || source.resultDigest === baseline.source.resultDigest
    || source.domainId !== baseline.source.domainId
    || source.partId !== baseline.source.partId || source.bodyId !== baseline.source.bodyId
    || source.materialId !== baseline.source.materialId
    || digest(source.materialProvenance) !== digest(baseline.source.materialProvenance)
    || source.semanticReferenceId !== baseline.source.semanticReferenceId
    || source.stressFieldDatasetId === baseline.source.stressFieldDatasetId
    || variable.featureId !== baseline.variable.featureId
    || variable.parameterId !== baseline.variable.parameterId
    || variable.valueMm === baseline.variable.baselineMm
    || variable.valueMm < baseline.variable.minimumMm
    || variable.valueMm > baseline.variable.maximumMm
    || variable.provenance.kind !== baseline.variable.provenance.kind
    || variable.provenance.reference !== baseline.variable.provenance.reference
    || variable.provenance.revision !== source.projectRevision
    || objective.domainId !== source.domainId
    || constraint.domainId !== source.domainId
    || constraint.semanticReferenceId !== source.semanticReferenceId
    || constraint.stressFieldDatasetId !== source.stressFieldDatasetId) {
    invalid('candidate identity, variable, provenance, location, or range mismatch');
  }
  return candidate;
}

/** Compare only two separately completed studies. Read both immutable sources
 * again at the end so changes during comparison cannot publish a score. */
export async function compareOptimizationCandidate(
  baselineValue: unknown, candidateValue: unknown,
  baselineReader: TrustedOptimizationSourceReader,
  candidateReader: TrustedOptimizationCandidateReader,
): Promise<OptimizationComparison> {
  const baseline = validateOptimizationFoundation(baselineValue);
  const candidate = validateOptimizationCandidate(candidateValue, baseline);
  const readChangeSet = async () => {
    const parsed = singleParameterCadChangeSchema.safeParse(
      await candidateReader.readCadChangeSet(
        baseline.source.projectRevision, candidate.source.projectRevision));
    if (!parsed.success) invalid('trusted CAD single-parameter change record missing or malformed');
    const change = parsed.data;
    const selected = change.changedParameter;
    if (digest(change) !== candidate.cadChangeSetDigest
      || change.baselineProjectRevision !== baseline.source.projectRevision
      || change.candidateProjectRevision !== candidate.source.projectRevision
      || change.baselineModelDigest !== baseline.source.modelDigest
      || change.candidateModelDigest !== candidate.source.modelDigest
      || selected.domainId !== baseline.source.domainId
      || selected.partId !== baseline.source.partId || selected.bodyId !== baseline.source.bodyId
      || selected.featureId !== baseline.variable.featureId
      || selected.parameterId !== baseline.variable.parameterId
      || selected.fromMm !== baseline.variable.baselineMm
      || selected.toMm !== candidate.variable.valueMm) {
      invalid('candidate CAD revision is not one immutable change of the selected parameter');
    }
    return digest(change);
  };
  const changeSetDigest = await readChangeSet();
  const candidateSnapshot = {
    inputDigest: candidate.inputDigest,
    source: candidate.source,
    variable: {
      ...baseline.variable, baselineMm: candidate.variable.valueMm,
      snapshotDigest: candidate.variable.snapshotDigest,
      provenance: candidate.variable.provenance,
    },
    objective: { ...baseline.objective, baselineVolumeMm3: candidate.objective.volumeMm3 },
    constraint: { ...baseline.constraint,
      stressFieldDatasetId: candidate.source.stressFieldDatasetId,
      baselineStressMPa: candidate.constraint.observedStressMPa },
  };
  const baselineProof = await bindOptimizationFoundation(baseline, baselineReader);
  const candidateProof = await bindOptimizationSnapshot(candidateSnapshot, candidateReader);
  const baselineRequest = await baselineReader.readStudyRequest(baseline.source.studyId);
  const candidateRequest = await candidateReader.readStudyRequest(candidate.source.studyId);
  if (!matchingPhysics(baselineRequest, candidateRequest,
    baseline.source.requestDigest, candidate.source.requestDigest)) {
    invalid('candidate changes simulation physics, materials, mesh policy, or loads');
  }
  const baselineAgain = await bindOptimizationFoundation(baseline, baselineReader);
  const candidateAgain = await bindOptimizationSnapshot(candidateSnapshot, candidateReader);
  if (digest(baselineProof) !== digest(baselineAgain)
    || digest(candidateProof) !== digest(candidateAgain)
    || await readChangeSet() !== changeSetDigest) invalid('source changed during comparison');
  const baselineVolume = baseline.objective.baselineVolumeMm3;
  const candidateVolume = candidate.objective.volumeMm3;
  const delta = baselineVolume - candidateVolume;
  const feasible = candidate.constraint.observedStressMPa <= baseline.constraint.upperBoundMPa;
  return {
    schema: 'tunacad-optimization-comparison/0.1',
    baselineInputDigest: baseline.inputDigest, candidateInputDigest: candidate.inputDigest,
    baselineProofDigest: digest(baselineProof), candidateProofDigest: digest(candidateProof),
    cadChangeSetDigest: changeSetDigest,
    baseline: { studyId: baseline.source.studyId, jobId: baseline.source.structuralJobId,
      projectRevision: baseline.source.projectRevision,
      parameterMm: baseline.variable.baselineMm, volumeMm3: baselineVolume,
      maximumVonMisesStressMPa: baseline.constraint.baselineStressMPa },
    candidate: { studyId: candidate.source.studyId, jobId: candidate.source.structuralJobId,
      projectRevision: candidate.source.projectRevision,
      parameterMm: candidate.variable.valueMm, volumeMm3: candidateVolume,
      maximumVonMisesStressMPa: candidate.constraint.observedStressMPa },
    stressUpperBoundMPa: baseline.constraint.upperBoundMPa,
    stressConstraintSatisfied: feasible,
    objectiveDeltaMm3: delta,
    objectiveChangePercent: delta / baselineVolume * 100,
    objectiveOutcome: delta > 0 ? 'improved' : delta < 0 ? 'regressed' : 'tied',
    candidateFeasible: feasible,
    sourceVerification: 'two_independently_bound_immutable_studies',
    providerAdmission: 'closed', engineeringUsePermitted: false,
  };
}

function matchingPhysics(baselineRaw: unknown, candidateRaw: unknown,
  baselineDigest: string, candidateDigest: string): boolean {
  const unpack = (raw: unknown, expectedDigest: string) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const request = structuredClone(raw) as Record<string, unknown>;
    const { requestDigest, model: _model, studyId: _studyId,
      name: _name, preparedAt: _preparedAt, expiresAt: _expiresAt,
      ...physics } = request;
    if (requestDigest !== expectedDigest) return null;
    const { requestDigest: _digest, ...unsigned } = request;
    if (digest(unsigned) !== expectedDigest) return null;
    return digest(physics);
  };
  const baselinePhysics = unpack(baselineRaw, baselineDigest);
  const candidatePhysics = unpack(candidateRaw, candidateDigest);
  return baselinePhysics !== null && baselinePhysics === candidatePhysics;
}
