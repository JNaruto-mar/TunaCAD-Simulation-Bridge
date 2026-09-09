import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as z from 'zod/v4';

const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const lane = z.object({
  id: z.string().min(1), category: z.enum(['mechanics', 'governance']), state: z.enum(['pending', 'passed', 'failed']),
  acceptance: z.string().min(1), command: z.string().min(1).nullable(), evidence: z.record(z.string(), z.unknown()).nullable(),
}).strict();
const reviewEvidence = z.object({
  decision: z.literal('approved'), reviewerName: z.string().min(1), reviewerOrganization: z.string().min(1), reviewerQualification: z.string().min(1),
  reviewedAt: z.iso.date(), matrixId: z.literal('sim4b-windows-x64-gmsh-4.15.2-calculix-2.16'),
  reviewedCommit: z.string().regex(/^[a-f0-9]{40}$/), reportDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict();
assert.throws(() => reviewEvidence.parse({ decision: 'approved' }), 'Incomplete SIM-4B sign-off must fail closed.');
const matrixSchema = z.object({
  schema: z.literal('tunacad-simulation-qualification-matrix/1.0'),
  matrixId: z.literal('sim4b-windows-x64-gmsh-4.15.2-calculix-2.16'), scope: z.string().min(1),
  environment: z.object({ os: z.literal('win32'), architecture: z.literal('x64'), nodeMajor: z.literal(24), gmshVersion: z.literal('4.15.2'), calculixVersion: z.literal('2.16') }).strict(),
  qualification: z.object({ status: z.enum(['proof_of_concept', 'qualified']), engineeringUsePermitted: z.boolean(), recordedAt: z.iso.date() }).strict(),
  promotionPolicy: z.object({ requiredLaneIds: z.array(z.string()).min(1), requiresAllPassed: z.literal(true), requiresEngineeringReview: z.literal(true) }).strict(),
  lanes: z.array(lane).min(1),
}).strict();
const fixtureSchema = z.object({
  schema: z.literal('tunacad-simulation-benchmark-fixture/1.0'), fixtureId: z.literal('sim4b-bolted-bracket-rigid-connectors'),
  status: z.literal('experimental'), description: z.string().min(1),
  geometry: z.object({ baseSizeMm: vector, webSizeMm: vector, webTranslationAnalysisMm: vector }).strict(),
  material: z.object({ youngsModulusMPa: z.number().positive(), poissonRatio: z.number().min(0).lt(.5), densityKgM3: z.number().positive() }).strict(),
  load: z.object({ referencePointAnalysisMm: vector, forceN: vector, momentNmm: vector }).strict(),
  support: z.object({ referencePointAnalysisMm: vector, translationMm: vector, rotationRad: vector }).strict(),
  expected: z.object({ supportReactionForceN: vector, supportReactionMomentNmm: vector, forceAbsoluteToleranceN: z.number().positive(), momentAbsoluteToleranceNmm: z.number().positive(), minimumNonzeroDisplacementMm: z.number().positive() }).strict(),
  assumptions: z.array(z.string().min(1)).min(1), command: z.literal('npm run test:sim4b-bracket'),
}).strict();

const matrix = matrixSchema.parse(JSON.parse(await readFile(new URL('../qualification/sim4b-windows-gmsh-4.15.2-calculix-2.16.json', import.meta.url), 'utf8')));
const fixture = fixtureSchema.parse(JSON.parse(await readFile(new URL('../qualification/sim4b-bolted-bracket-rigid-connectors.json', import.meta.url), 'utf8')));
const byId = new Map(matrix.lanes.map(entry => [entry.id, entry]));
assert.equal(byId.size, matrix.lanes.length, 'SIM-4B lane IDs must be unique.');
for (const id of matrix.promotionPolicy.requiredLaneIds) assert.ok(byId.has(id), `Required SIM-4B lane "${id}" is missing.`);
for (const entry of matrix.lanes) {
  if (entry.state === 'passed') {
    assert.ok(entry.command, `Passed lane "${entry.id}" requires a command.`);
    assert.ok(entry.evidence && Object.keys(entry.evidence).length, `Passed lane "${entry.id}" requires evidence.`);
  } else {
    assert.equal(entry.evidence, null, `Non-passing lane "${entry.id}" cannot retain evidence.`);
  }
}
const bracketLane = byId.get('bolted-bracket-rigid-connectors')!;
assert.equal(bracketLane.command, fixture.command);
assert.deepEqual(bracketLane.evidence?.expectedSupportReactionForceN, fixture.expected.supportReactionForceN);
assert.deepEqual(bracketLane.evidence?.expectedSupportReactionMomentNmm, fixture.expected.supportReactionMomentNmm);
assert.equal(bracketLane.evidence?.forceAbsoluteToleranceN, fixture.expected.forceAbsoluteToleranceN);
assert.equal(bracketLane.evidence?.momentAbsoluteToleranceNmm, fixture.expected.momentAbsoluteToleranceNmm);
const failureLane = byId.get('disconnected-underconstrained-failures')!;
assert.equal(failureLane.command, 'npm run test:sim4b-failures');
assert.equal(failureLane.evidence?.disconnectedFailure, 'SIMULATION_MODEL_DISCONNECTED');
assert.equal(failureLane.evidence?.underconstrainedFailure, 'SIMULATION_MODEL_UNDERCONSTRAINED');
assert.equal(failureLane.evidence?.requiredRigidBodyRank, 6);
assert.equal(failureLane.evidence?.resultQuarantined, true);
assert.equal(failureLane.evidence?.solverLaunchBlocked, true);
assert.equal(failureLane.evidence?.independentlySupportedDisconnectedDomains, 'admitted');
const review = byId.get('independent-engineering-review');
if (review?.state === 'passed') reviewEvidence.parse(review.evidence);
const pending = matrix.promotionPolicy.requiredLaneIds.filter(id => byId.get(id)?.state !== 'passed');
const computedStatus = pending.length ? 'proof_of_concept' : 'qualified';
assert.equal(matrix.qualification.status, computedStatus);
assert.equal(matrix.qualification.engineeringUsePermitted, computedStatus === 'qualified');

console.log(`SIM-4B connector qualification matrix is valid and remains ${computedStatus}; pending required lanes: ${pending.join(', ') || 'none'}.`);
