import * as z from 'zod/v4';
import { privateExplicitMeshSchema,privateExplicitExportSchema,privateExplicitSourceSchema,
  type PrivateExplicitExport,type PrivateExplicitSource } from './privateExplicitPreparationContract.mts';
import { electrostaticBrowserDigest as hash } from './electrostaticLiveSource.mts';
import { explicitDynamicsSchema } from './explicitDynamicsContract.mts';
const sha=z.string().regex(/^sha256:[a-f0-9]{64}$/);
/** Read-only capture format. Only a trusted host capture may create records/pins;
 * the operator controller cannot save, relabel, regenerate or reseal a mesh. */
const legacyMeshRecordSchema=z.object({
  schema:z.literal('tunacad-private-explicit-protected-mesh/0.1'),
  studyId:z.string().min(1).max(160),meshRevision:z.number().int().positive(),
  storageIdentity:sha,source:privateExplicitSourceSchema,geometry:privateExplicitExportSchema,
  mesh:privateExplicitMeshSchema,
}).strict();
export const privateCapturedMeshRecordSchema=legacyMeshRecordSchema.extend({
  schema:z.literal('tunacad-private-explicit-protected-mesh/0.2'),request:explicitDynamicsSchema,
  capture:z.object({schema:z.literal('tunacad-private-explicit-gmsh-capture/1'),createdAt:z.string().datetime(),
    approvalSource:z.enum(['human','controlled_test_fixture']),exportReceiptDigest:sha,
    executionReceiptDigest:sha,rawMeshDigest:sha,rawMeshByteLength:z.number().int().positive().max(16*1024*1024),
    gmshExecutableDigest:sha,providerSettingsIdentity:sha,configurationDigest:sha}).strict(),
}).strict();
export const privateExplicitMeshRecordSchema=z.union([legacyMeshRecordSchema,privateCapturedMeshRecordSchema]);
export type PrivateExplicitMeshRecord=z.infer<typeof privateExplicitMeshRecordSchema>;
export interface PrivateProtectedMeshReader {
  readExact(studyId:string,geometry:PrivateExplicitExport,source:PrivateExplicitSource):Promise<PrivateExplicitMeshRecord|null>;
}
export async function verifyPrivateExplicitMeshRecord(value:unknown,studyId:string,
  geometry:PrivateExplicitExport,source:PrivateExplicitSource) {
  const r=privateExplicitMeshRecordSchema.parse(value),s=await hash(source),m=r.mesh;
  if(JSON.stringify(source.monitoringFaces?.map(f=>f.referenceId))!==JSON.stringify(m.monitoringFaces?.map(f=>f.referenceId)))
    throw Error('PRIVATE_EXPLICIT_MESH_MONITORING_MISMATCH');
  if(r.studyId!==studyId||await hash(r.source)!==s||await hash(r.geometry)!==await hash(geometry)
    ||m.sourceBindingDigest!==s||m.geometryDigest!==source.canonicalSourceDigest
    ||m.exportId!==geometry.exportId||m.exportByteDigest!==geometry.byteDigest)
    throw new Error('PRIVATE_EXPLICIT_MESH_PROVENANCE_MISMATCH');
  if(r.schema==='tunacad-private-explicit-protected-mesh/0.2'){
    const {requestDigest,...unsigned}=r.request;
    if(await hash(unsigned)!==requestDigest||r.request.studyId!==studyId||r.request.model.projectRevision!==source.revision
      ||r.request.model.domainId!==source.domainId||r.request.model.bodyId!==source.bodyId
      ||r.request.model.geometryDigest!==source.canonicalSourceDigest||r.request.material.materialId!==source.materialId
      ||r.request.model.fixedFaceId!==source.fixedFace.referenceId||r.request.model.loadedFaceId!==source.loadedFace.referenceId
      ||JSON.stringify(r.request.model.cad?.monitoringFaces?.map(f=>f.referenceId))!==JSON.stringify(source.monitoringFaces?.map(f=>f.referenceId)))
      throw new Error('PRIVATE_EXPLICIT_MESH_REQUEST_MISMATCH');
  }
  return r;
}
