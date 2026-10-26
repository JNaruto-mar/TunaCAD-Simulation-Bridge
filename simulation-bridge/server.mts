import {validateExplicitDynamics,type ExplicitDynamicsRequest} from './explicitDynamicsFoundation.mts';
import type {ExplicitDispatchProvider} from './explicitDispatchContract.mts';
import {explicitPortableData} from '../src/simulation/authorizedPortableResults.ts';
import {NEW_EXPLICIT_PROJECT_RESULT_CAPTURE_ENABLED} from '../src/simulation/projectResultDeliveryPolicy.ts';
import type {TrustedSimulationSession} from './trustedSimulationSession.mjs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {NEW_ELECTROSTATIC_PROJECT_RESULT_CAPTURE_ENABLED as NEW_PROJECT_RESULT_CAPTURE_ENABLED} from '../src/simulation/projectResultDeliveryPolicy.ts';
import { randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import * as z from 'zod/v4';
import type {
  ExternalSimulationProvider,
  ExternalSimulationProviderV2,
  NeutralSimulationRequest,
  NeutralSimulationRequestV2,
  SimulationProviderSubmission,
  SimulationProviderStatus,
} from '../src/simulation/externalSimulationContracts.ts';
import { SIMULATION_BRIDGE_VERSION, type SimulationBridgeReadiness } from '../src/simulation/simulationBridgeProtocol.ts';
import { validateRequestEnvelope } from './requestValidation.mts';
import { admitV2SimulationRequest, validateNeutralSimulationFieldPageV2 } from './v2Validation.mts';
import { validateElectrostaticFoundation, type ElectrostaticFoundation } from './electrostaticFoundation.mts';
import type { ElectrostaticDispatchProvider } from './electrostaticDispatchContract.mts';
import { electrostaticStepGeometryDigest } from './electrostaticStepIdentity.mts';
import { validateElectricalPage } from './electrostaticFields.mts';
import { twoLayerApprovalSchema, type TwoLayerApproval } from './electrostaticTwoLayerApproval.mts';
import { digest } from './stableDigest.mts';
import { createPrivateSimulationApprovals } from './privateSimulationApproval.mts';
import type { PrivateExplicitSolveBinding,PrivateExplicitProvider } from './privateExplicitPreparationContract.mts';
import { providerPathsSchema } from './providerSettings.mts';
import {NATIVE_PORTABLE_EXPORT_ENABLED,createNativeCompletedExport,type NativePortableReceiptAuthority,type PortableExportReview} from './nativePortableExport.mts';
import {readNewElectricalCompletion,assertNewElectricalCompletionCurrent,type NewElectricalDocumentBinding} from './newPortableCompletionReaders.mts';
import {portableResultExportRequest,createProjectCompletionSnapshot,collectCurrentProjectCompletion} from '../src/simulation/authorizedPortableResults.ts';
import type {ProjectResultCompletion} from '../src/simulation/authorizedPortableResults.ts';
import { createStationaryFractureOwner, isFractureOperation, type FractureOperationApproval,
  type FractureOwnerConfiguration, type ControlledFractureOwnerConfiguration } from './stationaryFractureOwner.mts';

const MAX_STEP = 16 * 1024 * 1024;
const MAX_TOTAL_STEP = 64 * 1024 * 1024;
const MAX_DOMAINS = 16;
const SESSION_MS = 30 * 60_000;
const APPROVAL_MS = 2 * 60_000;
const token = () => randomBytes(32).toString('hex');
const secretEquals = (a: string, b: string) => {
  const left = new TextEncoder().encode(a), right = new TextEncoder().encode(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
type BridgeRequest = NeutralSimulationRequest | NeutralSimulationRequestV2 | ElectrostaticFoundation | ExplicitDynamicsRequest;
type AnyProvider = ExternalSimulationProvider | ExternalSimulationProviderV2 | ElectrostaticDispatchProvider | ExplicitDispatchProvider;
type ApprovalRequest = BridgeRequest | TwoLayerApproval | FractureOperationApproval;
type Approval = { id: string; request: ApprovalRequest; expiresAt: number; state: 'pending' | 'approved' | 'denied' | 'used';
  preparationId?: string; sessionKey?: string; clientId?:string; revoked?: boolean; submission?: SimulationProviderSubmission; provider?: AnyProvider };
type BridgeJob = { submission: SimulationProviderSubmission; provider: AnyProvider;
  request?:BridgeRequest;
  preparationId?:string;
  deliveredProjectDigest?:string;
  archived?:boolean;
  cleanupFailure?:unknown;
  executionReleased?:boolean;
  finalStatus?:SimulationProviderStatus;
  releaseWork?:Promise<SimulationProviderStatus>;
  newExplicitSource?:{document:NewElectricalDocumentBinding;request:ExplicitDynamicsRequest;ownerSession:string};
  newElectricalSource?:{document:NewElectricalDocumentBinding;request:ElectrostaticFoundation;ownerSession:string};
  portableExport?:ReturnType<typeof createNativeCompletedExport> };
const isV2Request = (request: BridgeRequest): request is NeutralSimulationRequestV2 => request.schema === 'tunacad-neutral-simulation-request/2.0';
const isExplicit=(request:ApprovalRequest):request is ExplicitDynamicsRequest=>request.schema==='tunacad-explicit-dynamics-foundation/0.1';
const isElectrical = (request: ApprovalRequest): request is ElectrostaticFoundation => request.schema === 'tunacad-electrostatic-foundation/0.1';
const isTwoLayerApproval = (request: ApprovalRequest): request is TwoLayerApproval =>
  request.schema === 'tunacad-electrostatic-two-layer-approval/0.1';

/** Local host API only. Provider configuration accepts two executable paths
 * behind an authenticated session; execution arguments remain fixed in host adapters. */
export async function startSimulationBridge(options: {
  provider: ExternalSimulationProvider | null;
  providerV2?: ExternalSimulationProviderV2 | null;
  providerElectrical?: ElectrostaticDispatchProvider | null;
  providerExplicit?:ExplicitDispatchProvider|null;
  readiness: Omit<SimulationBridgeReadiness, 'protocolVersion' | 'limits'>;
  approve: (request: ApprovalRequest | PrivateExplicitSolveBinding | PortableExportReview, signal: AbortSignal) => Promise<boolean>;
  /** Trusted owner key handle only. No HTTP/env key enrollment or file reader. */
  portableResultAuthority?:NativePortableReceiptAuthority;
  /** Trusted local development launcher ONLY. No production provider, execution
   * route, protected owner brand or human-approval receipt exists in this mode. */
  isolatedDevelopmentCompletion?:{purpose:'isolated_authenticated_native_pair';expiresAt:number};
  // Explicit trusted pilot bootstrap only; never enabled by HTTP/env/discovery.
  stationaryFracturePilot?: FractureOwnerConfiguration;
  // Constructor-only mocked stages use the SAME authenticated owner handlers,
  // but cannot mint native provenance or enter the native process factory.
  controlledFractureFixture?: ControlledFractureOwnerConfiguration;
  // Trusted local launch only. No route or capability-discovery registration.
  // Default disabled; this internal port stops at authorization, never dispatch.
  privateExplicitApprovals?: {readProviderIdentity():Promise<PrivateExplicitProvider>};
  configureProviders?: (paths: { gmshExecutable: string; calculixExecutable: string }) => Promise<{
    provider: ExternalSimulationProvider | null;
    providerV2?: ExternalSimulationProviderV2 | null;
    providerElectrical?: ElectrostaticDispatchProvider | null;
    readiness: Omit<SimulationBridgeReadiness, 'protocolVersion' | 'limits'>;
  }>;
  browseProviderExecutable?: (provider: 'gmsh' | 'calculix') => Promise<string>;
  saveProviderSettings?: (paths: { gmshExecutable: string; calculixExecutable: string }) => Promise<{ gmshExecutable: string; calculixExecutable: string }>;
  port?: number;
  // Explicit local launch configuration, never supplied through HTTP.
  allowedOrigin?: string;
  /** Constructor-owned Companion grant, never request JSON or device pairing. */
  trustedSimulationSession?:TrustedSimulationSession;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const origin = options.allowedOrigin ?? 'https://tunacad.com';
  if (origin !== 'https://tunacad.com' && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) throw new Error('Invalid explicit origin');
  const development=options.isolatedDevelopmentCompletion;
  if(development&&(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)||development.purpose!=='isolated_authenticated_native_pair'
    ||!Number.isFinite(development.expiresAt)||development.expiresAt<=now()||development.expiresAt>now()+13*60_000
    ||options.provider||options.providerV2||options.providerElectrical||options.providerExplicit||options.configureProviders||options.saveProviderSettings||options.browseProviderExecutable
    ||options.trustedSimulationSession||options.privateExplicitApprovals||options.stationaryFracturePilot||options.controlledFractureFixture||options.portableResultAuthority
    ||options.readiness.ready||options.readiness.provider||options.readiness.providerV2||options.readiness.electrostatic||options.readiness.meshing.ready||options.readiness.solving.ready))
    throw Error('BRIDGE_DEVELOPMENT_SCOPE_INVALID');
  const developmentResults=new Map<string,{session:string;result:Awaited<ReturnType<typeof createProjectCompletionSnapshot>>}>();
  let pairingCode = randomBytes(16).toString('hex');
  const pairingExpiresAt = now() + 5 * 60_000;
  let pairingAttempts = 0;
  let session: { key: string; expiresAt: number } | null = null;
  let privateApprovalPending=false;
  let projectDeliveryPending=false;
  // One native opaque identity for both source binding and approval ownership.
  // The pairing key remains private to HMAC/authentication, not a source ID.
  const privateSessionIdentity=()=>session&&session.expiresAt>now()?digest({pairedSession:session.key}):null;
  const privateApprovals=options.privateExplicitApprovals?createPrivateSimulationApprovals({
    readSession:privateSessionIdentity,
    readProvider:()=>options.privateExplicitApprovals!.readProviderIdentity(),
    approve:async(request,signal)=>{
      if(privateApprovalPending||busy||[...approvals.values()].some(a=>a.expiresAt>now()&&a.state==='pending'))
        throw new Error('BRIDGE_BUSY');
      privateApprovalPending=true;
      try {return await options.approve(request,signal);}finally {privateApprovalPending=false;}
    },now,
  }):null;
  let approvalController: AbortController | null = null;
  const approvals = new Map<string, Approval>();
  const jobs = new Map<string, BridgeJob>();
  let submissions = 0;
  let authorizationAttempts = 0;
  let busy = false;
  let stopping = false;
  let pendingSubmission:Promise<void>|null=null;
  let revocation:Promise<void>|undefined,closing:Promise<void>|undefined;
  let authority = '';
  let provider = options.provider;
  let providerV2 = options.providerV2 ?? null;
  const providerExplicit=options.providerExplicit??null;
  let providerElectrical = options.providerElectrical ?? null;
  let readiness: SimulationBridgeReadiness = {
    ...options.readiness, protocolVersion: SIMULATION_BRIDGE_VERSION,
    limits: { maximumStepBytes: MAX_STEP, maximumTotalStepBytes: MAX_TOTAL_STEP, maximumDomains: MAX_DOMAINS, maximumJobs: 4, sessionLifetimeMs: SESSION_MS },
  };
  if (options.stationaryFracturePilot && options.controlledFractureFixture)
    throw new Error('BRIDGE_FRACTURE_AMBIGUOUS_CONFIGURATION');
  const fractureChallenges = new Set<string>();
  const fractureConfiguration = options.stationaryFracturePilot ?? options.controlledFractureFixture;
  const authenticateFractureWindow = (operation:string, body:unknown, proof:{challenge:string;proof:string}) => {
      const current = session;
      if (stopping || !current || current.expiresAt <= now()) throw new Error('BRIDGE_SESSION_REQUIRED');
      if (!proof || !/^[a-f0-9]{64}$/.test(proof.challenge) || !/^[a-f0-9]{64}$/.test(proof.proof)
        || fractureChallenges.has(proof.challenge) || fractureChallenges.size >= 128)
        throw new Error('BRIDGE_FRACTURE_WINDOW_PROOF_INVALID');
      const expected = createHmac('sha256', current.key)
        .update(`stationary-fracture:${operation}:${proof.challenge}:${digest(body)}`).digest('hex');
      if (!secretEquals(proof.proof, expected)) throw new Error('BRIDGE_FRACTURE_WINDOW_PROOF_INVALID');
      fractureChallenges.add(proof.challenge);
      return digest({ pairedSession: current.key });
  };
  const fractureJobs = fractureConfiguration ? createStationaryFractureOwner({
    now, sessionIdentity: privateSessionIdentity,
    authenticate: authenticateFractureWindow,
    reserveJob() {
      if (stopping || busy || privateApprovalPending || jobs.size || submissions >= 4)
        throw new Error('BRIDGE_BUSY');
      submissions++;
    },
    beginRun() {
      if (stopping || busy || privateApprovalPending || jobs.size) throw new Error('BRIDGE_BUSY');
      busy = true; return () => { busy = false; };
    },
    async review(request, signal) {
      if (stopping || busy || privateApprovalPending || [...approvals.values()].some(a =>
        a.expiresAt > now() && ['pending', 'approved'].includes(a.state)
        && (!isFractureOperation(a.request) || a.request.binding.bindingDigest !== request.binding.bindingDigest)))
        throw new Error('BRIDGE_BUSY');
      if (!session || session.expiresAt <= now()) throw new Error('BRIDGE_SESSION_REQUIRED');
      if (++authorizationAttempts > 8) throw new Error('BRIDGE_AUTHORIZATION_LIMIT');
      const approval: Approval = { id: token(), request: structuredClone(request), state: 'pending',
        sessionKey: session.key, expiresAt: Math.min(now() + APPROVAL_MS, session.expiresAt) };
      const controller = new AbortController(); approvalController = controller;
      approvals.set(approval.id, approval); privateApprovalPending = true;
      const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      const timer = setTimeout(abort, Math.max(0, approval.expiresAt - now())); timer.unref();
      try {
        const aborted = new Promise<false>(resolve => {
          if (controller.signal.aborted) resolve(false);
          else controller.signal.addEventListener('abort', () => resolve(false), { once: true });
        });
        const permitted = !controller.signal.aborted && await Promise.race([
          options.approve(structuredClone(request), controller.signal).catch(() => false), aborted,
        ]);
        if (!permitted || controller.signal.aborted || session?.key !== approval.sessionKey
          || approval.expiresAt <= now() || approvals.get(approval.id) !== approval) {
          approval.state = 'denied'; throw new Error('BRIDGE_TRANSFER_NOT_APPROVED');
        }
        approval.state = 'approved'; return approval;
      } catch (error) {
        approval.state = 'denied'; controller.abort(); throw error;
      } finally {
        clearTimeout(timer); signal.removeEventListener('abort', abort); privateApprovalPending = false;
        if (approvalController === controller) approvalController = null;
      }
    },
    verify(request, receipt, consumed) {
      const approval = receipt as Approval;
      if (!session || session.expiresAt <= now() || approvals.get(approval.id) !== approval
        || approval.sessionKey !== session.key || approval.revoked || !isFractureOperation(approval.request)
        || digest(request) !== digest(approval.request) || approval.state !== (consumed ? 'used' : 'approved')
        || (!consumed && approval.expiresAt <= now())) throw new Error('BRIDGE_FRACTURE_APPROVAL_INVALID');
    },
    consume(request, receipt) {
      const approval = receipt as Approval;
      if (!session || session.expiresAt <= now() || approval.sessionKey !== session.key
        || approvals.get(approval.id) !== approval || approval.revoked || approval.state !== 'approved'
        || approval.expiresAt <= now() || !isFractureOperation(approval.request)
        || digest(request) !== digest(approval.request)) throw new Error('BRIDGE_FRACTURE_APPROVAL_INVALID');
      approval.state = 'used';
    },
    revokeReceipt(receipt) { const approval = receipt as Approval;
      if (approvals.get(approval.id) === approval) { approval.revoked = true; approval.state = 'denied'; } },
  }, fractureConfiguration, options.controlledFractureFixture) : null;

  const occupiedJobSlots=()=>[...jobs.values()].filter(job=>!job.executionReleased).length;
  async function readJobStatus(job:BridgeJob){
    if(job.finalStatus)return structuredClone(job.finalStatus);
    if(job.releaseWork)return structuredClone(await job.releaseWork);
    const status=await job.provider.getStatus(job.submission.providerRunId);
    if(job.finalStatus)return structuredClone(job.finalStatus);
    if(job.releaseWork)return structuredClone(await job.releaseWork);
    if(['succeeded','failed','cancelled'].includes(status.status)&&(!job.executionReleased||status.status!=='succeeded')&&'releaseResources' in job.provider&&typeof job.provider.releaseResources==='function'){
      if(job.cleanupFailure)throw Error('BRIDGE_PROVIDER_CLEANUP_UNCONFIRMED',{cause:job.cleanupFailure});
      const release=job.provider.releaseResources.bind(job.provider);
      job.releaseWork=Promise.resolve().then(async()=>{try{
        const released=await release(job.submission.providerRunId);
        if(released.providerRunId!==job.submission.providerRunId||!['succeeded','failed','cancelled'].includes(released.status))throw Error('BRIDGE_PROVIDER_CLEANUP_UNCONFIRMED');
        if(released.status!=='succeeded')job.finalStatus=structuredClone(released);
        job.executionReleased=true;
        return structuredClone(released);
      }catch(error){job.cleanupFailure=error;throw Error('BRIDGE_PROVIDER_CLEANUP_UNCONFIRMED',{cause:error});}});
      const work=job.releaseWork;
      try{return structuredClone(await work);}finally{if(job.releaseWork===work)job.releaseWork=undefined;}
    }
    return status;
  }
  function revoke() {
    if(revocation)return revocation;
    privateApprovals?.revoke();
    fractureJobs?.revoke();
    session = null;
    developmentResults.clear();
    approvalController?.abort();
    approvals.clear();
    for(const job of jobs.values())job.portableExport?.cancel();
    return revocation=Promise.resolve().then(async()=>{
      // Reuse the existing 30-second administrative/request bound for the WHOLE
      // drain, not a new native execution budget or one timeout per job.
      const deadline=Date.now()+30000;
      const drain=async<T,>(work:Promise<T>,code:string):Promise<T>=>{
        let timer:ReturnType<typeof setTimeout>|undefined;
        try{return await Promise.race([work,new Promise<never>((_,reject)=>{
          timer=setTimeout(()=>reject(Error(code)),Math.max(1,deadline-Date.now()));
        })]);}finally{clearTimeout(timer);}
      };
      // A submit already admitted before revocation may return a native job
      // later. Its own late-session check must finish cancelling it first.
      if(pendingSubmission)await drain(pendingSubmission,'BRIDGE_SUBMISSION_SHUTDOWN_UNCONFIRMED');
      const failures:unknown[]=[];
      await Promise.all([...jobs.entries()].map(async([id,job])=>{
        if(job.releaseWork){try{await drain(job.releaseWork,'BRIDGE_PROVIDER_CLEANUP_UNCONFIRMED');}catch(error){failures.push(job.cleanupFailure??error);return;}}
        if(job.executionReleased){jobs.delete(id);return;}
        if(job.cleanupFailure){failures.push(job.cleanupFailure);return;}
        try{await drain(job.provider.cancel(job.submission.providerRunId),'BRIDGE_PROVIDER_CLEANUP_UNCONFIRMED');jobs.delete(id);}
        catch(error){job.cleanupFailure=error;failures.push(error);}
      }));
      if(failures.length)throw new AggregateError(failures,'BRIDGE_PROVIDER_CLEANUP_UNCONFIRMED',{cause:failures[0]});
    });
  }
  const server = createServer(async (req, res) => {
    try {
      if (stopping || req.socket.remoteAddress !== '127.0.0.1' || req.headers.host !== authority
        || req.headers.origin !== origin) return reply(res, 403, { error: 'BRIDGE_ORIGIN_DENIED' });
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (req.method === 'OPTIONS') {
        const method = req.headers['access-control-request-method'];
        const headers = String(req.headers['access-control-request-headers'] ?? '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
        if (!['GET', 'POST', 'DELETE'].includes(String(method)) || headers.some(x => !['authorization', 'content-type','x-tunacad-simulation-workspace','x-tunacad-simulation-client'].includes(x))) return reply(res, 403, { error: 'BRIDGE_PREFLIGHT_DENIED' });
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-TunaCAD-Simulation-Workspace, X-TunaCAD-Simulation-Client');
        if (req.headers['access-control-request-private-network'] === 'true') res.setHeader('Access-Control-Allow-Private-Network', 'true');
        return reply(res, 204, null);
      }
      if (req.method === 'GET' && req.url === '/v1/discovery') return reply(res, 200, { protocolVersion: SIMULATION_BRIDGE_VERSION, pairingRequired: true });
      if (req.method === 'POST' && req.url === '/v1/pair') {
        if(development&&now()>=development.expiresAt)return reply(res,403,{error:'BRIDGE_DEVELOPMENT_SCOPE_EXPIRED'});
        if (++pairingAttempts > 5 || session || !pairingCode || now() > pairingExpiresAt) return reply(res, 403, { error: 'BRIDGE_PAIRING_UNAVAILABLE' });
        const body = z.object({ challenge: z.string().regex(/^[a-f0-9]{64}$/), proof: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(await readJson(req, 1024));
        // Another pairing request may have completed while this body was arriving.
        if (session || !pairingCode || now() > pairingExpiresAt) return reply(res, 403, { error: 'BRIDGE_PAIRING_UNAVAILABLE' });
        const expected = createHmac('sha256', pairingCode).update(`client:${body.challenge}`).digest('hex');
        if (!secretEquals(body.proof, expected)) return reply(res, 403, { error: 'BRIDGE_PAIRING_DENIED' });
        session = { key: token(), expiresAt: now()+SESSION_MS };
        const serverProof = createHmac('sha256', pairingCode).update(`server:${body.challenge}:${session.key}`).digest('hex');
        pairingCode = '';
        return reply(res, 200, { sessionToken: session.key, expiresAt: session.expiresAt, serverProof });
      }
      if (!session || !options.trustedSimulationSession&&session.expiresAt <= now() || !secretEquals(String(req.headers.authorization ?? ''), `Bearer ${session.key}`)) return reply(res, 401, { error: 'BRIDGE_SESSION_REQUIRED' });
      if(options.trustedSimulationSession){await options.trustedSimulationSession.verifyContext({deviceId:options.trustedSimulationSession.deviceId,origin,workspaceId:String(req.headers['x-tunacad-simulation-workspace']??''),clientId:String(req.headers['x-tunacad-simulation-client']??'')});session.expiresAt=now()+SESSION_MS;}
      const authenticatedSession = session;
      if(req.method==='POST'&&req.url==='/v1/simulation-session/check'){if(!options.trustedSimulationSession)return reply(res,200,{allowed:false});const request=await readJson(req,256*1024);await options.trustedSimulationSession.check({deviceId:options.trustedSimulationSession.deviceId,origin,workspaceId:String(req.headers['x-tunacad-simulation-workspace']??''),clientId:String(req.headers['x-tunacad-simulation-client']??'')},request);return reply(res,200,{allowed:true});}
      if(development){
        if(now()>=development.expiresAt)return reply(res,403,{error:'BRIDGE_DEVELOPMENT_SCOPE_EXPIRED'});
        const match=/^\/v1\/development\/completions\/(explicit|electrostatic)$/.exec(req.url??'');
        if(req.method==='GET'&&match){
          const record=developmentResults.get(match[1]);
          if(!record||record.session!==privateSessionIdentity())return reply(res,403,{error:'BRIDGE_DEVELOPMENT_COMPLETION_UNAVAILABLE'});
          return reply(res,200,{scope:'isolated_development_batch',productionOwnerAuthorization:false,result:record.result});
        }
        // Capabilities and session revocation remain available. All production
        // execution/configuration/approval/result routes stay closed.
        if(req.url!=='/v1/capabilities'&&!(req.method==='DELETE'&&req.url==='/v1/session'))
          return reply(res,403,{error:'BRIDGE_DEVELOPMENT_READ_ONLY'});
      }
      // One human terminal question at a time; default-private-disabled public
      // behavior is unchanged. DELETE/session still revokes the pending gate.
      if(privateApprovalPending&&req.method==='POST'&&!/\/cancel$/.test(req.url??''))return reply(res,409,{error:'BRIDGE_BUSY'});
      // New normalized result delivery is declared in the approved request.
      // Old jobs/history never acquire this permission through a result read.
      const projectMatch=/^\/v1\/jobs\/([A-Za-z0-9_.:-]{1,160})\/project-result$/.exec(req.url??'');
      if(req.method==='GET'&&projectMatch){
        const explicitJob=jobs.get(projectMatch[1]),explicitSource=explicitJob?.newExplicitSource;
        if(explicitSource){
          if(!NEW_EXPLICIT_PROJECT_RESULT_CAPTURE_ENABLED)return reply(res,403,{error:'BRIDGE_PROJECT_RESULT_CAPTURE_DISABLED'});
          if(explicitSource.request.resultDelivery!=='project_archive'||explicitSource.ownerSession!==privateSessionIdentity()||explicitJob!.provider!==providerExplicit)throw Error('BRIDGE_PROJECT_RESULT_NEW_APPROVED_JOB_REQUIRED');
          if(stopping||explicitJob!.archived)throw Error('BRIDGE_PROJECT_RESULT_NEW_APPROVED_JOB_REQUIRED');
          if(projectDeliveryPending)return reply(res,409,{error:'BRIDGE_PROJECT_RESULT_BUSY'});
          const cancelled=new AbortController(),abort=()=>cancelled.abort(Error('PROJECT_RESULT_REQUEST_CLOSED'));
          req.once('aborted',abort);res.once('close',abort);projectDeliveryPending=true;
          try{
          const result=await providerExplicit!.getResult(explicitJob!.submission.providerRunId);if(!result)throw Error('BRIDGE_RESULT_NOT_READY');
          const request=explicitSource.request,counts=providerExplicit!.readMeshCounts(explicitJob!.submission.providerRunId);
          const snapshot=await collectCurrentProjectCompletion(request,{signal:AbortSignal.any([cancelled.signal,AbortSignal.timeout(30000)]),assertCurrent(){if(stopping||jobs.get(explicitJob!.submission.providerRunId)!==explicitJob||explicitSource.ownerSession!==privateSessionIdentity())throw Error('BRIDGE_PROJECT_RESULT_NEW_APPROVED_JOB_REQUIRED');},async readCompletion(){return {origin:{revision:request.model.projectRevision,requestDigest:request.requestDigest,geometryDigest:request.model.geometryDigest,meshDigest:result.meshDigest,materialDigest:result.materialDigest,providerId:result.provider.id,providerVersion:result.provider.version,runtimeFingerprint:result.provider.runtimeDigest,originalResultDigest:result.resultDigest,source:{documentId:explicitSource.document.documentId,bodyId:request.model.bodyId,domainId:request.model.domainId,studyId:request.studyId,runId:explicitJob!.submission.providerRunId,loadingFaceIds:[request.model.loadedFaceId],constraintFaceIds:[request.model.fixedFaceId],simulationInputDigest:request.requestDigest}},data:explicitPortableData(result,{nodes:counts.nodes,elements:counts.elements})};}});
          explicitJob!.deliveredProjectDigest=snapshot.payloadDigest;return reply(res,200,snapshot);
          }finally{projectDeliveryPending=false;req.removeListener('aborted',abort);res.removeListener('close',abort);}
        }
        if(!NEW_PROJECT_RESULT_CAPTURE_ENABLED)return reply(res,403,{error:'BRIDGE_PROJECT_RESULT_CAPTURE_DISABLED'});
        const job=jobs.get(projectMatch[1]),source=job?.newElectricalSource;
        const eligible=()=>!stopping&&job&&source&&source.request.resultDelivery==='project_archive'&&job.provider===providerElectrical&&
          jobs.get(job.submission.providerRunId)===job&&source.ownerSession===privateSessionIdentity()&&(options.trustedSimulationSession||now()-Date.parse(job.submission.acceptedAt)<=20*60_000);
        if(!eligible())return reply(res,403,{error:'BRIDGE_PROJECT_RESULT_NEW_APPROVED_JOB_REQUIRED'});
        if(projectDeliveryPending)return reply(res,409,{error:'BRIDGE_PROJECT_RESULT_BUSY'});
        const current=()=>{if(!eligible())throw Error('BRIDGE_PROJECT_RESULT_NEW_APPROVED_JOB_REQUIRED');};
        current();const cancelled=new AbortController(),abort=()=>cancelled.abort(Error('PROJECT_RESULT_REQUEST_CLOSED'));
        req.once('aborted',abort);res.once('close',abort);
        const signal=AbortSignal.any([cancelled.signal,AbortSignal.timeout(30000)]);
        projectDeliveryPending=true;
        try{
          const result=await collectCurrentProjectCompletion(source!.request,{signal,assertCurrent:current,async readCompletion(){
            const completion=await readNewElectricalCompletion(job!.provider as ElectrostaticDispatchProvider,job!.submission.providerRunId,source!.request,source!.document,signal);
            current();await assertNewElectricalCompletionCurrent(job!.provider as ElectrostaticDispatchProvider,job!.submission.providerRunId,source!.request,source!.document,completion,signal);
            return completion;
          }});
          job!.deliveredProjectDigest=result.payloadDigest;
          return reply(res,200,result);
        }finally{projectDeliveryPending=false;req.removeListener('aborted',abort);res.removeListener('close',abort);}
      }
      const archiveMatch=/^\/v1\/jobs\/([A-Za-z0-9_-]{1,160})\/project-saved$/.exec(req.url??'');
      if(req.method==='POST'&&archiveMatch){
        if(!(jobs.get(archiveMatch[1])?.newExplicitSource?NEW_EXPLICIT_PROJECT_RESULT_CAPTURE_ENABLED:NEW_PROJECT_RESULT_CAPTURE_ENABLED)||!options.trustedSimulationSession)return reply(res,403,{error:'BRIDGE_PROJECT_RESULT_CAPTURE_DISABLED'});
        const body=z.object({payloadDigest:z.string().regex(/^sha256:[a-f0-9]{64}$/)}).strict().parse(await readJson(req,256));
        const job=jobs.get(archiveMatch[1]);
        if(!job?.deliveredProjectDigest||body.payloadDigest!==job.deliveredProjectDigest||(job.newExplicitSource??job.newElectricalSource)?.ownerSession!==privateSessionIdentity())throw Error('BRIDGE_PROJECT_RESULT_ACK_MISMATCH');
        const status=await readJobStatus(job);if(status.status!=='succeeded'||!job.executionReleased)throw Error('BRIDGE_PROVIDER_CLEANUP_UNCONFIRMED');
        if('acknowledgeSavedProject' in job.provider&&typeof job.provider.acknowledgeSavedProject==='function')await job.provider.acknowledgeSavedProject(job.submission.providerRunId);
        job.archived=true;job.finalStatus=structuredClone(status);
        return reply(res,200,{saved:true});
      }
      const portableMatch=/^\/v1\/jobs\/([A-Za-z0-9_.:-]{1,160})\/portable-export$/.exec(req.url??'');
      if(req.method==='POST'&&portableMatch){
        // Reject before storage, provider, approval callback or signing access.
        if(!NATIVE_PORTABLE_EXPORT_ENABLED||!options.portableResultAuthority)return reply(res,403,{error:'BRIDGE_PORTABLE_EXPORT_DISABLED'});
        const job=jobs.get(portableMatch[1]),captured=job?.newElectricalSource;
        if(!job||!captured||captured.ownerSession!==privateSessionIdentity()||job.provider!==providerElectrical)
          return reply(res,403,{error:'BRIDGE_PORTABLE_EXPORT_NEW_OWNED_COMPLETION_REQUIRED'});
        const body=z.object({kind:z.literal('single_dielectric_fields'),origin:z.unknown()}).strict().parse(await readJson(req,16384));
        const expected=portableResultExportRequest(body.kind,body.origin as any);
        job.portableExport??=createNativeCompletedExport({authority:options.portableResultAuthority,
          async readSession(){return !stopping&&jobs.get(job.submission.providerRunId)===job&&session&&session.expiresAt>now()&&privateSessionIdentity()===captured.ownerSession
            &&now()-Date.parse(job.submission.acceptedAt)<=20*60_000
            ?{identity:privateSessionIdentity()!,expiresAt:session.expiresAt}:null;},now,
          readCompletion:signal=>readNewElectricalCompletion(job.provider as ElectrostaticDispatchProvider,job.submission.providerRunId,captured.request,captured.document,signal),
          assertCurrent:(completion,signal)=>assertNewElectricalCompletionCurrent(job.provider as ElectrostaticDispatchProvider,job.submission.providerRunId,captured.request,captured.document,completion,signal),
          async approve(review,signal){
            if(busy||privateApprovalPending)throw Error('BRIDGE_BUSY');if(++authorizationAttempts>8)throw Error('BRIDGE_AUTHORIZATION_LIMIT');privateApprovalPending=true;
            try{return await options.approve(review,signal);}finally{privateApprovalPending=false;}
          }});
        const aborted=new AbortController(),abort=()=>aborted.abort(Error('PORTABLE_EXPORT_REQUEST_CLOSED'));
        req.once('aborted',abort);res.once('close',abort);
        try{return reply(res,200,await job.portableExport.export({kind:expected.kind,origin:expected.origin},aborted.signal));}
        finally{req.removeListener('aborted',abort);res.removeListener('close',abort);}
      }
      if (req.method === 'DELETE' && req.url === '/v1/session') { if(options.trustedSimulationSession)await options.trustedSimulationSession.revoke();else await revoke();return reply(res,200,{disconnected:true,jobsRetained:Boolean(options.trustedSimulationSession)}); }
      if (req.method === 'GET' && req.url === '/v1/capabilities') return reply(res, 200, readiness);
      if (req.method === 'POST' && req.url === '/v1/providers/browse') {
        if (!options.browseProviderExecutable || submissions > 0) return reply(res, 409, { error: 'BRIDGE_PROVIDER_CONFIGURATION_LOCKED' });
        const body = z.object({ provider: z.enum(['gmsh', 'calculix']) }).strict().parse(await readJson(req, 128));
        const path = await options.browseProviderExecutable(body.provider);
        return reply(res, 200, { provider: body.provider, path });
      }
      if (req.method === 'POST' && ['/v1/providers/test', '/v1/providers/settings'].includes(req.url ?? '')) {
        if ([...approvals.values()].some(a => (isElectrical(a.request)
          || isTwoLayerApproval(a.request)) && ['pending', 'approved'].includes(a.state))) {
          return reply(res, 409, { error: 'BRIDGE_PROVIDER_CONFIGURATION_LOCKED' });
        }
        const saveOnly = req.url === '/v1/providers/settings';
        if (busy || privateApprovalPending || submissions > 0 || (saveOnly ? !options.saveProviderSettings : !options.configureProviders))
          return reply(res, 409, { error: 'BRIDGE_PROVIDER_CONFIGURATION_LOCKED' });
        const paths = providerPathsSchema.parse(await readJson(req, 3_000));
        // Saving is authenticated local configuration only, never a readiness
        // claim, approval, mesh operation or executable/version probe.
        busy=true;
        try{
          if (saveOnly) return reply(res, 200, { saved: true, paths: await options.saveProviderSettings!(paths) });
          const configured = await options.configureProviders!(paths);
          provider = configured.provider;
          providerV2 = configured.providerV2 ?? null;
          providerElectrical = configured.providerElectrical ?? null;
          readiness = { ...configured.readiness, protocolVersion: SIMULATION_BRIDGE_VERSION, limits: readiness.limits };
          return reply(res, 200, readiness);
        }finally{busy=false;}
      }
      if (req.method === 'POST' && req.url === '/v1/two-layer/authorizations') {
        if(options.trustedSimulationSession)return reply(res,403,{error:'SIMULATION_SESSION_UNSUPPORTED_CAPABILITY'});
        if (!readiness.meshing.ready || !readiness.solving.ready)
          return reply(res, 503, { error: 'BRIDGE_PROVIDERS_UNAVAILABLE' });
        const request = twoLayerApprovalSchema.parse(await readJson(req, 8192));
        if (session !== authenticatedSession || authenticatedSession.expiresAt <= now())
          return reply(res, 401, { error: 'BRIDGE_SESSION_REQUIRED' });
        if (++authorizationAttempts > 8) return reply(res, 429, { error: 'BRIDGE_AUTHORIZATION_LIMIT' });
        if (busy || submissions >= 4 || [...approvals.values()].some(a =>
          a.expiresAt > now() && ['pending', 'approved'].includes(a.state)))
          return reply(res, 409, { error: 'BRIDGE_BUSY' });
        const approval: Approval = { id: token(), request, state: 'pending',
          sessionKey: session.key, expiresAt: Math.min(now() + APPROVAL_MS, session.expiresAt) };
        approvalController?.abort(); approvals.clear(); approvals.set(approval.id, approval);
        approvalController = new AbortController();
        const controller = approvalController;
        void options.approve(structuredClone(request),controller.signal).then(approved=>{
          if (!controller.signal.aborted && approval.expiresAt > now())
            approval.state = approved ? 'approved' : 'denied';
        }).catch(() => { approval.state = 'denied'; });
        return reply(res, 202, { authorizationId: approval.id, expiresAt: approval.expiresAt });
      }
      const twoLayerMatch = /^\/v1\/two-layer\/authorizations\/([a-f0-9]{64})(?:\/(consume))?$/.exec(req.url ?? '');
      if (twoLayerMatch) {
        const approval = approvals.get(twoLayerMatch[1]);
        if (!approval || !isTwoLayerApproval(approval.request))
          return reply(res, 404, { error: 'BRIDGE_NOT_FOUND' });
        if (approval.sessionKey !== session.key || approval.expiresAt <= now())
          return reply(res, 403, { error: 'BRIDGE_AUTHORIZATION_EXPIRED' });
        if (req.method === 'GET' && !twoLayerMatch[2])
          return reply(res, 200, { state: approval.state,
            studyId: approval.request.studyId, requestDigest: approval.request.requestDigest });
        if (req.method === 'DELETE' && !twoLayerMatch[2]) {
          if (approval.state !== 'used') { approval.state = 'denied'; approvalController?.abort(); }
          return reply(res, 200, { state: approval.state });
        }
        if (req.method === 'POST' && twoLayerMatch[2] === 'consume') {
          if (approval.state !== 'approved')
            return reply(res, 403, { error: 'BRIDGE_TRANSFER_NOT_APPROVED' });
          const bound = twoLayerApprovalSchema.parse(await readJson(req, 8192));
          // Body I/O is asynchronous: session revocation, expiry, grant revocation
          // and a competing consume may have happened since the initial check.
          if (session !== authenticatedSession || authenticatedSession.expiresAt <= now()
            || approvals.get(approval.id) !== approval
            || approval.sessionKey !== authenticatedSession.key || approval.expiresAt <= now())
            return reply(res, 403, { error: 'BRIDGE_AUTHORIZATION_EXPIRED' });
          if (approval.state !== 'approved')
            return reply(res, 403, { error: 'BRIDGE_TRANSFER_NOT_APPROVED' });
          if (digest(bound) !== digest(approval.request))
            return reply(res, 403, { error: 'BRIDGE_TWO_LAYER_BINDING_MISMATCH' });
          approval.state = 'used';
          return reply(res, 200, { state: 'used', studyId: bound.studyId,
            requestDigest: bound.requestDigest });
        }
      }
      if (req.method === 'POST' && req.url === '/v1/authorizations') {
        const raw = await readJson(req, 256 * 1024);
        const explicitEnvelope=raw?.schema==='tunacad-explicit-authorization/1'?z.object({schema:z.literal('tunacad-explicit-authorization/1'),preparationId:z.string().regex(/^simprep_private-[a-f0-9-]{36}$/),request:z.unknown()}).strict().parse(raw):null;
        if(explicitEnvelope&&!options.trustedSimulationSession)return reply(res,403,{error:'BRIDGE_TRUSTED_SIMULATION_SESSION_REQUIRED'});
        const electricalEnvelope = raw?.schema === 'tunacad-electrostatic-authorization/0.1'
          ? z.object({ schema: z.literal('tunacad-electrostatic-authorization/0.1'),
            preparationId: z.string().regex(/^simprep_electrical-[a-f0-9-]{36}$/),
            request: z.unknown() }).strict().parse(raw) : null;
        const request = explicitEnvelope?validateExplicitDynamics(explicitEnvelope.request):electricalEnvelope ? validateElectrostaticFoundation(electricalEnvelope.request)
          : validateRequestEnvelope(raw, now());
        const v2Request = isV2Request(request);
        const requestProvider = isExplicit(request)?providerExplicit:isElectrical(request) ? providerElectrical : v2Request ? providerV2 : provider;
        if (!requestProvider || (isExplicit(request)?!readiness.explicit:isElectrical(request) ? !readiness.electrostatic : v2Request ? !readiness.providerV2 : !readiness.ready)) return reply(res, 503, { error: 'BRIDGE_PROVIDERS_UNAVAILABLE' });
        if (v2Request) {
          const admission = admitV2SimulationRequest(request, providerV2!.capabilities);
          if (!admission.accepted) throw new Error('BRIDGE_PROVIDER_CAPABILITY_MISMATCH');
        }
        if (!session || session.expiresAt <= now()) return reply(res, 401, { error: 'BRIDGE_SESSION_REQUIRED' });
        if (!options.trustedSimulationSession && ++authorizationAttempts > 8) return reply(res, 429, { error: 'BRIDGE_AUTHORIZATION_LIMIT' });
        if (busy || !options.trustedSimulationSession&&!isElectrical(request)&&submissions >= 4 || [...approvals.values()].some(a => a.expiresAt > now() && (a.state === 'pending' || a.state === 'approved'))) return reply(res, 409, { error: 'BRIDGE_BUSY' });
        busy = true;
        try {
        if (jobs.size) {
          const states = await Promise.all([...jobs.values()].map(readJobStatus));
          if (states.some(state => ['running', 'queued'].includes(state.status))) return reply(res, 409, { error: 'BRIDGE_BUSY' });
        }
        if(isElectrical(request)&&occupiedJobSlots()>=4)return reply(res,409,{error:'BRIDGE_BUSY'});
        if (!session || session.expiresAt <= now()) return reply(res, 401, { error: 'BRIDGE_SESSION_REQUIRED' });
        const approval: Approval = { id: token(), request, state: 'pending',
          preparationId: explicitEnvelope?.preparationId??electricalEnvelope?.preparationId,
          expiresAt: Math.min(now() + APPROVAL_MS, isElectrical(request)||isExplicit(request) ? now() + APPROVAL_MS : Date.parse(request.expiresAt)) };
        approvalController?.abort();
        approvals.clear(); approvals.set(approval.id, approval);
        approvalController = new AbortController();
        const controller = approvalController;
        const trusted=options.trustedSimulationSession;
        if(trusted)approval.clientId=String(req.headers['x-tunacad-simulation-client']??'');
        const decision=trusted?trusted.admit({deviceId:trusted.deviceId,origin,workspaceId:String(req.headers['x-tunacad-simulation-workspace']??''),clientId:String(req.headers['x-tunacad-simulation-client']??'')},request).then(()=>true):options.approve(structuredClone(request),controller.signal);
        void decision.then(approved => {
          if (!controller.signal.aborted && approval.expiresAt > now()) approval.state = approved ? 'approved' : 'denied';
        }).catch(() => { approval.state = 'denied'; });
        return reply(res, 202, { authorizationId: approval.id, expiresAt: approval.expiresAt });
        } finally { busy = false; }
      }
      const approvalMatch = /^\/v1\/authorizations\/([a-f0-9]{64})$/.exec(req.url ?? '');
      if (req.method === 'DELETE' && approvalMatch) {
        const approval = approvals.get(approvalMatch[1]);
        if (!approval || isTwoLayerApproval(approval.request) || isFractureOperation(approval.request))
          return reply(res, 404, { error: 'BRIDGE_NOT_FOUND' });
        if (isElectrical(approval.request)&&!(options.trustedSimulationSession&&approval.submission)) {
          approval.revoked = true;
          if (approval.submission && approval.provider) await approval.provider.cancel(approval.submission.providerRunId);
        }
        if (approval.state !== 'used') { approval.state = 'denied'; approvalController?.abort(); }
        return reply(res, 200, { state: approval.state });
      }
      if (req.method === 'GET' && approvalMatch) {
        const approval = approvals.get(approvalMatch[1]);
        if (!approval || isTwoLayerApproval(approval.request) || isFractureOperation(approval.request))
          return reply(res, 404, { error: 'BRIDGE_NOT_FOUND' });
        return reply(res, 200, { state: approval.expiresAt <= now() ? 'expired' : approval.state,
          ...((isElectrical(approval.request)||isExplicit(approval.request)) ? { preparationId: approval.preparationId,
            requestDigest: approval.request.requestDigest, projectRevision: approval.request.model.projectRevision,
            canonicalSourceDigest: isExplicit(approval.request)?approval.request.model.geometryDigest:approval.request.model.domains[0].geometryDigest } : {}) });
      }
      if(req.method==='GET'&&req.url==='/v1/jobs'){
        if(!options.trustedSimulationSession)return reply(res,404,{error:'BRIDGE_NOT_FOUND'});
        const owned=[];
        for(const job of jobs.values())if(job.request)owned.push({submission:job.submission,request:job.request,preparationId:job.preparationId,
          status:await readJobStatus(job),archived:job.archived===true,sourceDocument:job.newExplicitSource?.document??job.newElectricalSource?.document});
        return reply(res,200,{workspaceId:options.trustedSimulationSession.scope.workspaceId,jobs:owned});
      }
      if (req.method === 'POST' && req.url === '/v1/jobs') {
        if (busy) return reply(res, 409, { error: 'BRIDGE_BUSY' });
        busy = true;
        let finishSubmission!:()=>void;
        const work=new Promise<void>(resolve=>{finishSubmission=resolve;});pendingSubmission=work;
        try {
          // Authorization is consumed before body ingestion; unapproved geometry is never read.
          const permitted = [...approvals.values()].find(a => !isTwoLayerApproval(a.request) && !isFractureOperation(a.request)
            && a.state === 'approved' && a.expiresAt > now() && (!options.trustedSimulationSession||a.clientId===String(req.headers['x-tunacad-simulation-client']??'')));
          if (!permitted) return reply(res, 403, { error: 'BRIDGE_TRANSFER_NOT_APPROVED' });
          if(isElectrical(permitted.request)?occupiedJobSlots()>=4:!options.trustedSimulationSession&&submissions>=4)return reply(res,409,{error:'BRIDGE_BUSY'});
          if (isTwoLayerApproval(permitted.request) || isFractureOperation(permitted.request))
            return reply(res, 403, { error: 'BRIDGE_TRANSFER_NOT_APPROVED' });
          permitted.state = 'used';
          if (!session || session.expiresAt <= now() || permitted.expiresAt <= now()) throw new Error('BRIDGE_AUTHORIZATION_EXPIRED');
          if(options.trustedSimulationSession)await options.trustedSimulationSession.check({deviceId:options.trustedSimulationSession.deviceId,origin,workspaceId:String(req.headers['x-tunacad-simulation-workspace']??''),clientId:String(req.headers['x-tunacad-simulation-client']??'')},permitted.request);
          const rawBody = await readJson(req, Math.ceil(MAX_TOTAL_STEP / 3) * 4 + 16 * 1024);
          let selectedProvider: AnyProvider;
          if(options.trustedSimulationSession)await options.trustedSimulationSession.check({deviceId:options.trustedSimulationSession.deviceId,origin,workspaceId:String(req.headers['x-tunacad-simulation-workspace']??''),clientId:String(req.headers['x-tunacad-simulation-client']??'')},permitted.request);
          let submission: SimulationProviderSubmission;
          let newElectricalDocument:NewElectricalDocumentBinding|undefined;
          if(isExplicit(permitted.request)){
            if(!providerExplicit||!options.trustedSimulationSession)throw Error('BRIDGE_PROVIDERS_UNAVAILABLE');
            const body=z.object({authorizationId:z.literal(permitted.id),stepBase64:z.string().max(Math.ceil(MAX_STEP/3)*4).regex(/^[A-Za-z0-9+/]+={0,2}$/),sourceDocument:z.object({documentId:z.string().min(1).max(160),revision:z.string().min(1).max(160),bodyId:z.string().min(1).max(160)}).strict()}).strict().parse(rawBody);
            if(body.sourceDocument.documentId!==options.trustedSimulationSession.scope.workspaceId||body.sourceDocument.revision!==permitted.request.model.projectRevision||body.sourceDocument.bodyId!==permitted.request.model.bodyId)throw Error('BRIDGE_EXPLICIT_SOURCE_MISMATCH');
            const bytes=decodeStep(body.stepBase64);if(await electrostaticStepGeometryDigest(bytes)!==permitted.request.model.geometryDigest)throw Error('BRIDGE_EXPLICIT_SOURCE_MISMATCH');
            await options.trustedSimulationSession.check({deviceId:options.trustedSimulationSession.deviceId,origin,workspaceId:String(req.headers['x-tunacad-simulation-workspace']??''),clientId:String(req.headers['x-tunacad-simulation-client']??'')},permitted.request);
            newElectricalDocument=body.sourceDocument;selectedProvider=providerExplicit;submission=await providerExplicit.submit(permitted.request,bytes);
          }else if (isElectrical(permitted.request)) {
            if (!providerElectrical || !permitted.preparationId) throw new Error('BRIDGE_PROVIDERS_UNAVAILABLE');
            const body = z.object({ authorizationId: z.literal(permitted.id),
              stepBase64: z.string().max(Math.ceil(MAX_STEP / 3) * 4).regex(/^[A-Za-z0-9+/]+={0,2}$/),
              sourceDocument:z.object({documentId:z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/),revision:z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/),bodyId:z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/)}).strict().optional(),
            }).strict().parse(rawBody);
            if(body.sourceDocument){if(options.trustedSimulationSession&&body.sourceDocument.documentId!==options.trustedSimulationSession.scope.workspaceId)throw Error('BRIDGE_ELECTROSTATIC_SOURCE_MISMATCH');if(body.sourceDocument.revision!==permitted.request.model.projectRevision||body.sourceDocument.bodyId!==permitted.request.model.domains[0].bodyId)
              throw Error('BRIDGE_ELECTROSTATIC_SOURCE_MISMATCH');newElectricalDocument=body.sourceDocument;}
            const bytes = decodeStep(body.stepBase64);
            if (await electrostaticStepGeometryDigest(bytes) !== permitted.request.model.domains[0].geometryDigest) {
              throw new Error('BRIDGE_ELECTROSTATIC_SOURCE_MISMATCH');
            }
            if (permitted.revoked || !session || session.expiresAt <= now()
              || permitted.expiresAt <= now() || stopping) throw new Error('BRIDGE_AUTHORIZATION_EXPIRED');
            selectedProvider = providerElectrical;
            if(options.trustedSimulationSession)await options.trustedSimulationSession.check({deviceId:options.trustedSimulationSession.deviceId,origin,workspaceId:String(req.headers['x-tunacad-simulation-workspace']??''),clientId:String(req.headers['x-tunacad-simulation-client']??'')},permitted.request);
            submission = await providerElectrical.submit(permitted.request, bytes, {
              preparationId: permitted.preparationId, authorizationId: permitted.id });
          } else if (isV2Request(permitted.request)) {
            if (!providerV2) throw new Error('BRIDGE_PROVIDERS_UNAVAILABLE');
            const encodedLimit = Math.ceil(MAX_STEP / 3) * 4;
            const body = z.object({
              authorizationId: z.literal(permitted.id),
              stepDomains: z.array(z.object({
                domainId: z.string().min(1).max(160),
                stepBase64: z.string().max(encodedLimit).regex(/^[A-Za-z0-9+/]+={0,2}$/),
              }).strict()).min(1).max(MAX_DOMAINS),
            }).strict().parse(rawBody);
            const expectedDomainIds = permitted.request.model.domains.map(domain => domain.domainId);
            if (new Set(body.stepDomains.map(domain => domain.domainId)).size !== body.stepDomains.length
              || body.stepDomains.length !== expectedDomainIds.length
              || body.stepDomains.some((domain, index) => domain.domainId !== expectedDomainIds[index])) {
              throw new Error('BRIDGE_DOMAIN_SET_MISMATCH');
            }
            const domainBytes = new Map(body.stepDomains.map(domain => [domain.domainId, decodeStep(domain.stepBase64)]));
            if ([...domainBytes.values()].reduce((total, bytes) => total + bytes.byteLength, 0) > MAX_TOTAL_STEP) {
              throw new Error('BRIDGE_PAYLOAD_TOO_LARGE');
            }
            selectedProvider = providerV2;
            if(options.trustedSimulationSession)await options.trustedSimulationSession.check({deviceId:options.trustedSimulationSession.deviceId,origin,workspaceId:String(req.headers['x-tunacad-simulation-workspace']??''),clientId:String(req.headers['x-tunacad-simulation-client']??'')},permitted.request);
            submission = await providerV2.submit(permitted.request, {
              descriptor: permitted.request.model,
              async exportDomain(domainId, format) {
                if (format !== 'step') throw new Error('BRIDGE_FORMAT_UNSUPPORTED');
                const bytes = domainBytes.get(domainId);
                if (!bytes) throw new Error('BRIDGE_DOMAIN_SET_MISMATCH');
                return new Uint8Array(bytes);
              },
            });
          } else {
            if (!provider) throw new Error('BRIDGE_PROVIDERS_UNAVAILABLE');
            const body = z.object({
              authorizationId: z.literal(permitted.id),
              stepBase64: z.string().max(Math.ceil(MAX_STEP / 3) * 4).regex(/^[A-Za-z0-9+/]+={0,2}$/),
            }).strict().parse(rawBody);
            const bytes = decodeStep(body.stepBase64);
            selectedProvider = provider;
            if(options.trustedSimulationSession)await options.trustedSimulationSession.check({deviceId:options.trustedSimulationSession.deviceId,origin,workspaceId:String(req.headers['x-tunacad-simulation-workspace']??''),clientId:String(req.headers['x-tunacad-simulation-client']??'')},permitted.request);
            submission = await provider.submit(permitted.request, {
              descriptor: permitted.request.geometry,
              async export(format) {
                if (format !== 'step') throw new Error('BRIDGE_FORMAT_UNSUPPORTED');
                return new Uint8Array(bytes);
              },
            });
          }
          submissions++;
          permitted.submission = submission; permitted.provider = selectedProvider;
          if (permitted.revoked || !session || session.expiresAt <= now() || stopping) {
            try{await selectedProvider.cancel(submission.providerRunId);}
            catch(error){jobs.set(submission.providerRunId,{submission,provider:selectedProvider,cleanupFailure:error});throw error;}
            throw new Error('BRIDGE_SESSION_REQUIRED');
          }
          jobs.set(submission.providerRunId, { submission, provider: selectedProvider,request:structuredClone(permitted.request),preparationId:permitted.preparationId,
            ...(isExplicit(permitted.request)&&newElectricalDocument?{newExplicitSource:{document:newElectricalDocument,request:structuredClone(permitted.request),ownerSession:privateSessionIdentity()!}}:{}),
            ...(isElectrical(permitted.request)&&newElectricalDocument?{newElectricalSource:{document:newElectricalDocument,request:structuredClone(permitted.request),ownerSession:privateSessionIdentity()!}}:{}) });
          return reply(res, 202, submission);
        } finally { busy = false;finishSubmission();if(pendingSubmission===work)pendingSubmission=null; }
      }
      const fieldUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
      const fieldMatch = /^\/v1\/jobs\/([A-Za-z0-9_-]{1,160})\/fields$/.exec(fieldUrl.pathname);
      if (req.method === 'GET' && fieldMatch && jobs.has(fieldMatch[1])) {
        const job = jobs.get(fieldMatch[1])!;
        if (!('getFieldDataset' in job.provider)) return reply(res, 404, { error: 'BRIDGE_FIELD_DATASET_UNSUPPORTED' });
        if ([...fieldUrl.searchParams.keys()].some(key => !['datasetId', 'cursor', 'limit'].includes(key))) throw new Error('BRIDGE_REQUEST_INVALID');
        const query = z.object({
          datasetId: z.string().min(1).max(500).regex(/^[A-Za-z0-9_.:-]+$/),
          cursor: z.string().regex(/^\d{1,10}$/).default('0'),
          limit: z.coerce.number().int().min(1).max(128).default(128),
        }).strict().parse(Object.fromEntries(fieldUrl.searchParams));
        const rawPage = await job.provider.getFieldDataset(fieldMatch[1], query.datasetId, query.cursor, query.limit);
        const page = rawPage.dataset.analysisType === 'electrostatic'
          ? await validateElectricalPage(rawPage, rawPage.dataset, query.cursor, query.limit)
          : validateNeutralSimulationFieldPageV2(rawPage);
        if (page.dataset.jobId !== fieldMatch[1]) throw new Error('BRIDGE_FIELD_DATASET_IDENTITY_INVALID');
        return reply(res, 200, page);
      }
      const jobMatch = /^\/v1\/jobs\/([A-Za-z0-9_-]{1,160})\/(status|result|cancel)$/.exec(req.url ?? '');
      if (jobMatch && jobs.has(jobMatch[1])) {
        const [, id, operation] = jobMatch;
        const job = jobs.get(id)!;
        if (!options.trustedSimulationSession && now() - Date.parse(job.submission.acceptedAt) > 20 * 60_000) {
          job.portableExport?.cancel();
          // Expiry revokes access, not ownership of an unconfirmed writer.
          try{if(job.cleanupFailure)throw job.cleanupFailure;if(!job.executionReleased)await job.provider.cancel(id);jobs.delete(id);}
          catch(error){job.cleanupFailure=error;throw Error('BRIDGE_PROVIDER_CLEANUP_UNCONFIRMED',{cause:error});}
          return reply(res, 410, { error: 'BRIDGE_RESULT_EXPIRED' });
        }
        if (req.method === 'POST' && operation === 'cancel'){
          job.portableExport?.cancel();
          if(job.finalStatus)return reply(res,200,structuredClone(job.finalStatus));
          const cancelled=await job.provider.cancel(id);
          return reply(res,200,'releaseResources' in job.provider?await readJobStatus(job):cancelled);
        }
        if (req.method === 'GET' && operation === 'status') {
          const status = await readJobStatus(job);
          if (status.failure) status.failure.message = 'The local simulation failed. Review the Bridge terminal or provider diagnostics locally.';
          return reply(res, 200, status);
        }
        if(providerExplicit&&job.provider===providerExplicit&&req.method==='GET'&&operation==='result'){if(job.archived||(job.finalStatus&&job.finalStatus.status!=='succeeded'))return reply(res,200,{result:null,mesh:null});const result=await providerExplicit.getResult(id);return reply(res,200,{result,mesh:result?providerExplicit.readMeshCounts(id):null});}
        if(job.archived&&req.method==='GET'&&operation==='result')return reply(res,200,null);
        if (req.method === 'GET' && operation === 'result') return reply(res, 200, job.finalStatus&&job.finalStatus.status!=='succeeded'?null:await job.provider.getResult(id));
      }
      return reply(res, 404, { error: 'BRIDGE_NOT_FOUND' });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if(message.startsWith('SIMULATION_SESSION_'))return reply(res,403,{error:message});
      reply(res, 400, { error: /^BRIDGE_[A-Z_]+$/.test(message) ? message : 'BRIDGE_REQUEST_INVALID' });
    }
  });
  server.requestTimeout = 30_000; server.headersTimeout = 10_000; server.maxHeadersCount = 24;
  server.maxConnections = 16;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 48731, '127.0.0.1', resolve); });
  authority = `127.0.0.1:${(server.address() as { port: number }).port}`;
  let maintaining=false;
  const maintenance = setInterval(() => {
    // Scratch cleanup continues while the browser/client is disconnected.
    if(options.trustedSimulationSession&&!maintaining){maintaining=true;void Promise.all([...jobs.values()].filter(j=>!j.executionReleased&&!j.cleanupFailure).map(j=>readJobStatus(j).catch(()=>undefined))).finally(()=>{maintaining=false;});}
    fractureJobs?.expire();
    if (session && ((!options.trustedSimulationSession&&session.expiresAt <= now())||development&&now()>=development.expiresAt)) void revoke().catch(()=>{}); // close() still observes the same failure
    for (const approval of approvals.values()) if (approval.expiresAt <= now() && ['pending', 'approved'].includes(approval.state)) {
      approval.state = 'denied'; approvalController?.abort();
    }
  }, 1000);
  maintenance.unref();
  return { url: `http://${authority}`, pairingCode,privateApprovals,fractureJobs,
    /** In-process fresh producer only: never an HTTP publish/import endpoint.
     * Development CLI authorization is not represented as human consent. */
    publishDevelopmentCompletion:development?async(id:'explicit'|'electrostatic',completion:ProjectResultCompletion,
      request:{requestDigest:string;resultDelivery?:'project_archive'})=>{
      const identity=privateSessionIdentity();
      if(stopping||!identity||now()>=development.expiresAt)throw Error('BRIDGE_DEVELOPMENT_SESSION_REQUIRED');
      if(!['explicit','electrostatic'].includes(id)||developmentResults.has(id)||developmentResults.size>=2)
        throw Error('BRIDGE_DEVELOPMENT_COMPLETION_LIMIT');
      if(completion.data.kind!==(id==='explicit'?'explicit_recorded_face_history':'single_dielectric_fields'))throw Error('BRIDGE_DEVELOPMENT_KIND_MISMATCH');
      const result=await collectCurrentProjectCompletion(request,{
        signal:AbortSignal.timeout(Math.max(1,development.expiresAt-now())),
        assertCurrent(){if(stopping||identity!==privateSessionIdentity()||now()>=development.expiresAt)throw Error('BRIDGE_DEVELOPMENT_SESSION_REQUIRED');},
        async readCompletion(){return completion;},
      });
      if(Buffer.byteLength(JSON.stringify(result))>32*1024**2)throw Error('BRIDGE_DEVELOPMENT_RESULT_BOUND');
      if(stopping||identity!==privateSessionIdentity()||now()>=development.expiresAt)throw Error('BRIDGE_DEVELOPMENT_SESSION_REQUIRED');
      if(developmentResults.has(id))throw Error('BRIDGE_DEVELOPMENT_COMPLETION_LIMIT');
      developmentResults.set(id,{session:identity,result});
      return result.payloadDigest;
    }:undefined,
    // Trusted local attachment only; no token export or HTTP registration.
    authenticateFractureWindow(operation:string,body:unknown,proof:{challenge:string;proof:string}) {
      if(!fractureJobs)throw Error('BRIDGE_FRACTURE_DISABLED');
      return authenticateFractureWindow(operation,body,proof);
    },
    readFractureSessionIdentity(){return fractureJobs?privateSessionIdentity():null;},
    // Internal owner port only: never exposed through HTTP or discovery.
    readPrivateSessionIdentity() {return privateApprovals?privateSessionIdentity():null;},
    readPrivateSessionMetadata() {return privateApprovals&&session&&session.expiresAt>now()
      ?{identity:digest({pairedSession:session.key}),expiresAt:session.expiresAt}:null;},
    verifyPrivateWindowProof(challenge:string,proof:string) {
      return Boolean(privateApprovals&&session&&session.expiresAt>now()
        &&/^[a-f0-9]{64}$/.test(challenge)&&/^[a-f0-9]{64}$/.test(proof)
        &&timingSafeEqual(new Uint8Array(createHmac('sha256',session.key).update('private-operator:'+challenge).digest()),new Uint8Array(Buffer.from(proof,'hex'))));
    },
    async endTrustedSession(){
      if(!options.trustedSimulationSession)throw Error('SIMULATION_SESSION_REQUIRED');
      await options.trustedSimulationSession.revoke();
      if(pendingSubmission)await pendingSubmission;
      const owned=[...jobs.values()],statuses=await Promise.all(owned.map(j=>readJobStatus(j)));
      return {retainedJobs:owned.filter((job,index)=>(!job.archived&&statuses[index].status==='succeeded')||!job.executionReleased).length};
    },
    close() {if(closing)return closing;stopping=true;clearInterval(maintenance);return closing=Promise.resolve().then(async()=>{
      try{await revoke();}
      finally{server.closeAllConnections();if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));}
    });},
  };
}

function reply(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(status === 204 ? undefined : JSON.stringify(value));
}
function decodeStep(stepBase64: string): Uint8Array {
  const bytes = Buffer.from(stepBase64, 'base64');
  if (bytes.length > MAX_STEP || bytes.length < 128 || bytes.toString('base64') !== stepBase64
    || !bytes.subarray(0, 256).toString().includes('ISO-10303-21')) throw new Error('BRIDGE_STEP_INVALID');
  return new Uint8Array(bytes);
}
async function readJson(req: IncomingMessage, limit: number) {
  if (req.headers['content-type'] !== 'application/json' || req.headers['content-encoding']) throw new Error('BRIDGE_CONTENT_TYPE_INVALID');
  if (Number(req.headers['content-length']) > limit) throw new Error('BRIDGE_PAYLOAD_TOO_LARGE');
  const chunks: Uint8Array[] = []; let count = 0;
  for await (const chunk of req) {
    count += chunk.length;
    if (count > limit) throw new Error('BRIDGE_PAYLOAD_TOO_LARGE');
    chunks.push(new Uint8Array(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
