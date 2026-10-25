// New disposable directories only. No owner, protected store, browser or solver.
import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {registerHooks} from 'node:module';
import {lstat,writeFile,readFile} from 'node:fs/promises';
export async function validateJobWorkspace(){
const {SimulationJobWorkspace,readSimulationJson,writeSimulationJsonOnce}=await import('../simulation-bridge/simulationJobWorkspace.mts');
let checks=0;
const job=await SimulationJobWorkspace.create();
const record=join(job.paths.results,'numerical.json'),data={synthetic:true,values:[1,2,3]};
await writeSimulationJsonOnce(record,data);assert.deepEqual(await readSimulationJson(record),data);checks++;
// Exercise actual record-store factories with legacy provisioning/opening
// trapped. A new-job path must resolve its registered workspace exclusively.
const legacy=(await import('../simulation-bridge/electrostaticHostStorage.mts')).ElectrostaticHostStorage;
const oldOpen=legacy.open,oldProvision=legacy.provisionNew;
legacy.open=async()=>assert.fail('NEW_JOB_OPENED_PROTECTED_V1');legacy.provisionNew=async()=>assert.fail('NEW_JOB_PROVISIONED_PROTECTED_V1');
try{
 const exports=await(await import('../simulation-bridge/privateExplicitExportStore.mts')).openPrivateExplicitExportStore(job.root);
 await assert.rejects(()=>exports.read('export-11111111-1111-4111-8111-111111111111'),{code:'ENOENT'});checks++;
 const meshes=await(await import('../simulation-bridge/privateExplicitMeshStore.mts')).openPrivateExplicitMeshStore(job.root);
 assert.equal(await meshes.readExact('missing' as any,{} as any,{} as any),null);checks++;
}finally{legacy.open=oldOpen;legacy.provisionNew=oldProvision;}
await assert.rejects(()=>job.write(join(job.root,'..','unrelated.json'),new Uint8Array([1])),/PATH/);checks++;
await assert.rejects(()=>writeSimulationJsonOnce(record,{...data,values:[4]}),/IMMUTABLE/);checks++;
await assert.rejects(()=>job.write(join(job.paths.results,'large.json'),new Uint8Array(5),4),/BOUND/);checks++;
const tamper=join(job.paths.results,'tamper.json');await writeSimulationJsonOnce(tamper,data);await writeFile(tamper,JSON.stringify({...data,values:[9,2,3]}));
await assert.rejects(()=>readSimulationJson(tamper),/INTEGRITY|FILE/);await writeFile(tamper,JSON.stringify(data));checks++;
const child=await SimulationJobWorkspace.create(job);await writeSimulationJsonOnce(join(child.paths.results,'child.json'),{synthetic:true});checks++;
let complete!:()=>void,entered!:()=>void,cleaned=false;
const ready=new Promise<void>(r=>entered=r),held=new Promise<void>(r=>complete=r);
const cleaning=job.cleanup(async()=>{entered();await held;}).then(()=>cleaned=true);await ready;
assert.equal(cleaned,false);assert.equal((await lstat(job.root)).isDirectory(),true);
await assert.rejects(()=>writeSimulationJsonOnce(join(job.paths.results,'late.json'),data),/CLOSED/);complete();await cleaning;
await assert.rejects(()=>writeSimulationJsonOnce(join(child.paths.results,'late.json'),data),/CLOSED/);checks++;
await assert.rejects(()=>lstat(job.root),{code:'ENOENT'});assert.deepEqual(await readSimulationJson(record),data);
assert.deepEqual(await readSimulationJson(join(child.paths.results,'child.json')),{synthetic:true});checks++;
await job.cleanup(async()=>assert.fail('no repeated cleanup'));job.dispose();checks++;
const uncertain=await SimulationJobWorkspace.create(),path=join(uncertain.paths.results,'retained.json');
await writeSimulationJsonOnce(path,data);const failure=Error('CONTROLLED_NATIVE_STILL_ACTIVE');
await assert.rejects(()=>uncertain.cleanup(async()=>{throw failure;}),e=>e===failure);
assert.equal((await lstat(uncertain.root)).isDirectory(),true);assert.deepEqual(JSON.parse(await readFile(path,'utf8')),data);checks++;
// The deliberately unconfirmed fixture is retained. Never infer a shutdown.
const policy=await readFile(resolve('simulation-bridge/privateExplicitOperatorBridge.mts'),'utf8');
assert.equal(policy.includes('openNativeSimulationWorkflowStorage'),false);assert.equal(policy.includes('retainNativeStorageInspector'),false);checks++;
console.log(JSON.stringify({status:'PASS',checks,protectedStorageOperations:0,solvers:0,uncertainFixtureRetained:true,engineeringUsePermitted:false}));

}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
if(process.argv.includes('--controlled-acl')){
 const mock=`export const execFile=()=>{throw Error('UNEXPECTED_NATIVE_HELPER');};execFile[Symbol.for('nodejs.util.promisify.custom')]=async(exe,args,options)=>({stdout:JSON.stringify(JSON.parse(options.env.TUNACAD_ELECTROSTATIC_ACL_TARGETS).map(path=>({path,directory:true,protected:true}))),stderr:''});`;
 const hook=registerHooks({resolve(specifier,context,next){return specifier==='node:child_process'&&context.parentURL?.endsWith('/simulationJobWorkspace.mts')?{url:'data:text/javascript,'+encodeURIComponent(mock),shortCircuit:true}:next(specifier,context);}});
 try{await validateJobWorkspace();console.log('ACL evidence: CONTROLLED ONLY; real Windows ACL provisioning NOT VERIFIED');}finally{hook.deregister();}
}else await validateJobWorkspace();
}
