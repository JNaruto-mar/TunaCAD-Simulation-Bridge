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
      qualification: combineQualification(
        options.meshProvider.capabilities.qualification,
        options.solverProvider.capabilities.qualification,
      ),
      execution: {
        ...options.solverProvider.capabilities.execution,
        topology: options.meshProvider.capabilities.execution.topology === 'remote_service'
          || options.solverProvider.capabilities.execution.topology === 'remote_service' ? 'remote_service' as const : 'local_adapter' as const,
        geometryLeavesDevice: options.meshProvider.capabilities.execution.geometryLeavesDevice,
        privacyDisclosure: `${options.meshProvider.capabilities.execution.privacyDisclosure} ${options.solverProvider.capabilities.execution.privacyDisclosure}`,
        queueTimeoutMs: options.meshProvider.capabilities.execution.queueTimeoutMs + options.solverProvider.capabilities.execution.queueTimeoutMs,
        executionTimeoutMs: options.meshProvider.capabilities.execution.executionTimeoutMs + options.solverProvider.capabilities.execution.executionTimeoutMs,
        totalTimeoutMs: options.meshProvider.capabilities.execution.totalTimeoutMs + options.solverProvider.capabilities.execution.totalTimeoutMs,
        resourceLimits: combineResourceLimits(
          options.meshProvider.capabilities.execution.resourceLimits,
          options.solverProvider.capabilities.execution.resourceLimits,
        ),
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
    if (run.cancelled) return structuredClone(run.status);
    run.cancelled = true;
    const childStatus = run.solverRunId
      ? await this.options.solverProvider.cancel(run.solverRunId)
      : run.meshRunId ? await this.options.meshProvider.cancel(run.meshRunId) : null;
    run.result = null;
    run.status = {
      providerRunId,
      status: 'cancelled',
      progress: null,
      phase: childStatus?.phase ?? 'cancelled_before_provider_start',
      updatedAt: new Date().toISOString(),
      ...(childStatus?.failure ? { failure: childStatus.failure } : {}),
    };
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
    if (!run.cancelled) {
      await this.options.meshProvider.cancel(run.meshRunId!).catch(() => undefined);
      throw pipelineError('SIMULATION_MESH_TIMEOUT', 'The MeshProvider exceeded its declared total timeout and was cancelled.');
    }
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
    if (!run.cancelled) {
      await this.options.solverProvider.cancel(run.solverRunId!).catch(() => undefined);
      throw pipelineError('SIMULATION_TIMEOUT', 'The SolverProvider exceeded its declared total timeout and was cancelled.');
    }
  }

  private requireRun(providerRunId: string): PipelineRun {
    const run = this.runs.get(providerRunId);
    if (!run) throw pipelineError('SIMULATION_JOB_NOT_FOUND', `Unknown composed simulation run "${providerRunId}".`);
    return run;
  }
}

function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
function pipelineError(code: string, message: string): Error & { code: string } { return Object.assign(new Error(message), { code }); }

function combineQualification(
  mesh: ExternalMeshProvider['capabilities']['qualification'],
  solver: ExternalSolverProvider['capabilities']['qualification'],
): ExternalSolverProvider['capabilities']['qualification'] {
  const status = mesh.status === 'unsupported' || solver.status === 'unsupported'
    ? 'unsupported' as const
    : mesh.status === 'proof_of_concept' || solver.status === 'proof_of_concept'
      ? 'proof_of_concept' as const
      : 'qualified' as const;
  return {
    status,
    engineeringUsePermitted: status === 'qualified' && mesh.engineeringUsePermitted && solver.engineeringUsePermitted,
    statement: `${mesh.statement} ${solver.statement}`,
    limitations: [...new Set([...mesh.limitations, ...solver.limitations])],
    evidence: mesh.evidence && solver.evidence && mesh.evidence.matrixId === solver.evidence.matrixId ? {
      schema: mesh.evidence.schema,
      matrixId: mesh.evidence.matrixId,
      pendingLaneIds: [...new Set([...mesh.evidence.pendingLaneIds, ...solver.evidence.pendingLaneIds])],
    } : null,
  };
}

function combineResourceLimits(
  mesh: ExternalMeshProvider['capabilities']['execution']['resourceLimits'],
  solver: ExternalSolverProvider['capabilities']['execution']['resourceLimits'],
) {
  if (!mesh && !solver) return undefined;
  return {
    maximumInputGeometryBytes: mesh?.maximumInputGeometryBytes ?? null,
    maximumWorkingDirectoryBytes: maximumNullable(mesh?.maximumWorkingDirectoryBytes, solver?.maximumWorkingDirectoryBytes),
    maximumResultFileBytes: maximumNullable(mesh?.maximumResultFileBytes, solver?.maximumResultFileBytes),
    maximumDiagnosticCharacters: Math.max(mesh?.maximumDiagnosticCharacters ?? 0, solver?.maximumDiagnosticCharacters ?? 0),
    processTerminationGraceMs: Math.max(mesh?.processTerminationGraceMs ?? 0, solver?.processTerminationGraceMs ?? 0),
    cpuTimeLimitMs: minimumNullable(mesh?.cpuTimeLimitMs, solver?.cpuTimeLimitMs),
    memoryLimitBytes: minimumNullable(mesh?.memoryLimitBytes, solver?.memoryLimitBytes),
  };
}

function maximumNullable(a: number | null | undefined, b: number | null | undefined): number | null {
  const values = [a, b].filter((value): value is number => typeof value === 'number');
  return values.length ? Math.max(...values) : null;
}

function minimumNullable(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null || b == null) return null;
  return Math.min(a, b);
}
