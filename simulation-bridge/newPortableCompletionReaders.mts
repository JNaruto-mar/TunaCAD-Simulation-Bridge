import {explicitPortableData,electricalPortableData,type AuthorizedPortableResult} from '../src/simulation/authorizedPortableResults.ts';
import type {ExplicitDynamicsResult} from '../src/simulation/explicitDynamicsProviderContracts.ts';
import type {PrivateExplicitSolveBinding} from './privateExplicitPreparationContract.mts';
import {electrostaticFoundationSchema,type ElectrostaticFoundation} from './electrostaticContract.mts';
import type {ElectrostaticDispatchProvider,ElectrostaticDispatchResult} from './electrostaticDispatchContract.mts';
import {loadElectricalDataset} from './electrostaticFields.mts';
import {webCryptoDigest as hash} from './v2ValidationBrowser.mts';
import type {ProjectResultCompletion as NativePortableCompletion} from '../src/simulation/authorizedPortableResults.ts';
type CompletionReader=Pick<ElectrostaticDispatchProvider,'capabilities'|'getStatus'|'getResult'|'getFieldDataset'|'captureNewPortableFields'>;

/** Call ONLY after existing native completion/source/mesh/provenance validators.
 * This projection cannot make an execution result native or authorize export. */
export async function projectNewExplicitCompletion(result:ExplicitDynamicsResult,binding:PrivateExplicitSolveBinding):Promise<NativePortableCompletion>{
  const {source,request,mesh,provider}=binding;
  // Source material is the full CAD assignment; result material is the sealed
  // solver-neutral request material. Their digests intentionally need not match.
  const materialDigest=await hash(request.material);
  if(result.executionStatus!=='succeeded'||result.status!=='proof_of_concept'||!result.cleanupConfirmed||result.actualMassScaling!==false||result.engineeringUsePermitted!==false||
    result.revision!==source.revision||result.requestDigest!==request.requestDigest||result.meshDigest!==mesh.meshDigest||result.geometryDigest!==source.canonicalSourceDigest||
    result.bodyId!==source.bodyId||result.domainId!==source.domainId||result.materialDigest!==materialDigest||result.provider.runtimeDigest!==provider.runtimeDigest)
    throw Error('PORTABLE_EXPORT_EXPLICIT_COMPLETION_BINDING_INVALID');
  return {origin:{revision:source.revision,requestDigest:request.requestDigest,geometryDigest:source.canonicalSourceDigest,meshDigest:mesh.meshDigest,
    materialDigest,providerId:result.provider.id,providerVersion:result.provider.version,runtimeFingerprint:provider.runtimeDigest,originalResultDigest:result.resultDigest,
    source:{documentId:source.modelId,bodyId:source.bodyId,domainId:source.domainId,studyId:result.studyId,runId:result.providerRunId,
      loadingFaceIds:[source.loadedFace.referenceId],constraintFaceIds:[source.fixedFace.referenceId],simulationInputDigest:request.requestDigest}},
    data:explicitPortableData(result,{nodes:mesh.nodeCount,elements:mesh.elementCount})};
}
/** A document association captured with NEW authenticated transfer only. It is
 * an owner-session-bound browser CAD identity, not a protected-history selector. */
export interface NewElectricalDocumentBinding {documentId:string;revision:string;bodyId:string}
async function readElectricalManifest(provider:CompletionReader,runId:string,
  sealed:ElectrostaticFoundation,document:NewElectricalDocumentBinding,signal:AbortSignal,captured?:ElectrostaticDispatchResult){
  signal.throwIfAborted();const request=electrostaticFoundationSchema.parse(sealed),domain=request.model.domains[0];
  const {requestDigest,...unsigned}=request;
  if(await hash(unsigned)!==requestDigest||document.revision!==request.model.projectRevision||document.bodyId!==domain.bodyId)
    throw Error('PORTABLE_EXPORT_ELECTRICAL_SOURCE_MISMATCH');
  const status=await provider.getStatus(runId);signal.throwIfAborted();
  if(status.status!=='succeeded')throw Error('PORTABLE_EXPORT_COMPLETION_REQUIRED');
  const result:ElectrostaticDispatchResult|null=captured??await provider.getResult(runId);signal.throwIfAborted();
  if(!result||result.providerRunId!==runId)throw Error('PORTABLE_EXPORT_COMPLETION_REQUIRED');
  const {dispatchDigest,...dispatch}=result,c=result.completion,{resultDigest:completionDigest,...completion}=c,
    b=c.binding,{sourceDigest,...binding}=b,e=c.electrical,{resultDigest:fieldDigest,...electrical}=e;
  if(c.schema!=='tunacad-electrostatic-completed-result/0.1'||c.completedProviderState!=='completed_converged'||c.status!=='proof_of_concept'||c.engineeringUsePermitted!==false||
    dispatchDigest!==await hash(dispatch)||completionDigest!==await hash(completion)||fieldDigest!==await hash(electrical)||fieldDigest!==c.normalizedElectricalResultDigest||
    sourceDigest!==await hash(binding)||b.requestDigest!==requestDigest||b.projectRevision!==request.model.projectRevision||b.geometryDigest!==domain.geometryDigest||
    b.domainId!==domain.domainId||b.modelDigest!==await hash(request.model)||b.materialDigest!==await hash(request.material)||
    b.electrodeDigest!==await hash(request.prescribedPotentials)||await hash(b.runtime)!==await hash(provider.capabilities.runtime))
    throw Error('PORTABLE_EXPORT_ELECTRICAL_COMPLETION_BINDING_INVALID');
  if(!Array.isArray(result.fieldDatasets)||result.fieldDatasets.length!==3||result.fieldDatasets.reduce((sum,d)=>sum+d.totalTriangles,0)>100000)
    throw Error('PORTABLE_EXPORT_ELECTRICAL_FIELD_BUDGET');
  for(const descriptor of result.fieldDatasets){
    if(descriptor.jobId!==runId||descriptor.requestDigest!==requestDigest||descriptor.resultDigest!==completionDigest||descriptor.domainId!==domain.domainId||
      descriptor.canonicalSourceDigest!==domain.geometryDigest||descriptor.meshDigest!==b.meshDigest)throw Error('PORTABLE_EXPORT_ELECTRICAL_FIELDS_MISMATCH');
  }
  const source:NonNullable<AuthorizedPortableResult['origin']['source']>={documentId:document.documentId,bodyId:domain.bodyId,domainId:domain.domainId,
    studyId:request.studyId,runId,loadingFaceIds:[request.prescribedPotentials[1].faceIds[0]],constraintFaceIds:[request.prescribedPotentials[0].faceIds[0]],simulationInputDigest:requestDigest};
  return {result,e,domain,origin:{revision:b.projectRevision,requestDigest,geometryDigest:b.geometryDigest,meshDigest:b.meshDigest,materialDigest:b.materialDigest,
    providerId:b.runtime.providerId,providerVersion:b.runtime.providerVersion,runtimeFingerprint:await hash(b.runtime),originalResultDigest:completionDigest,source}};
}
export async function readNewElectricalCompletion(provider:CompletionReader,runId:string,
  sealed:ElectrostaticFoundation,document:NewElectricalDocumentBinding,signal:AbortSignal):Promise<NativePortableCompletion>{
  const capture=provider.captureNewPortableFields?await provider.captureNewPortableFields(runId,signal):null;
  const {result,e,domain,origin}=await readElectricalManifest(provider,runId,sealed,document,signal,capture?.result);
  const datasets=[];let collectedBytes=16384;
  for(const descriptor of result.fieldDatasets){
    const data=await loadElectricalDataset(descriptor,async(cursor,limit)=>{
      signal.throwIfAborted();let page;
      if(capture){
        const field=capture.datasets.find(d=>d.descriptor.datasetId===descriptor.datasetId);
        if(!field||await hash(field.descriptor)!==await hash(descriptor))throw Error('PORTABLE_EXPORT_ELECTRICAL_FIELDS_MISMATCH');
        const start=Number(cursor),triangles=field.triangles.slice(start,start+limit),end=start+triangles.length;
        page={schema:'tunacad-electrostatic-field-page/0.1' as const,dataset:descriptor,cursor,nextCursor:end<field.triangles.length?String(end):null,
          triangleOffset:start,triangleCount:triangles.length,triangles,chunkDigest:await hash(triangles)};
      }else page=await provider.getFieldDataset(runId,descriptor.datasetId,cursor,limit);
      signal.throwIfAborted();collectedBytes+=new TextEncoder().encode(JSON.stringify(page.triangles)).length;
      if(collectedBytes>32*1024*1024)throw Error('PORTABLE_EXPORT_ELECTRICAL_FIELD_BUDGET');return page;
    });datasets.push(data);
  }
  return {origin,
    data:electricalPortableData(domain.domainId,datasets,{capacitanceF:e.capacitanceF,electrostaticEnergyJ:e.electrostaticEnergyJ,
      electrodeChargesC:e.electrodes.map(e=>({faceId:e.faceId,chargeC:e.chargeC}))})};
}
export async function assertNewElectricalCompletionCurrent(provider:CompletionReader,runId:string,sealed:ElectrostaticFoundation,
  document:NewElectricalDocumentBinding,completion:NativePortableCompletion,signal:AbortSignal){
  const current=await readElectricalManifest(provider,runId,sealed,document,signal);
  if(completion.data.kind!=='single_dielectric_fields'||await hash(current.origin)!==await hash(completion.origin)||
    await hash(current.result.fieldDatasets)!==await hash(completion.data.datasets.map(d=>d.descriptor)))
    throw Error('PORTABLE_EXPORT_COMPLETION_CHANGED');
}
