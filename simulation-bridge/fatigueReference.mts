import * as z from 'zod/v4';
import { digest } from './stableDigest.mts';

const identifier = z.string().min(1).max(160).regex(/^[^\u0000-\u001f\u007f]*$/);
const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const positive = z.number().finite().positive();
const sample = z.object({
  timeS: z.number().finite().min(0).max(1_000_000),
  stressMPa: z.number().finite().min(-10_000_000).max(10_000_000),
}).strict();

/** Standalone analytical precursor; deliberately NOT a v2 simulation request. */
export const fatigueReferenceInputSchema = z.object({
  schema: z.literal('tunacad-fatigue-reference/0.1'),
  inputDigest: sha256,
  source: z.object({
    structuralJobId: identifier,
    structuralResultDigest: sha256,
    requestDigest: sha256,
    projectRevision: identifier,
    modelDigest: sha256,
    fieldDatasetId: identifier,
    fieldDatasetDigest: sha256,
    domainId: identifier,
    elementId: z.number().int().positive().max(2_000_000),
    integrationPoint: z.number().int().min(1).max(32),
    stressComponent: z.literal('signed_uniaxial_normal_stress'),
    axisAnalysis: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  }).strict(),
  material: z.object({
    materialId: identifier,
    provenance: z.object({
      kind: z.enum(['library', 'custom']), reference: identifier, revision: identifier,
    }).strict(),
    model: z.literal('fully_reversed_stress_life'),
    stressRatio: z.literal(-1),
    snPoints: z.array(z.object({
      cyclesToFailure: z.number().int().min(1).max(1_000_000_000_000),
      stressAmplitudeMPa: positive.max(10_000_000),
    }).strict()).min(2).max(16),
  }).strict(),
  history: z.object({
    quantity: z.literal('signed_uniaxial_stress'),
    cycleShape: z.literal('one_closed_min_max_min_cycle'),
    interpolation: z.literal('linear_between_turning_points'),
    samples: z.tuple([sample, sample, sample]),
    repeatedCycles: z.number().int().min(1).max(1_000_000_000),
  }).strict(),
  units: z.object({
    stress: z.literal('MPa'), time: z.literal('s'), life: z.literal('cycles'),
  }).strict(),
}).strict();

export type FatigueReferenceInput = z.infer<typeof fatigueReferenceInputSchema>;
export type FatigueReferenceDraft = Omit<FatigueReferenceInput, 'inputDigest'>;

export function sealFatigueReferenceInput(draft: FatigueReferenceDraft): FatigueReferenceInput {
  return { ...draft, inputDigest: digest(draft) };
}

export function validateFatigueReferenceInput(value: unknown): FatigueReferenceInput {
  const parsed = fatigueReferenceInputSchema.safeParse(value);
  if (!parsed.success) throw new Error('SIM9_FATIGUE_REFERENCE_INVALID: malformed or unsupported input.');
  const input = parsed.data;
  const [minimum, maximum, closed] = input.history.samples;
  const points = input.material.snPoints;
  const axisLength = Math.hypot(...input.source.axisAnalysis);
  const { inputDigest, ...draft } = input;
  if (inputDigest !== digest(draft)) {
    throw new Error('SIM9_FATIGUE_REFERENCE_INVALID: input digest mismatch.');
  }
  if (Math.abs(axisLength - 1) > 1e-9
    || minimum.timeS !== 0 || maximum.timeS <= 0 || closed.timeS <= maximum.timeS
    || maximum.timeS !== closed.timeS / 2
    || minimum.stressMPa >= 0 || maximum.stressMPa <= 0
    || closed.stressMPa !== minimum.stressMPa
    || Math.abs(maximum.stressMPa + minimum.stressMPa) > maximum.stressMPa * 1e-9
    || points.some((point, index) => index > 0
      && (point.cyclesToFailure <= points[index - 1].cyclesToFailure
        || point.stressAmplitudeMPa >= points[index - 1].stressAmplitudeMPa))
    || maximum.stressMPa > points[0].stressAmplitudeMPa
    || maximum.stressMPa < points.at(-1)!.stressAmplitudeMPa) {
    throw new Error('SIM9_FATIGUE_REFERENCE_INVALID: only a closed fully reversed constant-amplitude cycle within a monotone S-N curve is supported.');
  }
  return input;
}

export interface FatigueReferenceResult {
  schema: 'tunacad-fatigue-reference-result/0.1';
  inputDigest: string;
  source: FatigueReferenceInput['source'];
  materialId: string;
  materialProvenance: FatigueReferenceInput['material']['provenance'];
  snCurveDigest: string;
  stressAmplitudeMPa: number;
  meanStressMPa: 0;
  stressRatio: -1;
  predictedLifeCycles: number;
  repeatedCycles: number;
  damageFraction: number;
  remainingCycles: number;
  predictedFailureWithinHistory: boolean;
  interpolation: 'log_log_between_adjacent_sn_points';
  sourceVerification: 'caller_supplied_digest_not_provider_verified';
  convergence: 'not_evaluated_reference_only';
  uncertainty: 'not_quantified';
  engineeringUsePermitted: false;
}

/** One S-N interpolation and one constant-amplitude Miner fraction.
 * No rainflow, mean-stress correction, strain-life, or extrapolation. */
export function evaluateFatigueReference(value: unknown): FatigueReferenceResult {
  const input = validateFatigueReferenceInput(value);
  const amplitude = input.history.samples[1].stressMPa;
  const points = input.material.snPoints;
  const exact = points.find(point => point.stressAmplitudeMPa === amplitude);
  const upperIndex = points.findIndex((point, index) => index < points.length - 1
    && point.stressAmplitudeMPa > amplitude && amplitude > points[index + 1].stressAmplitudeMPa);
  const life = exact ? exact.cyclesToFailure : (() => {
    if (upperIndex < 0) throw new Error('SIM9_FATIGUE_REFERENCE_INVALID: S-N interpolation interval missing.');
    const high = points[upperIndex]; const low = points[upperIndex + 1];
    const fraction = (Math.log(amplitude) - Math.log(high.stressAmplitudeMPa))
      / (Math.log(low.stressAmplitudeMPa) - Math.log(high.stressAmplitudeMPa));
    return Math.exp(Math.log(high.cyclesToFailure)
      + fraction * (Math.log(low.cyclesToFailure) - Math.log(high.cyclesToFailure)));
  })();
  const repeatedCycles = input.history.repeatedCycles;
  return {
    schema: 'tunacad-fatigue-reference-result/0.1',
    inputDigest: input.inputDigest,
    source: structuredClone(input.source),
    materialId: input.material.materialId,
    materialProvenance: structuredClone(input.material.provenance),
    snCurveDigest: digest(input.material.snPoints),
    stressAmplitudeMPa: amplitude,
    meanStressMPa: 0,
    stressRatio: -1,
    predictedLifeCycles: life,
    repeatedCycles,
    damageFraction: repeatedCycles / life,
    remainingCycles: Math.max(0, life - repeatedCycles),
    predictedFailureWithinHistory: repeatedCycles >= life,
    interpolation: 'log_log_between_adjacent_sn_points',
    sourceVerification: 'caller_supplied_digest_not_provider_verified',
    convergence: 'not_evaluated_reference_only',
    uncertainty: 'not_quantified',
    engineeringUsePermitted: false,
  };
}
