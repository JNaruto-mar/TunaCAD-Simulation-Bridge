// Inert process transport: exercises the actual timeout/quarantine lifecycle.
// Never launches a mesher, solver, shell, or other child process.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { registerHooks } from 'node:module';
import { dirname, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { stat } from 'node:fs/promises';
import * as lifecycle from '../providers/processLifecycle.mts';

let child, terminated=0, stopped=0, removed=0, cleanup;
globalThis.__thermalTimeoutTransport={...lifecycle,
 spawnProviderProcess(){child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();return child;},
 monitorWorkingDirectory(){return ()=>{stopped++;};},
 async terminateChildProcess(){terminated++;return true;},
 async removeWorkingDirectory(directory){
  assert.equal(resolve(dirname(directory)),resolve(tmpdir()));
  assert(basename(directory).startsWith('tunacad-calculix-v2-'));
  const result=await lifecycle.removeWorkingDirectory(directory);removed++;cleanup?.();return result;
 },
};
const source=Object.keys(lifecycle).map(name=>`export const ${name}=globalThis.__thermalTimeoutTransport.${name};`).join('\n');
const hook=registerHooks({resolve(specifier,context,next){
 if(context.parentURL?.endsWith('/CalculiXMultiDomainSolverProvider.mts')&&specifier==='../processLifecycle.mts'){
  return {url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true};
 }
 return next(specifier,context);
}});
try{
 const {CalculiXMultiDomainSolverProvider}=await import('../providers/calculix/CalculiXMultiDomainSolverProvider.mts');
 const {makeRequest,makeModel}=await import('./fixtures/thermalTransportFixture.mts');
 for(const withOutput of [true,false]){
  const provider=new CalculiXMultiDomainSolverProvider({executable:'fixture/ccx216.exe',runtimeVersion:'2.16'});
  assert.equal(provider.capabilities.execution.executionTimeoutMs,120000);
  assert.equal(provider.capabilities.execution.resourceLimits.maximumDiagnosticCharacters,12000);
  // Only the inert unit fixture's clock is shortened; no native process exists.
  provider.capabilities.execution.executionTimeoutMs=20;
  const request=makeRequest('steady_thermal'),model=makeModel(request);
  const cleaned=new Promise(resolve=>{cleanup=resolve;});
  const submission=await provider.submit(request,model);
  const directory=provider.runs.get(submission.providerRunId).directory;
  if(withOutput){child.stdout.write('EARLY_DROPPED'+'.'.repeat(14000));child.stderr.write('LATEST_SOLVER_DIAGNOSTIC');}
  let watchdog;
  try{await Promise.race([cleaned,new Promise((_,reject)=>{watchdog=setTimeout(()=>reject(Error('Inert timeout cleanup stalled')),2000);})]);}
  finally{clearTimeout(watchdog);}
  const status=await provider.getStatus(submission.providerRunId);
  assert.equal(status.status,'failed');assert.equal(status.failure.code,'SIMULATION_TIMEOUT');
  assert(status.failure.message.length<=2000);
  if(withOutput){assert.match(status.failure.message,/LATEST_SOLVER_DIAGNOSTIC/);assert.doesNotMatch(status.failure.message,/EARLY_DROPPED/);}
  else assert.match(status.failure.message,/No solver output was received/);
  assert.equal(await provider.getResult(submission.providerRunId),null);
  await assert.rejects(()=>provider.getFieldDataset(submission.providerRunId,'foreign'),/Unknown or expired/);
  await assert.rejects(()=>stat(directory),{code:'ENOENT'});
 }
 assert.equal(terminated,2);assert.equal(stopped,2);assert.equal(removed,2);
 console.log('Thermal timeout diagnostic tail / no-output / quarantine / cleanup PASS; native executions = 0');
}finally{hook.deregister();delete globalThis.__thermalTimeoutTransport;}
