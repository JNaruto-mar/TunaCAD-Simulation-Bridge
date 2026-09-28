import * as z from 'zod/v4';

/** Browser-safe schema; Node sealing/reference exports remain unchanged. */
const id = z.string().min(1).max(160).regex(/^[^\u0000-\u001f\u007f]+$/)
  .refine(value => value.trim().length > 0);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const length = z.number().finite().min(1e-6).max(100);
const potential = z.number().finite().min(-1e6).max(1e6);
const faces = z.object({
  xMin: id, xMax: id, yMin: id, yMax: id, zMin: id, zMax: id,
}).strict().refine(value => new Set(Object.values(value)).size === 6,
  'All six declared slab FACE identities must be distinct.');
const electrode = z.object({
  groupId: id, domainId: id, faceIds: z.array(id).length(1),
  kind: z.literal('prescribed_electric_potential'),
  potentialV: potential, unit: z.literal('V'),
}).strict();

/** Standalone analytical contract, intentionally not a neutral provider request.
 * Geometry/material declarations are NOT verified CAD or provider evidence. */
export const electrostaticFoundationDraftSchema = z.object({
  schema: z.literal('tunacad-electrostatic-foundation/0.1'),
  studyId: id,
  analysis: z.object({
    type: z.literal('electrostatic'),
    assumptions: z.tuple([
      z.literal('homogeneous_linear_isotropic_dielectric'),
      z.literal('zero_free_volume_charge'), z.literal('bounded_domain'),
      z.literal('no_coupling'), z.literal('ideal_parallel_plate_no_fringing'),
    ]),
  }).strict(),
  model: z.object({
    projectRevision: id,
    domains: z.array(z.object({
      domainId: id, partId: id, bodyId: id, geometryDigest: hash,
      shape: z.object({
        kind: z.literal('ideal_parallel_plate_slab'),
        lengthM: length, widthM: length, heightM: length,
        lengthUnit: z.literal('m'), longitudinalAxis: z.literal('x'),
        faces,
      }).strict(),
    }).strict()).length(1),
  }).strict(),
  material: z.object({
    materialId: id, domainId: id,
    model: z.literal('homogeneous_linear_isotropic_dielectric'),
    absolutePermittivityFPerM: z.number().finite().min(1e-15).max(1e-3),
    permittivityUnit: z.literal('F/m'),
    source: z.object({
      kind: z.enum(['library', 'custom']), reference: id, revision: id,
    }).strict(),
  }).strict(),
  prescribedPotentials: z.array(electrode).length(2),
  lateralBoundary: z.object({
    kind: z.literal('zero_normal_electric_displacement'),
    appliesTo: z.literal('all_four_lateral_faces'),
    normalElectricDisplacementCPerM2: z.literal(0), unit: z.literal('C/m^2'),
  }).strict(),
  output: z.object({
    normalizedAxialPositions: z.array(z.number().finite().min(0).max(1))
      .min(2).max(65),
    units: z.object({
      electricPotential: z.literal('V'), electricField: z.literal('V/m'),
      electricDisplacement: z.literal('C/m^2'), electrodeCharge: z.literal('C'),
      capacitance: z.literal('F'), electrostaticEnergy: z.literal('J'),
      electrostaticEnergyDensity: z.literal('J/m^3'),
    }).strict(),
  }).strict(),
}).strict().superRefine((request, context) => {
  const domain = request.model.domains[0];
  const [left, right] = request.prescribedPotentials;
  const issue = (message: string) => context.addIssue({ code: 'custom', message });
  if (request.material.domainId !== domain.domainId
    || request.prescribedPotentials.some(item => item.domainId !== domain.domainId)) {
    issue('Material and both electrode groups must belong to the one declared domain.');
  }
  if (left.groupId === right.groupId || left.faceIds[0] === right.faceIds[0]) {
    issue('Electrode groups and their FACE identities must be separate.');
  }
  if (left.faceIds[0] !== domain.shape.faces.xMin
    || right.faceIds[0] !== domain.shape.faces.xMax) {
    issue('Canonical electrodes must cover xMin then xMax; no lateral or unknown FACE is supported.');
  }
  const positions = request.output.normalizedAxialPositions;
  if (positions[0] !== 0 || positions.at(-1) !== 1
    || positions.some((value, index) => index > 0 && value <= positions[index - 1])) {
    issue('Axial samples must span [0,1], be unique and strictly ordered.');
  }
});

export const electrostaticFoundationSchema =
  electrostaticFoundationDraftSchema.safeExtend({ requestDigest: hash });
export type ElectrostaticFoundation = z.infer<typeof electrostaticFoundationSchema>;
export type ElectrostaticFoundationDraft = Omit<ElectrostaticFoundation, 'requestDigest'>;
