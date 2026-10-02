import * as z from 'zod/v4';

const id = z.string().min(1).max(160).regex(/^[^\u0000-\u001f\u007f]+$/)
  .refine(value => value.trim().length > 0);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const positive = z.number().finite().positive();
const zeroVector = z.tuple([z.literal(0), z.literal(0), z.literal(0)]);

/** Axial one-solid foundation only; declarations are not trusted CAD or mesh evidence. */
export const explicitDynamicsDraftSchema = z.object({
  schema: z.literal('tunacad-explicit-dynamics-foundation/0.1'),
  studyId: id,
  analysis: z.object({
    type: z.literal('explicit_structural_dynamics'),
    assumptions: z.tuple([
      z.literal('one_linear_elastic_solid'), z.literal('small_displacement'),
      z.literal('zero_initial_conditions'), z.literal('undamped'),
      z.literal('no_contact'), z.literal('no_mass_scaling'),
    ]),
    durationS: positive.max(0.01),
    outputTimesS: z.array(positive.max(0.01)).min(2).max(16),
    integration: z.object({
      kind: z.literal('central_difference_cfl_bound'),
      minimumCharacteristicLengthMm: positive.min(0.1).max(1000),
      safetyFactor: positive.max(0.8),
      maximumTimeStepS: positive.max(0.001),
      maximumIncrements: z.number().int().min(2).max(20_000),
    }).strict(),
  }).strict(),
  model: z.object({
    projectRevision: id, domainId: id, partId: id, bodyId: id,
    geometryDigest: hash, kind: z.literal('straight_rectangular_axial_bar'),
    lengthMm: positive.min(1).max(10_000),
    widthMm: positive.min(0.1).max(1000),
    heightMm: positive.min(0.1).max(1000),
    fixedFaceId: id, loadedFaceId: id,
  }).strict(),
  material: z.object({
    materialId: id, domainId: id, model: z.literal('isotropic_linear_elastic'),
    youngsModulusMPa: positive.min(1).max(1_000_000),
    poissonRatio: z.number().finite().min(-0.49).max(0.49),
    densityKgM3: positive.min(1).max(100_000),
    source: z.object({ kind: z.enum(['custom', 'library']),
      reference: id, revision: id }).strict(),
  }).strict(),
  initialConditions: z.object({ displacementMm: zeroVector,
    velocityMmPerS: zeroVector }).strict(),
  restraint: z.object({ kind: z.literal('fixed_face'), faceId: id,
    displacementMm: zeroVector }).strict(),
  load: z.object({ kind: z.literal('axial_step_face_force'), faceId: id,
    onsetS: z.literal(0), forceN: z.tuple([positive.max(1_000_000),
      z.literal(0), z.literal(0)]), coordinateSystem: z.literal('analysis'),
    history: z.literal('constant_after_onset') }).strict(),
  mesh: z.object({
    elementFormulation: z.literal('C3D4'),
    maximumNodes: z.number().int().min(4).max(100_000),
    maximumElements: z.number().int().min(1).max(50_000),
  }).strict(),
  requestedResults: z.tuple([
    z.literal('loaded_face_axial_displacement_history'),
    z.literal('fixed_face_axial_reaction_history'),
    z.literal('kinetic_energy_history'),
    z.literal('strain_energy_history'),
    z.literal('applied_work_history'),
  ]),
  units: z.object({ length: z.literal('mm'), time: z.literal('s'),
    force: z.literal('N'), stress: z.literal('MPa'),
    density: z.literal('kg/m^3'), velocity: z.literal('mm/s'),
    acceleration: z.literal('mm/s^2'), energy: z.literal('N*mm') }).strict(),
}).strict().superRefine((r, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  const a = r.analysis, m = r.model;
  if (r.material.domainId !== m.domainId) fail('Material must belong to the sole domain.');
  if (m.fixedFaceId === m.loadedFaceId || r.restraint.faceId !== m.fixedFaceId
    || r.load.faceId !== m.loadedFaceId) fail('Distinct owned fixed and loaded FACEs are required.');
  if (a.outputTimesS.at(-1) !== a.durationS
    || a.outputTimesS.some((time, index) => time > a.durationS
      || (index > 0 && time <= a.outputTimesS[index - 1])))
    fail('Ordered output times must end at duration.');
  if (a.integration.minimumCharacteristicLengthMm > Math.min(m.lengthMm, m.widthMm, m.heightMm))
    fail('Declared minimum characteristic length exceeds the bar dimensions.');
  const wave = explicitWaveSpeedsMmPerS(r.material.youngsModulusMPa,
    r.material.poissonRatio, r.material.densityKgM3);
  const stableLimitS = a.integration.safetyFactor
    * a.integration.minimumCharacteristicLengthMm / wave.dilatationalMmPerS;
  if (a.integration.maximumTimeStepS > stableLimitS * (1 + 1e-12))
    fail('Requested explicit step exceeds the conservative CFL bound.');
  if (Math.ceil(a.durationS / a.integration.maximumTimeStepS) > a.integration.maximumIncrements)
    fail('Explicit increment budget cannot cover duration.');
});

export const explicitDynamicsSchema = explicitDynamicsDraftSchema.safeExtend({ requestDigest: hash });
export type ExplicitDynamicsDraft = z.infer<typeof explicitDynamicsDraftSchema>;
export type ExplicitDynamicsRequest = z.infer<typeof explicitDynamicsSchema>;

export function explicitWaveSpeedsMmPerS(youngsModulusMPa: number,
  poissonRatio: number, densityKgM3: number) {
  const axialMmPerS = 1000 * Math.sqrt(youngsModulusMPa * 1e6 / densityKgM3);
  const dilatationalMmPerS = axialMmPerS * Math.sqrt((1 - poissonRatio)
    / ((1 + poissonRatio) * (1 - 2 * poissonRatio)));
  return { axialMmPerS, dilatationalMmPerS };
}
