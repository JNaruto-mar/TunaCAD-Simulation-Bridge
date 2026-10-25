// Shared owner-only ACL policy; no storage, reservation or maintenance operations.
export const nativeDirectoryAclScript = String.raw`
$ErrorActionPreference = 'Stop'
if ($inspectionProgress) { & $inspectionProgress 'principal' }
$rows = ConvertFrom-Json $env:TUNACAD_ELECTROSTATIC_ACL_TARGETS
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowed = @($sid, 'S-1-5-18', 'S-1-5-32-544') | Select-Object -Unique
$result = @()
foreach ($path in $rows) {
  if ($env:TUNACAD_ELECTROSTATIC_ACL_PROVISION -eq 'new') {
    if ($inspectionProgress) { & $inspectionProgress 'acl-construction' }
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
    if ($inspectionProgress) { & $inspectionProgress 'acl-application' }
    [System.IO.Directory]::SetAccessControl($path, $acl)
  }
  if ($inspectionProgress) { & $inspectionProgress 'descriptor' }
  $isDirectory = [System.IO.Directory]::Exists($path)
  $acl = if ($isDirectory) { [System.IO.Directory]::GetAccessControl($path) } else { [System.IO.File]::GetAccessControl($path) }
  if ($inspectionProgress) { & $inspectionProgress 'policy' }
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
if ($inspectionProgress) { & $inspectionProgress 'serialization' }
ConvertTo-Json -Depth 5 -Compress -InputObject @($result)
`;
