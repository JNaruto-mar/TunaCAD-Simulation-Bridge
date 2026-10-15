// Source-derived CalculiX 2.16 ASCII records, not new native acceptance evidence.
import assert from 'node:assert/strict';
import {parseCalculiXBucklingDatV2,parseCalculiXBucklingFrdV2,normalizeCalculiXBucklingModesV2} from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
const heading='    B U C K L I N G   F A C T O R   O U T P U T\n\nMODE NO       BUCKLING\n               FACTOR\n';
const dat=heading+'      1   0.10813147E+02\n      2   0.10813147E+02\n      3   0.97300000E+02\n';
const modes=parseCalculiXBucklingDatV2(dat).modes;
function record(increment:number,value:string,nodes=3,type=4) {
  const chars=Array(75).fill(' '); const put=(at:number,text:string)=>[...text].forEach((c,i)=>chars[at+i]=c);
  put(0,'  100CL'); put(7,String(100+increment).padStart(5)); put(12,value.padStart(12)); put(24,String(nodes).padStart(12));
  put(48,String(type).padStart(10)); put(58,String(increment).padStart(5)); put(74,'1'); return chars.join('');
}
const row=(node:number,vector:string[])=>' -1'+String(node).padStart(10)+vector.map(x=>x.padStart(12)).join('');
const rows=(axis:number,sign=1)=>[row(1,['0','0','0']),row(2,[0,1,2].map(i=>i===axis?String(sign):'0')),row(3,[0,1,2].map(i=>i===axis?String(sign*2):'0'))].join('\n');
const field=(increment:number,value:string,body=rows(1))=>'    1PSTEP'+String(increment).padStart(26)+'           1           1\n'+record(increment,value)+'\n -4  DISP        4    1\n -5  D1          1    2    1    0\n -5  D2          1    2    2    0\n -5  D3          1    2    3    0\n -5  ALL         1    2    0    0    1ALL\n'+body+'\n -3\n';
const reference=field(1,'0.00000E+00',rows(0));
const first=field(2,'10.81314700',rows(1,-1));
const second=field(3,'10.81314700',rows(2)); // Degenerate factors must not merge or reorder modes.
const third=field(4,'97.30000000',rows(0));
const valid=reference+first+second+third+' 9999\n';
let checks=0;
function reject(label:string,body:()=>unknown){assert.throws(body,undefined,label);checks++;}
const parsed=parseCalculiXBucklingFrdV2(valid,modes);
assert.deepEqual([...parsed.shapes.keys()],[1,2,3]);
assert.deepEqual(parsed.shapes.get(1)?.get(2),[0,-2,0]);
assert.deepEqual(parsed.shapes.get(2)?.get(2),[0,0,2]);
assert.deepEqual(parsed.shapes.get(3)?.get(2),[2,0,0]);
const normalized=normalizeCalculiXBucklingModesV2(modes,parsed,3,3);
for(const shape of normalized.values()) {
  assert.equal(Math.max(...[...shape.values()].map(v=>Math.hypot(...v))),1);
  assert.equal(Math.hypot(...shape.get(0)!),0);
}
assert.deepEqual(normalized.get(1)?.get(2)?.map(x=>x===0?0:x),[0,1,0]);checks++;
// Header time never supplies a factor to the result. DAT is required and remains positive/ordered.
for(const value of ['-1','0','NaN','Infinity','1E999','****']) reject('bad DAT '+value,()=>parseCalculiXBucklingDatV2(heading+'1 '+value));
reject('missing DAT',()=>parseCalculiXBucklingDatV2(''));
reject('missing DAT mode',()=>parseCalculiXBucklingDatV2(heading+'1 2\n3 4'));
reject('out of order DAT',()=>parseCalculiXBucklingFrdV2(valid,[modes[1],modes[0],modes[2]]));
reject('incomplete DAT',()=>parseCalculiXBucklingFrdV2(valid,modes.slice(0,2)));
reject('missing reference',()=>parseCalculiXBucklingFrdV2(first+second+third,modes));
reject('zero eigenmode must not be skipped',()=>parseCalculiXBucklingFrdV2(reference+field(2,'0')+second+third,modes));
for(const value of ['-1','NaN','1E999','****','9.81314700']) reject('invalid/mismatched FRD '+value,()=>parseCalculiXBucklingFrdV2(reference+field(2,value)+second+third,modes));
reject('negative reference',()=>parseCalculiXBucklingFrdV2(field(1,'-1')+first+second+third,modes));
reject('duplicate reference',()=>parseCalculiXBucklingFrdV2(reference+reference+first+second+third,modes));
reject('missing class header',()=>parseCalculiXBucklingFrdV2(valid.replace(record(2,'10.81314700'),' '),modes));
reject('missing step header',()=>parseCalculiXBucklingFrdV2(valid.replace(/^.*1PSTEP[^\n]*\n/m,''),modes));
reject('modal instead of buckling',()=>parseCalculiXBucklingFrdV2(valid.replace(record(2,'10.81314700'),record(2,'10.81314700',3,2)),modes));
reject('foreign mode marker',()=>parseCalculiXBucklingFrdV2(reference+'    1PMODE 1\n'+first+second+third,modes));
reject('duplicate mode',()=>parseCalculiXBucklingFrdV2(reference+first+first+third,modes));
reject('reordered modes',()=>parseCalculiXBucklingFrdV2(reference+second+first+third,modes));
reject('missing mode',()=>parseCalculiXBucklingFrdV2(reference+first+third,modes));
reject('truncated mode',()=>parseCalculiXBucklingFrdV2(reference+first+second+third.replace(/ -3\n$/,''),modes));
reject('interrupted mode',()=>parseCalculiXBucklingFrdV2(reference+first.replace(/ -3\n$/,'')+second+third,modes));
reject('empty mode',()=>parseCalculiXBucklingFrdV2(reference+field(2,'10.81314700','')+second+third,modes));
reject('short mode',()=>parseCalculiXBucklingFrdV2(reference+field(2,'10.81314700',rows(1).split('\n').slice(0,2).join('\n'))+second+third,modes));
reject('duplicate node',()=>parseCalculiXBucklingFrdV2(valid.replace(row(3,['0','-2','0']),row(2,['0','-2','0'])),modes));
for(const value of ['NaN','1E999','garbage','']) reject('nonfinite/malformed vector '+value,()=>parseCalculiXBucklingFrdV2(valid.replace(row(3,['0','-2','0']),row(3,['0',value,'0'])),modes));
reject('malformed trailing vector',()=>parseCalculiXBucklingFrdV2(valid.replace(row(3,['0','-2','0']),row(3,['0','-2','0'])+'JUNK'),modes));
reject('extra mode',()=>parseCalculiXBucklingFrdV2(reference+first+second+third+field(5,'100'),modes));
reject('wrong model node count',()=>normalizeCalculiXBucklingModesV2(modes,parsed,3,4));
reject('incomplete requested count',()=>normalizeCalculiXBucklingModesV2(modes,parsed,4,3));
const wrongNode=structuredClone(parsed); wrongNode.shapes.get(1)!.set(10,wrongNode.shapes.get(1)!.get(2)!);wrongNode.shapes.get(1)!.delete(2);
reject('foreign model node',()=>normalizeCalculiXBucklingModesV2(modes,wrongNode,3,3));
const zero=structuredClone(parsed);zero.shapes.get(1)!.forEach((_,node,shape)=>shape.set(node,[0,0,0]));
reject('zero eigenvector',()=>normalizeCalculiXBucklingModesV2(modes,zero,3,3));
const infinite=structuredClone(parsed);infinite.shapes.get(1)!.set(2,[Number.MAX_VALUE,Number.MAX_VALUE,Number.MAX_VALUE]);
reject('overflowing vector norm',()=>normalizeCalculiXBucklingModesV2(modes,infinite,3,3));
// Fixed-width adjacent signs and Fortran D exponent, as in retained Modal 2.16 records.
const adjacent=valid.replace(row(3,['0','-2','0']),row(3,['-1.00000D+00','-2.00000D+00','-3.00000D+00']));
assert.deepEqual(parseCalculiXBucklingFrdV2(adjacent,modes).shapes.get(1)?.get(2),[-1,-2,-3]);checks++;
for (const count of [1,6,12]) {
  const table=parseCalculiXBucklingDatV2(heading+Array.from({length:count},(_,i)=>(i+1)+' '+(10+i)).join('\n')).modes;
  const fields=reference+table.map(m=>field(m.modeNumber+1,String(m.eigenvalueLoadFactor),rows(m.modeNumber%3))).join('');
  assert.equal(normalizeCalculiXBucklingModesV2(table,parseCalculiXBucklingFrdV2(fields,table),count,3).size,count);checks++;
}
console.log('PASS '+checks+' focused buckling DAT/FRD/normalization cases; 2.16 reference field, indexed degenerate modes, strict complete fields. No native processes.');
