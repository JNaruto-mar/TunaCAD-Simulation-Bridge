import { createInterface } from 'node:readline/promises';
import { startSimulationBridge } from './server.mts';
import { isExplicitWorkspaceOrigin } from './explicitWorkspaceOrigin.mts';
import { privateExplicitProviderSchema,type PrivateExplicitSolveBinding,
  type PrivateExplicitProvider } from './privateExplicitPreparationContract.mts';
import { inspectOpenRadiossInstallation,type OpenRadiossInstallation } from '../providers/openradioss/OpenRadiossInstallation.mts';
import {SimulationJobWorkspace,isSimulationJobWorkspace} from './simulationJobWorkspace.mts';
import {openPrivateExplicitExportStore} from './privateExplicitExportStore.mts';
import {openPrivateExplicitMeshStore} from './privateExplicitMeshStore.mts';
import { isAbsolute,relative,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {NATIVE_PORTABLE_EXPORT_ENABLED,approvePortableExportInTerminal,type NativePortableReceiptAuthority,type PortableExportReview} from './nativePortableExport.mts';

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
  portableResultAuthority?:NativePortableReceiptAuthority;
  portableExportConfirmation?(review:PortableExportReview,signal:AbortSignal):Promise<boolean>;
}) {
  if(options.purpose!=='private_explicit_operator_controller'
    ||!isExplicitWorkspaceOrigin(options.allowedOrigin)
    ||typeof options.readProviderIdentity!=='function')throw new Error('PRIVATE_OPERATOR_LAUNCH_INVALID');
  if(!options.geometryExportOnly&&!options.terminalConfirmation&&(!process.stdin.isTTY||!process.stdout.isTTY))
    throw new Error('PRIVATE_OPERATOR_INTERACTIVE_TERMINAL_REQUIRED');
  const readProvider=async()=>privateExplicitProviderSchema.parse(await options.readProviderIdentity());
  await readProvider();
  const exportTerminal=NATIVE_PORTABLE_EXPORT_ENABLED&&options.portableResultAuthority&&!options.portableExportConfirmation;
  if(exportTerminal&&(!process.stdin.isTTY||!process.stdout.isTTY))throw Error('PRIVATE_OPERATOR_INTERACTIVE_TERMINAL_REQUIRED');
  const terminal=!exportTerminal&&(options.geometryExportOnly||options.terminalConfirmation)?null:createInterface({input:process.stdin,output:process.stdout});
  const approveExport=async(review:PortableExportReview,signal:AbortSignal)=>{
    if(!NATIVE_PORTABLE_EXPORT_ENABLED||!options.portableResultAuthority||options.geometryExportOnly)return false;
    return options.portableExportConfirmation?options.portableExportConfirmation(review,signal):terminal?approvePortableExportInTerminal(review,signal,terminal):false;
  };
  try {
    const bridge=await startSimulationBridge({provider:null,providerV2:null,providerElectrical:null,
      readiness:{ready:false,provider:null,meshing:{ready:false,adapterVersion:'private-none',runtimeVersion:null,
        geometryFormats:[],elementFamilies:[]},solving:{ready:false,adapterVersion:'private-none',runtimeVersion:null,analysisTypes:[]}},
      port:options.port,allowedOrigin:options.allowedOrigin,
      privateExplicitApprovals:{readProviderIdentity:readProvider},
      async approve(binding,signal) {
        if(binding.schema==='tunacad-portable-result-export-consent/1')return approveExport(binding,signal);
        if(options.geometryExportOnly)return false; // no solve authority in this launcher mode
        if(binding.schema!=='tunacad-private-simulation-solve-approval/0.1')return false;
        if(binding.request.resultDelivery==='project_archive')console.log('Completed FACE-node results are included in Save Project for this new study. The project is readable/shareable; protected raw evidence and execution authority stay private.');
        if(options.terminalConfirmation)return options.terminalConfirmation(binding,signal);
        console.log('Separate Bridge approval required for protected study '+JSON.stringify(binding.studyId)+'.');
        console.log('In this Bridge terminal review the exact study/export/mesh/provider binding below. Geometry confirmation is not solver approval. Type approve only for this study; do not launch OpenRadioss. This single-use authorization ends at a Bridge-ready request, not solver dispatch.');
        console.log(JSON.stringify(binding));
        try {return (await terminal!.question('Type approve for this exact study: ',{signal})).trim()==='approve';}
        catch {return false;}
      },
    });
    return {url:bridge.url,pairingCode:bridge.pairingCode,approvals:bridge.privateApprovals!,approvePortableExport:approveExport,
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
  stopAt?:'panel_attached'|'geometry_export'|'bridge_ready'|'results';
  terminalConfirmation?(binding:PrivateExplicitSolveBinding,signal:AbortSignal):Promise<boolean>;
  confirmWorkflowQuiescent?(signal:AbortSignal):Promise<void>;
  portableResultAuthority?:NativePortableReceiptAuthority;
  portableExportConfirmation?(review:PortableExportReview,signal:AbortSignal):Promise<boolean>;
}) {
  if(options.purpose!=='private_explicit_operator_controller'
    ||!isExplicitWorkspaceOrigin(options.allowedOrigin))
    throw new Error('PRIVATE_OPERATOR_LAUNCH_INVALID');
  if(options.expectedManifestDigest!==PRIVATE_EXPLICIT_VALIDATED_RUNTIME_MANIFEST)
    throw new Error('PRIVATE_OPERATOR_RUNTIME_RESEAL_REQUIRED');
  if(Object.hasOwn(options,'protectedMeshStorageRoot'))throw new Error('PRIVATE_OPERATOR_NATIVE_ROOT_OVERRIDE_FORBIDDEN');
  async function openJobStorage(){
    const storage=await SimulationJobWorkspace.create();
    const meshStore=await openPrivateExplicitMeshStore(storage.root),exportStore=await openPrivateExplicitExportStore(storage.root);
    return {storage,meshStore,exportStore};
  }
  type WorkflowStorage=Awaited<ReturnType<typeof openJobStorage>>;
  let nativeStorage:WorkflowStorage|undefined,allocation:Promise<WorkflowStorage>|undefined;
  let storageFailure:unknown,released=false,publications=0,admissionClosed=false;
  let releaseWork:Promise<void>|undefined,releaseEntered=false;
  const writes=new Set<Promise<unknown>>();
  let bridge:Awaited<ReturnType<typeof launchPrivateExplicitOperatorBridge>>|undefined;
  try {
  // Reject an invalid provider before creating any temporary job files. The
  // Bridge repeats this fresh check; this does not cache runtime admission.
  const readProviderIdentity=createPrivateExplicitRuntimeReader(options.installation,options.expectedManifestDigest);
  await readProviderIdentity();
  const launched=await launchPrivateExplicitOperatorBridge({purpose:options.purpose,allowedOrigin:options.allowedOrigin,
    geometryExportOnly:options.stopAt==='geometry_export',
    terminalConfirmation:options.terminalConfirmation,
    portableResultAuthority:options.portableResultAuthority,portableExportConfirmation:options.portableExportConfirmation,
    port:options.port,readProviderIdentity});bridge=launched;
  // Connection, source inspection and preparation need no workflow namespace.
  // Only the existing approved-geometry publication port can allocate one.
  async function requireStorage():Promise<WorkflowStorage>{
    if(admissionClosed)throw Error('PRIVATE_OPERATOR_CLOSED');
    if(storageFailure)throw storageFailure;
    if(nativeStorage&&!released)return nativeStorage;
    if(!allocation||released){
      // An already admitted publication may reach its first allocation while
      // cleanup waits for it. Keep that drain closed to subsequent publishers.
      if(released){releaseWork=undefined;releaseEntered=false;}
      if(released)nativeStorage?.storage.dispose();
      nativeStorage=undefined;released=false;
      allocation=(async()=>{
        let attempted=false;try{
        await readProviderIdentity();if(admissionClosed)throw Error('PRIVATE_OPERATOR_CLOSED');
        attempted=true;const value=await openJobStorage();nativeStorage=value;
        if(!isSimulationJobWorkspace(value.storage))throw Error('PRIVATE_OPERATOR_NATIVE_STORAGE_REQUIRED');
        if(admissionClosed)throw Error('PRIVATE_OPERATOR_CLOSED');
        return value;
        }catch(error){if(attempted)storageFailure??=error;throw error;}
      })();
    }
    const work=allocation;
    try{return await work;}catch(error){if(!storageFailure&&allocation===work)allocation=undefined;throw error;}
  }
  async function releaseWorkflowStorage(guard:{confirmQuiescent(signal:AbortSignal):Promise<void>}){
    if(released)return;
    if(!releaseWork)releaseWork=Promise.resolve().then(async()=>{
      await Promise.allSettled([...writes]);await allocation?.catch(()=>{});
      if(!nativeStorage){
        if(storageFailure)throw storageFailure;
        if(!admissionClosed)await guard.confirmQuiescent(new AbortController().signal);
        released=true;return; // Nothing was allocated; no release record is issued.
      }
      if(publications!==0)throw Error('PRIVATE_OPERATOR_WRITES_PENDING');
      releaseEntered=true;
      await nativeStorage!.storage.cleanup(async signal=>{
        if(publications!==0)throw Error('PRIVATE_OPERATOR_WRITES_PENDING');
        await guard.confirmQuiescent(signal);
      });
      released=true; // Temporary files removed; verified copies stay readable until owner close.
    });
    const work=releaseWork;
    try{await work;}catch(error){if(!releaseEntered&&releaseWork===work)releaseWork=undefined;throw error;}
  }
  let closing:Promise<void>|undefined;
  const owner={url:launched.url,pairingCode:launched.pairingCode,close(){if(closing)return closing;admissionClosed=true;return closing=Promise.resolve().then(async()=>{
    try{await launched.close();await releaseWorkflowStorage({confirmQuiescent:async signal=>{
      if(!options.confirmWorkflowQuiescent)throw Error('PRIVATE_OPERATOR_SHUTDOWN_UNCONFIRMED');
      await options.confirmWorkflowQuiescent(signal);
    }});}finally{await allocation?.catch(()=>{});if(released)nativeStorage?.storage.dispose();}
  });},verifyWindowProof:launched.verifyWindowProof,
    get storage(){if(!nativeStorage||released||releaseWork)throw Error('PRIVATE_OPERATOR_STORAGE_NOT_ACTIVE');return nativeStorage.storage;},
    releaseWorkflowStorage,installation:structuredClone(options.installation),
    readSessionMetadata:launched.readSessionMetadata,
    portableResultAuthority:NATIVE_PORTABLE_EXPORT_ENABLED?options.portableResultAuthority:undefined,
    approvePortableExport:launched.approvePortableExport,
    async readNativeBindings(){if(nativeStorage)await nativeStorage.storage.assertReady();return {storageIdentity:nativeStorage?.storage.configurationDigest??null,
      storageState:storageFailure?'failed' as const:nativeStorage?(released?'released' as const:'allocated' as const):'deferred' as const,
      storageSchema:'tunacad-simulation-job-workspace/1' as const,reader:'owner-job-exact-record-artifact' as const,
      provider:await launched.readProviderIdentity()};},hostPorts:{
    privateCapability:'private_host_preparation_only' as const,
    meshStore:{async readExact(...args:Parameters<WorkflowStorage['meshStore']['readExact']>){return nativeStorage?nativeStorage.meshStore.readExact(...args):null;}},
    async persistApprovedExport(...args:Parameters<WorkflowStorage['exportStore']['persist']>){
      if(admissionClosed||releaseWork&&!released)throw Error('PRIVATE_OPERATOR_STORAGE_CLOSING');
      publications++;
      const task=(async()=>{await args[2]();const value=await requireStorage();
        if(admissionClosed||released)throw Error('PRIVATE_OPERATOR_STORAGE_NOT_ACTIVE');
        return value.exportStore.persist(...args);
      })();
      const tracked=task.finally(()=>{publications--;writes.delete(tracked);});writes.add(tracked);
      return await tracked;
    },
    async readApprovedExport(...args:Parameters<WorkflowStorage['exportStore']['read']>){
      if(!nativeStorage)throw Error('PRIVATE_OPERATOR_STORAGE_NOT_ALLOCATED');return nativeStorage.exportStore.read(...args);
    },
    readSessionIdentity:()=>launched.readSessionIdentity(),readProviderIdentity:()=>launched.readProviderIdentity(),
    bridgeApprovals:launched.approvals,
  }};nativeOwners.add(owner);return owner;
  }catch(error){
    // Only this constructor's still-unpublished namespace is eligible. No
    // operator/source/provider work can receive these ports before return.
    // Old allocations remain ineligible: their original signing key is absent.
    let cleanupFailure:unknown;
    try{
      if(bridge)await bridge.close();
      // Storage cannot have been requested before publishing this lazy owner.
    }catch(cleanup){cleanupFailure=cleanup;}

    if(cleanupFailure)throw new AggregateError([error,cleanupFailure],'PRIVATE_OPERATOR_INITIALIZATION_CLEANUP_FAILED',{cause:error});
    throw error;
  }
}
