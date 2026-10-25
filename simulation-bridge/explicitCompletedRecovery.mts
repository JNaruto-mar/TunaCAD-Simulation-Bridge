import * as z from 'zod/v4';
import type { ExplicitDynamicsResult } from '../src/simulation/explicitDynamicsProviderContracts.ts';
import { privateExplicitSolveSchema } from './privateExplicitPreparationContract.mts';
import { CompletedResultRecovery } from './completedResultRecovery.mts';
import { electrostaticBrowserDigest as hash } from './electrostaticLiveSource.mts';

const id = z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/);
const sha = z.string().regex(/^sha256:[a-f0-9]{64}$/);
/** No view settings, paths, tokens, approvals or numerical data are selectors. */
export const explicitRecoverySelectorSchema = z.object({
  studyId: z.string().regex(/^private-explicit-[a-f0-9-]{36}$/), runId: z.string().uuid(),
  revision: id, bodyId: id, domainId: id,
  requestDigest: sha, geometryDigest: sha, materialDigest: sha, meshDigest: sha,
  runtimeDigest: sha, provenanceDigest: sha, resultDigest: sha,
  frameCount: z.number().int().min(2).max(64), monitoringFaceIds: z.array(id).max(8)
    .refine(ids => new Set(ids).size === ids.length),
}).strict();
export type ExplicitRecoverySelector = z.infer<typeof explicitRecoverySelectorSchema>;
export const explicitRecoveryBindingSchema = privateExplicitSolveSchema.pick({
  studyId: true, request: true, mesh: true, provider: true,
}).extend({ source: privateExplicitSolveSchema.shape.source.pick({
  revision: true, canonicalSourceDigest: true, bodyId: true, domainId: true,
}) }).strict();
export type ExplicitRecoveryBinding = z.infer<typeof explicitRecoveryBindingSchema>;
export type ExplicitRecoveredResult = {
  analysis: 'explicit_dynamics'; sourceAuthority: 'historical_protected_export_only';
  engineeringUsePermitted: false; result: ExplicitDynamicsResult; binding: ExplicitRecoveryBinding;
};
export function explicitRecoverySelector(result: ExplicitDynamicsResult): ExplicitRecoverySelector {
  return explicitRecoverySelectorSchema.parse({studyId: result.studyId, runId: result.providerRunId,
    revision: result.revision, bodyId: result.bodyId, domainId: result.domainId,
    requestDigest: result.requestDigest, geometryDigest: result.geometryDigest, materialDigest: result.materialDigest,
    meshDigest: result.meshDigest, runtimeDigest: result.provider.runtimeDigest,
    provenanceDigest: result.provenanceDigest, resultDigest: result.resultDigest,
    frameCount: result.frames.length, monitoringFaceIds: result.sampling.monitoringFaces?.map(f => f.referenceId) ?? []});
}
export async function verifyExplicitRecovery(raw: ExplicitRecoveredResult, selector: ExplicitRecoverySelector,
  verify: (result: ExplicitDynamicsResult, binding: ExplicitRecoveryBinding, runId: string) => Promise<unknown>) {
  if (!raw || Object.keys(raw).sort().join(',') !== 'analysis,binding,engineeringUsePermitted,result,sourceAuthority'
    || raw.analysis !== 'explicit_dynamics' || raw.sourceAuthority !== 'historical_protected_export_only'
    || raw.engineeringUsePermitted !== false || raw.result?.status !== 'proof_of_concept'
    || new TextEncoder().encode(JSON.stringify(raw)).length > 2 * 1024 * 1024)
    throw Error('EXPLICIT_RECOVERY_ENVELOPE_INVALID');
  const binding = explicitRecoveryBindingSchema.parse(raw.binding);
  const {requestDigest, ...request} = binding.request;
  if (binding.mesh.meshDigest !== selector.meshDigest || await hash(request) !== requestDigest)
    throw Error('EXPLICIT_RECOVERY_BINDING_MISMATCH');
  await verify(raw.result, binding, selector.runId);
  if (await hash(explicitRecoverySelector(raw.result)) !== await hash(explicitRecoverySelectorSchema.parse(selector)))
    throw Error('EXPLICIT_RECOVERY_BOOKMARK_MISMATCH');
  return structuredClone({...raw, binding});
}
export function createExplicitCompletedRecovery(ports: {
  assertOwner(): Promise<void>; context(): Promise<string>; randomId(): string; now?: () => number;
  readVerified(selector: ExplicitRecoverySelector): Promise<ExplicitRecoveredResult>;
  verifyPresentation: Parameters<typeof verifyExplicitRecovery>[2];
}) {
  return new CompletedResultRecovery({parseSelector: value => explicitRecoverySelectorSchema.parse(value),
    assertOwner: ports.assertOwner, context: ports.context, randomId: ports.randomId, now: ports.now,
    read: async selector => verifyExplicitRecovery(await ports.readVerified(selector), selector, ports.verifyPresentation),
    identity: result => result.result.resultDigest});
}
const lease = z.string().regex(/^[a-f0-9]{64}$/);
export const completedRecoveryRequestSchema = z.discriminatedUnion('operation', [
  z.object({operation: z.literal('open'), analysis: z.literal('explicit_dynamics'), selector: explicitRecoverySelectorSchema}).strict(),
  z.object({operation: z.enum(['result', 'close']), leaseId: lease}).strict(),
]);
