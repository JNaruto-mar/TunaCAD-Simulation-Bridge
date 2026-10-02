import { createInterface } from 'node:readline/promises';
import { startSimulationBridge } from './server.mts';
import { privateExplicitProviderSchema,type PrivateExplicitSolveBinding,
  type PrivateExplicitProvider } from './privateExplicitPreparationContract.mts';
import { inspectOpenRadiossInstallation,type OpenRadiossInstallation } from '../providers/openradioss/OpenRadiossInstallation.mts';
import { ElectrostaticHostStorage } from './electrostaticHostStorage.mts';
import { openNativeSimulationStorage } from './nativeSimulationStorage.mts';
import { isAbsolute,relative,resolve } from 'node:path';
import { tmpdir } from 'node:os';

const nativeOwners=new WeakSet<object>();
export const PRIVATE_EXPLICIT_VALIDATED_RUNTIME_MANIFEST='sha256:64019bec8c2f46a8431c8976db6c3664f162376f59ef1c2edca7f229a8e1208b';
/** Provenance comes from actual native initialization, not a returned boolean,
 * config/env flag or constructor-injected test adapter. */
export const isNativePrivateExplicitOwner=(value:unknown)=>typeof value==='object'&&value!==null&&nativeOwners.has(value);
export function assertPrivateExplicitLiveStorageRoot(value:string) {
  const inside=(root:string,path:string)=>{const r=relative(resolve(root),resolve(path));return !r||(!r.startsWith('..')&&!isAbsolute(r));};
  if(!isAbsolute(value)||inside(tmpdir(),value)||inside(process.cwd(),value))
    throw new Error('PRIVATE_OPERATOR_LIVE_STORAGE_REQUIRED: explicit non-temporary, non-repository host root');
}

/** Trusted launch configuration, never an authoring payload. Full native runtime
 * fingerprinting is repeated, not cached or accepted from a study. Read-only. */
export function createPrivateExplicitRuntimeReader(installation:OpenRadiossInstallation,expectedManifestDigest:string) {
  if(!/^sha256:[a-f0-9]{64}$/.test(expectedManifestDigest))throw new Error('PRIVATE_OPERATOR_RUNTIME_CONFIGURATION_INVALID');
  const config=structuredClone(installation);
  return async():Promise<PrivateExplicitProvider>=>{
    const current=await inspectOpenRadiossInstallation(config);
    if(current.manifestDigest!==expectedManifestDigest)throw new Error('PRIVATE_OPERATOR_RUNTIME_MANIFEST_CHANGED');
    return privateExplicitProviderSchema.parse({providerId:'tunacad-openradioss-explicit-private',providerVersion:'0.1.0-poc',
      runtimeVersion:'2026',runtimeManifestDigest:current.manifestDigest,runtimeDigest:current.runtimeDigest});
  };
}
/** Trusted internal launcher only. Standard CLI stays disabled. No providers
 * are constructed; the existing loopback/HMAC/Origin/Host/session rules apply. */
export async function launchPrivateExplicitOperatorBridge(options:{
  purpose:'private_explicit_operator_controller';allowedOrigin:string;port?:number;
  readProviderIdentity():Promise<PrivateExplicitProvider>;
  geometryExportOnly?:boolean;
  terminalConfirmation?(binding:PrivateExplicitSolveBinding,signal:AbortSignal):Promise<boolean>;
}) {
  if(options.purpose!=='private_explicit_operator_controller'
    ||!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(options.allowedOrigin)
    ||typeof options.readProviderIdentity!=='function')throw new Error('PRIVATE_OPERATOR_LAUNCH_INVALID');
  if(!options.geometryExportOnly&&!options.terminalConfirmation&&(!process.stdin.isTTY||!process.stdout.isTTY))
    throw new Error('PRIVATE_OPERATOR_INTERACTIVE_TERMINAL_REQUIRED');
  const readProvider=async()=>privateExplicitProviderSchema.parse(await options.readProviderIdentity());
  await readProvider();
  const terminal=options.geometryExportOnly||options.terminalConfirmation?null:createInterface({input:process.stdin,output:process.stdout});
  try {
    const bridge=await startSimulationBridge({provider:null,providerV2:null,providerElectrical:null,
      readiness:{ready:false,provider:null,meshing:{ready:false,adapterVersion:'private-none',runtimeVersion:null,
        geometryFormats:[],elementFamilies:[]},solving:{ready:false,adapterVersion:'private-none',runtimeVersion:null,analysisTypes:[]}},
      port:options.port,allowedOrigin:options.allowedOrigin,
      privateExplicitApprovals:{readProviderIdentity:readProvider},
      async approve(binding,signal) {
        if(options.geometryExportOnly)return false; // no solve authority in this launcher mode
        if(binding.schema!=='tunacad-private-simulation-solve-approval/0.1')return false;
        if(options.terminalConfirmation)return options.terminalConfirmation(binding,signal);
        console.log('Separate Bridge approval required for protected study '+JSON.stringify(binding.studyId)+'.');
        console.log('In this Bridge terminal review the exact study/export/mesh/provider binding below. Geometry confirmation is not solver approval. Type approve only for this study; do not launch OpenRadioss. This single-use authorization ends at a Bridge-ready request, not solver dispatch.');
        console.log(JSON.stringify(binding));
        try {return (await terminal!.question('Type approve for this exact study: ',{signal})).trim()==='approve';}
        catch {return false;}
      },
    });
    return {url:bridge.url,pairingCode:bridge.pairingCode,approvals:bridge.privateApprovals!,
      verifyWindowProof:(challenge:string,proof:string)=>bridge.verifyPrivateWindowProof(challenge,proof),
      async readSessionIdentity(){const id=bridge.readPrivateSessionIdentity();
        if(!id)throw new Error('PRIVATE_OPERATOR_PAIRED_SESSION_REQUIRED');return id;},
      async readSessionMetadata(){const value=bridge.readPrivateSessionMetadata();
        if(!value)throw new Error('PRIVATE_OPERATOR_PAIRED_SESSION_REQUIRED');return value;},
      readProviderIdentity:readProvider,
      async close(){await bridge.close();terminal?.close();}};
  }catch(error){terminal?.close();throw error;}
}

/** Explicit trusted local bootstrap for an embedded/private operator owner.
 * Ports, not provider instances or raw decks, cross the trusted owner boundary.
 * No public IPC/HTTP endpoint is added. A separate browser embedding must mount
 * the private panel with these ports; the normal web app never imports this. */
export async function openPrivateExplicitOperatorHostPorts(options:{
  purpose:'private_explicit_operator_controller';allowedOrigin:string;port?:number;
  installation:OpenRadiossInstallation;expectedManifestDigest:string;
  stopAt?:'panel_attached'|'geometry_export'|'bridge_ready';
}) {
  if(options.purpose!=='private_explicit_operator_controller'
    ||!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(options.allowedOrigin))
    throw new Error('PRIVATE_OPERATOR_LAUNCH_INVALID');
  if(options.expectedManifestDigest!==PRIVATE_EXPLICIT_VALIDATED_RUNTIME_MANIFEST)
    throw new Error('PRIVATE_OPERATOR_RUNTIME_RESEAL_REQUIRED');
  if(Object.hasOwn(options,'protectedMeshStorageRoot'))throw new Error('PRIVATE_OPERATOR_NATIVE_ROOT_OVERRIDE_FORBIDDEN');
  const nativeStorage=await openNativeSimulationStorage();
  const storage=nativeStorage.storage;
  assertPrivateExplicitLiveStorageRoot(storage.root);
  if(!(storage instanceof ElectrostaticHostStorage))throw new Error('PRIVATE_OPERATOR_NATIVE_STORAGE_REQUIRED');
  const meshStore=nativeStorage.meshStore;
  const bridge=await launchPrivateExplicitOperatorBridge({purpose:options.purpose,allowedOrigin:options.allowedOrigin,
    geometryExportOnly:options.stopAt==='geometry_export',
    port:options.port,readProviderIdentity:createPrivateExplicitRuntimeReader(options.installation,options.expectedManifestDigest)});
  const owner={url:bridge.url,pairingCode:bridge.pairingCode,close:()=>bridge.close(),verifyWindowProof:bridge.verifyWindowProof,
    readSessionMetadata:bridge.readSessionMetadata,
    async readNativeBindings(){await storage.assertReady();return {storageIdentity:storage.configurationDigest,
      storageSchema:'tunacad-electrostatic-host-storage/0.1' as const,reader:'protected-exact-pin-record-artifact' as const,
      provider:await bridge.readProviderIdentity()};},hostPorts:{
    privateCapability:'private_host_preparation_only' as const,meshStore,
    persistApprovedExport:nativeStorage.exportStore.persist,
    readApprovedExport:nativeStorage.exportStore.read,
    readSessionIdentity:()=>bridge.readSessionIdentity(),readProviderIdentity:()=>bridge.readProviderIdentity(),
    bridgeApprovals:bridge.approvals,
  }};nativeOwners.add(owner);return owner;
}
