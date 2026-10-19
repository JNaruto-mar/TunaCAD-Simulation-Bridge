// Node admission entry points. Preserve synchronous SHA-256 and public API.
import {digest} from './stableDigest.mts';
import {validateNeutralSimulationRequestStructureV2,validateNeutralSimulationFieldPageStructureV2,
  type UnsealedNeutralSimulationRequestV2} from './v2ValidationCore.mts';
import type {NeutralSimulationRequestV2,NeutralSimulationFieldPageV2} from '../src/simulation/externalSimulationContracts.ts';
export {admitV2SimulationRequest,admitV2MeshRequest,validateNeutralFemModelV2,validateNeutralSimulationResultV2} from './v2ValidationCore.mts';
export type {UnsealedNeutralSimulationRequestV2,V2Admission} from './v2ValidationCore.mts';

export function sealNeutralSimulationRequestV2(unsigned: UnsealedNeutralSimulationRequestV2): NeutralSimulationRequestV2 {
  const modelDomains = unsigned.model.domains.map(domain => {
    const { domainDigest: _ignored, ...domainUnsigned } = domain;
    return { ...domainUnsigned, domainDigest: digest(domainUnsigned) };
  });
  const modelWithoutDigest = { ...unsigned.model, domains: modelDomains };
  delete modelWithoutDigest.modelDigest;
  const model = { ...modelWithoutDigest, modelDigest: digest(modelWithoutDigest) };
  const requestWithoutDigest = { ...unsigned, model };
  delete requestWithoutDigest.requestDigest;
  return { ...requestWithoutDigest, requestDigest: digest(requestWithoutDigest) } as NeutralSimulationRequestV2;
}
export function validateNeutralSimulationRequestV2(value: unknown, now = Date.now()): NeutralSimulationRequestV2 {
  const request=validateNeutralSimulationRequestStructureV2(value,now);
  for(const domain of request.model.domains){const {domainDigest,...unsigned}=domain;
    if(digest(unsigned)!==domainDigest)throw Error('BRIDGE_V2_DOMAIN_DIGEST_INVALID');}
  const {modelDigest,...model}=request.model;
  if(digest(model)!==modelDigest)throw Error('BRIDGE_V2_MODEL_DIGEST_INVALID');
  const {requestDigest,...unsigned}=request;
  if(digest(unsigned)!==requestDigest)throw Error('BRIDGE_V2_REQUEST_DIGEST_INVALID');
  return request;
}
export function validateNeutralSimulationFieldPageV2(value: unknown): NeutralSimulationFieldPageV2 {
  const page=validateNeutralSimulationFieldPageStructureV2(value);
  if(digest(page.triangles)!==page.chunkDigest)throw Error('BRIDGE_V2_FIELD_PAGE_INVALID');
  return page;
}
