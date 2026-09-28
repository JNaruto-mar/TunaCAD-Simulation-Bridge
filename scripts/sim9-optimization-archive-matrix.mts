import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { OptimizationRefinementArchive, FileOptimizationArchiveCatalog,
  type TrustedRefinementCaptureSource } from '../simulation-bridge/optimizationRefinementArchive.mts';
import { readVerifiedOptimizationStressField } from '../simulation-bridge/optimizationVerifiedStressField.mts';
import { sealOptimizationFoundation } from '../simulation-bridge/optimizationFoundation.mts';
import { sealOptimizationCandidate, compareOptimizationCandidate } from '../simulation-bridge/optimizationCandidate.mts';

// Exactly the existing recorded cases; no candidates or numerical definitions
// are generated. This helper is called only by the explicitly approved mode.
const cases = [
  { label: 'baseline-g4', design: 'baseline', size: 4, local: null, nodes: 931, elements: 428,
    stress: 1.0872984734609643, peak: [2.2619153769261833, 9.426184107177622, 9.426184107177622] },
  { label: 'baseline-g3', design: 'baseline', size: 3, local: null, nodes: 2006, elements: 1035,
    stress: 1.189661426651228, peak: [1.6170241760599355, .4448669857131035, 9.55588555543898] },
  { label: 'baseline-g2', design: 'baseline', size: 2, local: null, nodes: 4636, elements: 2607,
    stress: 1.3026304641672846, peak: [1.2320508075688772, 9.63397459621556, .36602540378443876] },
  { label: 'candidate-g4', design: 'candidate', size: 4, local: null, nodes: 931, elements: 428,
    stress: 1.1978471692076809, peak: [2.2653521627251263, .5849334346115465, 8.514821499169445] },
  { label: 'candidate-g3', design: 'candidate', size: 3, local: null, nodes: 1874, elements: 967,
    stress: 1.2981391977375287, peak: [1.6549418026248988, 9.556141719926172, 8.507927728005612] },
  { label: 'candidate-g2', design: 'candidate', size: 2, local: null, nodes: 4468, elements: 2505,
    stress: 1.4382011838165458, peak: [1.1870672560251614, 9.63397459621556, .3188755100326795] },
  { label: 'baseline-l1p5', design: 'baseline', size: 4, local: 1.5, nodes: 2838, elements: 1530,
    stress: 1.4658470100072893, peak: [.846605459173775, 9.752350991804544, .2476490081954547] },
  { label: 'baseline-l1', design: 'baseline', size: 4, local: 1, nodes: 5926, elements: 3500,
    stress: 1.6686843086533159, peak: [.5895641699678792, .17623529749181932, 9.820791595223435] },
  { label: 'candidate-l1p5', design: 'candidate', size: 4, local: 1.5, nodes: 2621, elements: 1386,
    stress: 1.6010257777662886, peak: [.8459171546616531, 9.752350991804544, .24651406422787417] },
  { label: 'candidate-l1', design: 'candidate', size: 4, local: 1, nodes: 5445, elements: 3184,
    stress: 1.8206577004444804, peak: [.5841412821363672, .17623529749181935, 8.827666970555335] },
] as const;
const previousJob = 'calculixv2_766bf723-cfe6-4a1f-866a-f22f03ae927f';
const previousRoot = 'sha256:2b94d8924fcb3c63b7ccd93c2a3bf1f2ded99c7f62854a609f0deeac166f81e6';
type Case = typeof cases[number];

/** Fixture-only bounded field replay. Reload/bind the immutable archive at
 * BOTH ends of each complete field stream, rather than hashing unrelated FEM
 * arrays anew for every 128-triangle chunk. The existing field verifier still
 * validates every chunk and the full dataset. No report is returned until the
 * end reload passes; the admission guard independently repeats every record.
 * Production archive APIs and numerical admission thresholds are unchanged. */
class MatrixReplayArchive extends OptimizationRefinementArchive {
  readers() {
    const reader = super.readers();
    const streams = new Map<string, { row: any; nextCursor: string; rowDigest: string }>();
    return { ...reader, readStressFieldPage: async (job: string, dataset: string, cursor: string, limit: number) => {
      assert.equal(limit, 128, 'bounded archive page size');
      const key = JSON.stringify([job, dataset]);
      if (cursor === '0') {
        assert(!streams.has(key), 'duplicate/open field stream');
        const row = await this.readRefinement(job);
        streams.set(key, { row, nextCursor: '0', rowDigest: digest(row) });
      }
      const stream = streams.get(key);
      assert(stream && stream.nextCursor === cursor, 'missing/reordered/cross-dataset field cursor');
      const page = stream.row.pages.find((value: any) =>
        value.cursor === cursor && value.dataset.datasetId === dataset);
      assert(page, 'missing dataset page');
      if (page.nextCursor) stream.nextCursor = page.nextCursor;
      else {
        assert.equal(digest(await this.readRefinement(job)), stream.rowDigest,
          'archive/source changed during field replay');
        streams.delete(key);
      }
      return structuredClone(page);
    } };
  }
}

export async function completeOptimizationArchiveMatrix(fixture: {
  solve: (cad: any, revision: string, label: string, size: number) => Promise<any>;
  localDiagnostic: (cad: any, revision: string, label: string, local: number, capture: boolean) => Promise<any>;
  solver: { getFieldDataset: (job: string, dataset: string, cursor: string, limit: number) => Promise<any> };
  gmsh: string; calculix: string; baselineCad: any; candidateCad: any;
  baselineRevision: string; candidateRevision: string; replayOnly: boolean;
}) {
  const root = process.env.TUNACAD_OPTIMIZATION_EVIDENCE_DIRECTORY;
  if (!root) throw new Error('Set the existing local TUNACAD_OPTIMIZATION_EVIDENCE_DIRECTORY.');
  assert.equal(execFileSync(fixture.gmsh, ['-version'], {
    encoding: 'utf8', windowsHide: true, timeout: 10_000 }).trim(), '4.15.2');
  const ccx = spawnSync(fixture.calculix, ['-v'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  assert(!ccx.error && !ccx.signal && [0, 201].includes(ccx.status!));
  assert.match(ccx.stdout, /Version 2\.16(?:\s|$)/);
  assert.equal(Number(process.versions.node.split('.')[0]), 24);
  const runtime = { gmsh: '4.15.2', calculix: '2.16', nodeMajor: 24 };
  const catalog = new FileOptimizationArchiveCatalog(join(root, 'completion-ledger'));
  const storage = join(root, 'host-source-state');
  await mkdir(storage, { recursive: true });
  const path = (hash: string) => {
    assert.match(hash, /^sha256:[a-f0-9]{64}$/);
    return join(storage, hash.slice(7) + '.json');
  };
  const readObject = async (hash: string) => {
    const value = JSON.parse(await readFile(path(hash), 'utf8'));
    assert.equal(digest(value), hash, 'independent host-source root');
    return value;
  };
  async function pinObject(id: string, value: unknown) {
    const hash = digest(value);
    try { await writeFile(path(hash), JSON.stringify(value), { encoding: 'utf8', flag: 'wx', mode: 0o600 }); }
    catch (error: any) { if (error.code !== 'EEXIST') throw error; await readObject(hash); }
    await catalog.pinOnce('evidence', id, hash);
    return hash;
  }
  const refs = new Map<string, any>(), sources = new Map<string, string>();
  // Index identities only. Selected source files are still independently
  // reloaded and digest-verified on every read; unrelated FEM blobs are not
  // repeatedly parsed merely to find a study/CAD parameter.
  const studyJobs = new Map<string, string>(), parameterJobs = new Map<string, string>();
  function indexSource(value: any) {
    studyJobs.set(value.request.studyId, value.result.jobId);
    if (!parameterJobs.has(value.parameter.projectRevision)) {
      parameterJobs.set(value.parameter.projectRevision, value.result.jobId);
    }
  }
  async function source(jobId: string) {
    const hash = await catalog.readPinned('evidence', 'source-state:' + jobId);
    assert(hash && sources.get(jobId) === hash, 'known independent completion source');
    const value = await readObject(hash);
    assert.equal(value.result.jobId, jobId);
    return value;
  }
  async function registerSource(value: any) {
    const jobId = value.result.jobId;
    const hash = await pinObject('source-state:' + jobId, value);
    sources.set(jobId, hash);
    indexSource(value);
  }
  // This original job is reopened against its already recorded completion pin,
  // never solved again. Host source state is restored from that authenticated
  // immutable completion, not reconstructed from numerical summaries.
  assert.equal(await catalog.readPinned('refinement', previousJob), previousRoot);
  const previous = JSON.parse(await readFile(join(root, 'blobs', previousRoot.slice(7) + '.json'), 'utf8'));
  assert.equal(digest(previous), previousRoot);
  await registerSource({ request: previous.request, result: previous.result, model: previous.model,
    parameter: previous.parameter, pages: previous.pages, meshDefinition: previous.meshDefinition,
    runtime: previous.runtime });
  refs.set(cases[0].label, { jobId: previousJob, blobDigest: previousRoot,
    recordDigest: previous.recordDigest });
  const revisions = { baseline: fixture.baselineRevision, candidate: fixture.candidateRevision };
  const design = { baseline: fixture.baselineCad, candidate: fixture.candidateCad };
  const archives = {} as Record<'baseline' | 'candidate', OptimizationRefinementArchive>;
  for (const kind of ['baseline', 'candidate'] as const) {
    const authority: TrustedRefinementCaptureSource = {
      async readCurrentProjectRevision() { return revisions[kind]; },
      async readCurrentRuntimeTuple() { return structuredClone(runtime); },
      async readCompletedStudyId(id) { return (await source(id)).request.studyId; },
      async readStudyRequest(id) {
        const jobId = studyJobs.get(id);
        if (!jobId) return null;
        const value = await source(jobId);
        return value.request.studyId === id && value.request.model.projectRevision === revisions[kind]
          ? value.request : null;
      },
      async readCompletedResult(id) { return (await source(id)).result; },
      async readValidatedFemModel(id) { return (await source(id)).model; },
      async readMeshDefinition(id) { return (await source(id)).meshDefinition; },
      async readCadParameter(revision, feature, parameter) {
        if (revision !== revisions[kind] || feature !== 'thickness-extrude' || parameter !== 'thickness') return null;
        const jobId = parameterJobs.get(revision);
        if (!jobId) return null;
        const value = await source(jobId);
        return value.parameter.projectRevision === revision ? value.parameter : null;
      },
      async readCadChangeSet(baselineRevision, candidateRevision) {
        const hash = await catalog.readPinned('evidence', 'cad-single-parameter-change');
        if (!hash) return null;
        const value = await readObject(hash);
        return value.baselineProjectRevision === baselineRevision && value.candidateProjectRevision === candidateRevision
          ? value : null;
      },
      async readStressFieldDescriptor(id, dataset) {
        const row = await source(id);
        return row.pages[0].dataset.datasetId === dataset ? row.pages[0].dataset : null;
      },
      async readStressFieldPage(id, dataset, cursor, limit) {
        assert.equal(limit, 128);
        return (await source(id)).pages.find((page: any) =>
          page.cursor === cursor && page.dataset.datasetId === dataset) ?? null;
      },
    };
    archives[kind] = new MatrixReplayArchive(join(root, 'blobs'), authority, catalog);
  }
  function check(row: any, expected: Case) {
    const record = row.record, cad = design[expected.design];
    assert.equal(record.source.projectRevision, revisions[expected.design], 'exact CAD revision');
    assert.equal(row.parameter.valueMm, cad.thicknessMm, 'exact thickness');
    assert.equal(record.cadVolumeMm3, 400 * cad.thicknessMm, 'unchanged CAD volume');
    assert.equal(row.request.model.domains[0].geometryDigest,
      digest({ cad, generator: 'Gmsh OpenCASCADE Box(1)' }), 'exact original geometry');
    assert.equal(record.mesh.mode, expected.local === null ? 'global' : 'local_diagnostic');
    assert.equal(record.mesh.globalSizeMm, expected.size);
    assert.equal(record.mesh.localSizeMm, expected.local);
    assert.equal(record.mesh.nodeCount, expected.nodes, 'historical node count discrepancy');
    assert.equal(record.mesh.elementCount, expected.elements, 'historical element count discrepancy');
    assert(Math.abs(record.rawMaximumStressMPa - expected.stress) <= 1e-12, 'historical raw-maximum discrepancy');
    assert(record.peakPositionAnalysisMm.every((value: number, axis: number) =>
      Math.abs(value - expected.peak[axis]) <= 1e-10), 'historical peak-location discrepancy');
    assert.equal(digest(row.runtime), digest(runtime), 'exact actual runtime');
    const globalDefinition = { mode: 'independent-domain-composition',
      domainIds: ['bar'], mesh: row.request.mesh, sharedTopologyInteractionIds: [] };
    const localDefinition = { localField: { globalSizeMm: 4, localSizeMm: expected.local,
      xMaxMm: 5, yMaxMm: 10, zMaxMm: cad.thicknessMm }, requestMesh: row.request.mesh };
    assert.equal(digest(row.meshDefinition.definition),
      digest(expected.local === null ? globalDefinition : localDefinition), 'exact refinement definition');
    assert.equal(record.mesh.optionsDigest, digest(row.meshDefinition.definition));
  }
  check(await archives.baseline.readRefinement(previousJob), cases[0]);
  await pinObject('case:' + cases[0].label, { label: cases[0].label, ...refs.get(cases[0].label) });
  let regenerated = 0;
  for (const expected of cases.slice(1)) {
    const pinned = await catalog.readPinned('evidence', 'case:' + expected.label);
    if (pinned) {
      const ref = await readObject(pinned);
      const sourceRoot = await catalog.readPinned('evidence', 'source-state:' + ref.jobId);
      assert(sourceRoot, 'archived case source missing');
      sources.set(ref.jobId, sourceRoot);
      indexSource(await source(ref.jobId));
      refs.set(expected.label, ref);
      check(await archives[expected.design].readRefinement(ref.jobId), expected);
      continue;
    }
    assert(!fixture.replayOnly, 'required real case missing; replay cannot solve');
    const solved = expected.local === null
      ? await fixture.solve(design[expected.design], revisions[expected.design], expected.label, expected.size)
      : await fixture.localDiagnostic(design[expected.design], revisions[expected.design],
        expected.label, expected.local, true);
    const jobId = solved.result.jobId, dataset = solved.field.descriptor.datasetId;
    const pages: any[] = [];
    await readVerifiedOptimizationStressField(jobId, dataset, async (cursor, limit) => {
      const page = await fixture.solver.getFieldDataset(jobId, dataset, cursor, limit);
      pages.push(structuredClone(page)); return page;
    });
    const meshDefinition = solved.meshDefinition ?? { mode: 'global', globalSizeMm: expected.size, localSizeMm: null,
      definition: { mode: 'independent-domain-composition', domainIds: ['bar'],
        mesh: solved.request.mesh, sharedTopologyInteractionIds: [] } };
    await registerSource({ request: solved.request, result: solved.result, model: solved.model,
      parameter: solved.parameter, pages, meshDefinition, runtime });
    // Capture before progressing to another case; discrepancies leave the
    // authentic record retained but do NOT publish a case/complete manifest.
    const pin = await archives[expected.design].captureCompletedRefinement(jobId);
    const row = await archives[expected.design].readRefinement(jobId);
    check(row, expected);
    const ref = { label: expected.label, jobId, ...pin };
    await pinObject('case:' + expected.label, ref);
    refs.set(expected.label, ref);
    regenerated++;
    console.log(JSON.stringify({ event: 'archived', ...ref, nodes: row.record.mesh.nodeCount,
      elements: row.record.mesh.elementCount, stressMPa: row.record.rawMaximumStressMPa,
      stressDifferenceMPa: row.record.rawMaximumStressMPa - expected.stress }));
  }
  assert.equal(refs.size, 10);
  const base = await archives.baseline.readRefinement(refs.get('baseline-g2').jobId);
  const candidate = await archives.candidate.readRefinement(refs.get('candidate-g2').jobId);
  const change = { schema: 'tunacad-cad-single-parameter-change/0.1',
    baselineProjectRevision: fixture.baselineRevision, candidateProjectRevision: fixture.candidateRevision,
    baselineModelDigest: base.request.model.modelDigest, candidateModelDigest: candidate.request.model.modelDigest,
    changedParameter: { domainId: 'bar', partId: 'bar-part', bodyId: 'bar-body',
      featureId: 'thickness-extrude', parameterId: 'thickness', fromMm: 10, toMm: 9, unit: 'mm' },
    otherChanges: false };
  assert.deepEqual(Object.keys(fixture.candidateCad).filter(key =>
    fixture.candidateCad[key] !== fixture.baselineCad[key]), ['thicknessMm']);
  await pinObject('cad-single-parameter-change', change);
  const baseline = sealOptimizationFoundation({
    schema: 'tunacad-optimization-foundation/0.1', source: base.record.source,
    variable: { kind: 'cad_length', featureId: 'thickness-extrude', parameterId: 'thickness',
      baselineMm: 10, minimumMm: 8, maximumMm: 12, unit: 'mm',
      snapshotDigest: digest(base.parameter), provenance: base.parameter.provenance },
    objective: { kind: 'minimize_domain_volume', domainId: 'bar', baselineVolumeMm3: 4000, unit: 'mm^3' },
    constraint: { kind: 'domain_von_mises_upper_bound', domainId: 'bar', semanticReferenceId: 'load-face',
      stressFieldDatasetId: base.record.source.stressFieldDatasetId,
      baselineStressMPa: base.record.rawMaximumStressMPa, upperBoundMPa: 2, unit: 'MPa' },
  });
  const candidateInput = sealOptimizationCandidate({
    schema: 'tunacad-optimization-candidate/0.1', baselineInputDigest: baseline.inputDigest,
    cadChangeSetDigest: digest(change), source: candidate.record.source,
    variable: { featureId: 'thickness-extrude', parameterId: 'thickness', valueMm: 9, unit: 'mm',
      snapshotDigest: digest(candidate.parameter), provenance: candidate.parameter.provenance },
    objective: { kind: 'minimize_domain_volume', domainId: 'bar', volumeMm3: 3600, unit: 'mm^3' },
    constraint: { kind: 'domain_von_mises_upper_bound', domainId: 'bar', semanticReferenceId: 'load-face',
      stressFieldDatasetId: candidate.record.source.stressFieldDatasetId,
      observedStressMPa: candidate.record.rawMaximumStressMPa, unit: 'MPa' },
  });
  const br = archives.baseline.readers(), cr = archives.candidate.readers();
  const comparison = await compareOptimizationCandidate(baseline, candidateInput, br, cr);
  const lane = (kind: string, row: any) => ({
    selectedSourceDigest: digest(row.record.source),
    global: cases.filter(item => item.design === kind && item.local === null).map(item => {
      const ref = refs.get(item.label); return { jobId: ref.jobId, recordDigest: ref.recordDigest };
    }),
    diagnostics: cases.filter(item => item.design === kind && item.local !== null).map(item => {
      const ref = refs.get(item.label); return { jobId: ref.jobId, recordDigest: ref.recordDigest };
    }),
  });
  const evidence = { schema: 'tunacad-optimization-numerical-evidence/0.1',
    evidenceId: 'sim9-optimization-authentic-ten-record-matrix', policy: 'raw-maximum-stability/1',
    runtime, baselineInputDigest: baseline.inputDigest, candidateInputDigest: candidateInput.inputDigest,
    comparisonDigest: digest(comparison), baseline: lane('baseline', base), candidate: lane('candidate', candidate) };
  const evidenceDigest = await archives.baseline.pinCompletedEvidence(evidence, archives.candidate);
  console.log(JSON.stringify({ event: 'complete-manifest-pinned', evidenceDigest,
    records: 10, solverRunsThisInvocation: regenerated }));
  const admission = await archives.baseline.admit(evidence.evidenceId, baseline, candidateInput, archives.candidate);
  console.log(JSON.stringify({ event: 'admission-replayed', classification: admission.classification,
    numericalEvidenceGate: admission.numericalEvidenceGate }));
  assert.equal(admission.nominalFeasible, true);
  assert.equal(admission.robustFeasible, false);
  assert.equal(admission.numericalEvidenceGate, 'FAIL');
  assert.equal(admission.classification, 'nominal_only_insufficient_numerical_evidence');
  assert.equal(admission.objectiveImprovementMm3, 400);
  assert.deepEqual(admission.candidate.reasons,
    ['GLOBAL_STRESS_UNSTABLE', 'LOCAL_STRESS_UNSTABLE', 'PEAK_APPROACHES_CRITICAL_REGION', 'REFINEMENT_CHANGE_EXCEEDS_MARGIN']);
  const allRecords = [];
  for (const expected of cases) {
    const ref = refs.get(expected.label), archive = archives[expected.design], reader = archive.readers();
    const row = await archive.readRefinement(ref.jobId); check(row, expected);
    assert.equal(await catalog.readPinned('refinement', ref.jobId), ref.blobDigest);
    assert.equal(digest(await reader.readRefinementRecord(ref.jobId)), ref.recordDigest);
    const field = await readVerifiedOptimizationStressField(ref.jobId, row.record.source.stressFieldDatasetId,
      (cursor, limit) => reader.readStressFieldPage(ref.jobId, row.record.source.stressFieldDatasetId, cursor, limit));
    assert.equal(field.descriptor.datasetDigest, row.record.source.stressFieldDatasetDigest);
    const mesh = await reader.readMeshSummary(ref.jobId) as any;
    assert.equal(mesh.nodeCount, expected.nodes); assert.equal(mesh.elementCount, expected.elements);
    allRecords.push({ ...ref, requestDigest: row.record.source.requestDigest,
      resultDigest: row.record.source.resultDigest, fieldDigest: row.record.source.stressFieldDatasetDigest,
      runtime: row.runtime, projectRevision: row.record.source.projectRevision,
      nodes: expected.nodes, elements: expected.elements, rawMaximumStressMPa: row.record.rawMaximumStressMPa,
      peak: row.peak, stressDifferenceMPa: row.record.rawMaximumStressMPa - expected.stress });
  }
  const report = { schema: 'tunacad-sim9-optimization-authentic-matrix-replay/0.1',
    baseline, candidate: candidateInput, evidence, evidenceDigest, comparison, admission, allRecords,
    trustedReaderReplay: 'PASS', completeManifest: 'PASS', baselineG4Reused: true,
    allowedNewSolves: 9, providerAdmission: 'closed', engineeringUsePermitted: false };
  const reportDigest = await pinObject('complete-authentic-matrix-report', report);
  console.log(JSON.stringify({ status: 'PASS', regenerated, solverRuns: regenerated, reportDigest, ...report }));
}
