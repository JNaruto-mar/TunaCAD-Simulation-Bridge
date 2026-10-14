import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,writeFile,readFile,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TwoLayerReadOnlyRecoverySession} from '../simulation-bridge/electrostaticTwoLayerRecovery.mts';
import {TwoLayerElectrostaticLifecycle} from '../simulation-bridge/electrostaticTwoLayerAdmission.mts';
import {twoLayerWorkflowRequestSchema,TWO_LAYER_PUBLIC_EXECUTION_ENABLED} from '../simulation-bridge/electrostaticTwoLayerWorkflow.mts';
import {digest} from '../simulation-bridge/stableDigest.mts';

const hash=(character:string)=>'sha256:'+character.repeat(64);
const studyId='two-layer-00000000-0000-4000-8000-000000000000';
const jobId='electrical_00000000-0000-4000-8000-000000000000';
const claim:any={schema:'tunacad-two-layer-read-only-recovery/0.1',studyId,jobId,
  projectRevision:'synthetic-revision',sourceDigest:hash('a'),requestDigest:hash('b'),
  sessionBinding:hash('c'),sourceEpoch:1,resultDigest:hash('d'),meshDigest:hash('e'),
  domains:[0,1].map(i=>({domainId:'domain-'+i,materialId:'material-'+i,absolutePermittivityFPerM:(i+1)*1e-11})),
  electrodeFaceIds:['left','right'],expiresAt:1000,readOnly:true,
  engineeringUsePermitted:false,publicAdmission:'closed'};

test('reopen is a strict read-only request and the public execution fuse remains closed',()=>{
  assert.equal(TWO_LAYER_PUBLIC_EXECUTION_ENABLED,false);
  const bridgeSessionToken='a'.repeat(64);
  assert.deepEqual(twoLayerWorkflowRequestSchema.parse({operation:'reopen',studyId,jobId,bridgeSessionToken}),{operation:'reopen',studyId,jobId,bridgeSessionToken});
  assert.throws(()=>twoLayerWorkflowRequestSchema.parse({operation:'reopen',studyId,jobId}));
  assert.throws(()=>twoLayerWorkflowRequestSchema.parse({operation:'reopen',studyId,jobId,grant:{},deck:'injected'}));
});

test('recovery lease rejects foreign job, stale source, expiry and revoked session before any provider read',async()=>{
  let reads=0,fresh=true,current=true,clock=1;
  const provider:any={getResultReadOnly:async()=>{reads++;return null;},
    getElectricalPresentationReadOnly:async()=>{throw Error('unexpected');},
    getElectricalFieldPageReadOnly:async()=>{throw Error('unexpected');}};
  const owner=new TwoLayerReadOnlyRecoverySession(claim,provider,{
    now:()=>clock,assertSession(){if(!current)throw Error('session changed');},
    async verifySource(){if(!fresh)throw Error('source changed');}});
  await assert.rejects(owner.result('electrical_00000000-0000-4000-8000-000000000001'),/ownership/);
  fresh=false;await assert.rejects(owner.result(jobId),/source changed/);
  fresh=true;clock=1000;await assert.rejects(owner.result(jobId),/expired/);
  clock=1;current=false;await assert.rejects(owner.result(jobId),/session changed/);
  current=true;owner.revoke();await assert.rejects(owner.result(jobId),/expired or session changed/);
  assert.equal(reads,0);
});

test('stale protected-source recovery does not quarantine or overwrite an intact completion pin',async()=>{
  const root=await mkdtemp(join(tmpdir(),'tunacad-two-layer-readonly-'));
  try{
    const results=join(root,'results'),catalog=join(root,'completion-catalog');
    await mkdir(results);await mkdir(catalog);
    const record={schema:'tunacad-electrostatic-two-layer-ledger/0.1',jobId,studyId};
    const pin={schema:'tunacad-electrostatic-two-layer-completion-pin/0.1',jobId,
      configurationDigest:hash('f'),recordDigest:digest(record)};
    await writeFile(join(results,jobId+'.json'),JSON.stringify(record));
    await writeFile(join(catalog,jobId+'.pin.json'),JSON.stringify(pin));
    const storage:any={paths:{results,'completion-catalog':catalog},
      configurationDigest:hash('f'),assertReady:async()=>{}};
    const reader:any={readSealedRequest:async()=>{throw Error('live CAD source changed');}};
    const driver:any={execute:()=>{throw Error('solver must not run');}};
    const lifecycle=new TwoLayerElectrostaticLifecycle(reader,driver,storage);
    await assert.rejects(lifecycle.getResultReadOnly(jobId),/RECOVERY_INVALID/);
    await assert.rejects(access(join(catalog,jobId+'.quarantine.json')));
    assert.equal(await readFile(join(catalog,jobId+'.pin.json'),'utf8'),JSON.stringify(pin));
  }finally{await rm(root,{recursive:true,force:true});}
});

test('a matching immutable protected result yields a read-only attachment with all six field descriptors',async()=>{
  const components=['electric_potential','electric_field_magnitude','electric_displacement_magnitude'] as const;
  const units={electric_potential:'V',electric_field_magnitude:'V/m',electric_displacement_magnitude:'C/m^2'};
  const fieldDatasets=claim.domains.flatMap((domain:any)=>components.map(component=>({
    schema:'tunacad-electrostatic-field-dataset/0.1',analysisType:'electrostatic',
    datasetId:`${jobId}:${domain.domainId}:electrostatic:${component}`,jobId,domainId:domain.domainId,
    requestDigest:claim.requestDigest,resultDigest:claim.resultDigest,
    canonicalSourceDigest:claim.sourceDigest,meshDigest:claim.meshDigest,
    step:{index:0,label:'electrostatic'},component,unit:units[component],
    positionUnit:'mm',location:'boundary_facet',topology:'triangle_soup',
    sampling:component==='electric_potential'?'nodal':'element_average_of_four_integration_points',
    vectorsIncluded:component!=='electric_potential',
    valueRange:{minimum:1,maximum:2,minimumPositionAnalysisMm:[0,0,0],maximumPositionAnalysisMm:[1,0,0]},
    totalTriangles:1,maximumPageTriangles:128,datasetDigest:hash('9'),
  })));
  const viewer={analysisType:'electrostatic',fieldDatasets,
    perDomain:claim.domains.map((domain:any)=>({domainId:domain.domainId,
      materialId:domain.materialId,absolutePermittivityFPerM:domain.absolutePermittivityFPerM,
      permittivityUnit:'F/m',fieldDatasetIds:fieldDatasets.filter(d=>d.domainId===domain.domainId).map(d=>d.datasetId)})),
    twoLayerSummary:{electrodeChargesC:claim.electrodeFaceIds.map((faceId:string)=>({faceId,chargeC:0})),
      capacitanceF:1e-12,electrostaticEnergyJ:1e-9,interfaceNormalDJumpCPerM2:0,netElectrodeChargeC:0}};
  const completed={jobId,studyId,resultDigest:claim.resultDigest,
    binding:{sourceDigest:claim.sourceDigest,requestDigest:claim.requestDigest,
      projectRevision:claim.projectRevision,fragmentMeshDigest:claim.meshDigest},
    completedProviderState:'completed_converged',engineeringUsePermitted:false,providerAdmission:'closed'};
  let reads=0,snapshots=0,fresh=true,clock=1;
  const triangles:any[]=[{facetIndex:0,subtriangleIndex:0,elementIndex:0,
    nodeIds:[1,2,3],positionsAnalysisMm:[[0,0,0],[0,1,0],[1,0,0]],
    values:[1,1.5,2],vectors:null}];
  fieldDatasets[0].datasetDigest=digest(triangles);
  const provider:any={async getResultReadOnly(){reads++;return completed;},
    async getElectricalPresentationReadOnly(){throw Error('snapshot must be reused');},
    async getElectricalPresentationSnapshotReadOnly(){snapshots++;return {summary:viewer,
      fields:new Map([[fieldDatasets[0].datasetId,{descriptor:fieldDatasets[0],triangles}]])};},
    async getElectricalFieldPageReadOnly(){throw Error('field rebuild must not run');}};
  const owner=new TwoLayerReadOnlyRecoverySession(claim,provider,{now:()=>clock,
    assertSession(){},async verifySource(){if(!fresh)throw Error('source changed');}});
  const attached=await owner.result(jobId);
  assert.equal(attached.attachment.resultDigest,claim.resultDigest);
  assert.equal(attached.result.fieldDatasets.length,6);
  assert.equal(reads,1);
  await assert.rejects(owner.field(jobId,fieldDatasets[0].datasetId,'0',129),/bounds/);
  const page=await owner.field(jobId,fieldDatasets[0].datasetId,'0',128);
  assert.deepEqual(page.page.triangles,triangles);
  assert.equal(snapshots,1);assert.equal(reads,2);
  await assert.rejects(owner.field(jobId,'foreign-dataset','0',128),/not owned/);
  fresh=false;await assert.rejects(owner.field(jobId,fieldDatasets[0].datasetId,'0',128),/source changed/);
  assert.equal(reads,2);fresh=true;
  const original=completed.resultDigest;completed.resultDigest=hash('8');
  await assert.rejects(owner.field(jobId,fieldDatasets[0].datasetId,'0',128),/completion\/source mismatch/);
  completed.resultDigest=original;
  clock=claim.expiresAt;
  await assert.rejects(owner.field(jobId,fieldDatasets[0].datasetId,'0',128),/expired/);
  assert.equal(snapshots,1);
});
