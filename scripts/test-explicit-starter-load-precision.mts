import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readBoundedStarterConcentratedLoads} from '../simulation-bridge/openRadiossStarterLoads.mts';
import {serializeExplicitFaceLoads} from '../providers/openradioss/OpenRadiossFaceLoads.mts';
import {exactRadiossDecimalSum,exactRadiossDecimalSumWithin} from '../simulation-bridge/openRadiossDecimal.mts';
const ids=[8,9,20,21,51,88,117,118],weights=[10,10,10,10,60,60,40,40];
const expected=serializeExplicitFaceLoads(ids,new Map(ids.map((id,i)=>[id,weights[i]])),240,100);
const tokens=['4.166666666667','4.166666666667','4.166666666667','4.166666666667',
 '25.00000000000','25.00000000000','16.66666666667','16.66666666667'];
const rows=ids.map((id,i)=>`${id} 0 X 1 0 1.000000000000 ${tokens[i]}`);
const listing=(r=rows)=>['NCONLD: NUMBER OF CONCENTRATED LOADS 8','CONCENTRATED LOADS',
 '------------------','NODE SKEW DIR LOAD_CURVE SENSOR SCALE_X SCALE_Y',...r,
 'SPMD IS CHECKING FOR ELEMENT DELETION IN :'].join('\n');
assert.notEqual(Number(tokens[7]),expected[7].forceN); // Exact former failure.
const valid=readBoundedStarterConcentratedLoads(listing(),expected);
assert.equal(valid.loads.length,8);assert.equal(valid.listingPrecision?.trustedResultantN,100);
assert.equal(valid.listingPrecision?.printedResultantN,valid.resultantN);
assert.ok(valid.resultantN>100);assert.ok(valid.listingPrecision!.listingRoundingBoundN<=1e-11);
assert.deepEqual(readBoundedStarterConcentratedLoads(listing([...rows].reverse()),expected),valid);
for(const replacement of ['118 0 X 1 0 1.000000000000 16.66666666668',
 '118 0 X 1 0 1.000000000000 16.6667','119 0 X 1 0 1.000000000000 16.66666666667',
 '118 0 Y 1 0 1.000000000000 16.66666666667','118 0 X 1 0 1.000000000000 Infinity'])
 assert.throws(()=>readBoundedStarterConcentratedLoads(listing([...rows.slice(0,-1),replacement]),expected));
assert.throws(()=>readBoundedStarterConcentratedLoads(listing(rows.slice(1)),expected));
assert.throws(()=>readBoundedStarterConcentratedLoads(listing([...rows,rows[0]]),expected));
assert.throws(()=>readBoundedStarterConcentratedLoads(listing(),expected,101));
assert.throws(()=>readBoundedStarterConcentratedLoads(listing(),expected.map((r,i)=>({...r,forceN:r.forceN+(i===0?1e-10:0)}))));
// Exact reference/integer histories retain their previous report schema.
const integer=readBoundedStarterConcentratedLoads(listing([1,2,3,4].map(id=>`${id} 0 X 1 0 1.000000000000 25.00000000000`)),
 [1,2,3,4].map(id=>({id,forceN:25})));
assert.equal(integer.resultantN,100);assert.equal(integer.listingPrecision,undefined);
// Supported force/node-count progression. The former JS reduce incorrectly
// rejected the 97-node 1e6 N case by 2.561137080192566e-9 N; no solver needed.
for(const count of [3,17,97,128])for(const force of [100,12345.67,1e6]){
 const ids=Array.from({length:count},(_,i)=>10001+13*i),loads=serializeExplicitFaceLoads(ids,new Map(ids.map(id=>[id,1])),count,force);
 const report=listing(loads.map(r=>`${r.id} 0 X 1 0 1.000000000000 ${r.forceN.toPrecision(13)}`));
 const admitted=readBoundedStarterConcentratedLoads(report,loads,force);
 assert.ok(exactRadiossDecimalSumWithin(loads.map(r=>r.forceText),String(force),0,true));
 assert.equal(Number(admitted.serializedLoadConservation?.trustedResultantDecimalN),force);
 if(count===97&&force===1e6)assert.ok(Math.abs(loads.reduce((s,r)=>s+r.forceN,0)-force)>1e-12);
 assert.throws(()=>readBoundedStarterConcentratedLoads(report,loads.map((r,i)=>i===0?{...r,forceText:'0.000000000001'}:r),force));
 assert.throws(()=>readBoundedStarterConcentratedLoads(report,loads.map((r,i)=>i===0?{id:r.id,forceN:r.forceN}:r),force));
}
assert.equal(exactRadiossDecimalSum(['0.5','5e-1']), '1.0');
assert.ok(!exactRadiossDecimalSumWithin(['1.000000000001'],'1',1e-12));
assert.ok(exactRadiossDecimalSumWithin(['1.000000000001'],'1',1e-12,true));
assert.throws(()=>exactRadiossDecimalSumWithin(['NaN'],'1',1e-12));
assert.throws(()=>exactRadiossDecimalSumWithin(['1e999999'],'1',1e-12));
assert.throws(()=>exactRadiossDecimalSum(Array(129).fill('1')));
const retained=process.argv[2];
if(retained){const before=readFileSync(retained),digest=createHash('sha256').update(Uint8Array.from(before)).digest('hex');
 const recovered=readBoundedStarterConcentratedLoads(before.toString(),expected);
 assert.deepEqual(recovered.loads,valid.loads);assert.equal(recovered.listingPrecision?.trustedResultantN,100);
 assert.equal(createHash('sha256').update(Uint8Array.from(readFileSync(retained))).digest('hex'),digest);
 console.log(JSON.stringify({retainedListingSHA256:digest,printedResultantN:recovered.resultantN,
  trustedResultantN:recovered.listingPrecision?.trustedResultantN,mutation:false}));}
console.log('PASS source-backed Starter 1PG20.13 precision, exact decimal tie, wrong-value/identity/component/total/malformed rejection; solver executions=0.');
