import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as z from 'zod/v4';
import { loadExternalPipeline } from '../simulation-bridge/providers.mts';

const lane = z.object({ id: z.string().min(1), category: z.enum(['mechanics', 'governance']), state: z.enum(['pending', 'passed', 'failed']), acceptance: z.string().min(1), command: z.string().nullable(), evidence: z.record(z.string(), z.unknown()).nullable() }).strict();
const reviewEvidence = z.object({
  decision: z.literal('approved'), reviewerName: z.string().min(1), reviewerOrganization: z.string().min(1), reviewerQualification: z.string().min(1),
  reviewedAt: z.iso.date(), matrixId: z.literal('sim4a-windows-x64-gmsh-4.15.2-calculix-2.16'), reviewedCommit: z.string().regex(/^[a-f0-9]{40}$/), reportDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict();
assert.throws(() => reviewEvidence.parse({ decision: 'approved' }), 'Incomplete SIM-4A sign-off must fail closed.');
const schema = z.object({
  schema: z.literal('tunacad-simulation-qualification-matrix/1.0'), matrixId: z.literal('sim4a-windows-x64-gmsh-4.15.2-calculix-2.16'), scope: z.string().min(1),
  environment: z.object({ os: z.literal('win32'), architecture: z.literal('x64'), nodeMajor: z.literal(24), gmshVersion: z.literal('4.15.2'), calculixVersion: z.literal('2.16') }).strict(),
  qualification: z.object({ status: z.enum(['proof_of_concept', 'qualified']), engineeringUsePermitted: z.boolean(), recordedAt: z.iso.date() }).strict(),
  promotionPolicy: z.object({ requiredLaneIds: z.array(z.string()).min(1), requiresAllPassed: z.literal(true), requiresEngineeringReview: z.literal(true) }).strict(), lanes: z.array(lane).min(1),
}).strict();
const matrix = schema.parse(JSON.parse(await readFile(new URL('../qualification/sim4a-windows-gmsh-4.15.2-calculix-2.16.json', import.meta.url), 'utf8')));
const byId = new Map(matrix.lanes.map(entry => [entry.id, entry]));
assert.equal(byId.size, matrix.lanes.length);
for (const id of matrix.promotionPolicy.requiredLaneIds) assert.ok(byId.has(id), `Required SIM-4A lane "${id}" is missing.`);
for (const entry of matrix.lanes) {
  if (entry.state === 'passed') { assert.ok(entry.command, `Passed lane "${entry.id}" requires a command.`); assert.ok(entry.evidence && Object.keys(entry.evidence).length, `Passed lane "${entry.id}" requires evidence.`); }
  else assert.equal(entry.evidence, null, `Non-passing lane "${entry.id}" cannot retain evidence.`);
}
const review = byId.get('independent-engineering-review');
if (review?.state === 'passed') reviewEvidence.parse(review.evidence);
const pending = matrix.promotionPolicy.requiredLaneIds.filter(id => byId.get(id)?.state !== 'passed');
const computedStatus = pending.length ? 'proof_of_concept' : 'qualified';
assert.equal(matrix.qualification.status, computedStatus); assert.equal(matrix.qualification.engineeringUsePermitted, computedStatus === 'qualified');

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE; const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (gmsh && calculix) {
  const pipeline = await loadExternalPipeline(gmsh, calculix); const qualification = pipeline.providerV2!.capabilities.qualification;
  assert.equal(qualification.status, matrix.qualification.status); assert.equal(qualification.engineeringUsePermitted, matrix.qualification.engineeringUsePermitted);
  assert.equal(qualification.evidence?.matrixId, matrix.matrixId); assert.deepEqual(qualification.evidence?.pendingLaneIds, pending);
}
console.log(`SIM-4A qualification matrix is valid and remains ${computedStatus}; pending required lanes: ${pending.join(', ') || 'none'}.`);
