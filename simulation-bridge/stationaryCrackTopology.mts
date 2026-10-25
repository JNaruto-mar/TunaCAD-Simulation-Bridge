import * as z from 'zod/v4';
import { digest } from './stableDigest.mts';

export const fractureId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/);
export const fractureDigest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const finite = (min: number, max: number) => z.number().finite().min(min).max(max);
export const point3 = z.tuple([finite(-1e6, 1e6), finite(-1e6, 1e6), finite(-1e6, 1e6)]);
export type Vec3 = [number, number, number];
export const dot = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i], 0);
export const sub = (a: number[], b: number[]): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const cross = (a: number[], b: number[]): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: number[]) => Math.hypot(...a);
export function requireFracture(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new Error('STATIONARY_FRACTURE_INVALID: ' + detail);
}

/** Caller context must ultimately come from the approved source resolver, not from browser claims. */
export const crackSourceSchema = z.object({
  workspaceId: fractureId, analysisId: fractureId, parentSolidId: fractureId, occurrenceId: fractureId,
  projectRevision: fractureId, geometryDigest: fractureDigest, occurrenceTransformDigest: fractureDigest,
}).strict();
export type CrackSource = z.infer<typeof crackSourceSchema>;
export const crackDefinitionSchema = z.object({
  schema: z.literal('tunacad-stationary-straight-crack/0.1'), source: crackSourceSchema,
  kind: z.literal('single_centered_straight_through_crack'), units: z.literal('mm'), mode: z.literal('I'),
  fullWidthMm: finite(1, 10000), fullHeightMm: finite(4, 40000), thicknessMm: finite(.1, 100),
  halfLengthMm: finite(.01, 2500), centerAnalysisMm: point3,
  crackDirection: point3, openingNormal: point3, thicknessDirection: point3,
}).strict().superRefine((c, ctx) => {
  if (c.halfLengthMm / c.fullWidthMm > .25 || c.fullHeightMm / c.fullWidthMm < 4
    || c.thicknessMm / c.fullWidthMm > .02 || c.thicknessMm / c.halfLengthMm > .1)
    ctx.addIssue({ code: 'custom', message: 'Outside the bounded center-cracked thin-plate envelope.' });
  if ([c.crackDirection, c.openingNormal, c.thicknessDirection].some(v => Math.abs(norm(v) - 1) > 1e-9)
    || Math.abs(dot(c.crackDirection, c.openingNormal)) > 1e-9
    || norm(sub(cross(c.crackDirection, c.openingNormal), c.thicknessDirection)) > 1e-9)
    ctx.addIssue({ code: 'custom', message: 'Right-handed orthonormal crack frame required.' });
});
export type CrackDefinition = z.infer<typeof crackDefinitionSchema>;
const identitiesSchema = z.object({ surface: fractureId, positiveLip: fractureId, negativeLip: fractureId,
  leftFront: fractureId, rightFront: fractureId }).strict();
const topologySchema = z.object({ schema: z.literal('tunacad-source-bound-crack-topology/0.1'),
  definition: crackDefinitionSchema, crackDigest: fractureDigest, identities: identitiesSchema }).strict();
export type CrackTopology = z.infer<typeof topologySchema>;

/** A digest establishes consistency, never authentication, transfer permission or execution approval. */
export function createCrackTopology(value: unknown): CrackTopology {
  const definition = crackDefinitionSchema.parse(value);
  const crackDigest = digest(definition), key = crackDigest.slice(7);
  const id = (role: string) => `fracture:${key}:${role}`;
  return { schema: 'tunacad-source-bound-crack-topology/0.1', definition, crackDigest,
    identities: { surface: id('surface'), positiveLip: id('lip-positive'), negativeLip: id('lip-negative'),
      leftFront: id('front-left'), rightFront: id('front-right') } };
}

export function validateCrackTopology(value: unknown, currentSource: unknown): CrackTopology {
  const parsed = topologySchema.parse(value), source = crackSourceSchema.parse(currentSource);
  requireFracture(digest(parsed.definition.source) === digest(source), 'stale or unrelated source context');
  requireFracture(digest(parsed) === digest(createCrackTopology(parsed.definition)), 'crack identity or digest mismatch');
  return parsed;
}

export function crackLocal(c: CrackDefinition, point: number[]): Vec3 {
  const v = sub(point, c.centerAnalysisMm);
  return [dot(v, c.crackDirection), dot(v, c.openingNormal), dot(v, c.thicknessDirection)];
}

/** Explicit namespace separation; do not pass fracture lips into geometric-signature FACE matching. */
export function assertOrdinaryFaceReferences(ids: string[]): void {
  requireFracture(ids.length <= 128 && ids.every(id => fractureId.safeParse(id).success && !/^fracture:/i.test(id)),
    'fracture identities cannot be ordinary FACE references');
}
