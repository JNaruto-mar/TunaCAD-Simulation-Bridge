import * as z from 'zod/v4';
import { join } from 'node:path';
import { digest } from './stableDigest.mts';
import { NEUTRAL_FEM_MESH_SCHEMA } from '../src/simulation/externalSimulationContracts.ts';
import { ElectrostaticHostStorage,readElectrostaticHostJson } from './electrostaticHostStorage.mts';
import { verifyPrivateExplicitMeshRecord,type PrivateProtectedMeshReader } from './privateExplicitMeshRecord.mts';
import { verifyPrivateMeshStorageMode,verifyCapturedMeshArtifacts } from './privateExplicitMeshCaptureStore.mts';
const sha=z.string().regex(/^sha256:[a-f0-9]{64}$/);
const pinSchema=z.object({schema:z.literal('tunacad-private-explicit-mesh-pin/0.1'),
  lookupDigest:sha,recordDigest:sha,storageIdentity:sha}).strict();
/** Existing protected host directories/ACL policy. No new provision/save API,
 * caller filenames, fuzzy search, mesh generation or provider invocation. */
export async function openPrivateExplicitMeshStore(root:string,testConfiguration?:{
  mode:'controlled_test_fixture';purpose:'private_operator_approval_fixture'
}):Promise<PrivateProtectedMeshReader> {
  const storage=await ElectrostaticHostStorage.open(root);
  await verifyPrivateMeshStorageMode(storage,testConfiguration);
  return {
    async readExact(studyId,geometry,source) {
      await storage.assertReady();
      await verifyPrivateMeshStorageMode(storage,testConfiguration);
      const lookupDigest=digest({studyId,geometry,source});
      let raw;
      try {raw=await readElectrostaticHostJson(join(storage.paths['source-catalog'],
        'explicit-mesh-'+lookupDigest.slice(7)+'.pin.json'),4096);}
      catch(error:any){if(error.code==='ENOENT')return null;throw error;}
      const pin=pinSchema.parse(raw);
      if(pin.lookupDigest!==lookupDigest||pin.storageIdentity!==storage.configurationDigest)
        throw new Error('PRIVATE_EXPLICIT_MESH_STORAGE_MISMATCH');
      const rawRecord=await readElectrostaticHostJson(join(storage.paths.studies,
        'explicit-mesh-'+pin.recordDigest.slice(7)+'.json'),65536);
      if(digest(rawRecord)!==pin.recordDigest)throw new Error('PRIVATE_EXPLICIT_MESH_RECORD_TAMPERED');
      const record=await verifyPrivateExplicitMeshRecord(rawRecord,studyId,geometry,source);
      if(record.storageIdentity!==pin.storageIdentity)throw new Error('PRIVATE_EXPLICIT_MESH_STORAGE_MISMATCH');
      // Independently reload the captured artifact. The pinned validation and
      // FACE-map digests are not a substitute for authentic mesh content.
      const artifact=await readElectrostaticHostJson(join(storage.paths.results,
        'explicit-mesh-'+record.mesh.meshDigest.slice(7)+'.json'));
      if(record.schema==='tunacad-private-explicit-protected-mesh/0.2') {
        await verifyCapturedMeshArtifacts(storage,record,artifact,testConfiguration);
      } else if(artifact.schema!==NEUTRAL_FEM_MESH_SCHEMA||digest(artifact)!==record.mesh.meshDigest||artifact.projectRevision!==source.revision
        ||artifact.geometryDigest!==source.canonicalSourceDigest||artifact.units!=='mm'
        ||artifact.element?.family!=='tetrahedral'||artifact.element?.solutionOrder!==1
        ||artifact.element?.geometryOrder!==1||artifact.nodes?.length!==record.mesh.nodeCount
        ||artifact.volumeElements?.connectivity?.length!==record.mesh.elementCount)
        throw new Error('PRIVATE_EXPLICIT_MESH_ARTIFACT_MISMATCH');
      await storage.assertReady();
      if(digest(await readElectrostaticHostJson(join(storage.paths['source-catalog'],
        'explicit-mesh-'+lookupDigest.slice(7)+'.pin.json'),4096))!==digest(pin))
        throw new Error('PRIVATE_EXPLICIT_MESH_PIN_CHANGED');
      return record;
    },
  };
}
