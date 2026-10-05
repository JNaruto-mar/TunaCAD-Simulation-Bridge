import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { nativeSimulationLocation,openNativeSimulationStorage,NATIVE_SIMULATION_STORAGE_POLICY,validateNativeWorkflowEntries }
  from '../simulation-bridge/nativeSimulationStorage.mts';
let checks=0;
const workflow=(n:number)=>'workflow-'+n.toString(16).padStart(8,'0')+'-0000-0000-0000-000000000000';
validateNativeWorkflowEntries([]);validateNativeWorkflowEntries(Array.from({length:39},(_,i)=>workflow(i)));checks+=2;
for(const names of [Array.from({length:40},(_,i)=>workflow(i)),['../escape'],['arbitrary-path'],[workflow(1),workflow(1)]]){
  assert.throws(()=>validateNativeWorkflowEntries(names),/workflow/);checks++;
}
const location=nativeSimulationLocation('C:\\OSKnownFolder\\Local');
assert.equal(location.root,'C:\\OSKnownFolder\\Local\\TunaCAD\\Simulation\\protected-v1');checks++;
assert.equal(location.policy,NATIVE_SIMULATION_STORAGE_POLICY);checks++;
assert.equal(Object.isFrozen(location),true);checks++;
assert.deepEqual(nativeSimulationLocation('C:\\OSKnownFolder\\Local\\'),location);checks++;
for(const bad of ['', 'relative', 'C:\\', '\\\\server\\share', 'C:\\Data\\..\\Temp', 'C:\\Data\n']){
  assert.throws(()=>nativeSimulationLocation(bad),/NATIVE_SIMULATION_STORAGE_INVALID/);checks++;
}
for(const bad of [tmpdir(),process.cwd()]){
  assert.throws(()=>nativeSimulationLocation(bad),/temporary\/repository location forbidden/);checks++;
}
// Overrides fail before any OS query, filesystem mutation or storage access.
for(const bad of [{root:location.root},{protectedMeshStorageRoot:location.root},{fixture:true},{provisionIfMissing:'yes'}]){
  await assert.rejects(()=>openNativeSimulationStorage(bad as any),/override forbidden/);checks++;
}
console.log(JSON.stringify({pass:true,checks,evidence:'pure native location policy and override rejection',
  storageDirectoriesCreated:0,fixtureStores:0,solverExecutions:0}));
