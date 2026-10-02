import * as z from 'zod/v4';
import { explicitDynamicsSchema } from './explicitDynamicsContract.mts';
import { electrostaticBrowserDigest as hash } from './electrostaticLiveSource.mts';

const id=z.string().min(1).max(160).regex(/^[^\u0000-\u001f\u007f]+$/);
const sha=z.string().regex(/^sha256:[a-f0-9]{64}$/);
const face=z.object({referenceId:id,bodyId:id,fingerprint:sha}).strict();
/** Identities, never a caller's substitute for trusted live reads. */
export const privateExplicitSourceSchema=z.object({
  documentId:id,modelId:id,sessionBinding:sha,revision:id,sourceEpoch:z.number().int().nonnegative(),
  componentId:id,bodyId:id,domainId:id,topologyDigest:sha,
  fixedFace:face,loadedFace:face,materialId:id,materialDigest:sha,
  canonicalSourceDigest:sha,studyParameterDigest:sha,unitSystemDigest:sha,
}).strict();
export const privateExplicitExportSchema=z.object({exportId:id,sourceBindingDigest:sha,
  canonicalSourceDigest:sha,byteDigest:sha,byteLength:z.number().int().min(128).max(16*1024*1024)}).strict();
export const privateExplicitMeshSchema=z.object({meshId:id,meshDigest:sha,exportId:id,exportByteDigest:sha,
  sourceBindingDigest:sha,geometryDigest:sha,faceMappingDigest:sha,validationDigest:sha,
  meshingRuntime:z.literal('Gmsh 4.15.2'),nodeCount:z.number().int().min(4).max(100000),elementCount:z.number().int().min(1).max(50000),
  elementFormulation:z.literal('C3D4')}).strict();
export const privateExplicitProviderSchema=z.object({providerId:z.literal('tunacad-openradioss-explicit-private'),
  providerVersion:z.literal('0.1.0-poc'),runtimeVersion:z.literal('2026'),runtimeManifestDigest:sha,runtimeDigest:sha}).strict();
export const privateExplicitSolveSchema=z.object({
  schema:z.literal('tunacad-private-simulation-solve-approval/0.1'),
  contractVersion:z.literal('tunacad-explicit-dynamics-foundation/0.1'),
  preparationId:id,studyId:id,source:privateExplicitSourceSchema,sourceBindingDigest:sha,
  solveRevalidation:z.object({schema:z.literal('tunacad-private-solve-revalidation/0.1'),
    solveBindingId:id,createdAt:z.number().int().nonnegative(),expiresAt:z.number().int().nonnegative(),
    exportReceiptDigest:sha}).strict().optional(),
  request:explicitDynamicsSchema,geometry:privateExplicitExportSchema,mesh:privateExplicitMeshSchema,
  provider:privateExplicitProviderSchema,
  geometryApproval:z.object({approvalId:id,bindingDigest:sha,consumedAt:z.number().int().nonnegative(),
    approvalSource:z.enum(['human','controlled_test_fixture']).optional()}).strict(),
}).strict();
export type PrivateExplicitSource=z.infer<typeof privateExplicitSourceSchema>;
export type PrivateExplicitExport=z.infer<typeof privateExplicitExportSchema>;
export type PrivateExplicitMesh=z.infer<typeof privateExplicitMeshSchema>;
export type PrivateExplicitProvider=z.infer<typeof privateExplicitProviderSchema>;
export type PrivateExplicitSolveBinding=z.infer<typeof privateExplicitSolveSchema>;
export type PrivateApprovalSource='human'|'controlled_test_fixture';
export interface PrivateSolveAuthorization {authorizationId:string;bindingDigest:string;expiresAt:number;approvalSource?:PrivateApprovalSource}
/** Trusted internal Bridge port. There is no HTTP/MCP route and no dispatch. */
export interface PrivateSimulationApprovals {
  readonly approvalSource?:PrivateApprovalSource;
  authorize(binding:PrivateExplicitSolveBinding):Promise<PrivateSolveAuthorization>;
  consume(authorizationId:string,binding:PrivateExplicitSolveBinding):Promise<PrivateSolveAuthorization>;
  verifyConsumed(authorizationId:string,binding:PrivateExplicitSolveBinding):Promise<void>;
}
export async function validatePrivateExplicitSolve(value:unknown) {
  const r=privateExplicitSolveSchema.parse(value),s=r.source,m=r.mesh,g=r.geometry,q=r.request;
  const {requestDigest,...unsigned}=q;
  if(r.solveRevalidation&&(r.solveRevalidation.expiresAt-r.solveRevalidation.createdAt!==120000
    ||!r.solveRevalidation.solveBindingId.startsWith('solvebinding_private-'))
    ||await hash(unsigned)!==requestDigest||await hash(s)!==r.sourceBindingDigest
    ||r.studyId!==q.studyId||q.model.projectRevision!==s.revision||q.model.bodyId!==s.bodyId
    ||q.model.partId!==s.componentId||q.model.domainId!==s.domainId
    ||q.model.geometryDigest!==s.canonicalSourceDigest||q.material.materialId!==s.materialId
    ||q.model.fixedFaceId!==s.fixedFace.referenceId||q.model.loadedFaceId!==s.loadedFace.referenceId
    ||s.fixedFace.referenceId===s.loadedFace.referenceId||s.fixedFace.bodyId!==s.bodyId||s.loadedFace.bodyId!==s.bodyId
    ||s.fixedFace.fingerprint===s.loadedFace.fingerprint
    ||g.sourceBindingDigest!==r.sourceBindingDigest||g.canonicalSourceDigest!==s.canonicalSourceDigest
    ||m.sourceBindingDigest!==r.sourceBindingDigest||m.geometryDigest!==s.canonicalSourceDigest
    ||m.exportId!==g.exportId||m.exportByteDigest!==g.byteDigest
    ||r.geometryApproval.bindingDigest!==await hash({purpose:'geometry_transfer',preparationId:r.preparationId,
      studyId:r.studyId,sourceBindingDigest:r.sourceBindingDigest,requestDigest:q.requestDigest,
      ...(r.geometryApproval.approvalSource==='controlled_test_fixture'?{approvalSource:r.geometryApproval.approvalSource}:{})}))
    throw new Error('PRIVATE_SIMULATION_BINDING_MISMATCH');
  return r;
}
