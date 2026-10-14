import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assertElectrostaticRuntimeProbe,ELECTROSTATIC_RUNTIME_PROBE_LIMITS,type ElectrostaticRuntimeProbeEvidence} from '../providers/calculix/ElectrostaticRuntimeProbe.mts';
import {prepareHostTwoLayerElectrostaticStudy} from '../simulation-bridge/electrostaticTwoLayerHostPreparation.mts';
import {preflightHostTwoLayerElectrostaticSource} from '../simulation-bridge/electrostaticTwoLayerPreflight.mts';
const digest='sha256:'+'a'.repeat(64);
const valid:ElectrostaticRuntimeProbeEvidence={args:['-v'],exitCode:201,signal:null,elapsedMs:10,timedOut:false,outputExceeded:false,spawnError:null,cleanupConfirmed:true,diagnostic:'This is Version 2.16\n',executableDigest:digest,currentExecutableDigest:digest};
test('exact supported metadata exit 201 is accepted; timeout/output/process/version/race failures remain distinct',()=>{
 assert.deepEqual(ELECTROSTATIC_RUNTIME_PROBE_LIMITS,{wallMs:5000,cpuMs:5000,memoryBytes:536870912,diagnosticBytes:4096});
 assert.doesNotThrow(()=>assertElectrostaticRuntimeProbe(valid));assert.doesNotThrow(()=>assertElectrostaticRuntimeProbe({...valid,exitCode:0}));
 for(const [changes,code]of [
  [{timedOut:true},'PROBE_TIMEOUT'],[{outputExceeded:true},'PROBE_OUTPUT_LIMIT'],[{diagnostic:'x'.repeat(4097)},'PROBE_OUTPUT_LIMIT'],
  [{exitCode:1},'PROBE_FAILED'],[{signal:'SIGTERM'},'PROBE_FAILED'],[{spawnError:'EACCES'},'PROBE_FAILED'],[{cleanupConfirmed:false},'CLEANUP_UNCONFIRMED'],
  [{currentExecutableDigest:'sha256:'+'b'.repeat(64)},'EXECUTABLE_CHANGED'],[{diagnostic:'This is Version 2.17\n'},'VERSION_INVALID'],
 ] as const)assert.throws(()=>assertElectrostaticRuntimeProbe({...valid,...changes}),error=>{
   const e=error as Error&{details:ElectrostaticRuntimeProbeEvidence};assert.match(e.message,new RegExp(code));assert.equal(e.details.exitCode,changes.exitCode??valid.exitCode);return true;
 });
});
test('protected runtime rejection happens before CAD reads, STEP export, meshing or publication',async()=>{
 let source=0,meshes=0;const failure=Error('ELECTROSTATIC_RUNTIME_PROBE_TIMEOUT');
 await assert.rejects(prepareHostTwoLayerElectrostaticStudy('unit-preflight',{
  storage:{assertReady:async()=>{}} as any,readCurrentRuntimeIdentity:async()=>{throw failure;},
  readLiveInventory:async()=>{source++;throw Error('must not read CAD');},
  mesh:async()=>{meshes++;throw Error('must not mesh');},
 } as any),error=>error===failure);assert.equal(source,0);assert.equal(meshes,0);
});
test('source-only preflight preserves the same early protected runtime gate',async()=>{
 let reads=0,meshes=0;
 await assert.rejects(preflightHostTwoLayerElectrostaticSource({
  storage:{assertReady:async()=>{}} as any,
  readCurrentRuntimeIdentity:async()=>{throw Error('ELECTROSTATIC_RUNTIME_PROBE_TIMEOUT');},
  readLiveInventory:async()=>{reads++;throw Error('CAD must remain unread');},
  mesh:async()=>{meshes++;throw Error('native mesher must remain unreachable');},
 } as any),/ELECTROSTATIC_RUNTIME_PROBE_TIMEOUT/);
 assert.equal(reads,0);assert.equal(meshes,0);
});
