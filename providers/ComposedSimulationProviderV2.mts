import type {
  ExternalSimulationProviderV2, ExternalSolverProviderV2, NeutralFemModelV2, NeutralSimulationRequestV2,
  NeutralSimulationFieldPageV2, NeutralSimulationResultV2, SimulationGeometryResolverV2, SimulationProviderStatus, SimulationProviderSubmission,
} from '../src/simulation/externalSimulationContracts.ts';
import { validateNeutralFemModelV2, validateNeutralSimulationResultV2, validateNeutralSimulationRequestV2 } from '../simulation-bridge/v2Validation.mts';
import { GmshMultiDomainMeshProvider } from './gmsh/GmshMultiDomainMeshProvider.mts';

interface PipelineRun {
  providerRunId: string; submittedAt: string; request: NeutralSimulationRequestV2; status: SimulationProviderStatus;
  solverRunId: string | null; model: NeutralFemModelV2 | null; result: NeutralSimulationResultV2 | null; controller: AbortController;
}

export class ComposedSimulationProviderV2 implements ExternalSimulationProviderV2 {
  readonly id: string;
  readonly version: string;
  readonly capabilities;
  private readonly meshProvider: GmshMultiDomainMeshProvider;
  private readonly solverProvider: ExternalSolverProviderV2;
  private readonly runs = new Map<string, PipelineRun>();

  constructor(options: { id: string; version: string; meshProvider: GmshMultiDomainMeshProvider; solverProvider: ExternalSolverProviderV2 }) {
    this.id = options.id; this.version = options.version; this.meshProvider = options.meshProvider; this.solverProvider = options.solverProvider;
    const unsupported = options.meshProvider.capabilities.qualification.status === 'unsupported' || options.solverProvider.capabilities.qualification.status === 'unsupported';
    const meshEvidence = options.meshProvider.capabilities.qualification.evidence; const solverEvidence = options.solverProvider.capabilities.qualification.evidence;
    const evidence = meshEvidence && solverEvidence && meshEvidence.matrixId === solverEvidence.matrixId ? {
      schema: 'tunacad-simulation-qualification-matrix/1.0' as const, matrixId: meshEvidence.matrixId,
      pendingLaneIds: [...new Set([...meshEvidence.pendingLaneIds, ...solverEvidence.pendingLaneIds])],
    } : null;
    this.capabilities = {
      ...options.solverProvider.capabilities,
      study: {
        ...options.solverProvider.capabilities.study,
        interactionTypes: options.solverProvider.capabilities.study.interactionTypes.filter(type => type !== 'shared_topology'
          || options.meshProvider.capabilities.interactionTypes.includes(type)),
      },
      geometryFormats: options.meshProvider.capabilities.geometryFormats,
      qualification: {
        status: unsupported ? 'unsupported' as const : 'proof_of_concept' as const, engineeringUsePermitted: false,
        statement: `${options.meshProvider.capabilities.qualification.statement} ${options.solverProvider.capabilities.qualification.statement}`,
        limitations: [...new Set([...options.meshProvider.capabilities.qualification.limitations, ...options.solverProvider.capabilities.qualification.limitations])], evidence,
      },
      execution: {
        ...options.solverProvider.capabilities.execution,
        queueTimeoutMs: options.meshProvider.capabilities.execution.queueTimeoutMs + options.solverProvider.capabilities.execution.queueTimeoutMs,
        executionTimeoutMs: options.meshProvider.capabilities.execution.executionTimeoutMs * options.meshProvider.capabilities.maximumDomains + options.solverProvider.capabilities.execution.executionTimeoutMs,
        totalTimeoutMs: options.meshProvider.capabilities.execution.totalTimeoutMs * options.meshProvider.capabilities.maximumDomains + options.solverProvider.capabilities.execution.totalTimeoutMs,
        privacyDisclosure: `${options.meshProvider.capabilities.execution.privacyDisclosure} ${options.solverProvider.capabilities.execution.privacyDisclosure}`,
      },
    };
  }

  async submit(request: NeutralSimulationRequestV2, geometry: SimulationGeometryResolverV2): Promise<SimulationProviderSubmission> {
    validateNeutralSimulationRequestV2(request);
    const providerRunId = `pipelinev2_${crypto.randomUUID()}`; const submittedAt = new Date().toISOString();
    const run: PipelineRun = { providerRunId, submittedAt, request, solverRunId: null, model: null, result: null, controller: new AbortController(),
      status: { providerRunId, status: 'queued', progress: 0, phase: 'multi_domain_mesh_queued', updatedAt: submittedAt } };
    this.runs.set(providerRunId, run); void this.execute(run, geometry);
    return { providerRunId, acceptedAt: submittedAt };
  }
  getStatus(id: string) { return Promise.resolve(structuredClone(this.require(id).status)); }
  getResult(id: string) { return Promise.resolve(structuredClone(this.require(id).result)); }
  async getFieldDataset(providerRunId: string, datasetId: string, cursor?: string, limit?: number): Promise<NeutralSimulationFieldPageV2> {
    const run = this.require(providerRunId);
    if (!run.result?.perDomain.some(domain => domain.fieldDatasetIds.includes(datasetId))) throw providerError('SIMULATION_FIELD_DATASET_NOT_FOUND', `Dataset "${datasetId}" does not belong to run "${providerRunId}".`);
    if (!run?.solverRunId || run.status.status !== 'succeeded') throw providerError('SIMULATION_FIELD_DATASET_NOT_FOUND', `Unknown or unavailable v2 field dataset "${datasetId}".`);
    const page = await this.solverProvider.getFieldDataset(run.solverRunId, datasetId, cursor, limit);
    return { ...page, dataset: { ...page.dataset, jobId: run.providerRunId } };
  }
  async cancel(id: string) {
    const run = this.require(id);
    if (['succeeded', 'failed', 'cancelled'].includes(run.status.status)) return structuredClone(run.status);
    run.controller.abort();
    if (run.solverRunId) await this.solverProvider.cancel(run.solverRunId).catch(() => undefined);
    run.result = null; run.status = { providerRunId: id, status: 'cancelled', progress: null, phase: 'cancelled', updatedAt: new Date().toISOString() };
    return structuredClone(run.status);
  }
  private async execute(run: PipelineRun, geometry: SimulationGeometryResolverV2) {
    try {
      run.status = { providerRunId: run.providerRunId, status: 'running', progress: 0.05, phase: 'multi_domain_meshing', updatedAt: new Date().toISOString() };
      const model = await this.meshProvider.mesh(run.request, geometry, run.controller.signal); if (run.controller.signal.aborted) return;
      validateNeutralFemModelV2(model, run.request); run.model = model;
      run.status = { providerRunId: run.providerRunId, status: 'running', progress: 0.5, phase: 'multi_domain_mesh_validated', updatedAt: new Date().toISOString() };
      const submission = await this.solverProvider.submit(run.request, model); run.solverRunId = submission.providerRunId; if (run.controller.signal.aborted) { await this.solverProvider.cancel(submission.providerRunId); return; }
      const deadline = Date.now() + this.solverProvider.capabilities.execution.totalTimeoutMs;
      while (Date.now() < deadline) {
        if (run.controller.signal.aborted) { await this.solverProvider.cancel(submission.providerRunId); return; }
        const status = await this.solverProvider.getStatus(submission.providerRunId);
        if (run.controller.signal.aborted) return;
        run.status = { providerRunId: run.providerRunId, status: status.status === 'queued' ? 'queued' : 'running', progress: status.progress === null ? null : 0.5 + status.progress * 0.48, phase: status.phase, updatedAt: status.updatedAt };
        if (status.status === 'failed') throw providerError(status.failure?.code ?? 'SIMULATION_SOLVER_FAILED', status.failure?.message ?? 'The v2 solver failed.');
        if (status.status === 'cancelled') throw providerError('SIMULATION_CANCELLED', 'The v2 solver was cancelled.');
        if (status.status === 'succeeded') break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      const solverResult = await this.solverProvider.getResult(submission.providerRunId);
      if (run.controller.signal.aborted) return;
      if (!solverResult) throw providerError('SIMULATION_RESULT_INVALID', 'The v2 solver completed without a result.');
      const completedAt = new Date().toISOString();
      run.result = { ...solverResult, jobId: run.providerRunId, provenance: { ...solverResult.provenance, adapterId: this.id, adapterVersion: this.version, providerRunId: run.providerRunId,
        submittedAt: run.submittedAt, completedAt, normalizedAt: completedAt, mesh: { meshId: model.modelId, adapterId: model.provenance.adapterId, adapterVersion: model.provenance.adapterVersion,
          engine: model.provenance.engine, engineVersion: model.provenance.engineVersion, nodeCount: model.quality.nodeCount, elementCount: model.quality.elementCount,
          boundaryFacetCount: model.quality.boundaryFacetCount, minimumQuality: model.quality.minimum, averageQuality: model.quality.average, volumeRelativeError: model.quality.volumeRelativeError } } };
      validateNeutralSimulationResultV2(run.result, run.request);
      if (run.controller.signal.aborted) { run.result = null; return; }
      run.status = { providerRunId: run.providerRunId, status: 'succeeded', progress: 1, phase: 'normalized_v2', updatedAt: completedAt };
    } catch (caught) {
      if (run.controller.signal.aborted) return;
      const typed = caught as Error & { code?: string }; run.result = null;
      run.status = { providerRunId: run.providerRunId, status: 'failed', progress: null, phase: 'failed', updatedAt: new Date().toISOString(), failure: { code: typed.code ?? 'SIMULATION_PROVIDER_FAILED', message: typed.message.slice(0, 2000) } };
    }
  }
  private require(id: string) { const run = this.runs.get(id); if (!run) throw providerError('SIMULATION_JOB_NOT_FOUND', `Unknown v2 pipeline run "${id}".`); return run; }
}
function providerError(code: string, message: string): Error & { code: string } { return Object.assign(new Error(message), { code }); }
