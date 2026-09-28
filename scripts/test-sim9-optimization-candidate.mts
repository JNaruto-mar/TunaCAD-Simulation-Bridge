import assert from 'node:assert/strict';
import {
  sealOptimizationFoundation, type OptimizationFoundationDraft,
} from '../simulation-bridge/optimizationFoundation.mts';
import {
  compareOptimizationCandidate, sealOptimizationCandidate,
  validateOptimizationCandidate, type OptimizationCandidateDraft,
  type TrustedOptimizationCandidateReader,
} from '../simulation-bridge/optimizationCandidate.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';

function study(label: string, revision: string, parameterMm: number,
  volumeMm3: number, stressMPa: number) {
  const domainUnsigned = {
    domainId: 'bracket', partId: 'bracket-part', bodyId: 'bracket-body',
    geometryDigest: digest({ label, volumeMm3 }),
    shape: { volumeMm3 },
  };
  const domain = { ...domainUnsigned, domainDigest: digest(domainUnsigned) };
  const modelUnsigned = {
    projectRevision: revision, domains: [domain],
    references: [{ domainId: 'bracket', semanticReferenceId: 'critical-face',
      sourceFeatureId: 'thickness-extrude', geometryKind: 'FACE' }],
  };
  const model = { ...modelUnsigned, modelDigest: digest(modelUnsigned) };
  const requestUnsigned = {
    schema: 'tunacad-neutral-simulation-request/2.0',
    studyId: 'bracket-' + label, name: 'Bracket linear static ' + label,
    preparedAt: '2026-09-27T00:00:00.000Z', expiresAt: '2026-09-27T00:20:00.000Z',
    analysis: { type: 'linear_static' }, model,
    units: { geometry: 'mm', force: 'N', stress: 'MPa' },
    materials: [{ id: 'steel', model: 'isotropic_linear_elastic',
      youngsModulusMPa: 210000, poissonRatio: .3,
      source: { kind: 'library', reference: 'steel-reference', revision: '2026-r1' } }],
    materialAssignments: [{ domainId: 'bracket', materialId: 'steel' }],
    loads: [{ id: 'force', type: 'surface_force', forceN: [100, 0, 0] }],
    constraints: [{ id: 'fixed', type: 'fixed' }], interactions: [],
    mesh: { globalSizeMm: 5 }, requestedResults: ['von_mises_stress'],
  };
  const request = { ...requestUnsigned, requestDigest: digest(requestUnsigned) };
  const result = {
    schema: 'tunacad-neutral-simulation-result/2.0',
    studyId: request.studyId, jobId: 'job-' + label,
    requestDigest: request.requestDigest, projectRevision: revision,
    modelDigest: model.modelDigest, analysisType: 'linear_static',
    status: 'succeeded', authority: 'engineering',
    convergence: { status: 'converged' },
    mutation: { occurred: false, projectRevisionBefore: revision,
      projectRevisionAfter: revision },
    perDomain: [{ domainId: 'bracket',
      metrics: { maximumVonMisesStressMPa: stressMPa },
      fieldDatasetIds: ['job-' + label + ':bracket:stress'] }],
  };
  const field = {
    schema: 'tunacad-neutral-simulation-field-dataset/2.0',
    datasetId: 'job-' + label + ':bracket:stress',
    jobId: result.jobId, domainId: 'bracket',
    analysisType: 'linear_static', component: 'von_mises_stress', unit: 'MPa',
    datasetDigest: digest({ label, stressMPa }),
    mapping: { semanticReferenceIds: ['critical-face'] },
  };
  const parameter = {
    schema: 'tunacad-cad-parameter-snapshot/0.1',
    projectRevision: revision, modelDigest: model.modelDigest,
    domainId: 'bracket', partId: 'bracket-part', bodyId: 'bracket-body',
    featureId: 'thickness-extrude', parameterId: 'thickness',
    kind: 'length', valueMm: parameterMm, unit: 'mm',
    provenance: { kind: 'cad_project', reference: 'bracket CAD source', revision },
  };
  const source = {
    studyId: request.studyId, structuralJobId: result.jobId,
    requestDigest: request.requestDigest, resultDigest: digest(result),
    projectRevision: revision, modelDigest: model.modelDigest,
    domainId: 'bracket', partId: 'bracket-part', bodyId: 'bracket-body',
    materialId: 'steel', materialProvenance: { kind: 'library' as const,
      reference: 'steel-reference', revision: '2026-r1' },
    semanticReferenceId: 'critical-face',
    stressFieldDatasetId: field.datasetId,
    stressFieldDatasetDigest: field.datasetDigest,
    stressFieldDescriptorDigest: digest(field),
  };
  return { request, result, field, parameter, source };
}
type Study = ReturnType<typeof study>;
function changeSet(candidate: Study) {
  return {
    schema: 'tunacad-cad-single-parameter-change/0.1',
    baselineProjectRevision: 'project-r1',
    candidateProjectRevision: candidate.request.model.projectRevision,
    baselineModelDigest: base.request.model.modelDigest,
    candidateModelDigest: candidate.request.model.modelDigest,
    changedParameter: {
      domainId: 'bracket', partId: 'bracket-part', bodyId: 'bracket-body',
      featureId: 'thickness-extrude', parameterId: 'thickness',
      fromMm: 10, toMm: candidate.parameter.valueMm, unit: 'mm',
    },
    otherChanges: false,
  };
}
function reader(source: Study, overrides: {
  revision?: string; request?: unknown; result?: unknown;
  field?: unknown; parameter?: unknown; changeSet?: unknown;
} = {}): TrustedOptimizationCandidateReader {
  return {
    async readCurrentProjectRevision() { return overrides.revision ?? source.request.model.projectRevision; },
    async readStudyRequest() { return structuredClone(overrides.request === undefined ? source.request : overrides.request); },
    async readCompletedResult() { return structuredClone(overrides.result === undefined ? source.result : overrides.result); },
    async readStressFieldDescriptor() { return structuredClone(overrides.field === undefined ? source.field : overrides.field); },
    async readCadParameter() { return structuredClone(overrides.parameter === undefined ? source.parameter : overrides.parameter); },
    async readCadChangeSet() { return structuredClone(overrides.changeSet === undefined
      ? changeSet(source) : overrides.changeSet); },
  };
}
const base = study('baseline', 'project-r1', 10, 1000, 80);
const changed = study('candidate', 'project-r2', 9, 900, 95);
const baseDraft: OptimizationFoundationDraft = {
  schema: 'tunacad-optimization-foundation/0.1',
  source: base.source,
  variable: { kind: 'cad_length', featureId: 'thickness-extrude',
    parameterId: 'thickness', baselineMm: 10, minimumMm: 8, maximumMm: 12,
    unit: 'mm', snapshotDigest: digest(base.parameter),
    provenance: { kind: 'cad_project', reference: 'bracket CAD source', revision: 'project-r1' } },
  objective: { kind: 'minimize_domain_volume', domainId: 'bracket',
    baselineVolumeMm3: 1000, unit: 'mm^3' },
  constraint: { kind: 'domain_von_mises_upper_bound',
    domainId: 'bracket', semanticReferenceId: 'critical-face',
    stressFieldDatasetId: base.field.datasetId,
    baselineStressMPa: 80, upperBoundMPa: 100, unit: 'MPa' },
};
const baselineInput = sealOptimizationFoundation(baseDraft);
const candidateDraft: OptimizationCandidateDraft = {
  schema: 'tunacad-optimization-candidate/0.1',
  baselineInputDigest: baselineInput.inputDigest,
  cadChangeSetDigest: digest(changeSet(changed)),
  source: changed.source,
  variable: { featureId: 'thickness-extrude', parameterId: 'thickness',
    valueMm: 9, unit: 'mm', snapshotDigest: digest(changed.parameter),
    provenance: { kind: 'cad_project', reference: 'bracket CAD source', revision: 'project-r2' } },
  objective: { kind: 'minimize_domain_volume', domainId: 'bracket',
    volumeMm3: 900, unit: 'mm^3' },
  constraint: { kind: 'domain_von_mises_upper_bound',
    domainId: 'bracket', semanticReferenceId: 'critical-face',
    stressFieldDatasetId: changed.field.datasetId,
    observedStressMPa: 95, unit: 'MPa' },
};
const candidateInput = sealOptimizationCandidate(candidateDraft);
assert.deepEqual(validateOptimizationCandidate(candidateInput, baselineInput), candidateInput);
const compare = (candidate = candidateInput, baselineReader = reader(base),
  candidateReader = reader(changed)) => compareOptimizationCandidate(
    baselineInput, candidate, baselineReader, candidateReader);
const comparison = await compare();
assert.equal(comparison.baseline.parameterMm, 10);
assert.equal(comparison.baseline.volumeMm3, 1000);
assert.equal(comparison.baseline.maximumVonMisesStressMPa, 80);
assert.equal(comparison.candidate.parameterMm, 9);
assert.equal(comparison.candidate.volumeMm3, 900);
assert.equal(comparison.candidate.maximumVonMisesStressMPa, 95);
assert.equal(comparison.stressUpperBoundMPa, 100);
assert.equal(comparison.stressConstraintSatisfied, true);
assert.equal(comparison.candidateFeasible, true);
assert.equal(comparison.objectiveDeltaMm3, 100);
assert.equal(comparison.objectiveChangePercent, 10);
assert.equal(comparison.objectiveOutcome, 'improved');
assert.equal(comparison.providerAdmission, 'closed');
assert.equal(comparison.engineeringUsePermitted, false);
assert.deepEqual(await compare(), comparison);
function variant(label: string, revision: string, parameterMm: number,
  volumeMm3: number, stressMPa: number) {
  const record = study(label, revision, parameterMm, volumeMm3, stressMPa);
  const next = structuredClone(candidateDraft);
  next.source = record.source;
  next.cadChangeSetDigest = digest(changeSet(record));
  next.variable.valueMm = parameterMm;
  next.variable.snapshotDigest = digest(record.parameter);
  next.variable.provenance.revision = revision;
  next.objective.volumeMm3 = volumeMm3;
  next.constraint.stressFieldDatasetId = record.field.datasetId;
  next.constraint.observedStressMPa = stressMPa;
  return { record, input: sealOptimizationCandidate(next) };
}
const infeasible = variant('infeasible', 'project-r3', 8, 850, 105);
const infeasibleComparison = await compare(infeasible.input, reader(base), reader(infeasible.record));
assert.equal(infeasibleComparison.objectiveOutcome, 'improved');
assert.equal(infeasibleComparison.objectiveDeltaMm3, 150);
assert.equal(infeasibleComparison.stressConstraintSatisfied, false);
assert.equal(infeasibleComparison.candidateFeasible, false);
const regression = variant('regression', 'project-r4', 11, 1100, 70);
const regressedComparison = await compare(regression.input, reader(base), reader(regression.record));
assert.equal(regressedComparison.objectiveOutcome, 'regressed');
assert.equal(regressedComparison.objectiveDeltaMm3, -100);
assert.equal(regressedComparison.stressConstraintSatisfied, true);
assert.equal(regressedComparison.candidateFeasible, true);
let rejected = 0;
async function rejects(candidate = candidateInput, baseReader = reader(base),
  candidateReader = reader(changed)) {
  await assert.rejects(compare(candidate, baseReader, candidateReader),
    /SIM9_OPTIMIZATION_(CANDIDATE|FOUNDATION)_INVALID/);
  rejected++;
}
function alteredCandidate(change: (draft: OptimizationCandidateDraft) => void) {
  const altered = structuredClone(candidateDraft); change(altered);
  return sealOptimizationCandidate(altered);
}
await rejects(alteredCandidate(value => { value.baselineInputDigest = digest('other'); }));
await rejects(alteredCandidate(value => { value.cadChangeSetDigest = digest('other'); }));
await rejects(alteredCandidate(value => { value.variable.valueMm = 7.9; }));
await rejects(alteredCandidate(value => { value.variable.valueMm = 12.1; }));
await rejects(alteredCandidate(value => { value.variable.valueMm = 10; }));
await rejects(alteredCandidate(value => { value.variable.featureId = 'other-feature'; }));
await rejects(alteredCandidate(value => { value.source.studyId = base.source.studyId; }));
await rejects(alteredCandidate(value => { value.source.projectRevision = base.source.projectRevision; }));
await rejects(alteredCandidate(value => { value.source.materialProvenance.revision = '2026-r2'; }));
await rejects(alteredCandidate(value => { value.constraint.semanticReferenceId = 'other-face'; }));
await rejects(alteredCandidate(value => { value.objective.volumeMm3 = 0; }));
await rejects(alteredCandidate(value => { value.variable.unit = 'inch' as 'mm'; }));
await rejects(candidateInput, reader(base, { revision: 'project-r3' }));
await rejects(candidateInput, reader(base, { result: { ...base.result, status: 'failed' } }));
await rejects(candidateInput, reader(base), reader(changed, { revision: 'project-r3' }));
await rejects(candidateInput, reader(base), reader(changed, { request: null }));
await rejects(candidateInput, reader(base), reader(changed, { request: {
  ...changed.request, model: { ...changed.request.model, domains: [
    { ...changed.request.model.domains[0], shape: { volumeMm3: 901 } },
  ] },
} }));
await rejects(candidateInput, reader(base), reader(changed, { result: {
  ...changed.result, status: 'cancelled',
} }));
await rejects(candidateInput, reader(base), reader(changed, { result: {
  ...changed.result, convergence: { status: 'not_converged' },
} }));
await rejects(candidateInput, reader(base), reader(changed, { result: {
  ...changed.result, perDomain: [{ ...changed.result.perDomain[0],
    metrics: { maximumVonMisesStressMPa: 94 } }],
} }));
await rejects(candidateInput, reader(base), reader(changed, { field: {
  ...changed.field, datasetDigest: digest('tampered'),
} }));
await rejects(candidateInput, reader(base), reader(changed, { parameter: {
  ...changed.parameter, valueMm: 9.1,
} }));
await rejects(candidateInput, reader(base), reader(changed, { parameter: {
  ...changed.parameter, provenance: { ...changed.parameter.provenance, revision: 'project-r3' },
} }));
await rejects(candidateInput, reader(base), reader(changed, { changeSet: null }));
await rejects(candidateInput, reader(base), reader(changed, { changeSet: {
  ...changeSet(changed), otherChanges: true,
} }));
await rejects(candidateInput, reader(base), reader(changed, { changeSet: {
  ...changeSet(changed), changedParameter: {
    ...changeSet(changed).changedParameter, parameterId: 'other-parameter',
  },
} }));
const alteredLoadUnsigned = { ...changed.request, loads: [{
  ...changed.request.loads[0], forceN: [110, 0, 0],
}] };
const { requestDigest: _ignored, ...alteredLoadBody } = alteredLoadUnsigned;
const alteredLoadRequest = { ...alteredLoadBody, requestDigest: digest(alteredLoadBody) };
const alteredLoadResult = { ...changed.result, requestDigest: alteredLoadRequest.requestDigest };
const alteredLoadCandidate = alteredCandidate(value => {
  value.source.requestDigest = alteredLoadRequest.requestDigest;
  value.source.resultDigest = digest(alteredLoadResult);
});
await rejects(alteredLoadCandidate, reader(base), reader(changed, {
  request: alteredLoadRequest, result: alteredLoadResult,
}));
let candidateRevisionReads = 0;
await rejects(candidateInput, reader(base), {
  ...reader(changed),
  async readCurrentProjectRevision() {
    candidateRevisionReads++;
    return candidateRevisionReads === 1 ? 'project-r2' : 'project-r3';
  },
});
console.log(JSON.stringify({ status: 'PASS', fixture: 'one immutable candidate comparison',
  baseline: comparison.baseline, candidate: comparison.candidate,
  stressUpperBoundMPa: comparison.stressUpperBoundMPa,
  feasible: comparison.candidateFeasible, objectiveDeltaMm3: comparison.objectiveDeltaMm3,
  objectiveChangePercent: comparison.objectiveChangePercent, rejectedCases: rejected,
  providerAdmission: comparison.providerAdmission, engineeringUsePermitted: false }));
