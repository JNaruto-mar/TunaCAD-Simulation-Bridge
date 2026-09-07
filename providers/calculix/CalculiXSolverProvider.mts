import type { ChildProcess } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import {
  NEUTRAL_SIMULATION_RESULT_SCHEMA,
  SIMULATION_PROVIDER_INTERFACE_VERSION,
  type ExternalSolverProvider,
  type NeutralFemMesh,
  type NeutralSimulationReferenceBinding,
  type NeutralSimulationRequest,
  type NeutralSimulationResult,
  type NeutralVector3,
  type SimulationProviderStatus,
  type SimulationProviderCapabilities,
  type SimulationProviderSubmission,
} from '../../src/simulation/externalSimulationContracts.ts';
import {
  LOCAL_PROVIDER_RESOURCE_LIMITS,
  hasEnforcedProviderProcessQuotas,
  monitorWorkingDirectory,
  readUtf8FileBounded,
  removeWorkingDirectory,
  spawnProviderProcess,
  terminateChildProcess,
} from '../processLifecycle.mts';

interface SolverRun {
  request: NeutralSimulationRequest;
  mesh: NeutralFemMesh;
  providerRunId: string;
  submittedAt: string;
  directory: string;
  process: ChildProcess;
  status: SimulationProviderStatus;
  result: NeutralSimulationResult | null;
  timeout: NodeJS.Timeout;
  stopResourceMonitor: () => void;
}

export interface CalculiXOutput {
  maximumDisplacementMm: number;
  maximumDisplacementPositionMm: NeutralVector3;
  maximumDisplacementNode: number;
  maximumVonMisesStressMPa: number;
  maximumStressPositionMm: NeutralVector3;
  reactionForcesBySet: Record<string, NeutralVector3>;
  totalVolumeMm3: number | null;
}

/** Node-only adapter for a user-installed CalculiX executable. It accepts only
 * the neutral FEM mesh contract and exposes no executable arguments publicly. */
export class CalculiXSolverProvider implements ExternalSolverProvider {
  readonly id = 'tunacad-calculix-solver-poc';
  readonly version = '0.1.0-poc';
  readonly capabilities: SimulationProviderCapabilities = {
    interfaceVersion: SIMULATION_PROVIDER_INTERFACE_VERSION,
    analysisTypes: ['linear_static'] as const,
    study: {
      maximumParts: 1,
      maximumBodies: 1,
      maximumMaterials: 1,
      maximumReferenceBindings: 128,
      materialModels: ['isotropic_linear_elastic'] as const,
      loadTypes: ['surface_force', 'pressure', 'gravity'] as const,
      maximumLoads: 64,
      maximumReferencesPerLoad: 32,
      constraintTypes: ['fixed', 'prescribed_displacement'] as const,
      maximumConstraints: 64,
      maximumReferencesPerConstraint: 32,
      contactModes: ['none'] as const,
    },
    geometryFormats: [] as const,
    asynchronous: true as const,
    cancellation: true as const,
    normalizedResults: true as const,
    durableReferenceMapping: 'supported' as const,
    authority: 'engineering' as const,
    qualification: {
      status: 'proof_of_concept' as const,
      engineeringUsePermitted: false,
      statement: 'Local CalculiX adapter with version-bound benchmark evidence; independent engineering review is still required before qualified use.',
      limitations: ['Windows development-host evidence only', 'Small-displacement linear statics only', 'One isotropic linear-elastic material', 'Pressure, gravity, prescribed-displacement, and simultaneous-load superposition are experimental SIM-3 capabilities outside the SIM-2 qualification matrix'],
      evidence: {
        schema: 'tunacad-simulation-qualification-matrix/1.0' as const,
        matrixId: 'sim2-windows-x64-gmsh-4.15.2-calculix-2.16',
        pendingLaneIds: ['independent-engineering-review'],
      },
    },
    execution: {
      topology: 'local_adapter' as const,
      credentials: 'none' as const,
      geometryLeavesDevice: false,
      privacyDisclosure: 'Only the validated neutral FEM mesh and neutral study data are written to a temporary CalculiX input deck. Provider files are removed after result normalization.',
      queueTimeoutMs: 5_000,
      executionTimeoutMs: 120_000,
      totalTimeoutMs: 125_000,
      rawArtifactRetentionMs: 0,
      normalizedResultRetentionMs: 20 * 60 * 1000,
      resourceLimits: {
        maximumInputGeometryBytes: null,
        maximumWorkingDirectoryBytes: LOCAL_PROVIDER_RESOURCE_LIMITS.maximumWorkingDirectoryBytes,
        maximumResultFileBytes: LOCAL_PROVIDER_RESOURCE_LIMITS.maximumResultFileBytes,
        maximumDiagnosticCharacters: LOCAL_PROVIDER_RESOURCE_LIMITS.maximumDiagnosticCharacters,
        processTerminationGraceMs: LOCAL_PROVIDER_RESOURCE_LIMITS.processTerminationGraceMs,
        cpuTimeLimitMs: LOCAL_PROVIDER_RESOURCE_LIMITS.cpuTimeLimitMs,
        memoryLimitBytes: LOCAL_PROVIDER_RESOURCE_LIMITS.memoryLimitBytes,
      },
    },
  };
  private readonly executable: string;
  private readonly runtimeVersion: string;
  private readonly runs = new Map<string, SolverRun>();

  constructor(options: { executable: string; runtimeVersion: string }) {
    if (!options.executable?.trim() || !/^ccx(?:\d+(?:\.\d+)*|[_-][A-Za-z0-9][A-Za-z0-9._-]*)?(?:\.exe)?$/i.test(basename(options.executable))) {
      throw providerError('SIMULATION_SOLVER_UNAVAILABLE', 'An explicit CalculiX ccx executable is required.');
    }
    this.executable = resolve(options.executable);
    this.runtimeVersion = options.runtimeVersion;
    if (!hasEnforcedProviderProcessQuotas()) {
      Object.assign(this.capabilities.qualification, {
        status: 'unsupported' as const,
        engineeringUsePermitted: false,
        statement: `CalculiX execution on ${process.platform}/${process.arch} is outside the supported provider boundary because OS-enforced CPU and memory quotas are not implemented.`,
        evidence: null,
      });
    } else if (nodeMajorVersion() !== 24 || options.runtimeVersion !== '2.16') {
      Object.assign(this.capabilities.qualification, {
        statement: `Local CalculiX ${options.runtimeVersion} adapter on Node ${process.versions.node} is outside the recorded Windows x64 / Node 24 / CalculiX 2.16 qualification matrix.`,
        evidence: null,
      });
    }
  }

  async submit(request: NeutralSimulationRequest, mesh: NeutralFemMesh): Promise<SimulationProviderSubmission> {
    const input = createInputDeck(request, mesh);
    if (Buffer.byteLength(input, 'utf8') > LOCAL_PROVIDER_RESOURCE_LIMITS.maximumResultFileBytes) {
      throw providerError('SIMULATION_INPUT_LIMIT', `CalculiX input exceeds the ${LOCAL_PROVIDER_RESOURCE_LIMITS.maximumResultFileBytes}-byte provider limit.`);
    }
    const directory = await mkdtemp(join(tmpdir(), 'tunacad-calculix-solver-'));
    const providerRunId = `calculixsolve_${crypto.randomUUID()}`;
    const submittedAt = new Date().toISOString();
    await writeFile(join(directory, 'tunacad.inp'), input, 'utf8');
    const child = spawnProviderProcess(this.executable, ['-i', 'tunacad'], {
      cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: executableEnvironment(this.executable),
    });
    const run = {
      request, mesh, providerRunId, submittedAt, directory, process: child, result: null,
      status: { providerRunId, status: 'running', progress: null, phase: 'external_solver', updatedAt: submittedAt },
      timeout: undefined as unknown as NodeJS.Timeout,
      stopResourceMonitor: () => undefined,
    } satisfies SolverRun;
    run.timeout = setTimeout(() => { void this.failRun(run, 'SIMULATION_TIMEOUT', 'CalculiX exceeded its declared execution timeout.'); }, this.capabilities.execution.executionTimeoutMs);
    run.timeout.unref();
    this.runs.set(providerRunId, run);
    let diagnostic = '';
    const collect = (chunk: unknown) => { diagnostic = `${diagnostic}${String(chunk)}`.slice(-LOCAL_PROVIDER_RESOURCE_LIMITS.maximumDiagnosticCharacters); };
    child.stdout?.on('data', collect); child.stderr?.on('data', collect);
    child.once('error', () => void this.failRun(run, 'SIMULATION_SOLVER_UNAVAILABLE', 'The configured external CalculiX process could not be started.'));
    child.once('exit', (code, signal) => void this.finishRun(run, code, signal, diagnostic));
    run.stopResourceMonitor = monitorWorkingDirectory({
      child,
      directory,
      onExceeded: bytes => this.failRun(run, 'SIMULATION_DISK_LIMIT', `CalculiX working data exceeded the ${LOCAL_PROVIDER_RESOURCE_LIMITS.maximumWorkingDirectoryBytes}-byte limit (${bytes} bytes observed).`),
    });
    return { providerRunId, acceptedAt: submittedAt };
  }

  async getStatus(providerRunId: string): Promise<SimulationProviderStatus> { return structuredClone(this.requireRun(providerRunId).status); }
  async getResult(providerRunId: string): Promise<NeutralSimulationResult | null> { return structuredClone(this.requireRun(providerRunId).result); }

  async cancel(providerRunId: string): Promise<SimulationProviderStatus> {
    const run = this.requireRun(providerRunId);
    if (run.status.status === 'running' || run.status.status === 'queued') {
      run.status = { providerRunId, status: 'cancelled', progress: null, phase: 'cancelled', updatedAt: new Date().toISOString() };
      clearTimeout(run.timeout); run.stopResourceMonitor(); run.result = null;
      const terminated = await terminateChildProcess(run.process);
      const cleaned = await removeWorkingDirectory(run.directory);
      run.status = {
        ...run.status,
        phase: terminated && cleaned ? 'cancelled_cleaned' : 'cancelled_cleanup_pending',
        ...(!terminated || !cleaned ? { failure: { code: 'SIMULATION_CLEANUP_FAILED', message: 'CalculiX cancellation could not confirm process termination and temporary-data cleanup.' } } : {}),
        updatedAt: new Date().toISOString(),
      };
    }
    return structuredClone(run.status);
  }

  private async finishRun(run: SolverRun, code: number | null, signal: NodeJS.Signals | null, diagnostic: string): Promise<void> {
    run.stopResourceMonitor();
    if (run.status.status === 'cancelled' || run.status.status === 'failed') { await removeWorkingDirectory(run.directory); return; }
    clearTimeout(run.timeout);
    if (code !== 0) {
      const lastLine = diagnostic.split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? '';
      await this.failRun(run, 'SIMULATION_SOLVER_FAILED', `CalculiX exited with code ${String(code)}${signal ? ` (${signal})` : ''}.${lastLine ? ` ${lastLine.slice(0, 800)}` : ''}`);
      return;
    }
    try {
      const output = parseCalculiXDat(
        await readUtf8FileBounded(join(run.directory, 'tunacad.dat')),
        run.mesh,
        run.request.constraints.map((_constraint, index) => reactionSetName(index)),
        run.request.loads.some(load => load.type === 'gravity'),
      );
      run.result = normalizeResult(run, output, this.id, this.version, this.runtimeVersion);
      run.status = { providerRunId: run.providerRunId, status: 'succeeded', progress: 1, phase: 'normalized', updatedAt: new Date().toISOString() };
    } catch (error) {
      await this.failRun(run, 'SIMULATION_RESULT_UNTRUSTED', error instanceof Error ? error.message : String(error));
      return;
    }
    await removeWorkingDirectory(run.directory);
  }

  private async failRun(run: SolverRun, code: string, message: string): Promise<void> {
    if (run.status.status === 'cancelled' || run.status.status === 'failed') return;
    clearTimeout(run.timeout); run.stopResourceMonitor(); run.result = null;
    run.status = { providerRunId: run.providerRunId, status: 'failed', progress: null, phase: 'failed', updatedAt: new Date().toISOString(), failure: { code, message: message.slice(0, 2_000) } };
    await terminateChildProcess(run.process);
    await removeWorkingDirectory(run.directory);
  }

  private requireRun(providerRunId: string): SolverRun {
    const run = this.runs.get(providerRunId);
    if (!run) throw providerError('SIMULATION_JOB_NOT_FOUND', `Unknown CalculiX solver run "${providerRunId}".`);
    return run;
  }
}

export function createInputDeck(request: NeutralSimulationRequest, mesh: NeutralFemMesh): string {
  if (request.analysis.type !== 'linear_static' || request.material.model !== 'isotropic_linear_elastic') throw providerError('SIMULATION_ANALYSIS_UNSUPPORTED', 'The CalculiX POC supports isotropic linear-static analysis only.');
  if (mesh.element.geometryOrder !== 2 || mesh.element.solutionOrder !== 2 || mesh.volumeElements.connectivity.some(cell => cell.length !== 10)) throw providerError('SIMULATION_MESH_ELEMENT_UNSUPPORTED', 'The CalculiX adapter requires complete second-order C3D10 tetrahedra.');
  const supportedLoads = request.loads
    .filter(load => load.type === 'surface_force' || load.type === 'pressure' || load.type === 'gravity')
    .sort((a, b) => compareStableText(a.id, b.id));
  const supportedConstraints = request.constraints.filter(constraint => constraint.type === 'fixed' || constraint.type === 'prescribed_displacement');
  const entryIds = [...request.loads, ...request.constraints].map(entry => entry.id);
  if (new Set(entryIds).size !== entryIds.length) throw providerError('SIMULATION_DUPLICATE_ID', 'Load and constraint IDs must be unique so simultaneous-load accumulation is deterministic.');
  if (supportedLoads.length !== request.loads.length) throw providerError('SIMULATION_LOAD_INVALID', 'The CalculiX adapter accepts only surface-force, pressure, and gravity loads.');
  if (supportedLoads.some(load => load.type === 'surface_force'
    && (load.forceN.length !== 3 || load.forceN.some(value => !Number.isFinite(value))
      || Math.hypot(...load.forceN) <= 1e-14 || Math.hypot(...load.forceN) > 1_000_000_000_000))) {
    throw providerError('SIMULATION_LOAD_INVALID', 'Each surface force must be a finite non-zero part-local vector no greater than 1,000,000,000,000 N in magnitude.');
  }
  if (!supportedConstraints.length || supportedConstraints.length !== request.constraints.length) throw providerError('SIMULATION_CONSTRAINT_INVALID', 'The CalculiX adapter requires one or more fixed or prescribed-displacement constraints.');
  const prescribedConstraints = supportedConstraints.filter((constraint): constraint is Extract<NeutralSimulationRequest['constraints'][number], { type: 'prescribed_displacement' }> => constraint.type === 'prescribed_displacement');
  if (prescribedConstraints.some(constraint => constraint.displacementMm.length !== 3
    || constraint.displacementMm.every(value => value === null)
    || constraint.displacementMm.some(value => value !== null && (!Number.isFinite(value) || Math.abs(value) > 1_000_000)))) {
    throw providerError('SIMULATION_CONSTRAINT_INVALID', 'Each prescribed displacement must define at least one finite part-local component within ±1,000,000 mm; null components remain free.');
  }
  const hasEffectivePrescribedDisplacement = prescribedConstraints.some(constraint => constraint.displacementMm.some(value => value !== null && Math.abs(value) > 1e-14));
  if (!supportedLoads.length && !hasEffectivePrescribedDisplacement) throw providerError('SIMULATION_LOAD_INVALID', 'The CalculiX adapter requires an external load or at least one non-zero prescribed-displacement component.');
  const gravityLoads = supportedLoads.filter((load): load is Extract<NeutralSimulationRequest['loads'][number], { type: 'gravity' }> => load.type === 'gravity');
  if (gravityLoads.length && (!Number.isFinite(request.material.densityKgM3) || !(request.material.densityKgM3! > 0) || request.material.densityKgM3! > 100_000)) throw providerError('SIMULATION_MATERIAL_INVALID', 'CalculiX gravity loading requires a positive material density no greater than 100,000 kg/m^3.');
  if (gravityLoads.some(load => load.accelerationMmPerS2.some(value => !Number.isFinite(value))
    || Math.hypot(...load.accelerationMmPerS2) <= 1e-9 || Math.hypot(...load.accelerationMmPerS2) > 1_000_000_000)) {
    throw providerError('SIMULATION_LOAD_INVALID', 'Each gravity acceleration must be a finite non-zero vector no greater than 1,000,000,000 mm/s^2 in magnitude.');
  }
  const gravityAcceleration = gravityLoads.reduce<NeutralVector3>((sum, load) => [
    sum[0] + load.accelerationMmPerS2[0],
    sum[1] + load.accelerationMmPerS2[1],
    sum[2] + load.accelerationMmPerS2[2],
  ], [0, 0, 0]);
  const gravityMagnitude = Math.hypot(...gravityAcceleration);
  if (!Number.isFinite(gravityMagnitude)) throw providerError('SIMULATION_LOAD_INVALID', 'The combined gravity acceleration is outside the finite solver range.');
  if (gravityLoads.length && gravityMagnitude <= 1e-9 && supportedLoads.length === gravityLoads.length) {
    throw providerError('SIMULATION_LOAD_INVALID', 'The combined gravity acceleration is zero, so the study has no effective load.');
  }
  const constraintSets = buildConstraintSets(supportedConstraints, mesh);
  const constrainedRegionIds = new Set(constraintSets.flatMap(item => item.regions.map(region => region.regionId)));
  const nodalLoads = new Map<number, NeutralVector3>();
  const facetGeometry = supportedLoads.some(load => load.type === 'pressure') ? buildBoundaryFacetGeometry(mesh) : null;
  for (const load of supportedLoads) {
    if (load.type === 'gravity') continue;
    const regions = requireMeshRegions(mesh, load.semanticReferenceIds);
    if (regions.some(region => constrainedRegionIds.has(region.regionId))) {
      throw providerError('SIMULATION_FACE_MAPPING_AMBIGUOUS', 'A loaded region is also used by a constraint.');
    }
    const facetIndices = uniqueFacetIndices(regions);
    addNodalLoads(nodalLoads, load.type === 'surface_force'
      ? consistentSurfaceLoads(mesh, facetIndices, load.forceN)
      : pressureSurfaceLoads(mesh, facetIndices, load.pressureMPa, facetGeometry!));
  }
  const lines = [
    '*HEADING',
    `TunaCAD neutral linear-static study ${safeComment(request.studyId)}`,
    '*NODE, NSET=NALL',
    ...mesh.nodes.map((point, index) => `${index + 1},${point[0]},${point[1]},${point[2]}`),
    '*ELEMENT, TYPE=C3D10, ELSET=EALL',
    ...mesh.volumeElements.connectivity.map((cell, index) => `${index + 1},${neutralToCalculiXC3D10(cell).map(node => node + 1).join(',')}`),
    ...constraintSets.flatMap(item => [
      `*NSET, NSET=${item.name}`, ...wrapIds(item.nodes.map(node => node + 1)),
      `*NSET, NSET=${item.reactionName}`, ...wrapIds(item.reactionNodes.map(node => node + 1)),
    ]),
    '*MATERIAL, NAME=TUNACAD_MATERIAL',
    '*ELASTIC',
    `${request.material.youngsModulusMPa},${request.material.poissonRatio}`,
    ...(request.material.densityKgM3 !== undefined ? ['*DENSITY', `${request.material.densityKgM3 * 1e-12}`] : []),
    '*SOLID SECTION, ELSET=EALL, MATERIAL=TUNACAD_MATERIAL',
    '*STEP',
    '*STATIC',
    '*BOUNDARY',
    ...constraintSets.flatMap(boundaryLinesForConstraint),
    ...([...nodalLoads.entries()].length ? [
      '*CLOAD',
      ...[...nodalLoads.entries()].flatMap(([node, force]) => force.flatMap((value, axis) => Math.abs(value) > 1e-14 ? [`${node + 1},${axis + 1},${value}`] : [])),
    ] : []),
    ...(gravityMagnitude > 1e-9 ? [
      '*DLOAD',
      `EALL,GRAV,${gravityMagnitude},${gravityAcceleration[0] / gravityMagnitude},${gravityAcceleration[1] / gravityMagnitude},${gravityAcceleration[2] / gravityMagnitude}`,
    ] : []),
    '*NODE PRINT, NSET=NALL, GLOBAL=YES',
    'U',
    ...constraintSets.flatMap(item => [`*NODE PRINT, NSET=${item.reactionName}, TOTALS=ONLY, GLOBAL=YES`, 'RF']),
    '*EL PRINT, ELSET=EALL',
    'S',
    ...(gravityLoads.length ? ['*EL PRINT, ELSET=EALL, TOTALS=ONLY', 'EVOL'] : []),
    '*END STEP',
  ];
  return `${lines.join('\n')}\n`;
}

function requireMeshRegion(mesh: NeutralFemMesh, semanticReferenceId: string | undefined): NeutralFemMesh['boundaryRegions'][number] {
  if (!semanticReferenceId) throw providerError('SIMULATION_REFERENCE_INVALID', 'A durable FACE reference is required.');
  const matches = mesh.boundaryRegions.filter(region => region.semanticReferenceIds.includes(semanticReferenceId) && region.match.state === 'verified' && region.facetIndices.length > 0);
  if (matches.length !== 1) throw providerError(matches.length ? 'SIMULATION_FACE_MAPPING_AMBIGUOUS' : 'SIMULATION_FACE_MAPPING_NOT_FOUND', `Durable FACE "${semanticReferenceId}" maps to ${matches.length} neutral boundary regions; exactly one is required.`);
  return matches[0];
}

function requireMeshRegions(mesh: NeutralFemMesh, semanticReferenceIds: string[]): NeutralFemMesh['boundaryRegions'] {
  if (!semanticReferenceIds.length) throw providerError('SIMULATION_REFERENCE_INVALID', 'At least one durable FACE reference is required.');
  const regions = semanticReferenceIds.map(referenceId => requireMeshRegion(mesh, referenceId));
  if (new Set(regions.map(region => region.regionId)).size !== regions.length) {
    throw providerError('SIMULATION_FACE_MAPPING_AMBIGUOUS', 'Several durable FACE references map to the same neutral boundary region.');
  }
  return regions;
}

/** Neutral quadratic tetrahedra end with edges (2-3), (1-3); CalculiX C3D10
 * expects (1-3), (2-3). Vertex order and the first four edge nodes are equal. */
function neutralToCalculiXC3D10(cell: number[]): number[] {
  if (cell.length !== 10) throw providerError('SIMULATION_MESH_ELEMENT_UNSUPPORTED', 'CalculiX C3D10 translation requires ten neutral nodes.');
  return [...cell.slice(0, 8), cell[9], cell[8]];
}

function uniqueNodes(mesh: NeutralFemMesh, facetIndices: number[]): number[] {
  return [...new Set(facetIndices.flatMap(index => mesh.boundaryFacets.connectivity[index]))].sort((a, b) => a - b);
}

function uniqueFacetIndices(regions: NeutralFemMesh['boundaryRegions']): number[] {
  return [...new Set(regions.flatMap(region => region.facetIndices))].sort((a, b) => a - b);
}

function addNodalLoads(target: Map<number, NeutralVector3>, source: Map<number, NeutralVector3>): void {
  for (const [node, force] of source) {
    const prior = target.get(node) ?? [0, 0, 0];
    target.set(node, [prior[0] + force[0], prior[1] + force[1], prior[2] + force[2]]);
  }
}

export function consistentSurfaceLoads(mesh: NeutralFemMesh, facetIndices: number[], totalForce: NeutralVector3): Map<number, NeutralVector3> {
  const facets = facetIndices.map(index => mesh.boundaryFacets.connectivity[index]);
  if (facets.some(facet => facet.length !== 6)) throw providerError('SIMULATION_MESH_ELEMENT_UNSUPPORTED', 'Quadratic triangular boundary facets are required for C3D10 loading.');
  const areas = facets.map(facet => triangleArea(facet.slice(0, 3).map(node => mesh.nodes[node]) as [NeutralVector3, NeutralVector3, NeutralVector3]));
  const totalArea = areas.reduce((sum, area) => sum + area, 0);
  if (!(totalArea > 0)) throw providerError('SIMULATION_LOAD_INVALID', 'The loaded neutral boundary region has zero area.');
  const result = new Map<number, NeutralVector3>();
  facets.forEach((facet, index) => {
    const share = areas[index] / totalArea / 3;
    for (const node of facet.slice(3, 6)) {
      const prior = result.get(node) ?? [0, 0, 0];
      result.set(node, [prior[0] + totalForce[0] * share, prior[1] + totalForce[1] * share, prior[2] + totalForce[2] * share]);
    }
  });
  return result;
}

export function parseCalculiXDat(text: string, mesh: NeutralFemMesh, expectedReactionSets: string[], expectVolume = false): CalculiXOutput {
  let mode: 'displacement' | 'reaction' | 'stress' | 'volume' | null = null;
  let reactionSet: string | null = null;
  let maximumDisplacementMm = -Infinity; let maximumDisplacementNode = -1;
  let maximumVonMisesStressMPa = -Infinity; let maximumStressElement = -1;
  let totalVolumeMm3: number | null = null;
  const reactionForcesBySet: Record<string, NeutralVector3> = {};
  const lines = text.split(/\r?\n/);
  if (lines.length > 2_000_000) throw new Error('CalculiX result contains too many records.');
  for (const rawLine of lines) {
    if (rawLine.length > 4_096) throw new Error('CalculiX result contains an oversized record.');
    const lower = rawLine.toLowerCase();
    if (lower.includes('displacements') && lower.includes('for set')) { mode = 'displacement'; continue; }
    if ((lower.includes('total force') || lower.includes('forces')) && lower.includes('for set')) {
      mode = 'reaction';
      reactionSet = /for set\s+([a-z0-9_-]+)/i.exec(rawLine)?.[1]?.toUpperCase() ?? null;
      continue;
    }
    if (lower.includes('stresses') && lower.includes('for set')) { mode = 'stress'; continue; }
    if (lower.includes('volume') && lower.includes('for set')) { mode = 'volume'; continue; }
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const values = trimmed.split(/\s+/).map(value => Number(value.replace(/[dD]/g, 'E')));
    if (!values.length || values.some(value => !Number.isFinite(value))) continue;
    if (mode === 'displacement' && values.length >= 4) {
      const node = Math.trunc(values[0]) - 1;
      if (!Number.isSafeInteger(values[0]) || node < 0 || node >= mesh.nodes.length) continue;
      const magnitude = Math.hypot(values[1], values[2], values[3]);
      if (!Number.isFinite(magnitude)) throw new Error('CalculiX displacement magnitude overflowed the finite result range.');
      if (magnitude > maximumDisplacementMm) { maximumDisplacementMm = magnitude; maximumDisplacementNode = node; }
    } else if (mode === 'reaction' && reactionSet && values.length >= 3) {
      const force = values.slice(-3); const total = reactionForcesBySet[reactionSet] ?? [0, 0, 0];
      total[0] += force[0]; total[1] += force[1]; total[2] += force[2]; reactionForcesBySet[reactionSet] = total;
      if (total.some(value => !Number.isFinite(value))) throw new Error('CalculiX reaction accumulation overflowed the finite result range.');
    } else if (mode === 'stress' && values.length >= 8) {
      const element = Math.trunc(values[0]) - 1;
      if (!Number.isSafeInteger(values[0]) || element < 0 || element >= mesh.volumeElements.connectivity.length) continue;
      const [sxx, syy, szz, sxy, sxz, syz] = values.slice(-6);
      const vonMises = Math.sqrt(0.5 * ((sxx - syy) ** 2 + (syy - szz) ** 2 + (szz - sxx) ** 2) + 3 * (sxy ** 2 + sxz ** 2 + syz ** 2));
      if (!Number.isFinite(vonMises)) throw new Error('CalculiX stress magnitude overflowed the finite result range.');
      if (vonMises > maximumVonMisesStressMPa) { maximumVonMisesStressMPa = vonMises; maximumStressElement = element; }
    } else if (mode === 'volume' && values.length >= 1) {
      totalVolumeMm3 = values[values.length - 1];
    }
  }
  if (!Number.isFinite(maximumDisplacementMm) || maximumDisplacementMm < 0
    || !Number.isFinite(maximumVonMisesStressMPa) || maximumVonMisesStressMPa < 0 || maximumDisplacementNode < 0 || maximumStressElement < 0
    || expectedReactionSets.some(setName => !reactionForcesBySet[setName] || reactionForcesBySet[setName].some(value => !Number.isFinite(value)))
    || (expectVolume && (!Number.isFinite(totalVolumeMm3) || !(totalVolumeMm3! > 0)))) {
    throw new Error(`CalculiX did not produce complete finite displacement, stress, reaction-force, and requested volume output (displacement=${maximumDisplacementMm}, node=${maximumDisplacementNode}, stress=${maximumVonMisesStressMPa}, element=${maximumStressElement}, reactionSets=${Object.keys(reactionForcesBySet).join(',')}, volume=${String(totalVolumeMm3)}).`);
  }
  const stressNodes = mesh.volumeElements.connectivity[maximumStressElement].slice(0, 4).map(node => mesh.nodes[node]);
  const maximumStressPositionMm = [0, 1, 2].map(axis => stressNodes.reduce((sum, point) => sum + point[axis], 0) / stressNodes.length) as NeutralVector3;
  return { maximumDisplacementMm, maximumDisplacementPositionMm: mesh.nodes[maximumDisplacementNode], maximumDisplacementNode, maximumVonMisesStressMPa, maximumStressPositionMm, reactionForcesBySet, totalVolumeMm3 };
}

interface BoundaryFacetGeometry { areaMm2: number; outwardNormal: NeutralVector3 }

/** Convert scalar pressure to consistent C3D10 boundary-node forces. Positive
 * pressure is compressive (opposite the local outward normal); negative
 * pressure is suction. MPa is N/mm^2, so no hidden unit conversion is needed. */
export function pressureSurfaceLoads(
  mesh: NeutralFemMesh,
  facetIndices: number[],
  pressureMPa: number,
  geometry = buildBoundaryFacetGeometry(mesh),
): Map<number, NeutralVector3> {
  if (!Number.isFinite(pressureMPa) || pressureMPa === 0 || Math.abs(pressureMPa) > 1_000_000) throw providerError('SIMULATION_LOAD_INVALID', 'Pressure must be finite, non-zero, and no greater than 1,000,000 MPa in magnitude.');
  const result = new Map<number, NeutralVector3>();
  for (const facetIndex of facetIndices) {
    const facet = mesh.boundaryFacets.connectivity[facetIndex];
    const facetEvidence = geometry[facetIndex];
    if (!facet || facet.length !== 6 || !facetEvidence) throw providerError('SIMULATION_MESH_ELEMENT_UNSUPPORTED', 'Pressure requires an oriented quadratic triangular boundary facet.');
    const totalFacetForce = facetEvidence.outwardNormal.map(value => -pressureMPa * facetEvidence.areaMm2 * value) as NeutralVector3;
    for (const node of facet.slice(3, 6)) {
      const prior = result.get(node) ?? [0, 0, 0];
      result.set(node, [prior[0] + totalFacetForce[0] / 3, prior[1] + totalFacetForce[1] / 3, prior[2] + totalFacetForce[2] / 3]);
    }
  }
  return result;
}

/** Resolve a uniform body acceleration into the total force carried by the
 * neutral volume mesh. kg/m^3 × mm^3 × mm/s^2 × 1e-12 produces newtons in the
 * CalculiX mm/N/s/tonne unit system. */
export function gravityResultant(
  mesh: NeutralFemMesh,
  densityKgM3: number,
  accelerationMmPerS2: NeutralVector3,
): NeutralVector3 {
  return sumForces(gravityNodalLoads(mesh, densityKgM3, accelerationMmPerS2));
}

/** Independently integrate the consistent C3D10 nodal body loads. CalculiX's
 * printed RF total omits body-load contributions attached directly to fixed
 * nodes, so normalization uses this map to restore those support reactions. */
export function gravityNodalLoads(
  mesh: NeutralFemMesh,
  densityKgM3: number,
  accelerationMmPerS2: NeutralVector3,
): Map<number, NeutralVector3> {
  if (!Number.isFinite(densityKgM3) || densityKgM3 <= 0 || densityKgM3 > 100_000) throw providerError('SIMULATION_MATERIAL_INVALID', 'Gravity requires a positive finite material density no greater than 100,000 kg/m^3.');
  if (accelerationMmPerS2.some(value => !Number.isFinite(value)) || Math.hypot(...accelerationMmPerS2) <= 1e-9 || Math.hypot(...accelerationMmPerS2) > 1_000_000_000) {
    throw providerError('SIMULATION_LOAD_INVALID', 'Gravity acceleration must be a finite non-zero vector no greater than 1,000,000,000 mm/s^2 in magnitude.');
  }
  const result = new Map<number, NeutralVector3>();
  for (const cell of mesh.volumeElements.connectivity) {
    if (cell.length !== 10) throw providerError('SIMULATION_MESH_ELEMENT_UNSUPPORTED', 'Gravity requires complete second-order C3D10 tetrahedra.');
    const points = cell.map(node => mesh.nodes[node]);
    for (const sample of quadraticTetraIntegration(points)) {
      cell.forEach((node, localNode) => {
        const scale = densityKgM3 * 1e-12 * sample.volumeWeightMm3 * sample.shapeFunctions[localNode];
        const prior = result.get(node) ?? [0, 0, 0];
        result.set(node, [
          prior[0] + accelerationMmPerS2[0] * scale,
          prior[1] + accelerationMmPerS2[1] * scale,
          prior[2] + accelerationMmPerS2[2] * scale,
        ]);
      });
    }
  }
  if (!result.size || [...result.values()].some(force => force.some(value => !Number.isFinite(value)))) throw providerError('SIMULATION_MESH_INVALID', 'Gravity produced no finite consistent nodal body loads.');
  return result;
}

/** Four-point tetrahedral quadrature matches CalculiX C3D10 volume/body-load
 * integration and accounts for displaced midside nodes on curved geometry. */
export function quadraticTetraVolumeMm3(points: NeutralVector3[]): number {
  return quadraticTetraIntegration(points).reduce((sum, sample) => sum + sample.volumeWeightMm3, 0);
}

interface QuadraticTetraIntegrationSample { volumeWeightMm3: number; shapeFunctions: number[] }

function quadraticTetraIntegration(points: NeutralVector3[]): QuadraticTetraIntegrationSample[] {
  if (points.length !== 10 || points.some(point => point.some(value => !Number.isFinite(value)))) {
    throw providerError('SIMULATION_MESH_ELEMENT_UNSUPPORTED', 'C3D10 volume integration requires ten finite neutral nodes.');
  }
  const a = 0.5854101966249685;
  const b = 0.1381966011250105;
  const barycentricPoints: NeutralVector3[] = [
    [b, b, b], [a, b, b], [b, a, b], [b, b, a],
  ];
  let orientation = 0;
  return barycentricPoints.map(([r, s, t]) => {
    const barycentric = [1 - r - s - t, r, s, t];
    const shapeFunctions = barycentric.map(value => value * (2 * value - 1));
    for (const [node, i, j] of [[4, 0, 1], [5, 1, 2], [6, 2, 0], [7, 0, 3], [8, 2, 3], [9, 1, 3]] as const) {
      shapeFunctions[node] = 4 * barycentric[i] * barycentric[j];
    }
    const derivatives = [
      [-1, 1, 0, 0],
      [-1, 0, 1, 0],
      [-1, 0, 0, 1],
    ];
    const gradients = derivatives.map(derivative => {
      const result = barycentric.map((value, index) => (4 * value - 1) * derivative[index]);
      for (const [node, i, j] of [[4, 0, 1], [5, 1, 2], [6, 2, 0], [7, 0, 3], [8, 2, 3], [9, 1, 3]] as const) {
        result[node] = 4 * (derivative[i] * barycentric[j] + barycentric[i] * derivative[j]);
      }
      return result;
    });
    const jacobianColumns = gradients.map(gradient => [0, 1, 2].map(axis => points.reduce((sum, point, node) => sum + point[axis] * gradient[node], 0)) as NeutralVector3);
    const determinant = dotVector(jacobianColumns[0], crossVector(jacobianColumns[1], jacobianColumns[2]));
    if (!Number.isFinite(determinant) || Math.abs(determinant) <= 1e-18) throw providerError('SIMULATION_MESH_INVALID', 'Gravity encountered a singular C3D10 Jacobian.');
    const sign = Math.sign(determinant);
    if (orientation && sign !== orientation) throw providerError('SIMULATION_MESH_INVALID', 'Gravity encountered an inverted C3D10 element.');
    orientation = sign;
    return { volumeWeightMm3: Math.abs(determinant) / 24, shapeFunctions };
  });
}

function buildBoundaryFacetGeometry(mesh: NeutralFemMesh): BoundaryFacetGeometry[] {
  const adjacentCells = new Map<string, NeutralVector3[]>();
  for (const cell of mesh.volumeElements.connectivity) {
    const vertices = cell.slice(0, 4);
    const center = centroid(vertices.map(node => mesh.nodes[node]));
    for (const localFace of [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]]) {
      const key = faceKey(localFace.map(index => vertices[index]));
      const entries = adjacentCells.get(key) ?? [];
      entries.push(center);
      adjacentCells.set(key, entries);
    }
  }
  return mesh.boundaryFacets.connectivity.map(facet => {
    if (facet.length !== 6) throw providerError('SIMULATION_MESH_ELEMENT_UNSUPPORTED', 'Pressure requires quadratic triangular boundary facets.');
    const corners = facet.slice(0, 3);
    const cells = adjacentCells.get(faceKey(corners));
    if (!cells || cells.length !== 1) throw providerError('SIMULATION_FACE_MAPPING_AMBIGUOUS', 'A pressure facet must bound exactly one volume element.');
    const points = corners.map(node => mesh.nodes[node]) as [NeutralVector3, NeutralVector3, NeutralVector3];
    const rawNormal = crossVector(subtractVector(points[1], points[0]), subtractVector(points[2], points[0]));
    const doubleArea = Math.hypot(...rawNormal);
    if (!(doubleArea > 0)) throw providerError('SIMULATION_LOAD_INVALID', 'A pressure facet has zero area.');
    const faceCenter = centroid(points);
    const towardOutside = subtractVector(faceCenter, cells[0]);
    const orientation = dotVector(rawNormal, towardOutside) >= 0 ? 1 : -1;
    return { areaMm2: doubleArea / 2, outwardNormal: rawNormal.map(value => orientation * value / doubleArea) as NeutralVector3 };
  });
}

function normalizeResult(run: SolverRun, output: CalculiXOutput, adapterId: string, adapterVersion: string, runtimeVersion: string): NeutralSimulationResult {
  const request = run.request;
  const constraintSets = buildConstraintSets(request.constraints, run.mesh);
  const displacementBinding = bindingForNode(run.mesh, output.maximumDisplacementNode, request);
  const completedAt = new Date().toISOString();
  const factorOfSafety = request.material.yieldStrengthMPa && output.maximumVonMisesStressMPa > 0
    ? request.material.yieldStrengthMPa / output.maximumVonMisesStressMPa
    : null;
  const pressureGeometry = request.loads.some(load => load.type === 'pressure') ? buildBoundaryFacetGeometry(run.mesh) : null;
  const combinedAppliedNodalLoads = new Map<number, NeutralVector3>();
  for (const load of request.loads) {
    const nodalLoad = load.type === 'gravity'
      ? gravityNodalLoads(run.mesh, request.material.densityKgM3!, load.accelerationMmPerS2)
      : load.type === 'surface_force'
        ? consistentSurfaceLoads(run.mesh, uniqueFacetIndices(requireMeshRegions(run.mesh, load.semanticReferenceIds)), load.forceN)
        : pressureSurfaceLoads(run.mesh, uniqueFacetIndices(requireMeshRegions(run.mesh, load.semanticReferenceIds)), load.pressureMPa, pressureGeometry!);
    addNodalLoads(combinedAppliedNodalLoads, nodalLoad);
  }
  // CalculiX RF totals omit external nodal-load contributions applied directly
  // to restrained DOFs. Restore those contributions once, using the disjoint
  // reaction-node partition, so adjacent load/support FACE edges still balance.
  const reactions = request.constraints.map((constraint, index) => ({
    constraintId: constraint.id,
    forceN: subtractVector(
      output.reactionForcesBySet[reactionSetName(index)],
      sumForcesAtNodes(combinedAppliedNodalLoads, constraintSets[index].reactionNodes),
    ),
    semanticReferenceIds: [...constraint.semanticReferenceIds],
  }));
  const hasGravity = request.loads.some(load => load.type === 'gravity');
  if (hasGravity) {
    const solverVolumeRelativeError = Math.abs(output.totalVolumeMm3! - request.geometry.shape.volumeMm3) / request.geometry.shape.volumeMm3;
    if (!Number.isFinite(solverVolumeRelativeError) || solverVolumeRelativeError > 0.05) throw new Error(`CalculiX element volume differs from the approved CAD volume by ${solverVolumeRelativeError}; the maximum is 0.05.`);
  }
  const appliedForce = request.loads.reduce<NeutralVector3>((sum, load) => {
    const force = load.type === 'surface_force'
      ? load.forceN
      : load.type === 'pressure'
        ? sumForces(pressureSurfaceLoads(run.mesh, uniqueFacetIndices(requireMeshRegions(run.mesh, load.semanticReferenceIds)), load.pressureMPa, pressureGeometry!))
        : gravityResultant(run.mesh, request.material.densityKgM3!, load.accelerationMmPerS2);
    return [sum[0] + force[0], sum[1] + force[1], sum[2] + force[2]];
  }, [0, 0, 0]);
  const reactionForce = reactions.reduce<NeutralVector3>((sum, reaction) => [sum[0] + reaction.forceN[0], sum[1] + reaction.forceN[1], sum[2] + reaction.forceN[2]], [0, 0, 0]);
  const equilibriumResidual = Math.hypot(appliedForce[0] + reactionForce[0], appliedForce[1] + reactionForce[1], appliedForce[2] + reactionForce[2]);
  const equilibriumScale = Math.max(
    Math.hypot(...appliedForce),
    reactions.reduce((sum, reaction) => sum + Math.hypot(...reaction.forceN), 0),
  );
  const equilibriumTolerance = Math.max(1e-6, equilibriumScale * 1e-4);
  if (equilibriumResidual > equilibriumTolerance) throw new Error(`CalculiX reaction/load equilibrium residual ${equilibriumResidual} N exceeds ${equilibriumTolerance} N (applied ${appliedForce.join(', ')} N; reaction ${reactionForce.join(', ')} N).`);
  const positiveDimensions = request.geometry.shape.boundingBoxMm.size.filter(value => value > 0);
  const smallestDimensionMm = positiveDimensions.length ? Math.min(...positiveDimensions) : null;
  const exceedsSmallDisplacementAssumption = smallestDimensionMm !== null && output.maximumDisplacementMm > smallestDimensionMm * 0.1;
  const warnings: NeutralSimulationResult['warnings'] = [
    { code: 'SIMULATION_PROVIDER_POC', message: 'External CalculiX proof of concept; results require mesh convergence and qualified-engineer review.', severity: 'warning' },
  ];
  if (exceedsSmallDisplacementAssumption) warnings.push({
    code: 'SIMULATION_SMALL_DISPLACEMENT_ASSUMPTION_EXCEEDED',
    message: `Maximum displacement ${output.maximumDisplacementMm} mm exceeds 10% of the model's smallest ${smallestDimensionMm} mm dimension; linear small-displacement results are not valid for engineering use.`,
    severity: 'critical',
  });
  return {
    schema: NEUTRAL_SIMULATION_RESULT_SCHEMA, studyId: request.studyId, jobId: '', requestDigest: request.requestDigest,
    projectRevision: request.geometry.projectRevision, analysisType: request.analysis.type, status: 'succeeded', authority: 'engineering',
    metrics: { maximumVonMisesStressMPa: output.maximumVonMisesStressMPa, maximumDisplacementMm: output.maximumDisplacementMm, minimumFactorOfSafety: factorOfSafety },
    reactions,
    criticalRegions: [
      hotspot('calculix-stress-maximum', 'stress', output.maximumVonMisesStressMPa, 'MPa', output.maximumStressPositionMm, null, 'Maximum CalculiX integration-point von Mises stress.'),
      hotspot('calculix-displacement-maximum', 'displacement', output.maximumDisplacementMm, 'mm', output.maximumDisplacementPositionMm, displacementBinding, 'Maximum CalculiX nodal displacement.'),
    ],
    failedConstraints: [],
    warnings,
    convergence: { status: 'converged', iterations: null, residual: null, providerDeclared: true },
    suggestedEngineeringIssues: [
      'Inspect the mapped constraint/load regions and repeat with a refined mesh.',
      'Verify material, loading and reference intent before design decisions.',
      ...(exceedsSmallDisplacementAssumption ? ['Use a geometrically nonlinear analysis or reduce loading before interpreting this result.'] : []),
    ],
    provenance: { providerInterfaceVersion: SIMULATION_PROVIDER_INTERFACE_VERSION, adapterId, adapterVersion, providerRunId: run.providerRunId, submittedAt: run.submittedAt, completedAt, normalizedAt: completedAt },
    review: { engineerReviewRequired: true, engineeringUsePermitted: false, disclaimer: `External CalculiX ${runtimeVersion} proof-of-concept result. Not certified; qualified-engineer review is mandatory.` },
    mutation: { occurred: false, projectRevisionBefore: request.geometry.projectRevision, projectRevisionAfter: request.geometry.projectRevision },
  };
}

function constraintSetName(index: number, type: NeutralSimulationRequest['constraints'][number]['type']): string {
  return `${type === 'fixed' ? 'FIXED' : 'PRESCRIBED'}_${String(index + 1).padStart(3, '0')}`;
}

function reactionSetName(index: number): string {
  return `REACTION_${String(index + 1).padStart(3, '0')}`;
}

interface ConstraintSet {
  name: string;
  reactionName: string;
  constraint: NeutralSimulationRequest['constraints'][number];
  regions: NeutralFemMesh['boundaryRegions'];
  nodes: number[];
  reactionNodes: number[];
}

/** Build constraint boundary sets using FACE-area overlap, not incidental
 * shared edge/corner nodes. Compatible shared nodes are constrained once by
 * CalculiX and assigned to exactly one reaction set in stable constraint-ID
 * order, preventing reaction double-counting while preserving each entry. */
export function buildConstraintSets(
  constraints: NeutralSimulationRequest['constraints'],
  mesh: NeutralFemMesh,
): ConstraintSet[] {
  const sets = constraints.map((constraint, index) => {
    const regions = requireMeshRegions(mesh, constraint.semanticReferenceIds);
    const facets = uniqueFacetIndices(regions);
    return {
      name: constraintSetName(index, constraint.type),
      reactionName: reactionSetName(index),
      constraint,
      regions,
      facets,
      nodes: uniqueNodes(mesh, facets),
      reactionNodes: [] as number[],
    };
  });
  const claimedFacets = new Map<number, string>();
  const prescribedValues = new Map<string, { value: number; constraintId: string }>();
  for (const set of sets) {
    for (const facet of set.facets) {
      const owner = claimedFacets.get(facet);
      if (owner) throw providerError('SIMULATION_CONSTRAINT_INVALID', `Constraint FACE groups "${owner}" and "${set.constraint.id}" overlap on a boundary facet.`);
      claimedFacets.set(facet, set.constraint.id);
    }
    const values = set.constraint.type === 'fixed' ? [0, 0, 0] : set.constraint.displacementMm;
    for (const node of set.nodes) {
      values.forEach((value, axis) => {
        if (value === null) return;
        const key = `${node}:${axis}`;
        const existing = prescribedValues.get(key);
        if (existing && Math.abs(existing.value - value) > 1e-12) {
          throw providerError('SIMULATION_CONSTRAINT_INVALID', `Constraints "${existing.constraintId}" and "${set.constraint.id}" prescribe incompatible component ${axis + 1} values on a shared FACE-edge node.`);
        }
        if (!existing) prescribedValues.set(key, { value, constraintId: set.constraint.id });
      });
    }
  }
  const reactionOwner = new Map<number, number>();
  [...sets.keys()]
    .sort((a, b) => compareStableText(sets[a].constraint.id, sets[b].constraint.id) || a - b)
    .forEach(index => sets[index].nodes.forEach(node => { if (!reactionOwner.has(node)) reactionOwner.set(node, index); }));
  sets.forEach((set, index) => {
    set.reactionNodes = set.nodes.filter(node => reactionOwner.get(node) === index);
    if (!set.reactionNodes.length) throw providerError('SIMULATION_CONSTRAINT_INVALID', `Constraint "${set.constraint.id}" has no uniquely attributable reaction nodes.`);
  });
  return sets;
}

function boundaryLinesForConstraint(item: {
  name: string;
  constraint: NeutralSimulationRequest['constraints'][number];
}): string[] {
  if (item.constraint.type === 'fixed') return [`${item.name},1,3,0`];
  return item.constraint.displacementMm.flatMap((value, axis) => value === null
    ? []
    : [`${item.name},${axis + 1},${axis + 1},${value}`]);
}

function bindingForNode(mesh: NeutralFemMesh, node: number, request: NeutralSimulationRequest): NeutralSimulationReferenceBinding | null {
  const matches = mesh.boundaryRegions.filter(region => region.facetIndices.some(index => mesh.boundaryFacets.connectivity[index].includes(node)));
  if (matches.length !== 1 || matches[0].semanticReferenceIds.length !== 1) return null;
  return request.geometry.references.find(item => item.semanticReferenceId === matches[0].semanticReferenceIds[0]) ?? null;
}

function hotspot(id: string, kind: 'stress' | 'displacement', value: number, unit: 'MPa' | 'mm', position: NeutralVector3, binding: NeutralSimulationReferenceBinding | null, description: string): NeutralSimulationResult['criticalRegions'][number] {
  return { id, kind, severity: 'warning', value, unit, positionPartLocalMm: position, semanticReferenceIds: binding ? [binding.semanticReferenceId] : [], featureIds: binding?.sourceFeatureId ? [binding.sourceFeatureId] : [], description, inspect: ['Inspect the reported part-local location and any verified durable FACE mapping.'], mapping: binding ? 'durable_reference' : 'part_local_location' };
}

function wrapIds(ids: number[]): string[] { const lines: string[] = []; for (let index = 0; index < ids.length; index += 16) lines.push(ids.slice(index, index + 16).join(',')); return lines; }
function safeComment(value: string): string { return value.replace(/[^A-Za-z0-9 _.:-]/g, '').slice(0, 120); }
function compareStableText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function triangleArea([a, b, c]: [NeutralVector3, NeutralVector3, NeutralVector3]): number { const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; return Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2; }
function centroid(points: NeutralVector3[]): NeutralVector3 { return [0, 1, 2].map(axis => points.reduce((sum, point) => sum + point[axis], 0) / points.length) as NeutralVector3; }
function faceKey(nodes: number[]): string { return [...nodes].sort((a, b) => a - b).join(':'); }
function subtractVector(a: NeutralVector3, b: NeutralVector3): NeutralVector3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function crossVector(a: NeutralVector3, b: NeutralVector3): NeutralVector3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dotVector(a: NeutralVector3, b: NeutralVector3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function sumForces(loads: Map<number, NeutralVector3>): NeutralVector3 { return [...loads.values()].reduce<NeutralVector3>((sum, force) => [sum[0] + force[0], sum[1] + force[1], sum[2] + force[2]], [0, 0, 0]); }
function sumForcesAtNodes(loads: Map<number, NeutralVector3>, nodes: number[]): NeutralVector3 { return nodes.reduce<NeutralVector3>((sum, node) => { const force = loads.get(node) ?? [0, 0, 0]; return [sum[0] + force[0], sum[1] + force[1], sum[2] + force[2]]; }, [0, 0, 0]); }
function executableEnvironment(executable: string): NodeJS.ProcessEnv { return { ...process.env, PATH: `${dirname(executable)}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}` }; }
function nodeMajorVersion(): number { return Number.parseInt(process.versions.node.split('.')[0] ?? '', 10); }
function providerError(code: string, message: string): Error & { code: string } { return Object.assign(new Error(message), { code }); }
