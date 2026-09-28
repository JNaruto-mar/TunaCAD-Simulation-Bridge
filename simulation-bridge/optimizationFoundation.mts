import * as z from 'zod/v4';
import { digest } from './stableDigest.mts';

const id = z.string().min(1).max(160).regex(/^[^\u0000-\u001f\u007f]*$/);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const positive = z.number().finite().positive();
const provenance = z.object({
  kind: z.enum(['library', 'custom']), reference: id, revision: id,
}).strict();
const cadProvenance = z.object({
  kind: z.literal('cad_project'), reference: id, revision: id,
}).strict();

/** Contract only: no candidate, iteration, provider admission, or claimed optimum. */
export const optimizationFoundationSchema = z.object({
  schema: z.literal('tunacad-optimization-foundation/0.1'),
  inputDigest: hash,
  source: z.object({
    studyId: id, structuralJobId: id, requestDigest: hash,
    resultDigest: hash, projectRevision: id, modelDigest: hash,
    domainId: id, partId: id, bodyId: id,
    materialId: id, materialProvenance: provenance,
    semanticReferenceId: id, stressFieldDatasetId: id,
    stressFieldDatasetDigest: hash, stressFieldDescriptorDigest: hash,
  }).strict(),
  variable: z.object({
    kind: z.literal('cad_length'),
    featureId: id, parameterId: id,
    baselineMm: positive.max(1_000_000),
    minimumMm: positive.max(1_000_000),
    maximumMm: positive.max(1_000_000),
    unit: z.literal('mm'),
    snapshotDigest: hash,
    provenance: cadProvenance,
  }).strict(),
  objective: z.object({
    kind: z.literal('minimize_domain_volume'),
    domainId: id, baselineVolumeMm3: positive.max(1_000_000_000_000),
    unit: z.literal('mm^3'),
  }).strict(),
  constraint: z.object({
    kind: z.literal('domain_von_mises_upper_bound'),
    domainId: id, semanticReferenceId: id, stressFieldDatasetId: id,
    baselineStressMPa: z.number().finite().min(0).max(10_000_000),
    upperBoundMPa: positive.max(10_000_000),
    unit: z.literal('MPa'),
  }).strict(),
}).strict();
export type OptimizationFoundation = z.infer<typeof optimizationFoundationSchema>;
export type OptimizationFoundationDraft = Omit<OptimizationFoundation, 'inputDigest'>;

export const cadParameterSnapshotSchema = z.object({
  schema: z.literal('tunacad-cad-parameter-snapshot/0.1'),
  projectRevision: id, modelDigest: hash,
  domainId: id, partId: id, bodyId: id,
  featureId: id, parameterId: id,
  kind: z.literal('length'), valueMm: positive.max(1_000_000),
  unit: z.literal('mm'), provenance: cadProvenance,
}).strict();
export type CadParameterSnapshot = z.infer<typeof cadParameterSnapshotSchema>;

/** Implementations must read from trusted immutable study/result, field, and
 * CAD-revision stores. None of these objects may come from request JSON. */
export interface TrustedOptimizationSourceReader {
  readCurrentProjectRevision(): Promise<string>;
  readStudyRequest(studyId: string): Promise<unknown>;
  readCompletedResult(jobId: string): Promise<unknown>;
  readStressFieldDescriptor(jobId: string, datasetId: string): Promise<unknown>;
  readCadParameter(projectRevision: string, featureId: string, parameterId: string): Promise<unknown>;
}

export interface OptimizationSourceProof {
  schema: 'tunacad-optimization-source-proof/0.1';
  inputDigest: string;
  requestDigest: string;
  resultDigest: string;
  modelDigest: string;
  fieldDescriptorDigest: string;
  fieldDatasetDigest: string;
  parameterSnapshotDigest: string;
  sourceVerification: 'matched_trusted_immutable_study_result_field_parameter';
  objectiveBaselineVolumeMm3: number;
  constraintBaselineStressMPa: number;
  providerAdmission: 'closed';
  engineeringUsePermitted: false;
}

const requestShape = z.object({
  schema: z.literal('tunacad-neutral-simulation-request/2.0'),
  studyId: id, requestDigest: hash,
  analysis: z.object({ type: z.literal('linear_static') }).passthrough(),
  model: z.object({
    projectRevision: id, modelDigest: hash,
    domains: z.array(z.object({
      domainId: id, partId: id, bodyId: id, domainDigest: hash,
      shape: z.object({ volumeMm3: positive }).passthrough(),
    }).passthrough()).length(1),
    references: z.array(z.object({
      domainId: id, semanticReferenceId: id, sourceFeatureId: id.nullable(),
      geometryKind: z.literal('FACE'),
    }).passthrough()).min(1),
  }).passthrough(),
  materials: z.array(z.object({
    id, model: z.literal('isotropic_linear_elastic'),
    source: z.object({ kind: z.enum(['library', 'custom']), reference: id,
      revision: id }).passthrough(),
  }).passthrough()).length(1),
  materialAssignments: z.array(z.object({ domainId: id, materialId: id }).passthrough()).length(1),
}).passthrough();
const resultShape = z.object({
  schema: z.literal('tunacad-neutral-simulation-result/2.0'),
  studyId: id, jobId: id, requestDigest: hash,
  projectRevision: id, modelDigest: hash,
  analysisType: z.literal('linear_static'),
  status: z.literal('succeeded'), authority: z.literal('engineering'),
  convergence: z.object({ status: z.literal('converged') }).passthrough(),
  mutation: z.object({
    occurred: z.literal(false),
    projectRevisionBefore: id, projectRevisionAfter: id,
  }).passthrough(),
  perDomain: z.array(z.object({
    domainId: id,
    metrics: z.object({ maximumVonMisesStressMPa: z.number().finite().min(0) }).passthrough(),
    fieldDatasetIds: z.array(id),
  }).passthrough()).length(1),
}).passthrough();
const stressDescriptorShape = z.object({
  schema: z.literal('tunacad-neutral-simulation-field-dataset/2.0'),
  datasetId: id, jobId: id, domainId: id,
  analysisType: z.literal('linear_static'),
  component: z.literal('von_mises_stress'), unit: z.literal('MPa'),
  datasetDigest: hash,
  mapping: z.object({ semanticReferenceIds: z.array(id) }).passthrough(),
}).passthrough();

function invalid(reason: string): never {
  throw new Error('SIM9_OPTIMIZATION_FOUNDATION_INVALID: ' + reason);
}

export function sealOptimizationFoundation(draft: OptimizationFoundationDraft): OptimizationFoundation {
  return { ...draft, inputDigest: digest(draft) };
}

export function validateOptimizationFoundation(value: unknown): OptimizationFoundation {
  const parsed = optimizationFoundationSchema.safeParse(value);
  if (!parsed.success) invalid('malformed or unsupported study');
  const input = parsed.data;
  const { inputDigest, ...draft } = input;
  if (inputDigest !== digest(draft)) invalid('request digest mismatch');
  const { variable, source, objective, constraint } = input;
  if (variable.minimumMm >= variable.baselineMm || variable.maximumMm <= variable.baselineMm
    || variable.minimumMm < variable.baselineMm * .8
    || variable.maximumMm > variable.baselineMm * 1.2
    || objective.domainId !== source.domainId || constraint.domainId !== source.domainId
    || constraint.semanticReferenceId !== source.semanticReferenceId
    || constraint.stressFieldDatasetId !== source.stressFieldDatasetId
    || constraint.baselineStressMPa > constraint.upperBoundMPa) {
    invalid('only one feasible baseline with a strictly bounded ±20% length range is supported');
  }
  return input;
}

/** Bind independently to trusted snapshots. The result is evidence of source
 * identity only, never an optimization score, candidate, or approval. */
export async function bindOptimizationFoundation(
  value: unknown, reader: TrustedOptimizationSourceReader,
): Promise<OptimizationSourceProof> {
  const input = validateOptimizationFoundation(value);
  return bindOptimizationSnapshot(input, reader);
}

/** Shared immutable-record verifier for a sealed baseline or one independently
 * validated candidate. This does not validate candidate comparison policy. */
export async function bindOptimizationSnapshot(
  input: Pick<OptimizationFoundation, 'inputDigest' | 'source' | 'variable' | 'objective' | 'constraint'>,
  reader: TrustedOptimizationSourceReader,
): Promise<OptimizationSourceProof> {
  const { source, variable, objective, constraint } = input;
  if (await reader.readCurrentProjectRevision() !== source.projectRevision) {
    invalid('source project revision is stale');
  }
  const requestParsed = requestShape.safeParse(await reader.readStudyRequest(source.studyId));
  if (!requestParsed.success) invalid('source request missing or malformed');
  const request = structuredClone(requestParsed.data);
  const { requestDigest, ...requestUnsigned } = request;
  const { modelDigest, ...modelUnsigned } = request.model;
  const domain = request.model.domains[0];
  const { domainDigest, ...domainUnsigned } = domain;
  if (requestDigest !== digest(requestUnsigned)
    || modelDigest !== digest(modelUnsigned)
    || domainDigest !== digest(domainUnsigned)
    || requestDigest !== source.requestDigest || modelDigest !== source.modelDigest
    || request.studyId !== source.studyId
    || request.model.projectRevision !== source.projectRevision
    || domain.domainId !== source.domainId || domain.partId !== source.partId
    || domain.bodyId !== source.bodyId
    || domain.shape.volumeMm3 !== objective.baselineVolumeMm3
    || request.materialAssignments[0].domainId !== source.domainId
    || request.materialAssignments[0].materialId !== source.materialId
    || request.materials[0].id !== source.materialId
    || request.materials[0].source.kind !== source.materialProvenance.kind
    || request.materials[0].source.reference !== source.materialProvenance.reference
    || request.materials[0].source.revision !== source.materialProvenance.revision
    || !request.model.references.some(reference => reference.domainId === source.domainId
      && reference.semanticReferenceId === source.semanticReferenceId
      && reference.sourceFeatureId === variable.featureId)) {
    invalid('source request, model, material, parameter feature, or baseline volume changed');
  }
  const resultParsed = resultShape.safeParse(await reader.readCompletedResult(source.structuralJobId));
  if (!resultParsed.success) invalid('source result missing, incomplete, or unconverged');
  const result = structuredClone(resultParsed.data);
  if (digest(result) !== source.resultDigest
    || result.studyId !== source.studyId || result.jobId !== source.structuralJobId
    || result.requestDigest !== requestDigest
    || result.projectRevision !== source.projectRevision
    || result.modelDigest !== source.modelDigest
    || result.mutation.projectRevisionBefore !== source.projectRevision
    || result.mutation.projectRevisionAfter !== source.projectRevision
    || result.perDomain[0].domainId !== source.domainId
    || result.perDomain[0].metrics.maximumVonMisesStressMPa !== constraint.baselineStressMPa
    || result.perDomain[0].fieldDatasetIds.filter(idValue => idValue === source.stressFieldDatasetId).length !== 1) {
    invalid('source result identity, digest, domain field, or baseline stress changed');
  }
  const fieldParsed = stressDescriptorShape.safeParse(
    await reader.readStressFieldDescriptor(source.structuralJobId, source.stressFieldDatasetId));
  if (!fieldParsed.success) invalid('stress field descriptor missing or malformed');
  const field = structuredClone(fieldParsed.data);
  if (digest(field) !== source.stressFieldDescriptorDigest
    || field.datasetDigest !== source.stressFieldDatasetDigest
    || field.datasetId !== source.stressFieldDatasetId
    || field.jobId !== source.structuralJobId || field.domainId !== source.domainId
    || !field.mapping.semanticReferenceIds.includes(source.semanticReferenceId)) {
    invalid('stress field identity, location, or digest changed');
  }
  const parameterParsed = cadParameterSnapshotSchema.safeParse(
    await reader.readCadParameter(source.projectRevision, variable.featureId, variable.parameterId));
  if (!parameterParsed.success) invalid('CAD parameter snapshot missing or malformed');
  const parameter = structuredClone(parameterParsed.data);
  if (digest(parameter) !== variable.snapshotDigest
    || parameter.projectRevision !== source.projectRevision
    || parameter.modelDigest !== source.modelDigest
    || parameter.domainId !== source.domainId || parameter.partId !== source.partId
    || parameter.bodyId !== source.bodyId
    || parameter.featureId !== variable.featureId || parameter.parameterId !== variable.parameterId
    || parameter.valueMm !== variable.baselineMm
    || digest(parameter.provenance) !== digest(variable.provenance)) {
    invalid('CAD parameter identity, baseline, provenance, or digest changed');
  }
  if (await reader.readCurrentProjectRevision() !== source.projectRevision) {
    invalid('source project revision changed during binding');
  }
  return {
    schema: 'tunacad-optimization-source-proof/0.1',
    inputDigest: input.inputDigest, requestDigest, resultDigest: digest(result),
    modelDigest, fieldDescriptorDigest: digest(field),
    fieldDatasetDigest: field.datasetDigest, parameterSnapshotDigest: digest(parameter),
    sourceVerification: 'matched_trusted_immutable_study_result_field_parameter',
    objectiveBaselineVolumeMm3: objective.baselineVolumeMm3,
    constraintBaselineStressMPa: constraint.baselineStressMPa,
    providerAdmission: 'closed', engineeringUsePermitted: false,
  };
}
