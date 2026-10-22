import {validateAuthorizedPortableResult,type AuthorizedPortableResult,type OwnerExportReceiptVerifier} from './authorizedPortableResults.ts';
import {webCryptoDigest} from '../../simulation-bridge/v2ValidationBrowser.mts';

type Completion={origin:AuthorizedPortableResult['origin'];data:AuthorizedPortableResult['data']};
function abortable<T>(signal:AbortSignal,operation:()=>Promise<T>):Promise<T>{
  signal.throwIfAborted();return new Promise((resolve,reject)=>{
    const stop=()=>reject(signal.reason);signal.addEventListener('abort',stop,{once:true});
    Promise.resolve().then(()=>{signal.throwIfAborted();return operation();}).then(resolve,reject).finally(()=>signal.removeEventListener('abort',stop));
  });
}
/** Owner-side completion-only adapter. No historical reader, storage writer,
 * key provisioning, approval implementation or runtime registration. Ports MUST
 * be wired to the authenticated owner's existing authorization machinery.
 * In particular consumeExportConsent is not geometry/solver approval. It consumes
 * an ALREADY human-confirmed, exact export grant; never opens a human prompt
 * inside this bounded technical operation or auto-confirms a challenge. */
export function createNewCompletionPortableExporter(ports:{
  assertFreshOwnerAndCompletion(completion:Completion,signal:AbortSignal):Promise<void>;
  consumeExportConsent(binding:{payloadDigest:string;originDigest:string;scope:'sanitized_read_only_result_export'},signal:AbortSignal):Promise<{consentDigest:string;authorizedAt:string}>;
  issueReceipt(claims:Omit<AuthorizedPortableResult['exportReceipt'],'signature'>,signal:AbortSignal):Promise<string>;
  issuerFingerprint:string;randomReceiptId():string;verifier:OwnerExportReceiptVerifier;
}){
  // Capability is created by the new completion lifecycle, not a browser ID,
  // imported project or historical inventory. One export per completion handle.
  return (completion:Completion)=>{
    const snapshot=structuredClone(completion),cancelled=new AbortController();let state:'fresh'|'pending'|'closed'='fresh';
    return {async export(requestSignal:AbortSignal):Promise<AuthorizedPortableResult>{
      if(state!=='fresh')throw Error('PORTABLE_COMPLETION_EXPORT_SINGLE_USE');state='pending';
      const signal=AbortSignal.any([requestSignal,cancelled.signal,AbortSignal.timeout(30000)]);
      try{
        await abortable(signal,()=>ports.assertFreshOwnerAndCompletion(snapshot,signal));signal.throwIfAborted();
        if(!snapshot.origin.source)throw Error('PORTABLE_COMPLETION_SOURCE_REQUIRED');
        const originDigest=await webCryptoDigest(snapshot.origin),payloadDigest=await webCryptoDigest({...snapshot,engineeringUsePermitted:false});
        const binding={payloadDigest,originDigest,scope:'sanitized_read_only_result_export' as const};
        const consent=await abortable(signal,()=>ports.consumeExportConsent(binding,signal));signal.throwIfAborted();
        await abortable(signal,()=>ports.assertFreshOwnerAndCompletion(snapshot,signal));signal.throwIfAborted();
        const claims={schema:'tunacad-owner-export-receipt/1' as const,issuerFingerprint:ports.issuerFingerprint,receiptId:ports.randomReceiptId(),...binding,
          consentDigest:consent.consentDigest,authorizedAt:consent.authorizedAt};
        const signature=await abortable(signal,()=>ports.issueReceipt(claims,signal));signal.throwIfAborted();
        const result=await validateAuthorizedPortableResult({schema:'tunacad-authorized-portable-result/2',...snapshot,payloadDigest,
          exportReceipt:{...claims,signature},engineeringUsePermitted:false},ports.verifier);
        await abortable(signal,()=>ports.assertFreshOwnerAndCompletion(snapshot,signal));signal.throwIfAborted();return result;
      }finally{state='closed';}
    },cancel(){state='closed';cancelled.abort(Error('PORTABLE_COMPLETION_EXPORT_CANCELLED'));}};
  };
}
