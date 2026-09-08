import type { ChildProcess } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type {
  ExternalSolverProviderV2, NeutralFemMesh, NeutralFemModelV2, NeutralSimulationConstraint,
  NeutralSimulationFieldDatasetV2, NeutralSimulationFieldPageV2, NeutralSimulationFieldTriangleV2,
  NeutralSimulationRequestV2, NeutralSimulationResultV2, NeutralVector3,
  SimulationProviderCapabilitiesV2, SimulationProviderStatus, SimulationProviderSubmission,
} from '../../src/simulation/externalSimulationContracts.ts';
import { validateNeutralSimulationFieldPageV2, validateNeutralSimulationResultV2 } from '../../simulation-bridge/v2Validation.mts';
import { digest } from '../../simulation-bridge/stableDigest.mts';
import {
  LOCAL_PROVIDER_RESOURCE_LIMITS, hasEnforcedProviderProcessQuotas, monitorWorkingDirectory,
  readUtf8FileBounded, removeWorkingDirectory, spawnProviderProcess, terminateChildProcess,
} from '../processLifecycle.mts';
import { asV1Mesh, createCalculiXInputDeckV2 } from './CalculiXMultiDomainDeck.mts';
import { buildConstraintSets, consistentSurfaceLoads, gravityNodalLoads, pressureSurfaceLoads } from './CalculiXSolverProvider.mts';

interface Run {
  request: NeutralSimulationRequestV2; model: NeutralFemModelV2; providerRunId: string; submittedAt: string;
  directory: string; process: ChildProcess; status: SimulationProviderStatus; result: NeutralSimulationResultV2 | null;
  timeout: NodeJS.Timeout; stopResourceMonitor: () => void;
  datasets: Map<string, { descriptor: NeutralSimulationFieldDatasetV2; triangles: NeutralSimulationFieldTriangleV2[] }>;
}
interface DomainOutput { maximumDisplacementMm: number; maximumDisplacementNode: number; maximumVonMisesStressMPa: number; maximumStressElement: number }

export class CalculiXMultiDomainSolverProvider implements ExternalSolverProviderV2 {
  readonly id = 'tunacad-calculix-multi-domain-poc';
  readonly version = '0.1.0-poc';
  readonly capabilities: SimulationProviderCapabilitiesV2;
  private readonly executable: string;
  private readonly runtimeVersion: string;
  private readonly runs = new Map<string, Run>();

  constructor(options: { executable: string; runtimeVersion: string; maximumDomains?: number }) {
    if (!options.executable?.trim() || !/^ccx(?:\d+(?:\.\d+)*|[_-][A-Za-z0-9][A-Za-z0-9._-]*)?(?:\.exe)?$/i.test(basename(options.executable))) {
      throw error('SIMULATION_SOLVER_UNAVAILABLE', 'An explicit CalculiX ccx executable is required.');
    }
    this.executable = resolve(options.executable); this.runtimeVersion = options.runtimeVersion;
    const maximumDomains = options.maximumDomains ?? 16;
    this.capabilities = {
      interfaceVersion: '2.0', analysisTypes: ['linear_static'],
      fieldResults: { paginated: true, maximumPageTriangles: 128, components: ['displacement_magnitude', 'von_mises_stress'], topology: 'triangle_soup' },
      study: {
        maximumParts: maximumDomains, maximumBodies: maximumDomains, maximumMaterials: maximumDomains, maximumReferenceBindings: 512,
        materialModels: ['isotropic_linear_elastic'], loadTypes: ['surface_force', 'pressure', 'gravity', 'remote_force'], maximumLoads: 64,
        maximumReferencesPerLoad: 32, constraintTypes: ['fixed', 'prescribed_displacement', 'remote_displacement'], maximumConstraints: 64,
        maximumReferencesPerConstraint: 32, contactModes: ['none'], maximumDomains, maximumOccurrences: maximumDomains,
        multiDomain: true, perDomainMaterials: true, rigidOccurrenceTransforms: true, interactionTypes: ['bonded_tie', 'shared_topology', 'rigid_connector'], maximumInteractions: 32, maximumReferencesPerInteractionSide: 32,
      },
      geometryFormats: [], asynchronous: true, cancellation: true, normalizedResults: true,
      durableReferenceMapping: 'supported', authority: 'engineering',
      qualification: {
        status: 'proof_of_concept', engineeringUsePermitted: false,
        statement: 'Experimental SIM-4B CalculiX multi-domain solver with explicit ties, shared topology, and rigid remote connectors.',
        limitations: ['Windows development-host evidence only', 'Small-displacement linear statics only', 'Explicit bonded ties, shared topology, and rigid connectors are experimental; separable/frictional contact is unsupported', 'Each constraint entry must target one domain', 'Direct FACE constraints have no normalized moment resultant; force and moment resultants are both normalized for remote supports'],
        evidence: { schema: 'tunacad-simulation-qualification-matrix/1.0', matrixId: 'sim4a-windows-x64-gmsh-4.15.2-calculix-2.16', pendingLaneIds: ['independent-engineering-review'] },
      },
      execution: {
        topology: 'local_adapter', credentials: 'none', geometryLeavesDevice: false,
        privacyDisclosure: 'Only validated SIM-4A neutral data is written to a temporary CalculiX deck and deleted after normalization.',
        queueTimeoutMs: 5_000, executionTimeoutMs: 120_000, totalTimeoutMs: 125_000, rawArtifactRetentionMs: 0, normalizedResultRetentionMs: 20 * 60_000,
        resourceLimits: {
          maximumInputGeometryBytes: null, maximumWorkingDirectoryBytes: LOCAL_PROVIDER_RESOURCE_LIMITS.maximumWorkingDirectoryBytes,
          maximumResultFileBytes: LOCAL_PROVIDER_RESOURCE_LIMITS.maximumResultFileBytes, maximumDiagnosticCharacters: LOCAL_PROVIDER_RESOURCE_LIMITS.maximumDiagnosticCharacters,
          processTerminationGraceMs: LOCAL_PROVIDER_RESOURCE_LIMITS.processTerminationGraceMs,
          cpuTimeLimitMs: LOCAL_PROVIDER_RESOURCE_LIMITS.cpuTimeLimitMs, memoryLimitBytes: LOCAL_PROVIDER_RESOURCE_LIMITS.memoryLimitBytes,
        },
      },
    };
    if (!hasEnforcedProviderProcessQuotas()) Object.assign(this.capabilities.qualification, {
      status: 'unsupported' as const, engineeringUsePermitted: false,
      statement: `SIM-4A CalculiX execution on ${process.platform}/${process.arch} is unsupported because OS-enforced quotas are unavailable.`, evidence: null,
    });
  }

  async submit(request: NeutralSimulationRequestV2, model: NeutralFemModelV2): Promise<SimulationProviderSubmission> {
    requireSingleDomainConstraints(request);
    const input = createCalculiXInputDeckV2(request, model);
    if (Buffer.byteLength(input, 'utf8') > LOCAL_PROVIDER_RESOURCE_LIMITS.maximumResultFileBytes) throw error('SIMULATION_INPUT_LIMIT', 'The CalculiX v2 deck exceeds the provider limit.');
    const directory = await mkdtemp(join(tmpdir(), 'tunacad-calculix-v2-'));
    const providerRunId = `calculixv2_${crypto.randomUUID()}`; const submittedAt = new Date().toISOString();
    await writeFile(join(directory, 'tunacadv2.inp'), input, 'utf8');
    const child = spawnProviderProcess(this.executable, ['-i', 'tunacadv2'], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: executableEnvironment(this.executable) });
    const run = { request, model, providerRunId, submittedAt, directory, process: child, result: null, datasets: new Map(),
      status: { providerRunId, status: 'running', progress: null, phase: 'external_solver_v2', updatedAt: submittedAt },
      timeout: undefined as unknown as NodeJS.Timeout, stopResourceMonitor: () => undefined } satisfies Run;
    run.timeout = setTimeout(() => void this.fail(run, 'SIMULATION_TIMEOUT', 'CalculiX exceeded its execution timeout.'), this.capabilities.execution.executionTimeoutMs); run.timeout.unref();
    this.runs.set(providerRunId, run);
    let diagnostic = ''; const collect = (chunk: unknown) => { diagnostic = `${diagnostic}${String(chunk)}`.slice(-LOCAL_PROVIDER_RESOURCE_LIMITS.maximumDiagnosticCharacters); };
    child.stdout?.on('data', collect); child.stderr?.on('data', collect);
    child.once('error', () => void this.fail(run, 'SIMULATION_SOLVER_UNAVAILABLE', 'The configured CalculiX process could not start.'));
    child.once('exit', (code, signal) => void this.finish(run, code, signal, diagnostic));
    run.stopResourceMonitor = monitorWorkingDirectory({ child, directory, onExceeded: bytes => this.fail(run, 'SIMULATION_DISK_LIMIT', `CalculiX working data exceeded its limit (${bytes} bytes).`) });
    return { providerRunId, acceptedAt: submittedAt };
  }
  getStatus(id: string) { return Promise.resolve(structuredClone(this.require(id).status)); }
  getResult(id: string) { return Promise.resolve(structuredClone(this.require(id).result)); }
  async getFieldDataset(providerRunId: string, datasetId: string, cursor = '0', limit = 128): Promise<NeutralSimulationFieldPageV2> {
    if (!/^\d{1,10}$/.test(cursor) || !Number.isInteger(limit) || limit < 1 || limit > 128) throw error('SIMULATION_FIELD_PAGE_INVALID', 'Invalid field page cursor or limit.');
    const found = this.require(providerRunId).datasets.get(datasetId);
    if (!found) throw error('SIMULATION_FIELD_DATASET_NOT_FOUND', `Unknown or expired field dataset "${datasetId}".`);
    const offset = Number(cursor);
    if (offset >= found.triangles.length) throw error('SIMULATION_FIELD_PAGE_INVALID', 'Field page cursor is outside the dataset.');
    const triangles = found.triangles.slice(offset, offset + Math.min(limit, found.descriptor.maximumPageTriangles));
    const page: NeutralSimulationFieldPageV2 = {
      schema: 'tunacad-neutral-simulation-field-page/2.0', dataset: structuredClone(found.descriptor), cursor,
      nextCursor: offset + triangles.length < found.triangles.length ? String(offset + triangles.length) : null,
      triangleOffset: offset, triangleCount: triangles.length, chunkDigest: digest(triangles), triangles: structuredClone(triangles),
    };
    validateNeutralSimulationFieldPageV2(page);
    return page;
  }
  async cancel(id: string) {
    const run = this.require(id);
    if (run.status.status === 'running' || run.status.status === 'queued') {
      run.status = { providerRunId: id, status: 'cancelled', progress: null, phase: 'cancelled', updatedAt: new Date().toISOString() };
      clearTimeout(run.timeout); run.stopResourceMonitor(); run.result = null; run.datasets.clear();
      const terminated = await terminateChildProcess(run.process); const cleaned = await removeWorkingDirectory(run.directory);
      run.status = { ...run.status, phase: terminated && cleaned ? 'cancelled_cleaned' : 'cancelled_cleanup_pending', updatedAt: new Date().toISOString(),
        ...(!terminated || !cleaned ? { failure: { code: 'SIMULATION_CLEANUP_FAILED', message: 'CalculiX cleanup could not be confirmed.' } } : {}) };
    }
    return structuredClone(run.status);
  }
  private async finish(run: Run, code: number | null, signal: NodeJS.Signals | null, diagnostic: string) {
    run.stopResourceMonitor(); if (isStopped(run)) { await removeWorkingDirectory(run.directory); return; } clearTimeout(run.timeout);
    if (code !== 0) { await this.fail(run, 'SIMULATION_SOLVER_FAILED', `CalculiX exited with code ${String(code)}${signal ? ` (${signal})` : ''}. ${diagnostic.slice(-1500)}`); return; }
    try {
      const contents = await readUtf8FileBounded(join(run.directory, 'tunacadv2.dat'));
      if (isStopped(run)) return;
      const reactionSets = run.request.constraints.flatMap((constraint, index) => [reactionName(index), ...(constraint.type === 'remote_displacement' ? [reactionMomentName(index)] : [])]);
      const parsed = parseCalculiXDatV2(contents, run.model, reactionSets, run.request.loads.some(load => load.type === 'gravity'));
      const normalized = normalize(run, parsed, this.id, this.version, this.runtimeVersion); validateNeutralSimulationResultV2(normalized.result, run.request);
      if (isStopped(run)) return;
      run.result = normalized.result; run.datasets = normalized.datasets;
      run.status = { providerRunId: run.providerRunId, status: 'succeeded', progress: 1, phase: 'normalized_v2', updatedAt: new Date().toISOString() };
    } catch (caught) { await this.fail(run, 'SIMULATION_RESULT_UNTRUSTED', caught instanceof Error ? caught.message : String(caught)); return; }
    await removeWorkingDirectory(run.directory);
  }
  private async fail(run: Run, code: string, message: string) {
    if (run.status.status === 'cancelled' || run.status.status === 'failed') return;
    clearTimeout(run.timeout); run.stopResourceMonitor(); run.result = null; run.datasets.clear();
    run.status = { providerRunId: run.providerRunId, status: 'failed', progress: null, phase: 'failed', updatedAt: new Date().toISOString(), failure: { code, message: message.slice(0, 2000) } };
    await terminateChildProcess(run.process); await removeWorkingDirectory(run.directory);
  }
  private require(id: string) { const run = this.runs.get(id); if (!run) throw error('SIMULATION_JOB_NOT_FOUND', `Unknown CalculiX v2 run "${id}".`); return run; }
}

export function parseCalculiXDatV2(text: string, model: NeutralFemModelV2, reactionSets: string[], expectVolume = false) {
  if (text.split(/\r?\n/).length > 2_000_000) throw new Error('CalculiX v2 result contains too many records.');
  const byDomain = new Map(model.domainRegions.map(domain => [domain.domainId, { maximumDisplacementMm: -Infinity, maximumDisplacementNode: -1, maximumVonMisesStressMPa: -Infinity, maximumStressElement: -1 } satisfies DomainOutput]));
  const nodeDomains = new Map(model.domainRegions.flatMap(domain => domain.nodeIndices.map(node => [node, domain.domainId] as const)));
  const displacements = new Map<number, NeutralVector3>();
  const vonMisesByElement = new Map<number, number>();
  const reactions: Record<string, NeutralVector3> = {}; let mode: 'u' | 'rf' | 's' | 'volume' | null = null; let reaction: string | null = null; let totalVolumeMm3: number | null = null;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.length > 4096) throw new Error('CalculiX v2 result contains an oversized record.'); const lower = raw.toLowerCase();
    if (lower.includes('displacements') && lower.includes('for set')) { mode = 'u'; continue; }
    if ((lower.includes('total force') || lower.includes('forces')) && lower.includes('for set')) { mode = 'rf'; reaction = /for set\s+([a-z0-9_-]+)/i.exec(raw)?.[1]?.toUpperCase() ?? null; continue; }
    if (lower.includes('stresses') && lower.includes('for set')) { mode = 's'; continue; }
    if (lower.includes('volume') && lower.includes('for set')) { mode = 'volume'; continue; }
    const values = raw.trim().split(/\s+/).map(value => Number(value.replace(/[dD]/g, 'E'))); if (!values.length || values.some(value => !Number.isFinite(value))) continue;
    if (mode === 'u' && values.length >= 4) {
      const node = Math.trunc(values[0]) - 1; const domain = byDomain.get(nodeDomains.get(node) ?? ''); if (!domain) continue; const magnitude = Math.hypot(values[1], values[2], values[3]);
      displacements.set(node, values.slice(1, 4) as NeutralVector3);
      if (magnitude > domain.maximumDisplacementMm) { domain.maximumDisplacementMm = magnitude; domain.maximumDisplacementNode = node; }
    } else if (mode === 's' && values.length >= 8) {
      const element = Math.trunc(values[0]) - 1; const domain = byDomain.get(model.volumeElements.domainIds[element] ?? ''); if (!domain) continue;
      const [xx, yy, zz, xy, xz, yz] = values.slice(-6); const vm = Math.sqrt(0.5 * ((xx - yy) ** 2 + (yy - zz) ** 2 + (zz - xx) ** 2) + 3 * (xy ** 2 + xz ** 2 + yz ** 2));
      vonMisesByElement.set(element, Math.max(vonMisesByElement.get(element) ?? 0, vm));
      if (vm > domain.maximumVonMisesStressMPa) { domain.maximumVonMisesStressMPa = vm; domain.maximumStressElement = element; }
    } else if (mode === 'rf' && reaction && values.length >= 3) { const force = values.slice(-3) as NeutralVector3; reactions[reaction] = add(reactions[reaction] ?? [0, 0, 0], force); }
    else if (mode === 'volume') totalVolumeMm3 = values.at(-1)!;
  }
  if (reactionSets.some(name => !reactions[name]) || [...byDomain.values()].some(item => item.maximumDisplacementNode < 0 || item.maximumStressElement < 0 || !Number.isFinite(item.maximumDisplacementMm) || !Number.isFinite(item.maximumVonMisesStressMPa))
    || (expectVolume && !(totalVolumeMm3 && totalVolumeMm3 > 0))) throw new Error('CalculiX did not produce complete finite per-domain SIM-4A output.');
  return { byDomain, reactions, totalVolumeMm3, displacements, vonMisesByElement };
}

function normalize(run: Run, parsed: ReturnType<typeof parseCalculiXDatV2>, adapterId: string, adapterVersion: string, runtimeVersion: string) {
  const mesh = asV1Mesh(run.model);
  const directConstraints = run.request.constraints.filter(constraint => constraint.type !== 'remote_displacement');
  const directSets = buildConstraintSets(directConstraints as NeutralSimulationConstraint[], mesh);
  const directSetById = new Map(directSets.map(set => [set.constraint.id, set]));
  const referenceDomains = new Map(run.request.model.references.map(reference => [reference.semanticReferenceId, reference.domainId])); const applied = combinedLoads(run.request, run.model, mesh);
  const connectors = new Map(run.request.interactions.filter(interaction => interaction.type === 'rigid_connector').map(interaction => [interaction.id, interaction]));
  const reactions = run.request.constraints.map((constraint, index) => {
    if (constraint.type === 'remote_displacement') {
      const connector = connectors.get(constraint.connectorId)!;
      return {
        constraintId: constraint.id, domainId: referenceDomains.get(connector.semanticReferenceIds[0])!, semanticReferenceIds: [...connector.semanticReferenceIds],
        forceN: parsed.reactions[reactionName(index)], momentNmm: parsed.reactions[reactionMomentName(index)], connectorId: connector.id,
        referencePointAnalysisMm: [...connector.referencePointAnalysisMm] as NeutralVector3,
      };
    }
    return {
      constraintId: constraint.id, domainId: referenceDomains.get(constraint.semanticReferenceIds[0])!, semanticReferenceIds: [...constraint.semanticReferenceIds],
      forceN: subtract(parsed.reactions[reactionName(index)], sumAt(applied, directSetById.get(constraint.id)!.reactionNodes)),
      momentNmm: null, connectorId: null, referencePointAnalysisMm: null,
    };
  });
  const remoteAppliedForce = run.request.loads.filter(load => load.type === 'remote_force').reduce<NeutralVector3>((sum, load) => add(sum, load.forceN), [0, 0, 0]);
  const appliedForce = add(sumMap(applied), remoteAppliedForce); const reactionForce = reactions.reduce<NeutralVector3>((sum, item) => add(sum, item.forceN), [0, 0, 0]); const residual = Math.hypot(...add(appliedForce, reactionForce));
  if (residual > Math.max(1e-6, Math.hypot(...appliedForce) * 1e-4)) throw new Error(`CalculiX v2 reaction/load equilibrium residual is ${residual} N.`);
  if (run.request.constraints.every(constraint => constraint.type === 'remote_displacement')) {
    const appliedMoment = [...applied.entries()].reduce<NeutralVector3>((sum, [node, force]) => add(sum, cross(run.model.nodes[node], force)), [0, 0, 0]);
    for (const load of run.request.loads) if (load.type === 'remote_force') {
      const connector = connectors.get(load.connectorId)!;
      const contribution = add(cross(connector.referencePointAnalysisMm, load.forceN), load.momentNmm);
      appliedMoment[0] += contribution[0]; appliedMoment[1] += contribution[1]; appliedMoment[2] += contribution[2];
    }
    const reactionMoment = reactions.reduce<NeutralVector3>((sum, reaction) => add(sum, add(cross(reaction.referencePointAnalysisMm!, reaction.forceN), reaction.momentNmm!)), [0, 0, 0]);
    const momentResidual = Math.hypot(...add(appliedMoment, reactionMoment));
    if (momentResidual > Math.max(1e-4, Math.hypot(...appliedMoment) * 1e-4)) throw new Error(`CalculiX v2 reaction/load moment-equilibrium residual is ${momentResidual} N*mm.`);
  }
  const materialFor = (domainId: string) => { const assignment = run.request.materialAssignments.find(item => item.domainId === domainId)!; return run.request.materials.find(item => item.id === assignment.materialId)!; };
  const perDomain = run.model.domainRegions.map(domain => { const output = parsed.byDomain.get(domain.domainId)!; const material = materialFor(domain.domainId); return { domainId: domain.domainId, metrics: {
    maximumVonMisesStressMPa: output.maximumVonMisesStressMPa, maximumDisplacementMm: output.maximumDisplacementMm,
    minimumFactorOfSafety: material.yieldStrengthMPa ? material.yieldStrengthMPa / output.maximumVonMisesStressMPa : null,
  }, fieldDatasetIds: [`${run.providerRunId}:${domain.domainId}:displacement`, `${run.providerRunId}:${domain.domainId}:stress`] }; });
  const criticalRegions = run.model.domainRegions.flatMap(domain => { const output = parsed.byDomain.get(domain.domainId)!; const corners = run.model.volumeElements.connectivity[output.maximumStressElement].slice(0, 4).map(node => run.model.nodes[node]); const stressPosition = [0, 1, 2].map(axis => corners.reduce((sum, point) => sum + point[axis], 0) / corners.length) as NeutralVector3; return [
    hotspot(domain.domainId, 'stress', output.maximumVonMisesStressMPa, 'MPa', stressPosition), hotspot(domain.domainId, 'displacement', output.maximumDisplacementMm, 'mm', run.model.nodes[output.maximumDisplacementNode]),
  ]; });
  const factors = perDomain.map(domain => domain.metrics.minimumFactorOfSafety).filter((value): value is number => value !== null); const completedAt = new Date().toISOString();
  const result: NeutralSimulationResultV2 = { schema: 'tunacad-neutral-simulation-result/2.0', studyId: run.request.studyId, jobId: run.providerRunId, requestDigest: run.request.requestDigest, projectRevision: run.request.model.projectRevision, modelDigest: run.request.model.modelDigest,
    analysisType: 'linear_static', status: 'succeeded', authority: 'engineering', metrics: { maximumVonMisesStressMPa: Math.max(...perDomain.map(domain => domain.metrics.maximumVonMisesStressMPa)), maximumDisplacementMm: Math.max(...perDomain.map(domain => domain.metrics.maximumDisplacementMm)), minimumFactorOfSafety: factors.length ? Math.min(...factors) : null },
    perDomain, reactions, criticalRegions, failedConstraints: [], warnings: [{ code: 'SIMULATION_PROVIDER_POC', message: 'Experimental SIM-4B result; qualified-engineer review is mandatory.', severity: 'warning' }],
    convergence: { status: 'converged', iterations: null, residual: null, providerDeclared: true }, suggestedEngineeringIssues: ['Verify every domain assignment and independently constrained disconnected domain.'],
    provenance: { providerInterfaceVersion: '2.0', adapterId, adapterVersion, providerRunId: run.providerRunId, submittedAt: run.submittedAt, completedAt, normalizedAt: completedAt },
    review: { engineerReviewRequired: true, engineeringUsePermitted: false, disclaimer: `CalculiX ${runtimeVersion} experimental SIM-4A result. Not certified.` }, mutation: { occurred: false, projectRevisionBefore: run.request.model.projectRevision, projectRevisionAfter: run.request.model.projectRevision } };
  return { result, datasets: buildFieldDatasets(run, parsed) };
}

function buildFieldDatasets(run: Run, parsed: ReturnType<typeof parseCalculiXDatV2>) {
  const datasets = new Map<string, { descriptor: NeutralSimulationFieldDatasetV2; triangles: NeutralSimulationFieldTriangleV2[] }>();
  const elementByFace = new Map<string, number>();
  run.model.volumeElements.connectivity.forEach((cell, elementIndex) => {
    const corners = cell.slice(0, 4);
    for (const face of [[corners[0], corners[2], corners[1]], [corners[0], corners[1], corners[3]], [corners[1], corners[2], corners[3]], [corners[2], corners[0], corners[3]]]) {
      elementByFace.set([...face].sort((a, b) => a - b).join(':'), elementIndex);
    }
  });
  for (const domain of run.model.domainRegions) {
    const facets = run.model.boundaryFacets.connectivity.flatMap((facet, facetIndex) => {
      if (run.model.boundaryFacets.domainIds[facetIndex] !== domain.domainId) return [];
      const elementIndex = elementByFace.get(facet.slice(0, 3).sort((a, b) => a - b).join(':'));
      if (elementIndex === undefined) throw new Error(`Boundary facet ${facetIndex} has no owning volume element.`);
      const subdivisions = facet.length === 6
        ? [[0, 3, 5], [3, 1, 4], [5, 4, 2], [3, 4, 5]]
        : [[0, 1, 2]];
      return subdivisions.map(indices => {
        const nodes = indices.map(index => facet[index]);
        return {
          facetIndex, elementIndex,
          positionsAnalysisMm: nodes.map(node => run.model.nodes[node]) as [NeutralVector3, NeutralVector3, NeutralVector3],
          displacementsMm: nodes.map(node => parsed.displacements.get(node) ?? missingField(`node ${node}`)) as [NeutralVector3, NeutralVector3, NeutralVector3],
          values: [0, 0, 0] as [number, number, number],
        };
      });
    });
    if (!facets.length) throw new Error(`Domain "${domain.domainId}" has no renderable boundary facets.`);
    const references = run.model.boundaryRegions.filter(region => region.domainId === domain.domainId).flatMap(region => region.semanticReferenceIds);
    const diagonal = boundingDiagonal(domain.nodeIndices.map(index => run.model.nodes[index]));
    const displacement = facets.map(triangle => ({ ...triangle, values: triangle.displacementsMm.map(value => Math.hypot(...value)) as [number, number, number] }));
    const stress = facets.map(triangle => {
      const value = parsed.vonMisesByElement.get(triangle.elementIndex) ?? missingField(`element ${triangle.elementIndex}`);
      return { ...triangle, values: [value, value, value] as [number, number, number] };
    });
    for (const [component, unit, triangles] of [['displacement_magnitude', 'mm', displacement], ['von_mises_stress', 'MPa', stress]] as const) {
      const datasetId = `${run.providerRunId}:${domain.domainId}:${component === 'displacement_magnitude' ? 'displacement' : 'stress'}`;
      const extrema = fieldExtrema(triangles);
      const maximumDisplacement = parsed.byDomain.get(domain.domainId)!.maximumDisplacementMm;
      const descriptor: NeutralSimulationFieldDatasetV2 = {
        schema: 'tunacad-neutral-simulation-field-dataset/2.0', datasetId, jobId: run.providerRunId, domainId: domain.domainId,
        analysisType: 'linear_static', step: { index: 0, label: 'static' }, component, unit,
        location: 'boundary_facet', topology: 'triangle_soup', valueRange: extrema,
        deformation: { vectorsIncluded: true, trueScale: 1, recommendedScale: maximumDisplacement > 1e-15 ? Math.min(1e6, Math.max(1, diagonal * 0.05 / maximumDisplacement)) : 1 },
        mapping: { domain: 'exact', cadRegions: 'partial', semanticReferenceIds: [...new Set(references)].sort(compareText) },
        totalTriangles: triangles.length, maximumPageTriangles: 128, datasetDigest: digest(triangles),
      };
      datasets.set(datasetId, { descriptor, triangles });
    }
  }
  return datasets;
}

function fieldExtrema(triangles: NeutralSimulationFieldTriangleV2[]): NeutralSimulationFieldDatasetV2['valueRange'] {
  let minimum = Infinity; let maximum = -Infinity; let minimumPositionAnalysisMm: NeutralVector3 | null = null; let maximumPositionAnalysisMm: NeutralVector3 | null = null;
  for (const triangle of triangles) triangle.values.forEach((value, index) => {
    if (value < minimum) { minimum = value; minimumPositionAnalysisMm = triangle.positionsAnalysisMm[index]; }
    if (value > maximum) { maximum = value; maximumPositionAnalysisMm = triangle.positionsAnalysisMm[index]; }
  });
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || !minimumPositionAnalysisMm || !maximumPositionAnalysisMm) throw new Error('Field dataset has no finite extrema.');
  return { minimum, maximum, minimumPositionAnalysisMm, maximumPositionAnalysisMm };
}

function boundingDiagonal(points: NeutralVector3[]) {
  const min = [Infinity, Infinity, Infinity]; const max = [-Infinity, -Infinity, -Infinity];
  for (const point of points) for (let axis = 0; axis < 3; axis += 1) { min[axis] = Math.min(min[axis], point[axis]); max[axis] = Math.max(max[axis], point[axis]); }
  return Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
}
function missingField(label: string): never { throw new Error(`CalculiX omitted required field output for ${label}.`); }
function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

function combinedLoads(request: NeutralSimulationRequestV2, model: NeutralFemModelV2, mesh: NeutralFemMesh) {
  const result = new Map<number, NeutralVector3>();
  for (const load of request.loads) if (load.type === 'gravity') {
    for (const domain of model.domainRegions) { const assignment = request.materialAssignments.find(item => item.domainId === domain.domainId)!; const material = request.materials.find(item => item.id === assignment.materialId)!;
      addMap(result, gravityNodalLoads({ ...mesh, volumeElements: { connectivity: domain.elementIndices.map(index => mesh.volumeElements.connectivity[index]), regionIds: domain.elementIndices.map(() => domain.volumeRegionId) } }, material.densityKgM3!, load.accelerationMmPerS2)); }
  } else if (load.type !== 'remote_force') { const regions = load.semanticReferenceIds.map(id => model.boundaryRegions.find(region => region.semanticReferenceIds.includes(id))!); const facets = [...new Set(regions.flatMap(region => region.facetIndices))]; addMap(result, load.type === 'surface_force' ? consistentSurfaceLoads(mesh, facets, load.forceN) : pressureSurfaceLoads(mesh, facets, load.pressureMPa)); }
  return result;
}
function requireSingleDomainConstraints(request: NeutralSimulationRequestV2) { const owners = new Map(request.model.references.map(reference => [reference.semanticReferenceId, reference.domainId])); const connectors = new Map(request.interactions.filter(interaction => interaction.type === 'rigid_connector').map(interaction => [interaction.id, interaction])); for (const constraint of request.constraints) { const ids = constraint.type === 'remote_displacement' ? connectors.get(constraint.connectorId)?.semanticReferenceIds ?? [] : constraint.semanticReferenceIds; if (new Set(ids.map(id => owners.get(id))).size !== 1) throw error('SIMULATION_PROVIDER_CAPABILITY_MISMATCH', `Constraint "${constraint.id}" spans multiple domains.`); } }
function hotspot(domainId: string, kind: 'stress' | 'displacement', value: number, unit: 'MPa' | 'mm', positionAnalysisMm: NeutralVector3): NeutralSimulationResultV2['criticalRegions'][number] { return { id: `${domainId}:${kind}-maximum`, domainId, kind, severity: 'warning', value, unit, positionAnalysisMm, semanticReferenceIds: [], featureIds: [], description: `Maximum CalculiX ${kind} for this domain.`, inspect: [domainId], mapping: 'analysis_location' }; }
function reactionName(index: number) { return `REACTION_${String(index + 1).padStart(3, '0')}`; }
function reactionMomentName(index: number) { return `REACTION_MOMENT_${String(index + 1).padStart(3, '0')}`; }
function add(a: NeutralVector3, b: NeutralVector3): NeutralVector3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function cross(a: NeutralVector3, b: NeutralVector3): NeutralVector3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function subtract(a: NeutralVector3, b: NeutralVector3): NeutralVector3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function addMap(target: Map<number, NeutralVector3>, source: Map<number, NeutralVector3>) { for (const [node, force] of source) target.set(node, add(target.get(node) ?? [0, 0, 0], force)); }
function sumMap(loads: Map<number, NeutralVector3>) { return [...loads.values()].reduce<NeutralVector3>(add, [0, 0, 0]); }
function sumAt(loads: Map<number, NeutralVector3>, nodes: number[]) { return nodes.reduce<NeutralVector3>((sum, node) => add(sum, loads.get(node) ?? [0, 0, 0]), [0, 0, 0]); }
function executableEnvironment(executable: string): NodeJS.ProcessEnv { return { ...process.env, PATH: `${dirname(executable)}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}` }; }
function error(code: string, message: string): Error & { code: string } { return Object.assign(new Error(message), { code }); }
function isStopped(run: Run): boolean { return run.status.status === 'cancelled' || run.status.status === 'failed'; }
