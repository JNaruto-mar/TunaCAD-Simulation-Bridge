import {win32} from 'node:path';
import {AsyncLocalStorage} from 'node:async_hooks';

// Trusted native timing scope only. It cannot skip a check or grant access.
// Read-only verification remains fresh; no result or security decision is cached.
type VerificationAccounting=<T>(operation:string,read:()=>Promise<T>)=>Promise<T>;
const verificationAccounting=new AsyncLocalStorage<VerificationAccounting|undefined>();
export function withNativeStorageVerificationAccounting<T>(account:VerificationAccounting,work:()=>Promise<T>){
 return verificationAccounting.run(account,work);
}
export function nativeStorageReadinessOperation<T>(operation:string,read:()=>Promise<T>):Promise<T>{
 const account=verificationAccounting.getStore();
 // An encompassing verification owns nested checks; count elapsed time once.
 return account?verificationAccounting.run(undefined,()=>account(operation,read)):read();
}

// Diagnostics only. No filesystem/OS inspection, authorization, or policy decisions.
const stages=['arguments-and-platform','options-validation','known-folder-query','location-policy','application-data-ancestry',
 'maintenance-root-registration','protected-root-presence','protected-store-validation','storage-adapter-validation',
 'capacity-adapter-registration','mesh-reader-open','export-reader-open','existing-storage-ACL-and-pins',
 'storage-configuration-read','storage-configuration-pin-read','configuration-pin-validation','configuration-revalidation',
 'directory-identity-validation','directory-acl-verification','protected-role-inventory','protected-file-acl-verification','acl-policy-verification',
 'allocation-lock-before','explicit-reservation-and-disk-headroom','allocation-lock-after','final-storage-revalidation'] as const;
type Stage=typeof stages[number];
const cwdKinds=['checkout','inside-checkout','drive-root','user-profile','ancestor-of-protected-storage','other','unavailable'] as const;
type CwdKind=typeof cwdKinds[number];
const details:Record<string,{reason:string;stage:Stage;category:string}>={
 'invalid Windows LocalApplicationData known folder':{reason:'known-folder-invalid',stage:'location-policy',category:'execution-context'},
 'drive root is not application data':{reason:'known-folder-is-drive-root',stage:'location-policy',category:'execution-context'},
 'temporary/repository location forbidden':{reason:'temporary-or-working-directory-overlap',stage:'location-policy',category:'execution-context'},
 'reparse/non-directory ancestry':{reason:'unsafe-application-data-ancestry',stage:'application-data-ancestry',category:'storage-safety-rejection'},
 'not provisioned; explicit native provisioning required':{reason:'existing-store-not-found',stage:'protected-root-presence',category:'storage-location-unavailable'},
 'caller root/configuration override forbidden':{reason:'options-override-forbidden',stage:'options-validation',category:'execution-context'},
 'Windows native storage only':{reason:'windows-required',stage:'arguments-and-platform',category:'execution-context'},
 'native protected storage adapter required':{reason:'native-adapter-required',stage:'storage-adapter-validation',category:'inspection-unavailable'},
};
const marked=new WeakMap<object,{stage?:Stage;overlap?:'temporary-directory'|'working-directory'}>();
/** Annotate only the original error identity, never replace it or accept a grant. */
export function markNativeStorageFailure(error:unknown,stage:Stage,overlap?:'temporary-directory'|'working-directory'){
 if(error&&typeof error==='object'&&stages.includes(stage)&&!marked.has(error))marked.set(error,{stage,...(['temporary-directory','working-directory'].includes(overlap??'')?{overlap}:{})});
}
export async function nativeStorageValidationStage<T>(stage:Stage,read:()=>Promise<T>):Promise<T>{
 try{return await read();}catch(error){markNativeStorageFailure(error,stage);throw error;}
}
export function classifyPreflightWorkingDirectory(cwd:unknown,checkout:unknown,profile?:unknown):CwdKind{
 if(typeof cwd!=='string'||typeof checkout!=='string'||!win32.isAbsolute(cwd)||!win32.isAbsolute(checkout))return 'unavailable';
 const clean=(p:string)=>win32.resolve(p).toLowerCase(),a=clean(cwd),b=clean(checkout),r=win32.relative(b,a);
 if(a===b)return 'checkout';
 if(r&&!r.startsWith('..')&&!win32.isAbsolute(r))return 'inside-checkout';
 if(a===clean(win32.parse(a).root))return 'drive-root';
 if(typeof profile==='string'&&win32.isAbsolute(profile)&&a===clean(profile))return 'user-profile';
 return 'other';
}
const osCodes=['EPERM','EACCES','ENOENT','EIO','ENOSPC','ETIMEDOUT','EEXIST'];
/** Closed output vocabulary: no raw messages, paths, stacks, causes or identifiers. */
export function describeNativeStoragePreflightFailure(error:unknown,context:{stage:string;workingDirectory:string}){
 const e=error as {message?:unknown;code?:unknown},message=typeof e?.message==='string'?e.message:'',meta=error&&typeof error==='object'?marked.get(error):undefined;
 let stage:Stage| 'unknown'=meta?.stage??(stages.includes(context.stage as Stage)?context.stage as Stage:'unknown');
 let workingDirectory:CwdKind=cwdKinds.includes(context.workingDirectory as CwdKind)?context.workingDirectory as CwdKind:'unavailable';
 let code='INSPECTION_FAILED',reason='unclassified-failure',category='unknown';
 if(osCodes.includes(e?.code as string)){code=e.code as string;reason=code==='ENOENT'?'filesystem-entry-missing':code==='EPERM'||code==='EACCES'?'inspection-access-denied':code==='ETIMEDOUT'?'inspection-timeout':'filesystem-operation-failed';category='inspection-unavailable';}
 else if(message.startsWith('NATIVE_SIMULATION_STORAGE_INVALID: ')){
  code='NATIVE_SIMULATION_STORAGE_INVALID';const key=message.slice('NATIVE_SIMULATION_STORAGE_INVALID: '.length),d=Object.hasOwn(details,key)?details[key]:undefined;
  if(d){({reason,stage,category}=d);if(meta?.overlap){reason=meta.overlap==='temporary-directory'?'storage-under-temporary-directory':'storage-under-working-directory';if(meta.overlap==='working-directory'&&workingDirectory==='other')workingDirectory='ancestor-of-protected-storage';}}
 }else if(message.startsWith('ELECTROSTATIC_HOST_STORAGE_INVALID: ')){
  code='ELECTROSTATIC_HOST_STORAGE_INVALID';const detail=message.slice('ELECTROSTATIC_HOST_STORAGE_INVALID: '.length);
  const pin:Record<string,Stage>={'configuration pin mismatch':'configuration-pin-validation','configuration/version changed':'configuration-revalidation','storage directory identity changed':'directory-identity-validation'};
  if(Object.hasOwn(pin,detail)){stage=pin[detail];reason=detail==='configuration pin mismatch'?'configuration-pin-mismatch':detail==='configuration/version changed'?'configuration-changed':'directory-identity-changed';category='storage-validation-rejection';}
  else if(/^native inspection rejected: (owner|inherited_dacl|deny_rule|principal|owner_control)$/.test(detail)){stage='acl-policy-verification';reason='acl-'+detail.split(': ')[1].replaceAll('_','-');category='storage-validation-rejection';}
  else if(detail==='storage ACL policy changed'){stage='acl-policy-verification';reason='acl-policy-changed';category='storage-validation-rejection';}
  else if(detail==='ACL verification timeout'){reason='acl-inspection-timeout';category='inspection-unavailable';}
 }else if(['EXPLICIT_PREFLIGHT_WINDOWS_NO_ARGUMENTS_REQUIRED','EXPLICIT_PREFLIGHT_POLICY_MISMATCH','DEADLINE'].includes(message)){code=message;reason=message==='DEADLINE'?'inspection-deadline':message==='EXPLICIT_PREFLIGHT_POLICY_MISMATCH'?'reservation-policy-mismatch':'windows-or-arguments-invalid';category=message==='EXPLICIT_PREFLIGHT_WINDOWS_NO_ARGUMENTS_REQUIRED'?'execution-context':'inspection-unavailable';}
 else if(/^NATIVE_WORKFLOW_CAPACITY_(COUNT|BYTE_BUDGET|DISK_HEADROOM|FREE_SPACE_UNVERIFIABLE|RECORD_INVALID|IDENTITY_CHANGED|UNSAFE_ENTRY|SCAN_TIMEOUT|SCAN_DEPTH|SCAN_LIMIT|CHANGED_DURING_SCAN)$/.test(message)){code=message;reason='capacity-policy-rejected';category='capacity-rejection';}
 return Object.freeze({code,reason,stage,category,workingDirectory});
}
