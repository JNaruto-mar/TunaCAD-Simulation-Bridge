import * as z from 'zod/v4';
import {webCryptoDigest} from '../../simulation-bridge/v2ValidationBrowser.mts';
import {electricalDatasetSchema,electricalTriangleSchema,loadElectricalDataset} from '../../simulation-bridge/electrostaticFields.mts';

/** Portable data contract only. No owner/storage reader, transport registration,
 * approval creator or solver capability. Receipt hashes alone are NOT consent. */
const hash=z.string().regex(/^sha256:[a-f0-9]{64}$/),id=z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/),finite=z.number().finite();
const origin=z.object({revision:id,requestDigest:hash,geometryDigest:hash,meshDigest:hash,materialDigest:hash,
  providerId:id,providerVersion:id,runtimeFingerprint:hash,originalResultDigest:hash,
  source:z.object({documentId:id,bodyId:id,domainId:id,studyId:id,runId:id,
    loadingFaceIds:z.array(id).min(1).max(8),constraintFaceIds:z.array(id).min(1).max(8),
    simulationInputDigest:hash}).strict().optional()}).strict();
const node=z.object({nodeId:z.number().int().positive(),face:z.enum(['fixed','loaded','monitor']),displacementMm:finite,
  velocityMmPerS:finite,accelerationMmPerS2:finite,reactionImpulseNs:finite,reactionForceN:finite}).strict();
const explicit=z.object({kind:z.literal('explicit_recorded_face_history'),axis:z.literal('X'),location:z.literal('recorded_FACE_nodes_only'),
  meshCounts:z.object({nodes:z.number().int().min(4).max(100000),elements:z.number().int().min(1).max(50000)}).strict(),
  units:z.object({time:z.literal('s'),displacement:z.literal('mm'),velocity:z.literal('mm/s'),acceleration:z.literal('mm/s^2'),
    impulse:z.literal('N*s'),force:z.literal('N'),energy:z.literal('N*mm'),mass:z.literal('kg')}).strict(),
  monitoringFaces:z.array(z.object({referenceId:id,nodeIds:z.array(z.number().int().positive()).min(1).max(16000)}).strict()).max(8),
  fixedNodeIds:z.array(z.number().int().positive()).min(3).max(16000).optional(),
  loadedNodeIds:z.array(z.number().int().positive()).min(3).max(16000).optional(),
  frames:z.array(z.object({timeS:finite.nonnegative(),timestepS:finite.positive(),nodes:z.array(node).min(1).max(16000),
    supportImpulseNs:finite,supportReactionN:finite,kineticEnergyNmm:finite,internalEnergyNmm:finite,externalWorkNmm:finite,
    totalMassKg:finite.positive(),addedMassKg:finite,addedMassChangeKg:finite}).strict()).min(2).max(64)}).strict();
const electrical=z.object({kind:z.literal('single_dielectric_fields'),domainId:id,
  summary:z.object({capacitanceF:finite.nonnegative(),electrostaticEnergyJ:finite.nonnegative(),
    electrodeChargesC:z.array(z.object({faceId:id,chargeC:finite}).strict()).length(2)}).strict().optional(),
  datasets:z.array(z.object({descriptor:electricalDatasetSchema,triangles:z.array(electricalTriangleSchema).min(1).max(64000)}).strict()).length(3)}).strict();
const envelope=z.object({schema:z.enum(['tunacad-authorized-portable-result/1','tunacad-authorized-portable-result/2']),origin,
  data:z.discriminatedUnion('kind',[explicit,electrical]),payloadDigest:hash,
  exportReceipt:z.object({schema:z.literal('tunacad-owner-export-receipt/1'),issuerFingerprint:hash,receiptId:id,
    scope:z.literal('sanitized_read_only_result_export'),payloadDigest:hash,originDigest:hash,
    consentDigest:hash.optional(),authorizedAt:z.string().datetime().optional(),
    signature:z.string().regex(/^[A-Za-z0-9+/=]{32,4096}$/)}).strict(),
  engineeringUsePermitted:z.literal(false)}).strict();
export type AuthorizedPortableResult=z.infer<typeof envelope>;
export type ProjectResultCompletion=Pick<AuthorizedPortableResult,'origin'|'data'>;
// Ordinary project copies are delivered under the NEW simulation request's
// explicit resultDelivery policy, not a historical export grant. On import they
// prove file integrity only: never owner authentication or execution authority.
const projectEnvelope=envelope.omit({exportReceipt:true}).extend({schema:z.literal('tunacad-project-completed-result/1'),
  delivery:z.literal('approved_new_simulation'),trust:z.literal('project_copy_integrity_only')}).strict();
export type ProjectCompletionSnapshot=z.infer<typeof projectEnvelope>;
export type PortableNumericalResult=AuthorizedPortableResult|ProjectCompletionSnapshot;
/** Strict projections for freshly completed, already owner-verified results.
 * Caller must not supply storage paths or use these as authorization evidence. */
export function explicitPortableData(value:import('./explicitDynamicsProviderContracts.ts').ExplicitDynamicsResult,meshCounts:{nodes:number;elements:number}):AuthorizedPortableResult['data']{
  return explicit.parse({kind:'explicit_recorded_face_history',axis:value.sampling.axis,location:'recorded_FACE_nodes_only',
    meshCounts,units:value.units,monitoringFaces:value.sampling.monitoringFaces??[],fixedNodeIds:value.sampling.fixedNodeIds,
    loadedNodeIds:value.sampling.loadedNodeIds,frames:value.frames});
}
export function electricalPortableData(domainId:string,datasets:unknown,summary:unknown):AuthorizedPortableResult['data']{
  return electrical.parse({kind:'single_dielectric_fields',domainId,datasets,summary});
}
export interface OwnerExportReceiptVerifier {
  /** Must verify authenticated-owner issuance/trust and the separate export consent.
   * Implementations cannot infer authorization from an imported receipt's claims. */
  verify(receipt:AuthorizedPortableResult['exportReceipt'],expected:{payloadDigest:string;originDigest:string}):Promise<void>;
}
export function portableResultExportRequest(kind:'explicit_recorded_face_history'|'single_dielectric_fields',binding:AuthorizedPortableResult['origin']){
  return {schema:'tunacad-sanitized-result-export-request/1',kind:z.enum(['explicit_recorded_face_history','single_dielectric_fields']).parse(kind),origin:origin.parse(binding),
    scope:'sanitized_read_only_result_export',engineeringUsePermitted:false};
}
export async function validateAuthorizedPortableResult(raw:unknown,ownerVerifier?:OwnerExportReceiptVerifier):Promise<AuthorizedPortableResult>{
  if(!ownerVerifier)throw Error('PORTABLE_RESULT_OWNER_EXPORT_AUTHORIZATION_UNAVAILABLE');
  if(new TextEncoder().encode(JSON.stringify(raw)).length>32*1024*1024)throw Error('PORTABLE_RESULT_SIZE_LIMIT');
  const value=envelope.parse(raw);await validateNumericalPayload(value);
  await ownerVerifier.verify(value.exportReceipt,{payloadDigest:value.payloadDigest,originDigest:await webCryptoDigest(value.origin)});
  return structuredClone(value);
}
export async function validateProjectCompletionSnapshot(raw:unknown):Promise<ProjectCompletionSnapshot>{
  if(new TextEncoder().encode(JSON.stringify(raw)).length>32*1024*1024)throw Error('PORTABLE_RESULT_SIZE_LIMIT');
  const value=projectEnvelope.parse(raw);await validateNumericalPayload(value);return structuredClone(value);
}
/** Pure projection AFTER authenticated new-completion validation. This is not
 * an owner/signing/approval API; imported snapshots never grant those powers. */
export async function createProjectCompletionSnapshot(completion:Pick<AuthorizedPortableResult,'origin'|'data'>,
  request:{requestDigest:string;resultDelivery?:'project_archive'}):Promise<ProjectCompletionSnapshot>{
  if(request.resultDelivery!=='project_archive'||completion.origin.requestDigest!==request.requestDigest)
    throw Error('PROJECT_RESULTS_NOT_INCLUDED_IN_APPROVED_REQUEST');
  const snapshot={origin:structuredClone(completion.origin),data:structuredClone(completion.data)};
  return validateProjectCompletionSnapshot({...snapshot,schema:'tunacad-project-completed-result/1',delivery:'approved_new_simulation',
    trust:'project_copy_integrity_only',payloadDigest:await webCryptoDigest({...snapshot,engineeringUsePermitted:false}),engineeringUsePermitted:false});
}
/** Shared read-only delivery sequence for already-authorized NEW completions.
 * This is NOT an approval/session/job factory. The caller must enforce its
 * actual owner or isolated-development eligibility in assertCurrent, and run
 * its existing capability-specific completion/source checks in readCompletion.
 * No default eligibility, imported job restoration or execution route exists. */
export async function collectCurrentProjectCompletion(
  request:{requestDigest:string;resultDelivery?:'project_archive'},
  boundary:{signal:AbortSignal;assertCurrent():void|Promise<void>;readCompletion():Promise<ProjectResultCompletion>},
):Promise<ProjectCompletionSnapshot>{
  if(request.resultDelivery!=='project_archive')throw Error('PROJECT_RESULTS_NOT_INCLUDED_IN_APPROVED_REQUEST');
  const current=async()=>{boundary.signal.throwIfAborted();await boundary.assertCurrent();boundary.signal.throwIfAborted();};
  await current();
  const completion=await boundary.readCompletion();
  await current();
  const result=await createProjectCompletionSnapshot(completion,request);
  await current();
  return result;
}
async function validateNumericalPayload(value:PortableNumericalResult){
  const data=value.data;
  if(value.schema==='tunacad-authorized-portable-result/2'||value.schema==='tunacad-project-completed-result/1'){
    const source=value.origin.source;
    if(!source||value.schema==='tunacad-authorized-portable-result/2'&&(!value.exportReceipt.consentDigest||!value.exportReceipt.authorizedAt)||
      new Set(source.loadingFaceIds).size!==source.loadingFaceIds.length||new Set(source.constraintFaceIds).size!==source.constraintFaceIds.length||
      source.loadingFaceIds.some(id=>source.constraintFaceIds.includes(id))||
      source.simulationInputDigest!==value.origin.requestDigest)throw Error('PORTABLE_RESULT_SOURCE_OR_CONSENT_REQUIRED');
    if(data.kind==='single_dielectric_fields'&&(!data.summary||data.domainId!==source.domainId||data.datasets.some(d=>d.descriptor.jobId!==source.runId)||
      data.summary.electrodeChargesC.some(e=>!source.loadingFaceIds.includes(e.faceId)&&!source.constraintFaceIds.includes(e.faceId))||
      new Set(data.summary.electrodeChargesC.map(e=>e.faceId)).size!==2))throw Error('PORTABLE_RESULT_SUMMARY_BINDING_INVALID');
    if(data.kind==='explicit_recorded_face_history'&&(!data.fixedNodeIds||!data.loadedNodeIds))throw Error('PORTABLE_RESULT_FACE_MEMBERSHIP_REQUIRED');
  }
  if(data.kind==='explicit_recorded_face_history'){
    const first=data.frames[0].nodes.map(n=>[n.nodeId,n.face]);
    if(new Set(first.map(n=>n[0])).size!==first.length||data.frames.some((f,i)=>i>0&&f.timeS<=data.frames[i-1].timeS||JSON.stringify(f.nodes.map(n=>[n.nodeId,n.face]))!==JSON.stringify(first)))
      throw Error('PORTABLE_RESULT_HISTORY_COVERAGE_INVALID');
    const ids=new Set(first.map(n=>n[0]));
    for(const membership of [data.fixedNodeIds,data.loadedNodeIds])if(membership&&
      (new Set(membership).size!==membership.length||membership.some(n=>!ids.has(n))))throw Error('PORTABLE_RESULT_FACE_BINDING_INVALID');
    if(data.fixedNodeIds&&data.loadedNodeIds&&data.frames[0].nodes.some(n=>
      n.face==='fixed'&&!data.fixedNodeIds!.includes(n.nodeId)||n.face==='loaded'&&!data.loadedNodeIds!.includes(n.nodeId)||
      !data.fixedNodeIds!.includes(n.nodeId)&&!data.loadedNodeIds!.includes(n.nodeId)&&!data.monitoringFaces.some(f=>f.nodeIds.includes(n.nodeId))))
      throw Error('PORTABLE_RESULT_FACE_BINDING_INVALID');
    if(new Set(data.monitoringFaces.map(f=>f.referenceId)).size!==data.monitoringFaces.length||data.monitoringFaces.some(f=>new Set(f.nodeIds).size!==f.nodeIds.length||f.nodeIds.some(n=>!ids.has(n))))
      throw Error('PORTABLE_RESULT_FACE_BINDING_INVALID');
    // Preserve the canonical constant negative mass-subtraction roundoff; never
    // clamp it to zero or admit positive/changed mass scaling.
    const n=data.meshCounts.nodes+data.meshCounts.elements,u=2**-53,m=data.frames[0].totalMassKg,bound=n*u/(1-n*u)*m;
    if(data.frames.some(f=>f.kineticEnergyNmm<0||f.internalEnergyNmm<0||f.totalMassKg!==m||f.addedMassKg>0||
      Math.abs(f.addedMassKg)>bound||f.addedMassKg!==data.frames[0].addedMassKg||f.addedMassChangeKg!==0))throw Error('PORTABLE_RESULT_MASS_HISTORY_INVALID');
  }else{
    const components=new Set<string>();let total=0;
    for(const d of data.datasets){const desc=d.descriptor;components.add(desc.component);total+=d.triangles.length;
      if(desc.domainId!==data.domainId||desc.requestDigest!==value.origin.requestDigest||desc.canonicalSourceDigest!==value.origin.geometryDigest||
        desc.meshDigest!==value.origin.meshDigest||desc.resultDigest!==value.origin.originalResultDigest||desc.totalTriangles!==d.triangles.length||
        await webCryptoDigest(d.triangles)!==desc.datasetDigest)throw Error('PORTABLE_RESULT_FIELD_BINDING_INVALID');
      if(d.triangles.some(t=>(t.vectors!==null)!==desc.vectorsIncluded||new Set(t.nodeIds).size!==3||t.values.some(v=>v<desc.valueRange.minimum||v>desc.valueRange.maximum)))
        throw Error('PORTABLE_RESULT_FIELD_VALUES_INVALID');
      await loadElectricalDataset(desc,async(cursor,limit)=>{const start=Number(cursor),triangles=d.triangles.slice(start,start+limit),end=start+triangles.length;
        return {schema:'tunacad-electrostatic-field-page/0.1',dataset:desc,cursor,nextCursor:end<d.triangles.length?String(end):null,
          triangleOffset:start,triangleCount:triangles.length,triangles,chunkDigest:await webCryptoDigest(triangles)};});
    }
    const topology=(d:typeof data.datasets[number])=>JSON.stringify(d.triangles.map(t=>[t.facetIndex,t.subtriangleIndex,t.elementIndex,t.nodeIds,t.positionsAnalysisMm]));
    if(components.size!==3||total>100000||data.datasets.some(d=>topology(d)!==topology(data.datasets[0])))throw Error('PORTABLE_RESULT_FIELD_COVERAGE_INVALID');
  }
  const payloadDigest=await webCryptoDigest({origin:value.origin,data:value.data,engineeringUsePermitted:false}),originDigest=await webCryptoDigest(value.origin);
  if(payloadDigest!==value.payloadDigest||'exportReceipt' in value&&(value.exportReceipt.payloadDigest!==payloadDigest||value.exportReceipt.originDigest!==originDigest))
    throw Error('PORTABLE_RESULT_EXPORT_DIGEST_INVALID');
}
