import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { FileOptimizationArchiveCatalog, OptimizationRefinementArchive,
  type TrustedRefinementCaptureSource } from '../simulation-bridge/optimizationRefinementArchive.mts';
import { readVerifiedOptimizationStressField } from '../simulation-bridge/optimizationVerifiedStressField.mts';

// This pin is the actual completion root produced by the one-solve capture
// fixture, also recorded in the development evidence. It is NOT a caller hash
// accepted by the production API. The blob remains a local, uncommitted asset.
const authenticRoot = 'sha256:2b94d8924fcb3c63b7ccd93c2a3bf1f2ded99c7f62854a609f0deeac166f81e6';
const root = process.env.TUNACAD_OPTIMIZATION_EVIDENCE_DIRECTORY;
if (!root) throw new Error('Set the local TUNACAD_OPTIMIZATION_EVIDENCE_DIRECTORY from the captured fixture.');
const path = join(root, 'blobs', authenticRoot.slice(7) + '.json');
const completed = JSON.parse(await readFile(path, 'utf8'));
assert.equal(digest(completed), authenticRoot, 'authentic provider completion pin');
const live = structuredClone(completed); // Simulated independent host registry for mutation negatives.
const jobId = completed.result.jobId;
const authority: TrustedRefinementCaptureSource = {
  async readCurrentProjectRevision() { return live.request.model.projectRevision; },
  async readCurrentRuntimeTuple() { return structuredClone(live.runtime); },
  async readCompletedStudyId(id) { assert.equal(id, jobId); return live.request.studyId; },
  async readStudyRequest() { return structuredClone(live.request); },
  async readCompletedResult() { return structuredClone(live.result); },
  async readCadParameter() { return structuredClone(live.parameter); },
  async readCadChangeSet() { return null; },
  async readValidatedFemModel() { return structuredClone(live.model); },
  async readMeshDefinition() { return structuredClone(live.meshDefinition); },
  async readStressFieldDescriptor() { return structuredClone(live.pages[0].dataset); },
  async readStressFieldPage(_id, dataset, cursor) {
    return structuredClone(live.pages.find((page: any) =>
      page.dataset.datasetId === dataset && page.cursor === cursor) ?? null);
  },
};
const catalog = new FileOptimizationArchiveCatalog(join(root, 'completion-ledger'));
assert.equal(await catalog.readPinned('refinement', jobId), authenticRoot);
const archive = new OptimizationRefinementArchive(join(root, 'blobs'), authority, catalog);
assert.deepEqual(await archive.readRefinement(jobId), completed);
assert.deepEqual(await archive.captureCompletedRefinement(jobId),
  { blobDigest: authenticRoot, recordDigest: completed.recordDigest });
const reader = archive.readers();
const verified = await readVerifiedOptimizationStressField(jobId, completed.record.source.stressFieldDatasetId,
  (cursor, limit) => reader.readStressFieldPage(jobId, completed.record.source.stressFieldDatasetId, cursor, limit));
assert.equal(verified.descriptor.datasetDigest, completed.record.source.stressFieldDatasetDigest);
let rejected = 0;
for (const mutate of [
  (row: any) => { row.request.model.projectRevision = 'mutated'; },
  (row: any) => { row.request.requestDigest = digest('another-request'); },
  (row: any) => { row.result.status = 'cancelled'; },
  (row: any) => { row.result.convergence.status = 'not_converged'; },
  (row: any) => { row.result.jobId = 'another-job'; },
  (row: any) => { row.parameter.valueMm = 9; },
  (row: any) => { row.parameter.provenance.revision = 'other-candidate'; },
  (row: any) => { row.runtime.calculix = '2.17'; },
  (row: any) => { row.runtime.gmsh = '4.16'; },
]) {
  mutate(live);
  await assert.rejects(reader.readRefinementRecord(jobId), /ARCHIVE_INVALID/);
  rejected++;
  Object.assign(live, structuredClone(completed));
}
// Blob alterations cannot establish trust even with a newly recomputed
// internal record digest; the independent completion root stays unchanged.
for (const mutate of [
  (row: any) => { row.record.mesh.nodeCount++; },
  (row: any) => { row.model.quality.elementCount++; },
  (row: any) => { row.record.rawMaximumStressMPa += .01; },
  (row: any) => { row.peak.elementIndex++; },
  (row: any) => { row.record.peakPositionAnalysisMm[0] += .1; },
  (row: any) => { row.record.source.projectRevision = 'candidate-other-revision'; },
  (row: any) => { row.pages[0].triangles[0].values[0] += .1; },
  (row: any) => { row.runtime.nodeMajor = 25; },
]) {
  const row = structuredClone(completed); mutate(row); row.recordDigest = digest(row.record);
  try {
    await writeFile(path, JSON.stringify(row));
    await assert.rejects(reader.readMeshSummary(jobId), /ARCHIVE_INVALID/); rejected++;
  } finally { await writeFile(path, JSON.stringify(completed)); }
}
await assert.rejects(reader.readRefinementRecord('mixed-candidate-job'), /ARCHIVE_INVALID/); rejected++;
await assert.rejects(archive.admit('missing-nine-refinement-records', {}, {}, archive), /ARCHIVE_INVALID/); rejected++;
await assert.rejects(catalog.pinOnce('refinement', jobId, digest('resealed-substitution')), /ARCHIVE_INVALID/); rejected++;
assert.deepEqual(await archive.readRefinement(jobId), completed);
console.log(JSON.stringify({ status: 'PASS', solverRuns: 0, authenticRoot,
  exactProviderReplay: true, rejected, fullRealMatrixAdmission: 'PENDING',
  rawMaximumStressConstraintUnchanged: true }));
