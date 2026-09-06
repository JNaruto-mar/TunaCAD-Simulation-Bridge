import {
  SIMULATION_PROVIDER_INTERFACE_VERSION,
  type ExternalMeshProvider,
  type ExternalSimulationProvider,
  type ExternalSolverProvider,
  type NeutralFemMesh,
  type NeutralSimulationRequest,
  type NeutralSimulationResult,
  type SimulationGeometryResolver,
  type SimulationProviderStatus,
  type SimulationProviderSubmission,
} from '../src/simulation/externalSimulationContracts.ts';
import { createNeutralMeshJobRequest, validateNeutralFemMesh } from '../src/simulation/neutralFemMesh.ts';

interface PipelineRun {
  providerRunId: string;
  submittedAt: string;
  request: NeutralSimulationRequest;
  status: SimulationProviderStatus;
  meshRunId: string | null;
  solverRunId: string | null;
  mesh: NeutralFemMesh | null;
  result: NeutralSimulationResult | null;
  cancelled: boolean;
}

/** Host-side composition boundary. Public MCP tools continue to see one
 * ExternalSimulationProvider while meshing and solving remain replaceable. */
export class ComposedSimulationProvider implements ExternalSimulationProvider {
  readonly id: string;
  readonly version: string;
  readonly capabilities;
  private readonly options: {
    meshProvider: ExternalMeshProvider;
    solverProvider: ExternalSolverProvider;
    id: string;
    version: string;
  };
  private readonly runs = new Map<string, PipelineRun>();

  constructor(options: {
    meshProvider: ExternalMeshProvider;
    solverProvider: ExternalSolverProvider;
    id: string;
    version: string;
  }) {
    this.options = options;
    this.id = options.id;
    this.version = options.version;
    this.capabilities = {
      ...options.solverProvider.capabilities,
      interfaceVersion: SIMULATION_PROVIDER_INTERFACE_VERSION,
      geometryFormats: options.meshProvider.capabilities.geometryFormats,
      durableReferenceMapping: options.meshProvider.capabilities.durableReferenceMapping === 'supported'
        && options.solverProvider.capabilities.durableReferenceMapping === 'supported' ? 'supported' as const : 'partial' as const,
      execution: {
        ...options.solverProvider.capabilities.execution,
        topology: options.meshProvider.capabilities.execution.topology === 'remote_service'
          || options.solverProvider.capabilities.execution.topology === 'remote_service' ? 'remote_service' as const : 'local_adapter' as const,
        geometryLeavesDevice: options.meshProvider.capabilities.execution.geometryLeavesDevice,
        privacyDisclosure: `${options.meshProvider.capabilities.execution.privacyDisclosure} ${options.solverProvider.capabilities.execution.privacyDisclosure}`,
        queueTimeoutMs: options.meshProvider.capabilities.execution.queueTimeoutMs + options.solverProvider.capabilities.execution.queueTimeoutMs,
        executionTimeoutMs: options.meshProvider.capabilities.execution.executionTimeoutMs + options.solverProvider.capabilities.execution.executionTimeoutMs,
        totalTimeoutMs: options.meshProvider.capabilities.execution.totalTimeoutMs + options.solverProvider.capabilities.execution.totalTimeoutMs,
      },
    };
  }

  async submit(request: NeutralSimulationRequest, geometry: SimulationGeometryResolver): Promise<SimulationProviderSubmission> {
    const providerRunId = `pipeline_${crypto.randomUUID()}`;
    const submittedAt = new Date().toISOString();
    const run: PipelineRun = {
      providerRunId, submittedAt, request, meshRunId: null, solverRunId: null, mesh: null, result: null, cancelled: false,
      status: { providerRunId, status: 'queued', progress: 0, phase: 'mesh_queued', updatedAt: submittedAt },
    };
    this.runs.set(providerRunId, run);
    void this.execute(run, geometry);
    return { providerRunId, acceptedAt: submittedAt };
  }

  async getStatus(providerRunId: string): Promise<SimulationProviderStatus> { return structuredClone(this.requireRun(providerRunId).status); }
  async getResult(providerRunId: string): Promise<NeutralSimulationResult | null> { return structuredClone(this.requireRun(providerRunId).result); }

  async cancel(providerRunId: string): Promise<SimulationProviderStatus> {
    const run = this.requireRun(providerRunId);
    run.cancelled = true;
    if (run.solverRunId) await this.options.solverProvider.cancel(run.solverRunId);
    else if (run.meshRunId) await this.options.meshProvider.cancel(run.meshRunId);
    run.result = null;
    run.status = { providerRunId, status: 'cancelled', progress: null, phase: 'cancelled', updatedAt: new Date().toISOString() };
    return structuredClone(run.status);
  }

  private async execute(run: PipelineRun, geometry: SimulationGeometryResolver): Promise<void> {
    try {
      const meshRequest = createNeutralMeshJobRequest(run.request);
      run.status = { providerRunId: run.providerRunId, status: 'running', progress: 0.05, phase: 'meshing', updatedAt: new Date().toISOString() };
      const meshSubmission = await this.options.meshProvider.submit(meshRequest, geometry);
      run.meshRunId = meshSubmission.meshRunId;
      if (run.cancelled) { await this.options.meshProvider.cancel(run.meshRunId); return; }
      await this.waitForMesh(run);
      if (run.cancelled) return;
      const mesh = await this.options.meshProvider.getMesh(meshSubmission.meshRunId);
      if (run.cancelled) return;
      if (!mesh) throw pipelineError('SIMULATION_MESH_INVALID', 'The MeshProvider completed without a neutral FEM mesh.');
      validateNeutralFemMesh(mesh, meshRequest);
      run.mesh = mesh;
      run.status = { providerRunId: run.providerRunId, status: 'running', progress: 0.48, phase: 'mesh_validated', updatedAt: new Date().toISOString() };

      const solverSubmission = await this.options.solverProvider.submit(run.request, mesh);
      run.solverRunId = solverSubmission.providerRunId;
      if (run.cancelled) { await this.options.solverProvider.cancel(run.solverRunId); return; }
      await this.waitForSolver(run);
      if (run.cancelled) return;
      const solverResult = await this.options.solverProvider.getResult(solverSubmission.providerRunId);
      if (run.cancelled) return;
      if (!solverResult) throw pipelineError('SIMULATION_RESULT_INVALID', 'The SolverProvider completed without a normalized result.');
      const completedAt = new Date().toISOString();
      run.result = {
        ...solverResult,
        provenance: {
          ...solverResult.provenance,
          providerInterfaceVersion: SIMULATION_PROVIDER_INTERFACE_VERSION,
          adapterId: this.id,
          adapterVersion: this.version,
          providerRunId: run.providerRunId,
          submittedAt: run.submittedAt,
          completedAt,
          normalizedAt: completedAt,
          mesh: {
            meshId: mesh.meshId,
            adapterId: mesh.provenance.adapterId,
            adapterVersion: mesh.provenance.adapterVersion,
            engine: mesh.provenance.engine,
            engineVersion: mesh.provenance.engineVersion,
            nodeCount: mesh.quality.nodeCount,
            elementCount: mesh.quality.elementCount,
            boundaryFacetCount: mesh.quality.boundaryFacetCount,
            minimumQuality: mesh.quality.minimum,
            averageQuality: mesh.quality.average,
            volumeRelativeError: mesh.quality.volumeRelativeError,
          },
        },
      };
      run.status = { providerRunId: run.providerRunId, status: 'succeeded', progress: 1, phase: 'normalized', updatedAt: completedAt };
    } catch (error) {
      if (run.cancelled) return;
      const typed = error as Error & { code?: string };
      run.result = null;
      run.status = { providerRunId: run.providerRunId, status: 'failed', progress: null, phase: 'failed', updatedAt: new Date().toISOString(), failure: { code: typed.code ?? 'SIMULATION_PROVIDER_FAILED', message: typed.message.slice(0, 2_000) } };
    }
  }

  private async waitForMesh(run: PipelineRun): Promise<void> {
    const deadline = Date.now() + this.options.meshProvider.capabilities.execution.totalTimeoutMs;
    while (!run.cancelled && Date.now() < deadline) {
      const status = await this.options.meshProvider.getStatus(run.meshRunId!);
      if (run.cancelled) return;
      run.status = { providerRunId: run.providerRunId, status: status.status === 'queued' ? 'queued' : 'running', progress: status.progress === null ? null : Math.min(0.45, status.progress * 0.45), phase: status.phase, updatedAt: status.updatedAt };
      if (status.status === 'succeeded') return;
      if (status.status === 'failed') throw pipelineError(status.failure?.code ?? 'SIMULATION_MESH_FAILED', status.failure?.message ?? 'The MeshProvider failed.');
      if (status.status === 'cancelled') throw pipelineError('SIMULATION_CANCELLED', 'The MeshProvider was cancelled.');
      await delay(25);
    }
    if (!run.cancelled) throw pipelineError('SIMULATION_MESH_TIMEOUT', 'The MeshProvider exceeded its declared total timeout.');
  }

  private async waitForSolver(run: PipelineRun): Promise<void> {
    const deadline = Date.now() + this.options.solverProvider.capabilities.execution.totalTimeoutMs;
    while (!run.cancelled && Date.now() < deadline) {
      const status = await this.options.solverProvider.getStatus(run.solverRunId!);
      if (run.cancelled) return;
      run.status = { providerRunId: run.providerRunId, status: status.status === 'queued' ? 'queued' : 'running', progress: status.progress === null ? null : 0.5 + status.progress * 0.48, phase: status.phase, updatedAt: status.updatedAt };
      if (status.status === 'succeeded') return;
      if (status.status === 'failed') throw pipelineError(status.failure?.code ?? 'SIMULATION_SOLVER_FAILED', status.failure?.message ?? 'The SolverProvider failed.');
      if (status.status === 'cancelled') throw pipelineError('SIMULATION_CANCELLED', 'The SolverProvider was cancelled.');
      await delay(25);
    }
    if (!run.cancelled) throw pipelineError('SIMULATION_TIMEOUT', 'The SolverProvider exceeded its declared total timeout.');
  }

  private requireRun(providerRunId: string): PipelineRun {
    const run = this.runs.get(providerRunId);
    if (!run) throw pipelineError('SIMULATION_JOB_NOT_FOUND', `Unknown composed simulation run "${providerRunId}".`);
    return run;
  }
}

function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
function pipelineError(code: string, message: string): Error & { code: string } { return Object.assign(new Error(message), { code }); }
