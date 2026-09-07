import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as z from 'zod/v4';
import { loadExternalPipeline } from '../simulation-bridge/providers.mts';

const lane = z.object({
  id: z.string().min(1), category: z.enum(['mechanics', 'governance']), state: z.enum(['pending', 'passed', 'failed']),
  acceptance: z.string().min(1), command: z.string().nullable(), evidence: z.record(z.string(), z.unknown()).nullable(),
}).strict();
const schema = z.object({
  schema: z.literal('tunacad-simulation-qualification-matrix/1.0'), matrixId: z.string().min(1), scope: z.string().min(1),
  environment: z.object({ os: z.literal('win32'), architecture: z.literal('x64'), nodeMajor: z.literal(24), gmshVersion: z.literal('4.15.2'), calculixVersion: z.literal('2.16') }).strict(),
  qualification: z.object({ status: z.literal('proof_of_concept'), engineeringUsePermitted: z.literal(false), recordedAt: z.iso.date() }).strict(),
  promotionPolicy: z.object({ requiredLaneIds: z.array(z.string()).min(1), requiresAllPassed: z.literal(true), requiresEngineeringReview: z.literal(true) }).strict(),
  lanes: z.array(lane).min(1),
}).strict();

const matrix = schema.parse(JSON.parse(await readFile(new URL('../qualification/sim3-experimental-windows-gmsh-4.15.2-calculix-2.16.json', import.meta.url), 'utf8')));
const byId = new Map(matrix.lanes.map(entry => [entry.id, entry]));
assert.equal(byId.size, matrix.lanes.length, 'SIM-3 lane IDs must be unique.');
for (const id of matrix.promotionPolicy.requiredLaneIds) assert.ok(byId.has(id), `Required SIM-3 lane "${id}" is missing.`);
for (const entry of matrix.lanes) {
  if (entry.state === 'passed') {
    assert.equal(entry.command, 'npm run test:sim3-benchmarks', `Passed SIM-3 lane "${entry.id}" must use the reproducible benchmark command.`);
    assert.ok(entry.evidence && Object.keys(entry.evidence).length > 0, `Passed SIM-3 lane "${entry.id}" requires evidence.`);
  } else assert.equal(entry.evidence, null, `Non-passing SIM-3 lane "${entry.id}" cannot retain passing evidence.`);
}
assert.equal(byId.get('independent-engineering-review')?.state, 'pending');
assert.deepEqual(matrix.promotionPolicy.requiredLaneIds.filter(id => byId.get(id)?.state !== 'passed'), ['independent-engineering-review']);

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (gmsh && calculix) {
  const pipeline = await loadExternalPipeline(gmsh, calculix);
  assert.equal(pipeline.readiness.ready, true);
  assert.equal(pipeline.readiness.meshing.runtimeVersion, matrix.environment.gmshVersion);
  assert.equal(pipeline.readiness.solving.runtimeVersion, matrix.environment.calculixVersion);
  assert.notEqual(pipeline.provider?.capabilities.qualification.evidence?.matrixId, matrix.matrixId, 'Experimental SIM-3 evidence must not replace the advertised SIM-2 qualification matrix.');
  assert.equal(pipeline.provider?.capabilities.qualification.engineeringUsePermitted, false);
}

console.log('SIM-3 experimental matrix is valid; all four automated lanes pass and independent engineering review remains pending.');
