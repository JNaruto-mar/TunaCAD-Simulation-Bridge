// Browser-safe integrity entry points. No Node crypto, storage, approval or
// provider access; real Web Crypto SHA-256 only, no fallbacks or injectable hash.
import {stableSerialize} from './stableSerialize.mts';
import {validateNeutralSimulationRequestStructureV2,validateNeutralSimulationFieldPageStructureV2} from './v2ValidationCore.mts';
import type {NeutralSimulationRequestV2,NeutralSimulationFieldPageV2} from '../src/simulation/externalSimulationContracts.ts';
export {validateNeutralSimulationResultV2} from './v2ValidationCore.mts';

export async function webCryptoDigest(value: unknown): Promise<string> {
  const hash=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(stableSerialize(value)));
  return 'sha256:'+Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function validateNeutralSimulationRequestV2(value: unknown, now=Date.now()): Promise<NeutralSimulationRequestV2> {
  const request=validateNeutralSimulationRequestStructureV2(value,now);
  for(const domain of request.model.domains){const {domainDigest,...unsigned}=domain;
    if(await webCryptoDigest(unsigned)!==domainDigest)throw Error('BRIDGE_V2_DOMAIN_DIGEST_INVALID');}
  const {modelDigest,...model}=request.model;
  if(await webCryptoDigest(model)!==modelDigest)throw Error('BRIDGE_V2_MODEL_DIGEST_INVALID');
  const {requestDigest,...unsigned}=request;
  if(await webCryptoDigest(unsigned)!==requestDigest)throw Error('BRIDGE_V2_REQUEST_DIGEST_INVALID');
  return request;
}
export async function validateNeutralSimulationFieldPageV2(value: unknown): Promise<NeutralSimulationFieldPageV2> {
  const page=validateNeutralSimulationFieldPageStructureV2(value);
  if(await webCryptoDigest(page.triangles)!==page.chunkDigest)throw Error('BRIDGE_V2_FIELD_PAGE_INVALID');
  return page;
}
