import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, mkdir, open, readdir } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from './stableDigest.mts';

export const ELECTROSTATIC_SOURCE_IDENTITY = 'tunacad-electrostatic-native-step-identity/0.1';
const execute = promisify(execFile);
const roles = ['studies', 'source-catalog', 'results', 'completion-catalog'] as const;
const protectionPolicy = 'windows-protected-owner-system-administrators/0.1';
const maximumFileBytes = 16 * 1024 * 1024;
function invalid(detail: string): never { throw new Error('ELECTROSTATIC_HOST_STORAGE_INVALID: ' + detail); }

// Constants only in the command. Paths are passed as JSON via a task-specific
// environment variable, never interpolated into PowerShell source.
const aclScript = String.raw`
$ErrorActionPreference = 'Stop'
$rows = ConvertFrom-Json $env:TUNACAD_ELECTROSTATIC_ACL_TARGETS
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowed = @($sid, 'S-1-5-18', 'S-1-5-32-544') | Select-Object -Unique
$result = @()
foreach ($path in $rows) {
  if ($env:TUNACAD_ELECTROSTATIC_ACL_PROVISION -eq 'new') {
    $acl = [System.Security.AccessControl.DirectorySecurity]::new()
    $acl.SetOwner([System.Security.Principal.SecurityIdentifier]::new($sid))
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($account in $allowed) {
      $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
        [System.Security.Principal.SecurityIdentifier]::new($account),
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow)
      $acl.AddAccessRule($rule)
    }
    [System.IO.Directory]::SetAccessControl($path, $acl)
  }
  $isDirectory = [System.IO.Directory]::Exists($path)
  $acl = if ($isDirectory) { [System.IO.Directory]::GetAccessControl($path) } else { [System.IO.File]::GetAccessControl($path) }
  $owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
  if (($isDirectory -and $owner -ne $sid) -or ($allowed -notcontains $owner)) { throw 'Unexpected storage owner' }
  if ($isDirectory -and -not $acl.AreAccessRulesProtected) { throw 'Inherited directory DACL' }
  $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
  $ownerControl = $false
  foreach ($rule in $rules) {
    if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny) { throw 'Unsupported deny rule' }
    if ($allowed -notcontains $rule.IdentityReference.Value) { throw 'Unapproved storage principal' }
    if ($rule.IdentityReference.Value -eq $sid -and
      (($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq
       [System.Security.AccessControl.FileSystemRights]::FullControl)) { $ownerControl = $true }
  }
  if (-not $ownerControl) { throw 'Owner FullControl missing' }
  $result += [PSCustomObject]@{ path = $path; owner = $owner;
    directory = [bool]$isDirectory; protected = [bool]$acl.AreAccessRulesProtected;
    rules = @($rules | ForEach-Object {
      $_.IdentityReference.Value + ':' + [int]$_.FileSystemRights + ':' +
      [int]$_.InheritanceFlags + ':' + [int]$_.PropagationFlags + ':' + $_.IsInherited
    } | Sort-Object) }
}
ConvertTo-Json -Depth 5 -Compress -InputObject @($result)
`;

// Interpreter reuse only: no ACL, path or protection result is cached. Every
// bounded request runs the SAME policy against fresh native security descriptors.
// Private inherited pipes correlate replies; timeout/exit/error fails closed.
const aclWorkerScript = String.raw`
$ErrorActionPreference = 'Stop'
while ($null -ne ($line = [Console]::ReadLine())) {
  try {
    $request = ConvertFrom-Json $line
    if ($request.kind -eq 'localApplicationData') {
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
    [Console]::WriteLine((ConvertTo-Json -Compress -InputObject @{id=$request.id; error=$_.Exception.Message}))
  }
}
`;
let worker: ChildProcessWithoutNullStreams | null = null;
let pending: { id: string; paths: string[]; kind: 'acl' | 'localApplicationData'; resolve(value: any): void; reject(error: Error): void;
  timer: ReturnType<typeof setTimeout> } | null = null;
let output = '', idle: ReturnType<typeof setTimeout> | undefined;
let aclQueue: Promise<unknown> = Promise.resolve();
let inspectorOwners = 0;
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
function stopAclWorker(detail: string) {
  const active = worker; worker = null; output = '';
  if (idle) clearTimeout(idle);
  const request = pending; pending = null;
  if (request) { clearTimeout(request.timer); request.reject(new Error('ELECTROSTATIC_HOST_STORAGE_INVALID: ' + detail)); }
  active?.kill();
}
function workerHandles(active: ChildProcessWithoutNullStreams, referenced: boolean) {
  for (const handle of [active, active.stdin, active.stdout, active.stderr]) {
    (handle as any)[referenced ? 'ref' : 'unref']?.();
  }
}
async function verifyAclFresh(paths: string[], kind: 'acl' | 'localApplicationData' = 'acl'): Promise<any> {
  return new Promise((resolveRows, reject) => {
    if (idle) clearTimeout(idle);
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
        const end = output.indexOf('\n'); if (end < 0) return;
        const line = output.slice(0, end).trim(); output = output.slice(end + 1);
        try {
          const response = JSON.parse(line), request = pending;
          if (!request || response.id !== request.id || output.trim()) invalid('ACL response correlation');
          if (response.error) invalid('native inspection failed');
          if (request.kind === 'acl') {
            if (Object.keys(response).sort().join(',') !== 'id,rows' || !Array.isArray(response.rows)
              || response.rows.length !== request.paths.length
              || response.rows.some((row: any, i: number) => row.path !== request.paths[i])) invalid('ACL policy/response mismatch');
          } else if (Object.keys(response).sort().join(',') !== 'id,location' || typeof response.location !== 'string'
            || !response.location.length || response.location.length > 4096) invalid('native location response');
          pending = null; clearTimeout(request.timer); request.resolve(request.kind === 'acl' ? response.rows : response.location);
          workerHandles(active, false);
          if (!inspectorOwners) {
            idle = setTimeout(() => { if (worker === active && !pending && !inspectorOwners) stopAclWorker('ACL idle shutdown'); }, 30000);
            idle.unref();
          }
        } catch (error) { stopAclWorker(String(error)); }
      });
      active.stderr.on('data', () => { if (worker === active) stopAclWorker('ACL worker stderr'); });
      active.on('error', () => { if (worker === active) stopAclWorker('ACL worker startup'); });
      active.on('exit', () => { if (worker === active) stopAclWorker('ACL worker exit'); });
      active.stdin.on('error', () => { if (worker === active) stopAclWorker('ACL worker pipe'); });
    }
    const active = worker!; workerHandles(active, true);
    const id = randomUUID();
    pending = { id, paths, kind, resolve: resolveRows, reject,
      timer: setTimeout(() => stopAclWorker('ACL verification timeout'), 10000) };
    active.stdin.write(JSON.stringify({ id, paths, kind }) + '\n');
  });
}
/** Fresh OS query, not a cached location or environment-variable override. */
export async function readNativeWindowsLocalApplicationData(): Promise<string> {
  if (process.platform !== 'win32') invalid('Windows native location required');
  const request = aclQueue.then(() => verifyAclFresh([], 'localApplicationData'));
  aclQueue = request.catch(() => undefined);
  return request;
}
async function acl(paths: string[], provision = false): Promise<any[]> {
  if (process.platform !== 'win32') invalid('Windows ACL host policy required; other hosts unsupported');
  if (!paths.length || paths.length > 160) invalid('ACL enumeration bound');
  if (!provision) {
    const request = aclQueue.then(() => verifyAclFresh(paths));
    aclQueue = request.catch(() => undefined);
    return request;
  }
  const result = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', aclScript],
    { windowsHide: true, timeout: 10000, maxBuffer: 128 * 1024, env: { ...process.env,
      TUNACAD_ELECTROSTATIC_ACL_TARGETS: JSON.stringify(paths),
      TUNACAD_ELECTROSTATIC_ACL_PROVISION: provision ? 'new' : 'verify' } });
  const rows = JSON.parse(result.stdout);
  if (!Array.isArray(rows) || rows.length !== paths.length) invalid('ACL response incomplete');
  return rows;
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
  let handle;
  try { handle = await open(path, 'wx', 0o600); }
  catch (error: any) {
    if (error.code !== 'EEXIST') throw error;
    if (digest(await readElectrostaticHostJson(path, maximumBytes)) !== digest(value)) invalid('immutable record changed');
    return;
  }
  try { await handle.writeFile(bytes, 'utf8'); await handle.sync(); }
  finally { await handle.close(); }
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
    await this.verifyAncestry(dirname(root));
    await mkdir(root); // EEXIST refuses to modify an existing root.
    await acl([root], true);
    for (const role of roles) await mkdir(join(root, role));
    const dirs = await this.directories(root);
    const protection = await acl(dirs.paths, true);
    const configuration = { schema: 'tunacad-electrostatic-host-storage/0.1', storageId: randomUUID(),
      sourceIdentityVersion: ELECTROSTATIC_SOURCE_IDENTITY, root,
      roles: Object.fromEntries(roles.map(role => [role, join(root, role)])),
      protectionPolicy, directoryIdentities: dirs.identities, protection };
    const configurationDigest = digest(configuration);
    await writeElectrostaticHostOnce(join(root, 'configuration.json'), configuration, 128 * 1024);
    await writeElectrostaticHostOnce(join(root, 'source-catalog', 'configuration.pin.json'),
      { schema: 'tunacad-electrostatic-host-storage-pin/0.1', configurationDigest }, 2048);
    return this.open(root);
  }
  static async open(path: string): Promise<ElectrostaticHostStorage> {
    const root = this.rootPath(path);
    const configuration = await readElectrostaticHostJson(join(root, 'configuration.json'), 128 * 1024);
    const pin = await readElectrostaticHostJson(join(root, 'source-catalog', 'configuration.pin.json'), 2048);
    if (pin.schema !== 'tunacad-electrostatic-host-storage-pin/0.1'
      || Object.keys(pin).sort().join(',') !== 'configurationDigest,schema'
      || digest(configuration) !== pin.configurationDigest) invalid('configuration pin mismatch');
    const storage = new this(root, configuration, pin.configurationDigest);
    await storage.assertReady();
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
  async assertReady() {
    const dirs = await this.verifyConfiguration();
    const roots = await acl(dirs.paths);
    if (digest(roots) !== digest(this.configuration.protection)) invalid('storage ACL policy changed');
    const files = [join(this.root, 'configuration.json')];
    for (const role of roles) {
      const names = await readdir(this.paths[role]);
      if (names.length > 40) invalid('storage file-count bound');
      for (const name of names) {
        const path = join(this.paths[role], name); const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink() || info.size > maximumFileBytes) invalid('storage entry shape/budget');
        files.push(path);
      }
    }
    await acl(files); // Effective file ACLs must not introduce another principal.
  }
}
