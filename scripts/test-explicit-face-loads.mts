import assert from 'node:assert/strict';
import {serializeExplicitFaceLoads} from '../providers/openradioss/OpenRadiossFaceLoads.mts';
import {estimateExplicitHistoryBytes,normalizeExplicitHistoryNode,assertExplicitResultByteBudget,EXPLICIT_NORMALIZED_RESULT_MAXIMUM_BYTES} from '../providers/openradioss/OpenRadiossHistoryResource.mts';
const ids=[8,9,20,21,51,88,117,118],weights=[10,10,10,10,60,60,40,40],map=new Map(ids.map((id,i)=>[id,weights[i]]));
const rows=serializeExplicitFaceLoads(ids,map,240,100),sum=rows.reduce((n,r)=>n+BigInt(r.forceText.replace('.','')),0n);
assert.equal(sum,100000000000000n);assert.ok(Math.abs(rows.reduce((n,r)=>n+r.forceN,0)-100)<1e-12);
assert.equal(rows.length,8);assert.ok(rows.every(r=>r.forceText.length<=20&&r.forceN>0));
for(const count of [3,17,128]){const ids=Array.from({length:count},(_,i)=>100+i*13),w=new Map(ids.map(id=>[id,1]));
 for(const f of [100,1e6]){const r=serializeExplicitFaceLoads(ids,w,count,f);assert.equal(r.reduce((n,v)=>n+BigInt(v.forceText.replace('.','')),0n),BigInt(f)*1000000000000n);}}
for(const w of [new Map([[1,0]]),new Map([[1,NaN]])])assert.throws(()=>serializeExplicitFaceLoads([1],w,1,100));
assert.throws(()=>serializeExplicitFaceLoads([1,1],new Map([[1,1]]),2,100));
assert.throws(()=>serializeExplicitFaceLoads([1,2],new Map([[1,1e-20],[2,1]]),1,100));
const historyIds=Array.from({length:97},(_,i)=>i+1),estimate=estimateExplicitHistoryBytes(51,historyIds);
assert.ok(estimate<EXPLICIT_NORMALIZED_RESULT_MAXIMUM_BYTES);assert.ok(51*historyIds.length*512+128*1024>EXPLICIT_NORMALIZED_RESULT_MAXIMUM_BYTES);
for(const v of [-Number.MAX_VALUE,Number.MAX_VALUE,-Number.MIN_VALUE,Number.MIN_VALUE,-1.0000000000000002e-6]){
 const row=normalizeExplicitHistoryNode(999999999,'loaded',{dxMm:v,vxMmPerS:v,axMmPerS2:v,reactionImpulseNs:v,reactionForceN:v});
 assert.ok(estimateExplicitHistoryBytes(1,[999999999])-128*1024>=Buffer.byteLength(JSON.stringify([row])));
}
assert.throws(()=>estimateExplicitHistoryBytes(65,historyIds));assert.throws(()=>estimateExplicitHistoryBytes(51,Array(129).fill(1)));
assertExplicitResultByteBudget({frames:[]});assert.throws(()=>assertExplicitResultByteBudget({data:'x'.repeat(EXPLICIT_NORMALIZED_RESULT_MAXIMUM_BYTES)}),/resource bound/);
console.log('PASS fixed-column FACE load conservation, retained eight-node rounding regression, bounded counts/forces and malformed rejection. Solver executions=0.');
