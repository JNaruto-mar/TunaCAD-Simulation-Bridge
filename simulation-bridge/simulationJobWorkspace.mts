// New jobs only. An owner-created temporary directory is not a protected-v1
// namespace, replay authority, reservation or migration of historical evidence.
import {mkdtemp,mkdir,lstat,realpath,open,readdir,statfs} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,relative,isAbsolute,dirname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
import {nativeDirectoryAclScript} from './nativeDirectoryAclPolicy.mts';
import {digest} from './stableDigest.mts';
import {removeWorkingDirectory} from '../providers/processLifecycle.mts';
import type {ElectrostaticHostStorage} from './electrostaticHostStorage.mts';

const execute=promisify(execFile),roles=['studies','source-catalog','results','completion-catalog'] as const;
const owners=new Map<string,SimulationJobWorkspace>();
const MAX_BYTES=64*1024**2,MAX_FILES=128; // Same bounded evidence as the validated runner.
const bytesDigest=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
const invalid=(reason:string):never=>{throw Error('SIMULATION_JOB_WORKSPACE_'+reason);};
const inside=(root:string,path:string)=>{const r=relative(root,path);return !!r&&!isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+(process.platform==='win32'?'\\':'/'));};
export type SimulationRecordStorage=ElectrostaticHostStorage|SimulationJobWorkspace;

export class SimulationJobWorkspace {
  readonly paths:Record<typeof roles[number],string>;
  readonly configurationDigest=digest({kind:'temporary_owner_job',nonce:randomUUID()});
  private closed=false;private accepting=true;private closing:Promise<void>|undefined;
  private work:Promise<unknown>=Promise.resolve();private bytes=0;
  private readonly records=new Map<string,Uint8Array>();
  private readonly identities=new Map<string,{ino:bigint;birthtimeMs:bigint}>();
  private readonly children:SimulationJobWorkspace[]=[];
  private constructor(readonly root:string){
    Object.defineProperty(this,'root',{value:root,writable:false,configurable:false,enumerable:true});
    this.paths=Object.freeze(Object.fromEntries(roles.map(r=>[r,join(root,r)]))) as typeof this.paths;
  }
  static async create(parent?:SimulationJobWorkspace):Promise<SimulationJobWorkspace>{
    if(parent){await parent.assertReady();if(parent.closed||!parent.accepting)invalid('CLOSED');}
    const base=parent?.root??await realpath(tmpdir());
    const free=await statfs(base,{bigint:true});if(free.bavail*free.bsize<20n*1024n**3n)invalid('DISK_HEADROOM');
    const root=await mkdtemp(join(base,'tunacad-job-'));const value=new SimulationJobWorkspace(root);
    // Do not register or publish an unsecured directory. Failed provisioning
    // preserves its fresh directory and original error; never touches a user root.
    for(const role of roles)await mkdir(value.paths[role],{mode:0o700});
    const directories=[root,...Object.values(value.paths)];
    if(process.platform==='win32'){
      const powershell=join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
      const result=await execute(powershell,['-NoLogo','-NoProfile','-NonInteractive','-Command',nativeDirectoryAclScript],{
        timeout:10000,maxBuffer:128*1024,windowsHide:true,env:{...process.env,
          TUNACAD_ELECTROSTATIC_ACL_TARGETS:JSON.stringify(directories),TUNACAD_ELECTROSTATIC_ACL_PROVISION:'new'}});
      const rows=JSON.parse(result.stdout);if(!Array.isArray(rows)||rows.length!==directories.length||rows.some((r:any,i:number)=>r.path!==directories[i]||!r.directory||!r.protected))invalid('ACL');
    }else if(process.platform!=='darwin'&&process.platform!=='linux')invalid('PLATFORM');
    for(const path of directories){const s=await lstat(path,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink())invalid('DIRECTORY');
      value.identities.set(path,{ino:s.ino,birthtimeMs:s.birthtimeMs});}
    if(parent&&!parent.accepting)invalid('CLOSED');
    owners.set(resolve(root),value);parent?.children.push(value);return value;
  }
  async assertReady(){
    if(this.closed)return; // Read-only verified copies survive scratch cleanup.
    for(const [path,id] of this.identities){const s=await lstat(path,{bigint:true});
      if(!s.isDirectory()||s.isSymbolicLink()||s.ino!==id.ino||s.birthtimeMs!==id.birthtimeMs||await realpath(path)!==path)invalid('IDENTITY');
      if(process.platform!=='win32'&&(Number(s.mode)&0o077))invalid('PERMISSIONS');}
  }
  private key(path:string){const absolute=resolve(path);if(!inside(this.root,absolute)||!Object.values(this.paths).includes(dirname(absolute)))invalid('PATH');return absolute;}
  async read(path:string,limit=16*1024**2):Promise<Uint8Array>{
    const key=this.key(path);await this.assertReady();
    const expected=this.records.get(key);if(!expected)throw Object.assign(Error('Job record not found'),{code:'ENOENT'});
    if(expected.byteLength>limit)invalid('READ_BOUND');if(this.closed)return new Uint8Array(expected);
    const before=await lstat(key,{bigint:true});if(!before.isFile()||before.isSymbolicLink()||before.size!==BigInt(expected.byteLength))invalid('FILE');
    const handle=await open(key,'r');try{const s=await handle.stat({bigint:true});
      if(s.ino!==before.ino||s.size!==before.size)invalid('FILE_IDENTITY');
      const bytes=new Uint8Array(expected.byteLength+1);let used=0;while(used<bytes.length){const r=await handle.read(bytes,used,bytes.length-used,null);if(!r.bytesRead)break;used+=r.bytesRead;}
      const after=await handle.stat({bigint:true});
      if(used!==expected.byteLength||after.mtimeNs!==s.mtimeNs||bytesDigest(bytes.subarray(0,used))!==bytesDigest(expected))invalid('INTEGRITY');
      return bytes.slice(0,used);
    }finally{await handle.close();}
  }
  async write(path:string,value:Uint8Array,limit=16*1024**2){
    if(this.closed||!this.accepting)invalid('CLOSED');const key=this.key(path),bytes=new Uint8Array(value);
    if(bytes.byteLength>limit)invalid('WRITE_BOUND');
    const task=this.work.then(async()=>{
      await this.assertReady();const existing=this.records.get(key);
      if(existing){if(bytesDigest(existing)!==bytesDigest(bytes))invalid('IMMUTABLE');await this.read(key,limit);return;}
      if(this.records.size>=MAX_FILES||this.bytes+bytes.byteLength>MAX_BYTES)invalid('EVIDENCE_BOUND');
      const f=await open(key,'wx',0o600);try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}
      this.records.set(key,bytes);this.bytes+=bytes.byteLength;await this.read(key,limit);
    });this.work=task.catch(()=>{});return task;
  }
  async cleanup(confirmQuiescent:(signal:AbortSignal)=>Promise<void>){
    if(this.closed)return;if(this.closing)return this.closing;
    const freeze=(w:SimulationJobWorkspace)=>{w.accepting=false;w.children.forEach(freeze);};freeze(this);
    return this.closing=Promise.resolve().then(async()=>{
      const drain=async(w:SimulationJobWorkspace):Promise<void>=>{await w.work;await Promise.all(w.children.map(drain));};
      await drain(this);await confirmQuiescent(AbortSignal.timeout(30000));await this.assertReady();
      // Never follow a link or recursively remove a replacement directory.
      let count=0;const inspect=async(path:string):Promise<void>=>{for(const entry of await readdir(path,{withFileTypes:true})){
        if(++count>1024||entry.isSymbolicLink())invalid('CLEANUP_TREE');const child=join(path,entry.name);
        if(entry.isDirectory())await inspect(child);else if(!entry.isFile())invalid('CLEANUP_TREE');}};
      await inspect(this.root);await this.assertReady();
      if(!await removeWorkingDirectory(this.root))invalid('CLEANUP_FAILED');
      const finish=(w:SimulationJobWorkspace)=>{w.closed=true;w.children.forEach(finish);};finish(this);
    });
  }
  dispose(){if(!this.closed)invalid('NOT_CLEANED');this.records.clear();owners.delete(resolve(this.root));this.children.forEach(c=>c.dispose());}
}
export const isSimulationJobWorkspace=(value:unknown):value is SimulationJobWorkspace=>value instanceof SimulationJobWorkspace&&owners.get(resolve(value.root))===value;
export const jobWorkspaceForPath=(path:string)=>[...owners.values()].filter(w=>inside(w.root,resolve(path))).sort((a,b)=>b.root.length-a.root.length)[0];
export async function openSimulationRecordStorage(root:string):Promise<SimulationRecordStorage>{
  const job=owners.get(resolve(root));if(job){await job.assertReady();return job;}
  return (await import('./electrostaticHostStorage.mts')).ElectrostaticHostStorage.open(root);
}
export async function readSimulationJson(path:string,limit=16*1024**2){
  const job=jobWorkspaceForPath(path);return job?JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await job.read(path,limit))):
    (await import('./electrostaticHostStorage.mts')).readElectrostaticHostJson(path,limit);
}
export async function writeSimulationJsonOnce(path:string,value:unknown,limit=16*1024**2){
  const job=jobWorkspaceForPath(path);if(job)return job.write(path,new TextEncoder().encode(JSON.stringify(value)),limit);
  return (await import('./electrostaticHostStorage.mts')).writeElectrostaticHostOnce(path,value,limit);
}
export async function createSimulationExecutionWorkspace(parent:SimulationRecordStorage){
  return isSimulationJobWorkspace(parent)?SimulationJobWorkspace.create(parent):
    (await import('./electrostaticHostStorage.mts')).ElectrostaticHostStorage.provisionNew(join(parent.root,'execution-'+randomUUID()));
}
