import * as z from 'zod/v4';

const id = z.string().min(1).max(160).regex(/^[^\u0000-\u001f\u007f]+$/).refine(s => s.trim().length > 0);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const coordinate = z.number().finite().min(0).max(100);
const dimension = z.number().finite().min(1e-6).max(100);
const faces = z.object({ xMin: id, xMax: id, yMin: id, yMax: id, zMin: id, zMax: id })
  .strict().refine(f => new Set(Object.values(f)).size === 6);
const domain = z.object({
  domainId: id, partId: id, bodyId: id, geometryDigest: hash,
  shape: z.object({
    kind: z.literal('origin_aligned_rectangular_dielectric_layer'),
    xMinM: coordinate, xMaxM: coordinate, widthM: dimension, heightM: dimension,
    lengthUnit: z.literal('m'), longitudinalAxis: z.literal('x'), faces,
    interfaceSurfaceDigest: hash,
  }).strict(),
}).strict();
const material = z.object({
  materialId: id, domainId: id, model: z.literal('homogeneous_linear_isotropic_dielectric'),
  absolutePermittivityFPerM: z.number().finite().min(1e-15).max(1e-3),
  permittivityUnit: z.literal('F/m'),
  source: z.object({ kind: z.enum(['library', 'custom']), reference: id, revision: id }).strict(),
}).strict();
const electrode = z.object({
  groupId: id, domainId: id, faceId: id, kind: z.literal('prescribed_electric_potential'),
  potentialV: z.number().finite().min(-1e6).max(1e6), unit: z.literal('V'),
}).strict();
const lateralFace = z.object({ domainId: id, faceId: id }).strict();

/** Analytical declaration only. FACE topology and mesh conformity are not trusted here. */
export const electrostaticTwoLayerDraftSchema = z.object({
  schema: z.literal('tunacad-electrostatic-two-layer-foundation/0.1'), studyId: id,
  analysis: z.object({
    type: z.literal('electrostatic'),
    assumptions: z.tuple([
      z.literal('two_linear_isotropic_dielectrics'),
      z.literal('zero_free_volume_and_interface_charge'),
      z.literal('bounded_domain'), z.literal('no_coupling'),
      z.literal('ideal_parallel_plate_no_fringing'),
    ]),
  }).strict(),
  model: z.object({
    projectRevision: id, domains: z.tuple([domain, domain]),
    interface: z.object({
      kind: z.literal('declared_conformal_planar_dielectric_interface'),
      leftDomainId: id, leftFaceId: id, rightDomainId: id, rightFaceId: id,
      planeXM: coordinate, areaM2: z.number().finite().positive(),
      surfaceDigest: hash, lengthUnit: z.literal('m'), areaUnit: z.literal('m^2'),
      normalFromLeftToRight: z.tuple([z.literal(1), z.literal(0), z.literal(0)]),
    }).strict(),
  }).strict(),
  materials: z.tuple([material, material]),
  prescribedPotentials: z.tuple([electrode, electrode]),
  lateralBoundary: z.object({
    kind: z.literal('zero_normal_electric_displacement'),
    faces: z.tuple([
      lateralFace, lateralFace, lateralFace, lateralFace,
      lateralFace, lateralFace, lateralFace, lateralFace,
    ]),
    normalElectricDisplacementCPerM2: z.literal(0), unit: z.literal('C/m^2'),
  }).strict(),
  output: z.object({
    axialPositionsM: z.array(coordinate).min(3).max(65),
    units: z.object({
      electricPotential: z.literal('V'), electricField: z.literal('V/m'),
      electricDisplacement: z.literal('C/m^2'), electrodeCharge: z.literal('C'),
      capacitance: z.literal('F'), electrostaticEnergy: z.literal('J'),
      electrostaticEnergyDensity: z.literal('J/m^3'),
    }).strict(),
  }).strict(),
}).strict().superRefine((r, c) => {
  const [a, b] = r.model.domains;
  const [ma, mb] = r.materials;
  const [ea, eb] = r.prescribedPotentials;
  const i = r.model.interface;
  const fail = (message: string) => c.addIssue({ code: 'custom', message });
  if (new Set([...Object.values(a.shape.faces), ...Object.values(b.shape.faces)]).size !== 12)
    fail('All domain-owned FACE identities must be distinct.');
  if (a.domainId === b.domainId || a.bodyId === b.bodyId || a.partId === b.partId)
    fail('Both domains require distinct domain/body/part identities.');
  if (a.shape.xMinM !== 0 || a.shape.xMaxM <= a.shape.xMinM
    || b.shape.xMaxM <= b.shape.xMinM) fail('Each ordered layer must have positive thickness.');
  if (a.shape.xMaxM !== b.shape.xMinM || i.planeXM !== a.shape.xMaxM)
    fail('Interface plane must coincide exactly with both domains: no gap or overlap.');
  if (a.shape.widthM !== b.shape.widthM || a.shape.heightM !== b.shape.heightM
    || i.areaM2 !== a.shape.widthM * a.shape.heightM)
    fail('Both origin-aligned interface footprints and declared area must match.');
  if (i.surfaceDigest !== a.shape.interfaceSurfaceDigest
    || i.surfaceDigest !== b.shape.interfaceSurfaceDigest)
    fail('The two declared interface surfaces must share one identity.');
  if (i.leftDomainId !== a.domainId || i.leftFaceId !== a.shape.faces.xMax
    || i.rightDomainId !== b.domainId || i.rightFaceId !== b.shape.faces.xMin)
    fail('Interface faces must be owned opposing xMax/xMin faces.');
  if (ma.domainId !== a.domainId || mb.domainId !== b.domainId || ma.materialId === mb.materialId)
    fail('Distinct material records must belong to their exact domains.');
  if (ea.domainId !== a.domainId || ea.faceId !== a.shape.faces.xMin
    || eb.domainId !== b.domainId || eb.faceId !== b.shape.faces.xMax
    || ea.groupId === eb.groupId)
    fail('Separate electrodes must occupy the two external opposing faces.');
  const expectedLateral = [a, b].flatMap(d =>
    (['yMin', 'yMax', 'zMin', 'zMax'] as const).map(k => d.domainId + '\u0000' + d.shape.faces[k]));
  if ((r.lateralBoundary.faces as { domainId: string; faceId: string }[]).some((f, n) =>
    f.domainId + '\u0000' + f.faceId !== expectedLateral[n]))
    fail('All eight insulated lateral FACE bindings must be complete, owned and ordered.');
  const p = r.output.axialPositionsM;
  if (p[0] !== 0 || p.at(-1) !== b.shape.xMaxM || !p.includes(i.planeXM)
    || p.some((x, n) => n > 0 && x <= p[n - 1]))
    fail('Samples must increase from the left electrode through the interface to the right.');
});

export const electrostaticTwoLayerSchema =
  electrostaticTwoLayerDraftSchema.safeExtend({ requestDigest: hash });
export type ElectrostaticTwoLayer = z.infer<typeof electrostaticTwoLayerSchema>;
export type ElectrostaticTwoLayerDraft = Omit<ElectrostaticTwoLayer, 'requestDigest'>;
