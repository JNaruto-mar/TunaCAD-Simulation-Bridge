import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  type SimulationProviderSubmission,
} from '../../src/simulation/externalSimulationContracts.ts';

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
}

interface CalculiXOutput {
  maximumDisplacementMm: number;
  maximumDisplacementPositionMm: NeutralVector3;
  maximumDisplacementNode: number;
  maximumVonMisesStressMPa: number;
  maximumStressPositionMm: NeutralVector3;
  reactionForceN: NeutralVector3;
}

/** Node-only adapter for a user-installed CalculiX executable. It accepts only
 * the neutral FEM mesh contract and exposes no executable arguments publicly. */
export class CalculiXSolverProvider implements ExternalSolverProvider {
  readonly id = 'tunacad-calculix-solver-poc';
  readonly version = '0.1.0-poc';
  readonly capabilities = {
    interfaceVersion: SIMULATION_PROVIDER_INTERFACE_VERSION,
    analysisTypes: ['linear_static'] as const,
    geometryFormats: [] as const,
    asynchronous: true as const,
    cancellation: true as const,
    normalizedResults: true as const,
    durableReferenceMapping: 'supported' as const,
    authority: 'engineering' as const,
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
  }

  async submit(request: NeutralSimulationRequest, mesh: NeutralFemMesh): Promise<SimulationProviderSubmission> {
    const input = createInputDeck(request, mesh);
    const directory = await mkdtemp(join(tmpdir(), 'tunacad-calculix-solver-'));
    const providerRunId = `calculixsolve_${crypto.randomUUID()}`;
    const submittedAt = new Date().toISOString();
    await writeFile(join(directory, 'tunacad.inp'), input, 'utf8');
    const child = spawn(this.executable, ['-i', 'tunacad'], {
      cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: executableEnvironment(this.executable),
    });
    const run = {
      request, mesh, providerRunId, submittedAt, directory, process: child, result: null,
      status: { providerRunId, status: 'running', progress: null, phase: 'external_solver', updatedAt: submittedAt },
      timeout: undefined as unknown as NodeJS.Timeout,
    } satisfies SolverRun;
    run.timeout = setTimeout(() => { child.kill(); void this.failRun(run, 'SIMULATION_TIMEOUT', 'CalculiX exceeded its declared execution timeout.'); }, this.capabilities.execution.executionTimeoutMs);
    run.timeout.unref();
    this.runs.set(providerRunId, run);
    let diagnostic = '';
    const collect = (chunk: unknown) => { diagnostic = `${diagnostic}${String(chunk)}`.slice(-12_000); };
    child.stdout?.on('data', collect); child.stderr?.on('data', collect);
    child.once('error', () => void this.failRun(run, 'SIMULATION_SOLVER_UNAVAILABLE', 'The configured external CalculiX process could not be started.'));
    child.once('exit', (code, signal) => void this.finishRun(run, code, signal, diagnostic));
    return { providerRunId, acceptedAt: submittedAt };
  }

  async getStatus(providerRunId: string): Promise<SimulationProviderStatus> { return structuredClone(this.requireRun(providerRunId).status); }
  async getResult(providerRunId: string): Promise<NeutralSimulationResult | null> { return structuredClone(this.requireRun(providerRunId).result); }

  async cancel(providerRunId: string): Promise<SimulationProviderStatus> {
    const run = this.requireRun(providerRunId);
    if (run.status.status === 'running' || run.status.status === 'queued') {
      run.process.kill(); clearTimeout(run.timeout); run.result = null;
      run.status = { providerRunId, status: 'cancelled', progress: null, phase: 'cancelled', updatedAt: new Date().toISOString() };
      await safeRemove(run.directory);
    }
    return structuredClone(run.status);
  }

  private async finishRun(run: SolverRun, code: number | null, signal: NodeJS.Signals | null, diagnostic: string): Promise<void> {
    if (run.status.status === 'cancelled' || run.status.status === 'failed') { await safeRemove(run.directory); return; }
    clearTimeout(run.timeout);
    if (code !== 0) {
      const lastLine = diagnostic.split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? '';
      await this.failRun(run, 'SIMULATION_SOLVER_FAILED', `CalculiX exited with code ${String(code)}${signal ? ` (${signal})` : ''}.${lastLine ? ` ${lastLine.slice(0, 800)}` : ''}`);
      return;
    }
    try {
      const output = parseCalculiXDat(await readFile(join(run.directory, 'tunacad.dat'), 'utf8'), run.mesh);
      run.result = normalizeResult(run, output, this.id, this.version, this.runtimeVersion);
      run.status = { providerRunId: run.providerRunId, status: 'succeeded', progress: 1, phase: 'normalized', updatedAt: new Date().toISOString() };
    } catch (error) {
      await this.failRun(run, 'SIMULATION_RESULT_UNTRUSTED', error instanceof Error ? error.message : String(error));
      return;
    }
    await safeRemove(run.directory);
  }

  private async failRun(run: SolverRun, code: string, message: string): Promise<void> {
    if (run.status.status === 'cancelled') return;
    clearTimeout(run.timeout); run.result = null;
    run.status = { providerRunId: run.providerRunId, status: 'failed', progress: null, phase: 'failed', updatedAt: new Date().toISOString(), failure: { code, message: message.slice(0, 2_000) } };
    await safeRemove(run.directory);
  }

  private requireRun(providerRunId: string): SolverRun {
    const run = this.runs.get(providerRunId);
    if (!run) throw providerError('SIMULATION_JOB_NOT_FOUND', `Unknown CalculiX solver run "${providerRunId}".`);
    return run;
  }
}

function createInputDeck(request: NeutralSimulationRequest, mesh: NeutralFemMesh): string {
  if (request.analysis.type !== 'linear_static' || request.material.model !== 'isotropic_linear_elastic') throw providerError('SIMULATION_ANALYSIS_UNSUPPORTED', 'The CalculiX POC supports isotropic linear-static analysis only.');
  if (mesh.element.geometryOrder !== 2 || mesh.element.solutionOrder !== 2 || mesh.volumeElements.connectivity.some(cell => cell.length !== 10)) throw providerError('SIMULATION_MESH_ELEMENT_UNSUPPORTED', 'The CalculiX adapter requires complete second-order C3D10 tetrahedra.');
  if (request.loads.length !== 1 || request.loads[0].type !== 'surface_force') throw providerError('SIMULATION_LOAD_INVALID', 'The CalculiX POC requires one surface-force load.');
  if (request.constraints.length !== 1 || request.constraints[0].type !== 'fixed') throw providerError('SIMULATION_CONSTRAINT_INVALID', 'The CalculiX POC requires one fixed constraint.');
  const fixedRegion = requireMeshRegion(mesh, request.constraints[0].semanticReferenceIds[0]);
  const loadRegion = requireMeshRegion(mesh, request.loads[0].semanticReferenceIds[0]);
  if (fixedRegion.regionId === loadRegion.regionId) throw providerError('SIMULATION_FACE_MAPPING_AMBIGUOUS', 'The fixed and loaded references map to the same neutral boundary region.');
  const fixedNodes = uniqueNodes(mesh, fixedRegion.facetIndices);
  const nodalLoads = consistentSurfaceLoads(mesh, loadRegion.facetIndices, request.loads[0].forceN);
  const lines = [
    '*HEADING',
    `TunaCAD neutral linear-static study ${safeComment(request.studyId)}`,
    '*NODE, NSET=NALL',
    ...mesh.nodes.map((point, index) => `${index + 1},${point[0]},${point[1]},${point[2]}`),
    '*ELEMENT, TYPE=C3D10, ELSET=EALL',
    ...mesh.volumeElements.connectivity.map((cell, index) => `${index + 1},${neutralToCalculiXC3D10(cell).map(node => node + 1).join(',')}`),
    '*NSET, NSET=FIXED',
    ...wrapIds(fixedNodes.map(node => node + 1)),
    '*MATERIAL, NAME=TUNACAD_MATERIAL',
    '*ELASTIC',
    `${request.material.youngsModulusMPa},${request.material.poissonRatio}`,
    '*SOLID SECTION, ELSET=EALL, MATERIAL=TUNACAD_MATERIAL',
    '*STEP',
    '*STATIC',
    '*BOUNDARY',
    'FIXED,1,3,0',
    '*CLOAD',
    ...[...nodalLoads.entries()].flatMap(([node, force]) => force.flatMap((value, axis) => Math.abs(value) > 1e-14 ? [`${node + 1},${axis + 1},${value}`] : [])),
    '*NODE PRINT, NSET=NALL, GLOBAL=YES',
    'U',
    '*NODE PRINT, NSET=FIXED, TOTALS=ONLY, GLOBAL=YES',
    'RF',
    '*EL PRINT, ELSET=EALL',
    'S',
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

/** Neutral quadratic tetrahedra end with edges (2-3), (1-3); CalculiX C3D10
 * expects (1-3), (2-3). Vertex order and the first four edge nodes are equal. */
function neutralToCalculiXC3D10(cell: number[]): number[] {
  if (cell.length !== 10) throw providerError('SIMULATION_MESH_ELEMENT_UNSUPPORTED', 'CalculiX C3D10 translation requires ten neutral nodes.');
  return [...cell.slice(0, 8), cell[9], cell[8]];
}

function uniqueNodes(mesh: NeutralFemMesh, facetIndices: number[]): number[] {
  return [...new Set(facetIndices.flatMap(index => mesh.boundaryFacets.connectivity[index]))].sort((a, b) => a - b);
}

function consistentSurfaceLoads(mesh: NeutralFemMesh, facetIndices: number[], totalForce: NeutralVector3): Map<number, NeutralVector3> {
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

function parseCalculiXDat(text: string, mesh: NeutralFemMesh): CalculiXOutput {
  let mode: 'displacement' | 'reaction' | 'stress' | null = null;
  let maximumDisplacementMm = -Infinity; let maximumDisplacementNode = -1;
  let maximumVonMisesStressMPa = -Infinity; let maximumStressElement = -1;
  const reactionForceN: NeutralVector3 = [0, 0, 0];
  for (const rawLine of text.split(/\r?\n/)) {
    const lower = rawLine.toLowerCase();
    if (lower.includes('displacements') && lower.includes('for set')) { mode = 'displacement'; continue; }
    if ((lower.includes('total force') || lower.includes('forces')) && lower.includes('for set')) { mode = 'reaction'; continue; }
    if (lower.includes('stresses') && lower.includes('for set')) { mode = 'stress'; continue; }
    const values = rawLine.trim().split(/\s+/).map(value => Number(value.replace(/[dD]/g, 'E')));
    if (!values.length || values.some(value => !Number.isFinite(value))) continue;
    if (mode === 'displacement' && values.length >= 4) {
      const node = Math.trunc(values[0]) - 1;
      if (node < 0 || node >= mesh.nodes.length) continue;
      const magnitude = Math.hypot(values[1], values[2], values[3]);
      if (magnitude > maximumDisplacementMm) { maximumDisplacementMm = magnitude; maximumDisplacementNode = node; }
    } else if (mode === 'reaction' && values.length >= 3) {
      const force = values.slice(-3); reactionForceN[0] += force[0]; reactionForceN[1] += force[1]; reactionForceN[2] += force[2];
    } else if (mode === 'stress' && values.length >= 8) {
      const element = Math.trunc(values[0]) - 1;
      if (element < 0 || element >= mesh.volumeElements.connectivity.length) continue;
      const [sxx, syy, szz, sxy, sxz, syz] = values.slice(-6);
      const vonMises = Math.sqrt(0.5 * ((sxx - syy) ** 2 + (syy - szz) ** 2 + (szz - sxx) ** 2) + 3 * (sxy ** 2 + sxz ** 2 + syz ** 2));
      if (vonMises > maximumVonMisesStressMPa) { maximumVonMisesStressMPa = vonMises; maximumStressElement = element; }
    }
  }
  if (!(maximumDisplacementMm > 0) || !(maximumVonMisesStressMPa > 0) || maximumDisplacementNode < 0 || maximumStressElement < 0 || reactionForceN.some(value => !Number.isFinite(value))) {
    throw new Error('CalculiX did not produce complete finite displacement, stress and reaction-force output.');
  }
  const stressNodes = mesh.volumeElements.connectivity[maximumStressElement].slice(0, 4).map(node => mesh.nodes[node]);
  const maximumStressPositionMm = [0, 1, 2].map(axis => stressNodes.reduce((sum, point) => sum + point[axis], 0) / stressNodes.length) as NeutralVector3;
  return { maximumDisplacementMm, maximumDisplacementPositionMm: mesh.nodes[maximumDisplacementNode], maximumDisplacementNode, maximumVonMisesStressMPa, maximumStressPositionMm, reactionForceN };
}

function normalizeResult(run: SolverRun, output: CalculiXOutput, adapterId: string, adapterVersion: string, runtimeVersion: string): NeutralSimulationResult {
  const request = run.request;
  const fixed = request.geometry.references.find(item => item.role === 'constraint')!;
  const displacementBinding = bindingForNode(run.mesh, output.maximumDisplacementNode, request);
  const completedAt = new Date().toISOString();
  const factorOfSafety = request.material.yieldStrengthMPa ? request.material.yieldStrengthMPa / output.maximumVonMisesStressMPa : null;
  return {
    schema: NEUTRAL_SIMULATION_RESULT_SCHEMA, studyId: request.studyId, jobId: '', requestDigest: request.requestDigest,
    projectRevision: request.geometry.projectRevision, analysisType: request.analysis.type, status: 'succeeded', authority: 'engineering',
    metrics: { maximumVonMisesStressMPa: output.maximumVonMisesStressMPa, maximumDisplacementMm: output.maximumDisplacementMm, minimumFactorOfSafety: factorOfSafety },
    reactions: [{ constraintId: request.constraints[0].id, forceN: output.reactionForceN, semanticReferenceIds: [fixed.semanticReferenceId] }],
    criticalRegions: [
      hotspot('calculix-stress-maximum', 'stress', output.maximumVonMisesStressMPa, 'MPa', output.maximumStressPositionMm, null, 'Maximum CalculiX integration-point von Mises stress.'),
      hotspot('calculix-displacement-maximum', 'displacement', output.maximumDisplacementMm, 'mm', output.maximumDisplacementPositionMm, displacementBinding, 'Maximum CalculiX nodal displacement.'),
    ],
    failedConstraints: [],
    warnings: [{ code: 'SIMULATION_PROVIDER_POC', message: 'External CalculiX proof of concept; results require mesh convergence and qualified-engineer review.', severity: 'warning' }],
    convergence: { status: 'converged', iterations: null, residual: null, providerDeclared: true },
    suggestedEngineeringIssues: ['Inspect the mapped fixed/load regions and repeat with a refined mesh.', 'Verify material, loading and reference intent before design decisions.'],
    provenance: { providerInterfaceVersion: SIMULATION_PROVIDER_INTERFACE_VERSION, adapterId, adapterVersion, providerRunId: run.providerRunId, submittedAt: run.submittedAt, completedAt, normalizedAt: completedAt },
    review: { engineerReviewRequired: true, engineeringUsePermitted: false, disclaimer: `External CalculiX ${runtimeVersion} proof-of-concept result. Not certified; qualified-engineer review is mandatory.` },
    mutation: { occurred: false, projectRevisionBefore: request.geometry.projectRevision, projectRevisionAfter: request.geometry.projectRevision },
  };
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
function triangleArea([a, b, c]: [NeutralVector3, NeutralVector3, NeutralVector3]): number { const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; return Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2; }
function executableEnvironment(executable: string): NodeJS.ProcessEnv { return { ...process.env, PATH: `${dirname(executable)}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}` }; }
async function safeRemove(directory: string): Promise<void> { try { await rm(directory, { recursive: true, force: true }); } catch { /* temporary data is best-effort cleanup */ } }
function providerError(code: string, message: string): Error & { code: string } { return Object.assign(new Error(message), { code }); }
