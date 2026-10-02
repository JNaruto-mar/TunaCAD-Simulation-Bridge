import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import * as z from 'zod/v4';
import type {
  ExternalSimulationProvider,
  ExternalSimulationProviderV2,
  NeutralSimulationRequest,
  NeutralSimulationRequestV2,
  SimulationProviderSubmission,
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
type BridgeRequest = NeutralSimulationRequest | NeutralSimulationRequestV2 | ElectrostaticFoundation;
type AnyProvider = ExternalSimulationProvider | ExternalSimulationProviderV2 | ElectrostaticDispatchProvider;
type Approval = { id: string; request: BridgeRequest | TwoLayerApproval; expiresAt: number; state: 'pending' | 'approved' | 'denied' | 'used';
  preparationId?: string; sessionKey?: string; revoked?: boolean; submission?: SimulationProviderSubmission; provider?: AnyProvider };
type BridgeJob = { submission: SimulationProviderSubmission; provider: AnyProvider };
const isV2Request = (request: BridgeRequest): request is NeutralSimulationRequestV2 => request.schema === 'tunacad-neutral-simulation-request/2.0';
const isElectrical = (request: BridgeRequest | TwoLayerApproval): request is ElectrostaticFoundation => request.schema === 'tunacad-electrostatic-foundation/0.1';
const isTwoLayerApproval = (request: BridgeRequest | TwoLayerApproval): request is TwoLayerApproval =>
  request.schema === 'tunacad-electrostatic-two-layer-approval/0.1';

/** Local host API only. Provider configuration accepts two executable paths
 * behind an authenticated session; execution arguments remain fixed in host adapters. */
export async function startSimulationBridge(options: {
  provider: ExternalSimulationProvider | null;
  providerV2?: ExternalSimulationProviderV2 | null;
  providerElectrical?: ElectrostaticDispatchProvider | null;
  readiness: Omit<SimulationBridgeReadiness, 'protocolVersion' | 'limits'>;
  approve: (request: BridgeRequest | TwoLayerApproval | PrivateExplicitSolveBinding, signal: AbortSignal) => Promise<boolean>;
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
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const origin = options.allowedOrigin ?? 'https://tunacad.com';
  if (origin !== 'https://tunacad.com' && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) throw new Error('Invalid explicit origin');
  let pairingCode = randomBytes(16).toString('hex');
  const pairingExpiresAt = now() + 5 * 60_000;
  let pairingAttempts = 0;
  let session: { key: string; expiresAt: number } | null = null;
  let privateApprovalPending=false;
  const privateApprovals=options.privateExplicitApprovals?createPrivateSimulationApprovals({
    readSession:()=>session&&session.expiresAt>now()?session.key:null,
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
  let authority = '';
  let provider = options.provider;
  let providerV2 = options.providerV2 ?? null;
  let providerElectrical = options.providerElectrical ?? null;
  let readiness: SimulationBridgeReadiness = {
    ...options.readiness, protocolVersion: SIMULATION_BRIDGE_VERSION,
    limits: { maximumStepBytes: MAX_STEP, maximumTotalStepBytes: MAX_TOTAL_STEP, maximumDomains: MAX_DOMAINS, maximumJobs: 4, sessionLifetimeMs: SESSION_MS },
  };

  async function revoke() {
    privateApprovals?.revoke();
    session = null;
    approvalController?.abort();
    approvals.clear();
    await Promise.all([...jobs.values()].map(job => job.provider.cancel(job.submission.providerRunId).catch(() => undefined)));
    jobs.clear();
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
        if (!['GET', 'POST', 'DELETE'].includes(String(method)) || headers.some(x => !['authorization', 'content-type'].includes(x))) return reply(res, 403, { error: 'BRIDGE_PREFLIGHT_DENIED' });
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        if (req.headers['access-control-request-private-network'] === 'true') res.setHeader('Access-Control-Allow-Private-Network', 'true');
        return reply(res, 204, null);
      }
      if (req.method === 'GET' && req.url === '/v1/discovery') return reply(res, 200, { protocolVersion: SIMULATION_BRIDGE_VERSION, pairingRequired: true });
      if (req.method === 'POST' && req.url === '/v1/pair') {
        if (++pairingAttempts > 5 || session || !pairingCode || now() > pairingExpiresAt) return reply(res, 403, { error: 'BRIDGE_PAIRING_UNAVAILABLE' });
        const body = z.object({ challenge: z.string().regex(/^[a-f0-9]{64}$/), proof: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(await readJson(req, 1024));
        // Another pairing request may have completed while this body was arriving.
        if (session || !pairingCode || now() > pairingExpiresAt) return reply(res, 403, { error: 'BRIDGE_PAIRING_UNAVAILABLE' });
        const expected = createHmac('sha256', pairingCode).update(`client:${body.challenge}`).digest('hex');
        if (!secretEquals(body.proof, expected)) return reply(res, 403, { error: 'BRIDGE_PAIRING_DENIED' });
        session = { key: token(), expiresAt: now() + SESSION_MS };
        const serverProof = createHmac('sha256', pairingCode).update(`server:${body.challenge}:${session.key}`).digest('hex');
        pairingCode = '';
        return reply(res, 200, { sessionToken: session.key, expiresAt: session.expiresAt, serverProof });
      }
      if (!session || session.expiresAt <= now() || !secretEquals(String(req.headers.authorization ?? ''), `Bearer ${session.key}`)) return reply(res, 401, { error: 'BRIDGE_SESSION_REQUIRED' });
      // One human terminal question at a time; default-private-disabled public
      // behavior is unchanged. DELETE/session still revokes the pending gate.
      if(privateApprovalPending&&req.method==='POST')return reply(res,409,{error:'BRIDGE_BUSY'});
      if (req.method === 'DELETE' && req.url === '/v1/session') { await revoke(); return reply(res, 200, { disconnected: true }); }
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
        if (submissions > 0 || (saveOnly ? !options.saveProviderSettings : !options.configureProviders))
          return reply(res, 409, { error: 'BRIDGE_PROVIDER_CONFIGURATION_LOCKED' });
        const paths = providerPathsSchema.parse(await readJson(req, 3_000));
        // Saving is authenticated local configuration only, never a readiness
        // claim, approval, mesh operation or executable/version probe.
        if (saveOnly) return reply(res, 200, { saved: true, paths: await options.saveProviderSettings!(paths) });
        const configured = await options.configureProviders!(paths);
        provider = configured.provider;
        providerV2 = configured.providerV2 ?? null;
        providerElectrical = configured.providerElectrical ?? null;
        readiness = { ...configured.readiness, protocolVersion: SIMULATION_BRIDGE_VERSION, limits: readiness.limits };
        return reply(res, 200, readiness);
      }
      if (req.method === 'POST' && req.url === '/v1/two-layer/authorizations') {
        if (!readiness.meshing.ready || !readiness.solving.ready)
          return reply(res, 503, { error: 'BRIDGE_PROVIDERS_UNAVAILABLE' });
        const request = twoLayerApprovalSchema.parse(await readJson(req, 8192));
        if (++authorizationAttempts > 8) return reply(res, 429, { error: 'BRIDGE_AUTHORIZATION_LIMIT' });
        if (busy || submissions >= 4 || [...approvals.values()].some(a =>
          a.expiresAt > now() && ['pending', 'approved'].includes(a.state)))
          return reply(res, 409, { error: 'BRIDGE_BUSY' });
        const approval: Approval = { id: token(), request, state: 'pending',
          sessionKey: session.key, expiresAt: Math.min(now() + APPROVAL_MS, session.expiresAt) };
        approvalController?.abort(); approvals.clear(); approvals.set(approval.id, approval);
        approvalController = new AbortController();
        const controller = approvalController;
        void options.approve(structuredClone(request), controller.signal).then(approved => {
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
          if (digest(bound) !== digest(approval.request))
            return reply(res, 403, { error: 'BRIDGE_TWO_LAYER_BINDING_MISMATCH' });
          approval.state = 'used';
          return reply(res, 200, { state: 'used', studyId: bound.studyId,
            requestDigest: bound.requestDigest });
        }
      }
      if (req.method === 'POST' && req.url === '/v1/authorizations') {
        const raw = await readJson(req, 256 * 1024);
        const electricalEnvelope = raw?.schema === 'tunacad-electrostatic-authorization/0.1'
          ? z.object({ schema: z.literal('tunacad-electrostatic-authorization/0.1'),
            preparationId: z.string().regex(/^simprep_electrical-[a-f0-9-]{36}$/),
            request: z.unknown() }).strict().parse(raw) : null;
        const request = electricalEnvelope ? validateElectrostaticFoundation(electricalEnvelope.request)
          : validateRequestEnvelope(raw, now());
        const v2Request = isV2Request(request);
        const requestProvider = isElectrical(request) ? providerElectrical : v2Request ? providerV2 : provider;
        if (!requestProvider || (isElectrical(request) ? !readiness.electrostatic : v2Request ? !readiness.providerV2 : !readiness.ready)) return reply(res, 503, { error: 'BRIDGE_PROVIDERS_UNAVAILABLE' });
        if (v2Request) {
          const admission = admitV2SimulationRequest(request, providerV2!.capabilities);
          if (!admission.accepted) throw new Error('BRIDGE_PROVIDER_CAPABILITY_MISMATCH');
        }
        if (!session || session.expiresAt <= now()) return reply(res, 401, { error: 'BRIDGE_SESSION_REQUIRED' });
        if (++authorizationAttempts > 8) return reply(res, 429, { error: 'BRIDGE_AUTHORIZATION_LIMIT' });
        if (busy || submissions >= 4 || [...approvals.values()].some(a => a.expiresAt > now() && (a.state === 'pending' || a.state === 'approved'))) return reply(res, 409, { error: 'BRIDGE_BUSY' });
        busy = true;
        try {
        if (jobs.size) {
          const states = await Promise.all([...jobs.values()].map(job => job.provider.getStatus(job.submission.providerRunId)));
          if (states.some(state => ['running', 'queued'].includes(state.status))) return reply(res, 409, { error: 'BRIDGE_BUSY' });
        }
        if (!session || session.expiresAt <= now()) return reply(res, 401, { error: 'BRIDGE_SESSION_REQUIRED' });
        const approval: Approval = { id: token(), request, state: 'pending',
          preparationId: electricalEnvelope?.preparationId,
          expiresAt: Math.min(now() + APPROVAL_MS, isElectrical(request) ? now() + APPROVAL_MS : Date.parse(request.expiresAt)) };
        approvalController?.abort();
        approvals.clear(); approvals.set(approval.id, approval);
        approvalController = new AbortController();
        const controller = approvalController;
        void options.approve(structuredClone(request), controller.signal).then(approved => {
          if (!controller.signal.aborted && approval.expiresAt > now()) approval.state = approved ? 'approved' : 'denied';
        }).catch(() => { approval.state = 'denied'; });
        return reply(res, 202, { authorizationId: approval.id, expiresAt: approval.expiresAt });
        } finally { busy = false; }
      }
      const approvalMatch = /^\/v1\/authorizations\/([a-f0-9]{64})$/.exec(req.url ?? '');
      if (req.method === 'DELETE' && approvalMatch) {
        const approval = approvals.get(approvalMatch[1]);
        if (!approval || isTwoLayerApproval(approval.request))
          return reply(res, 404, { error: 'BRIDGE_NOT_FOUND' });
        if (isElectrical(approval.request)) {
          approval.revoked = true;
          if (approval.submission && approval.provider) await approval.provider.cancel(approval.submission.providerRunId);
        }
        if (approval.state !== 'used') { approval.state = 'denied'; approvalController?.abort(); }
        return reply(res, 200, { state: approval.state });
      }
      if (req.method === 'GET' && approvalMatch) {
        const approval = approvals.get(approvalMatch[1]);
        if (!approval || isTwoLayerApproval(approval.request))
          return reply(res, 404, { error: 'BRIDGE_NOT_FOUND' });
        return reply(res, 200, { state: approval.expiresAt <= now() ? 'expired' : approval.state,
          ...(isElectrical(approval.request) ? { preparationId: approval.preparationId,
            requestDigest: approval.request.requestDigest, projectRevision: approval.request.model.projectRevision,
            canonicalSourceDigest: approval.request.model.domains[0].geometryDigest } : {}) });
      }
      if (req.method === 'POST' && req.url === '/v1/jobs') {
        if (busy || submissions >= 4) return reply(res, 409, { error: 'BRIDGE_BUSY' });
        busy = true;
        try {
          // Authorization is consumed before body ingestion; unapproved geometry is never read.
          const permitted = [...approvals.values()].find(a => !isTwoLayerApproval(a.request)
            && a.state === 'approved' && a.expiresAt > now());
          if (!permitted) return reply(res, 403, { error: 'BRIDGE_TRANSFER_NOT_APPROVED' });
          if (isTwoLayerApproval(permitted.request))
            return reply(res, 403, { error: 'BRIDGE_TRANSFER_NOT_APPROVED' });
          permitted.state = 'used';
          if (!session || session.expiresAt <= now() || permitted.expiresAt <= now()) throw new Error('BRIDGE_AUTHORIZATION_EXPIRED');
          const rawBody = await readJson(req, Math.ceil(MAX_TOTAL_STEP / 3) * 4 + 16 * 1024);
          let selectedProvider: AnyProvider;
          let submission: SimulationProviderSubmission;
          if (isElectrical(permitted.request)) {
            if (!providerElectrical || !permitted.preparationId) throw new Error('BRIDGE_PROVIDERS_UNAVAILABLE');
            const body = z.object({ authorizationId: z.literal(permitted.id),
              stepBase64: z.string().max(Math.ceil(MAX_STEP / 3) * 4).regex(/^[A-Za-z0-9+/]+={0,2}$/),
            }).strict().parse(rawBody);
            const bytes = decodeStep(body.stepBase64);
            if (await electrostaticStepGeometryDigest(bytes) !== permitted.request.model.domains[0].geometryDigest) {
              throw new Error('BRIDGE_ELECTROSTATIC_SOURCE_MISMATCH');
            }
            if (permitted.revoked || !session || session.expiresAt <= now()
              || permitted.expiresAt <= now() || stopping) throw new Error('BRIDGE_AUTHORIZATION_EXPIRED');
            selectedProvider = providerElectrical;
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
          if (permitted.revoked || !session || session.expiresAt <= now() || stopping) { await selectedProvider.cancel(submission.providerRunId); throw new Error('BRIDGE_SESSION_REQUIRED'); }
          jobs.set(submission.providerRunId, { submission, provider: selectedProvider });
          return reply(res, 202, submission);
        } finally { busy = false; }
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
        if (now() - Date.parse(job.submission.acceptedAt) > 20 * 60_000) {
          jobs.delete(id); return reply(res, 410, { error: 'BRIDGE_RESULT_EXPIRED' });
        }
        if (req.method === 'POST' && operation === 'cancel') return reply(res, 200, await job.provider.cancel(id));
        if (req.method === 'GET' && operation === 'status') {
          const status = await job.provider.getStatus(id);
          if (status.failure) status.failure.message = 'The local simulation failed. Review the Bridge terminal or provider diagnostics locally.';
          return reply(res, 200, status);
        }
        if (req.method === 'GET' && operation === 'result') return reply(res, 200, await job.provider.getResult(id));
      }
      return reply(res, 404, { error: 'BRIDGE_NOT_FOUND' });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      reply(res, 400, { error: /^BRIDGE_[A-Z_]+$/.test(message) ? message : 'BRIDGE_REQUEST_INVALID' });
    }
  });
  server.requestTimeout = 30_000; server.headersTimeout = 10_000; server.maxHeadersCount = 24;
  server.maxConnections = 16;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 48731, '127.0.0.1', resolve); });
  authority = `127.0.0.1:${(server.address() as { port: number }).port}`;
  const maintenance = setInterval(() => {
    if (session && session.expiresAt <= now()) void revoke();
    for (const approval of approvals.values()) if (approval.expiresAt <= now() && ['pending', 'approved'].includes(approval.state)) {
      approval.state = 'denied'; approvalController?.abort();
    }
  }, 1000);
  maintenance.unref();
  return { url: `http://${authority}`, pairingCode,privateApprovals,
    // Internal owner port only: never exposed through HTTP or discovery.
    readPrivateSessionIdentity() {return privateApprovals&&session&&session.expiresAt>now()
      ?digest({pairedSession:session.key}):null;},
    readPrivateSessionMetadata() {return privateApprovals&&session&&session.expiresAt>now()
      ?{identity:digest({pairedSession:session.key}),expiresAt:session.expiresAt}:null;},
    verifyPrivateWindowProof(challenge:string,proof:string) {
      return Boolean(privateApprovals&&session&&session.expiresAt>now()
        &&/^[a-f0-9]{64}$/.test(challenge)&&/^[a-f0-9]{64}$/.test(proof)
        &&timingSafeEqual(Buffer.from(createHmac('sha256',session.key).update('private-operator:'+challenge).digest('hex'),'hex'),Buffer.from(proof,'hex')));
    },
    async close() { stopping = true; clearInterval(maintenance); await revoke(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); },
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
