// Controlled loader/process fixtures only: no executable, storage or solver.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
const fixture:any={failure:null,driverCalls:0,gmsh:'4.15.2',calc:'2.16',spawn:null};
(globalThis as any).__electricalInitializationFixture=fixture;
const providerURL=new URL('../simulation-bridge/providers.mts',import.meta.url).href;
const lifecycleURL=new URL('../providers/processLifecycle.mts',import.meta.url).href;
const classes=['ComposedSimulationProvider','ComposedSimulationProviderV2','ComposedElectrostaticProvider','GmshMeshProvider','GmshMultiDomainMeshProvider','CalculiXSolverProvider','CalculiXMultiDomainSolverProvider'];
const hooks=registerHooks({resolve(specifier,context,next){
 if(context.parentURL===providerURL){
  if(specifier==='node:child_process')return {url:'fixture:versions',shortCircuit:true};
  if(specifier==='node:fs')return {url:'fixture:filesystem',shortCircuit:true};
  const name=classes.find(c=>specifier.endsWith('/'+c+'.mts'));if(name)return {url:'fixture:'+name,shortCircuit:true};
  if(specifier.endsWith('/CalculiXElectrostaticExecution.mts'))return {url:'fixture:driver',shortCircuit:true};
 }
 if(context.parentURL===lifecycleURL&&specifier==='node:child_process')return {url:'fixture:spawn',shortCircuit:true};
 return next(specifier,context);
},load(url,context,next){
 if(!url.startsWith('fixture:'))return next(url,context);
 const f='globalThis.__electricalInitializationFixture',name=url.slice(8);let source='';
 if(name==='versions')source=`import {promisify} from 'node:util';export const execFile=Object.assign(()=>{}, {[promisify.custom]:async(exe,args)=>({stdout:args[0]==='-info'?'Gmsh Version: '+${f}.gmsh:'This is Version '+${f}.calc,stderr:''})});`;
 else if(name==='filesystem')source='export const existsSync=()=>true;export const readdirSync=()=>[];';
 else if(name==='driver')source=`export class CalculiXElectrostaticExecution {async readCurrentRuntimeIdentity(){${f}.driverCalls++;if(${f}.failure)throw ${f}.failure;return {engineVersion:'2.16'};}}`;
 else if(name==='spawn')source=`export const spawn=(exe,args,opts)=>{${f}.spawn={args,opts};return {};};`;
 else source=`export class ${name} {constructor(options){this.capabilities={analysisTypes:[],...options};this.id=options.id;this.version=options.version;}}`;
 return {format:'module',source,shortCircuit:true};
}});
try{
 const {loadExternalPipeline}=await import(providerURL),paths=[resolve('fixture/gmsh.exe'),resolve('fixture/ccx216.exe')] as const;
 const p={elapsedMs:5001,exitCode:null,timedOut:true,cleanupConfirmed:true,diagnostic:'do-not-expose private diagnostic'};
 fixture.failure=Object.assign(Error('ELECTROSTATIC_RUNTIME_PROBE_TIMEOUT'),{code:'ELECTROSTATIC_RUNTIME_PROBE_TIMEOUT',details:p});
 let pipeline=await loadExternalPipeline(...paths,{discovery:false});assert.equal(pipeline.providerElectrical,null);assert.equal(pipeline.readiness.electrostaticInitialization.code,'ELECTROSTATIC_RUNTIME_PROBE_TIMEOUT');assert.equal(pipeline.readiness.electrostaticInitialization.retryable,true);assert.doesNotMatch(JSON.stringify(pipeline.readiness),/do-not-expose/);
 fixture.failure.details.cleanupConfirmed=false;pipeline=await loadExternalPipeline(...paths,{discovery:false});assert.equal(pipeline.readiness.electrostaticInitialization.retryable,false);
 for(const phase of ['launcher_bootstrap','output_drain']){const code=phase==='launcher_bootstrap'?'ELECTROSTATIC_RUNTIME_PROBE_LAUNCHER_TIMEOUT':'ELECTROSTATIC_RUNTIME_PROBE_DRAIN_TIMEOUT';fixture.failure=Object.assign(Error(code),{code,details:{...p,phase,launcherMs:1200,nativeMs:30}});pipeline=await loadExternalPipeline(...paths,{discovery:false});assert.equal(pipeline.readiness.electrostaticInitialization.code,code);assert.equal(pipeline.readiness.electrostaticInitialization.retryable,false);assert.equal(pipeline.readiness.electrostaticInitialization.probe?.phase,phase);assert.equal(pipeline.readiness.electrostaticInitialization.probe?.nativeMs,30);assert.doesNotMatch(JSON.stringify(pipeline.readiness),/do-not-expose/);}
 fixture.failure=Error('do-not-expose credentials and private path');pipeline=await loadExternalPipeline(...paths,{discovery:false});assert.equal(pipeline.readiness.electrostaticInitialization.code,'ELECTROSTATIC_PROVIDER_INITIALIZATION_FAILED');assert.doesNotMatch(JSON.stringify(pipeline.readiness),/do-not-expose/);
 fixture.failure=null;pipeline=await loadExternalPipeline(...paths,{discovery:false});assert(pipeline.providerElectrical);assert.equal(pipeline.readiness.electrostaticInitialization.stage,'ready');assert.equal(pipeline.readiness.electrostaticInitialization.code,null);
 const calls=fixture.driverCalls;fixture.gmsh='4.15.1';pipeline=await loadExternalPipeline(...paths,{discovery:false});assert.equal(pipeline.readiness.electrostaticInitialization.code,'ELECTROSTATIC_RUNTIME_VERSIONS_UNSUPPORTED');assert.equal(fixture.driverCalls,calls);
 const {spawnProviderProcess}=await import(lifecycleURL);
 spawnProviderProcess(paths[1],['-v'],{cwd:resolve('fixture'),stdio:['ignore','pipe','pipe']},{cpuTimeLimitMs:5000,memoryLimitBytes:512*1024**2,startSuspended:true,identityProbeWallMs:5000});
 if(process.platform==='win32'&&process.arch==='x64'){assert(fixture.spawn.args.includes('-StartSuspended'));assert.equal(fixture.spawn.args[fixture.spawn.args.indexOf('-IdentityProbeWallMs')+1],'5000');assert.equal(fixture.spawn.args[fixture.spawn.args.indexOf('-CpuTimeLimitMs')+1],'5000');assert.equal(fixture.spawn.args[fixture.spawn.args.indexOf('-MemoryLimitBytes')+1],String(512*1024**2));}
 const ps=await readFile(new URL('../providers/windowsJobObjectRunner.ps1',import.meta.url),'utf8'),start=ps.indexOf('if ($LauncherTelemetry -or $StartSuspended)');assert(start>0);assert(ps.indexOf('$nativeChild.AssignAndVerify($job)',start)<ps.indexOf('$nativeChild.Resume()',start));
 console.log('PASS initialization reason retention/redaction, cleanup-gated retry, supported versions and suspended metadata admission; no native process.');
}finally{hooks.deregister();delete (globalThis as any).__electricalInitializationFixture;}
