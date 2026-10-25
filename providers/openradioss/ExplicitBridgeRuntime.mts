import {lstat,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,isAbsolute} from 'node:path';
import {inspectOpenRadiossInstallation} from './OpenRadiossInstallation.mts';
import {ComposedExplicitProvider} from '../ComposedExplicitProvider.mts';
import {ExplicitBridgeExecution} from './ExplicitBridgeExecution.mts';
import {PRIVATE_EXPLICIT_VALIDATED_RUNTIME_MANIFEST} from '../../simulation-bridge/privateExplicitOperatorBridge.mts';
/** Read-only, finite installed-runtime discovery. No installation, settings,
 * trust enrollment, solver process or job allocation occurs here. */
export async function openExplicitBridgeRuntime(gmsh:string,roots:string[]=[
 process.env.TUNACAD_OPENRADIOSS_ROOT??process.env.OPENRADIOSS_HOME??'',
 join(process.env.SystemDrive??'C:','Tools','OpenRadioss'),
 ...(process.env.ProgramFiles?[join(process.env.ProgramFiles,'OpenRadioss')]:[]),
]){
 const hash=async(path:string)=>{const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>512*1024**2)throw Error('EXPLICIT_RUNTIME_INVALID');const file=await open(path,'r');try{const h=createHash('sha256');for await(const bytes of file.createReadStream({autoClose:false}))h.update(bytes);return h.digest('hex');}finally{await file.close();}};
 for(const root of [...new Set(roots)].filter(p=>isAbsolute(p)).slice(0,3)){
  try{
   const starterExecutable=join(root,'exec','starter_win64.exe'),engineExecutable=join(root,'exec','engine_win64.exe');
   const installation={root,starterExecutable,engineExecutable,runtimeVersion:'2026' as const,starterSha256:await hash(starterExecutable),engineSha256:await hash(engineExecutable)};
   const verified=await inspectOpenRadiossInstallation(installation);
   if(verified.manifestDigest!==PRIVATE_EXPLICIT_VALIDATED_RUNTIME_MANIFEST)throw Error('EXPLICIT_RUNTIME_MANIFEST_CHANGED');
   return new ComposedExplicitProvider({id:'tunacad-local-explicit-bridge',version:'0.1.0',runtimeDigest:verified.runtimeDigest,maximumStepBytes:16*1024**2,maximumNodes:100000,maximumElements:50000,engineeringUsePermitted:false},new ExplicitBridgeExecution(gmsh,installation,verified.runtimeDigest));
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
 }
 return null;
}
