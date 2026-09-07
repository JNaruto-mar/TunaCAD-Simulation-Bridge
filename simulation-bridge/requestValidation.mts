import * as z from 'zod/v4';
import type { NeutralSimulationRequest } from '../src/simulation/externalSimulationContracts.ts';
import { digest } from './stableDigest.mts';
import { validateNeutralSimulationRequestV2 } from './v2Validation.mts';

export { digest } from './stableDigest.mts';

// Transport admission for the bounded POC, not a replacement public contract.
const text = z.string().min(1).max(500).regex(/^[^\u0000-\u001f\u007f]*$/);
const number = z.number().finite();
const positive = number.positive();
const vector = z.tuple([number, number, number]);
const surfaceForce = vector.refine(value => Math.hypot(...value) > 1e-14 && Math.hypot(...value) <= 1_000_000_000_000);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const box = z.object({ min: vector, max: vector }).strict();
const references = z.array(text).min(1).max(32)
  .refine(ids => new Set(ids).size === ids.length, 'FACE references within one load or constraint must be unique.');
const pressureMPa = number.refine(value => value !== 0 && Math.abs(value) <= 1_000_000);
const acceleration = vector.refine(value => Math.hypot(...value) > 1e-9 && Math.hypot(...value) <= 1_000_000_000);
const displacementComponent = number.min(-1_000_000).max(1_000_000).nullable();
const prescribedDisplacement = z.tuple([displacementComponent, displacementComponent, displacementComponent])
  .refine(value => value.some(component => component !== null));
const face = z.object({
  centroidPartLocalMm: vector, areaMm2: positive, outwardDirection: vector.nullable(), geometryType: text.nullable(),
  boundingBoxMm: box.optional(), edgeCount: z.number().int().positive().optional(),
  analytic: z.object({ kind: z.enum(['plane', 'cylinder', 'cone', 'sphere', 'other']), originMm: vector.optional(), axis: vector.optional(), radiusMm: positive.optional() }).strict().optional(),
  witnessPointsPartLocalMm: z.array(vector).max(32).optional(),
}).strict();
const schema = z.object({
  schema: z.literal('tunacad-neutral-simulation-request/1.0'), studyId: text, name: text,
  preparedAt: z.iso.datetime(), expiresAt: z.iso.datetime(), requestDigest: hash,
  analysis: z.object({ type: z.literal('linear_static'), assumptions: z.tuple([z.literal('small_displacement'), z.literal('small_strain'), z.literal('static_loading'), z.literal('homogeneous_material')]) }).strict(),
  geometry: z.object({
    projectRevision: text, partId: text, bodyId: text, geometryDigest: hash, coordinateSpace: z.literal('part_definition_local'),
    shape: z.object({ valid: z.literal(true), connectedSolidCount: z.literal(1), faceCount: z.number().int().positive().max(10000), edgeCount: z.number().int().positive().max(50000), volumeMm3: positive, surfaceAreaMm2: positive,
      boundingBoxMm: box.extend({ size: vector }).strict() }).strict(),
    references: z.array(z.object({ semanticReferenceId: text, ownerPartId: text, geometryKind: z.literal('FACE'), role: z.enum(['load', 'constraint']), sourceFeatureId: text.nullable(), resolutionState: z.literal('valid'), resolvedAtProjectRevision: text, face }).strict()).min(1).max(128),
  }).strict(),
  units: z.object({ geometry: z.literal('mm'), force: z.literal('N'), stress: z.literal('MPa'), displacement: z.literal('mm'), density: z.literal('kg/m^3'), acceleration: z.literal('mm/s^2') }).strict(),
  material: z.object({ id: text, name: text, model: z.literal('isotropic_linear_elastic'), densityKgM3: positive.max(100000).optional(), youngsModulusMPa: positive.max(100000000), poissonRatio: number.min(0).lt(0.5), yieldStrengthMPa: positive.optional(), source: z.object({ kind: z.enum(['library', 'custom']), reference: text, revision: text.optional() }).strict() }).strict(),
  loads: z.array(z.discriminatedUnion('type', [
    z.object({ id: text, name: text, type: z.literal('surface_force'), semanticReferenceIds: references, forceN: surfaceForce }).strict(),
    z.object({ id: text, name: text, type: z.literal('pressure'), semanticReferenceIds: references, pressureMPa }).strict(),
    z.object({ id: text, name: text, type: z.literal('gravity'), accelerationMmPerS2: acceleration }).strict(),
  ])).max(64),
  constraints: z.array(z.discriminatedUnion('type', [
    z.object({ id: text, name: text, type: z.literal('fixed'), semanticReferenceIds: references }).strict(),
    z.object({ id: text, name: text, type: z.literal('prescribed_displacement'), semanticReferenceIds: references, displacementMm: prescribedDisplacement }).strict(),
  ])).min(1).max(64),
  contacts: z.object({ mode: z.literal('none') }).strict(),
  mesh: z.object({ dimensionality: z.literal('3d'), elementFamily: z.literal('tetrahedral'), order: z.literal(2), globalSizeMm: positive.max(1000000), minimumSizeMm: positive.optional(), maximumNodes: z.number().int().min(10).max(500000), maximumElements: z.number().int().min(10).max(250000), qualityMetric: z.literal('provider_normalized'), minimumQuality: number.min(0.04).max(1) }).strict(),
  requestedResults: z.array(z.enum(['von_mises_stress', 'displacement', 'reaction_force', 'factor_of_safety', 'critical_regions'])).min(1).max(5),
}).strict();

export function validateRequest(value: unknown, now = Date.now()): NeutralSimulationRequest {
  if (value && typeof value === 'object' && (value as { schema?: unknown }).schema === 'tunacad-neutral-simulation-request/2.0') {
    validateNeutralSimulationRequestV2(value, now);
    throw new Error('BRIDGE_PROVIDER_INTERFACE_VERSION_UNSUPPORTED');
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error('BRIDGE_REQUEST_INVALID');
  const request = parsed.data;
  const entryIds = [...request.loads, ...request.constraints].map(entry => entry.id);
  if (new Set(entryIds).size !== entryIds.length) throw new Error('BRIDGE_REQUEST_INVALID');
  if (!request.loads.length && !request.constraints.some(constraint => constraint.type === 'prescribed_displacement'
    && constraint.displacementMm.some(component => component !== null && Math.abs(component) > 1e-14))) {
    throw new Error('BRIDGE_REQUEST_INVALID');
  }
  const size = request.geometry.shape.boundingBoxMm.size;
  if (size.some(value => value <= 0 || value > 1_000_000)
    || request.mesh.globalSizeMm < Math.max(...size) / 200
    || (request.mesh.minimumSizeMm !== undefined && request.mesh.minimumSizeMm < request.mesh.globalSizeMm / 20)) throw new Error('BRIDGE_MESH_BUDGET_INVALID');
  const { requestDigest, ...unsigned } = request;
  const { geometryDigest, ...geometry } = request.geometry;
  if (digest(unsigned) !== requestDigest || digest(geometry) !== geometryDigest) throw new Error('BRIDGE_DIGEST_INVALID');
  if (Date.parse(request.expiresAt) <= now || Date.parse(request.expiresAt) > now + 21 * 60_000
    || Date.parse(request.preparedAt) > now + 60_000) throw new Error('BRIDGE_REQUEST_EXPIRED');
  const required = [
    ...request.constraints.flatMap(constraint => constraint.semanticReferenceIds.map(id => [id, 'constraint'] as const)),
    ...request.loads.flatMap(load => 'semanticReferenceIds' in load ? load.semanticReferenceIds.map(id => [id, 'load'] as const) : []),
  ];
  const fixed = new Set(required.filter(([, role]) => role === 'constraint').map(([id]) => id));
  const loaded = new Set(required.filter(([, role]) => role === 'load').map(([id]) => id));
  if ([...fixed].some(id => loaded.has(id))) throw new Error('BRIDGE_REFERENCE_INVALID');
  const requiredKeys = new Set(required.map(([id, role]) => `${role}:${id}`));
  if (requiredKeys.size !== request.geometry.references.length) throw new Error('BRIDGE_REFERENCE_INVALID');
  for (const [id, role] of required) {
    const matches = request.geometry.references.filter(ref => ref.semanticReferenceId === id && ref.role === role
      && ref.ownerPartId === request.geometry.partId && ref.resolvedAtProjectRevision === request.geometry.projectRevision);
    if (matches.length !== 1) throw new Error('BRIDGE_REFERENCE_INVALID');
  }
  return request as NeutralSimulationRequest;
}
