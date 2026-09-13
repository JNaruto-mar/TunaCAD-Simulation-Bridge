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
type BridgeRequest = NeutralSimulationRequest | NeutralSimulationRequestV2;
type AnyProvider = ExternalSimulationProvider | ExternalSimulationProviderV2;
type Approval = { id: string; request: BridgeRequest; expiresAt: number; state: 'pending' | 'approved' | 'denied' | 'used' };
type BridgeJob = { submission: SimulationProviderSubmission; provider: AnyProvider };
const isV2Request = (request: BridgeRequest): request is NeutralSimulationRequestV2 => request.schema === 'tunacad-neutral-simulation-request/2.0';

/** Local host API only. Provider configuration accepts two executable paths
 * behind an authenticated session; execution arguments remain fixed in host adapters. */
export async function startSimulationBridge(options: {
  provider: ExternalSimulationProvider | null;
  providerV2?: ExternalSimulationProviderV2 | null;
  readiness: Omit<SimulationBridgeReadiness, 'protocolVersion' | 'limits'>;
  approve: (request: BridgeRequest, signal: AbortSignal) => Promise<boolean>;
  configureProviders?: (paths: { gmshExecutable: string; calculixExecutable: string }) => Promise<{
    provider: ExternalSimulationProvider | null;
    providerV2?: ExternalSimulationProviderV2 | null;
    readiness: Omit<SimulationBridgeReadiness, 'protocolVersion' | 'limits'>;
  }>;
  browseProviderExecutable?: (provider: 'gmsh' | 'calculix') => Promise<string>;
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
  let readiness: SimulationBridgeReadiness = {
    ...options.readiness, protocolVersion: SIMULATION_BRIDGE_VERSION,
    limits: { maximumStepBytes: MAX_STEP, maximumTotalStepBytes: MAX_TOTAL_STEP, maximumDomains: MAX_DOMAINS, maximumJobs: 4, sessionLifetimeMs: SESSION_MS },
  };

  async function revoke() {
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
      if (req.method === 'DELETE' && req.url === '/v1/session') { await revoke(); return reply(res, 200, { disconnected: true }); }
      if (req.method === 'GET' && req.url === '/v1/capabilities') return reply(res, 200, readiness);
      if (req.method === 'POST' && req.url === '/v1/providers/browse') {
        if (!options.browseProviderExecutable || submissions > 0) return reply(res, 409, { error: 'BRIDGE_PROVIDER_CONFIGURATION_LOCKED' });
        const body = z.object({ provider: z.enum(['gmsh', 'calculix']) }).strict().parse(await readJson(req, 128));
        const path = await options.browseProviderExecutable(body.provider);
        return reply(res, 200, { provider: body.provider, path });
      }
      if (req.method === 'POST' && req.url === '/v1/providers/test') {
        if (!options.configureProviders || submissions > 0) return reply(res, 409, { error: 'BRIDGE_PROVIDER_CONFIGURATION_LOCKED' });
        const executablePath = z.string().max(1_000).refine(value => ![...value].some(character => {
          const code = character.charCodeAt(0); return code < 32 || code === 127;
        }));
        const paths = z.object({ gmshExecutable: executablePath, calculixExecutable: executablePath }).strict().parse(await readJson(req, 3_000));
        const configured = await options.configureProviders(paths);
        provider = configured.provider;
        providerV2 = configured.providerV2 ?? null;
        readiness = { ...configured.readiness, protocolVersion: SIMULATION_BRIDGE_VERSION, limits: readiness.limits };
        return reply(res, 200, readiness);
      }
      if (req.method === 'POST' && req.url === '/v1/authorizations') {
        const request = validateRequestEnvelope(await readJson(req, 256 * 1024), now());
        const v2Request = isV2Request(request);
        const requestProvider = v2Request ? providerV2 : provider;
        if (!requestProvider || (v2Request ? !readiness.providerV2 : !readiness.ready)) return reply(res, 503, { error: 'BRIDGE_PROVIDERS_UNAVAILABLE' });
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
        const approval: Approval = { id: token(), request, state: 'pending', expiresAt: Math.min(now() + APPROVAL_MS, Date.parse(request.expiresAt)) };
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
        if (!approval) return reply(res, 404, { error: 'BRIDGE_NOT_FOUND' });
        if (approval.state !== 'used') { approval.state = 'denied'; approvalController?.abort(); }
        return reply(res, 200, { state: approval.state });
      }
      if (req.method === 'GET' && approvalMatch) {
        const approval = approvals.get(approvalMatch[1]);
        if (!approval) return reply(res, 404, { error: 'BRIDGE_NOT_FOUND' });
        return reply(res, 200, { state: approval.expiresAt <= now() ? 'expired' : approval.state });
      }
      if (req.method === 'POST' && req.url === '/v1/jobs') {
        if (busy || submissions >= 4) return reply(res, 409, { error: 'BRIDGE_BUSY' });
        busy = true;
        try {
          // Authorization is consumed before body ingestion; unapproved geometry is never read.
          const permitted = [...approvals.values()].find(a => a.state === 'approved' && a.expiresAt > now());
          if (!permitted) return reply(res, 403, { error: 'BRIDGE_TRANSFER_NOT_APPROVED' });
          permitted.state = 'used';
          if (!session || session.expiresAt <= now() || permitted.expiresAt <= now()) throw new Error('BRIDGE_AUTHORIZATION_EXPIRED');
          const rawBody = await readJson(req, Math.ceil(MAX_TOTAL_STEP / 3) * 4 + 16 * 1024);
          let selectedProvider: AnyProvider;
          let submission: SimulationProviderSubmission;
          if (isV2Request(permitted.request)) {
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
          if (!session || session.expiresAt <= now() || stopping) { await selectedProvider.cancel(submission.providerRunId); throw new Error('BRIDGE_SESSION_REQUIRED'); }
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
        const page = validateNeutralSimulationFieldPageV2(await job.provider.getFieldDataset(fieldMatch[1], query.datasetId, query.cursor, query.limit));
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
  return { url: `http://${authority}`, pairingCode,
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
