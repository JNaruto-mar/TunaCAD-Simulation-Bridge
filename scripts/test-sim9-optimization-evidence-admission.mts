import assert from 'node:assert/strict';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { sealOptimizationFoundation } from '../simulation-bridge/optimizationFoundation.mts';
import { compareOptimizationCandidate, sealOptimizationCandidate,
} from '../simulation-bridge/optimizationCandidate.mts';
import { admitOptimizationNumericalEvidence,
  type OptimizationNumericalEvidence, type OptimizationRefinementRecord,
  type TrustedOptimizationEvidenceReader,
  type TrustedOptimizationNumericalCandidateReader } from '../simulation-bridge/optimizationEvidenceAdmission.mts';

// Numerical values replay the recorded real fixtures. Identity/result records
// below are synthetic trusted-store fixtures, NOT fabricated historical solver
// artifacts or a replacement for archival of those real immutable sources.
const material = { kind: 'custom' as const, reference: 'SIM-9 optimization real-candidate elastic steel', revision: 'r1' };
const runtime = { gmsh: '4.15.2' as const, calculix: '2.16' as const, nodeMajor: 24 as const };
function study(label: string, thickness: number, size: number, stress: number,
  nodes: number, elements: number, position: [number, number, number],
  mode: 'global' | 'local_diagnostic' = 'global', local: number | null = null,
  region: 'none' | 'restraint_edge' = 'restraint_edge') {
  const revision = thickness === 10 ? 'opt-cad-b1a1241c2d42' : 'opt-cad-dc6470f70dce';
  const domainUnsigned = { domainId: 'bar', partId: 'bar-part', bodyId: 'bar-body',
    geometryDigest: digest({ thickness, fixture: '40x10xthickness' }),
    transformToAnalysis: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    shape: { volumeMm3: 400 * thickness } };
  const domain = { ...domainUnsigned, domainDigest: digest(domainUnsigned) };
  const modelUnsigned = { projectRevision: revision, domains: [domain],
    references: [
      { domainId: 'bar', semanticReferenceId: 'fixed-face', role: 'constraint',
        sourceFeatureId: 'thickness-extrude', geometryKind: 'FACE',
        faceOwnerLocal: { geometryType: 'plane', edgeCount: 4, areaMm2: 10 * thickness,
          boundingBoxMm: { min: [0, 0, 0], max: [0, 10, thickness] } } },
      { domainId: 'bar', semanticReferenceId: 'load-face', role: 'load',
        sourceFeatureId: 'thickness-extrude', geometryKind: 'FACE',
        faceOwnerLocal: { geometryType: 'plane', edgeCount: 4, areaMm2: 10 * thickness,
          boundingBoxMm: { min: [40, 0, 0], max: [40, 10, thickness] } } },
    ] };
  const model = { ...modelUnsigned, modelDigest: digest(modelUnsigned) };
  const unsigned = { schema: 'tunacad-neutral-simulation-request/2.0',
    studyId: label, name: label, preparedAt: '2026-09-27T00:00:00Z',
    expiresAt: '2026-09-27T00:20:00Z', analysis: { type: 'linear_static' }, model,
    units: { geometry: 'mm', force: 'N', stress: 'MPa' },
    materials: [{ id: 'steel', model: 'isotropic_linear_elastic',
      youngsModulusMPa: 210000, poissonRatio: .3, source: material }],
    materialAssignments: [{ domainId: 'bar', materialId: 'steel' }],
    loads: [{ id: 'axial-force', type: 'surface_force', forceN: [100, 0, 0] }],
    constraints: [{ id: 'fixed-end', type: 'fixed' }], interactions: [],
    mesh: { globalSizeMm: size, minimumSizeMm: size / 4,
      maximumNodes: 15000, maximumElements: 7500, order: 2 },
    requestedResults: ['von_mises_stress'] };
  const request = { ...unsigned, requestDigest: digest(unsigned) };
  const jobId = label + '-job', datasetId = jobId + ':bar:stress';
  const result = { schema: 'tunacad-neutral-simulation-result/2.0', studyId: label,
    jobId, requestDigest: request.requestDigest, projectRevision: revision,
    modelDigest: model.modelDigest, analysisType: 'linear_static',
    status: 'succeeded', authority: 'engineering', convergence: { status: 'converged' },
    mutation: { occurred: false, projectRevisionBefore: revision, projectRevisionAfter: revision },
    perDomain: [{ domainId: 'bar', metrics: { maximumVonMisesStressMPa: stress },
      fieldDatasetIds: [datasetId] }],
    criticalRegions: [{ domainId: 'bar', kind: 'stress', value: stress,
      unit: 'MPa', positionAnalysisMm: position }] };
  const triangles = [{ facetIndex: 0, elementIndex: 0,
    positionsAnalysisMm: [[0, 0, 0], [0, 1, 0], [0, 0, 1]],
    displacementsMm: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], values: [stress, stress, stress] }];
  const field = { schema: 'tunacad-neutral-simulation-field-dataset/2.0', datasetId,
    jobId, domainId: 'bar', analysisType: 'linear_static', component: 'von_mises_stress',
    unit: 'MPa', datasetDigest: digest(triangles), step: { index: 0, label: 'static' },
    location: 'boundary_facet', topology: 'triangle_soup',
    valueRange: { minimum: stress, maximum: stress,
      minimumPositionAnalysisMm: [0, 0, 0], maximumPositionAnalysisMm: [0, 0, 0] },
    deformation: { vectorsIncluded: true, trueScale: 1, recommendedScale: 1 },
    mapping: { domain: 'exact', cadRegions: 'partial', semanticReferenceIds: ['load-face'] },
    totalTriangles: 1, maximumPageTriangles: 128 };
  const parameter = { schema: 'tunacad-cad-parameter-snapshot/0.1',
    projectRevision: revision, modelDigest: model.modelDigest,
    domainId: 'bar', partId: 'bar-part', bodyId: 'bar-body',
    featureId: 'thickness-extrude', parameterId: 'thickness', kind: 'length',
    valueMm: thickness, unit: 'mm',
    provenance: { kind: 'cad_project', reference: 'SIM-9 optimization parameterized box CAD fixture', revision } };
  const source = { studyId: label, structuralJobId: jobId,
    requestDigest: request.requestDigest, resultDigest: digest(result),
    projectRevision: revision, modelDigest: model.modelDigest,
    domainId: 'bar', partId: 'bar-part', bodyId: 'bar-body',
    materialId: 'steel', materialProvenance: material,
    semanticReferenceId: 'load-face', stressFieldDatasetId: datasetId,
    stressFieldDatasetDigest: field.datasetDigest, stressFieldDescriptorDigest: digest(field) };
  const record: OptimizationRefinementRecord = {
    schema: 'tunacad-optimization-refinement-record/0.1', source,
    metric: 'raw_domain_maximum_von_mises', unit: 'MPa',
    cadVolumeMm3: 400 * thickness, rawMaximumStressMPa: stress,
    peakPositionAnalysisMm: position,
    criticalRegion: { kind: region, distanceMm: Math.hypot(position[0],
      Math.min(position[1], 10 - position[1], position[2], thickness - position[2])) },
    mesh: { mode, globalSizeMm: size, localSizeMm: local,
      nodeCount: nodes, elementCount: elements, optionsDigest: digest({ size, local }) },
  };
  return { request, result, field, triangles, parameter, source, record };
}
type Study = ReturnType<typeof study>;
async function fixture(stable = false, nearLimit = false) {
  const build = (kind: 'baseline' | 'candidate') => {
    const t = kind === 'baseline' ? 10 : 9;
    const stresses = stable ? (nearLimit ? [1.92, 1.95, 1.96] : t === 10 ? [1, 1.01, 1.015] : [1.1, 1.11, 1.115])
      : t === 10 ? [1.0872984734609643, 1.189661426651228, 1.3026304641672846]
        : [1.1978471692076809, 1.2981391977375287, 1.4382011838165458];
    const positions: [number, number, number][] = t === 10 ? [
      [2.2619153769261833, 9.426184107177622, 9.426184107177622],
      [1.6170241760599355, .4448669857131035, 9.55588555543898],
      [1.2320508075688772, 9.63397459621556, .36602540378443876],
    ] : [
      [2.2653521627251263, .5849334346115465, 8.514821499169445],
      [1.6549418026248988, 9.556141719926172, 8.507927728005612],
      [1.1870672560251614, 9.63397459621556, .3188755100326795],
    ];
    const global = [
      study(kind + '-g4', t, 4, stresses[0], 931, 428, stable ? [20, 5, t / 2] : positions[0], 'global', null, stable ? 'none' : 'restraint_edge'),
      study(kind + '-g3', t, 3, stresses[1], t === 10 ? 2006 : 1874, t === 10 ? 1035 : 967, stable ? [20, 5, t / 2] : positions[1], 'global', null, stable ? 'none' : 'restraint_edge'),
      study(kind + '-g2', t, 2, stresses[2], t === 10 ? 4636 : 4468, t === 10 ? 2607 : 2505, stable ? [20, 5, t / 2] : positions[2], 'global', null, stable ? 'none' : 'restraint_edge'),
    ];
    const diagnostics = stable ? [] : [
      study(kind + '-l1p5', t, 4, t === 10 ? 1.4658470100072893 : 1.6010257777662886,
        t === 10 ? 2838 : 2621, t === 10 ? 1530 : 1386,
        t === 10 ? [.846605459173775, 9.752350991804544, .2476490081954547]
          : [.8459171546616531, 9.752350991804544, .24651406422787417], 'local_diagnostic', 1.5),
      study(kind + '-l1', t, 4, t === 10 ? 1.6686843086533159 : 1.8206577004444804,
        t === 10 ? 5926 : 5445, t === 10 ? 3500 : 3184,
        t === 10 ? [.5895641699678792, .17623529749181932, 9.820791595223435]
          : [.5841412821363672, .17623529749181935, 8.827666970555335], 'local_diagnostic', 1),
    ];
    return { global, diagnostics };
  };
  const base = build('baseline'), next = build('candidate');
  const selectedBase = base.global[2], selectedCandidate = next.global[2];
  const change = { schema: 'tunacad-cad-single-parameter-change/0.1',
    baselineProjectRevision: selectedBase.source.projectRevision,
    candidateProjectRevision: selectedCandidate.source.projectRevision,
    baselineModelDigest: selectedBase.source.modelDigest, candidateModelDigest: selectedCandidate.source.modelDigest,
    changedParameter: { domainId: 'bar', partId: 'bar-part', bodyId: 'bar-body',
      featureId: 'thickness-extrude', parameterId: 'thickness', fromMm: 10, toMm: 9, unit: 'mm' },
    otherChanges: false };
  const baseline = sealOptimizationFoundation({
    schema: 'tunacad-optimization-foundation/0.1', source: selectedBase.source,
    variable: { kind: 'cad_length', featureId: 'thickness-extrude', parameterId: 'thickness',
      baselineMm: 10, minimumMm: 8, maximumMm: 12, unit: 'mm',
      snapshotDigest: digest(selectedBase.parameter), provenance: selectedBase.parameter.provenance as any },
    objective: { kind: 'minimize_domain_volume', domainId: 'bar', baselineVolumeMm3: 4000, unit: 'mm^3' },
    constraint: { kind: 'domain_von_mises_upper_bound', domainId: 'bar', semanticReferenceId: 'load-face',
      stressFieldDatasetId: selectedBase.field.datasetId, baselineStressMPa: selectedBase.record.rawMaximumStressMPa,
      upperBoundMPa: 2, unit: 'MPa' } });
  const candidate = sealOptimizationCandidate({
    schema: 'tunacad-optimization-candidate/0.1', source: selectedCandidate.source,
    baselineInputDigest: baseline.inputDigest, cadChangeSetDigest: digest(change),
    variable: { featureId: 'thickness-extrude', parameterId: 'thickness', valueMm: 9, unit: 'mm',
      snapshotDigest: digest(selectedCandidate.parameter), provenance: selectedCandidate.parameter.provenance as any },
    objective: { kind: 'minimize_domain_volume', domainId: 'bar', volumeMm3: 3600, unit: 'mm^3' },
    constraint: { kind: 'domain_von_mises_upper_bound', domainId: 'bar', semanticReferenceId: 'load-face',
      stressFieldDatasetId: selectedCandidate.field.datasetId,
      observedStressMPa: selectedCandidate.record.rawMaximumStressMPa, unit: 'MPa' } });
  const all = [...base.global, ...base.diagnostics, ...next.global, ...next.diagnostics];
  const records = new Map(all.map(item => [item.result.jobId, item]));
  const reader = (selected: Study): TrustedOptimizationNumericalCandidateReader => ({
    async readCurrentProjectRevision() { return selected.source.projectRevision; },
    async readStudyRequest(id) { return structuredClone(all.find(item => item.request.studyId === id)?.request ?? null); },
    async readCompletedResult(id) { return structuredClone(records.get(id)?.result ?? null); },
    async readStressFieldDescriptor(id, dataset) { const item = records.get(id);
      return item?.field.datasetId === dataset ? structuredClone(item.field) : null; },
    async readStressFieldPage(id, dataset, cursor) {
      const item = records.get(id);
      return item?.field.datasetId === dataset && cursor === '0' ? {
        schema: 'tunacad-neutral-simulation-field-page/2.0', dataset: structuredClone(item.field),
        cursor, nextCursor: null, triangleOffset: 0, triangleCount: 1,
        chunkDigest: digest(item.triangles), triangles: structuredClone(item.triangles),
      } : null;
    },
    async readCadParameter() { return structuredClone(selected.parameter); },
    async readCadChangeSet() { return structuredClone(change); },
  });
  const baselineReader = reader(selectedBase), candidateReader = reader(selectedCandidate);
  const comparison = await compareOptimizationCandidate(baseline, candidate, baselineReader, candidateReader);
  const lane = (source: Study, entries: ReturnType<typeof build>) => ({
    selectedSourceDigest: digest(source.source),
    global: entries.global.map(item => ({ jobId: item.result.jobId, recordDigest: digest(item.record) })),
    diagnostics: entries.diagnostics.map(item => ({ jobId: item.result.jobId, recordDigest: digest(item.record) })),
  });
  const evidence: OptimizationNumericalEvidence = {
    schema: 'tunacad-optimization-numerical-evidence/0.1', evidenceId: 'recorded-case-replay',
    policy: 'raw-maximum-stability/1', runtime,
    baselineInputDigest: baseline.inputDigest, candidateInputDigest: candidate.inputDigest,
    comparisonDigest: digest(comparison), baseline: lane(selectedBase, base), candidate: lane(selectedCandidate, next) };
  const evidenceReader: TrustedOptimizationEvidenceReader = {
    async readEvidence() { return structuredClone(evidence); },
    async readRefinementRecord(id) { return structuredClone(records.get(id)?.record ?? null); },
    async readMeshSummary(id) {
      const item = records.get(id);
      return item ? { jobId: id, requestDigest: item.source.requestDigest,
        resultDigest: item.source.resultDigest, nodeCount: item.record.mesh.nodeCount,
        elementCount: item.record.mesh.elementCount, optionsDigest: item.record.mesh.optionsDigest } : null;
    },
    async readCurrentRuntimeTuple() { return structuredClone(runtime); },
  };
  const run = (er = evidenceReader, cr = candidateReader, value = evidence) =>
    admitOptimizationNumericalEvidence(baseline, candidate,
      { evidenceId: value.evidenceId, evidenceDigest: digest(value) },
      baselineReader, cr, er);
  return { run, evidence, evidenceReader, candidateReader, records, comparison };
}
const current = await fixture();
const denied = await current.run();
assert.equal(denied.nominalFeasible, true);
assert.equal(denied.robustFeasible, false);
assert.equal(denied.numericalEvidenceGate, 'FAIL');
assert.equal(denied.classification, 'nominal_only_insufficient_numerical_evidence');
assert.deepEqual(denied.candidate.reasons,
  ['GLOBAL_STRESS_UNSTABLE', 'LOCAL_STRESS_UNSTABLE', 'PEAK_APPROACHES_CRITICAL_REGION', 'REFINEMENT_CHANGE_EXCEEDS_MARGIN']);
assert.equal(denied.objectiveImprovementMm3, 400);
assert.deepEqual(await current.run(), denied);
const positive = await (await fixture(true)).run();
assert.equal(positive.robustFeasible, true);
assert.equal(positive.numericalEvidenceGate, 'PASS');
assert.equal(positive.engineeringUsePermitted, false);
const nearLimit = await (await fixture(true, true)).run();
assert.equal(nearLimit.robustFeasible, false);
assert(nearLimit.candidate.reasons.includes('REFINEMENT_CHANGE_EXCEEDS_MARGIN'));
let rejected = 0;
async function reject(er = current.evidenceReader, cr = current.candidateReader, value = current.evidence) {
  await assert.rejects(current.run(er, cr, value), /SIM9_OPTIMIZATION_(EVIDENCE|FOUNDATION|CANDIDATE)_INVALID/);
  rejected++;
}
await reject({ ...current.evidenceReader, async readEvidence() { return null; } });
await reject({ ...current.evidenceReader, async readRefinementRecord() { return null; } });
await reject({ ...current.evidenceReader, async readMeshSummary() { return null; } });
await reject({ ...current.evidenceReader, async readCurrentRuntimeTuple() { return { ...runtime, calculix: '2.17' }; } });
async function alteredEvidence(change: (value: any) => void) {
  const value = structuredClone(current.evidence); change(value);
  await reject({ ...current.evidenceReader, async readEvidence() { return value; } }, current.candidateReader, value);
}
await alteredEvidence(value => { value.candidate.global.pop(); });
await alteredEvidence(value => { value.candidate.diagnostics = []; });
await alteredEvidence(value => { value.candidate.global.reverse(); });
await alteredEvidence(value => { value.candidate.global[1] = value.candidate.global[0]; });
await alteredEvidence(value => { value.comparisonDigest = digest('different-result'); });
await alteredEvidence(value => { value.candidateInputDigest = digest('different-revision'); });
await alteredEvidence(value => { value.candidate.selectedSourceDigest = digest('other-source'); });
await alteredEvidence(value => { value.policy = 'relaxed-policy'; });
await alteredEvidence(value => { value.runtime.gmsh = '4.16'; });
for (const change of [
  (record: any) => { record.rawMaximumStressMPa = 1; },
  (record: any) => { record.metric = 'averaged_stress'; },
  (record: any) => { record.source.projectRevision = 'other-revision'; },
  (record: any) => { record.source.resultDigest = digest('other-result'); },
  (record: any) => { record.source.materialProvenance.revision = 'other-material'; },
  (record: any) => { record.mesh.nodeCount++; },
  (record: any) => { record.peakPositionAnalysisMm[0] += .1; },
  (record: any) => { record.criticalRegion.distanceMm = 10; },
]) {
  await reject({ ...current.evidenceReader, async readRefinementRecord(id) {
    const value = await current.evidenceReader.readRefinementRecord(id) as any;
    change(value); return value;
  } });
}
// Re-sealing altered evidence does not replace the actual trusted stress result.
const altered = structuredClone(current.evidence);
const alteredRecord = structuredClone(current.records.get(altered.candidate.global[0].jobId)!.record);
alteredRecord.rawMaximumStressMPa = 1;
altered.candidate.global[0].recordDigest = digest(alteredRecord);
await reject({ ...current.evidenceReader, async readEvidence() { return altered; },
  async readRefinementRecord(id) { return id === alteredRecord.source.structuralJobId
    ? alteredRecord : current.evidenceReader.readRefinementRecord(id); } }, current.candidateReader, altered);
await reject(current.evidenceReader, { ...current.candidateReader, async readStressFieldDescriptor() { return null; } });
await reject(current.evidenceReader, { ...current.candidateReader, async readStressFieldPage() { return null; } });
await reject(current.evidenceReader, { ...current.candidateReader, async readStressFieldPage(id, dataset, cursor, limit) {
  const page = await current.candidateReader.readStressFieldPage(id, dataset, cursor, limit) as any;
  page.triangles[0].values[0] += .01;
  return page;
} });
await reject(current.evidenceReader, { ...current.candidateReader, async readStressFieldDescriptor(id, dataset) {
  return id.endsWith('-g4-job') ? null : current.candidateReader.readStressFieldDescriptor(id, dataset);
} });
for (const change of [
  (record: any) => { record.criticalRegion = { kind: 'none', distanceMm: 20 }; },
  (record: any) => { record.mesh.nodeCount++; },
  (record: any) => { record.mesh.optionsDigest = digest('changed-mesh-options'); },
]) {
  const value = structuredClone(current.evidence);
  const jobId = value.candidate.global[0].jobId;
  const record = structuredClone(current.records.get(jobId)!.record);
  change(record);
  value.candidate.global[0].recordDigest = digest(record);
  await reject({ ...current.evidenceReader, async readEvidence() { return value; },
    async readRefinementRecord(id) { return id === jobId ? record
      : current.evidenceReader.readRefinementRecord(id); } }, current.candidateReader, value);
}
await reject(current.evidenceReader, { ...current.candidateReader, async readCurrentProjectRevision() { return 'changed-after-solve'; } });
let reads = 0;
await reject({ ...current.evidenceReader, async readEvidence() {
  const value = structuredClone(current.evidence);
  if (++reads > 1) value.comparisonDigest = digest('changed-during-admission');
  return value;
} });
let recordReads = 0;
await reject({ ...current.evidenceReader, async readRefinementRecord(id) {
  const value = await current.evidenceReader.readRefinementRecord(id) as any;
  if (++recordReads > current.records.size) value.mesh.nodeCount++;
  return value;
} });
console.log(JSON.stringify({ status: 'PASS', fixture: 'recorded peak-stability evidence replay; no solver',
  current: denied, syntheticStableBranch: positive.numericalEvidenceGate,
  rejectionCases: rejected }));
