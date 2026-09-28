import assert from 'node:assert/strict';
import { bindOptimizationFoundation, sealOptimizationFoundation,
  validateOptimizationFoundation, type CadParameterSnapshot,
  type OptimizationFoundationDraft, type TrustedOptimizationSourceReader,
} from '../simulation-bridge/optimizationFoundation.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';

const revision = 'project-r1';
const domainUnsigned = {
  domainId: 'bracket', partId: 'bracket-part', bodyId: 'bracket-body',
  geometryDigest: 'sha256:' + 'a'.repeat(64), shape: { volumeMm3: 1000 },
};
const domain = { ...domainUnsigned, domainDigest: digest(domainUnsigned) };
const modelUnsigned = {
  projectRevision: revision, domains: [domain],
  references: [{ domainId: 'bracket', semanticReferenceId: 'critical-face',
    sourceFeatureId: 'thickness-extrude', geometryKind: 'FACE' }],
};
const model = { ...modelUnsigned, modelDigest: digest(modelUnsigned) };
const requestUnsigned = {
  schema: 'tunacad-neutral-simulation-request/2.0', studyId: 'bracket-study',
  analysis: { type: 'linear_static' }, model,
  materials: [{ id: 'steel', model: 'isotropic_linear_elastic',
    source: { kind: 'library', reference: 'steel-reference', revision: '2026-r1' } }],
  materialAssignments: [{ domainId: 'bracket', materialId: 'steel' }],
};
const request = { ...requestUnsigned, requestDigest: digest(requestUnsigned) };
const result = {
  schema: 'tunacad-neutral-simulation-result/2.0',
  studyId: request.studyId, jobId: 'structural-job-1',
  requestDigest: request.requestDigest, projectRevision: revision,
  modelDigest: model.modelDigest, analysisType: 'linear_static',
  status: 'succeeded', authority: 'engineering',
  convergence: { status: 'converged' },
  mutation: { occurred: false, projectRevisionBefore: revision, projectRevisionAfter: revision },
  perDomain: [{ domainId: 'bracket', metrics: { maximumVonMisesStressMPa: 80 },
    fieldDatasetIds: ['structural-job-1:bracket:stress'] }],
};
const field = {
  schema: 'tunacad-neutral-simulation-field-dataset/2.0',
  datasetId: 'structural-job-1:bracket:stress', jobId: result.jobId,
  domainId: 'bracket', analysisType: 'linear_static',
  component: 'von_mises_stress', unit: 'MPa',
  datasetDigest: 'sha256:' + 'b'.repeat(64),
  mapping: { semanticReferenceIds: ['critical-face'] },
};
const parameter: CadParameterSnapshot = {
  schema: 'tunacad-cad-parameter-snapshot/0.1',
  projectRevision: revision, modelDigest: model.modelDigest,
  domainId: 'bracket', partId: 'bracket-part', bodyId: 'bracket-body',
  featureId: 'thickness-extrude', parameterId: 'thickness',
  kind: 'length', valueMm: 10, unit: 'mm',
  provenance: { kind: 'cad_project', reference: 'bracket CAD source', revision },
};
const draft: OptimizationFoundationDraft = {
  schema: 'tunacad-optimization-foundation/0.1',
  source: {
    studyId: request.studyId, structuralJobId: result.jobId,
    requestDigest: request.requestDigest, resultDigest: digest(result),
    projectRevision: revision, modelDigest: model.modelDigest,
    domainId: 'bracket', partId: 'bracket-part', bodyId: 'bracket-body',
    materialId: 'steel', materialProvenance: { kind: 'library',
      reference: 'steel-reference', revision: '2026-r1' },
    semanticReferenceId: 'critical-face',
    stressFieldDatasetId: field.datasetId, stressFieldDatasetDigest: field.datasetDigest,
    stressFieldDescriptorDigest: digest(field),
  },
  variable: {
    kind: 'cad_length', featureId: 'thickness-extrude', parameterId: 'thickness',
    baselineMm: 10, minimumMm: 9, maximumMm: 11, unit: 'mm',
    snapshotDigest: digest(parameter), provenance: structuredClone(parameter.provenance),
  },
  objective: { kind: 'minimize_domain_volume', domainId: 'bracket',
    baselineVolumeMm3: 1000, unit: 'mm^3' },
  constraint: { kind: 'domain_von_mises_upper_bound',
    domainId: 'bracket', semanticReferenceId: 'critical-face',
    stressFieldDatasetId: field.datasetId, baselineStressMPa: 80,
    upperBoundMPa: 100, unit: 'MPa' },
};
const input = sealOptimizationFoundation(draft);
assert.deepEqual(validateOptimizationFoundation(input), input);
assert.deepEqual(sealOptimizationFoundation(structuredClone(draft)), input);
function reader(overrides: {
  currentRevision?: string; request?: unknown; result?: unknown;
  field?: unknown; parameter?: unknown;
} = {}): TrustedOptimizationSourceReader {
  return {
    async readCurrentProjectRevision() { return overrides.currentRevision ?? revision; },
    async readStudyRequest() { return structuredClone(overrides.request === undefined ? request : overrides.request); },
    async readCompletedResult() { return structuredClone(overrides.result === undefined ? result : overrides.result); },
    async readStressFieldDescriptor() { return structuredClone(overrides.field === undefined ? field : overrides.field); },
    async readCadParameter() { return structuredClone(overrides.parameter === undefined ? parameter : overrides.parameter); },
  };
}
const proof = await bindOptimizationFoundation(input, reader());
assert.equal(proof.sourceVerification, 'matched_trusted_immutable_study_result_field_parameter');
assert.equal(proof.requestDigest, request.requestDigest);
assert.equal(proof.resultDigest, digest(result));
assert.equal(proof.fieldDescriptorDigest, digest(field));
assert.equal(proof.parameterSnapshotDigest, digest(parameter));
assert.equal(proof.objectiveBaselineVolumeMm3, 1000);
assert.equal(proof.constraintBaselineStressMPa, 80);
assert.equal(proof.providerAdmission, 'closed');
assert.equal(proof.engineeringUsePermitted, false);
assert.deepEqual(await bindOptimizationFoundation(input, reader()), proof);
let rejected = 0;
async function rejects(overrides: Parameters<typeof reader>[0]) {
  await assert.rejects(bindOptimizationFoundation(input, reader(overrides)),
    /SIM9_OPTIMIZATION_FOUNDATION_INVALID/);
  rejected++;
}
await rejects({ currentRevision: 'project-r2' });
let revisionReads = 0;
await assert.rejects(bindOptimizationFoundation(input, {
  ...reader(), async readCurrentProjectRevision() {
    revisionReads++;
    return revisionReads === 1 ? revision : 'project-r2';
  },
}), /SIM9_OPTIMIZATION_FOUNDATION_INVALID/);
rejected++;
await rejects({ request: null });
await rejects({ request: { ...request, studyId: 'other-study' } });
await rejects({ request: { ...request, requestDigest: 'sha256:' + 'c'.repeat(64) } });
await rejects({ request: { ...request, model: { ...model, projectRevision: 'project-r2' } } });
await rejects({ request: { ...request, model: { ...model, domains: [
  { ...domain, shape: { volumeMm3: 900 } },
] } } });
await rejects({ request: { ...request, materials: [{ ...request.materials[0],
  source: { ...request.materials[0].source, revision: '2026-r2' } }] } });
await rejects({ request: { ...request, model: { ...model, references: [
  { ...model.references[0], sourceFeatureId: 'other-feature' },
] } } });
await rejects({ result: null });
await rejects({ result: { ...result, status: 'failed' } });
await rejects({ result: { ...result, status: 'cancelled' } });
await rejects({ result: { ...result, convergence: { status: 'not_converged' } } });
await rejects({ result: { ...result, mutation: { ...result.mutation, occurred: true } } });
await rejects({ result: { ...result, jobId: 'other-job' } });
await rejects({ result: { ...result, perDomain: [{ ...result.perDomain[0],
  metrics: { maximumVonMisesStressMPa: 81 } }] } });
await rejects({ result: { ...result, perDomain: [{ ...result.perDomain[0],
  fieldDatasetIds: [] }] } });
await rejects({ field: null });
await rejects({ field: { ...field, component: 'displacement_magnitude' } });
await rejects({ field: { ...field, datasetDigest: 'sha256:' + 'c'.repeat(64) } });
await rejects({ field: { ...field, mapping: { semanticReferenceIds: [] } } });
await rejects({ parameter: null });
await rejects({ parameter: { ...parameter, valueMm: 9 } });
await rejects({ parameter: { ...parameter, featureId: 'other-feature' } });
await rejects({ parameter: { ...parameter, provenance: { ...parameter.provenance,
  revision: 'project-r2' } } });
function rejectsInput(change: (value: OptimizationFoundationDraft) => void) {
  const changed = structuredClone(draft); change(changed);
  assert.throws(() => validateOptimizationFoundation(sealOptimizationFoundation(changed)),
    /SIM9_OPTIMIZATION_FOUNDATION_INVALID/);
  rejected++;
}
rejectsInput(value => { value.variable.minimumMm = 7; });
rejectsInput(value => { value.variable.maximumMm = 13; });
rejectsInput(value => { value.variable.baselineMm = 12; });
rejectsInput(value => { value.objective.kind = 'maximize_safety_factor' as never; });
rejectsInput(value => { value.constraint.upperBoundMPa = 70; });
rejectsInput(value => { value.constraint.semanticReferenceId = 'other-face'; });
rejectsInput(value => { value.variable.unit = 'inch' as 'mm'; });
rejectsInput(value => { (value as unknown as Record<string, unknown>).algorithm = 'genetic'; });
const modified = structuredClone(input);
modified.variable.provenance.revision = 'project-r2';
assert.throws(() => validateOptimizationFoundation(modified),
  /SIM9_OPTIMIZATION_FOUNDATION_INVALID/);
rejected++;
console.log(JSON.stringify({ status: 'PASS', fixture: 'one-variable immutable optimization foundation',
  requestDigest: input.inputDigest, baseline: { volumeMm3: 1000, stressMPa: 80 },
  variableRangeMm: [9, 11], rejectedCases: rejected,
  providerAdmission: proof.providerAdmission, engineeringUsePermitted: false }));
