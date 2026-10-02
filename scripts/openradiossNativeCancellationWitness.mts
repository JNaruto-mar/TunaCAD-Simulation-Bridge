// Test-only, read-only ownership/output witnesses. Never launches/kills a solver,
// changes Job Object policy, or admits partial data as a normalized result.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile);
const script=String.raw`
$ErrorActionPreference='Stop'
$rootPid=[int]$env:TUNACAD_CANCEL_WRAPPER_PID
$fixturePid=[int]$env:TUNACAD_CANCEL_FIXTURE_PID
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class CancelJobWitness {
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool result);
}
'@
$all=@(Get-CimInstance Win32_Process)
$owned=@();$front=if($rootPid -gt 0) {@($rootPid)} else {@()}
for($depth=0;$depth -lt 8 -and $front.Count -gt 0;$depth++) {
 $selected=@($all | Where-Object {$front -contains [int]$_.ProcessId})
 $owned+= $selected
 $front=@($all | Where-Object {$front -contains [int]$_.ParentProcessId} | ForEach-Object {[int]$_.ProcessId})
 if($owned.Count -gt 32) {throw 'Bounded provider tree exceeded'}
}
if($front.Count -gt 0) {throw 'Provider tree depth exceeded'}
$convert={param($p)
 [PSCustomObject]@{pid=[int]$p.ProcessId;parentPid=[int]$p.ParentProcessId;name=$p.Name;executable=$p.ExecutablePath;
  createdAt=$(if($null -ne $p.CreationDate) {$p.CreationDate.ToUniversalTime().ToString('o')} else {'unavailable'})}
}
$nodes=@($owned | ForEach-Object {& $convert $_})
$engines=@($owned | Where-Object {$_.Name -eq 'engine_win64.exe'} | ForEach-Object {
 $p=Get-Process -Id $_.ProcessId -ErrorAction Stop
 try {$member=$false;if(-not [CancelJobWitness]::IsProcessInJob($p.Handle,[IntPtr]::Zero,[ref]$member)) {throw 'Job membership query failed'}
  [PSCustomObject]@{identity=(& $convert $_);inJob=$member;commandLine=$_.CommandLine}
 } finally {$p.Dispose()}
})
$unrelated=@($all | Where-Object {$_.Name -eq 'explorer.exe' -or [int]$_.ProcessId -eq $fixturePid} | ForEach-Object {& $convert $_})
$solvers=@($all | Where-Object {$_.Name -eq 'engine_win64.exe' -or $_.Name -eq 'starter_win64.exe'} | ForEach-Object {& $convert $_})
# Include all PID/creation pairs to test survivors even after their parent exits.
$alive=@($all | ForEach-Object {[PSCustomObject]@{pid=[int]$_.ProcessId;createdAt=$(if($null -ne $_.CreationDate) {$_.CreationDate.ToUniversalTime().ToString('o')} else {'unavailable'})}})
ConvertTo-Json -Depth 6 -Compress -InputObject ([PSCustomObject]@{at=[DateTime]::UtcNow.ToString('o');nodes=$nodes;engines=$engines;
 unrelated=$unrelated;solvers=$solvers;alive=$alive})
`;
export interface ProcessIdentity {pid:number;parentPid:number;name:string;executable:string;createdAt:string}
export interface TreeSnapshot {at:string;nodes:ProcessIdentity[];engines:Array<{identity:ProcessIdentity;inJob:boolean;commandLine:string}>;
  unrelated:ProcessIdentity[];solvers:ProcessIdentity[];alive:Array<{pid:number;createdAt:string}>}
export async function snapshotNativeTree(wrapperPid:number):Promise<TreeSnapshot> {
  if(!Number.isSafeInteger(wrapperPid)||wrapperPid<0) throw new Error('Invalid owned wrapper PID');
  const output=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],
    {windowsHide:true,timeout:8000,maxBuffer:256*1024,env:{...process.env,
      TUNACAD_CANCEL_WRAPPER_PID:String(wrapperPid),TUNACAD_CANCEL_FIXTURE_PID:String(process.pid)}});
  return JSON.parse(output.stdout);
}
/** Source-backed exact current 3040 subset: 22 metadata records, then frames
 * [time:4, globals:22*4, ten nodes*four channels*4]. This witness only establishes
 * a complete positive-time record. Incomplete tails remain incomplete and are
 * NEVER passed to result recovery or accepted as completed history evidence. */
export function positiveCancellationTime(bytes:Uint8Array,durationS:number) {
  if(bytes.length>8*1024*1024) throw new Error('Cancellation witness byte bound');
  const b=Buffer.from(bytes),records:Array<{at:number;length:number}>=[];let at=0;
  while(at+4<=b.length) {
    const length=b.readInt32BE(at);if(length<0||length>65536) throw new Error('Malformed cancellation record');
    if(at+length+8>b.length) break;
    if(b.readInt32BE(at+length+4)!==length) throw new Error('Malformed cancellation envelope');
    records.push({at:at+4,length});at+=length+8;
    if(records.length>256) throw new Error('Cancellation witness record bound');
  }
  if(!records.length) return null;
  if(b.readInt32BE(records[0].at)!==3040) throw new Error('Unsupported cancellation witness layout');
  for(let i=22;i+2<records.length;i+=3) {
    const [t,g,n]=records.slice(i,i+3);
    if(t.length!==4||g.length!==88||n.length!==160) throw new Error('Wrong cancellation frame schema');
    const timeS=b.readFloatBE(t.at);
    if(!Number.isFinite(timeS)||timeS<0||timeS>durationS) throw new Error('Invalid cancellation time');
    if(timeS>0) return {timeS,record:i,timeRecordOffset:t.at,completePrefixBytes:n.at+n.length+4,observedBytes:b.length};
  }
  return null;
}
export function requireNoOwnedSurvivors(before:TreeSnapshot,after:TreeSnapshot) {
  const survived=before.nodes.filter(n=>after.alive.some(p=>p.pid===n.pid&&p.createdAt===n.createdAt));
  if(survived.length) throw new Error('Provider-owned process survived: '+JSON.stringify(survived));
  for(const p of before.unrelated) if(!after.alive.some(n=>n.pid===p.pid&&n.createdAt===p.createdAt))
    throw new Error('Unrelated baseline process disappeared: '+p.pid);
  if(after.solvers.length) throw new Error('OpenRadioss process still alive');
  return {ownedTerminated:before.nodes,unrelatedPreserved:before.unrelated,survivors:[],checkedAt:after.at};
}
