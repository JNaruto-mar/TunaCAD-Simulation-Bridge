// Read-only installed-runtime audit. Does not use or change provider admission.
import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { readFile, readdir, lstat, realpath, mkdtemp, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { digest } from '../simulation-bridge/stableDigest.mts';
const root=resolve(process.env.TUNACAD_OPENRADIOSS_ROOT!);
assert.ok(process.env.TUNACAD_OPENRADIOSS_ROOT,'Explicit installation required');
const paths=[join(root,'exec','starter_win64.exe'),join(root,'exec','engine_win64.exe'),join(root,'COPYRIGHT.md')];
let entries=0;
async function walk(path:string,depth=0) {
  assert.ok(depth<=8&&++entries<=10000,'Bounded selected-root traversal');
  assert.ok(!(await lstat(path)).isSymbolicLink());assert.equal(await realpath(path),resolve(path));
  for(const item of await readdir(path,{withFileTypes:true})) {
    assert.ok(!item.isSymbolicLink());
    if(item.isDirectory()) await walk(join(path,item.name),depth+1);
    else if(item.isFile()) paths.push(join(path,item.name));else assert.fail('Unexpected entry');
  }
}
for(const suffix of ['hm_cfg_files/config/CFG/radioss2026','hm_cfg_files/config/CFG/UNITS','hm_cfg_files/messages']) await walk(join(root,suffix));
for(const suffix of ['extlib/hm_reader/win64','extlib/intelOneAPI_runtime/win64','extlib/h3d/lib/win64'])
  for(const entry of await readdir(join(root,suffix),{withFileTypes:true})) if(entry.name.endsWith('.dll')) {
    assert.ok(entry.isFile()&&!entry.isSymbolicLink());paths.push(join(root,suffix,entry.name));
  }
function peImports(b:Buffer) {
  const pe=b.readUInt32LE(60);assert.equal(b.toString('ascii',pe,pe+4),'PE\0\0');
  const n=b.readUInt16LE(pe+6),opt=pe+24,size=b.readUInt16LE(pe+20);assert.ok(n>0&&n<=96);
  assert.equal(b.readUInt16LE(opt),0x20b,'Selected 64-bit PE');
  const offset=(rva:number)=>{
    for(let i=0;i<n;i++) {const s=opt+size+40*i,va=b.readUInt32LE(s+12),length=b.readUInt32LE(s+16);
      if(rva>=va&&rva<va+length) return b.readUInt32LE(s+20)+rva-va;}
    throw new Error('Unmapped import RVA');
  };
  const address=b.readUInt32LE(opt+112+8),result:string[]=[];assert.ok(address>0);
  let pos=offset(address);
  for(let i=0;i<256;i++,pos+=20) {const name=b.readUInt32LE(pos+12);if(name===0)return result;
    const at=offset(name),end=b.indexOf(0,at);assert.ok(end>at&&end-at<256);result.push(b.toString('ascii',at,end));}
  throw new Error('Unbounded PE import table');
}
const files=[];
for(const path of paths.sort()) {
  const before=await lstat(path);assert.ok(before.isFile()&&!before.isSymbolicLink()&&before.size<=256*1024*1024);
  assert.equal(await realpath(path),resolve(path));
  const hash=createHash('sha256');let count=0;
  for await(const bytes of createReadStream(path,{highWaterMark:1024*1024})) {count+=bytes.length;hash.update(bytes);}
  const after=await lstat(path);assert.equal(count,before.size);assert.equal(after.size,before.size);assert.equal(after.mtimeMs,before.mtimeMs);
  const name=relative(root,path).replace(/\\/g,'/');
  let category='UNRESOLVED',starter='unresolved',engine='unresolved',purpose='Configured runtime-search location; exact bounded-deck use not proven; retain conservatively';
  if(name==='exec/starter_win64.exe') {category='STARTER_RUNTIME_REQUIRED';starter='required';engine='not_required';purpose='Selected Starter';}
  else if(name==='exec/engine_win64.exe') {category='ENGINE_RUNTIME_REQUIRED';starter='not_required';engine='required';purpose='Selected Engine';}
  else if(name.endsWith('/hm_reader_win64.dll')) {category='STARTER_RUNTIME_REQUIRED';starter='required';engine='not_required';purpose='Direct Starter PE import: model/configuration reader';}
  else if(name.endsWith('/libiomp5md.dll')) {category='SHARED_RUNTIME_REQUIRED';starter='required';engine='required';purpose='Direct PE import of both executables: OpenMP';}
  else if(/\/mkl_(?:intel_thread|core|def|avx2|avx512)\.2\.dll$/.test(name)) {category='STARTER_RUNTIME_REQUIRED';starter=name.includes('intel_thread')?'required':'conditional_runtime_closure';engine='not_required';purpose='Starter MKL threading import and shipped Intel CPU-dispatch closure; not solver precision/MPI variants';}
  else if(name.startsWith('hm_cfg_files/')) {category='CONFIG_REQUIRED';starter='conditional_configuration_closure';engine='not_required';purpose='RAD_CFG_PATH input hierarchy/units/messages; whole selected closure, not proof every card is read';}
  else if(name==='COPYRIGHT.md') {category='NOT_EXECUTION_REQUIRED';starter='not_required';engine='not_required';purpose='License notice, not model/runtime input; separate audit/compliance metadata';}
  files.push({path:name,bytes:count,sha256:hash.digest('hex'),category,purpose,starter,engine,
    configurationOrRuntimeData:!name.startsWith('exec/'),adjacentTooling:false,
    ...(name.endsWith('.dll')||name.endsWith('.exe')?{peImports:peImports(await readFile(path))}:{})});
}
assert.equal(files.length,87);assert.equal(files.reduce((s,f)=>s+f.bytes,0),456155074);
assert.ok(files.find(f=>f.path==='exec/starter_win64.exe')!.peImports!.includes('mkl_intel_thread.2.dll'));
const grouped=Object.fromEntries([...new Set(files.map(f=>f.category))].sort().map(category=>[category,
  {files:files.filter(f=>f.category===category).length,bytes:files.filter(f=>f.category===category).reduce((s,f)=>s+f.bytes,0)}]));
const requiredClosureBytes=files.filter(f=>!['UNRESOLVED','NOT_EXECUTION_REQUIRED'].includes(f.category)).reduce((s,f)=>s+f.bytes,0);
const runtime=files.filter(f=>f.category!=='NOT_EXECUTION_REQUIRED').map(({path,bytes,sha256})=>({path,bytes,sha256}));
const report={schema:'tunacad-openradioss-runtime-audit/0.1',at:new Date().toISOString(),realSolverProcesses:0,
  originalFiles:files.length,originalBytes:456155074,requiredClosureBytes,executionFiles:runtime.length,
  executionBytes:runtime.reduce((s,f)=>s+f.bytes,0),manifestDigest:digest(runtime),grouped,
  largest:[...files].sort((a,b)=>b.bytes-a.bytes).slice(0,10),files,
  sourceReferences:['https://raw.githubusercontent.com/OpenRadioss/OpenRadioss/a62b27e6baa555d222a580d6218867d0be4d70b5/INSTALL.md',
    'https://www.intel.com/content/www/us/en/docs/onemkl/developer-guide-windows/2023-0/contents-of-the-redist-intel64-directory.html',
    'https://learn.microsoft.com/en-us/windows/win32/debug/pe-format'],
  limitations:['Static PE imports do not enumerate dynamic loading; UNRESOLVED files stay pinned.',
    'Per-CPU MKL selection is conditional; requiredClosureBytes includes shipped dynamic-dispatch closure.',
    'Frozen Windows compiler-source paths queried were unavailable; no inference from unavailable source.',
    'Windows system libraries are host prerequisites, not redistributed installation files.']};
const output=await mkdtemp(join(tmpdir(),'tunacad-openradioss-runtime-audit-'));
await writeFile(join(output,'runtime-audit.json'),JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({output,...report,files:undefined,largest:report.largest.map(f=>({path:f.path,bytes:f.bytes,category:f.category}))}));
