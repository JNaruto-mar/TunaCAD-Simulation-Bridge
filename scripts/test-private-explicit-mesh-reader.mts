import assert from 'node:assert/strict';
import { mkdtemp,mkdir,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { ElectrostaticHostStorage,writeElectrostaticHostOnce } from '../simulation-bridge/electrostaticHostStorage.mts';
import { openPrivateExplicitMeshStore } from '../simulation-bridge/privateExplicitMeshStore.mts';
// Real read-only file reader with a CONTROLLED storage/ACL owner adapter.
// No trusted production capture is created; all synthetic pins live in temp.
const originalOpen=ElectrostaticHostStorage.open;
const roots:string[]=[],passed:string[]=[];
const sha=digest({controlled:true});
const source={documentId:'doc',modelId:'model',sessionBinding:sha,revision:'rev1',sourceEpoch:1,
  componentId:'part',bodyId:'body',domainId:'domain',topologyDigest:sha,
  fixedFace:{referenceId:'fixed',bodyId:'body',fingerprint:digest('fixed')},
  loadedFace:{referenceId:'load',bodyId:'body',fingerprint:digest('load')},
  materialId:'material',materialDigest:sha,canonicalSourceDigest:sha,studyParameterDigest:sha,unitSystemDigest:sha};
const geometry={exportId:'export',sourceBindingDigest:digest(source),canonicalSourceDigest:sha,byteDigest:sha,byteLength:256};
const artifact={schema:'tunacad-neutral-fem-mesh/1.0',projectRevision:'rev1',geometryDigest:sha,units:'mm',
  element:{family:'tetrahedral',solutionOrder:1,geometryOrder:1},nodes:Array.from({length:88},(_,i)=>[i,0,0]),
  volumeElements:{connectivity:Array.from({length:208},()=>[0,1,2,3])}};
async function fixture(options:{record?:(r:any)=>void;pin?:(p:any)=>void;artifact?:(a:any)=>void;missing?:boolean;brokenAcl?:boolean}={}) {
  const root=await mkdtemp(join(tmpdir(),'tunacad-private-mesh-reader-'));roots.push(root);
  const paths={studies:join(root,'studies'),results:join(root,'results'),'source-catalog':join(root,'source-catalog')};
  for(const path of Object.values(paths))await mkdir(path);
  const storageIdentity=digest({isolatedRoot:root});let reads=0;
  ElectrostaticHostStorage.open=async()=>({paths,configurationDigest:storageIdentity,
    async assertReady(){reads++;if(options.brokenAcl)throw new Error('controlled invalid ACL');}} as any);
  const r={schema:'tunacad-private-explicit-protected-mesh/0.1',studyId:'study',meshRevision:1,storageIdentity,
    source:structuredClone(source),geometry:structuredClone(geometry),mesh:{meshId:'mesh',meshDigest:digest(artifact),
      exportId:geometry.exportId,exportByteDigest:geometry.byteDigest,sourceBindingDigest:digest(source),geometryDigest:sha,
      faceMappingDigest:sha,validationDigest:sha,meshingRuntime:'Gmsh 4.15.2',nodeCount:88,elementCount:208,elementFormulation:'C3D4'}};
  options.record?.(r);
  const lookupDigest=digest({studyId:'study',geometry,source}),pin={schema:'tunacad-private-explicit-mesh-pin/0.1',
    lookupDigest,recordDigest:digest(r),storageIdentity};options.pin?.(pin);
  if(!options.missing)await writeElectrostaticHostOnce(join(paths['source-catalog'],'explicit-mesh-'+lookupDigest.slice(7)+'.pin.json'),pin);
  await writeElectrostaticHostOnce(join(paths.studies,'explicit-mesh-'+pin.recordDigest.slice(7)+'.json'),r);
  const bytes=structuredClone(artifact);options.artifact?.(bytes);
  await writeElectrostaticHostOnce(join(paths.results,'explicit-mesh-'+r.mesh.meshDigest.slice(7)+'.json'),bytes);
  return {reader:await openPrivateExplicitMeshStore(root),r,reads:()=>reads};
}
async function check(name:string,run:()=>Promise<void>){await run();passed.push(name);}
try {
  await check('authentic controlled pin/record/artifact reload',async()=>{const f=await fixture();
    assert.deepEqual(await f.reader.readExact('study',geometry,source),f.r);assert.equal(f.reads(),2);});
  await check('missing exact pin returns pending, not fuzzy search',async()=>{const f=await fixture({missing:true});
    assert.equal(await f.reader.readExact('study',geometry,source),null);});
  await check('invalid protection fails rather than pending',async()=>{const f=await fixture({brokenAcl:true});
    await assert.rejects(()=>f.reader.readExact('study',geometry,source),/invalid ACL/);});
  for(const [name,change] of [
    ['revision',(r:any)=>{r.source.revision='other';}],['epoch',(r:any)=>{r.source.sourceEpoch++;}],
    ['geometry',(r:any)=>{r.source.canonicalSourceDigest=digest('other');}],['export',(r:any)=>{r.geometry.exportId='other';}],
    ['FACE',(r:any)=>{r.source.fixedFace.fingerprint=digest('other');}],['material',(r:any)=>{r.source.materialDigest=digest('other');}],
    ['mesh',(r:any)=>{r.mesh.exportByteDigest=digest('other');}],['storage',(r:any)=>{r.storageIdentity=digest('other');}],
  ] as const)await check('structurally valid '+name+' substitution rejected',async()=>{const f=await fixture({record:change});
    await assert.rejects(()=>f.reader.readExact('study',geometry,source));});
  await check('independent pin mismatch rejected',async()=>{const f=await fixture({pin:p=>{p.lookupDigest=digest('other');}});
    await assert.rejects(()=>f.reader.readExact('study',geometry,source),/STORAGE_MISMATCH/);});
  await check('altered captured artifact rejected',async()=>{const f=await fixture({artifact:a=>{a.nodes[0][0]=5;}});
    await assert.rejects(()=>f.reader.readExact('study',geometry,source),/ARTIFACT_MISMATCH/);});
  await check('different study/export does not match by dimensions or counts',async()=>{const f=await fixture();
    assert.equal(await f.reader.readExact('another',geometry,source),null);
    assert.equal(await f.reader.readExact('study',{...geometry,exportId:'another'},source),null);});
  console.log(JSON.stringify({pass:true,checks:passed.length,passed,evidence:'controlled protected-storage adapter, actual file reader',realMeshes:0,realSolvers:0}));
}finally {
  ElectrostaticHostStorage.open=originalOpen;
  // Explicitly created test roots only; no production records are touched.
  for(const root of roots)await rm(root,{recursive:true,force:true});
}
