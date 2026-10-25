# Private inherited pipes only. No storage paths, files, approvals or recovery.
$ErrorActionPreference = 'Stop'
$mutex = $null
$clean = $false
try {
  $request = ConvertFrom-Json ([Console]::ReadLine())
  if ((($request.PSObject.Properties.Name | Sort-Object) -join ',') -ne 'id,ownerPid,scope' -or
      $request.id -notmatch '^[a-f0-9]{64}$' -or $request.scope -notmatch '^[a-f0-9]{64}$' -or
      $request.ownerPid -le 1) { throw 'protocol' }
  $owner = [Diagnostics.Process]::GetProcessById([int]$request.ownerPid)
  $null = $owner.Handle # Pin this process instance, not a later reused PID.
  if ($owner.HasExited) { throw 'owner_exit' }
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $allowed = @($sid, 'S-1-5-18', 'S-1-5-32-544') | Select-Object -Unique
  $security = [Security.AccessControl.MutexSecurity]::new()
  $security.SetOwner([Security.Principal.SecurityIdentifier]::new($sid))
  $security.SetAccessRuleProtection($true, $false)
  foreach ($account in $allowed) {
    $security.AddAccessRule([Security.AccessControl.MutexAccessRule]::new(
      [Security.Principal.SecurityIdentifier]::new($account),
      [Security.AccessControl.MutexRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow))
  }
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $ownerHash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($sid)))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
  $created = $false
  $mutex = [Threading.Mutex]::new($false, ('Global\TunaCADOwnerMaintenance-' + $ownerHash + '-' + $request.scope), [ref]$created, $security)
  # Existing objects are inspected, NEVER repaired or re-permissioned.
  $actual = $mutex.GetAccessControl()
  if (-not $actual.AreAccessRulesProtected -or $actual.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid) { throw 'policy' }
  $ownerControl = $false
  foreach ($rule in $actual.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or $allowed -notcontains $rule.IdentityReference.Value) { throw 'policy' }
    if ($rule.IdentityReference.Value -eq $sid -and
        ($rule.MutexRights -band [Security.AccessControl.MutexRights]::FullControl) -eq [Security.AccessControl.MutexRights]::FullControl) { $ownerControl = $true }
  }
  if (-not $ownerControl) { throw 'policy' }
  try { if (-not $mutex.WaitOne(0)) { throw 'busy' } }
  catch [Threading.AbandonedMutexException] { throw 'abandoned' }
  [Console]::WriteLine((ConvertTo-Json -Compress -InputObject @{type='acquired'; id=$request.id; fresh=[bool]$created}))
  $line = [Console]::In.ReadLineAsync()
  while (-not $line.Wait(100)) { if ($owner.HasExited) { throw 'owner_exit' } }
  $text = $line.Result
  if ($null -eq $text -or $owner.HasExited) { throw 'owner_exit' }
  $release = ConvertFrom-Json $text
  if ((($release.PSObject.Properties.Name | Sort-Object) -join ',') -ne 'id,type' -or $release.type -ne 'release' -or $release.id -cne $request.id) { throw 'protocol' }
  $mutex.ReleaseMutex()
  $clean = $true
  [Console]::WriteLine((ConvertTo-Json -Compress -InputObject @{type='released'; id=$request.id}))
} catch {
  $reason = 'helper_failed'
  if ($_.Exception.Message -in @('protocol','owner_exit','policy','busy','abandoned')) { $reason = $_.Exception.Message }
  [Console]::WriteLine((ConvertTo-Json -Compress -InputObject @{type='rejected'; id=$request.id; reason=$reason}))
} finally {
  if ($null -ne $owner) { $owner.Dispose() }
  if ($clean) { $mutex.Dispose() }
}
# Unexpected EOF/error NEVER releases ownership as a clean shutdown. Windows
# may report abandonment to existing waiters. A fresh object is NOT old-writer
# shutdown evidence; existing durable storage locks remain untouched.
if (-not $clean) { [Environment]::Exit(2) }
