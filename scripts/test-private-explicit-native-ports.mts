import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ElectrostaticHostStorage } from '../simulation-bridge/electrostaticHostStorage.mts';
import { assertPrivateExplicitLiveStorageRoot,isNativePrivateExplicitOwner,openPrivateExplicitOperatorHostPorts,
  createPrivateExplicitRuntimeReader,PRIVATE_EXPLICIT_VALIDATED_RUNTIME_MANIFEST } from '../simulation-bridge/privateExplicitOperatorBridge.mts';
const config={purpose:'private_explicit_operator_controller' as const,allowedOrigin:'http://127.0.0.1:8080',
  protectedMeshStorageRoot:join(tmpdir(),'not-a-live-store'),expectedManifestDigest:PRIVATE_EXPLICIT_VALIDATED_RUNTIME_MANIFEST,
  installation:{root:'relative',starterExecutable:'relative',engineExecutable:'relative',runtimeVersion:'2026' as const,
    starterSha256:'a'.repeat(64),engineSha256:'b'.repeat(64)}};
let checks=0,opened=0;const originalOpen=ElectrostaticHostStorage.open;
const prior=process.env.TUNACAD_PRIVATE_EXPLICIT_FIXTURE;
try {
  assert.equal(isNativePrivateExplicitOwner({native:true,liveReady:true}),false);checks++;
  assert.throws(()=>assertPrivateExplicitLiveStorageRoot('relative'),/LIVE_STORAGE_REQUIRED/);checks++;
  assert.throws(()=>assertPrivateExplicitLiveStorageRoot(config.protectedMeshStorageRoot),/LIVE_STORAGE_REQUIRED/);checks++;
  assert.throws(()=>assertPrivateExplicitLiveStorageRoot(join(process.cwd(),'artifacts','protected')),/LIVE_STORAGE_REQUIRED/);checks++;
  ElectrostaticHostStorage.open=async()=>{opened++;throw new Error('native storage unavailable');};
  process.env.TUNACAD_PRIVATE_EXPLICIT_FIXTURE='1';
  await assert.rejects(()=>openPrivateExplicitOperatorHostPorts(config),/NATIVE_ROOT_OVERRIDE_FORBIDDEN/);assert.equal(opened,0);checks++;
  await assert.rejects(()=>openPrivateExplicitOperatorHostPorts({...config,expectedManifestDigest:'sha256:'+'0'.repeat(64)}),/RUNTIME_RESEAL_REQUIRED/);
  assert.equal(opened,0);checks++;
  await assert.rejects(()=>createPrivateExplicitRuntimeReader(config.installation,config.expectedManifestDigest)(),/explicit supported paths/);checks++;
  console.log(JSON.stringify({pass:true,checks,evidence:'native-owner provenance, temporary/repository-root rejection, no env fallback and runtime pin guards',
    nativeStorageProvisioned:false,runtimeExecutions:0,realWindow:false}));
}finally{ElectrostaticHostStorage.open=originalOpen;
  if(prior===undefined)delete process.env.TUNACAD_PRIVATE_EXPLICIT_FIXTURE;else process.env.TUNACAD_PRIVATE_EXPLICIT_FIXTURE=prior;}
