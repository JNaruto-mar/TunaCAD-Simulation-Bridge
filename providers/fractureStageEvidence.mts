import {lstat,open} from 'node:fs/promises';
import type {RetainFracturePilotEvidence} from '../simulation-bridge/fracturePilotEvidenceStore.mts';
/** IO/finalization only; cannot launch a solver or mint admitted evidence.
 * Native caller supplies fixed owned paths and existing termination/cleanup. */
export async function finishFractureStage(o:{stage:'gmsh_mesh'|'calculix_solve';path:string;
  retain:RetainFracturePilotEvidence;diagnostic:string;exceeded:boolean;cancelled:boolean;exitCode:number|null;
  originalFailure:unknown;terminate():Promise<boolean>;clean():Promise<boolean>}){
  const failures:unknown[]=[];
  let terminated=false,cleaned=false;
  try{terminated=await o.terminate();}catch(e){failures.push(e);}
  try{
    let artifact:string|Uint8Array='',truncated=false;
    try{
      const before=await lstat(o.path);if(!before.isFile()||before.isSymbolicLink())throw Error('FRACTURE_DIAGNOSTIC_UNSAFE');
      const f=await open(o.path,'r');try{
        const info=await f.stat();if(!info.isFile()||info.ino!==before.ino||info.size!==before.size)throw Error('FRACTURE_DIAGNOSTIC_CHANGED');
        const limit=o.stage==='gmsh_mesh'?64*1024*1024:16*1024*1024;
        truncated=info.size>limit;const bytes=new Uint8Array(Math.min(info.size,truncated?512*1024:limit));
        let offset=0;while(offset<bytes.length){const r=await f.read(bytes,offset,bytes.length-offset,offset);if(!r.bytesRead)break;offset+=r.bytesRead;}
        artifact=bytes.subarray(0,offset);
      }finally{await f.close();}
    }catch(e:any){if(e.code!=='ENOENT')throw e;}
    await o.retain({stage:o.stage,outcome:o.cancelled?'cancelled':o.exceeded||o.exitCode!==0?'failed':'passed',artifact,
      detail:JSON.stringify({diagnostic:o.diagnostic,exceeded:o.exceeded,truncated,terminated,exitCode:o.exitCode,
        originalFailure:o.originalFailure instanceof Error?o.originalFailure.message.slice(0,3000):undefined})});
  }catch(e){failures.push(e);}
  try{cleaned=await o.clean();}catch(e){failures.push(e);}
  try{await o.retain({stage:'stage_cleanup',outcome:terminated&&cleaned?'passed':'failed',detail:JSON.stringify({stage:o.stage,terminated,cleaned})});}
  catch(e){failures.push(e);}
  if(!terminated||!cleaned)failures.push(Error('FRACTURE_NATIVE_CLEANUP_UNCONFIRMED'));
  if(failures.length)throw Object.assign(new AggregateError([o.originalFailure,...failures].filter(Boolean),'FRACTURE_STAGE_RETENTION_OR_CLEANUP_FAILED'),{cleanupConfirmed:terminated&&cleaned});
}
