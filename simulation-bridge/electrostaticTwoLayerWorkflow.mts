import * as z from 'zod/v4';
import { twoLayerAuthoringSchema } from './electrostaticTwoLayerAuthoring.mts';
import { twoLayerApprovalSchema, type TwoLayerApproval } from './electrostaticTwoLayerApproval.mts';
import { electricalDatasetSchema, ELECTRICAL_COMPONENTS, type ElectricalViewerResult } from './electrostaticFields.mts';

// Deliberate admission fuse, NOT a URL, submitted choice or environment switch.
// Scoped local human acceptance passed; public transport/origin admission remains closed.
export const TWO_LAYER_PUBLIC_EXECUTION_ENABLED = false;
export const TWO_LAYER_PREPARATION_WINDOW_MS = 540_000;
const id = z.string().min(1).max(160), sha = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const twoLayerGrantSchema = z.object({ authorizationId: z.string().regex(/^[a-f0-9]{64}$/), bridgeSessionToken: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const twoLayerStatusSchema = z.object({ jobId: z.string().regex(/^electrical_[a-f0-9-]{36}$/), state: z.enum(['queued','running','succeeded','failed','cancelled']), phase: id, cleanupConfirmed: z.boolean(), failureCode: id.nullable() }).strict();
const bindingShape = { studyId: id, projectRevision: id, sourceDigest: sha, requestDigest: sha, sessionBinding: sha, sourceEpoch: z.number().int().nonnegative() };
export const twoLayerJobResponseSchema = z.object({ schema: z.literal('tunacad-two-layer-job/0.1'), ...bindingShape, status: twoLayerStatusSchema, engineeringUsePermitted: z.literal(false), publicAdmission: z.literal('closed') }).strict();
export const twoLayerAttachmentSchema = z.object({ state: z.literal('current'), ...bindingShape, jobId: twoLayerStatusSchema.shape.jobId, resultDigest: sha }).strict();
/** A read-only source claim, deliberately not an approval or execution grant. */
export const twoLayerRecoverySchema = z.object({ schema:z.literal('tunacad-two-layer-read-only-recovery/0.1'),
  ...bindingShape, jobId:twoLayerStatusSchema.shape.jobId, resultDigest:sha, meshDigest:sha,
  domains:z.array(z.object({domainId:id,materialId:id,absolutePermittivityFPerM:z.number().finite().positive()}).strict()).length(2),
  electrodeFaceIds:z.array(id).length(2), expiresAt:z.number().int().positive(),
  readOnly:z.literal(true),engineeringUsePermitted:z.literal(false),publicAdmission:z.literal('closed') }).strict();
export type TwoLayerRecovery = z.infer<typeof twoLayerRecoverySchema>;
export const twoLayerWorkflowRequestSchema = z.discriminatedUnion('operation', [
  z.object({operation:z.literal('capabilities')}).strict(),
  z.object({operation:z.literal('submit'),studyId:id,grant:twoLayerGrantSchema}).strict(),
  ...(['status','cancel','result'] as const).map(operation=>z.object({operation:z.literal(operation),studyId:id,jobId:twoLayerStatusSchema.shape.jobId}).strict()),
  z.object({operation:z.literal('reopen'),studyId:id,jobId:twoLayerStatusSchema.shape.jobId,bridgeSessionToken:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
  z.object({operation:z.literal('field'),studyId:id,jobId:twoLayerStatusSchema.shape.jobId,datasetId:z.string().min(1).max(500),cursor:z.string().regex(/^(0|[1-9][0-9]{0,5})$/),limit:z.number().int().min(1).max(128)}).strict(),
]);
export const twoLayerAdmissionSchema = z.object({ schema:z.literal('tunacad-two-layer-execution-admission/0.1'), publicAdmission:z.literal('closed'), executionAvailable:z.boolean(), engineeringUsePermitted:z.literal(false), requirements:z.array(id).max(8) }).strict();
const preparationProgressShape={schema:z.literal('tunacad-two-layer-preparation-progress/0.1'),preparationId:z.uuid(),engineeringUsePermitted:z.literal(false)};
export const twoLayerPreparationProgressSchema=z.discriminatedUnion('state',[
  z.object({...preparationProgressShape,state:z.literal('pending')}).strict(),
  z.object({...preparationProgressShape,state:z.literal('prepared'),summary:z.record(z.string(),z.unknown())}).strict(),
  z.object({...preparationProgressShape,state:z.literal('failed'),error:z.string().min(1).max(2048)}).strict(),
]);
/** Choices only, never caller-supplied CAD facts, meshes, receipts or decks. */
export const twoLayerCompanionMessageSchema = z.discriminatedUnion('type', [
  z.object({type:z.literal('two_layer_prepare_request'),id:z.uuid(),authoring:twoLayerAuthoringSchema}).strict(),
  z.object({type:z.literal('two_layer_prepare_start_request'),id:z.uuid(),authoring:twoLayerAuthoringSchema}).strict(),
  z.object({type:z.literal('two_layer_prepare_status_request'),id:z.uuid(),preparationId:z.uuid()}).strict(),
  z.object({type:z.literal('two_layer_confirm_request'),id:z.uuid(),studyId:id,authoring:twoLayerAuthoringSchema}).strict(),
  z.object({type:z.literal('two_layer_admit_request'),id:z.uuid(),studyId:id,grant:twoLayerGrantSchema}).strict(),
  z.object({type:z.literal('two_layer_job_request'),id:z.uuid(),request:twoLayerWorkflowRequestSchema}).strict(),
]);
const viewerSchema = z.object({ analysisType:z.literal('electrostatic'),fieldDatasets:z.array(electricalDatasetSchema).length(6),perDomain:z.array(z.object({domainId:id,fieldDatasetIds:z.array(z.string().min(1).max(500)).length(3),materialId:id,absolutePermittivityFPerM:z.number().finite().positive(),permittivityUnit:z.literal('F/m')}).strict()).length(2),twoLayerSummary:z.object({electrodeChargesC:z.array(z.object({faceId:id,chargeC:z.number().finite()}).strict()).length(2),capacitanceF:z.number().finite().positive(),electrostaticEnergyJ:z.number().finite().nonnegative(),interfaceNormalDJumpCPerM2:z.number().finite(),netElectrodeChargeC:z.number().finite()}).strict() }).strict();
export type TwoLayerJobResponse = z.infer<typeof twoLayerJobResponseSchema>;
export type TwoLayerAttachment = z.infer<typeof twoLayerAttachmentSchema>;
export function twoLayerBinding(value: TwoLayerApproval) {
  const a=twoLayerApprovalSchema.parse(value);
  return {studyId:a.studyId,projectRevision:a.projectRevision,sourceDigest:a.sourceDigest,requestDigest:a.requestDigest,sessionBinding:a.sessionBinding,sourceEpoch:a.sourceEpoch};
}
export function assertTwoLayerBinding(value: Record<string,unknown>, approval: TwoLayerApproval) {
  for(const [key,expected]of Object.entries(twoLayerBinding(approval)))if(value[key]!==expected)throw Error('ELECTROSTATIC_TWO_LAYER_WORKFLOW_INVALID: source/session binding mismatch');
}
/** Metadata only: authenticated host completion remains the authority. This
 * check cannot create a completion, replace full page validation or admit a run. */
export function validateTwoLayerViewer(value: unknown, approval: TwoLayerApproval, jobId: string, resultDigest: string): ElectricalViewerResult {
  const a=twoLayerApprovalSchema.parse(approval);
  return validateViewer(value,{requestDigest:a.requestDigest,sourceDigest:a.sourceDigest,meshDigest:a.mesh.digest,
    domains:a.domains,electrodeFaceIds:a.electrodes.map(e=>e.faceId)},jobId,resultDigest);
}
export function validateTwoLayerRecoveredViewer(value:unknown,recovery:TwoLayerRecovery):ElectricalViewerResult {
  const r=twoLayerRecoverySchema.parse(recovery);
  return validateViewer(value,r,r.jobId,r.resultDigest);
}
function validateViewer(value:unknown,a:{requestDigest:string;sourceDigest:string;meshDigest:string;
  domains:readonly {domainId:string;materialId:string;absolutePermittivityFPerM:number}[];
  electrodeFaceIds:readonly string[]},jobId:string,resultDigest:string):ElectricalViewerResult {
  const v=viewerSchema.parse(value);
  if(new Set(v.fieldDatasets.map(d=>d.datasetId)).size!==6)throw Error('Two-layer duplicate field manifest');
  v.perDomain.forEach((d,i)=>{
    const source=a.domains[i];
    if(d.domainId!==source.domainId||d.materialId!==source.materialId||d.absolutePermittivityFPerM!==source.absolutePermittivityFPerM)throw Error('Two-layer field material/domain mismatch');
    const fields=v.fieldDatasets.filter(f=>f.domainId===d.domainId);
    if(fields.length!==3||new Set(fields.map(f=>f.component)).size!==3||ELECTRICAL_COMPONENTS.some(c=>!fields.some(f=>f.component===c))||new Set(d.fieldDatasetIds).size!==3||fields.some(f=>!d.fieldDatasetIds.includes(f.datasetId)))throw Error('Two-layer domain fields incomplete');
  });
  if(v.fieldDatasets.some(f=>f.jobId!==jobId||f.requestDigest!==a.requestDigest||f.canonicalSourceDigest!==a.sourceDigest||f.meshDigest!==a.meshDigest||f.resultDigest!==resultDigest)||v.twoLayerSummary.electrodeChargesC.some((e,i)=>e.faceId!==a.electrodeFaceIds[i]))throw Error('Two-layer field completion/source mismatch');
  return v;
}
