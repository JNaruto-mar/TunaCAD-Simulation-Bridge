import { readdir, lstat, realpath, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { digest } from '../../simulation-bridge/stableDigest.mts';
import { OPENRADIOSS_RUNTIME_POLICY as policy, OPENRADIOSS_RUNTIME_SPECIFICATIONS,
  validateOpenRadiossRuntimeManifest, type RuntimeFile } from './OpenRadiossRuntimeManifest.mts';
export const sha256=(b:Buffer|string)=>createHash('sha256').update(typeof b==='string'?b:new Uint8Array(b)).digest('hex');
export interface OpenRadiossInstallation {
  root:string; starterExecutable:string; engineExecutable:string; runtimeVersion:'2026';
  starterSha256:string; engineSha256:string;
}
const nativeInspections = new WeakMap<object,{configDigest:string;valueDigest:string;startedAt:number}>();
/** One-use native evidence from THIS verification boundary, never JSON or a
 * historical inspection. Allows host/provider to share a single fresh hash
 * operation, not to cache runtime trust between boundaries. */
export function consumeNativeOpenRadiossInspection(config:OpenRadiossInstallation,value:any,notBefore:number){
  const proof=value&&nativeInspections.get(value);
  if(!proof||proof.configDigest!==digest(config)||proof.valueDigest!==digest(value)||proof.startedAt<notBefore)
    throw new Error('OpenRadioss native inspection stale/untrusted/changed');
  nativeInspections.delete(value);
  return value as Awaited<ReturnType<typeof inspectOpenRadiossInstallation>>;
}
/** Explicit paths, complete content hashing on EVERY read. Never executes a
 * program, searches PATH, caches metadata as trust, or accepts a study manifest.
 * Release path changes require a new audited policy, not automatic discovery. */
export async function inspectOpenRadiossInstallation(config:OpenRadiossInstallation) {
  const startedAt=performance.now();
  const fail=(why:string):never=>{throw new Error('OpenRadioss installation: '+why);};
  if(config.runtimeVersion!=='2026'||[config.root,config.starterExecutable,config.engineExecutable].some(p=>!isAbsolute(p))||
    basename(config.starterExecutable)!=='starter_win64.exe'||basename(config.engineExecutable)!=='engine_win64.exe'||
    [config.starterSha256,config.engineSha256].some(h=>!/^[a-f0-9]{64}$/.test(h))) fail('explicit supported paths/version/fingerprints required');
  const root=resolve(config.root),allowed=new Set(OPENRADIOSS_RUNTIME_SPECIFICATIONS.map(s=>s.path));
  const normal=(path:string)=>relative(root,path).replace(/\\/g,'/');
  const check=async(path:string,kind:'file'|'directory')=>{
    const s=await lstat(path);
    if(s.isSymbolicLink()||!(kind==='file'?s.isFile():s.isDirectory())||await realpath(path)!==resolve(path))
      fail('missing, ambiguous or redirected installation');
    return s;
  };
  // Checking every ancestor also rejects a junction above an approved file.
  const directoryPhase=()=>{
    // Deduplicate shared ancestor syscalls only within a bounded inspection
    // phase. Every file still has its own fresh realpath/lstat/open/close checks;
    // the final independent snapshot rechecks all ancestors and the whole set.
    // Nothing survives this invocation or is accepted as content identity.
    const ancestors=new Map<string,Promise<void>>();
    const directory=(path:string):Promise<void>=>{
      const previous=ancestors.get(path);if(previous)return previous;
      const checking=(async()=>{
        const parent=dirname(path);if(parent!==path)await directory(parent);
        await check(path,'directory');
      })();
      ancestors.set(path,checking);return checking;
    };
    return directory;
  };
  await directoryPhase()(root);
  for(const [path,name] of [[config.starterExecutable,'starter_win64.exe'],[config.engineExecutable,'engine_win64.exe']])
    if(resolve(path)!==join(root,'exec',name)) fail('variant/substituted executable path');
  const snapshot=async()=>{
    const directory=directoryPhase();
    const paths=new Set<string>();let directories=0,entries=0;
    const dir=async(path:string)=>{if(++directories>policy.maximumDirectories) fail('directory-count bound');await directory(path);};
    const accept=async(path:string)=>{
      const name=normal(path);if(!allowed.has(name)||paths.has(name.toLowerCase())) fail('unexpected/duplicate runtime file');
      const s=await check(path,'file');if(s.size<1||s.size>policy.maximumFileBytes) fail('individual file bound');paths.add(name.toLowerCase());
    };
    const walk=async(path:string)=>{
      if(normal(path).split('/').length>=policy.maximumDepth) fail('traversal depth bound');await dir(path);
      for(const entry of await readdir(path,{withFileTypes:true})) {
        if(++entries>policy.maximumFiles) fail('entry-count bound');
        if(entry.isSymbolicLink()) fail('linked runtime entry');
        const child=join(path,entry.name);
        if(entry.isDirectory()) await walk(child);else if(entry.isFile()) await accept(child);else fail('unsupported runtime entry');
      }
    };
    for(const support of ['extlib','hm_cfg_files','licenses','exec']) await dir(join(root,support));
    await accept(config.starterExecutable);await accept(config.engineExecutable);
    for(const suffix of ['hm_cfg_files/config/CFG/radioss2026','hm_cfg_files/config/CFG/UNITS','hm_cfg_files/messages']) await walk(join(root,suffix));
    for(const suffix of ['exec','extlib/hm_reader/win64','extlib/intelOneAPI_runtime/win64','extlib/h3d/lib/win64']) {
      const path=join(root,suffix);await dir(path);
      for(const entry of await readdir(path,{withFileTypes:true})) {
        if(++entries>policy.maximumFiles) fail('entry-count bound');
        if(entry.isSymbolicLink()) fail('linked support entry');
        if(/\.dll$/i.test(entry.name)) await accept(join(path,entry.name));
        // .lib/.exp are link-time artifacts; Zone.Identifier is download metadata.
        // Other exec tools are neither invoked nor included in the selected runtime.
      }
    }
    if(paths.size!==allowed.size) fail('missing required runtime file');
    const metadata:RuntimeFile[]=[],stamps=[];
    for(const name of [...allowed].sort()) {
      const s=await check(join(root,name),'file');metadata.push({path:name,bytes:s.size,sha256:'0'.repeat(64)});
      stamps.push({path:name,ino:s.ino,dev:s.dev,mtimeMs:s.mtimeMs,ctimeMs:s.ctimeMs});
    }
    const manifest=validateOpenRadiossRuntimeManifest(metadata);
    const notice=await check(join(root,'COPYRIGHT.md'),'file');
    if(notice.size<1||notice.size>policy.maximumFileBytes||manifest.totalBytes+notice.size>policy.maximumTotalBytes)
      fail('total hashing/compliance resource bound');
    return {metadata,stamps,notice:{size:notice.size,ino:notice.ino,dev:notice.dev,mtimeMs:notice.mtimeMs,ctimeMs:notice.ctimeMs}};
  };
  const before=await snapshot();
  const directory=directoryPhase();
  const hash=async(name:string)=>{
    const path=join(root,name);await directory(dirname(path));const initial=await check(path,'file');
    const handle=await open(path,'r'),hasher=createHash('sha256');let count=0;
    try {
      const opened=await handle.stat();
      if(opened.ino!==initial.ino||opened.dev!==initial.dev||opened.size!==initial.size) fail('runtime replaced before reading');
      const buffer=new Uint8Array(policy.hashChunkBytes);
      while(true) {
        const {bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead) break;
        count+=bytesRead;if(count>initial.size||count>policy.maximumFileBytes) fail('runtime grew while reading');
        hasher.update(buffer.subarray(0,bytesRead));
      }
      const current=await check(path,'file'),final=await handle.stat();
      if(count!==initial.size||[current,final].some(s=>s.size!==initial.size||s.ino!==initial.ino||s.dev!==initial.dev||
        s.mtimeMs!==initial.mtimeMs||s.ctimeMs!==initial.ctimeMs)) fail('runtime changed while reading');
      return {path:name,bytes:count,sha256:hasher.digest('hex')};
    } finally {await handle.close();}
  };
  // Bound independent fresh file reads to four concurrent handles/buffers.
  // No result/content cache: shared ancestry is checked per phase; every file
  // retains inode, realpath, size, timestamp and full-content checks, plus the
  // final independent whole-set/ancestry snapshot.
  const files:RuntimeFile[]=[];
  for(let index=0;index<before.metadata.length;index+=4){
    const batch=await Promise.allSettled(before.metadata.slice(index,index+4).map(file=>hash(file.path)));
    for(const item of batch){if(item.status==='rejected')throw item.reason;files.push(item.value);}
  }
  const complianceIdentity=await hash('COPYRIGHT.md');
  const after=await snapshot();if(digest(before)!==digest(after)) fail('runtime file set/size changed while inspecting');
  const manifest=validateOpenRadiossRuntimeManifest(files);
  for(const [name,expected] of [['exec/starter_win64.exe',config.starterSha256],['exec/engine_win64.exe',config.engineSha256]])
    if(files.find(f=>f.path===name)!.sha256!==expected) fail('executable identity mismatch');
  const identity={runtimeVersion:config.runtimeVersion,manifestPolicyVersion:policy.version,files:manifest.files};
  const result={identity,runtimeDigest:digest(identity),manifestDigest:manifest.manifestDigest,totalBytes:manifest.totalBytes,complianceIdentity,
    hashingBytes:manifest.totalBytes+complianceIdentity.bytes,environment:{OPENRADIOSS_PATH:root,RAD_CFG_PATH:join(root,'hm_cfg_files'),
      RAD_H3D_PATH:join(root,'extlib','h3d','lib','win64'),KMP_STACKSIZE:'400m',OMP_NUM_THREADS:'1',
      PATH:[join(root,'extlib','hm_reader','win64'),join(root,'extlib','intelOneAPI_runtime','win64'),
        join(root,'extlib','h3d','lib','win64'),process.env.PATH??''].join(';')}};
  nativeInspections.set(result,{configDigest:digest(config),valueDigest:digest(result),startedAt});
  return result;
}
