import assert from 'node:assert/strict';
import {
  analyzeMeshConvergence,
  resolveMeshConvergenceConfiguration,
} from '../src/simulation/meshConvergence.ts';

const configuration = resolveMeshConvergenceConfiguration();
assert.deepEqual(configuration.globalSizeMultipliers, [1.25, 1, 0.8]);
assert.throws(
  () => resolveMeshConvergenceConfiguration({ globalSizeMultipliers: [1, 1, 0.5] }),
  { code: 'SIMULATION_CONVERGENCE_OPTIONS_INVALID' },
);

const request = {
  studyId: 'public-convergence-contract',
  requestDigest: `sha256:${'1'.repeat(64)}`,
  geometry: { geometryDigest: `sha256:${'2'.repeat(64)}`, projectRevision: 'revision-1' },
} as any;
const levels = ([
  ['coarse', 6, 100, 400, 1.08, 110],
  ['medium', 4, 220, 900, 1.02, 103],
  ['fine', 2.8, 480, 2100, 1, 100],
] as const).map(([level, globalSizeMm, nodeCount, elementCount, displacement, stress], index) => ({
  level,
  jobId: `simjob_public-${index}`,
  requestDigest: `sha256:${String(index).repeat(64)}`,
  geometryDigest: request.geometry.geometryDigest,
  globalSizeMm,
  minimumSizeMm: null,
  nodeCount,
  elementCount,
  maximumDisplacementMm: displacement,
  maximumVonMisesStressMPa: stress,
  reactionResultantN: [0, 0, 1000],
  reactionImbalanceRelative: 0,
})) as any;

const report = analyzeMeshConvergence({
  convergenceId: 'simconv_public-contract',
  preparationId: 'simprep_public-contract',
  request,
  invariantStudyDigest: `sha256:${'3'.repeat(64)}`,
  configuration,
  levels,
  requestedAt: '2026-09-06T00:00:00.000Z',
  completedAt: '2026-09-06T00:01:00.000Z',
});
assert.equal(report.status, 'converged');
assert.equal(report.review.engineeringUsePermitted, false);
assert.equal(report.checks.every(check => check.status === 'pass'), true);

const nonMonotonic = structuredClone(levels);
nonMonotonic[2].elementCount = nonMonotonic[1].elementCount;
assert.equal(analyzeMeshConvergence({
  convergenceId: 'simconv_public-nonmonotonic',
  preparationId: 'simprep_public-contract',
  request,
  invariantStudyDigest: `sha256:${'3'.repeat(64)}`,
  configuration,
  levels: nonMonotonic,
  requestedAt: '2026-09-06T00:00:00.000Z',
  completedAt: '2026-09-06T00:01:00.000Z',
}).status, 'not_converged');

console.log('Public mesh-convergence contract test passed.');
