import * as z from 'zod/v4';
import {explicitLoadHistorySchema,assertExplicitLoadResolution,explicitLoadHistoryOnset} from './explicitLoadHistory.mts';
import {explicitHistorySampling} from './explicitHistorySampling.mts';
import {EXPLICIT_MAXIMUM_MONITORING_FACES} from './explicitMonitoring.mts';
import {explicitMeshSizeSchema} from './explicitMeshSizing.mts';

const id = z.string().min(1).max(160).regex(/^[^\u0000-\u001f\u007f]+$/)
  .refine(value => value.trim().length > 0);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const positive = z.number().finite().positive();
const zeroVector = z.tuple([z.literal(0), z.literal(0), z.literal(0)]);
const vector=z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]);
const cadFace=z.object({centroidPartLocalMm:vector,areaMm2:positive,
  topology:z.object({boundingBoxMm:z.object({min:vector,max:vector}).strict(),
    boundaryCurves:z.array(z.object({centroidPartLocalMm:vector,lengthMm:z.number().finite().nonnegative()}).strict()).max(40000),
    surfaceKind:z.string().min(1).max(40),plane:z.object({origin:vector,normal:vector}).strict().optional()}).strict().optional()}).strict();

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
    geometryDigest: hash, kind: z.enum(['straight_rectangular_axial_bar','single_solid_cad']),
    lengthMm: positive.min(1).max(10_000),
    widthMm: positive.min(0.1).max(1000),
    heightMm: positive.min(0.1).max(1000),
    fixedFaceId: id, loadedFaceId: id,
    cad:z.object({volumeMm3:positive,faceCount:z.number().int().min(2).max(20000),
      boundingBoxMm:z.object({min:z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]),
        max:z.tuple([z.number().finite(),z.number().finite(),z.number().finite()])}).strict(),
      fixedFace:cadFace,loadedFace:cadFace,mappingMethod:z.literal('exact-step-boundary-v1').optional(),
      monitoringFaces:z.array(cadFace.extend({referenceId:id})).min(1).max(EXPLICIT_MAXIMUM_MONITORING_FACES).optional(),
    }).strict().optional(),
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
  load: z.object({ kind: z.enum(['axial_step_face_force','axial_history_face_force']), faceId: id,
    onsetS: z.number().finite().nonnegative().max(.01), forceN: z.tuple([positive.max(1_000_000),
      z.literal(0), z.literal(0)]), coordinateSystem: z.literal('analysis'),
    history: explicitLoadHistorySchema }).strict(),
  mesh: z.object({
    elementFormulation: z.literal('C3D4'),
    // Optional to preserve existing durable request/configuration digests.
    sizeMm: explicitMeshSizeSchema.optional(),
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
  if((r.load.kind==='axial_step_face_force')!==(r.load.history==='constant_after_onset'))fail('Load kind/history mismatch.');
  if(r.load.onsetS!==explicitLoadHistoryOnset(r.load.history))fail('Load onset/history mismatch.');
  try{const sampling=explicitHistorySampling(a.durationS,a.outputTimesS);
    assertExplicitLoadResolution(r.load.history,a.durationS,sampling.intervalS);}catch(e){fail((e as Error).message);}
  if((m.kind==='single_solid_cad')!==Boolean(m.cad))fail('CAD geometry evidence required only for single-solid CAD models.');
  if(m.cad?.mappingMethod&&(!m.cad.fixedFace.topology||!m.cad.loadedFace.topology))fail('Exact selected FACE topology required.');
  if(m.cad?.monitoringFaces&&(m.cad.mappingMethod!=='exact-step-boundary-v1'
    ||m.cad.monitoringFaces.some(f=>!f.topology)||new Set(m.cad.monitoringFaces.map(f=>f.referenceId)).size!==m.cad.monitoringFaces.length))
    fail('Distinct exact monitoring FACE topology required.');
  if(m.cad&&m.cad.boundingBoxMm.max.some((v,i)=>v<=m.cad!.boundingBoxMm.min[i]
    ||Math.abs(v-m.cad!.boundingBoxMm.min[i]-[m.lengthMm,m.widthMm,m.heightMm][i])>1e-7))fail('CAD bounds/dimensions disagree.');
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
