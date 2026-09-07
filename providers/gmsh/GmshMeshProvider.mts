import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import {
  MESH_PROVIDER_INTERFACE_VERSION,
  NEUTRAL_FEM_MESH_SCHEMA,
  type ExternalMeshProvider,
  type MeshProviderCapabilities,
  type MeshProviderStatus,
  type MeshProviderSubmission,
  type NeutralFemMesh,
  type NeutralMeshBoundaryRequest,
  type NeutralMeshJobRequest,
  type NeutralSimulationReferenceBinding,
  type NeutralVector3,
  type SimulationGeometryResolver,
} from '../../src/simulation/externalSimulationContracts.ts';
import { quadraticTetraVolume, quadraticTriangleSurfaceSamples, tetraMeanRatio, validateNeutralFemMesh } from '../../src/simulation/neutralFemMesh.ts';
import {
  LOCAL_PROVIDER_RESOURCE_LIMITS,
  hasEnforcedProviderProcessQuotas,
  monitorWorkingDirectory,
  readUtf8FileBounded,
  removeWorkingDirectory,
  spawnProviderProcess,
  terminateChildProcess,
} from '../processLifecycle.mts';

interface MeshRun {
  request: NeutralMeshJobRequest;
  meshRunId: string;
  directory: string;
  process: ChildProcess;
  status: MeshProviderStatus;
  mesh: NeutralFemMesh | null;
  timeout: NodeJS.Timeout;
  stopResourceMonitor: () => void;
}

interface ParsedMsh {
  nodes: NeutralVector3[];
  nodeIndexByTag: Map<number, number>;
  tetrahedra: Array<{ entityTag: number; connectivity: number[] }>;
  triangles: Array<{ entityTag: number; connectivity: number[] }>;
}

/** Node-only adapter for a user-installed Gmsh executable. Gmsh is neither
 * imported into TunaCAD nor distributed with the Bridge. */
export class GmshMeshProvider implements ExternalMeshProvider {
  readonly id = 'tunacad-gmsh-mesh-poc';
  readonly version = '0.1.0-poc';
  readonly capabilities: MeshProviderCapabilities = {
    interfaceVersion: MESH_PROVIDER_INTERFACE_VERSION,
    geometryFormats: ['step'] as const,
    elementFamilies: ['tetrahedral'] as const,
    geometryOrders: [2] as const,
    asynchronous: true as const,
    cancellation: true as const,
    durableReferenceMapping: 'supported' as const,
    qualification: {
      status: 'proof_of_concept' as const,
      engineeringUsePermitted: false,
      statement: 'Local Gmsh meshing adapter with version-bound benchmark evidence; independent engineering review is still required before qualified use.',
      limitations: ['Windows development-host evidence only', 'Second-order tetrahedral volume meshes only'],
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
      privacyDisclosure: 'Approved STEP geometry is written to an operating-system temporary directory and processed by the explicitly configured local Gmsh executable. Files are removed after neutral-mesh normalization.',
      queueTimeoutMs: 5_000,
      executionTimeoutMs: 120_000,
      totalTimeoutMs: 125_000,
      rawArtifactRetentionMs: 0,
      normalizedResultRetentionMs: 20 * 60 * 1000,
      resourceLimits: {
        maximumInputGeometryBytes: LOCAL_PROVIDER_RESOURCE_LIMITS.maximumStepBytes,
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
  private readonly runs = new Map<string, MeshRun>();

  constructor(options: { executable: string; runtimeVersion: string }) {
    if (!options.executable?.trim() || !/^gmsh(?:\.exe)?$/i.test(basename(options.executable))) {
      throw meshError('SIMULATION_MESHER_UNAVAILABLE', 'An explicit Gmsh executable is required.');
    }
    this.executable = resolve(options.executable);
    this.runtimeVersion = options.runtimeVersion;
    if (!hasEnforcedProviderProcessQuotas()) {
      Object.assign(this.capabilities.qualification, {
        status: 'unsupported' as const,
        engineeringUsePermitted: false,
        statement: `Gmsh execution on ${process.platform}/${process.arch} is outside the supported provider boundary because OS-enforced CPU and memory quotas are not implemented.`,
        evidence: null,
      });
    } else if (nodeMajorVersion() !== 24 || options.runtimeVersion !== '4.15.2') {
      Object.assign(this.capabilities.qualification, {
        statement: `Local Gmsh ${options.runtimeVersion} adapter on Node ${process.versions.node} is outside the recorded Windows x64 / Node 24 / Gmsh 4.15.2 qualification matrix.`,
        evidence: null,
      });
    }
  }

  async submit(request: NeutralMeshJobRequest, geometry: SimulationGeometryResolver): Promise<MeshProviderSubmission> {
    const step = await geometry.export('step');
    if (step.byteLength > LOCAL_PROVIDER_RESOURCE_LIMITS.maximumStepBytes) throw meshError('SIMULATION_INPUT_LIMIT', `Approved STEP geometry exceeds the ${LOCAL_PROVIDER_RESOURCE_LIMITS.maximumStepBytes}-byte provider limit.`);
    validateStepEnvelope(step);
    const directory = await mkdtemp(join(tmpdir(), 'tunacad-gmsh-mesh-'));
    const meshRunId = `gmshmesh_${crypto.randomUUID()}`;
    const acceptedAt = new Date().toISOString();
    const stepPath = join(directory, 'geometry.step');
    const geoPath = join(directory, 'mesh.geo');
    const meshPath = join(directory, 'mesh.msh');
    await Promise.all([
      writeFile(stepPath, step),
      writeFile(geoPath, gmshScript(stepPath, request), 'utf8'),
    ]);
    const child = spawnProviderProcess(this.executable, [geoPath, '-3', '-format', 'msh4', '-o', meshPath, '-v', '2'], {
      cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: executableEnvironment(this.executable),
    });
    const run = {
      request, meshRunId, directory, process: child, mesh: null,
      status: { meshRunId, status: 'running', progress: null, phase: 'gmsh_step_import_and_meshing', updatedAt: acceptedAt },
      timeout: undefined as unknown as NodeJS.Timeout,
      stopResourceMonitor: () => undefined,
    } satisfies MeshRun;
    run.timeout = setTimeout(() => { void this.failRun(run, 'SIMULATION_MESH_TIMEOUT', 'Gmsh exceeded its declared execution timeout.'); }, this.capabilities.execution.executionTimeoutMs);
    run.timeout.unref();
    this.runs.set(meshRunId, run);
    let stderr = '';
    child.stderr?.on('data', chunk => { stderr = `${stderr}${String(chunk)}`.slice(-LOCAL_PROVIDER_RESOURCE_LIMITS.maximumDiagnosticCharacters); });
    child.once('error', () => void this.failRun(run, 'SIMULATION_MESHER_UNAVAILABLE', 'The configured external Gmsh process could not be started.'));
    child.once('exit', (code, signal) => void this.finishRun(run, meshPath, geometry.descriptor, code, signal, stderr));
    run.stopResourceMonitor = monitorWorkingDirectory({
      child,
      directory,
      onExceeded: bytes => this.failRun(run, 'SIMULATION_DISK_LIMIT', `Gmsh working data exceeded the ${LOCAL_PROVIDER_RESOURCE_LIMITS.maximumWorkingDirectoryBytes}-byte limit (${bytes} bytes observed).`),
    });
    return { meshRunId, acceptedAt };
  }

  async getStatus(meshRunId: string): Promise<MeshProviderStatus> { return structuredClone(this.requireRun(meshRunId).status); }
  async getMesh(meshRunId: string): Promise<NeutralFemMesh | null> { return structuredClone(this.requireRun(meshRunId).mesh); }

  async cancel(meshRunId: string): Promise<MeshProviderStatus> {
    const run = this.requireRun(meshRunId);
    if (run.status.status === 'running' || run.status.status === 'queued') {
      run.status = { meshRunId, status: 'cancelled', progress: null, phase: 'cancelled', updatedAt: new Date().toISOString() };
      clearTimeout(run.timeout); run.stopResourceMonitor(); run.mesh = null;
      const terminated = await terminateChildProcess(run.process);
      const cleaned = await removeWorkingDirectory(run.directory);
      run.status = {
        ...run.status,
        phase: terminated && cleaned ? 'cancelled_cleaned' : 'cancelled_cleanup_pending',
        ...(!terminated || !cleaned ? { failure: { code: 'SIMULATION_CLEANUP_FAILED', message: 'Gmsh cancellation could not confirm process termination and temporary-data cleanup.' } } : {}),
        updatedAt: new Date().toISOString(),
      };
    }
    return structuredClone(run.status);
  }

  private async finishRun(run: MeshRun, meshPath: string, descriptor: SimulationGeometryResolver['descriptor'], code: number | null, signal: NodeJS.Signals | null, stderr: string): Promise<void> {
    run.stopResourceMonitor();
    if (run.status.status === 'cancelled' || run.status.status === 'failed') { await removeWorkingDirectory(run.directory); return; }
    clearTimeout(run.timeout);
    if (code !== 0) {
      const diagnostic = stderr.split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? '';
      await this.failRun(run, 'SIMULATION_MESH_FAILED', `Gmsh exited with code ${String(code)}${signal ? ` (${signal})` : ''}.${diagnostic ? ` ${diagnostic.slice(0, 800)}` : ''}`);
      return;
    }
    try {
      const parsed = parseMsh41(await readUtf8FileBounded(meshPath), run.request.mesh.maximumNodes, run.request.mesh.maximumElements);
      const mesh = normalizeMesh(parsed, run.request, descriptor, this.id, this.version, this.runtimeVersion);
      validateNeutralFemMesh(mesh, run.request);
      run.mesh = mesh;
      run.status = { meshRunId: run.meshRunId, status: 'succeeded', progress: 1, phase: 'mesh_validated', updatedAt: new Date().toISOString() };
    } catch (error) {
      const typed = error as Error & { code?: string };
      await this.failRun(run, typed.code ?? 'SIMULATION_MESH_UNTRUSTED', typed.message);
      return;
    }
    await removeWorkingDirectory(run.directory);
  }

  private async failRun(run: MeshRun, code: string, message: string): Promise<void> {
    if (run.status.status === 'cancelled' || run.status.status === 'failed') return;
    clearTimeout(run.timeout); run.stopResourceMonitor(); run.mesh = null;
    run.status = { meshRunId: run.meshRunId, status: 'failed', progress: null, phase: 'failed', updatedAt: new Date().toISOString(), failure: { code, message: message.slice(0, 2_000) } };
    await terminateChildProcess(run.process);
    await removeWorkingDirectory(run.directory);
  }

  private requireRun(meshRunId: string): MeshRun {
    const run = this.runs.get(meshRunId);
    if (!run) throw meshError('SIMULATION_JOB_NOT_FOUND', `Unknown Gmsh mesh run "${meshRunId}".`);
    return run;
  }
}

function gmshScript(stepPath: string, request: NeutralMeshJobRequest): string {
  const path = stepPath.replace(/\\/g, '/').replace(/"/g, '\\"');
  return [
    'SetFactory("OpenCASCADE");',
    'Mesh.MshFileVersion = 4.1;',
    'Mesh.Binary = 0;',
    'Mesh.ElementOrder = 2;',
    'Mesh.SecondOrderIncomplete = 0;',
    `Mesh.MeshSizeMax = ${request.mesh.globalSizeMm};`,
    `Mesh.MeshSizeMin = ${request.mesh.minimumSizeMm ?? request.mesh.globalSizeMm / 10};`,
    `Merge "${path}";`,
  ].join('\n');
}

export function validateStepEnvelope(step: Uint8Array): void {
  if (step.byteLength < 128) throw meshError('SIMULATION_GEOMETRY_EXPORT_INVALID', 'Approved geometry is too short to be a complete STEP exchange file.');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(step);
  } catch {
    throw meshError('SIMULATION_GEOMETRY_EXPORT_INVALID', 'Approved STEP geometry is not valid UTF-8 text.');
  }
  if (/[^\t\r\n\x20-\x7e]/.test(text)) throw meshError('SIMULATION_GEOMETRY_EXPORT_INVALID', 'Approved STEP geometry contains forbidden control or non-ASCII bytes.');
  const normalized = text.replace(/\r/g, '');
  if (!/^\s*ISO-10303-21;\s*HEADER;/i.test(normalized)
    || !/HEADER;[\s\S]*?ENDSEC;\s*DATA;/i.test(normalized)
    || !/DATA;[\s\S]*#[1-9]\d*\s*=/.test(normalized)
    || !/DATA;[\s\S]*?ENDSEC;\s*END-ISO-10303-21;\s*$/i.test(normalized)) {
    throw meshError('SIMULATION_GEOMETRY_EXPORT_INVALID', 'Approved geometry does not contain one complete STEP header/data/end envelope.');
  }
}

export function parseMsh41(text: string, maximumNodes = 500_000, maximumVolumeElements = 250_000): ParsedMsh {
  if (!/\$MeshFormat\s+4\.1\s+0\s+8\s+\$EndMeshFormat/.test(text.replace(/\r/g, ''))) throw meshError('SIMULATION_MESH_FORMAT_INVALID', 'Gmsh did not return an ASCII MSH 4.1 mesh.');
  const nodesTokens = section(text, 'Nodes').trim().split(/\s+/);
  let cursor = 0;
  const take = () => { const value = Number(nodesTokens[cursor++]); if (!Number.isFinite(value)) throw meshError('SIMULATION_MESH_FORMAT_INVALID', 'Invalid Gmsh node section.'); return value; };
  const takeNodeCount = () => integerCount(take(), 'node');
  const nodeBlocks = takeNodeCount(); const nodeCount = takeNodeCount(); take(); take();
  if (nodeCount > maximumNodes || nodeBlocks > Math.max(nodeCount, 1)) throw meshError('SIMULATION_MESH_LIMIT', `Gmsh declared ${nodeCount} nodes in ${nodeBlocks} blocks; the admitted node limit is ${maximumNodes}.`);
  const nodeCoordinates = new Map<number, NeutralVector3>();
  let parsedNodeCount = 0;
  for (let block = 0; block < nodeBlocks; block++) {
    const entityDimension = integerCount(take(), 'node entity dimension'); take(); const parametric = integerCount(take(), 'node parametric flag'); const count = takeNodeCount();
    if (entityDimension > 3 || parametric > 1 || count > nodeCount - parsedNodeCount) throw meshError('SIMULATION_MESH_FORMAT_INVALID', 'Invalid or excessive Gmsh node block.');
    const tags = Array.from({ length: count }, () => positiveInteger(take(), 'node tag'));
    for (const tag of tags) {
      const point: NeutralVector3 = [take(), take(), take()];
      if (parametric) for (let ii = 0; ii < entityDimension; ii++) take();
      nodeCoordinates.set(tag, point);
    }
    parsedNodeCount += count;
  }
  if (nodeCoordinates.size !== nodeCount || cursor !== nodesTokens.length) throw meshError('SIMULATION_MESH_FORMAT_INVALID', 'Gmsh node count or section length is inconsistent.');
  const ordered = [...nodeCoordinates.entries()].sort(([a], [b]) => a - b);
  const nodes = ordered.map(([, point]) => point);
  const nodeIndexByTag = new Map(ordered.map(([tag], index) => [tag, index]));

  const elementTokens = section(text, 'Elements').trim().split(/\s+/);
  cursor = 0;
  const takeElement = () => { const value = Number(elementTokens[cursor++]); if (!Number.isFinite(value)) throw meshError('SIMULATION_MESH_FORMAT_INVALID', 'Invalid Gmsh element section.'); return value; };
  const takeElementCount = () => integerCount(takeElement(), 'element');
  const elementBlocks = takeElementCount(); const totalElementCount = takeElementCount(); takeElement(); takeElement();
  const maximumTotalElements = Math.max(1_000, maximumVolumeElements * 6);
  if (totalElementCount > maximumTotalElements || elementBlocks > Math.max(totalElementCount, 1)) throw meshError('SIMULATION_MESH_LIMIT', `Gmsh declared ${totalElementCount} total elements; the bounded parser limit is ${maximumTotalElements}.`);
  const tetrahedra: ParsedMsh['tetrahedra'] = []; const triangles: ParsedMsh['triangles'] = [];
  let parsedElementCount = 0;
  for (let block = 0; block < elementBlocks; block++) {
    const dimension = integerCount(takeElement(), 'element dimension'); const entityTag = takeElement(); const elementType = integerCount(takeElement(), 'element type'); const count = takeElementCount();
    if (dimension > 3 || count > totalElementCount - parsedElementCount) throw meshError('SIMULATION_MESH_FORMAT_INVALID', 'Invalid or excessive Gmsh element block.');
    const width = elementType === 11 ? 10 : elementType === 9 ? 6 : gmshElementWidth(elementType);
    for (let ii = 0; ii < count; ii++) {
      positiveInteger(takeElement(), 'element tag');
      const tags = Array.from({ length: width }, () => positiveInteger(takeElement(), 'element node tag'));
      const connectivity = tags.map(tag => {
        const index = nodeIndexByTag.get(tag);
        if (index === undefined) throw meshError('SIMULATION_MESH_FORMAT_INVALID', 'Gmsh element references an unknown node.');
        return index;
      });
      if (dimension === 3 && elementType === 11) tetrahedra.push({ entityTag, connectivity });
      if (dimension === 2 && elementType === 9) triangles.push({ entityTag, connectivity });
    }
    parsedElementCount += count;
  }
  if (parsedElementCount !== totalElementCount || cursor !== elementTokens.length) throw meshError('SIMULATION_MESH_FORMAT_INVALID', 'Gmsh element count or section length is inconsistent.');
  if (tetrahedra.length > maximumVolumeElements) throw meshError('SIMULATION_MESH_LIMIT', `Gmsh produced ${tetrahedra.length} volume elements; the admitted limit is ${maximumVolumeElements}.`);
  if (!tetrahedra.length || !triangles.length) throw meshError('SIMULATION_MESH_ELEMENT_UNSUPPORTED', 'Gmsh must produce complete second-order tetrahedra and triangular boundary facets.');
  return { nodes, nodeIndexByTag, tetrahedra, triangles };
}

function integerCount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw meshError('SIMULATION_MESH_FORMAT_INVALID', `Invalid Gmsh ${label} count.`);
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw meshError('SIMULATION_MESH_FORMAT_INVALID', `Invalid Gmsh ${label}.`);
  return value;
}

function section(text: string, name: string): string {
  const match = new RegExp(`\\$${name}\\s+([\\s\\S]*?)\\$End${name}`).exec(text);
  if (!match) throw meshError('SIMULATION_MESH_FORMAT_INVALID', `Gmsh mesh is missing the ${name} section.`);
  return match[1];
}

function gmshElementWidth(type: number): number {
  const widths: Record<number, number> = { 1: 2, 2: 3, 3: 4, 4: 4, 5: 8, 6: 6, 7: 5, 8: 3, 15: 1 };
  const width = widths[type];
  if (!width) throw meshError('SIMULATION_MESH_ELEMENT_UNSUPPORTED', `Unsupported Gmsh element type ${type}.`);
  return width;
}

function normalizeMesh(parsed: ParsedMsh, request: NeutralMeshJobRequest, descriptor: SimulationGeometryResolver['descriptor'], adapterId: string, adapterVersion: string, engineVersion: string): NeutralFemMesh {
  const surfaceTags = [...new Set(parsed.triangles.map(item => item.entityTag))].sort((a, b) => a - b);
  if (surfaceTags.length !== descriptor.shape.faceCount) throw meshError('SIMULATION_STEP_TOPOLOGY_CHANGED', `STEP meshing produced ${surfaceTags.length} boundary surfaces; TunaCAD supplied ${descriptor.shape.faceCount} CAD faces.`);
  const facetIndicesBySurface = new Map(surfaceTags.map(tag => [tag, [] as number[]]));
  parsed.triangles.forEach((item, index) => facetIndicesBySurface.get(item.entityTag)!.push(index));
  const evidence = new Map(surfaceTags.map(tag => [tag, boundaryEvidence(parsed.nodes, parsed.triangles, facetIndicesBySurface.get(tag)!)]));
  const scale = Math.max(...descriptor.shape.boundingBoxMm.size);
  const matches = new Map<number, NeutralMeshBoundaryRequest>();
  const boundaryRegions = request.boundaryRegions.map(boundary => {
    const candidates = surfaceTags.filter(tag => matchesFace(evidence.get(tag)!, boundary.face, scale, request.mesh.globalSizeMm));
    if (candidates.length === 0) throw meshError('SIMULATION_FACE_MAPPING_NOT_FOUND', `Durable FACE "${boundary.semanticReferenceId}" has no meshed STEP boundary match.`);
    if (candidates.length !== 1 || matches.has(candidates[0])) throw meshError('SIMULATION_FACE_MAPPING_AMBIGUOUS', `Durable FACE "${boundary.semanticReferenceId}" did not map to exactly one unused Gmsh surface.`);
    const tag = candidates[0]; matches.set(tag, boundary);
    return {
      regionId: boundary.regionId,
      semanticReferenceIds: [boundary.semanticReferenceId],
      sourceFeatureIds: boundary.sourceFeatureId ? [boundary.sourceFeatureId] : [],
      facetIndices: facetIndicesBySurface.get(tag)!,
      matchedCadFace: evidence.get(tag)!,
      match: { state: 'verified' as const, method: 'geometric_signature' as const, candidateCount: 1 as const, centroidToleranceMm: tolerance(scale, request.mesh.globalSizeMm), areaRelativeTolerance: 0.005 },
    };
  });
  const boundaryFacetRegionIds = parsed.triangles.map(item => matches.get(item.entityTag)?.regionId ?? `boundary_unassigned_${String(item.entityTag).padStart(3, '0')}`);
  const cells = parsed.tetrahedra.map(item => item.connectivity);
  const qualities = cells.map(cell => tetraMeanRatio(cell.slice(0, 4).map(index => parsed.nodes[index]) as [NeutralVector3, NeutralVector3, NeutralVector3, NeutralVector3]));
  const meshVolume = cells.reduce((sum, cell) => sum + quadraticTetraVolume(cell.map(index => parsed.nodes[index])), 0);
  const options = { elementOrder: 2, globalSizeMm: request.mesh.globalSizeMm, minimumSizeMm: request.mesh.minimumSizeMm ?? request.mesh.globalSizeMm / 10, format: 'msh4-ascii' };
  return {
    schema: NEUTRAL_FEM_MESH_SCHEMA,
    meshId: `mesh_${crypto.randomUUID()}`,
    requestDigest: request.requestDigest,
    projectRevision: request.projectRevision,
    geometryDigest: request.geometryDigest,
    coordinateSpace: request.coordinateSpace,
    units: request.units,
    element: { family: 'tetrahedral', geometryOrder: 2, solutionOrder: 2 },
    nodes: parsed.nodes,
    volumeElements: { connectivity: cells, regionIds: cells.map(() => 'solid_region_001') },
    boundaryFacets: { connectivity: parsed.triangles.map(item => item.connectivity), regionIds: boundaryFacetRegionIds },
    boundaryRegions,
    volumeRegions: [{ regionId: 'solid_region_001', elementIndices: cells.map((_, index) => index) }],
    quality: {
      metric: 'mean_ratio', minimum: Math.min(...qualities), average: qualities.reduce((sum, value) => sum + value, 0) / qualities.length,
      invalidElementCount: qualities.filter(value => !Number.isFinite(value) || value <= 0).length as 0,
      nodeCount: parsed.nodes.length, elementCount: cells.length, boundaryFacetCount: parsed.triangles.length,
      cadVolumeMm3: descriptor.shape.volumeMm3, meshVolumeMm3: meshVolume, volumeRelativeError: Math.abs(meshVolume - descriptor.shape.volumeMm3) / descriptor.shape.volumeMm3,
    },
    provenance: {
      meshProviderInterfaceVersion: MESH_PROVIDER_INTERFACE_VERSION, adapterId, adapterVersion, engine: 'Gmsh', engineVersion,
      optionsDigest: `sha256:${createHash('sha256').update(JSON.stringify(options)).digest('hex')}`,
      inputGeometryDigest: request.geometryDigest, generatedAt: new Date().toISOString(),
    },
  };
}

function boundaryEvidence(nodes: NeutralVector3[], triangles: ParsedMsh['triangles'], indices: number[]): NeutralSimulationReferenceBinding['face'] {
  let area = 0; const weighted: NeutralVector3 = [0, 0, 0]; const used = new Set<number>();
  for (const index of indices) {
    const connectivity = triangles[index].connectivity;
    const samples = quadraticTriangleSurfaceSamples(connectivity.map(node => nodes[node]));
    for (const sample of samples) {
      area += sample.areaWeightMm2;
      for (let axis = 0; axis < 3; axis++) weighted[axis] += sample.positionMm[axis] * sample.areaWeightMm2;
    }
    connectivity.forEach(node => used.add(node));
  }
  if (area <= 0 || !used.size) throw meshError('SIMULATION_FACE_MAPPING_NOT_FOUND', 'Gmsh produced an empty STEP boundary surface.');
  const points = [...used].map(index => nodes[index]);
  return {
    centroidPartLocalMm: weighted.map(value => value / area) as NeutralVector3, areaMm2: area, outwardDirection: null, geometryType: null,
    boundingBoxMm: {
      min: [0, 1, 2].map(axis => Math.min(...points.map(point => point[axis]))) as NeutralVector3,
      max: [0, 1, 2].map(axis => Math.max(...points.map(point => point[axis]))) as NeutralVector3,
    },
  };
}

function matchesFace(candidate: NeutralSimulationReferenceBinding['face'], expected: NeutralSimulationReferenceBinding['face'], scale: number, size: number): boolean {
  const epsilon = tolerance(scale, size);
  if (candidate.centroidPartLocalMm.some((value, axis) => Math.abs(value - expected.centroidPartLocalMm[axis]) > epsilon)) return false;
  if (Math.abs(candidate.areaMm2 - expected.areaMm2) > Math.max(1e-5, expected.areaMm2 * 0.005)) return false;
  if (expected.boundingBoxMm && candidate.boundingBoxMm) {
    for (const side of ['min', 'max'] as const) if (candidate.boundingBoxMm[side].some((value, axis) => Math.abs(value - expected.boundingBoxMm![side][axis]) > epsilon)) return false;
  }
  return true;
}

function tolerance(scale: number, size: number): number { return Math.max(1e-5, scale * 1e-6, size * 0.02); }
function executableEnvironment(executable: string): NodeJS.ProcessEnv { return { ...process.env, PATH: `${dirname(executable)}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}` }; }
function nodeMajorVersion(): number { return Number.parseInt(process.versions.node.split('.')[0] ?? '', 10); }
function meshError(code: string, message: string): Error & { code: string } { return Object.assign(new Error(message), { code }); }
