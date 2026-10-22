import {webCryptoDigest} from '../../simulation-bridge/v2ValidationBrowser.mts';
import type {AuthorizedPortableResult,OwnerExportReceiptVerifier} from './authorizedPortableResults.ts';

/** Public trust anchors are supplied by trusted application configuration, NEVER
 * from the imported project. This module neither creates keys nor signs consent. */
export interface PortableExportTrustAnchor {issuerFingerprint:string;publicKey:JsonWebKey}
export async function portableExportReceiptBytes(receipt:AuthorizedPortableResult['exportReceipt']):Promise<Uint8Array<ArrayBuffer>>{
  const {signature,...claims}=receipt;
  return new TextEncoder().encode('tunacad-portable-export-consent-v2\n'+await webCryptoDigest(claims));
}
export function createPortableExportVerifier(anchors:readonly PortableExportTrustAnchor[]):OwnerExportReceiptVerifier{
  const trusted=structuredClone(anchors);
  return {async verify(receipt,expected){
    if(!receipt.consentDigest||!receipt.authorizedAt||receipt.payloadDigest!==expected.payloadDigest||receipt.originDigest!==expected.originDigest)
      throw Error('PORTABLE_EXPORT_CONSENT_BINDING_INVALID');
    const matches=trusted.filter(a=>a.issuerFingerprint===receipt.issuerFingerprint);
    if(matches.length!==1)throw Error('PORTABLE_EXPORT_ISSUER_NOT_TRUSTED');
    const key=matches[0].publicKey;
    if(Object.keys(key).sort().join(',')!=='crv,kty,x,y'||key.kty!=='EC'||key.crv!=='P-256'||
      typeof key.x!=='string'||typeof key.y!=='string'||await webCryptoDigest(key)!==receipt.issuerFingerprint)
      throw Error('PORTABLE_EXPORT_TRUST_ANCHOR_INVALID');
    if(!/^[A-Za-z0-9+/]{86}==$/.test(receipt.signature))throw Error('PORTABLE_EXPORT_SIGNATURE_INVALID');
    const signature=Uint8Array.from(atob(receipt.signature),c=>c.charCodeAt(0));
    const imported=await crypto.subtle.importKey('jwk',key,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
    if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},imported,signature,await portableExportReceiptBytes(receipt)))
      throw Error('PORTABLE_EXPORT_SIGNATURE_INVALID');
  }};
}
