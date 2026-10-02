// No solver imports or executions. Fake executable bytes are never launched.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat, utimes, symlink, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { OPENRADIOSS_RUNTIME_POLICY as policy, OPENRADIOSS_RUNTIME_SPECIFICATIONS as specs,
  validateOpenRadiossRuntimeManifest as validate } from '../providers/openradioss/OpenRadiossRuntimeManifest.mts';
import { inspectOpenRadiossInstallation as inspect, sha256 } from '../providers/openradioss/OpenRadiossInstallation.mts';
let checks=0;const pass=(label:string)=>{checks++;console.log('PASS '+label);};
const files=specs.map(s=>({path:s.path,bytes:1,sha256:'a'.repeat(64)}));
assert.equal(specs.length,86);assert.equal(specs.filter(s=>s.category==='UNRESOLVED').length,5);
assert.equal(specs.filter(s=>s.category==='STARTER_RUNTIME_REQUIRED').length,7);
const original=validate(files);pass('exact allowlist/classifications');
for(const delta of [-1,0,1]) {
  const boundary=structuredClone(files);boundary[0].bytes=policy.maximumFileBytes;
  boundary[1].bytes=policy.maximumFileBytes-100;boundary[2].bytes=100-(files.length-3)+delta;
  if(delta>0) assert.throws(()=>validate(boundary),/aggregate byte bound/);
  else assert.equal(validate(boundary).totalBytes,policy.maximumTotalBytes+delta);
  pass('aggregate '+(delta<0?'just below':delta===0?'exactly at':'above')+' limit (metadata only)');
}
const mutate=(fn:(copy:typeof files)=>void,pattern:RegExp)=>{const copy=structuredClone(files);fn(copy);assert.throws(()=>validate(copy),pattern);};
assert.throws(()=>validate(Array.from({length:policy.maximumFiles+1},()=>files[0])),/file-count/);pass('file-count limit');
mutate(f=>{f[0].bytes=policy.maximumFileBytes+1;},/individual file/);pass('single-file limit');
mutate(f=>{f[0].path='exec/unexpected.dll';},/unexpected/);pass('unexpected file');
mutate(f=>{f.pop();},/missing/);pass('missing required file');
mutate(f=>{f.push({...f[0]});},/duplicate/);pass('duplicate path');
mutate(f=>{f.push({...f[0],path:f[0].path.toUpperCase()});},/duplicate/);pass('case-ambiguous duplicate');
for(const path of ['../exec/engine_win64.exe','exec/../exec/engine_win64.exe','/exec/engine_win64.exe','C:/escape','a\0b','a/'.repeat(9)+'file']) {
  mutate(f=>{f[0].path=path;},/path traversal/);
}pass('traversal/absolute/NUL/depth');
mutate(f=>{f[0].sha256='not-a-digest';},/invalid digest/);pass('malformed SHA-256');
assert.deepEqual(validate([...files].reverse()),original);
assert.deepEqual(validate(files.map(f=>({...f,path:f.path.replaceAll('/','\\')}))),original);pass('deterministic path/order/digest');
const changed=structuredClone(files);changed[0].sha256='b'.repeat(64);
assert.notEqual(validate(changed).manifestDigest,original.manifestDigest);pass('changed full-file digest changes manifest');
const directory=await mkdtemp(join(tmpdir(),'tunacad-openradioss-policy-')),root=join(directory,'installation');
const data=Buffer.from('bounded-runtime-fixture');
for(const s of specs) {const path=join(root,s.path);await mkdir(dirname(path),{recursive:true});await writeFile(path,new Uint8Array(data));}
await mkdir(join(root,'licenses'),{recursive:true});await writeFile(join(root,'COPYRIGHT.md'),'test notice');
const config={root,starterExecutable:join(root,'exec/starter_win64.exe'),engineExecutable:join(root,'exec/engine_win64.exe'),
  runtimeVersion:'2026' as const,starterSha256:sha256(data),engineSha256:sha256(data)};
const installed=await inspect(config);assert.equal(installed.identity.files.length,86);pass('fake installation preflight only');
const dll=join(root,'extlib/intelOneAPI_runtime/win64/libmmd.dll'),stamp=await stat(dll);
await writeFile(dll,'changed-runtime-fixture');await utimes(dll,stamp.atime,stamp.mtime);
assert.equal((await stat(dll)).size,stamp.size);
const contentChanged=await inspect(config);assert.notEqual(contentChanged.runtimeDigest,installed.runtimeDigest);
assert.notEqual(contentChanged.manifestDigest,installed.manifestDigest);pass('same-size/time change is fully rehashed (no cache)');
await writeFile(dll,new Uint8Array(data));
await assert.rejects(()=>inspect({...config,engineSha256:'0'.repeat(64)}),/executable identity mismatch/);pass('executable pin mismatch');
await rename(dll,dll+'.test-original');await assert.rejects(()=>inspect(config),/missing/);
await rename(dll+'.test-original',dll);pass('filesystem missing required DLL');
const extra=join(root,'extlib/intelOneAPI_runtime/win64/unknown.dll');await writeFile(extra,'unexpected');
await assert.rejects(()=>inspect(config),/unexpected/);await rename(extra,extra+'.test-unused');pass('filesystem unexpected DLL');
const configExtra=join(root,'hm_cfg_files/messages/unknown.cfg');await writeFile(configExtra,'unexpected');
await assert.rejects(()=>inspect(config),/unexpected/);await rename(configExtra,join(directory,'unused.cfg'));pass('filesystem unexpected config');
const realDir=join(root,'extlib/h3d/lib/win64'),moved=join(directory,'original-h3d');
await rename(realDir,moved);await symlink(moved,realDir,'junction');
await assert.rejects(()=>inspect(config),/redirected|linked/);pass('junction/reparse escape rejected');
// Keep isolated fixtures for diagnostics; do not delete unrelated temporary files.
console.log(JSON.stringify({result:'PASS',checks,solverExecutions:0,directory,maximumTotalBytes:policy.maximumTotalBytes}));
