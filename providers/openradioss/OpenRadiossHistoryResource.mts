import {EXPLICIT_NORMALIZED_RESULT_MAXIMUM_BYTES} from '../../simulation-bridge/explicitHistoryResources.mts';
export {EXPLICIT_NORMALIZED_RESULT_MAXIMUM_BYTES,normalizeExplicitHistoryNode,estimateExplicitHistoryBytes,admitExplicitHistoryResources}
  from '../../simulation-bridge/explicitHistoryResources.mts';
export function assertExplicitResultByteBudget(result:unknown){
 if(Buffer.byteLength(JSON.stringify(result))>EXPLICIT_NORMALIZED_RESULT_MAXIMUM_BYTES)throw Error('OpenRadioss result: normalized result resource bound');
}
