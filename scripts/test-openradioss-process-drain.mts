// Solver-free Windows launcher regression. Node emits pipe-sized diagnostic
// output or waits for selected cancellation; no solver or protected storage.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nativeOpenRadiossProcessDriver} from '../providers/openradioss/OpenRadiossProcess.mts';
if(process.platform!=='win32')throw Error('Windows launcher check requires Windows');
const executable=process.execPath,sha=createHash('sha256').update(await readFile(executable)).digest('hex');
const directory=await mkdtemp(join(tmpdir(),'tunacad-launcher-offline-'));
let task:Awaited<ReturnType<typeof nativeOpenRadiossProcessDriver.start>>|undefined;
try{
 const events:string[]=[];
 task=await nativeOpenRadiossProcessDriver.start(executable,['-e',"process.stdout.write('x'.repeat(131072));process.stderr.write('y'.repeat(131072));"],{cwd:directory,environment:{...process.env},telemetry:{stage:'starter',executableSha256:sha,inputDigest:'sha256:'+'a'.repeat(64),launchId:'offline-output',async retain(event){events.push(event.event);}}});
 const result=await task.completion;
 assert.equal(result.exitCode,0,JSON.stringify(result));assert.equal(result.error,null);assert.equal(result.treeTerminated,true);
 assert.equal(result.stdout.length,131072);assert.equal(result.stderr.length,131072);assert.equal(events.length,7);
 console.log('PASS actual Windows launcher drains both full pipes and proves job empty; native solvers=0');
 task=undefined;
 let resumed!:()=>void;const ready=new Promise<void>(yes=>{resumed=yes;});
 task=await nativeOpenRadiossProcessDriver.start(executable,['-e',"setInterval(()=>{},1000)"],{cwd:directory,environment:{...process.env},telemetry:{stage:'starter',executableSha256:sha,inputDigest:'sha256:'+'b'.repeat(64),launchId:'offline-cancel',async retain(event){if(event.event==='child_resumed')resumed();}}});
 await ready;
 assert.equal(await task.terminateTree(),true,'Known owned wrapper/child cancellation must settle');
 assert.equal((await task.completion).treeTerminated,true);
 task=undefined;
 console.log('PASS selected owned process cancellation drains completion; native solvers=0');
}finally{
 if(task&&!await task.terminateTree())throw Error('OFFLINE_CHILD_CLEANUP_UNCONFIRMED');
 await rm(directory,{recursive:true});
}
