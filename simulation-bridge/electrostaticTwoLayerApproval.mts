import * as z from 'zod/v4';

const id = z.string().min(1).max(160);
const sha = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const domain = z.object({ domainId: id, bodyId: id, materialId: id,
  absolutePermittivityFPerM: z.number().finite().min(1e-15).max(1e-3),
  permittivityUnit: z.literal('F/m'),
  provenance: z.object({ kind: z.enum(['custom', 'library']),
    reference: id, revision: id }).strict() }).strict();
const electrode = z.object({ domainId: id, faceId: id,
  potentialV: z.number().finite().min(-1e6).max(1e6), unit: z.literal('V') }).strict();

/** Authorization only; never a provider request, mesh, or completion. */
export const twoLayerApprovalSchema = z.object({
  schema: z.literal('tunacad-electrostatic-two-layer-approval/0.1'),
  studyId: id, projectRevision: id, sourceEpoch: z.number().int().nonnegative(),
  sessionBinding: sha, sourceDigest: sha, requestDigest: sha,
  preparationReceiptDigest: sha,
  domains: z.tuple([domain, domain]),
  electrodes: z.tuple([electrode, electrode]),
  interfaceFaces: z.tuple([id, id]),
  mesh: z.object({ digest: sha, nodes: z.number().int().positive().max(8000),
    elements: z.number().int().positive().max(4000),
    sharedNodes: z.number().int().min(6), matchedFacets: z.number().int().min(2),
    interfaceAreaMm2: z.number().finite().positive() }).strict(),
}).strict().superRefine((value, ctx) => {
  if (value.domains[0].domainId === value.domains[1].domainId
    || value.domains[0].bodyId === value.domains[1].bodyId
    || value.electrodes[0].domainId !== value.domains[0].domainId
    || value.electrodes[1].domainId !== value.domains[1].domainId
    || value.electrodes[0].faceId === value.electrodes[1].faceId
    || value.electrodes[0].potentialV === value.electrodes[1].potentialV
    || value.interfaceFaces[0] === value.interfaceFaces[1])
    ctx.addIssue({ code: 'custom', message: 'two-layer approval identity mismatch' });
});
export type TwoLayerApproval = z.infer<typeof twoLayerApprovalSchema>;
