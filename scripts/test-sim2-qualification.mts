import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as z from 'zod/v4';
import { loadExternalPipeline } from '../simulation-bridge/providers.mts';

const lane = z.object({
  id: z.string().min(1), category: z.enum(['benchmark', 'mechanics', 'lifecycle', 'security', 'resource', 'governance']),
  state: z.enum(['pending', 'passed', 'failed']), acceptance: z.string().min(1), command: z.string().nullable(), evidence: z.record(z.string(), z.unknown()).nullable(),
}).strict();
const independentReviewEvidence = z.object({
  decision: z.literal('approved'),
  reviewerName: z.string().min(1),
  reviewerOrganization: z.string().min(1),
  reviewerQualification: z.string().min(1),
  reviewedAt: z.iso.date(),
  matrixId: z.string().min(1),
  reviewedCommit: z.string().regex(/^[a-f0-9]{40}$/),
  reportDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict();
assert.throws(() => independentReviewEvidence.parse({ decision: 'approved' }), 'Incomplete manual sign-off evidence must fail closed.');
const schema = z.object({
  schema: z.literal('tunacad-simulation-qualification-matrix/1.0'), matrixId: z.string().min(1), scope: z.string().min(1),
  environment: z.object({ os: z.literal('win32'), architecture: z.literal('x64'), nodeMajor: z.literal(24), gmshVersion: z.string(), calculixVersion: z.string() }).strict(),
  qualification: z.object({ status: z.enum(['proof_of_concept', 'qualified']), engineeringUsePermitted: z.boolean(), recordedAt: z.iso.date() }).strict(),
  promotionPolicy: z.object({ requiredLaneIds: z.array(z.string()).min(1), requiresAllPassed: z.literal(true), requiresEngineeringReview: z.literal(true) }).strict(),
  lanes: z.array(lane).min(1),
}).strict();

const matrix = schema.parse(JSON.parse(await readFile(new URL('../qualification/sim2-windows-gmsh-4.15.2-calculix-2.16.json', import.meta.url), 'utf8')));
const byId = new Map(matrix.lanes.map(entry => [entry.id, entry]));
assert.equal(byId.size, matrix.lanes.length, 'Qualification lane IDs must be unique.');
for (const id of matrix.promotionPolicy.requiredLaneIds) assert.ok(byId.has(id), `Required qualification lane "${id}" is missing.`);
for (const entry of matrix.lanes) {
  if (entry.state === 'passed') {
    assert.ok(entry.command, `Passed lane "${entry.id}" requires a reproducible command.`);
    assert.ok(entry.evidence && Object.keys(entry.evidence).length > 0, `Passed lane "${entry.id}" requires evidence.`);
  } else {
    assert.equal(entry.evidence, null, `Non-passing lane "${entry.id}" cannot retain passing evidence.`);
  }
}
const reviewLane = byId.get('independent-engineering-review');
if (reviewLane?.state === 'passed') {
  const review = independentReviewEvidence.parse(reviewLane.evidence);
  assert.equal(review.matrixId, matrix.matrixId, 'Independent review evidence must name this exact matrix.');
}
const pending = matrix.promotionPolicy.requiredLaneIds.filter(id => byId.get(id)?.state !== 'passed');
assert.ok(matrix.promotionPolicy.requiredLaneIds.includes('independent-engineering-review'), 'Engineering qualification requires an explicit independent-review gate.');
const computedStatus = pending.length === 0 ? 'qualified' : 'proof_of_concept';
assert.equal(matrix.qualification.status, computedStatus, 'Declared qualification status does not match required lane evidence.');
assert.equal(matrix.qualification.engineeringUsePermitted, computedStatus === 'qualified', 'Engineering-use permission must fail closed until every required lane passes.');

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (gmsh && calculix) {
  const pipeline = await loadExternalPipeline(gmsh, calculix);
  assert.equal(pipeline.readiness.ready, true);
  assert.equal(pipeline.readiness.meshing.runtimeVersion, matrix.environment.gmshVersion);
  assert.equal(pipeline.readiness.solving.runtimeVersion, matrix.environment.calculixVersion);
  const quotaSupportedHost = process.platform === matrix.environment.os && process.arch === matrix.environment.architecture;
  assert.equal(pipeline.provider?.capabilities.qualification.status, quotaSupportedHost ? matrix.qualification.status : 'unsupported');
  assert.equal(pipeline.provider?.capabilities.qualification.engineeringUsePermitted, matrix.qualification.engineeringUsePermitted);
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
  if (process.platform === matrix.environment.os && process.arch === matrix.environment.architecture && nodeMajor === matrix.environment.nodeMajor) {
    assert.equal(pipeline.provider?.capabilities.qualification.evidence?.matrixId, matrix.matrixId);
    assert.deepEqual(pipeline.provider?.capabilities.qualification.evidence?.pendingLaneIds, pending, 'Advertised pending qualification lanes must match the matrix gate.');
  } else {
    assert.equal(pipeline.provider?.capabilities.qualification.evidence, null, 'A provider running outside the recorded OS/architecture/Node tuple must not inherit matrix evidence.');
  }
}

console.log(`SIM-2 qualification matrix is valid and remains ${computedStatus}; pending required lanes: ${pending.join(', ') || 'none'}.`);
