// Pure focused admission/deck regression. No provider/process/executable ports.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { prepareOpenRadiossDeck } from '../providers/openradioss/OpenRadiossDeck.mts';
import { sealExplicitDynamics,validateExplicitDynamics } from '../simulation-bridge/explicitDynamicsFoundation.mts';
import type { ExplicitC3D4Mesh } from '../providers/calculix/ExplicitDynamicsMeshAdmission.mts';
const hash=(s:string)=>'sha256:'+createHash('sha256').update(s).digest('hex');
export function checkOpenRadiossMeshLayouts(requestValue:unknown,mesh:ExplicitC3D4Mesh,historical:ExplicitC3D4Mesh) {
  const request=validateExplicitDynamics(requestValue);let checks=0;
  const check=(fn:()=>void)=>{fn();checks++;};
  const boundary=(m:ExplicitC3D4Mesh)=>{
    const facets=new Map<string,{nodes:[number,number,number];uses:number}>();
    for(const e of m.elements)for(let k=0;k<4;k++){
      const ids=e.nodes.filter((_,i)=>i!==k) as [number,number,number],key=[...ids].sort((a,b)=>a-b).join(',');
      facets.set(key,{nodes:ids,uses:(facets.get(key)?.uses??0)+1});}
    m.surfaceTriangles=[...facets.values()].filter(f=>f.uses===1).map((f,i)=>({id:i+1,nodes:f.nodes}));
  };
  const prepared=prepareOpenRadiossDeck(request,mesh),old=prepareOpenRadiossDeck(request,historical);
  check(()=>assert.equal(mesh.elements.length,209));check(()=>assert.equal(historical.elements.length,208));
  function deck(p:ReturnType<typeof prepareOpenRadiossDeck>,m:ExplicitC3D4Mesh){
    const lines=p.starter.split('\n'),start=lines.indexOf('/TETRA4/1'),end=lines.indexOf('/MAT/LAW1/1');
    const rows=lines.slice(start+1,end).map(l=>Array.from({length:5},(_,i)=>Number(l.slice(i*10,(i+1)*10))));
    const expected=[...m.elements].sort((a,b)=>a.id-b.id).map(e=>[e.id,...e.nodes]);
    check(()=>assert.deepEqual(rows,expected));check(()=>assert.equal(new Set(rows.map(r=>r[0])).size,m.elements.length));
    const nodeIds=new Set(m.nodes.map(n=>n.id));check(()=>assert.ok(rows.every(r=>r.slice(1).every(id=>nodeIds.has(id)))));
    check(()=>assert.equal(lines.filter(l=>l.startsWith('/PART/')).length,1));
    check(()=>assert.equal(lines[lines.indexOf('/PART/1')+2],'         1         1'));
    check(()=>assert.equal(lines.filter(l=>l.startsWith('/MAT/LAW1/')).length,1));
    check(()=>assert.equal(lines.filter(l=>l.startsWith('/PROP/SOLID/')).length,1));
    check(()=>assert.deepEqual(p.expected.fixedNodeIds,[1,2,3,4,45]));
    check(()=>assert.deepEqual(p.expected.loadedNodeIds,[5,6,7,8,46]));
    check(()=>assert.equal(p.expected.loads.reduce((s,l)=>s+l.forceN,0),100));
    const cloads=lines.flatMap((l,i)=>l.startsWith('/CLOAD/')?[lines[i+2]]:[]);
    check(()=>assert.equal(cloads.reduce((s,l)=>s+Number(l.slice(80,100)),0),100));
    check(()=>assert.ok(cloads.every(l=>l.slice(10,20).trim()==='X')));
    check(()=>assert.ok(Math.abs(p.expected.massMg*1000-.078)<.078*1e-5));
    check(()=>assert.equal(prepareOpenRadiossDeck(request,structuredClone(m)).starter,p.starter));
    check(()=>assert.equal(prepareOpenRadiossDeck(request,{...m,nodes:[...m.nodes].reverse(),elements:[...m.elements].reverse()}).starter,p.starter));
    check(()=>assert.doesNotMatch(p.engine,/CST|AMS|\/TFILE\/3/));
  }
  deck(prepared,mesh);deck(old,historical);
  const reject=(change:(m:ExplicitC3D4Mesh)=>void,expected?:RegExp)=>{const m=structuredClone(mesh);change(m);
    check(()=>expected?assert.throws(()=>prepareOpenRadiossDeck(request,m),expected):assert.throws(()=>prepareOpenRadiossDeck(request,m)));};
  reject(m=>{m.elements[0].nodes[3]=m.elements[0].nodes[0];},/degenerate|malformed/);
  reject(m=>{m.elements[0].type='C3D10' as 'C3D4';},/unsupported/);
  reject(m=>{m.elements[0].nodes[0]=999999;},/malformed/);
  reject(m=>{m.elements[0]={...m.elements[1],id:m.elements[0].id};},/duplicate/);
  reject(m=>{m.elements[0].id=m.elements[1].id;},/duplicate/);
  reject(m=>{const n=m.elements[0].nodes;[n[0],n[1]]=[n[1],n[0]];},/Jacobian/);
  reject(m=>{m.nodes[0].xyzMm[0]=NaN;},/malformed/);
  reject(m=>{m.nodes[1].id=m.nodes[0].id;},/duplicate/);
  reject(m=>{m.surfaceTriangles.pop();},/boundary|FACE/);
  reject(m=>{m.inputGeometryDigest='sha256:'+'f'.repeat(64);},/source/);
  // Disconnect one existing positive tetra without changing total volume or
  // element count. Duplicate coordinates get new IDs, full boundaries rebuilt.
  // Existing nodes remain used by other elements; rejection is connectivity.
  reject(m=>{
    const uses=new Map<number,number>();m.elements.forEach(e=>e.nodes.forEach(id=>uses.set(id,(uses.get(id)??0)+1)));
    const e=m.elements.find(e=>e.nodes.every(id=>uses.get(id)!>1))!,ids=e.nodes.map(id=>{
      const xyzMm=[...m.nodes.find(n=>n.id===id)!.xyzMm] as [number,number,number];
      const next=Math.max(...m.nodes.map(n=>n.id))+1;m.nodes.push({id:next,xyzMm});return next;});
    e.nodes=ids as [number,number,number,number];boundary(m);
  },/disconnected/);
  const draft=structuredClone(request);const {requestDigest,...unsigned}=draft;
  check(()=>assert.throws(()=>prepareOpenRadiossDeck(sealExplicitDynamics({...unsigned,mesh:{...unsigned.mesh,maximumElements:208}}),mesh),/resource/));
  check(()=>assert.throws(()=>prepareOpenRadiossDeck(sealExplicitDynamics({...unsigned,mesh:{...unsigned.mesh,maximumNodes:87}}),mesh),/resource/));
  check(()=>assert.throws(()=>prepareOpenRadiossDeck({...request,contact:true},mesh)));
  check(()=>assert.throws(()=>sealExplicitDynamics({...unsigned,material:{...unsigned.material,domainId:'other'}})));
  check(()=>assert.throws(()=>sealExplicitDynamics({...unsigned,material:{...unsigned.material,densityKgM3:0}})));
  check(()=>assert.throws(()=>prepareOpenRadiossDeck({...request,load:{...request.load,forceN:[100,1,0]}},mesh)));
  check(()=>assert.throws(()=>sealExplicitDynamics({...unsigned,restraint:{...unsigned.restraint,faceId:'other'}})));
  // Preserve numeric FACE-ID schema, even when all other topology is valid.
  reject(m=>{for(const n of m.nodes)if(n.id===45)n.id=145;
    for(const e of m.elements)e.nodes=e.nodes.map(id=>id===45?145:id) as typeof e.nodes;
    for(const f of m.surfaceTriangles)f.nodes=f.nodes.map(id=>id===45?145:id) as typeof f.nodes;},/FACE/);
  return {checks,prepared,historicalPrepared:old,starterDigest:hash(prepared.starter),engineDigest:hash(prepared.engine),
    deckDigest:hash(prepared.starter+prepared.engine),executionCounts:{gmsh:0,starter:0,engine:0,providerSubmit:0}};
}
