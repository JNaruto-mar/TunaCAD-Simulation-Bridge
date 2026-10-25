import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, mkdir, open, readdir } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from './stableDigest.mts';
import {withProtectedCapacityPublication} from './protectedCapacityPublication.mts';
import {provisioningFailure} from './nativeStorageProvisioningDiagnostic.mts';
import {withNativeOwnerMutation,trackOwnerMaintenanceChild,assertNativeOwnerPermit} from './nativeOwnerMaintenanceGate.mts';
import {nativeStorageValidationStage,nativeStorageReadinessOperation} from './nativeStoragePreflightDiagnostic.mts';
import {registerProtectedStorageWriteRoot} from './protectedStorageWriteBoundary.mts';

export const ELECTROSTATIC_SOURCE_IDENTITY = 'tunacad-electrostatic-native-step-identity/0.1';
const execute = promisify(execFile);
const roles = ['studies', 'source-catalog', 'results', 'completion-catalog'] as const;
const protectionPolicy = 'windows-protected-owner-system-administrators/0.1';
const maximumFileBytes = 16 * 1024 * 1024;
function invalid(detail: string): never { throw new Error('ELECTROSTATIC_HOST_STORAGE_INVALID: ' + detail); }

// Constants only in the command. Paths are passed as JSON via a task-specific
// environment variable, never interpolated into PowerShell source.
import {nativeDirectoryAclScript as aclScript} from './nativeDirectoryAclPolicy.mts';

// Same policy and writes, with a bounded exception envelope instead of raw
// PowerShell stderr. The original execFile error remains in Error.cause.
const provisionAclScript = String.raw`
$ErrorActionPreference = 'Stop'
$script:provisionStage = 'principal'
$inspectionProgress = { param($stage) $script:provisionStage = $stage }
try {
  $value = & {
` + aclScript + String.raw`
  }
  [Console]::WriteLine($value)
} catch {
  $exception = $_.Exception
  for ($i = 0; $i -lt 8 -and $exception.InnerException; $i++) { $exception = $exception.InnerException }
  [Console]::WriteLine((ConvertTo-Json -Compress -InputObject @{
    schema='tunacad-acl-provisioning-error/1'; stage=$script:provisionStage;
    exception=$exception.GetType().FullName; hresult=('{0:X8}' -f $exception.HResult)
  }))
  exit 1
}
`;

// Interpreter reuse only: no ACL, path or protection result is cached. Every
// bounded request runs the SAME policy against fresh native security descriptors.
// Private inherited pipes correlate replies; timeout/exit/error fails closed.
const aclWorkerScript = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::WriteLine('{"type":"ready"}')
while ($null -ne ($line = [Console]::ReadLine())) {
  try {
    $request = ConvertFrom-Json $line
    $inspectionProgress = { param($stage)
      [Console]::WriteLine((ConvertTo-Json -Compress -InputObject @{type='progress'; id=$request.id; stage=$stage}))
    }
    if ($request.kind -eq 'localApplicationData') {
      & $inspectionProgress 'known_folder'
      $location = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
      [Console]::WriteLine((ConvertTo-Json -Compress -InputObject @{id=$request.id; location=$location}))
      continue
    }
    if ($request.kind -ne 'acl') { throw 'Unsupported native inspection' }
    $env:TUNACAD_ELECTROSTATIC_ACL_TARGETS = ConvertTo-Json -Compress -InputObject @($request.paths)
    $env:TUNACAD_ELECTROSTATIC_ACL_PROVISION = 'verify'
    $value = & {
` + aclScript + String.raw`
    }
    # Keep the policy's array JSON intact: PS 5.1 adds Count/value properties
    # when an array is parsed and serialized again inside a hashtable.
    [Console]::WriteLine('{"id":' + (ConvertTo-Json -Compress $request.id) + ',"rows":' + $value + '}')
  } catch {
    # Never return native exceptions containing paths, account names or contents.
    $reason = 'native_inspection_failed'
    switch ($_.Exception.Message) {
      'Unexpected storage owner' { $reason = 'owner' }
      'Inherited directory DACL' { $reason = 'inherited_dacl' }
      'Unsupported deny rule' { $reason = 'deny_rule' }
      'Unapproved storage principal' { $reason = 'principal' }
      'Owner FullControl missing' { $reason = 'owner_control' }
    }
    [Console]::WriteLine((ConvertTo-Json -Compress -InputObject @{id=$request.id; error=$reason}))
  }
}
`;
let worker: ChildProcessWithoutNullStreams | null = null;
let pending: { id: string; paths: string[]; kind: 'acl' | 'localApplicationData'; resolve(value: any): void; reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>; started: number; queuedMs: number; stage: string;
  stageStarted: number; timings: Record<string, number>; options: NativeStorageInspectionOptions;
  removeAbort(): void } | null = null;
let output = '', idle: ReturnType<typeof setTimeout> | undefined;
let aclQueue: Promise<unknown> = Promise.resolve();
let inspectorOwners = 0;
const inspectionDeadlineMs = 10000, cleanupDeadlineMs = 2000;
const stages = ['startup', 'dispatch', 'known_folder', 'principal', 'descriptor', 'policy', 'serialization'] as const;
export type NativeStorageInspectionDiagnostic = Readonly<{
  kind: 'acl' | 'localApplicationData'; stage: string; elapsedMs: number; queuedMs: number;
  deadlineMs: number; status: 'pending' | 'succeeded' | 'rejected' | 'cancelled';
  cleanup: 'not_required' | 'terminated' | 'unconfirmed'; reason?: string;
  timingsMs: Readonly<Record<string, number>>;
}>;
/** Trusted Node-side observation/cancellation only; no policy/deadline override,
 * paths, native messages, identity or cached authorization in these events. */
export type NativeStorageInspectionOptions = {
  signal?: AbortSignal; onDiagnostic?(event: NativeStorageInspectionDiagnostic): void;
};
let cleanup: Promise<void> = Promise.resolve();
let cleanupUnconfirmed = false;
function diagnostic(request: NonNullable<typeof pending>, status: NativeStorageInspectionDiagnostic['status'],
  cleanupStatus: NativeStorageInspectionDiagnostic['cleanup'], reason?: string): NativeStorageInspectionDiagnostic {
  const now = performance.now();
  return Object.freeze({kind: request.kind, stage: request.stage, elapsedMs: Math.round(now - request.started),
    queuedMs: request.queuedMs, deadlineMs: inspectionDeadlineMs, status, cleanup: cleanupStatus, reason,
    timingsMs: Object.freeze({...request.timings, [request.stage]: (request.timings[request.stage] ?? 0) + Math.round(now - request.stageStarted)})});
}
function report(request: NonNullable<typeof pending>, event: NativeStorageInspectionDiagnostic) {
  try { request.options.onDiagnostic?.(event); } catch { /* Diagnostics cannot authorize or interrupt security checks. */ }
}
function progress(request: NonNullable<typeof pending>, stage: string) {
  const now = performance.now();
  request.timings[request.stage] = (request.timings[request.stage] ?? 0) + Math.round(now - request.stageStarted);
  request.stage = stage; request.stageStarted = now;
  report(request, diagnostic(request, 'pending', 'not_required'));
}
/** Native ownership of the interpreter only, never of a verified ACL result.
 * Long CAD reads must not tear down and cold-start this inspector inside the
 * next security request's unchanged 10-second deadline. No browser input.
 * Releasing the last owner closes an idle worker; pending checks still finish
 * or fail under their original request deadline. */
export function retainNativeStorageInspector() {
  inspectorOwners++;
  if (idle) { clearTimeout(idle); idle = undefined; }
  let released = false;
  return () => {
    if (released) return; released = true; inspectorOwners--;
    if (!inspectorOwners && !pending) stopAclWorker('ACL owner shutdown');
  };
}
function stopAclWorker(detail: string, cancelled = false) {
  const active = worker; worker = null; output = '';
  if (idle) clearTimeout(idle);
  const request = pending; pending = null;
  if (request) { clearTimeout(request.timer); request.removeAbort(); }
  const observed = request ? diagnostic(request, cancelled ? 'cancelled' : 'rejected', 'not_required', detail) : null;
  // Reject only after bounded termination observation. Late replies cannot
  // resolve a detached request, and the serialized queue cannot race cleanup.
  cleanup = new Promise<'terminated' | 'unconfirmed'>(resolveCleanup => {
    if (!active || active.exitCode !== null && active.exitCode !== undefined) { resolveCleanup('terminated'); return; }
    const finish = (status: 'terminated' | 'unconfirmed') => {
      clearTimeout(timer); active.removeListener('close', closed); resolveCleanup(status);
    };
    const closed = () => finish('terminated');
    const timer = setTimeout(() => finish('unconfirmed'), cleanupDeadlineMs);
    active.once('close', closed);
    try { if (!active.kill()) finish('unconfirmed'); } catch { finish('unconfirmed'); }
  }).then(cleanupStatus => {
    if (cleanupStatus === 'unconfirmed') cleanupUnconfirmed = true;
    if (!request || !observed) return;
    const event = Object.freeze({...observed, cleanup: cleanupStatus}); report(request, event);
    const error = new Error('ELECTROSTATIC_HOST_STORAGE_INVALID: ' + detail +
      ` (kind=${event.kind}; stage=${event.stage}; elapsedMs=${event.elapsedMs}; deadlineMs=${event.deadlineMs}; status=${event.status}; cleanup=${event.cleanup})`);
    Object.assign(error, {diagnostic: event}); request.reject(error);
  });
}
function workerHandles(active: ChildProcessWithoutNullStreams, referenced: boolean) {
  for (const handle of [active, active.stdin, active.stdout, active.stderr]) {
    (handle as any)[referenced ? 'ref' : 'unref']?.();
  }
}
async function verifyAclFresh(paths: string[], kind: 'acl' | 'localApplicationData' = 'acl',
  options: NativeStorageInspectionOptions = {}, queuedMs = 0): Promise<any> {
  await cleanup;
  if (cleanupUnconfirmed) invalid('previous inspector cleanup unconfirmed');
  if (options.signal?.aborted) invalid('inspection cancelled before dispatch');
  return new Promise((resolveRows, reject) => {
    if (idle) clearTimeout(idle);
    const cold = !worker;
    if (!worker) {
      const active = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', aclWorkerScript],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env,
          TUNACAD_ELECTROSTATIC_ACL_PROVISION: 'verify' } });
      worker = active;
      active.stdout.setEncoding('utf8');
      active.stdout.on('data', (chunk: string) => {
        if (worker !== active) return;
        output += chunk;
        if (Buffer.byteLength(output) > 128 * 1024) return stopAclWorker('ACL response budget');
        while (worker === active) {
        const end = output.indexOf('\n'); if (end < 0) return;
        const line = output.slice(0, end).trim(); output = output.slice(end + 1);
        try {
          const response = JSON.parse(line), request = pending;
          if (response.type === 'ready') {
            if (Object.keys(response).join(',') !== 'type' || !request || request.stage !== 'startup') invalid('ACL readiness correlation');
            progress(request, 'dispatch'); continue;
          }
          if (!request || response.id !== request.id) invalid('ACL response correlation');
          if (response.type === 'progress') {
            if (Object.keys(response).sort().join(',') !== 'id,stage,type' || !stages.includes(response.stage)
              || ['startup', 'dispatch'].includes(response.stage)) invalid('ACL progress correlation');
            progress(request, response.stage); continue;
          }
          if (response.error) {
            const reason = ['native_inspection_failed', 'owner', 'inherited_dacl', 'deny_rule', 'principal', 'owner_control'].includes(response.error)
              ? response.error : 'native_inspection_failed';
            return stopAclWorker('native inspection rejected: ' + reason);
          }
          if (output.trim()) invalid('ACL response correlation');
          if (request.kind === 'acl') {
            if (Object.keys(response).sort().join(',') !== 'id,rows' || !Array.isArray(response.rows)
              || response.rows.length !== request.paths.length
              || response.rows.some((row: any, i: number) => row.path !== request.paths[i])) invalid('ACL policy/response mismatch');
          } else if (Object.keys(response).sort().join(',') !== 'id,location' || typeof response.location !== 'string'
            || !response.location.length || response.location.length > 4096) invalid('native location response');
          pending = null; clearTimeout(request.timer); request.removeAbort();
          report(request, diagnostic(request, 'succeeded', 'not_required'));
          request.resolve(request.kind === 'acl' ? response.rows : response.location);
          workerHandles(active, false);
          if (!inspectorOwners) {
            idle = setTimeout(() => { if (worker === active && !pending && !inspectorOwners) stopAclWorker('ACL idle shutdown'); }, 30000);
            idle.unref();
          }
        } catch { stopAclWorker('ACL protocol rejected'); }
        }
      });
      active.stderr.on('data', () => { if (worker === active) stopAclWorker('ACL worker stderr'); });
      active.on('error', () => { if (worker === active) stopAclWorker('ACL worker startup'); });
      active.on('exit', () => { if (worker === active) stopAclWorker('ACL worker exit'); });
      active.stdin.on('error', () => { if (worker === active) stopAclWorker('ACL worker pipe'); });
    }
    const active = worker!; workerHandles(active, true);
    const id = randomUUID();
    const started = performance.now();
    const abort = () => { if (pending?.id === id) stopAclWorker('native inspection cancelled', true); };
    pending = { id, paths, kind, resolve: resolveRows, reject,
      started, queuedMs, stage: cold ? 'startup' : 'dispatch', stageStarted: started, timings: {}, options,
      removeAbort: () => options.signal?.removeEventListener('abort', abort),
      timer: setTimeout(() => stopAclWorker('ACL verification timeout'), inspectionDeadlineMs) };
    options.signal?.addEventListener('abort', abort, {once: true});
    if (options.signal?.aborted) { abort(); return; }
    try { active.stdin.write(JSON.stringify({ id, paths, kind }) + '\n'); }
    catch { stopAclWorker('ACL worker pipe'); }
  });
}
/** Fresh OS query, not a cached location or environment-variable override. */
export async function readNativeWindowsLocalApplicationData(options: NativeStorageInspectionOptions = {}): Promise<string> {
  if (process.platform !== 'win32') invalid('Windows native location required');
  const queued = performance.now();
  const request = aclQueue.then(() => verifyAclFresh([], 'localApplicationData', options, Math.round(performance.now() - queued)));
  aclQueue = request.catch(() => undefined);
  return request;
}
async function acl(paths: string[], provision: false|'root-acl'|'role-acls' = false, options: NativeStorageInspectionOptions = {}): Promise<any[]> {
  if (process.platform !== 'win32') invalid('Windows ACL host policy required; other hosts unsupported');
  if (!paths.length || paths.length > 160) invalid('ACL enumeration bound');
  if (!provision) {
    const queued = performance.now();
    const request = aclQueue.then(() => verifyAclFresh(paths, 'acl', options, Math.round(performance.now() - queued)));
    aclQueue = request.catch(() => undefined);
    return request;
  }
  const started=performance.now();let response=false;
  try{
  const result = await trackOwnerMaintenanceChild(()=>execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', provisionAclScript],
    { windowsHide: true, timeout: 10000, maxBuffer: 128 * 1024, env: { ...process.env,
      TUNACAD_ELECTROSTATIC_ACL_TARGETS: JSON.stringify(paths),
      TUNACAD_ELECTROSTATIC_ACL_PROVISION: provision ? 'new' : 'verify' } }));
  response=true;const rows = JSON.parse(result.stdout);
  if (!Array.isArray(rows) || rows.length !== paths.length) invalid('ACL response incomplete');
  return rows;
  }catch(error){
    throw Object.assign(new Error('ELECTROSTATIC_HOST_STORAGE_INVALID: ACL provisioning failed',{cause:error}),
      {provisioning:provisioningFailure(error,provision,performance.now()-started,response)});
  }
}

/** Trusted capacity accounting only: fresh read-only checks with the existing
 * owner/DACL policy and unchanged per-batch deadline. No provisioning/cache. */
export async function verifyNativeProtectedCapacityRecords(paths:readonly string[]){
  if(paths.length>768)invalid('capacity ACL enumeration bound');
  for(let start=0;start<paths.length;start+=160)await acl(paths.slice(start,start+160));
}

/** Fixed-size immutable JSON reads/writes; no caller filenames or record paths. */
export async function readElectrostaticHostJson(path: string, maximumBytes = maximumFileBytes): Promise<any> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maximumBytes) invalid('record file shape/budget');
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (info.ino !== before.ino || info.size !== before.size || !info.isFile()) invalid('record changed during open');
    const bytes = new Uint8Array(before.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const next = await handle.read(bytes, size, bytes.length - size, null);
      if (!next.bytesRead) break; size += next.bytesRead;
    }
    if (size !== before.size) invalid('record changed during read');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)));
  } finally { await handle.close(); }
}
export async function writeElectrostaticHostOnce(path: string, value: unknown, maximumBytes = maximumFileBytes) {
  const bytes = JSON.stringify(value);
  if (Buffer.byteLength(bytes) > maximumBytes) invalid('record write budget');
  return withNativeOwnerMutation(path,()=>withProtectedCapacityPublication(path,Buffer.byteLength(bytes),async()=>{
  let handle;
  assertNativeOwnerPermit(path,true);
  try { handle = await open(path, 'wx', 0o600); }
  catch (error: any) {
    if (error.code !== 'EEXIST') throw error;
    if (digest(await readElectrostaticHostJson(path, maximumBytes)) !== digest(value)) invalid('immutable record changed');
    return;
  }
  try { await handle.writeFile(bytes, 'utf8'); await handle.sync(); }
  finally { await handle.close(); }
  }));
}

/** Opt-in protected host storage, not repository/upload directories or API input.
 * Provision changes ACLs ONLY on newly created directories. Existing roots are
 * opened/verified, never automatically repaired, migrated or re-permissioned. */
export class ElectrostaticHostStorage {
  readonly root: string;
  readonly paths: Readonly<Record<typeof roles[number], string>>;
  private constructor(root: string, private readonly configuration: any, readonly configurationDigest: string) {
    this.root = root;
    this.paths = Object.freeze(Object.fromEntries(roles.map(role => [role, join(root, role)]))) as any;
  }
  private static rootPath(path: string) {
    const root = resolve(path);
    if (root === parse(root).root || root.length > 1024) invalid('unsafe root');
    return root;
  }
  private static async verifyAncestry(root: string) {
    // Reject any existing reparse/symlink ancestor, not just the final directory.
    for (let path = root; ; path = dirname(path)) {
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink()) invalid('reparse/non-directory storage ancestry');
      if (path === dirname(path)) break;
    }
  }
  private static async directories(root: string) {
    await this.verifyAncestry(root);
    const paths = [root, ...roles.map(role => join(root, role))];
    const identities = [];
    for (const path of paths) {
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink()) invalid('invalid storage role');
      identities.push({ path, device: info.dev, inode: info.ino });
    }
    return { paths, identities };
  }
  static async provisionNew(path: string): Promise<ElectrostaticHostStorage> {
    if (process.platform !== 'win32') invalid('unsupported protection host');
    const root = this.rootPath(path);
    registerProtectedStorageWriteRoot(root);
    return withNativeOwnerMutation(root,async()=>{
    await this.verifyAncestry(dirname(root));
    assertNativeOwnerPermit(root,true);
    await mkdir(root); // EEXIST refuses to modify an existing root.
    await acl([root], 'root-acl');
    for (const role of roles) {assertNativeOwnerPermit(root,true);await mkdir(join(root, role));}
    const dirs = await this.directories(root);
    const protection = await acl(dirs.paths, 'role-acls');
    const configuration = { schema: 'tunacad-electrostatic-host-storage/0.1', storageId: randomUUID(),
      sourceIdentityVersion: ELECTROSTATIC_SOURCE_IDENTITY, root,
      roles: Object.fromEntries(roles.map(role => [role, join(root, role)])),
      protectionPolicy, directoryIdentities: dirs.identities, protection };
    const configurationDigest = digest(configuration);
    await writeElectrostaticHostOnce(join(root, 'configuration.json'), configuration, 128 * 1024);
    await writeElectrostaticHostOnce(join(root, 'source-catalog', 'configuration.pin.json'),
      { schema: 'tunacad-electrostatic-host-storage-pin/0.1', configurationDigest }, 2048);
    return this.open(root);
    });
  }
  static async open(path: string, options: NativeStorageInspectionOptions = {}): Promise<ElectrostaticHostStorage> {
    const root = this.rootPath(path);
    registerProtectedStorageWriteRoot(root); // Direct legacy opens cannot bypass write admission.
    const configuration = await nativeStorageValidationStage('storage-configuration-read',()=>readElectrostaticHostJson(join(root, 'configuration.json'), 128 * 1024));
    const pin = await nativeStorageValidationStage('storage-configuration-pin-read',()=>readElectrostaticHostJson(join(root, 'source-catalog', 'configuration.pin.json'), 2048));
    if (pin.schema !== 'tunacad-electrostatic-host-storage-pin/0.1'
      || Object.keys(pin).sort().join(',') !== 'configurationDigest,schema'
      || digest(configuration) !== pin.configurationDigest) invalid('configuration pin mismatch');
    const storage = new this(root, configuration, pin.configurationDigest);
    await storage.assertReady(options);
    return storage;
  }
  /** Cheap checks on every host-record read, plus full ACL checks at save/replay
   * boundaries. Stored paths never redirect access: roles derive from root. */
  async verifyConfiguration() {
    const current = await readElectrostaticHostJson(join(this.root, 'configuration.json'), 128 * 1024);
    const pin = await readElectrostaticHostJson(join(this.paths['source-catalog'], 'configuration.pin.json'), 2048);
    if (digest(current) !== this.configurationDigest || digest(current) !== pin.configurationDigest
      || pin.schema !== 'tunacad-electrostatic-host-storage-pin/0.1'
      || current.schema !== 'tunacad-electrostatic-host-storage/0.1'
      || current.sourceIdentityVersion !== ELECTROSTATIC_SOURCE_IDENTITY || current.root !== this.root
      || current.protectionPolicy !== protectionPolicy
      || digest(current.roles) !== digest(this.paths)) invalid('configuration/version changed');
    const dirs = await ElectrostaticHostStorage.directories(this.root);
    if (digest(dirs.identities) !== digest(current.directoryIdentities)) invalid('storage directory identity changed');
    return dirs;
  }
  async assertReady(options: NativeStorageInspectionOptions = {}) {
    return nativeStorageReadinessOperation('protected_store_verification',async()=>{
    const dirs = await nativeStorageValidationStage('configuration-revalidation',()=>this.verifyConfiguration());
    const roots = await nativeStorageValidationStage('directory-acl-verification',()=>acl(dirs.paths, false, options));
    if (digest(roots) !== digest(this.configuration.protection)) invalid('storage ACL policy changed');
    const files = [join(this.root, 'configuration.json')];
    for (const role of roles) {
      const names = await nativeStorageValidationStage('protected-role-inventory',()=>readdir(this.paths[role]));
      if (names.length > 40) invalid('storage file-count bound');
      for (const name of names) {
        const path = join(this.paths[role], name); const info = await nativeStorageValidationStage('protected-role-inventory',()=>lstat(path));
        if (!info.isFile() || info.isSymbolicLink() || info.size > maximumFileBytes) invalid('storage entry shape/budget');
        files.push(path);
      }
    }
    await nativeStorageValidationStage('protected-file-acl-verification',()=>acl(files, false, options)); // Effective file ACLs must not introduce another principal.
    });
  }
}
