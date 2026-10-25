import { lstat, mkdir, readdir, rmdir } from 'node:fs/promises';
import { dirname, join, win32 } from 'node:path';
import { tmpdir } from 'node:os';
import {createNativeWorkflowStorage,validateNativeWorkflowId,validateNativeWorkflowEntries,summarizeNativeWorkflowInventory,workflowCapacityError,MAXIMUM_NATIVE_WORKFLOWS} from './nativeWorkflowStorageLifecycle.mts';
export {validateNativeWorkflowEntries} from './nativeWorkflowStorageLifecycle.mts';
import { ElectrostaticHostStorage, readNativeWindowsLocalApplicationData } from './electrostaticHostStorage.mts';
import { openPrivateExplicitMeshStore } from './privateExplicitMeshStore.mts';
import { openPrivateExplicitExportStore } from './privateExplicitExportStore.mts';
import {mountNativeWorkflowCapacity} from './nativeWorkflowCapacity.mts';
import {registerNativeOwnerMaintenanceRoot,withNativeOwnerMutation,assertNativeOwnerPermit} from './nativeOwnerMaintenanceGate.mts';
import {markNativeStorageFailure,nativeStorageValidationStage} from './nativeStoragePreflightDiagnostic.mts';

export const NATIVE_SIMULATION_STORAGE_POLICY = 'windows-local-application-data/1';
const freshWorkflowHandles=new WeakSet<object>();
/** Non-consuming identity check for the original, newly allocated owner only.
 * An opened legacy store, copied object or declared identity cannot pass. */
export function readFreshNativeWorkflowIdentity(value:unknown){
  if(typeof value!=='object'||value===null||!freshWorkflowHandles.has(value))
    throw Error('NATIVE_WORKFLOW_CLAIM_FRESH_HANDLE_REQUIRED');
  const owner=value as {workflowId:string;storage:ElectrostaticHostStorage};
  return Object.freeze({workflowId:owner.workflowId,storageIdentity:owner.storage.configurationDigest});
}
/** Single-use native provenance for claim enrollment. Existing/opened/copied
 * objects and caller-declared booleans cannot enroll a legacy namespace. */
export function consumeFreshNativeWorkflowHandle(value:unknown):{workflowId:string;storage:ElectrostaticHostStorage}{
  if(typeof value!=='object'||value===null||!freshWorkflowHandles.has(value))
    throw Error('NATIVE_WORKFLOW_CLAIM_FRESH_HANDLE_REQUIRED');
  freshWorkflowHandles.delete(value);return value as {workflowId:string;storage:ElectrostaticHostStorage};
}
function invalid(detail: string,overlap?:'temporary-directory'|'working-directory'): never {
  const error=new Error('NATIVE_SIMULATION_STORAGE_INVALID: ' + detail);
  if(overlap)markNativeStorageFailure(error,'location-policy',overlap);
  throw error;
}

/** Pure location policy. Its input is obtained by the native OS reader below,
 * never from a browser, authoring request, fixture or storage-root override. */
export function nativeSimulationLocation(localApplicationData: string) {
  if (!/^[a-z]:\\/i.test(localApplicationData) || localApplicationData.length > 800
    || /[\x00-\x1f]/.test(localApplicationData)
    || localApplicationData.split(/[\\/]/).some(part => part === '..' || part === '.'))
    invalid('invalid Windows LocalApplicationData known folder');
  const base = win32.resolve(localApplicationData);
  if (base === win32.parse(base).root) invalid('drive root is not application data');
  // A global native simulation namespace, not a bootstrap/fixture directory.
  const root = win32.join(base, 'TunaCAD', 'Simulation', 'protected-v1');
  const inside = (parent: string) => {
    const suffix = win32.relative(win32.resolve(parent), root);
    return !suffix || (!suffix.startsWith('..') && !win32.isAbsolute(suffix));
  };
  if (inside(tmpdir()) || inside(process.cwd())) invalid('temporary/repository location forbidden',inside(tmpdir())?'temporary-directory':'working-directory');
  return Object.freeze({ policy: NATIVE_SIMULATION_STORAGE_POLICY, base, root });
}

export async function readNativeSimulationLocation() {
  if (process.platform !== 'win32') invalid('Windows native storage only');
  // Fixed command, no interpolated paths or environment overrides. GetFolderPath
  // follows the current user's registered OS application-data location.
  return nativeSimulationLocation((await nativeStorageValidationStage('known-folder-query',()=>readNativeWindowsLocalApplicationData())).trim());
}

async function verifyDirectoryAncestry(path: string) {
  for (let current = path; ; current = dirname(current)) {
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) invalid('reparse/non-directory ancestry');
    if (current === dirname(current)) break;
  }
}

/** Persistent native owner. Existing stores are verified, never repaired,
 * imported, migrated or resealed. Provisioning is explicit and creates only
 * the OS-derived namespace; it cannot accept a caller filesystem location. */
export async function openNativeSimulationStorage(options: { provisionIfMissing?: boolean } = {}) {
  if (Object.keys(options).some(key => key !== 'provisionIfMissing')
    || (options.provisionIfMissing !== undefined && typeof options.provisionIfMissing !== 'boolean'))
    invalid('caller root/configuration override forbidden');
  const location = await readNativeSimulationLocation();
  await nativeStorageValidationStage('application-data-ancestry',()=>verifyDirectoryAncestry(location.base));
  await nativeStorageValidationStage('maintenance-root-registration',async()=>registerNativeOwnerMaintenanceRoot(location.root)); // Registration alone is read-only.
  let absent = false;
  try { await nativeStorageValidationStage('protected-root-presence',()=>lstat(location.root)); }
  catch (error: any) { if (error.code !== 'ENOENT') throw error; absent = true; }
  if (absent && !options.provisionIfMissing) invalid('not provisioned; explicit native provisioning required');
  if (absent) {
    await withNativeOwnerMutation(location.root,async()=>{
    // Never recursively create an arbitrary path or change ancestor permissions.
    for (const directory of [join(location.base, 'TunaCAD'), join(location.base, 'TunaCAD', 'Simulation')]) {
      await verifyDirectoryAncestry(dirname(directory));
      assertNativeOwnerPermit(location.root,true);
      try { await mkdir(directory); }
      catch (error: any) { if (error.code !== 'EEXIST') throw error; }
      await verifyDirectoryAncestry(directory);
    }
    });
  }
  const storage = absent
    ? await ElectrostaticHostStorage.provisionNew(location.root)
    : await nativeStorageValidationStage('protected-store-validation',()=>ElectrostaticHostStorage.open(location.root));
  if (!(storage instanceof ElectrostaticHostStorage)) invalid('native protected storage adapter required');
  await nativeStorageValidationStage('capacity-adapter-registration',async()=>mountNativeWorkflowCapacity(storage));
  const meshStore = await nativeStorageValidationStage('mesh-reader-open',()=>openPrivateExplicitMeshStore(storage.root));
  const exportStore = await nativeStorageValidationStage('export-reader-open',()=>openPrivateExplicitExportStore(storage.root));
  return Object.freeze({ location, storage, meshStore, exportStore, provisioned: absent,
    async inventory() {
      await storage.assertReady();
      const pins = (await readdir(storage.paths['source-catalog']))
        .filter(name => /^explicit-mesh-[a-f0-9]{64}\.pin\.json$/.test(name)).sort();
      const records = (await readdir(storage.paths.studies))
        .filter(name => /^explicit-mesh-[a-f0-9]{64}\.json$/.test(name)).sort();
      const artifacts = (await readdir(storage.paths.results))
        .filter(name => /^explicit-mesh-[a-f0-9]{64}\.json$/.test(name)).sort();
      await storage.assertReady();
      // Presence alone never proves binding. Only readExact with a freshly read
      // live study/source/export may authenticate an existing captured mesh.
      return { pinFiles: pins.length, recordFiles: records.length, artifactFiles: artifacts.length,
        exactMeshBinding: 'MESH_BINDING_PENDING' as const, fixtureFallback: false };
    },
  });
}

/** Native-owned persistent workflow namespace, not temporary fixture storage.
 * Old evidence stays untouched; the existing per-store bounds remain intact.
 * No browser/configuration input chooses a root, identity or existing store. */
export async function openNativeSimulationWorkflowStorage(purpose:'fracture_evidence'|'private_explicit_owner'='private_explicit_owner') {
  if(!['fracture_evidence','private_explicit_owner'].includes(purpose))invalid('workflow purpose');
  const parent=await openNativeSimulationStorage();
  const directory=join(parent.location.root,'workflows');
  // This operational lock is outside the evidence roles and contains no data.
  // EEXIST fails immediately: no waiting, stale-lock deletion or automatic retry.
  const capacity=mountNativeWorkflowCapacity(parent.storage);
  const created=await capacity.transaction(()=>createNativeWorkflowStorage({
    verifyParent:()=>parent.storage.assertReady(),
    async acquire(){
      // The same exclusive owner lock now also serializes reservations/writes.
      return async()=>{};
    },
    async ensureContainer(){
      try{await mkdir(directory);}catch(error:any){if(error.code!=='EEXIST')throw error;}
      await verifyDirectoryAncestry(directory);
    },
    list:()=>readdir(directory),verifyEntry:id=>verifyDirectoryAncestry(join(directory,id)),
    async create(workflowId){
      return capacity.allocate(workflowId,purpose,async()=>{
      const root=join(directory,workflowId),storage=await ElectrostaticHostStorage.provisionNew(root);
      const meshStore=await openPrivateExplicitMeshStore(root),exportStore=await openPrivateExplicitExportStore(root);
      return Object.freeze({location:parent.location,workflowId,storage,meshStore,exportStore});
      });
    },
  }));
  freshWorkflowHandles.add(created);return created;
}

/** Exact existing owner namespace only. No creation, scanning for a replacement,
 * root override, migration, repair, approval or result admission. */
export async function openExistingNativeSimulationWorkflowStorage(workflowId:string){
  validateNativeWorkflowId(workflowId);
  const parent=await openNativeSimulationStorage({provisionIfMissing:false});
  const directory=join(parent.location.root,'workflows');await verifyDirectoryAncestry(directory);
  const entries=await readdir(directory);validateNativeWorkflowEntries(entries,'open');
  if(!entries.includes(workflowId))throw Error('NATIVE_SIMULATION_WORKFLOW_NOT_FOUND');
  const root=join(directory,workflowId);await verifyDirectoryAncestry(root);
  const storage=await ElectrostaticHostStorage.open(root);await parent.storage.assertReady();
  return Object.freeze({workflowId,storage});
}

/** Existing owner inventory only. No mkdir, provisioning, lock, cleanup,
 * migration or namespace allocation occurs in this function. */
export async function inspectNativeSimulationWorkflowInventory(){
  const parent=await openNativeSimulationStorage({provisionIfMissing:false});
  const directory=join(parent.location.root,'workflows');
  let info;
  try{info=await lstat(directory);}catch(error:any){if(error.code!=='ENOENT')throw error;
    await parent.storage.assertReady();return summarizeNativeWorkflowInventory([]);}
  if(!info.isDirectory()||info.isSymbolicLink()){
    await parent.storage.assertReady();return summarizeNativeWorkflowInventory([],1);
  }
  const entries=await readdir(directory);let unsafe=0;
  if(entries.length<=MAXIMUM_NATIVE_WORKFLOWS){for(const id of entries){
    try{validateNativeWorkflowId(id);}catch{continue;}
    const child=await lstat(join(directory,id));if(!child.isDirectory()||child.isSymbolicLink())unsafe++;
  }}
  await parent.storage.assertReady();return summarizeNativeWorkflowInventory(entries,unsafe);
}
/** Advisory read-only preflight; allocation repeats all checks under its lock.
 * Never reserves capacity, creates a namespace or opens a legacy writer. */
export async function assertNativeWorkflowAllocationAvailable(){
  const inventory=await inspectNativeSimulationWorkflowInventory();
  if(inventory.reason==='workflow-capacity-full')throw workflowCapacityError(inventory.workflowCount);
  if(inventory.reason!=='none')throw Error('NATIVE_SIMULATION_STORAGE_INVALID: unsafe workflow inventory');
  const parent=await openNativeSimulationStorage({provisionIfMissing:false});
  await mountNativeWorkflowCapacity(parent.storage).preflight();
  return inventory;
}
