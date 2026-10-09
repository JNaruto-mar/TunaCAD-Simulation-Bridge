export const EXPLICIT_NORMALIZED_RESULT_MAXIMUM_BYTES=2*1024*1024;
export function normalizeExplicitHistoryNode(nodeId:number,face:'fixed'|'loaded'|'monitor',n:{dxMm:number;vxMmPerS:number;axMmPerS2:number;reactionImpulseNs:number;reactionForceN:number}){
 return {nodeId,face,displacementMm:n.dxMm,velocityMmPerS:n.vxMmPerS,accelerationMmPerS2:n.axMmPerS2,reactionImpulseNs:n.reactionImpulseNs,reactionForceN:n.reactionForceN};
}
/** ECMAScript finite Number JSON strings need at most 25 ASCII characters.
 * Size the SAME serialized node schema as recovery, not a shape-specific
 * count or guessed bytes/node. Existing 128 KiB metadata reserve unchanged. */
export function estimateExplicitHistoryBytes(frames:number,ids:readonly number[],hasMonitors=false){
 if(!Number.isSafeInteger(frames)||frames<1||frames>64||!ids.length||ids.length>128||ids.some(id=>!Number.isSafeInteger(id)||id<=0||id>999999999))throw Error('Invalid explicit history resource inputs');
 const n=-1.0000000000000002e-6;
 const rowBytes=ids.reduce((total,id)=>total+Buffer.byteLength(JSON.stringify(normalizeExplicitHistoryNode(id,hasMonitors?'monitor':'loaded',
  {dxMm:n,vxMmPerS:n,axMmPerS2:n,reactionImpulseNs:n,reactionForceN:n})))+5*(25-String(n).length)+1,0);
 return frames*(rowBytes+2)+128*1024;
}
export function assertExplicitResultByteBudget(result:unknown){
 if(Buffer.byteLength(JSON.stringify(result))>EXPLICIT_NORMALIZED_RESULT_MAXIMUM_BYTES)throw Error('OpenRadioss result: normalized result resource bound');
}
/** Admission, not decimation: retain every fixed/load/monitor node or reject. */
export function admitExplicitHistoryResources(frames:number,ids:readonly number[],hasMonitors=false){
 if(ids.length>128||estimateExplicitHistoryBytes(frames,ids,hasMonitors)>EXPLICIT_NORMALIZED_RESULT_MAXIMUM_BYTES)
   throw Error('OpenRadioss admission: complete FACE histories exceed normalized result resource bound (maximum 128 nodes)');
}
