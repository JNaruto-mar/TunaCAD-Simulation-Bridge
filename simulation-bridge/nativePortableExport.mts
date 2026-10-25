import {randomUUID} from 'node:crypto';
import {createNewCompletionPortableExporter} from '../src/simulation/newCompletionPortableExport.ts';
import {portableResultExportRequest,type AuthorizedPortableResult,type OwnerExportReceiptVerifier} from '../src/simulation/authorizedPortableResults.ts';
import {createPortableExportVerifier,portableExportReceiptBytes,type PortableExportTrustAnchor} from '../src/simulation/portableExportTrust.ts';
import {webCryptoDigest as hash} from './v2ValidationBrowser.mts';

// Qualification is a reviewed code change, not an environment/HTTP/config flag.
export const NATIVE_PORTABLE_EXPORT_ENABLED=false;
export type NativePortableCompletion=Pick<AuthorizedPortableResult,'origin'|'data'>;
export interface PortableExportReview {
  schema:'tunacad-portable-result-export-consent/1';scope:'sanitized_read_only_result_export';
  reviewId:string;studyId:string;revision:string;kind:AuthorizedPortableResult['data']['kind'];
  payloadDigest:string;originDigest:string;bytes:number;expiresAt:number;
  description:string;engineeringUsePermitted:false;
}
export interface NativePortableReceiptAuthority {
  readonly issuerFingerprint:string;readonly verifier:OwnerExportReceiptVerifier;
  issueReceipt(claims:Omit<AuthorizedPortableResult['exportReceipt'],'signature'>,signal:AbortSignal,signingPermit:object):Promise<string>;
}
// Internal signing permit, not another approval system. Only the successful
// existing owner human-consent callback below can create one. Never serialized.
const signingPermits=new WeakMap<object,{payloadDigest:string;originDigest:string;consentDigest:string;authorizedAt:string;
  issuerFingerprint:string;expiresAt:number;now():number;signal:AbortSignal}>();
/** A qualified host supplies an existing non-extractable key and INDEPENDENT
 * trust anchors. No key generation/import, paths, ACL changes or key persistence.
 * Prove key/anchor agreement before returning even an internal signing port. */
export async function createNativePortableReceiptAuthority(key:CryptoKey,anchor:PortableExportTrustAnchor,
  trustedAnchors:readonly PortableExportTrustAnchor[]):Promise<NativePortableReceiptAuthority>{
  if(key.type!=='private'||key.extractable||key.algorithm.name!=='ECDSA'||(key.algorithm as EcKeyAlgorithm).namedCurve!=='P-256'||
    key.usages.length!==1||key.usages[0]!=='sign')throw Error('PORTABLE_EXPORT_NONEXTRACTABLE_SIGNING_KEY_REQUIRED');
  const verifier=createPortableExportVerifier(trustedAnchors),issuerFingerprint=anchor.issuerFingerprint;
  if(await hash(anchor.publicKey)!==issuerFingerprint)throw Error('PORTABLE_EXPORT_TRUST_ANCHOR_INVALID');
  const sign=async(claims:Omit<AuthorizedPortableResult['exportReceipt'],'signature'>)=>Buffer.from(await crypto.subtle.sign(
    {name:'ECDSA',hash:'SHA-256'},key,await portableExportReceiptBytes({...claims,signature:''}))).toString('base64');
  const h=await hash('signing-key-qualification:'+randomUUID()),probe={schema:'tunacad-owner-export-receipt/1' as const,
    issuerFingerprint,receiptId:'key-qualification',scope:'sanitized_read_only_result_export' as const,payloadDigest:h,originDigest:h,
    consentDigest:h,authorizedAt:new Date().toISOString()};
  await verifier.verify({...probe,signature:await sign(probe)},{payloadDigest:h,originDigest:h});
  return Object.freeze({issuerFingerprint,verifier,async issueReceipt(claims:Omit<AuthorizedPortableResult['exportReceipt'],'signature'>,signal:AbortSignal,permit:object){
    const approved=signingPermits.get(permit);signingPermits.delete(permit);
    if(!approved||approved.signal.aborted||approved.now()>=approved.expiresAt||approved.issuerFingerprint!==issuerFingerprint||
      approved.payloadDigest!==claims.payloadDigest||approved.originDigest!==claims.originDigest||approved.consentDigest!==claims.consentDigest||approved.authorizedAt!==claims.authorizedAt)
      throw Error('PORTABLE_EXPORT_CONSUMED_HUMAN_CONSENT_REQUIRED');
    signal.throwIfAborted();if(claims.issuerFingerprint!==issuerFingerprint||claims.scope!=='sanitized_read_only_result_export'||
      !claims.consentDigest||!claims.authorizedAt)throw Error('PORTABLE_EXPORT_SIGNING_SCOPE_INVALID');
    const signature=await sign(claims);signal.throwIfAborted();approved.signal.throwIfAborted();
    if(approved.now()>=approved.expiresAt)throw Error('PORTABLE_EXPORT_CONSENT_EXPIRED');return signature;
  }});
}
/** Shared adapter for the EXISTING authenticated owner's human approve callback.
 * Its only input is a source-verified new completion, never a historical ID or
 * browser-supplied numerical payload. No geometry/solve approvals are consumed. */
export function createNativeCompletedExport(ports:{
  authority:NativePortableReceiptAuthority;
  readSession():Promise<{identity:string;expiresAt:number}|null>;
  readCompletion(signal:AbortSignal):Promise<NativePortableCompletion>;
  /** Fresh owner/source/ACL/result-manifest verification without recollecting
   * immutable numerical fields at every consent boundary. Never a cached decision. */
  assertCurrent?(completion:NativePortableCompletion,signal:AbortSignal):Promise<void>;
  approve(review:PortableExportReview,signal:AbortSignal):Promise<boolean>;
  now?:()=>number;
}){
  const now=ports.now??Date.now;let pending=false,closed=false,attempts=0;
  let active:AbortController|null=null;
  const bounded=async<T,>(signal:AbortSignal,operation:()=>Promise<T>):Promise<T>=>{
    signal.throwIfAborted();return new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason);
      signal.addEventListener('abort',abort,{once:true});Promise.resolve().then(()=>{signal.throwIfAborted();return operation();}).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
  };
  return {async export(expected:{kind:AuthorizedPortableResult['data']['kind'];origin:AuthorizedPortableResult['origin']},caller:AbortSignal){
    if(closed||pending||++attempts>8)throw Error('PORTABLE_EXPORT_UNAVAILABLE_OR_SINGLE_USE');
    const controller=new AbortController();active=controller;pending=true;
    const signal=AbortSignal.any([caller,controller.signal,AbortSignal.timeout(120000)]);
    try{
      expected=structuredClone(expected);portableResultExportRequest(expected.kind,expected.origin);
      const initialSession=await bounded(signal,()=>ports.readSession()),session=initialSession?structuredClone(initialSession):null;
      if(!session||session.expiresAt<=now())throw Error('PORTABLE_EXPORT_AUTHENTICATED_OWNER_REQUIRED');
      let captured:NativePortableCompletion|null=null;
      const current=async()=>{
        if(closed||signal.aborted)throw Error('PORTABLE_EXPORT_CANCELLED');
        const live=await bounded(signal,()=>ports.readSession());if(!live||live.identity!==session.identity||live.expiresAt<=now())throw Error('PORTABLE_EXPORT_OWNER_CHANGED');
        let completion:NativePortableCompletion;
        if(captured&&ports.assertCurrent){await bounded(signal,()=>ports.assertCurrent!(structuredClone(captured!),signal));completion=captured;}
        else completion=await bounded(signal,()=>ports.readCompletion(signal));
        const after=await bounded(signal,()=>ports.readSession());
        if(!after||after.identity!==session.identity||after.expiresAt<=now())throw Error('PORTABLE_EXPORT_OWNER_CHANGED');
        if(completion.data.kind!==expected.kind||await hash(completion.origin)!==await hash(expected.origin))throw Error('PORTABLE_EXPORT_SOURCE_CHANGED');
        captured??=structuredClone(completion);return structuredClone(completion);
      };
      const completion=await current();if(!completion.origin.source)throw Error('PORTABLE_EXPORT_SOURCE_REQUIRED');
      const payloadDigest=await hash({...completion,engineeringUsePermitted:false}),originDigest=await hash(completion.origin);
      const review:PortableExportReview={schema:'tunacad-portable-result-export-consent/1',scope:'sanitized_read_only_result_export',
        reviewId:randomUUID(),studyId:completion.origin.source!.studyId,revision:completion.origin.revision,kind:completion.data.kind,payloadDigest,originDigest,
        bytes:Buffer.byteLength(JSON.stringify(completion)),expiresAt:Math.min(now()+120000,session.expiresAt),
        description:completion.data.kind==='explicit_recorded_face_history'
          ?`${completion.data.frames.length} recorded FACE-node frames; displacement, velocity, acceleration, reaction/impulse and supplied global energy/mass histories. No whole-body contours.`
          :'One dielectric: potential, electric-field and electric-displacement boundary data, capacitance, energy and electrode charge summaries.',engineeringUsePermitted:false};
      if(review.bytes>32*1024*1024)throw Error('PORTABLE_RESULT_SIZE_LIMIT');
      if(!await bounded(signal,()=>ports.approve(structuredClone(review),signal)))throw Error('PORTABLE_EXPORT_CONSENT_DENIED');
      if(now()>=review.expiresAt||await hash(await current())!==await hash(completion))throw Error('PORTABLE_EXPORT_REVIEW_EXPIRED_OR_CHANGED');
      const signingPermit=Object.freeze({}),consentDigest=await hash(review),authorizedAt=new Date(now()).toISOString();
      signingPermits.set(signingPermit,{payloadDigest,originDigest,consentDigest,authorizedAt,issuerFingerprint:ports.authority.issuerFingerprint,expiresAt:review.expiresAt,now,signal});
      let consumed=false;
      const producer=createNewCompletionPortableExporter({issuerFingerprint:ports.authority.issuerFingerprint,verifier:ports.authority.verifier,
        randomReceiptId:randomUUID,issueReceipt:(claims,requestSignal)=>ports.authority.issueReceipt(claims,requestSignal,signingPermit),
        async assertFreshOwnerAndCompletion(value){if(await hash(value)!==await hash(await current()))throw Error('PORTABLE_EXPORT_COMPLETION_CHANGED');},
        async consumeExportConsent(binding){
          if(consumed||now()>=review.expiresAt||binding.payloadDigest!==payloadDigest||binding.originDigest!==originDigest||binding.scope!==review.scope)
            throw Error('PORTABLE_EXPORT_CONSENT_REPLAY_OR_MISMATCH');
          consumed=true;return {consentDigest,authorizedAt};
        }})(completion);
      // A lost response may be retried only by a NEW user-triggered request,
      // with a fresh review and single-use grant. No grant/receipt is replayed.
      const result=await bounded(signal,()=>producer.export(signal));signal.throwIfAborted();return result;
    }finally{pending=false;if(active===controller)active=null;}
  },cancel(){closed=true;active?.abort(Error('PORTABLE_EXPORT_CANCELLED'));}};
}

/** Existing terminal object only, no new terminal/process or auto response. */
export async function approvePortableExportInTerminal(review:PortableExportReview,signal:AbortSignal,
  terminal:{question(prompt:string,options:{signal:AbortSignal}):Promise<string>}){
  if(signal.aborted||Date.now()>=review.expiresAt)return false;
  console.log('Include completed numerical results in this project: '+review.studyId+'.');
  console.log('Original source revision: '+review.revision+'.');
  console.log(review.description+' This permits a portable read-only copy; it is NOT geometry-transfer or solver execution approval.');
  console.log('The saved project contains readable numerical data. Share it only with intended recipients.');
  try{const answer=await terminal.question('Type export to include these exact results, or Enter to keep them protected: ',{signal});
    return !signal.aborted&&Date.now()<review.expiresAt&&answer.trim()==='export';}
  catch{return false;}
}
