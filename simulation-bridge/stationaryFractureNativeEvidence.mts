import * as z from 'zod/v4';
import { assertCrackedMeshResourceBounds, crackedMeshGeometrySchema } from '../providers/gmsh/stationaryCrackMesh.mts';
import { crackSourceSchema, fractureDigest, fractureId, norm, point3, requireFracture as check } from './stationaryCrackTopology.mts';
import { modeICodRequestSchema } from './stationaryModeIExtraction.mts';
import { digest } from './stableDigest.mts';

const node = z.number().int().min(0).max(29999);
const facet = z.tuple([node, node, node, node, node, node]);
/** Payload validation is NOT authentication. Only a live owner's opaque handle can admit this payload. */
export const stationaryFractureEvidenceSchema = z.object({
  schema: z.literal('tunacad-stationary-fracture-owned-evidence/0.1'),
  origin: z.enum(['native_owned_process', 'controlled_provider_fixture']),
  jobId: fractureId, requestDigest: fractureDigest, source: crackSourceSchema, sourceDigest: fractureDigest,
  crackDigest: fractureDigest, meshDigest: fractureDigest, fieldDigest: fractureDigest,
  rawMeshDigest: fractureDigest, rawDatDigest: fractureDigest, planDigest: fractureDigest, deckDigest: fractureDigest,
  runtimePinDigest: fractureDigest, approvalBindingDigest: fractureDigest,
  geometry: crackedMeshGeometrySchema,
  endFacets: z.object({ lower: z.array(facet).min(1).max(20000), upper: z.array(facet).min(1).max(20000) }).strict(),
  nodalDisplacements: z.array(z.tuple([node, point3])).min(10).max(30000),
  reactions: z.array(z.tuple([node, point3])).length(3), equilibriumResidualN: z.number().finite().min(0).max(1),
  minimumQuality: z.number().finite().min(.04).max(1), sampling: modeICodRequestSchema,
  diagnostics: z.array(z.string().max(12000)).length(2),
  counts: z.object({ meshes: z.literal(1), solves: z.literal(1), retries: z.literal(0) }).strict(),
  retention: z.literal('test_only_owner_memory_20_minutes_explicit_snapshot'),
  engineeringUsePermitted: z.literal(false), evidenceDigest: fractureDigest,
}).strict();
export type OwnedFractureEvidence = z.infer<typeof stationaryFractureEvidenceSchema>;

export function validateFractureEvidencePayload(value: unknown, expectedOrigin: OwnedFractureEvidence['origin']): OwnedFractureEvidence {
  const raw: any = value;
  assertCrackedMeshResourceBounds(raw?.geometry);
  check(raw && Array.isArray(raw.nodalDisplacements) && raw.nodalDisplacements.length <= 30000
    && raw.nodalDisplacements.every((row: any) => Array.isArray(row) && row.length === 2 && Array.isArray(row[1]) && row[1].length === 3)
    && Array.isArray(raw.geometry?.nodes) && raw.geometry.nodes.length <= 30000
    && Array.isArray(raw.geometry?.elements) && raw.geometry.elements.length <= 15000
    && Array.isArray(raw.endFacets?.lower) && raw.endFacets.lower.length <= 20000
    && Array.isArray(raw.endFacets?.upper) && raw.endFacets.upper.length <= 20000
    && [...raw.endFacets.lower, ...raw.endFacets.upper].every((f: any) => Array.isArray(f) && f.length === 6)
    && Array.isArray(raw.sampling?.stations) && raw.sampling.stations.length <= 32
    && raw.sampling.stations.every((s: any) => Array.isArray(s?.pairs) && s.pairs.length <= 32), 'evidence resource limit');
  const evidence = stationaryFractureEvidenceSchema.parse(value), { evidenceDigest, ...body } = evidence;
  check(evidence.origin === expectedOrigin && evidenceDigest === digest(body)
    && evidence.sourceDigest === digest(evidence.source) && evidence.crackDigest === evidence.geometry.crackDigest
    && evidence.meshDigest === digest({ geometry: evidence.geometry, endFacets: evidence.endFacets })
    && evidence.fieldDigest === digest(evidence.nodalDisplacements), 'native evidence identity, provenance or integrity mismatch');
  const ids = evidence.nodalDisplacements.map(([n]) => n);
  check(ids.length === evidence.geometry.nodes.length && ids.every((n, i) => n === i)
    && new Set(evidence.reactions.map(([n]) => n)).size === 3
    && evidence.reactions.every(([n]) => n < evidence.geometry.nodes.length), 'native evidence field completeness');
  const reactionNorm = norm([0, 1, 2].map(i => evidence.reactions.reduce((sum, [, f]) => sum + f[i], 0)));
  check(Math.abs(reactionNorm - evidence.equilibriumResidualN) <= 1e-8, 'native evidence reaction residual mismatch');
  return evidence;
}
