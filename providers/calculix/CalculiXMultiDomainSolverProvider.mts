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
      interfaceVersion: '2.0', analysisTypes: ['linear_static', 'modal', 'linear_buckling', 'static_contact', 'nonlinear_static'],
      fieldResults: { paginated: true, maximumPageTriangles: 128, components: ['displacement_magnitude', 'von_mises_stress', 'mode_shape_magnitude', 'buckling_mode_shape_magnitude', 'contact_pressure', 'normal_gap', 'tangential_slip', 'contact_shear', 'equivalent_plastic_strain', 'strain_energy_density'], topology: 'triangle_soup' },
      study: {
        maximumParts: maximumDomains, maximumBodies: maximumDomains, maximumMaterials: maximumDomains, maximumReferenceBindings: 512,
        materialModels: ['isotropic_linear_elastic', 'isotropic_elastic_plastic'], loadTypes: ['surface_force', 'pressure', 'gravity', 'remote_force'], maximumLoads: 64,
        maximumReferencesPerLoad: 32, constraintTypes: ['fixed', 'prescribed_displacement', 'remote_displacement'], maximumConstraints: 64,
        maximumReferencesPerConstraint: 32, contactModes: ['none'], maximumDomains, maximumOccurrences: maximumDomains,
        multiDomain: true, perDomainMaterials: true, rigidOccurrenceTransforms: true, interactionTypes: ['bonded_tie', 'shared_topology', 'rigid_connector', 'frictionless_contact', 'frictional_contact'], maximumInteractions: 32, maximumReferencesPerInteractionSide: 32,
        modal: { maximumModes: 24, frequencyBounds: true, massFormulations: ['consistent'], constrainedOnly: false, maximumFreeFreeDomains: 1 },
        buckling: { maximumModes: 12, maximumDomains: 1, preloadCaseRequired: true, loadTypes: ['surface_force'], constraintTypes: ['fixed'] },
        nonlinearStatic: {
          maximumDomains: 1, maximumSteps: 8, maximumAmplitudePoints: 32, amplitudeModes: ['shared_shape_per_step'],
          loadTypes: ['surface_force', 'pressure', 'gravity'], constraintTypes: ['fixed'],
          geometricNonlinearity: true, materialModels: ['isotropic_linear_elastic', 'isotropic_elastic_plastic'], materialNonlinearity: true, hardeningModels: ['isotropic'], automaticIncrements: true,
          plasticStrainResults: true, energyResults: true, incrementHistory: true, loadDisplacementHistory: true,
        },
        contact: { maximumDomains: 2, maximumInteractions: 8, interactionTypes: ['frictionless_contact', 'frictional_contact'], formulations: ['node_to_surface_penalty'], sliding: ['small', 'finite'], normalBehaviors: ['linear_penalty'], tangentialBehaviors: ['frictionless', 'coulomb_penalty'], initialAdjustments: ['none', 'bounded_to_contact'], nonlinearIncrementReporting: true },
      },
      geometryFormats: [], asynchronous: true, cancellation: true, normalizedResults: true,
      durableReferenceMapping: 'supported', authority: 'engineering',
      qualification: {
        status: 'internally_validated', engineeringUsePermitted: false,
        statement: 'Internally validated but experimental SIM-4B linear-static, SIM-5 modal/buckling, SIM-6 contact, and SIM-7 geometric/material-nonlinear static CalculiX solver.',
        limitations: ['Windows x64 / Node 24 / CalculiX 2.16 evidence only', 'Geometric/material-nonlinear static analysis is single-domain and fixed-support public beta; SIM-7B coupon, convergence, lifecycle, and single-load plastic-hinge path evidence exist, but reordered multi-axis/non-proportional loading and formal qualification are not claimed', 'Modal analysis is limited to undamped, linear-elastic modes with consistent mass; free-free admission is currently single-domain only', 'Linear buckling is single-domain, fixed-support, surface-force preload only and predicts idealized eigenvalue bifurcation rather than nonlinear collapse', 'Contact is limited to two-domain node-to-surface penalty behavior; finite sliding enables geometric nonlinearity but the constitutive material remains isotropic linear elastic', 'Initial adjustment is explicitly bounded and verified against the composed surface mesh; Coulomb friction uses an explicit penalty stick slope', 'Explicit bonded ties, shared topology, and rigid connectors are experimental', 'Each constraint entry must target one domain', 'Direct FACE constraints have no normalized moment resultant; force and moment resultants are both normalized for remote supports'],
        evidence: { schema: 'tunacad-simulation-qualification-matrix/1.0', matrixId: 'sim7a-windows-x64-gmsh-4.15.2-calculix-2.16', pendingLaneIds: ['independent-engineering-review'] },
      },
      execution: {
        topology: 'local_adapter', credentials: 'none', geometryLeavesDevice: false,
        privacyDisclosure: 'Only validated neutral FEM data is written to a temporary CalculiX deck and deleted after normalization.',
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
    else if (Number.parseInt(process.versions.node.split('.')[0] ?? '', 10) !== 24 || options.runtimeVersion !== '2.16') Object.assign(this.capabilities.qualification, {
      status: 'proof_of_concept' as const, engineeringUsePermitted: false,
      statement: `The SIM-4 through SIM-7 CalculiX ${options.runtimeVersion} adapter on Node ${process.versions.node} is outside the internally validated Windows x64 / Node 24 / CalculiX 2.16 tuple.`, evidence: null,
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
      const normalized = run.request.analysis.type === 'modal'
        ? normalizeModal(run, parseCalculiXModalDatV2(contents), parseCalculiXModalFrdV2(await readUtf8FileBounded(join(run.directory, 'tunacadv2.frd'))), this.id, this.version, this.runtimeVersion)
        : run.request.analysis.type === 'linear_buckling'
          ? normalizeBuckling(run, parseCalculiXBucklingDatV2(contents), parseCalculiXBucklingFrdV2(await readUtf8FileBounded(join(run.directory, 'tunacadv2.frd'))), this.id, this.version, this.runtimeVersion)
          : run.request.analysis.type === 'static_contact'
            ? normalizeContact(run, parseCalculiXDatV2(contents, run.model, run.request.constraints.flatMap((constraint, index) => [reactionName(index), ...(constraint.type === 'remote_displacement' ? [reactionMomentName(index)] : [])]), run.request.loads.some(load => load.type === 'gravity')),
              parseCalculiXContactFrdV2(await readUtf8FileBounded(join(run.directory, 'tunacadv2.frd'))), parseCalculiXContactStaV2(await readUtf8FileBounded(join(run.directory, 'tunacadv2.sta'))), this.id, this.version, this.runtimeVersion)
            : run.request.analysis.type === 'nonlinear_static'
              ? normalizeNonlinear(run,
                parseCalculiXNonlinearDatV2(contents, run.model, run.request.constraints.map((_constraint, index) => reactionName(index))),
                parseCalculiXNonlinearStaV2(await readUtf8FileBounded(join(run.directory, 'tunacadv2.sta')), run.request.analysis.settings.steps.map(step => step.duration)),
                this.id, this.version, this.runtimeVersion)
          : (() => {
          const reactionSets = run.request.constraints.flatMap((constraint, index) => [reactionName(index), ...(constraint.type === 'remote_displacement' ? [reactionMomentName(index)] : [])]);
          return normalize(run, parseCalculiXDatV2(contents, run.model, reactionSets, run.request.loads.some(load => load.type === 'gravity')), this.id, this.version, this.runtimeVersion);
        })();
      validateNeutralSimulationResultV2(normalized.result, run.request);
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
  const equivalentPlasticStrainByElement = new Map<number, number>();
  const energyDensityByElement = new Map<number, number>();
  const reactions: Record<string, NeutralVector3> = {}; let mode: 'u' | 'rf' | 's' | 'volume' | 'peeq' | 'energy_density' | 'internal_energy' | null = null; let reaction: string | null = null; let totalVolumeMm3: number | null = null; let totalInternalEnergyNmm: number | null = null;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.length > 4096) throw new Error('CalculiX v2 result contains an oversized record.'); const lower = raw.toLowerCase();
    if (lower.includes('displacements') && lower.includes('for set')) { mode = 'u'; continue; }
    if ((lower.includes('total force') || lower.includes('forces')) && lower.includes('for set')) { mode = 'rf'; reaction = /for set\s+([a-z0-9_-]+)/i.exec(raw)?.[1]?.toUpperCase() ?? null; continue; }
    if (lower.includes('stresses') && lower.includes('for set')) { mode = 's'; continue; }
    if ((lower.includes('equivalent plastic strain') || lower.includes('peeq')) && lower.includes('for set')) { mode = 'peeq'; continue; }
    if (lower.includes('energy density')) { mode = 'energy_density'; continue; }
    if ((lower.includes('total internal energy') || lower.includes('total strain energy')) && lower.includes('for set')) { mode = 'internal_energy'; continue; }
    if (lower.includes('volume') && lower.includes('for set')) { mode = 'volume'; continue; }
    if (!raw.trim()) continue;
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
    else if (mode === 'peeq' && values.length >= 3) { const element = Math.trunc(values[0]) - 1; if (model.volumeElements.domainIds[element]) equivalentPlasticStrainByElement.set(element, Math.max(equivalentPlasticStrainByElement.get(element) ?? 0, values.at(-1)!)); }
    else if (mode === 'energy_density' && values.length >= 3) { const element = Math.trunc(values[0]) - 1; if (model.volumeElements.domainIds[element]) energyDensityByElement.set(element, Math.max(energyDensityByElement.get(element) ?? 0, values.at(-1)!)); }
    else if (mode === 'internal_energy') totalInternalEnergyNmm = values.at(-1)!;
    else if (mode === 'volume') totalVolumeMm3 = values.at(-1)!;
  }
  if (reactionSets.some(name => !reactions[name]) || [...byDomain.values()].some(item => item.maximumDisplacementNode < 0 || item.maximumStressElement < 0 || !Number.isFinite(item.maximumDisplacementMm) || !Number.isFinite(item.maximumVonMisesStressMPa))
    || (expectVolume && !(totalVolumeMm3 && totalVolumeMm3 > 0))) throw new Error('CalculiX did not produce complete finite per-domain SIM-4A output.');
  return { byDomain, reactions, totalVolumeMm3, displacements, vonMisesByElement, equivalentPlasticStrainByElement, energyDensityByElement, totalInternalEnergyNmm };
}

export interface CalculiXContactNodeOutput { normalGapMm: number; tangentialSlipMm: number; pressureMPa: number; shearMPa: number }

/** Read the final CONTACTR block produced by `*CONTACT FILE`. CalculiX stores
 * COPEN, two tangential relative displacements, CPRESS and two shear stresses
 * in that order. The normalized contact result retains magnitudes for both
 * tangential relative displacement and tangential shear. */
export function parseCalculiXContactFrdV2(text: string): Map<number, CalculiXContactNodeOutput> {
  if (text.split(/\r?\n/).length > 4_000_000) throw new Error('CalculiX contact field result contains too many records.');
  let active = false; let sawContactBlock = false; let current = new Map<number, CalculiXContactNodeOutput>(); let latest = new Map<number, CalculiXContactNodeOutput>();
  for (const raw of text.split(/\r?\n/)) {
    if (raw.length > 4096) throw new Error('CalculiX contact field result contains an oversized record.');
    if (/^\s*-4\s+CONTACT(?:R)?\b/i.test(raw)) { active = true; sawContactBlock = true; current = new Map(); continue; }
    if (active && /^\s*-3\b/.test(raw)) { latest = current; active = false; continue; }
    if (!active || !/^\s*-1\b/.test(raw)) continue;
    const values = numericFields(raw);
    if (values.length !== 8 || values[0] !== -1 || !Number.isInteger(values[1]) || values[1] <= 0) throw new Error('CalculiX contact FRD contains a malformed CONTACTR record.');
    const normalGapMm = values[2]; const tangentialSlipMm = Math.hypot(values[3], values[4]); const pressureMPa = values[5]; const shearMPa = Math.hypot(values[6], values[7]);
    if (Math.abs(normalGapMm) > 1e6 || Math.abs(pressureMPa) > 1e12 || shearMPa > 1e12) throw new Error(`CalculiX contact FRD contains an invalid gap, pressure, or shear magnitude (${normalGapMm} mm, ${pressureMPa} MPa, ${shearMPa} MPa).`);
    current.set(values[1] - 1, { normalGapMm, tangentialSlipMm, pressureMPa, shearMPa });
  }
  if (active) latest = current;
  if (!sawContactBlock) throw new Error('CalculiX did not produce a final CONTACTR field.');
  return latest;
}

/** Parse bounded successful-increment records from the CalculiX status file. */
export function parseCalculiXContactStaV2(text: string) {
  if (text.split(/\r?\n/).length > 100_000) throw new Error('CalculiX contact status contains too many records.');
  const increments: Array<{ increment: number; attempt: number; iterations: number; stepTime: number; incrementSize: number }> = [];
  for (const raw of text.split(/\r?\n/)) {
    if (raw.length > 4096) throw new Error('CalculiX contact status contains an oversized record.');
    const fields = raw.trim().split(/\s+/);
    if (fields.length !== 7 || fields.slice(0, 4).some(field => !/^\d+$/.test(field))) continue;
    const values = fields.map(field => Number(field.replace(/[dD]/g, 'E')));
    if (values.some(value => !Number.isFinite(value)) || values[0] !== 1 || values[1] < 1 || values[2] < 1 || values[3] < 1) continue;
    const iterations = values[3]; const stepTime = values[5]; const incrementSize = values[6];
    if (!Number.isInteger(iterations) || iterations < 1 || !Number.isFinite(stepTime) || stepTime < 0 || !Number.isFinite(incrementSize) || incrementSize <= 0) continue;
    increments.push({ increment: values[1], attempt: values[2], iterations, stepTime, incrementSize });
  }
  if (!increments.length || Math.abs(increments.at(-1)!.stepTime - 1) > 1e-8
    || increments.some((entry, index) => index > 0 && (entry.increment <= increments[index - 1].increment || entry.stepTime <= increments[index - 1].stepTime))) {
    throw new Error('CalculiX did not report a complete, ordered contact increment history.');
  }
  return increments;
}

/** Parse every successful increment from every ordered SIM-7A step. The
 * CalculiX status columns are step, increment, attempt, iterations, total
 * pseudo-time, step pseudo-time, and increment size. */
export function parseCalculiXNonlinearStaV2(text: string, durations: number[]) {
  if (text.split(/\r?\n/).length > 100_000) throw new Error('CalculiX nonlinear status contains too many records.');
  const steps = durations.map((duration, index) => ({ stepIndex: index + 1, duration, increments: [] as Array<{ increment: number; attempt: number; iterations: number; stepTime: number; totalTime: number; incrementSize: number }> }));
  for (const raw of text.split(/\r?\n/)) {
    if (raw.length > 4096) throw new Error('CalculiX nonlinear status contains an oversized record.');
    const fields = raw.trim().split(/\s+/);
    if (fields.length !== 7 || fields.slice(0, 4).some(field => !/^\d+$/.test(field))) continue;
    const values = fields.map(field => Number(field.replace(/[dD]/g, 'E')));
    const [stepIndex, increment, attempt, iterations, totalTime, stepTime, incrementSize] = values;
    const step = steps[stepIndex - 1];
    if (!step || values.some(value => !Number.isFinite(value)) || ![stepIndex, increment, attempt, iterations].every(Number.isInteger)
      || increment < 1 || attempt < 1 || iterations < 1 || totalTime < 0 || stepTime < 0 || incrementSize <= 0) continue;
    step.increments.push({ increment, attempt, iterations, stepTime, totalTime, incrementSize });
  }
  let priorTotalTime = -Infinity;
  for (const step of steps) {
    if (!step.increments.length || Math.abs(step.increments.at(-1)!.stepTime - step.duration) > Math.max(1e-8, step.duration * 1e-8)
      || step.increments.some((entry, index, entries) => index > 0 && (entry.increment <= entries[index - 1].increment || entry.stepTime <= entries[index - 1].stepTime)
        || entry.totalTime <= (index > 0 ? entries[index - 1].totalTime : priorTotalTime))) throw new Error(`CalculiX did not report a complete, ordered nonlinear increment history for step ${step.stepIndex}.`);
    priorTotalTime = step.increments.at(-1)!.totalTime;
  }
  return steps;
}

/** Split increment-frequency text output at each NALL displacement heading and
 * reuse the hardened static parser for a complete response frame. */
export function parseCalculiXNonlinearDatV2(text: string, model: NeutralFemModelV2, reactionSets: string[]) {
  if (text.split(/\r?\n/).length > 4_000_000) throw new Error('CalculiX nonlinear result contains too many records.');
  const starts = [...text.matchAll(/^.*displacements.*for set\s+NALL\b.*$/gim)].map(match => match.index!);
  if (!starts.length) throw new Error('CalculiX did not produce nonlinear increment displacement frames.');
  return starts.map((start, index) => {
    const frame = text.slice(start, starts[index + 1] ?? text.length);
    return parseCalculiXDatV2(frame, model, reactionSets, false);
  });
}

type ModalSix = [number, number, number, number, number, number];
interface ModalDatMode {
  modeNumber: number; eigenvalueRad2PerS2: number; angularFrequencyRadPerS: number;
  frequencyHz: number; imaginaryAngularFrequencyRadPerS: number;
  participationFactors: ModalSix; effectiveModalMass: ModalSix;
}

/** Parse the bounded, text-mode CalculiX frequency summary without accepting
 * incomplete rows. CalculiX writes the six components in X/Y/Z translation
 * followed by X/Y/Z rotation order. */
export function parseCalculiXModalDatV2(text: string): { modes: ModalDatMode[]; totalEffectiveModalMass: ModalSix; totalEffectiveMass: ModalSix } {
  if (text.split(/\r?\n/).length > 2_000_000) throw new Error('CalculiX modal result contains too many records.');
  const eigen = new Map<number, Omit<ModalDatMode, 'participationFactors' | 'effectiveModalMass'>>();
  const participation = new Map<number, ModalSix>();
  const effective = new Map<number, ModalSix>();
  let section: 'eigen' | 'participation' | 'effective' | 'total-mass' | null = null;
  let totalEffectiveModalMass: ModalSix | null = null; let totalEffectiveMass: ModalSix | null = null;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.length > 4096) throw new Error('CalculiX modal result contains an oversized record.');
    const heading = raw.replace(/\s+/g, ' ').trim().toUpperCase();
    if (heading === 'E I G E N V A L U E O U T P U T') { section = 'eigen'; continue; }
    if (heading === 'P A R T I C I P A T I O N F A C T O R S') { section = 'participation'; continue; }
    if (heading === 'E F F E C T I V E M O D A L M A S S') { section = 'effective'; continue; }
    if (heading === 'T O T A L E F F E C T I V E M A S S') { section = 'total-mass'; continue; }
    const values = numericFields(raw);
    if (section === 'eigen' && values.length === 5 && Number.isInteger(values[0]) && values[0] > 0) {
      eigen.set(values[0], { modeNumber: values[0], eigenvalueRad2PerS2: values[1], angularFrequencyRadPerS: values[2], frequencyHz: values[3], imaginaryAngularFrequencyRadPerS: values[4] });
    } else if (section === 'participation' && values.length === 7 && Number.isInteger(values[0])) participation.set(values[0], values.slice(1) as ModalSix);
    else if (section === 'effective' && /^\s*TOTAL\b/i.test(raw) && values.length === 6) totalEffectiveModalMass = values as ModalSix;
    else if (section === 'effective' && values.length === 7 && Number.isInteger(values[0])) effective.set(values[0], values.slice(1) as ModalSix);
    else if (section === 'total-mass' && values.length === 6) totalEffectiveMass = values as ModalSix;
  }
  const modes = [...eigen.values()].sort((a, b) => a.modeNumber - b.modeNumber).map(mode => ({
    ...mode,
    participationFactors: participation.get(mode.modeNumber) ?? missingModal(`participation factors for mode ${mode.modeNumber}`),
    effectiveModalMass: effective.get(mode.modeNumber) ?? missingModal(`effective modal mass for mode ${mode.modeNumber}`),
  }));
  if (!modes.length || !totalEffectiveModalMass || !totalEffectiveMass || modes.some(mode => mode.eigenvalueRad2PerS2 < 0 || mode.frequencyHz < 0 || mode.angularFrequencyRadPerS < 0
    || mode.imaginaryAngularFrequencyRadPerS > Math.max(1e-8, mode.angularFrequencyRadPerS * 1e-8))) {
    throw new Error('CalculiX did not produce a complete finite modal summary.');
  }
  return { modes, totalEffectiveModalMass, totalEffectiveMass };
}

/** Read only modal DISP records from CalculiX FRD. The parser handles adjacent
 * signed exponential fields (a normal fixed-width FRD representation). */
export function parseCalculiXModalFrdV2(text: string): Map<number, Map<number, NeutralVector3>> {
  if (text.split(/\r?\n/).length > 4_000_000) throw new Error('CalculiX modal field result contains too many records.');
  const shapes = new Map<number, Map<number, NeutralVector3>>();
  let modeNumber: number | null = null; let reading = false;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.length > 4096) throw new Error('CalculiX modal field result contains an oversized record.');
    const modeMatch = /^\s*1PMODE\s+(\d+)/.exec(raw);
    if (modeMatch) { modeNumber = Number(modeMatch[1]); reading = false; continue; }
    if (/^\s*-4\s+DISP\b/.test(raw)) {
      if (!modeNumber) throw new Error('CalculiX modal field has DISP data without a mode number.');
      shapes.set(modeNumber, new Map()); reading = true; continue;
    }
    if (reading && /^\s*-3\b/.test(raw)) { reading = false; continue; }
    if (!reading || !/^\s*-1\b/.test(raw) || !modeNumber) continue;
    const values = numericFields(raw);
    if (values.length !== 5 || values[0] !== -1 || !Number.isInteger(values[1]) || values[1] <= 0) throw new Error('CalculiX modal FRD contains a malformed displacement record.');
    shapes.get(modeNumber)!.set(values[1] - 1, values.slice(2) as NeutralVector3);
  }
  if (!shapes.size || [...shapes.values()].some(shape => !shape.size)) throw new Error('CalculiX did not produce modal displacement fields.');
  return shapes;
}

interface BucklingDatMode { modeNumber: number; eigenvalueLoadFactor: number }

/** Parse only the bounded CalculiX buckling-factor table. Negative and zero
 * factors are rejected by this first provider envelope because it qualifies a
 * compressive reference load in the declared direction, not reverse loading. */
export function parseCalculiXBucklingDatV2(text: string): { modes: BucklingDatMode[] } {
  if (text.split(/\r?\n/).length > 2_000_000) throw new Error('CalculiX buckling result contains too many records.');
  const modes: BucklingDatMode[] = [];
  let reading = false;
  const number = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[EeDd][-+]?\\d+)?';
  const row = new RegExp(`^\\s*(\\d+)\\s+(${number})\\s*$`);
  for (const raw of text.split(/\r?\n/)) {
    if (raw.length > 4096) throw new Error('CalculiX buckling result contains an oversized record.');
    const heading = raw.replace(/\s+/g, ' ').trim().toUpperCase();
    if (heading === 'B U C K L I N G F A C T O R O U T P U T') { reading = true; continue; }
    if (!reading) continue;
    const match = row.exec(raw);
    if (!match) continue;
    const modeNumber = Number(match[1]);
    const eigenvalueLoadFactor = Number(match[2].replace(/[dD]/g, 'E'));
    if (modeNumber !== modes.length + 1 || !(eigenvalueLoadFactor > 0) || !Number.isFinite(eigenvalueLoadFactor) || modes.length >= 12) {
      throw new Error('CalculiX returned an invalid or non-deterministic buckling-factor sequence.');
    }
    modes.push({ modeNumber, eigenvalueLoadFactor });
  }
  if (!modes.length) throw new Error('CalculiX did not produce positive linear-buckling factors.');
  return { modes };
}

/** CalculiX identifies buckling eigenvectors by positive 100CL load factors,
 * rather than the 1PMODE records used by frequency analyses. */
export function parseCalculiXBucklingFrdV2(text: string): { shapes: Map<number, Map<number, NeutralVector3>>; factors: number[] } {
  if (text.split(/\r?\n/).length > 4_000_000) throw new Error('CalculiX buckling field result contains too many records.');
  const shapes = new Map<number, Map<number, NeutralVector3>>();
  const factors: number[] = [];
  const float = '([-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[EeDd][-+]?\\d+)?)';
  const classRecord = new RegExp(`^\\s*100CL\\s+\\d+\\s+${float}`);
  let currentFactor = 0; let activeMode: number | null = null; let reading = false;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.length > 4096) throw new Error('CalculiX buckling field result contains an oversized record.');
    const classMatch = classRecord.exec(raw);
    if (classMatch) { currentFactor = Number(classMatch[1].replace(/[dD]/g, 'E')); reading = false; activeMode = null; continue; }
    if (/^\s*-4\s+DISP\b/.test(raw)) {
      reading = false; activeMode = null;
      if (!(currentFactor > 0) || !Number.isFinite(currentFactor)) continue;
      activeMode = factors.length + 1; factors.push(currentFactor); shapes.set(activeMode, new Map()); reading = true; continue;
    }
    if (reading && /^\s*-3\b/.test(raw)) { reading = false; continue; }
    if (!reading || activeMode === null || !/^\s*-1\b/.test(raw)) continue;
    const values = numericFields(raw);
    if (values.length !== 5 || values[0] !== -1 || !Number.isInteger(values[1]) || values[1] <= 0) throw new Error('CalculiX buckling FRD contains a malformed displacement record.');
    shapes.get(activeMode)!.set(values[1] - 1, values.slice(2) as NeutralVector3);
  }
  if (!shapes.size || shapes.size !== factors.length || [...shapes.values()].some(shape => !shape.size)) throw new Error('CalculiX did not produce buckling displacement fields.');
  return { shapes, factors };
}

function normalizeModal(run: Run, parsed: ReturnType<typeof parseCalculiXModalDatV2>, rawShapes: Map<number, Map<number, NeutralVector3>>, adapterId: string, adapterVersion: string, runtimeVersion: string) {
  if (run.request.analysis.type !== 'modal') throw new Error('Modal normalization received a non-modal request.');
  if (parsed.modes.length > run.request.analysis.settings.requestedModeCount
    || parsed.modes.some(mode => mode.modeNumber > run.request.analysis.settings.requestedModeCount)) throw new Error('CalculiX returned a mode outside the requested range.');
  const shapes = new Map<number, Map<number, NeutralVector3>>();
  for (const mode of parsed.modes) {
    const raw = rawShapes.get(mode.modeNumber);
    if (!raw || run.model.nodes.some((_, node) => !raw.has(node))) throw new Error(`CalculiX omitted mode-shape nodes for mode ${mode.modeNumber}.`);
    let anchorNode = -1; let maximum = -Infinity;
    for (const [node, vector] of [...raw.entries()].sort(([a], [b]) => a - b)) {
      const magnitude = Math.hypot(...vector);
      if (magnitude > maximum) { maximum = magnitude; anchorNode = node; }
    }
    if (!(maximum > 0) || anchorNode < 0) throw new Error(`CalculiX mode ${mode.modeNumber} has a zero or invalid eigenvector.`);
    const anchor = raw.get(anchorNode)!; const dominant = anchor.reduce((best, value, index) => Math.abs(value) > Math.abs(anchor[best]) ? index : best, 0);
    const sign = anchor[dominant] < 0 ? -1 : 1;
    shapes.set(mode.modeNumber, new Map([...raw].map(([node, vector]) => [node, vector.map(value => sign * value / maximum) as NeutralVector3])));
  }
  const datasets = buildModalFieldDatasets(run, parsed.modes, shapes);
  const perDomain = run.model.domainRegions.map(domain => ({
    domainId: domain.domainId,
    metrics: { maximumVonMisesStressMPa: null, maximumDisplacementMm: null, minimumFactorOfSafety: null },
    fieldDatasetIds: parsed.modes.map(mode => modalDatasetId(run.providerRunId, domain.domainId, mode.modeNumber)),
  }));
  const firstElasticFrequency = parsed.modes.find(mode => mode.frequencyHz > 0)?.frequencyHz ?? Math.max(...parsed.modes.map(mode => mode.frequencyHz));
  const thresholdHz = Math.max(1e-6, firstElasticFrequency * 1e-4);
  const omittedLeadingModeNumbers = run.request.constraints.length ? [] : Array.from({ length: Math.max(0, parsed.modes[0].modeNumber - 1) }, (_, index) => index + 1);
  const reportedRigidModeNumbers = parsed.modes.filter(mode => mode.frequencyHz <= thresholdHz).map(mode => mode.modeNumber);
  const rigidModeNumbers = [...new Set([...omittedLeadingModeNumbers, ...reportedRigidModeNumbers])].sort((a, b) => a - b);
  const expectedRigidModeCount: 0 | 6 = run.request.constraints.length ? 0 : 6;
  if (rigidModeNumbers.length > 6 || (!run.request.constraints.length && (rigidModeNumbers.length !== 6 || rigidModeNumbers.some((modeNumber, index) => modeNumber !== index + 1)))) {
    throw new Error(`CalculiX free-free rigid-body classification is incomplete or ambiguous (${rigidModeNumbers.join(', ') || 'none'}).`);
  }
  const completedAt = new Date().toISOString();
  const modes = parsed.modes.map(mode => ({ ...mode, fieldDatasetIds: run.model.domainRegions.map(domain => modalDatasetId(run.providerRunId, domain.domainId, mode.modeNumber)) }));
  const result: NeutralSimulationResultV2 = {
    schema: 'tunacad-neutral-simulation-result/2.0', studyId: run.request.studyId, jobId: run.providerRunId,
    requestDigest: run.request.requestDigest, projectRevision: run.request.model.projectRevision, modelDigest: run.request.model.modelDigest,
    analysisType: 'modal', status: 'succeeded', authority: 'engineering',
    metrics: { maximumVonMisesStressMPa: null, maximumDisplacementMm: null, minimumFactorOfSafety: null },
    perDomain, reactions: [], criticalRegions: [], failedConstraints: [],
    warnings: [{ code: 'SIMULATION_PROVIDER_POC', message: `Experimental SIM-5 ${run.request.constraints.length ? 'constrained' : 'free-free'} modal result; qualified-engineer review is mandatory.`, severity: 'warning' }],
    convergence: { status: 'converged', iterations: null, residual: null, providerDeclared: true },
    suggestedEngineeringIssues: ['Verify frequency convergence, boundary conditions, density, and effective-mass coverage.'],
    modal: {
      massFormulation: 'consistent', solverNormalization: 'mass', visualizationNormalization: 'maximum_vector_magnitude_1',
      requestedModeCount: run.request.analysis.settings.requestedModeCount, modes,
      totalEffectiveModalMass: parsed.totalEffectiveModalMass, totalEffectiveMass: parsed.totalEffectiveMass,
      effectiveMassCoverage: parsed.totalEffectiveModalMass.map((value, axis) => parsed.totalEffectiveMass[axis] > 0 ? value / parsed.totalEffectiveMass[axis] : 0) as ModalSix,
      rigidBodyModeDiagnostics: {
        thresholdHz, expectedModeCount: expectedRigidModeCount, detectedModeCount: rigidModeNumbers.length,
        modeNumbers: rigidModeNumbers, status: rigidModeNumbers.length === expectedRigidModeCount ? 'complete' : 'incomplete',
      },
    },
    provenance: { providerInterfaceVersion: '2.0', adapterId, adapterVersion, providerRunId: run.providerRunId, submittedAt: run.submittedAt, completedAt, normalizedAt: completedAt },
    review: { engineerReviewRequired: true, engineeringUsePermitted: false, disclaimer: `CalculiX ${runtimeVersion} experimental modal result. Not certified.` },
    mutation: { occurred: false, projectRevisionBefore: run.request.model.projectRevision, projectRevisionAfter: run.request.model.projectRevision },
  };
  return { result, datasets };
}

function normalizeBuckling(run: Run, parsed: ReturnType<typeof parseCalculiXBucklingDatV2>, rawFields: ReturnType<typeof parseCalculiXBucklingFrdV2>, adapterId: string, adapterVersion: string, runtimeVersion: string) {
  if (run.request.analysis.type !== 'linear_buckling') throw new Error('Buckling normalization received a non-buckling request.');
  if (parsed.modes.length > run.request.analysis.settings.requestedModeCount || parsed.modes.length !== rawFields.factors.length) {
    throw new Error('CalculiX returned a buckling-mode count outside the requested range.');
  }
  const shapes = new Map<number, Map<number, NeutralVector3>>();
  for (const mode of parsed.modes) {
    const raw = rawFields.shapes.get(mode.modeNumber);
    const fieldFactor = rawFields.factors[mode.modeNumber - 1];
    if (!raw || run.model.nodes.some((_, node) => !raw.has(node))
      || Math.abs(fieldFactor - mode.eigenvalueLoadFactor) > Math.max(1e-8, Math.abs(mode.eigenvalueLoadFactor) * 1e-5)) {
      throw new Error(`CalculiX omitted or mismatched buckling field data for mode ${mode.modeNumber}.`);
    }
    let anchorNode = -1; let maximum = -Infinity;
    for (const [node, vector] of [...raw.entries()].sort(([a], [b]) => a - b)) {
      const magnitude = Math.hypot(...vector);
      if (magnitude > maximum) { maximum = magnitude; anchorNode = node; }
    }
    if (!(maximum > 0) || anchorNode < 0) throw new Error(`CalculiX buckling mode ${mode.modeNumber} has a zero or invalid eigenvector.`);
    const anchor = raw.get(anchorNode)!; const dominant = anchor.reduce((best, value, index) => Math.abs(value) > Math.abs(anchor[best]) ? index : best, 0);
    const sign = anchor[dominant] < 0 ? -1 : 1;
    shapes.set(mode.modeNumber, new Map([...raw].map(([node, vector]) => [node, vector.map(value => sign * value / maximum) as NeutralVector3])));
  }
  const datasets = buildBucklingFieldDatasets(run, parsed.modes, shapes);
  const perDomain = run.model.domainRegions.map(domain => ({
    domainId: domain.domainId,
    metrics: { maximumVonMisesStressMPa: null, maximumDisplacementMm: null, minimumFactorOfSafety: null },
    fieldDatasetIds: parsed.modes.map(mode => bucklingDatasetId(run.providerRunId, domain.domainId, mode.modeNumber)),
  }));
  const completedAt = new Date().toISOString();
  const modes = parsed.modes.map(mode => ({ ...mode, fieldDatasetIds: run.model.domainRegions.map(domain => bucklingDatasetId(run.providerRunId, domain.domainId, mode.modeNumber)) }));
  const result: NeutralSimulationResultV2 = {
    schema: 'tunacad-neutral-simulation-result/2.0', studyId: run.request.studyId, jobId: run.providerRunId,
    requestDigest: run.request.requestDigest, projectRevision: run.request.model.projectRevision, modelDigest: run.request.model.modelDigest,
    analysisType: 'linear_buckling', status: 'succeeded', authority: 'engineering',
    metrics: { maximumVonMisesStressMPa: null, maximumDisplacementMm: null, minimumFactorOfSafety: null },
    perDomain, reactions: [], criticalRegions: [], failedConstraints: [],
    warnings: [
      { code: 'SIMULATION_PROVIDER_POC', message: 'Experimental SIM-5 linear-buckling result; qualified-engineer review is mandatory.', severity: 'warning' },
      { code: 'SIMULATION_LINEAR_BUCKLING_LIMITATION', message: 'Eigenvalue load factors predict idealized linear bifurcation from the declared reference load. They do not predict nonlinear collapse, imperfections, plasticity, or contact changes.', severity: 'warning' },
    ],
    convergence: { status: 'converged', iterations: null, residual: null, providerDeclared: true },
    suggestedEngineeringIssues: ['Verify eigenvalue mesh convergence and evaluate geometric/material imperfections with nonlinear analysis before using a collapse load.'],
    buckling: {
      preloadCaseId: run.request.analysis.settings.preloadCase.id,
      requestedModeCount: run.request.analysis.settings.requestedModeCount,
      solverNormalization: 'eigenvector', visualizationNormalization: 'maximum_vector_magnitude_1',
      prediction: 'linear_eigenvalue_not_nonlinear_collapse', modes,
    },
    provenance: { providerInterfaceVersion: '2.0', adapterId, adapterVersion, providerRunId: run.providerRunId, submittedAt: run.submittedAt, completedAt, normalizedAt: completedAt },
    review: { engineerReviewRequired: true, engineeringUsePermitted: false, disclaimer: `CalculiX ${runtimeVersion} experimental linear-buckling result. Not certified.` },
    mutation: { occurred: false, projectRevisionBefore: run.request.model.projectRevision, projectRevisionAfter: run.request.model.projectRevision },
  };
  return { result, datasets };
}

function buildModalFieldDatasets(run: Run, modes: ModalDatMode[], shapes: Map<number, Map<number, NeutralVector3>>) {
  const datasets = new Map<string, { descriptor: NeutralSimulationFieldDatasetV2; triangles: NeutralSimulationFieldTriangleV2[] }>();
  for (const mode of modes) for (const domain of run.model.domainRegions) {
    const shape = shapes.get(mode.modeNumber)!;
    const triangles = renderTriangles(run, domain.domainId, shape).map(triangle => ({
      ...triangle, values: triangle.displacementsMm.map(vector => Math.hypot(...vector)) as [number, number, number],
    }));
    const datasetId = modalDatasetId(run.providerRunId, domain.domainId, mode.modeNumber);
    const references = run.model.boundaryRegions.filter(region => region.domainId === domain.domainId).flatMap(region => region.semanticReferenceIds);
    const descriptor: NeutralSimulationFieldDatasetV2 = {
      schema: 'tunacad-neutral-simulation-field-dataset/2.0', datasetId, jobId: run.providerRunId, domainId: domain.domainId,
      analysisType: 'modal', step: { index: mode.modeNumber, label: `Mode ${mode.modeNumber}`, modeNumber: mode.modeNumber, frequencyHz: mode.frequencyHz },
      component: 'mode_shape_magnitude', unit: 'normalized', location: 'boundary_facet', topology: 'triangle_soup',
      valueRange: fieldExtrema(triangles), deformation: { vectorsIncluded: true, trueScale: 1, recommendedScale: boundingDiagonal(domain.nodeIndices.map(index => run.model.nodes[index])) * 0.08 },
      mapping: { domain: 'exact', cadRegions: 'partial', semanticReferenceIds: [...new Set(references)].sort(compareText) },
      totalTriangles: triangles.length, maximumPageTriangles: 128, datasetDigest: digest(triangles),
    };
    datasets.set(datasetId, { descriptor, triangles });
  }
  return datasets;
}

function buildBucklingFieldDatasets(run: Run, modes: BucklingDatMode[], shapes: Map<number, Map<number, NeutralVector3>>) {
  const datasets = new Map<string, { descriptor: NeutralSimulationFieldDatasetV2; triangles: NeutralSimulationFieldTriangleV2[] }>();
  for (const mode of modes) for (const domain of run.model.domainRegions) {
    const shape = shapes.get(mode.modeNumber)!;
    const triangles = renderTriangles(run, domain.domainId, shape).map(triangle => ({
      ...triangle, values: triangle.displacementsMm.map(vector => Math.hypot(...vector)) as [number, number, number],
    }));
    const datasetId = bucklingDatasetId(run.providerRunId, domain.domainId, mode.modeNumber);
    const references = run.model.boundaryRegions.filter(region => region.domainId === domain.domainId).flatMap(region => region.semanticReferenceIds);
    const descriptor: NeutralSimulationFieldDatasetV2 = {
      schema: 'tunacad-neutral-simulation-field-dataset/2.0', datasetId, jobId: run.providerRunId, domainId: domain.domainId,
      analysisType: 'linear_buckling', step: { index: mode.modeNumber, label: `Buckling mode ${mode.modeNumber}`, bucklingModeNumber: mode.modeNumber, eigenvalueLoadFactor: mode.eigenvalueLoadFactor },
      component: 'buckling_mode_shape_magnitude', unit: 'normalized', location: 'boundary_facet', topology: 'triangle_soup',
      valueRange: fieldExtrema(triangles), deformation: { vectorsIncluded: true, trueScale: 1, recommendedScale: boundingDiagonal(domain.nodeIndices.map(index => run.model.nodes[index])) * 0.08 },
      mapping: { domain: 'exact', cadRegions: 'partial', semanticReferenceIds: [...new Set(references)].sort(compareText) },
      totalTriangles: triangles.length, maximumPageTriangles: 128, datasetDigest: digest(triangles),
    };
    datasets.set(datasetId, { descriptor, triangles });
  }
  return datasets;
}

function normalizeNonlinear(
  run: Run,
  frames: ReturnType<typeof parseCalculiXNonlinearDatV2>,
  statusSteps: ReturnType<typeof parseCalculiXNonlinearStaV2>,
  adapterId: string,
  adapterVersion: string,
  runtimeVersion: string,
) {
  if (run.request.analysis.type !== 'nonlinear_static') throw new Error('Nonlinear normalization received a non-nonlinear request.');
  const plastic = run.request.materials.some(material => material.model === 'isotropic_elastic_plastic');
  const requestedSteps = run.request.analysis.settings.steps;
  const increments = statusSteps.flatMap((step, stepOffset) => step.increments.map(increment => ({ stepOffset, increment })));
  if (frames.length !== increments.length) throw new Error(`CalculiX nonlinear response-frame count ${frames.length} does not match ${increments.length} converged increments.`);
  const finalStep = requestedSteps.at(-1)!;
  const finalLoads = finalStep.loadAmplitudes.map(entry => {
    const load = run.request.loads.find(candidate => candidate.id === entry.loadId)!;
    const scale = entry.points.at(-1)!.scaleFactor;
    return load.type === 'surface_force' ? { ...load, forceN: load.forceN.map(value => value * scale) as NeutralVector3 }
      : load.type === 'pressure' ? { ...load, pressureMPa: load.pressureMPa * scale }
        : load.type === 'gravity' ? { ...load, accelerationMmPerS2: load.accelerationMmPerS2.map(value => value * scale) as NeutralVector3 }
          : load;
  });
  const effectiveRequest = {
    ...run.request,
    analysis: { type: 'linear_static' as const, assumptions: ['small_displacement', 'small_strain', 'static_loading'] as const },
    loads: finalLoads,
    requestedResults: ['von_mises_stress', 'displacement', 'reaction_force'] as Array<'von_mises_stress' | 'displacement' | 'reaction_force'>,
  } as NeutralSimulationRequestV2;
  const base = normalize({ ...run, request: effectiveRequest }, frames.at(-1)!, adapterId, adapterVersion, runtimeVersion);
  const finalTotalTime = statusSteps.at(-1)!.increments.at(-1)!.totalTime;
  for (const [datasetId, dataset] of base.datasets) base.datasets.set(datasetId, {
    ...dataset,
    descriptor: {
      ...dataset.descriptor, analysisType: 'nonlinear_static',
      step: { index: requestedSteps.length, label: 'final_nonlinear_increment', stepId: finalStep.id, totalTime: finalTotalTime },
    } as NeutralSimulationFieldDatasetV2,
  });
  const materialDatasets = plastic ? buildNonlinearMaterialFieldDatasets(run, frames.at(-1)!, requestedSteps.length, finalStep.id, finalTotalTime) : new Map();
  for (const [datasetId, dataset] of materialDatasets) base.datasets.set(datasetId, dataset);
  const history = increments.map(({ stepOffset, increment }, index) => {
    const requested = requestedSteps[stepOffset];
    const parsed = frames[index];
    return {
      stepIndex: stepOffset + 1, stepId: requested.id, increment: increment.increment, attempt: increment.attempt,
      iterations: increment.iterations, stepTime: increment.stepTime, totalTime: increment.totalTime, incrementSize: increment.incrementSize,
      loadScaleFactors: requested.loadAmplitudes.map(entry => ({ loadId: entry.loadId, scaleFactor: interpolate(entry.points, increment.stepTime / requested.duration) })),
      maximumDisplacementMm: Math.max(...[...parsed.byDomain.values()].map(domain => domain.maximumDisplacementMm)),
      resultantReactionForceN: Object.values(parsed.reactions).reduce<NeutralVector3>(add, [0, 0, 0]),
      materialState: plastic ? nonlinearMaterialState(run, parsed) : null,
    };
  });
  const totalIterations = increments.reduce((sum, entry) => sum + entry.increment.iterations, 0);
  const result: NeutralSimulationResultV2 = {
    ...base.result,
    analysisType: 'nonlinear_static',
    perDomain: base.result.perDomain.map(domain => ({
      ...domain,
      fieldDatasetIds: [...domain.fieldDatasetIds, ...[...materialDatasets.values()].filter(dataset => dataset.descriptor.domainId === domain.domainId).map(dataset => dataset.descriptor.datasetId)],
    })),
    warnings: [
      { code: 'SIMULATION_PROVIDER_POC', message: `Experimental ${plastic ? 'SIM-7B material/geometric' : 'SIM-7A geometric'}-nonlinear result; qualified-engineer review is mandatory.`, severity: 'warning' },
      { code: 'SIMULATION_GEOMETRIC_NONLINEARITY_POC', message: `Finite-deformation kinematics are enabled with ${plastic ? 'tabulated isotropic elastic-plastic hardening' : 'an isotropic linear-elastic constitutive law'}. Review load path, increments, convergence, and mesh sensitivity.`, severity: 'warning' },
      ...(plastic ? [{ code: 'SIMULATION_MATERIAL_NONLINEARITY_POC', message: 'SIM-7B isotropic hardening is experimental; coupon and single-load plastic-hinge path evidence does not qualify reordered multi-axis loading or replace formal qualification and independent review.', severity: 'warning' as const }] : []),
    ],
    convergence: { status: 'converged', iterations: totalIterations, residual: null, providerDeclared: true },
    suggestedEngineeringIssues: ['Review the full force-displacement path, geometric stiffness, load-step amplitudes, increment cutbacks, and large-deformation mesh convergence.'],
    nonlinear: {
      formulation: plastic ? 'finite_deformation_elastic_plastic' : 'finite_deformation_elastic',
      steps: statusSteps.map((step, index) => ({
        stepIndex: index + 1, stepId: requestedSteps[index].id, converged: true,
        increments: step.increments.map(({ totalTime: _totalTime, ...increment }) => increment),
      })),
      history,
      materialState: plastic ? history.at(-1)!.materialState : null,
    },
    review: { engineerReviewRequired: true, engineeringUsePermitted: false, disclaimer: `CalculiX ${runtimeVersion} experimental ${plastic ? 'SIM-7B material/geometric' : 'SIM-7A geometric'}-nonlinear result. Not certified.` },
  };
  return { result, datasets: base.datasets };
}

function nonlinearMaterialState(run: Run, parsed: ReturnType<typeof parseCalculiXDatV2>) {
  const elementCount = run.model.volumeElements.connectivity.length;
  if (parsed.equivalentPlasticStrainByElement.size !== elementCount || parsed.energyDensityByElement.size !== elementCount
    || parsed.totalInternalEnergyNmm === null || !Number.isFinite(parsed.totalInternalEnergyNmm) || parsed.totalInternalEnergyNmm < 0) {
    throw new Error(`CalculiX omitted required finite SIM-7B plastic-strain or energy output (elements=${elementCount}, PEEQ=${parsed.equivalentPlasticStrainByElement.size}, ENER=${parsed.energyDensityByElement.size}, ELSE=${String(parsed.totalInternalEnergyNmm)}).`);
  }
  const plasticStrains = [...parsed.equivalentPlasticStrainByElement.values()];
  const energyDensities = [...parsed.energyDensityByElement.values()];
  if (plasticStrains.some(value => !Number.isFinite(value) || value < 0) || energyDensities.some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error('CalculiX produced invalid SIM-7B plastic-strain or energy output.');
  }
  return {
    maximumEquivalentPlasticStrain: Math.max(...plasticStrains),
    maximumEnergyDensityMPa: Math.max(...energyDensities),
    totalInternalEnergyNmm: parsed.totalInternalEnergyNmm,
    yieldedElementCount: plasticStrains.filter(value => value > 1e-12).length,
  };
}

function buildNonlinearMaterialFieldDatasets(
  run: Run,
  parsed: ReturnType<typeof parseCalculiXDatV2>,
  stepIndex: number,
  stepId: string,
  totalTime: number,
) {
  nonlinearMaterialState(run, parsed);
  const datasets = new Map<string, { descriptor: NeutralSimulationFieldDatasetV2; triangles: NeutralSimulationFieldTriangleV2[] }>();
  for (const domain of run.model.domainRegions) {
    const baseTriangles = renderTriangles(run, domain.domainId, parsed.displacements);
    const references = run.model.boundaryRegions.filter(region => region.domainId === domain.domainId).flatMap(region => region.semanticReferenceIds);
    const maximumDisplacement = parsed.byDomain.get(domain.domainId)!.maximumDisplacementMm;
    const diagonal = boundingDiagonal(domain.nodeIndices.map(index => run.model.nodes[index]));
    for (const [component, unit, suffix, values] of [
      ['equivalent_plastic_strain', 'dimensionless', 'plastic-strain', parsed.equivalentPlasticStrainByElement],
      ['strain_energy_density', 'MPa', 'energy-density', parsed.energyDensityByElement],
    ] as const) {
      const triangles = baseTriangles.map(triangle => {
        const value = values.get(triangle.elementIndex) ?? missingField(`element ${triangle.elementIndex}`);
        return { ...triangle, values: [value, value, value] as [number, number, number] };
      });
      const datasetId = `${run.providerRunId}:${domain.domainId}:${suffix}`;
      const descriptor: NeutralSimulationFieldDatasetV2 = {
        schema: 'tunacad-neutral-simulation-field-dataset/2.0', datasetId, jobId: run.providerRunId, domainId: domain.domainId,
        analysisType: 'nonlinear_static', step: { index: stepIndex, label: 'final_nonlinear_increment', stepId, totalTime }, component, unit,
        location: 'boundary_facet', topology: 'triangle_soup', valueRange: fieldExtrema(triangles),
        deformation: { vectorsIncluded: true, trueScale: 1, recommendedScale: maximumDisplacement > 1e-15 ? Math.min(1e6, Math.max(1, diagonal * 0.05 / maximumDisplacement)) : 1 },
        mapping: { domain: 'exact', cadRegions: 'partial', semanticReferenceIds: [...new Set(references)].sort(compareText) },
        totalTriangles: triangles.length, maximumPageTriangles: 128, datasetDigest: digest(triangles),
      };
      datasets.set(datasetId, { descriptor, triangles });
    }
  }
  return datasets;
}

function interpolate(points: Array<{ time: number; scaleFactor: number }>, time: number): number {
  if (time <= points[0].time) return points[0].scaleFactor;
  for (let index = 1; index < points.length; index++) if (time <= points[index].time) {
    const left = points[index - 1]; const right = points[index];
    return left.scaleFactor + (right.scaleFactor - left.scaleFactor) * (time - left.time) / (right.time - left.time);
  }
  return points.at(-1)!.scaleFactor;
}

function renderTriangles(run: Run, domainId: string, vectors: Map<number, NeutralVector3>): NeutralSimulationFieldTriangleV2[] {
  const elementByFace = new Map<string, number>();
  run.model.volumeElements.connectivity.forEach((cell, elementIndex) => {
    const corners = cell.slice(0, 4);
    for (const face of [[corners[0], corners[2], corners[1]], [corners[0], corners[1], corners[3]], [corners[1], corners[2], corners[3]], [corners[2], corners[0], corners[3]]]) elementByFace.set([...face].sort((a, b) => a - b).join(':'), elementIndex);
  });
  return run.model.boundaryFacets.connectivity.flatMap((facet, facetIndex) => {
    if (run.model.boundaryFacets.domainIds[facetIndex] !== domainId) return [];
    const elementIndex = elementByFace.get(facet.slice(0, 3).sort((a, b) => a - b).join(':'));
    if (elementIndex === undefined) throw new Error(`Boundary facet ${facetIndex} has no owning volume element.`);
    return (facet.length === 6 ? [[0, 3, 5], [3, 1, 4], [5, 4, 2], [3, 4, 5]] : [[0, 1, 2]]).map(indices => {
      const nodes = indices.map(index => facet[index]);
      return { facetIndex, elementIndex, positionsAnalysisMm: nodes.map(node => run.model.nodes[node]) as [NeutralVector3, NeutralVector3, NeutralVector3], displacementsMm: nodes.map(node => vectors.get(node) ?? missingField(`node ${node}`)) as [NeutralVector3, NeutralVector3, NeutralVector3], values: [0, 0, 0] };
    });
  });
}

function numericFields(line: string): number[] {
  return [...line.matchAll(/[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[EeDd][-+]?\d+)?/g)].map(match => Number(match[0].replace(/[dD]/g, 'E'))).filter(Number.isFinite);
}
function missingModal(label: string): never { throw new Error(`CalculiX omitted ${label}.`); }
function modalDatasetId(runId: string, domainId: string, modeNumber: number): string { return `${runId}:${domainId}:mode:${String(modeNumber).padStart(3, '0')}`; }
function bucklingDatasetId(runId: string, domainId: string, modeNumber: number): string { return `${runId}:${domainId}:buckling:${String(modeNumber).padStart(3, '0')}`; }

function normalizeContact(
  run: Run,
  parsed: ReturnType<typeof parseCalculiXDatV2>,
  contactNodes: Map<number, CalculiXContactNodeOutput>,
  increments: ReturnType<typeof parseCalculiXContactStaV2>,
  adapterId: string,
  adapterVersion: string,
  runtimeVersion: string,
) {
  if (run.request.analysis.type !== 'static_contact') throw new Error('Contact normalization received a non-contact request.');
  if (increments.length > run.request.analysis.settings.maximumIncrements) throw new Error('CalculiX exceeded the requested contact increment limit.');
  const contacts = run.request.interactions.filter(interaction => interaction.type === 'frictionless_contact' || interaction.type === 'frictional_contact');
  const maximumTensionRegularizerMPa = Math.max(...contacts.map(interaction => interaction.normalBehavior.tensionCutoffMPa));
  if ([...contactNodes.values()].some(output => output.pressureMPa < -maximumTensionRegularizerMPa * 1.01 - 1e-12)) {
    throw new Error('CalculiX contact pressure exceeded the declared tensile regularization bound.');
  }
  const base = normalize(run, parsed, adapterId, adapterVersion, runtimeVersion);
  const contact = buildContactFieldDatasets(run, parsed, contactNodes, contactForceResultants(run, base.result.reactions));
  for (const [datasetId, dataset] of base.datasets) base.datasets.set(datasetId, {
    ...dataset,
    descriptor: { ...dataset.descriptor, analysisType: 'static_contact', step: { index: 0, label: 'final_contact_increment' } } as NeutralSimulationFieldDatasetV2,
  });
  for (const [datasetId, dataset] of contact.datasets) base.datasets.set(datasetId, dataset);
  const perDomain = base.result.perDomain.map(domain => ({
    ...domain,
    fieldDatasetIds: [...domain.fieldDatasetIds, ...contact.interfaces.filter(entry => entry.secondaryDomainId === domain.domainId).flatMap(entry => [entry.pressureDatasetId, entry.normalGapDatasetId, entry.tangentialSlipDatasetId!, entry.contactShearDatasetId!])],
  }));
  const totalIterations = increments.reduce((sum, entry) => sum + entry.iterations, 0);
  const usesInitialAdjustment = contacts.some(interaction => interaction.initialAdjustment !== 'none');
  const usesFriction = contacts.some(interaction => interaction.type === 'frictional_contact');
  const sliding = contacts[0]?.sliding ?? 'small';
  const result: NeutralSimulationResultV2 = {
    ...base.result,
    analysisType: 'static_contact',
    perDomain,
    warnings: [
      { code: 'SIMULATION_CONTACT_POC', message: `Experimental SIM-6 ${sliding}-sliding penalty-contact result; qualified-engineer review is mandatory.`, severity: 'warning' },
      { code: 'SIMULATION_CONTACT_OPENING_LIMIT', message: 'Secondary nodes omitted from the final CalculiX CONTACT block use closest-triangle clearance recovery on the final deformed primary surface; the bounded tensile regularizer is normalized to zero traction.', severity: 'warning' },
      ...(usesInitialAdjustment ? [{ code: 'SIMULATION_CONTACT_INITIAL_ADJUSTMENT', message: 'CalculiX moved admitted secondary mesh nodes onto the primary surface before solving. The immutable CAD geometry was not changed; review the declared adjustment bound and mesh quality.', severity: 'warning' as const }] : []),
      ...(usesFriction ? [{ code: 'SIMULATION_CONTACT_FRICTION_POC', message: `Coulomb friction uses an explicit penalty stick slope and ${sliding}-sliding kinematics; review stick/slip sensitivity and the friction coefficient.`, severity: 'warning' as const }] : []),
      ...(sliding === 'finite' ? [{ code: 'SIMULATION_CONTACT_FINITE_SLIDING_POC', message: 'Finite sliding updates contact projection with NLGEOM finite-deformation kinematics; the material law remains isotropic linear elastic.', severity: 'warning' as const }] : []),
    ],
    convergence: { status: 'converged', iterations: totalIterations, residual: null, providerDeclared: true },
    suggestedEngineeringIssues: [`Review contact-side choice, ${usesFriction ? 'normal/tangential penalty stiffness, friction coefficient, stick/slip response,' : 'penalty stiffness,'} mesh refinement, interface traction, penetration, and increment cutbacks.`],
    review: { engineerReviewRequired: true, engineeringUsePermitted: false, disclaimer: `CalculiX ${runtimeVersion} experimental SIM-6 contact result. Not certified.` },
    contact: { formulation: 'node_to_surface_penalty', sliding, interfaces: contact.interfaces, increments },
  };
  return { result, datasets: base.datasets };
}

function buildContactFieldDatasets(
  run: Run,
  parsed: ReturnType<typeof parseCalculiXDatV2>,
  contactNodes: Map<number, CalculiXContactNodeOutput>,
  equilibriumForces: Map<string, NeutralVector3>,
) {
  const datasets = new Map<string, { descriptor: NeutralSimulationFieldDatasetV2; triangles: NeutralSimulationFieldTriangleV2[] }>();
  const references = new Map(run.request.model.references.map(reference => [reference.semanticReferenceId, reference]));
  const elementByFace = boundaryElementMap(run.model);
  const interfaces = run.request.interactions.filter(interaction => interaction.type === 'frictionless_contact' || interaction.type === 'frictional_contact').map(interaction => {
    const secondaryRegions = interaction.secondaryReferenceIds.map(referenceId => requireBoundaryRegion(run.model, referenceId));
    const primaryRegions = interaction.primaryReferenceIds.map(referenceId => requireBoundaryRegion(run.model, referenceId));
    const secondaryDomainId = secondaryRegions[0].domainId; const primaryDomainId = primaryRegions[0].domainId;
    const secondaryFacets = [...new Set(secondaryRegions.flatMap(region => region.facetIndices))].sort((a, b) => a - b);
    const secondaryNodes = [...new Set(secondaryFacets.flatMap(facet => run.model.boundaryFacets.connectivity[facet]))];
    const missingContactNodes = secondaryNodes.filter(node => !contactNodes.has(node));
    const inferred = missingContactNodes.length
      ? inferOpenContactOutputs(run, parsed, interaction, missingContactNodes, primaryRegions)
      : new Map<number, CalculiXContactNodeOutput>();
    const outputs = new Map(secondaryNodes.map(node => [node, contactNodes.get(node) ?? inferred.get(node)!]));
    if (interaction.type === 'frictional_contact' && [...outputs.values()].some(output => output.shearMPa > interaction.tangentialBehavior.frictionCoefficient * Math.max(0, output.pressureMPa) * 1.01 + 1e-6)) {
      throw new Error(`CalculiX contact shear exceeded the declared Coulomb coefficient for interaction "${interaction.id}".`);
    }
    const pressureValues = new Map(secondaryNodes.map(node => [node, Math.max(0, outputs.get(node)!.pressureMPa)]));
    const gapValues = new Map(secondaryNodes.map(node => [node, outputs.get(node)!.normalGapMm]));
    const slipValues = new Map(secondaryNodes.map(node => [node, outputs.get(node)!.tangentialSlipMm]));
    const shearValues = new Map(secondaryNodes.map(node => [node, outputs.get(node)!.shearMPa]));
    const pressureTriangles = contactTriangles(run, secondaryFacets, pressureValues, parsed.displacements, elementByFace);
    const gapTriangles = contactTriangles(run, secondaryFacets, gapValues, parsed.displacements, elementByFace);
    const slipTriangles = contactTriangles(run, secondaryFacets, slipValues, parsed.displacements, elementByFace);
    const shearTriangles = contactTriangles(run, secondaryFacets, shearValues, parsed.displacements, elementByFace);
    const pressureDatasetId = `${run.providerRunId}:${interaction.id}:contact-pressure`;
    const normalGapDatasetId = `${run.providerRunId}:${interaction.id}:normal-gap`;
    const tangentialSlipDatasetId = `${run.providerRunId}:${interaction.id}:tangential-slip`;
    const contactShearDatasetId = `${run.providerRunId}:${interaction.id}:contact-shear`;
    for (const [datasetId, component, unit, triangles] of [
      [pressureDatasetId, 'contact_pressure', 'MPa', pressureTriangles],
      [normalGapDatasetId, 'normal_gap', 'mm', gapTriangles],
      [tangentialSlipDatasetId, 'tangential_slip', 'mm', slipTriangles],
      [contactShearDatasetId, 'contact_shear', 'MPa', shearTriangles],
    ] as const) {
      const descriptor: NeutralSimulationFieldDatasetV2 = {
        schema: 'tunacad-neutral-simulation-field-dataset/2.0', datasetId, jobId: run.providerRunId, domainId: secondaryDomainId,
        analysisType: 'static_contact', step: { index: 0, label: 'final_contact_increment' }, component, unit,
        location: 'boundary_facet', topology: 'triangle_soup', valueRange: fieldExtrema(triangles),
        deformation: { vectorsIncluded: true, trueScale: 1, recommendedScale: contactDeformationScale(run, parsed, secondaryDomainId) },
        mapping: { domain: 'exact', cadRegions: 'exact', semanticReferenceIds: [...interaction.secondaryReferenceIds].sort(compareText) },
        totalTriangles: triangles.length, maximumPageTriangles: 128, datasetDigest: digest(triangles),
      };
      datasets.set(datasetId, { descriptor, triangles });
    }
    let forceOnSecondaryN: NeutralVector3 = [0, 0, 0];
    for (const region of secondaryRegions) {
      const referenceId = interaction.secondaryReferenceIds.find(id => region.semanticReferenceIds.includes(id));
      const reference = referenceId ? references.get(referenceId) : null;
      if (!reference?.faceOwnerLocal.outwardDirection) throw new Error(`Contact reference "${referenceId ?? interaction.id}" has no outward normal evidence.`);
      const domain = run.request.model.domains.find(entry => entry.domainId === region.domainId)!;
      const referenceNormal = transformDirection(domain.transformToAnalysis, reference.faceOwnerLocal.outwardDirection);
      for (const facet of region.facetIndices) for (const triangle of facetSubtriangles(run.model.boundaryFacets.connectivity[facet])) {
        const points = triangle.map(node => run.model.nodes[node]) as [NeutralVector3, NeutralVector3, NeutralVector3];
        const { area, normal } = orientedTriangleAreaNormal(points, referenceNormal); const averagePressure = triangle.reduce((sum, node) => sum + pressureValues.get(node)!, 0) / 3;
        forceOnSecondaryN = add(forceOnSecondaryN, [-normal[0] * averagePressure * area, -normal[1] * averagePressure * area, -normal[2] * averagePressure * area]);
      }
    }
    const pressures = [...pressureValues.values()]; const gaps = [...gapValues.values()]; const minimumNormalGapMm = Math.min(...gaps);
    const maximumTangentialSlipMm = Math.max(...slipValues.values()); const maximumShearMPa = Math.max(...shearValues.values());
    return {
      interactionId: interaction.id, secondaryDomainId, primaryDomainId,
      status: Math.max(...pressures) > 1e-10 ? 'active' as const : 'open_or_touching' as const,
      maximumPressureMPa: Math.max(...pressures), minimumNormalGapMm, maximumPenetrationMm: Math.max(0, -minimumNormalGapMm), maximumTangentialSlipMm, maximumShearMPa,
      forceOnSecondaryN: equilibriumForces.get(interaction.id) ?? forceOnSecondaryN, pressureDatasetId, normalGapDatasetId, tangentialSlipDatasetId, contactShearDatasetId,
    };
  });
  return { interfaces, datasets };
}

/** For a secondary body participating in exactly one contact interaction, its
 * contact resultant follows directly from that body's normalized external-load
 * and support-reaction equilibrium. This avoids treating nodal CPRESS values
 * as shape-function coefficients on strongly curved/high-gradient patches. */
function contactForceResultants(run: Run, reactions: NeutralSimulationResultV2['reactions']): Map<string, NeutralVector3> {
  const mesh = asV1Mesh(run.model); const applied = combinedLoads(run.request, run.model, mesh);
  const referenceDomains = new Map(run.request.model.references.map(reference => [reference.semanticReferenceId, reference.domainId]));
  const contacts = run.request.interactions.filter(interaction => interaction.type === 'frictionless_contact' || interaction.type === 'frictional_contact');
  const bySecondary = new Map<string, typeof contacts>();
  for (const contact of contacts) {
    const domainId = referenceDomains.get(contact.secondaryReferenceIds[0]); if (!domainId) continue;
    const entries = bySecondary.get(domainId) ?? []; entries.push(contact); bySecondary.set(domainId, entries);
  }
  const result = new Map<string, NeutralVector3>();
  for (const [domainId, entries] of bySecondary) {
    if (entries.length !== 1) continue;
    const domain = run.model.domainRegions.find(candidate => candidate.domainId === domainId); if (!domain) continue;
    const externalForce = sumAt(applied, domain.nodeIndices);
    const reactionForce = reactions.filter(reaction => reaction.domainId === domainId).reduce<NeutralVector3>((sum, reaction) => add(sum, reaction.forceN), [0, 0, 0]);
    result.set(entries[0].id, add(externalForce, reactionForce).map(value => -value) as NeutralVector3);
  }
  return result;
}

/** CalculiX reports only secondary nodes that retain generated contact springs
 * in the final increment. Recover signed clearance for omitted nodes from the
 * final displacement field and the closest point on the deformed, triangulated
 * primary surface. Barycentric displacement interpolation keeps this valid for
 * planar, curved, and finite-sliding contact patches. */
function inferOpenContactOutputs(
  run: Run,
  parsed: ReturnType<typeof parseCalculiXDatV2>,
  interaction: Extract<NeutralSimulationRequestV2['interactions'][number], { type: 'frictionless_contact' | 'frictional_contact' }>,
  secondaryNodes: number[],
  primaryRegions: NeutralFemModelV2['boundaryRegions'],
): Map<number, CalculiXContactNodeOutput> {
  const references = new Map(run.request.model.references.map(reference => [reference.semanticReferenceId, reference]));
  const primaryTriangles = primaryRegions.flatMap(region => {
    const referenceId = interaction.primaryReferenceIds.find(id => region.semanticReferenceIds.includes(id));
    const reference = referenceId ? references.get(referenceId) : undefined;
    const primaryDomain = reference ? run.request.model.domains.find(domain => domain.domainId === reference.domainId) : undefined;
    if (!reference?.faceOwnerLocal.outwardDirection || !primaryDomain) throw new Error(`Contact interaction "${interaction.id}" has incomplete primary normal/domain evidence.`);
    const referenceNormal = transformDirection(primaryDomain.transformToAnalysis, reference.faceOwnerLocal.outwardDirection);
    return region.facetIndices.flatMap(facet => facetSubtriangles(run.model.boundaryFacets.connectivity[facet]).map(nodes => {
      const displacements = nodes.map(node => parsed.displacements.get(node) ?? missingField(`primary contact node ${node}`)) as [NeutralVector3, NeutralVector3, NeutralVector3];
      const deformed = nodes.map((node, index) => add(run.model.nodes[node], displacements[index])) as [NeutralVector3, NeutralVector3, NeutralVector3];
      let normal = normalizedCross(subtract(deformed[1], deformed[0]), subtract(deformed[2], deformed[0]));
      if (dot(normal, referenceNormal) < 0) normal = normal.map(value => -value) as NeutralVector3;
      return { deformed, displacements, normal };
    }));
  });
  if (!primaryTriangles.length) throw new Error(`Contact interaction "${interaction.id}" has no primary surface triangles.`);
  return new Map(secondaryNodes.map(node => {
    const displacement = parsed.displacements.get(node) ?? missingField(`secondary contact node ${node}`);
    const deformed = add(run.model.nodes[node], displacement);
    const nearest = primaryTriangles.map(triangle => {
      const closest = closestPointWithWeights(deformed, triangle.deformed);
      return { ...triangle, ...closest, distance: Math.hypot(...subtract(deformed, closest.point)) };
    }).sort((a, b) => a.distance - b.distance)[0];
    const primaryDisplacement = nearest.weights.reduce<NeutralVector3>((sum, weight, index) => add(sum, nearest.displacements[index].map(value => value * weight) as NeutralVector3), [0, 0, 0]);
    const normalGapMm = dot(subtract(deformed, nearest.point), nearest.normal);
    const relative = subtract(displacement, primaryDisplacement);
    const normalRelative = dot(relative, nearest.normal);
    const tangentialSlipMm = Math.hypot(...relative.map((value, axis) => value - normalRelative * nearest.normal[axis]));
    return [node, { normalGapMm, tangentialSlipMm, pressureMPa: 0, shearMPa: 0 }];
  }));
}

function normalizedCross(a: NeutralVector3, b: NeutralVector3): NeutralVector3 {
  const value = cross(a, b); const length = Math.hypot(...value);
  if (!(length > 1e-12)) throw new Error('Contact surface contains a degenerate deformed triangle.');
  return value.map(component => component / length) as NeutralVector3;
}

function closestPointWithWeights(point: NeutralVector3, triangle: [NeutralVector3, NeutralVector3, NeutralVector3]): { point: NeutralVector3; weights: [number, number, number] } {
  const [a, b, c] = triangle; const ab = subtract(b, a); const ac = subtract(c, a); const ap = subtract(point, a);
  const d1 = dot(ab, ap); const d2 = dot(ac, ap); if (d1 <= 0 && d2 <= 0) return { point: a, weights: [1, 0, 0] };
  const bp = subtract(point, b); const d3 = dot(ab, bp); const d4 = dot(ac, bp); if (d3 >= 0 && d4 <= d3) return { point: b, weights: [0, 1, 0] };
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return { point: add(a, ab.map(value => value * v) as NeutralVector3), weights: [1 - v, v, 0] }; }
  const cp = subtract(point, c); const d5 = dot(ab, cp); const d6 = dot(ac, cp); if (d6 >= 0 && d5 <= d6) return { point: c, weights: [0, 0, 1] };
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return { point: add(a, ac.map(value => value * w) as NeutralVector3), weights: [1 - w, 0, w] }; }
  const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return { point: add(b, subtract(c, b).map(value => value * w) as NeutralVector3), weights: [0, 1 - w, w] }; }
  const denominator = 1 / (va + vb + vc); const v = vb * denominator; const w = vc * denominator;
  return { point: add(a, add(ab.map(value => value * v) as NeutralVector3, ac.map(value => value * w) as NeutralVector3)), weights: [1 - v - w, v, w] };
}

function requireBoundaryRegion(model: NeutralFemModelV2, referenceId: string) {
  const matches = model.boundaryRegions.filter(region => region.semanticReferenceIds.includes(referenceId));
  if (matches.length !== 1) throw new Error(`Contact reference "${referenceId}" maps to ${matches.length} boundary regions.`);
  return matches[0];
}

function boundaryElementMap(model: NeutralFemModelV2) {
  const result = new Map<string, number>();
  model.volumeElements.connectivity.forEach((cell, elementIndex) => {
    const corners = cell.slice(0, 4);
    for (const face of [[corners[0], corners[2], corners[1]], [corners[0], corners[1], corners[3]], [corners[1], corners[2], corners[3]], [corners[2], corners[0], corners[3]]]) result.set([...face].sort((a, b) => a - b).join(':'), elementIndex);
  });
  return result;
}

function facetSubtriangles(facet: number[]): number[][] {
  return (facet.length === 6 ? [[0, 3, 5], [3, 1, 4], [5, 4, 2], [3, 4, 5]] : [[0, 1, 2]]).map(indices => indices.map(index => facet[index]));
}

function contactTriangles(run: Run, facets: number[], values: Map<number, number>, displacements: Map<number, NeutralVector3>, elementByFace: Map<string, number>) {
  return facets.flatMap(facetIndex => {
    const facet = run.model.boundaryFacets.connectivity[facetIndex];
    const elementIndex = elementByFace.get(facet.slice(0, 3).sort((a, b) => a - b).join(':'));
    if (elementIndex === undefined) throw new Error(`Contact facet ${facetIndex} has no owning volume element.`);
    return facetSubtriangles(facet).map(nodes => ({
      facetIndex, elementIndex,
      positionsAnalysisMm: nodes.map(node => run.model.nodes[node]) as [NeutralVector3, NeutralVector3, NeutralVector3],
      displacementsMm: nodes.map(node => displacements.get(node) ?? missingField(`contact node ${node}`)) as [NeutralVector3, NeutralVector3, NeutralVector3],
      values: nodes.map(node => values.get(node) ?? missingField(`contact value at node ${node}`)) as [number, number, number],
    }));
  });
}

function contactDeformationScale(run: Run, parsed: ReturnType<typeof parseCalculiXDatV2>, domainId: string) {
  const domain = run.model.domainRegions.find(entry => entry.domainId === domainId)!;
  const maximumDisplacement = parsed.byDomain.get(domainId)!.maximumDisplacementMm;
  const diagonal = boundingDiagonal(domain.nodeIndices.map(index => run.model.nodes[index]));
  return maximumDisplacement > 1e-15 ? Math.min(1e6, Math.max(1, diagonal * 0.05 / maximumDisplacement)) : 1;
}

function transformDirection(matrix: readonly number[], direction: NeutralVector3): NeutralVector3 {
  const transformed: NeutralVector3 = [
    matrix[0] * direction[0] + matrix[1] * direction[1] + matrix[2] * direction[2],
    matrix[4] * direction[0] + matrix[5] * direction[1] + matrix[6] * direction[2],
    matrix[8] * direction[0] + matrix[9] * direction[1] + matrix[10] * direction[2],
  ];
  const length = Math.hypot(...transformed);
  if (!(length > 0)) throw new Error('Contact reference has an invalid transformed normal.');
  return transformed.map(value => value / length) as NeutralVector3;
}

function dot(a: NeutralVector3, b: NeutralVector3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function triangleArea(points: [NeutralVector3, NeutralVector3, NeutralVector3]) {
  const a: NeutralVector3 = [points[1][0] - points[0][0], points[1][1] - points[0][1], points[1][2] - points[0][2]];
  const b: NeutralVector3 = [points[2][0] - points[0][0], points[2][1] - points[0][1], points[2][2] - points[0][2]];
  return Math.hypot(...cross(a, b)) / 2;
}

function orientedTriangleAreaNormal(points: [NeutralVector3, NeutralVector3, NeutralVector3], referenceNormal: NeutralVector3) {
  const a = subtract(points[1], points[0]); const b = subtract(points[2], points[0]);
  let normal = cross(a, b); const magnitude = Math.hypot(...normal);
  if (!(magnitude > 0)) throw new Error('Contact result contains a degenerate boundary triangle.');
  normal = normal.map(value => value / magnitude) as NeutralVector3;
  if (dot(normal, referenceNormal) < 0) normal = normal.map(value => -value) as NeutralVector3;
  return { area: magnitude / 2, normal };
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
  const forceScale = Math.max(Math.hypot(...appliedForce), ...reactions.map(reaction => Math.hypot(...reaction.forceN)));
  if (residual > Math.max(1e-6, forceScale * 1e-4)) throw new Error(`CalculiX v2 reaction/load equilibrium residual is ${residual} N.`);
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
