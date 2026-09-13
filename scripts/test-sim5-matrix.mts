import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as z from 'zod/v4';

const lane = z.object({ id: z.string().min(1), category: z.enum(['mechanics', 'governance']), state: z.enum(['pending', 'passed', 'failed']), acceptance: z.string().min(1), command: z.string().min(1).nullable(), evidence: z.record(z.string(), z.unknown()).nullable() }).strict();
const matrix = z.object({
  schema: z.literal('tunacad-simulation-qualification-matrix/1.0'), matrixId: z.literal('sim5-windows-x64-gmsh-4.15.2-calculix-2.16'), scope: z.string().min(1),
  environment: z.object({ os: z.literal('win32'), architecture: z.literal('x64'), nodeMajor: z.literal(24), gmshVersion: z.literal('4.15.2'), calculixVersion: z.literal('2.16') }).strict(),
  qualification: z.object({ status: z.literal('internally_validated'), engineeringUsePermitted: z.literal(false), recordedAt: z.iso.date() }).strict(),
  promotionPolicy: z.object({ requiredLaneIds: z.array(z.string()).min(1), requiresAllPassed: z.literal(true), requiresEngineeringReview: z.literal(true) }).strict(), lanes: z.array(lane).min(1),
}).strict().parse(JSON.parse(await readFile(new URL('../qualification/sim5-windows-gmsh-4.15.2-calculix-2.16.json', import.meta.url), 'utf8')));
const byId = new Map(matrix.lanes.map(entry => [entry.id, entry]));
assert.equal(byId.size, matrix.lanes.length);
for (const id of matrix.promotionPolicy.requiredLaneIds) assert.ok(byId.has(id), `Missing required SIM-5 lane ${id}.`);
for (const entry of matrix.lanes) entry.state === 'passed'
  ? (assert.ok(entry.command), assert.ok(entry.evidence && Object.keys(entry.evidence).length))
  : assert.equal(entry.evidence, null);
assert.ok(matrix.promotionPolicy.requiredLaneIds.some(id => byId.get(id)?.state === 'pending'));
assert.ok(matrix.lanes.filter(entry => entry.category === 'mechanics').every(entry => entry.state === 'passed'), 'Every automated SIM-5 mechanics lane must pass.');
assert.deepEqual(matrix.lanes.filter(entry => entry.state === 'pending').map(entry => entry.id), ['independent-engineering-review']);
console.log('SIM-5 qualification matrix is internally validated and remains non-qualified.');
