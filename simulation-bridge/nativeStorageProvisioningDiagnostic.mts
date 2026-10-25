/** Closed vocabulary only: no native messages, stderr, paths, accounts or ACLs. */
export function sanitizeProvisioningDiagnostic(value:any){
  if(value?.schema!=='tunacad-acl-provisioning-failure/1'||!['root-acl','role-acls'].includes(value.phase))return;
  const stages=['startup','unknown','principal','acl-construction','acl-application','descriptor','policy','serialization','response'];
  const codes=['EPERM','EACCES','ENOENT','EEXIST','EIO','ENOSPC','ETIMEDOUT','ERR_CHILD_PROCESS_STDIO_MAXBUFFER'];
  const exceptions=['System.UnauthorizedAccessException','System.Security.SecurityException','System.IO.IOException',
    'System.IO.DirectoryNotFoundException','System.ArgumentException','System.ArgumentNullException','System.InvalidOperationException',
    'System.PlatformNotSupportedException','System.NotSupportedException','System.Security.Principal.IdentityNotMappedException',
    'System.Management.Automation.MethodException','System.Management.Automation.MethodInvocationException',
    'System.Management.Automation.RuntimeException'];
  if(!stages.includes(value.stage)||!Number.isSafeInteger(value.elapsedMs)||value.elapsedMs<0||value.elapsedMs>3600000||value.deadlineMs!==10000)return;
  return {schema:'tunacad-acl-provisioning-failure/1',phase:value.phase,stage:value.stage,elapsedMs:value.elapsedMs,deadlineMs:10000,
    ...(Number.isInteger(value.exitCode)&&value.exitCode>=-2147483648&&value.exitCode<=4294967295?{exitCode:value.exitCode}:{}),
    ...(codes.includes(value.osCode)?{osCode:value.osCode}:{}),
    ...(['SIGTERM','SIGKILL'].includes(value.signal)?{signal:value.signal}:{}),
    ...(typeof value.timedOut==='boolean'?{timedOut:value.timedOut}:{}),
    ...(exceptions.includes(value.exception)?{exception:value.exception}:{}),
    ...(typeof value.hresult==='string'&&/^[0-9A-Fa-f]{8}$/.test(value.hresult)?{hresult:value.hresult.toUpperCase()}:{}),
  };
}
export function provisioningFailure(error:any,phase:'root-acl'|'role-acls',elapsedMs:number,response=false){
  let native:any;try{native=JSON.parse(error?.stdout);}catch{/* No raw output in diagnostics. */}
  const nativeReply=native?.schema==='tunacad-acl-provisioning-error/1';
  return sanitizeProvisioningDiagnostic({schema:'tunacad-acl-provisioning-failure/1',phase,
    stage:response?'response':nativeReply&&['principal','acl-construction','acl-application','descriptor','policy','serialization'].includes(native.stage)?native.stage:
      ['EPERM','EACCES','ENOENT','EIO'].includes(error?.code)?'startup':'unknown',
    elapsedMs:Math.round(elapsedMs),deadlineMs:10000,
    exitCode:response?0:error?.code,osCode:error?.code,signal:error?.signal,
    // execFile's killed flag can also mean output-budget termination. Don't
    // mislabel that as a timeout; absent evidence stays unknown.
    ...(error?.killed===true&&error?.signal==='SIGTERM'&&typeof error?.code!=='string'?{timedOut:true}:{}),
    ...(nativeReply?{exception:native.exception,hresult:native.hresult}:{})});
}
