import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as z from 'zod/v4';
import { loadExternalPipeline } from '../simulation-bridge/providers.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';

const laneSchema = z.object({
  id: z.string().min(1),
  category: z.enum(['contract', 'adapter', 'mechanics', 'lifecycle', 'governance']),
  state: z.enum(['pending', 'passed', 'failed']),
  acceptance: z.string().min(1),
  command: z.string().nullable(),
  evidence: z.record(z.string(), z.unknown()).nullable(),
}).strict();
const reviewSchema = z.object({
  decision: z.literal('approved'), reviewerName: z.string().min(1), reviewerOrganization: z.string().min(1),
  reviewerQualification: z.string().min(1), independenceStatement: z.string().min(1), reviewedAt: z.iso.date(),
  matrixId: z.string().min(1), reviewedCommit: z.string().regex(/^[a-f0-9]{40}$/),
  reviewedAutomatedEvidenceDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  reportDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict();
const matrixSchema = z.object({
  schema: z.literal('tunacad-simulation-qualification-matrix/1.0'),
  matrixId: z.literal('sim7b-windows-x64-gmsh-4.15.2-calculix-2.16'),
  scope: z.string().min(1), prerequisiteMatrices: z.array(z.string()).min(1),
  environment: z.object({ os: z.literal('win32'), architecture: z.literal('x64'), nodeMajor: z.literal(24), gmshVersion: z.literal('4.15.2'), calculixVersion: z.literal('2.16') }).strict(),
  qualification: z.object({ status: z.enum(['internally_validated', 'independently_reviewed', 'qualified']), engineeringUsePermitted: z.boolean(), recordedAt: z.iso.date() }).strict(),
  promotionPolicy: z.object({ requiredLaneIds: z.array(z.string()).min(1), requiresAllPassed: z.literal(true), requiresEngineeringReview: z.literal(true) }).strict(),
  lanes: z.array(laneSchema).min(1),
}).strict();

const matrix = matrixSchema.parse(JSON.parse(await readFile(new URL('../qualification/sim7b-windows-gmsh-4.15.2-calculix-2.16.json', import.meta.url), 'utf8')));
assert.deepEqual(matrix.prerequisiteMatrices, ['sim2-windows-x64-gmsh-4.15.2-calculix-2.16', 'sim7a-windows-x64-gmsh-4.15.2-calculix-2.16']);
const byId = new Map(matrix.lanes.map(lane => [lane.id, lane]));
assert.equal(byId.size, matrix.lanes.length, 'SIM-7B qualification lane IDs must be unique.');
const requiredIds = ['contract-and-material-admission', 'deterministic-plastic-deck', 'bounded-material-results', 'uniaxial-coupon', 'unload-reload-path', 'mesh-convergence', 'increment-convergence', 'material-lifecycle-quarantine', 'plastic-hinge-path', 'limitations-and-authority', 'independent-engineering-review'];
assert.deepEqual(matrix.promotionPolicy.requiredLaneIds, requiredIds);
for (const entry of matrix.lanes) {
  if (entry.state === 'passed') {
    assert.ok(entry.command, `Passed lane "${entry.id}" requires a reproducible command.`);
    assert.ok(entry.evidence && Object.keys(entry.evidence).length, `Passed lane "${entry.id}" requires evidence.`);
  } else assert.equal(entry.evidence, null, `Non-passing lane "${entry.id}" cannot retain passing evidence.`);
}
const automatedEvidenceDigest = digest({
  matrixId: matrix.matrixId, scope: matrix.scope, prerequisiteMatrices: matrix.prerequisiteMatrices,
  environment: matrix.environment, promotionPolicy: matrix.promotionPolicy,
  lanes: matrix.lanes.filter(lane => lane.id !== 'independent-engineering-review'),
});
const review = byId.get('independent-engineering-review')!;
if (review.state === 'passed') {
  const evidence = reviewSchema.parse(review.evidence);
  assert.equal(evidence.matrixId, matrix.matrixId);
  assert.equal(evidence.reviewedAutomatedEvidenceDigest, automatedEvidenceDigest, 'SIM-7B review does not bind the current automated evidence.');
}
const pending = matrix.promotionPolicy.requiredLaneIds.filter(id => byId.get(id)?.state !== 'passed');
const failed = matrix.promotionPolicy.requiredLaneIds.filter(id => byId.get(id)?.state === 'failed');
assert.deepEqual(pending.filter(id => id !== 'independent-engineering-review'), []);
const computedStatus = review.state === 'passed' ? 'independently_reviewed' : 'internally_validated';
assert.equal(matrix.qualification.status, computedStatus);
assert.equal(matrix.qualification.engineeringUsePermitted, false);
if (review.state === 'pending') assert.deepEqual(pending, ['independent-engineering-review']);
else assert.deepEqual(pending, []);
assert.deepEqual(failed, []);

const evidence = (id: string) => byId.get(id)!.evidence as any;
const coupon = evidence('uniaxial-coupon');
assert.ok(coupon.elasticPlasticDisplacementMm > coupon.elasticDisplacementMm * 3);
assert.ok(coupon.maximumEquivalentPlasticStrain > 0 && coupon.maximumEnergyDensityMPa > 0 && coupon.totalInternalEnergyNmm > 0);
assert.ok(Math.abs(coupon.reactionForceN + coupon.appliedForceN) <= coupon.maximumReactionErrorN);

const path = evidence('unload-reload-path');
assert.ok(path.minimumBranchRSquared > .9999);
assert.ok(Math.abs(path.unloadingStiffnessNPerMm - path.reloadingStiffnessNPerMm) / path.unloadingStiffnessNPerMm < .02);
assert.ok(path.residualEngineeringStrain > 0 && path.maximumEquivalentPlasticStrain > 0);
assert.ok(path.energyRelativeDifference <= path.maximumEnergyRelativeDifference);

const mesh = evidence('mesh-convergence');
assert.ok(mesh.elementCounts[0] < mesh.elementCounts[1] && mesh.elementCounts[1] < mesh.elementCounts[2]);
for (const history of Object.values(mesh.fineRelativeHistoryChanges) as any[]) for (const key of ['displacement', 'peeq', 'internalEnergy']) assert.ok(history[key] <= mesh.historyLimits[key]);
for (const change of Object.values(mesh.fineCyclicPathChanges) as number[]) assert.ok(change <= mesh.cyclicPathLimit);

const increments = evidence('increment-convergence');
assert.ok(increments.maximumIncrements[0] > increments.maximumIncrements[1] && increments.maximumIncrements[1] > increments.maximumIncrements[2]);
for (const history of Object.values(increments.relativeHistoryChanges) as any[]) for (const changes of Object.values(history) as number[][]) {
  assert.ok(changes[1] <= changes[0], `Increment history did not contract: ${changes}.`);
  assert.ok(changes[1] <= increments.historyLimit);
}
for (const change of Object.values(increments.fineCyclicPathChanges) as number[]) assert.ok(change <= increments.cyclicPathLimit);

const lifecycle = evidence('material-lifecycle-quarantine');
for (const terminal of [lifecycle.nonconvergence, lifecycle.cancellation]) {
  assert.ok(terminal.completeMaterialFramesObserved > 0 && terminal.partialPEEQ > 0 && terminal.partialEnergyDensityMPa > 0 && terminal.partialInternalEnergyNmm > 0);
}
assert.equal(lifecycle.normalizedResultReturned, false); assert.equal(lifecycle.fieldDatasetsReturned, false);
assert.equal(lifecycle.nativeFilesRemoved, true); assert.equal(lifecycle.lateExitQuarantined, true);

const hinge = evidence('plastic-hinge-path');
assert.ok(hinge.monotonicNominalRootStressMPa < hinge.yieldStrengthMPa && hinge.overloadNominalRootStressMPa > hinge.yieldStrengthMPa);
assert.deepEqual(hinge.commonFinalReactionN, [hinge.commonFinalLoadN, hinge.commonFinalLoadN]);
assert.equal(hinge.monotonicMaximumPEEQ, 0);
assert.ok(hinge.overloadRootZoneMaximumPEEQ > 0 && hinge.overloadTransitionZoneMaximumPEEQ === 0 && hinge.overloadFarZoneMaximumPEEQ === 0);
assert.ok(hinge.hingeRotationMagnitudeRatio > 1.05 && hinge.finalInternalEnergyRatio > 1.05);
assert.ok(hinge.observedMaximumReactionEquilibriumErrorN <= hinge.maximumAllowedReactionEquilibriumErrorN);

const authority = evidence('limitations-and-authority');
assert.equal(authority.status, 'internally_validated'); assert.equal(authority.engineeringUsePermitted, false);
for (const limitation of ['reordered_multi_axis_nonproportional_loading', 'multi_domain_material_nonlinearity', 'advanced_constitutive_laws', 'limit_point_continuation', 'non_windows_qualification']) assert.ok(authority.unsupportedClaims.includes(limitation));

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE; const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (gmsh && calculix) {
  const pipeline = await loadExternalPipeline(gmsh, calculix);
  assert.equal(pipeline.readiness.ready, true); assert.ok(pipeline.providerV2);
  assert.equal(pipeline.readiness.meshing.runtimeVersion, matrix.environment.gmshVersion);
  assert.equal(pipeline.readiness.solving.runtimeVersion, matrix.environment.calculixVersion);
  assert.equal(pipeline.providerV2.capabilities.study.nonlinearStatic?.materialNonlinearity, true);
  assert.ok(pipeline.providerV2.capabilities.fieldResults.components.includes('equivalent_plastic_strain'));
  assert.ok(pipeline.providerV2.capabilities.fieldResults.components.includes('strain_energy_density'));
  assert.equal(pipeline.providerV2.capabilities.qualification.engineeringUsePermitted, false);
  assert.equal(pipeline.providerV2.capabilities.qualification.evidence, null, 'SIM-7B matrix must not become an umbrella provider qualification automatically.');
}

const automatedPassed = matrix.lanes.filter(lane => lane.id !== 'independent-engineering-review' && lane.state === 'passed').length;
console.log(`SIM-7B qualification PASS=${automatedPassed} FAIL=${failed.length} PENDING=${pending.join(',')}; status=${computedStatus}; engineeringUsePermitted=${matrix.qualification.engineeringUsePermitted}; automatedEvidenceDigest=${automatedEvidenceDigest}.`);
