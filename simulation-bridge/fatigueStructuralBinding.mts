import * as z from 'zod/v4';
import type { NeutralSimulationResultV2 } from '../src/simulation/externalSimulationContracts.ts';
import { digest } from './stableDigest.mts';
import { validateFatigueReferenceInput, type FatigueReferenceInput } from './fatigueReference.mts';

const label = z.string().min(1).max(160).regex(/^[^\u0000-\u001f\u007f]*$/);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const sample = z.object({
  timeS: z.number().finite().min(0).max(1_000_000),
  stressMPa: z.number().finite().min(-10_000_000).max(10_000_000),
}).strict();
const storedResultIdentitySchema = z.object({
  schema: z.literal('tunacad-neutral-simulation-result/2.0'),
  jobId: label,
  requestDigest: hash,
  projectRevision: label,
  modelDigest: hash,
  analysisType: z.literal('nonlinear_static'),
  status: z.literal('succeeded'),
  authority: z.literal('engineering'),
  convergence: z.object({ status: z.literal('converged') }).passthrough(),
  mutation: z.object({ occurred: z.literal(false) }).passthrough(),
  perDomain: z.array(z.object({
    domainId: label, fieldDatasetIds: z.array(label),
  }).passthrough()).min(1),
}).passthrough();

/** Trusted-provider artifact, kept separate from scalar contour pages.
 * Only the opt-in CalculiX structural-history path emits it. */
export const structuralStressHistorySchema = z.object({
  schema: z.literal('tunacad-structural-stress-history/0.1'),
  structuralJobId: label,
  structuralResultDigest: hash,
  requestDigest: hash,
  projectRevision: label,
  modelDigest: hash,
  fieldDatasetId: label,
  location: z.object({
    domainId: label,
    elementId: z.number().int().positive().max(2_000_000),
    integrationPoint: z.number().int().min(1).max(32),
    stressComponent: z.literal('signed_uniaxial_normal_stress'),
    axisAnalysis: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  }).strict(),
  units: z.object({ stress: z.literal('MPa'), time: z.literal('s') }).strict(),
  samples: z.tuple([sample, sample, sample]),
}).strict();
export type StructuralStressHistory = z.infer<typeof structuralStressHistorySchema>;

/** The implementation must be backed by the existing trusted job/result store
 * and provider-owned field/history retrieval, never by MCP request JSON. */
export interface TrustedStructuralHistoryReader {
  readCompletedResult(jobId: string): Promise<NeutralSimulationResultV2 | null>;
  readStressHistory(jobId: string, fieldDatasetId: string): Promise<unknown>;
}

export interface FatigueStructuralBinding {
  inputDigest: string;
  structuralJobId: string;
  structuralResultDigest: string;
  fieldDatasetDigest: string;
  location: FatigueReferenceInput['source'];
  verifiedSamples: FatigueReferenceInput['history']['samples'];
  verification: 'matched_trusted_result_and_history_snapshot';
  providerAdmission: 'closed';
}

function reject(reason: string): never {
  throw new Error('SIM9_FATIGUE_SOURCE_BINDING_INVALID: ' + reason);
}

/** No fatigue calculation or provider admission occurs here. A digest claimed
 * by the caller is checked against independent trusted result/history reads. */
export async function bindFatigueToStructuralHistory(
  value: unknown, reader: TrustedStructuralHistoryReader,
): Promise<FatigueStructuralBinding> {
  const input = validateFatigueReferenceInput(value);
  const source = input.source;
  const fetchedResult = await reader.readCompletedResult(source.structuralJobId);
  if (!fetchedResult) reject('structural job/result not found');
  const result = structuredClone(fetchedResult);
  if (!storedResultIdentitySchema.safeParse(result).success) {
    reject('stored structural result is malformed or not completed engineering output');
  }
  const resultDigest = digest(result);
  if (result.schema !== 'tunacad-neutral-simulation-result/2.0'
    || result.jobId !== source.structuralJobId || result.status !== 'succeeded'
    || result.analysisType !== 'nonlinear_static' || result.authority !== 'engineering'
    || result.convergence.status !== 'converged' || result.mutation.occurred
    || result.requestDigest !== source.requestDigest
    || result.projectRevision !== source.projectRevision
    || result.modelDigest !== source.modelDigest
    || resultDigest !== source.structuralResultDigest
    || result.perDomain.filter(domain => domain.domainId === source.domainId
      && domain.fieldDatasetIds.includes(source.fieldDatasetId)).length !== 1
    || result.perDomain.flatMap(domain => domain.fieldDatasetIds)
      .filter(datasetId => datasetId === source.fieldDatasetId).length !== 1) {
    reject('result identity, state, digest, or dataset ownership mismatch');
  }
  const rawHistory = await reader.readStressHistory(source.structuralJobId, source.fieldDatasetId);
  const parsed = structuralStressHistorySchema.safeParse(rawHistory);
  if (!parsed.success) reject('structural history is missing, malformed, or incomplete');
  const history = structuredClone(parsed.data);
  const historyDigest = digest(history);
  if (history.structuralJobId !== result.jobId
    || history.structuralResultDigest !== resultDigest
    || history.requestDigest !== result.requestDigest
    || history.projectRevision !== result.projectRevision
    || history.modelDigest !== result.modelDigest
    || history.fieldDatasetId !== source.fieldDatasetId
    || historyDigest !== source.fieldDatasetDigest
    || history.location.domainId !== source.domainId
    || history.location.elementId !== source.elementId
    || history.location.integrationPoint !== source.integrationPoint
    || history.location.stressComponent !== source.stressComponent
    || history.location.axisAnalysis.some((component, axis) => component !== source.axisAnalysis[axis])
    || history.samples.some((entry, index) => entry.timeS !== input.history.samples[index].timeS
      || entry.stressMPa !== input.history.samples[index].stressMPa)) {
    reject('history result binding, location, digest, order, or values mismatch');
  }
  return {
    inputDigest: input.inputDigest,
    structuralJobId: result.jobId,
    structuralResultDigest: resultDigest,
    fieldDatasetDigest: historyDigest,
    location: structuredClone(source),
    verifiedSamples: structuredClone(history.samples),
    verification: 'matched_trusted_result_and_history_snapshot',
    providerAdmission: 'closed',
  };
}
