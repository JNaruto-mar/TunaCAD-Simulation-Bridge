// Protocol/policy isolation only: no PowerShell, solver, approvals or live store.
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdtemp, mkdir, lstat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digest } from '../simulation-bridge/stableDigest.mts';
const root=await mkdtemp(join(tmpdir(),'tunacad-native-inspection-unit-'));
const roles=['studies','source-catalog','results','completion-catalog'];
for(const role of roles)await mkdir(join(root,role));
const paths=[root,...roles.map(role=>join(root,role))];
const rows=(targets:string[])=>targets.map(path=>({path,owner:'controlled-unit-owner',directory:paths.includes(path),protected:true,rules:['unit-policy']}));
const identities=[];for(const path of paths){const s=await lstat(path);identities.push({path,device:s.dev,inode:s.ino});}
const config={schema:'tunacad-electrostatic-host-storage/0.1',storageId:'unit',sourceIdentityVersion:'tunacad-electrostatic-native-step-identity/0.1',
  root,roles:Object.fromEntries(roles.map(role=>[role,join(root,role)])),protectionPolicy:'windows-protected-owner-system-administrators/0.1',
  directoryIdentities:identities,protection:rows(paths)};
await writeFile(join(root,'configuration.json'),JSON.stringify(config));
await writeFile(join(root,'source-catalog/configuration.pin.json'),JSON.stringify({schema:'tunacad-electrostatic-host-storage-pin/0.1',configurationDigest:digest(config)}));
let spawns=0,requests=0,mode='valid',last:any;
const original=cp.spawn;
(cp as any).spawn=(exe:string,args:string[],options:any)=>{
  assert.equal(exe,'powershell.exe');assert.equal(options.windowsHide,true);
  assert.deepEqual(options.stdio,['pipe','pipe','pipe']);assert.equal(options.env.TUNACAD_ELECTROSTATIC_ACL_PROVISION,'verify');
  assert.match(args[3],/GetAccessControl/);assert.match(args[3],/Unsupported deny rule/);
  assert.match(args[3],/Owner FullControl missing/);assert.match(args[3],/ReadLine/);
  assert.match(args[3],/SpecialFolder\]::LocalApplicationData/);
  const child:any=new EventEmitter();child.ref=child.unref=()=>child;
  child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.kill=()=>{queueMicrotask(()=>child.emit('exit',0));return true;};
  child.stdin=new Writable({write(data,_encoding,done){
    requests++;const q=JSON.parse(data.toString());assert.match(q.id,/^[a-f0-9-]{36}$/);
    const response:any=q.kind==='acl'?{id:q.id,rows:rows(q.paths)}:{id:q.id,location:'C:\\ControlledOSKnownFolder'};
    if(mode==='denied')response.error='Controlled denied ACL';
    if(mode==='wrong-id')response.id='wrong';
    if(mode==='missing')response.rows=[];
    if(mode==='reordered')response.rows.reverse();
    if(mode==='extra')response.extra=true;
    queueMicrotask(()=>{const text=mode==='malformed'?'not-json\n':JSON.stringify(response)+'\n';
      // Exercise incremental transport, not one-chunk assumptions.
      child.stdout.write(text.slice(0,7));child.stdout.write(text.slice(7));});done();
  }});
  spawns++;last=child;return child;
};syncBuiltinESMExports();
try{
  const {ElectrostaticHostStorage,readNativeWindowsLocalApplicationData,retainNativeStorageInspector}=await import('../simulation-bridge/electrostaticHostStorage.mts');
  const storage=await ElectrostaticHostStorage.open(root);await storage.assertReady();await storage.assertReady();
  assert.equal(spawns,1);assert.equal(requests,6); // every check is fresh; only interpreter reused
  await Promise.all([storage.assertReady(),storage.assertReady()]);assert.equal(requests,10);assert.equal(spawns,1);
  assert.equal(await readNativeWindowsLocalApplicationData(),'C:\\ControlledOSKnownFolder');assert.equal(spawns,1);
  for(const bad of ['denied','wrong-id','missing','reordered','extra','malformed']){
    mode=bad;const count:number=requests;await assert.rejects(()=>storage.assertReady(),/STORAGE_INVALID/);
    assert.equal(requests,count+1,'failed requests must not be retried');
  }
  mode='valid';await storage.assertReady();
  const releaseA=retainNativeStorageInspector(),releaseB=retainNativeStorageInspector();
  const retained=last,countSpawns=spawns;let exits=0;retained.on('exit',()=>exits++);
  await storage.assertReady();assert.equal(spawns,countSpawns);
  releaseA();releaseA();await new Promise(resolve=>setImmediate(resolve));assert.equal(exits,0);
  releaseB();await new Promise(resolve=>setImmediate(resolve));assert.equal(exits,1);
  await storage.assertReady();assert.equal(spawns,countSpawns+1);
  await writeFile(join(root,'configuration.json'),JSON.stringify({...config,storageId:'altered'}));
  const count=requests;await assert.rejects(()=>storage.assertReady(),/configuration\/version changed/);assert.equal(requests,count);
  last.kill();await new Promise(resolve=>setImmediate(resolve));
  console.log(JSON.stringify({pass:true,checks:14,interpreterReuseOnly:true,ownerLeaseSingleUse:true,freshAclRequests:requests,
    malformedCorrelationPolicyAndConfigurationRejected:true,solverExecutions:0,realApprovals:0}));
}finally{cp.spawn=original;syncBuiltinESMExports();}
