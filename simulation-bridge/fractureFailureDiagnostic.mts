import {sanitizeProvisioningDiagnostic} from './nativeStorageProvisioningDiagnostic.mts';
/** Bounded, closed-vocabulary diagnostics. Originals stay in Error.cause;
 * public summaries never include messages, stacks, paths or record contents. */
export function fractureFailureDiagnostic(error:unknown){
  const seen=new Set<unknown>(),leaves:any[]=[],stages:string[]=[],provisioning:NonNullable<ReturnType<typeof sanitizeProvisioningDiagnostic>>[]=[];
  const allowedStages=['workflow-allocation','maintenance-binding','claim-initialization','evidence-initialization'];
  function visit(value:any,depth=0){
    if(depth>8||seen.size>=16||!value||typeof value!=='object'||seen.has(value))return;
    seen.add(value);if(allowedStages.includes(value.storageStage))stages.push(value.storageStage);
    const p=sanitizeProvisioningDiagnostic(value.provisioning);if(p)provisioning.push(p);
    const children=[...(value.cause?[value.cause]:[]),...(value instanceof AggregateError?value.errors.slice(0,8):[])];
    const before=leaves.length;for(const child of children)visit(child,depth+1);
    if(leaves.length===before)leaves.push(value);
  }
  function safe(value:any){
    const message=typeof value?.message==='string'?value.message:'';
    const code=['EPERM','EACCES','ENOENT','EEXIST','EIO','ENOSPC','ETIMEDOUT'].includes(value?.code)?value.code:
      message.match(/^(?:FRACTURE|STATIONARY_FRACTURE|NATIVE_WORKFLOW_CAPACITY|NATIVE_WORKFLOW_CLAIM|NATIVE_OWNER_MAINTENANCE|NATIVE_SIMULATION|WORKFLOW_OWNER|ELECTROSTATIC_HOST_STORAGE)_[A-Z0-9_]{1,80}(?=[:\s]|$)/)?.[0]??'UNKNOWN_FAILURE';
    const d=value?.diagnostic;
    const inspection=d&&['acl','localApplicationData'].includes(d.kind)
      &&['startup','dispatch','known_folder','principal','descriptor','policy','serialization'].includes(d.stage)
      &&['pending','succeeded','rejected','cancelled'].includes(d.status)
      &&['not_required','terminated','unconfirmed'].includes(d.cleanup)
      &&[d.elapsedMs,d.queuedMs,d.deadlineMs].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=3600000)
      ?{kind:d.kind,stage:d.stage,status:d.status,cleanup:d.cleanup,elapsedMs:d.elapsedMs,queuedMs:d.queuedMs,deadlineMs:d.deadlineMs}:undefined;
    const aclReason=message.match(/^ELECTROSTATIC_HOST_STORAGE_INVALID: native inspection rejected: (owner|inherited_dacl|deny_rule|principal|owner_control|native_inspection_failed)(?=\s|$)/)?.[1];
    const reason=message.startsWith('ELECTROSTATIC_HOST_STORAGE_INVALID: ACL verification timeout')?'acl-timeout':aclReason?'acl-'+aclReason:undefined;
    return {code,...(reason?{reason}:{}),...(inspection?{inspection}:{})};
  }
  visit(error);if(!leaves.length)leaves.push(undefined);
  return {schema:'tunacad-fracture-failure/1',...(stages[0]?{storageStage:stages[0]}:{}),
    ...(provisioning[0]?{provisioning:provisioning[0]}:{}),
    primary:safe(leaves[0]),secondary:leaves.slice(1,8).map(safe)};
}
/** Revalidate serialized summaries at receipt/transport boundaries. */
export function sanitizeFractureFailureSummary(value:any){
  if(value?.schema!=='tunacad-fracture-failure/1')return;
  const normalize=(entry:any)=>{
    let message=typeof entry?.code==='string'?entry.code:'';
    if(entry?.reason==='acl-timeout')message='ELECTROSTATIC_HOST_STORAGE_INVALID: ACL verification timeout';
    const acl=typeof entry?.reason==='string'?entry.reason.match(/^acl-(owner|inherited_dacl|deny_rule|principal|owner_control|native_inspection_failed)$/)?.[1]:undefined;
    if(acl)message='ELECTROSTATIC_HOST_STORAGE_INVALID: native inspection rejected: '+acl;
    return fractureFailureDiagnostic(Object.assign(new Error(message),{code:entry?.code,diagnostic:entry?.inspection})).primary;
  };
  return {schema:'tunacad-fracture-failure/1',
    ...(sanitizeProvisioningDiagnostic(value.provisioning)?{provisioning:sanitizeProvisioningDiagnostic(value.provisioning)}:{}),
    ...(['workflow-allocation','maintenance-binding','claim-initialization','evidence-initialization'].includes(value.storageStage)?{storageStage:value.storageStage}:{}),
    primary:normalize(value.primary),secondary:Array.isArray(value.secondary)?value.secondary.slice(0,8).map(normalize):[]};
}
