import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { openNativeProviderSettings } from '../simulation-bridge/providerSettings.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { fractureDigest, fractureId, requireFracture as check } from '../simulation-bridge/stationaryCrackTopology.mts';
import { calculateModeICodGeometry } from '../simulation-bridge/stationaryModeIExtraction.mts';
import { evaluateStationaryModeIReference } from '../src/simulation/stationaryModeIReference.ts';
import { validateFractureEvidencePayload, type OwnedFractureEvidence } from '../simulation-bridge/stationaryFractureNativeEvidence.mts';
import { validateStepEnvelope } from './gmsh/GmshMeshProvider.mts';
import { mapStationaryCrackMsh41, prepareStationaryCrackGmsh } from './gmsh/StationaryCrackGmshAdapter.mts';
import { fracturePilotConfigurationSchema, parseStationaryCrackDat, prepareNativeCodSamples, prepareStationaryCrackCalculiX, validatePilotFaceBindings,
  type FracturePilotConfiguration } from './calculix/StationaryCrackCalculiXAdapter.mts';
import { hasEnforcedProviderProcessQuotas, LOCAL_PROVIDER_RESOURCE_LIMITS, monitorWorkingDirectory,
  readUtf8FileBounded, removeWorkingDirectory, spawnProviderProcess, terminateChildProcess } from './processLifecycle.mts';
import type {RetainFracturePilotEvidence,FracturePilotEvidenceEvent} from '../simulation-bridge/fracturePilotEvidenceStore.mts';
import {finishFractureStage} from './fractureStageEvidence.mts';

export type PilotStage = 'gmsh_mesh' | 'calculix_solve';
export type ApprovedFractureModel = {
  jobId: string; requestDigest: string; sessionBinding: string; topology: unknown; currentSource: unknown;
  step: Uint8Array; stepDigest: string; faceBindings: unknown;
  configuration: FracturePilotConfiguration;
};
/** Trusted Node-owner capabilities, never values deserialized from browser/MCP JSON.
 * The existing authenticated owner must implement these using its consumed approval records.
 * This module does NOT issue approvals or introduce a new HTTP endpoint. */
export interface FracturePilotHost {
  retainEvidence?:RetainFracturePilotEvidence;
  readApprovedModel(): Promise<ApprovedFractureModel>;
  consumeApproval(scope: 'geometry_transfer' | 'native_execution', bindingDigest: string, signal: AbortSignal): Promise<object>;
  verifyConsumed(scope: 'geometry_transfer' | 'native_execution', bindingDigest: string, receipt: object): Promise<void>;
}
type StageInput = { script: string; step?: Uint8Array };
type StageOutput = { code: number; output: string; diagnostics: string; cleanupConfirmed: boolean };
type Driver = { runtimePinDigest: string; verifyRuntime?():Promise<void>;stage(stage: PilotStage, input: StageInput, signal: AbortSignal): Promise<StageOutput> };
const byteDigest = (bytes: Uint8Array) => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
function requireHost(host: FracturePilotHost) {
  check(host && ['readApprovedModel', 'consumeApproval', 'verifyConsumed'].every(key => typeof (host as any)[key] === 'function'),
    'trusted authenticated host capabilities required; request flags are not authority');
}
export function inspectApprovedFractureModel(model: ApprovedFractureModel) {
  fractureId.parse(model.jobId); fractureDigest.parse(model.requestDigest); fractureDigest.parse(model.sessionBinding);
  check(model.step instanceof Uint8Array && model.step.length <= LOCAL_PROVIDER_RESOURCE_LIMITS.maximumStepBytes,
    'approved STEP byte limit');
  validateStepEnvelope(model.step);
  check(byteDigest(model.step) === model.stepDigest, 'approved STEP integrity mismatch');
  const gmsh = prepareStationaryCrackGmsh(model.topology, model.currentSource);
  const faces = validatePilotFaceBindings(model.faceBindings, model.currentSource);
  const configuration = fracturePilotConfigurationSchema.parse(model.configuration);
  return { jobId: model.jobId, requestDigest: model.requestDigest, sessionBinding: model.sessionBinding,
    topology: gmsh.topology, source: gmsh.topology.definition.source, faces, configuration, stepDigest: model.stepDigest,
    planDigest: gmsh.scriptDigest, limits: { maximumNodes: 30000, maximumElements: 15000, minimumQuality: .04,
      maximumMeshes: 1, maximumSolves: 1, retries: 0, stageTimeoutMs: 120000 }, engineeringUsePermitted: false };
}
const sourceSnapshot = inspectApprovedFractureModel;

/** Only this constructor uses real processes. No injected driver/"native" flag can mint native evidence. */
export async function createNativeStationaryFracturePilot(host: FracturePilotHost) {
  requireHost(host);
  check(hasEnforcedProviderProcessQuotas() && Number(process.versions.node.split('.')[0]) === 24, 'unsupported native quota/runtime boundary');
  const settings = await (await openNativeProviderSettings()).readVerified();
  const runtimePinDigest = verifyFractureRuntimePins(settings);
  const driver: Driver = { runtimePinDigest,async verifyRuntime(){
    verifyFractureRuntimePins(await(await openNativeProviderSettings()).readVerified(),runtimePinDigest);
  }, async stage(stage, input, signal) {
    const current = await (await openNativeProviderSettings()).readVerified();
    verifyFractureRuntimePins(current,runtimePinDigest);
    check(host.retainEvidence,'protected evidence retention required before native dispatch');
    return runOwnedStage(stage, input, signal, stage === 'gmsh_mesh' ? settings.paths.gmshExecutable : settings.paths.calculixExecutable,host.retainEvidence!);
  } };
  return createOwner(host, driver, 'native_owned_process', Date.now);
}
export function verifyFractureRuntimePins(settings:{paths:{gmshExecutable:string;calculixExecutable:string};fingerprints:{gmsh:unknown;calculix:unknown}},expected?:string){
  check(typeof settings.paths.gmshExecutable==='string'&&typeof settings.paths.calculixExecutable==='string'
    &&basename(dirname(settings.paths.gmshExecutable))==='gmsh-4.15.2-Windows64'
    &&/^ccx216\.exe$/i.test(basename(settings.paths.calculixExecutable))&&settings.fingerprints.gmsh&&settings.fingerprints.calculix,
    'reviewed configured Gmsh 4.15.2 / CalculiX 2.16 pins required; no discovery/probes allowed');
  const pin=digest(settings.fingerprints);check(!expected||pin===expected,'provider binary changed after approval');return pin;
}

/** Constructor-only mock opt-in. It can NEVER issue native_owned_process evidence, even if a driver lies in its output. */
export function createControlledStationaryFracturePilot(host: FracturePilotHost,
  mock: { stage: Driver['stage']; now?: () => number;verifyRuntime?:()=>Promise<void> }) {
  requireHost(host); check(typeof mock?.stage === 'function', 'controlled mock driver required');
  return createOwner(host, { runtimePinDigest: digest('controlled_mock_no_native_binary'), stage: mock.stage,verifyRuntime:mock.verifyRuntime }, 'controlled_provider_fixture', mock.now ?? Date.now);
}

function createOwner(host: FracturePilotHost, driver: Driver, origin: 'native_owned_process' | 'controlled_provider_fixture', now: () => number) {
  let attempted = false, disposed = false, controller = new AbortController();
  let records = new WeakMap<object, { snapshot: ReturnType<typeof sourceSnapshot>; bindingDigest: string;
    approvals: { transfer: object; execution: object }; evidence: OwnedFractureEvidence; expiresAt: number }>();
  const status = { stage: 'not_started', meshes: 0, solves: 0, countsKind: 'stage_attempts_not_launch_telemetry', retries: 0, cleanupConfirmed: true, origin, failure: null as string | null };
  async function verify(snapshot: ReturnType<typeof sourceSnapshot>, binding: string, receipts: { transfer: object; execution: object }) {
    check(!disposed && !controller.signal.aborted && digest(sourceSnapshot(await host.readApprovedModel())) === digest(snapshot), 'stale source/session/job');
    await host.verifyConsumed('geometry_transfer', binding, receipts.transfer);
    await host.verifyConsumed('native_execution', binding, receipts.execution);
    check(!disposed && !controller.signal.aborted && digest(sourceSnapshot(await host.readApprovedModel())) === digest(snapshot), 'cancelled or changed source after approval verification');
  }
  async function requireRecord(handle: object) {
    const record = records.get(handle); check(record && now() < record.expiresAt, 'untrusted, forged, expired or foreign native handle');
    await verify(record.snapshot, record.bindingDigest, record.approvals); return record;
  }
  return Object.freeze({
    async verifyRuntime(){check(!disposed&&!controller.signal.aborted,'inactive pilot');await driver.verifyRuntime?.();},
    // Metadata only; neither grants approval nor starts a native stage.
    async describeBinding() {
      check(!attempted && !disposed && !controller.signal.aborted, 'inactive pilot preparation');
      const snapshot = sourceSnapshot(await host.readApprovedModel());
      return { snapshot, runtimePinDigest: driver.runtimePinDigest,
        bindingDigest: digest({ snapshot, runtimePinDigest: driver.runtimePinDigest }) };
    },
    async run(signal?: AbortSignal): Promise<object> {
      check(!attempted && !disposed, 'one attempt only; no replay or retries'); attempted = true;
      const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
      let phase='protected_approvals';
      const retain=async(event:FracturePilotEvidenceEvent)=>{if(host.retainEvidence)await host.retainEvidence(event);};
      try {
        check(origin!=='native_owned_process'||host.retainEvidence,'protected evidence retention required before approval consumption');
        check(!controller.signal.aborted, 'cancelled before preparation');
        const model = await host.readApprovedModel(), snapshot = sourceSnapshot(model), gmsh = prepareStationaryCrackGmsh(model.topology, model.currentSource);
        const step = new Uint8Array(model.step); // Freeze approved bytes before asynchronous approval callbacks.
        check(byteDigest(step) === snapshot.stepDigest, 'approved STEP changed during snapshot');
        const bindingDigest = digest({ snapshot, runtimePinDigest: driver.runtimePinDigest });
        status.stage = 'protected_approvals';
        const transfer = await host.consumeApproval('geometry_transfer', bindingDigest, controller.signal);
        check(transfer && typeof transfer === 'object', 'missing consumed transfer receipt');
        const execution = await host.consumeApproval('native_execution', bindingDigest, controller.signal);
        check(execution && typeof execution === 'object', 'missing consumed execution receipt');
        const approvals = { transfer, execution }; await verify(snapshot, bindingDigest, approvals);
        await retain({stage:'pilot',outcome:'started'});
        phase='gmsh_mesh';
        status.stage = 'gmsh_mesh'; status.meshes++;
        const rawMesh = await driver.stage('gmsh_mesh', { script: gmsh.script, step }, controller.signal);
        if(origin!=='native_owned_process')await retain({stage:'gmsh_mesh',outcome:rawMesh.code===0?'passed':'failed',artifact:rawMesh.output,detail:rawMesh.diagnostics});
        status.cleanupConfirmed = rawMesh.cleanupConfirmed;
        check(!controller.signal.aborted && rawMesh.code === 0 && rawMesh.cleanupConfirmed, 'mesh failed, cancelled or cleanup unconfirmed');
        check(rawMesh.diagnostics.length <= 12000 && !/\*ERROR\b/i.test(rawMesh.diagnostics), 'mesh diagnostics failure');
        phase='mesh_admission';
        // Controlled providers exercise the same retention gates, but their
        // artifacts can never become native result evidence.
        const mapped = mapStationaryCrackMsh41(rawMesh.output, snapshot.topology, snapshot.source);
        phase='cod_sampling';
        const sampling = prepareNativeCodSamples(mapped, snapshot.topology, snapshot.source); // Gate solve on actual paired sampling availability.
        phase='deck_preparation';
        const prepared = prepareStationaryCrackCalculiX(mapped, snapshot.topology, snapshot.source, snapshot.faces);
        await verify(snapshot, bindingDigest, approvals);
        phase='calculix_solve';
        status.stage = 'calculix_solve'; status.solves++;
        const rawDat = await driver.stage('calculix_solve', { script: prepared.deck }, controller.signal);
        if(origin!=='native_owned_process')await retain({stage:'calculix_solve',outcome:rawDat.code===0?'passed':'failed',artifact:rawDat.output,detail:rawDat.diagnostics});
        status.cleanupConfirmed = rawDat.cleanupConfirmed;
        check(!controller.signal.aborted && rawDat.code === 0 && rawDat.cleanupConfirmed, 'solver failed, cancelled or cleanup unconfirmed');
        check(rawDat.diagnostics.length <= 12000 && !/\*ERROR\b|diverg|not converg/i.test(rawDat.diagnostics), 'solver convergence diagnostic');
        phase='field_admission';
        const field = parseStationaryCrackDat(rawDat.output, mapped.geometry.nodes.length, prepared.anchors.map(a => a.node));
        check(field.equilibriumResidualN <= 1, 'reaction equilibrium residual exceeds 0.1% of 1000 N');
        for (const a of prepared.anchors) for (const dof of a.components) check(Math.abs(field.displacements.get(a.node)![dof - 1]) <= 1e-8, 'anchor displacement not restrained');
        await verify(snapshot, bindingDigest, approvals);
        // Real/native data is never reclassified as synthetic to reuse checks.
        const evidence = { schema: 'tunacad-stationary-fracture-owned-evidence/0.1', origin, jobId: snapshot.jobId,
          requestDigest: snapshot.requestDigest, source: snapshot.source, sourceDigest: digest(snapshot.source), crackDigest: snapshot.topology.crackDigest,
          meshDigest: mapped.meshDigest, fieldDigest: field.fieldDigest, rawMeshDigest: mapped.rawMeshDigest, rawDatDigest: field.rawDatDigest,
          planDigest: gmsh.scriptDigest, deckDigest: prepared.deckDigest, runtimePinDigest: driver.runtimePinDigest,
          approvalBindingDigest: bindingDigest, geometry: mapped.geometry, endFacets: mapped.endFacets, nodalDisplacements: [...field.displacements].sort(([a], [b]) => a - b),
          reactions: [...field.reactions], equilibriumResidualN: field.equilibriumResidualN, minimumQuality: mapped.minimumQuality,
          sampling, diagnostics: [rawMesh.diagnostics, rawDat.diagnostics], counts: { meshes: 1, solves: 1, retries: 0 },
          retention: 'test_only_owner_memory_20_minutes_explicit_snapshot', engineeringUsePermitted: false };
        const validated = validateFractureEvidencePayload({ ...evidence, evidenceDigest: digest(evidence) }, origin);
        phase='normalized_evidence';await retain({stage:phase,outcome:'passed',artifact:JSON.stringify(validated)});
        const handle = Object.freeze({}); records.set(handle, { snapshot, bindingDigest, approvals, evidence: validated, expiresAt: now() + 20 * 60000 });
        status.stage = 'complete'; return handle;
      } catch (error) { status.stage = controller.signal.aborted ? 'cancelled' : 'failed'; status.failure = 'FRACTURE_PILOT_QUARANTINED';
        if(typeof (error as any)?.cleanupConfirmed==='boolean')status.cleanupConfirmed=(error as any).cleanupConfirmed;
        try{await retain({stage:phase,outcome:controller.signal.aborted?'cancelled':'failed',detail:error instanceof Error?error.message.slice(0,16000):'Unknown stage failure'});}
        catch(retentionError){throw new AggregateError([error,retentionError],'FRACTURE_PILOT_EVIDENCE_RETENTION_FAILED',{cause:error});}throw error; }
      finally { signal?.removeEventListener('abort', abort); }
    },
    async snapshotEvidence(handle: object) { const r = await requireRecord(handle); return validateFractureEvidencePayload(r.evidence, origin); },
    async extract(handle: object) {
      const r = await requireRecord(handle), e = r.evidence;
      const { evidenceDigest, ...body } = e; check(evidenceDigest === digest(body), 'owned evidence integrity mismatch');
      try {
        const calculation = calculateModeICodGeometry(r.snapshot.topology, e.geometry, new Map(e.nodalDisplacements), e.sampling);
        const c = r.snapshot.topology.definition;
        const analytical = evaluateStationaryModeIReference({ schema: 'tunacad-stationary-mode-i-analytical-reference/0.1',
          provenance: { kind: 'user_defined_analytical_geometry', reference: 'Reviewed stationary center-cracked pilot approximation' },
          geometry: { type: 'center_cracked_through_thickness_plate', fullWidthMm: c.fullWidthMm, fullHeightMm: c.fullHeightMm,
            thicknessMm: c.thicknessMm, halfCrackLengthMm: c.halfLengthMm, centerMm: c.centerAnalysisMm,
            crackDirection: c.crackDirection, openingNormal: c.openingNormal, thicknessDirection: c.thicknessDirection },
          material: { model: 'homogeneous_isotropic_linear_elastic', youngsModulusMPa: 210000, poissonRatio: .3, provenance: 'Reviewed pilot material' },
          loading: { type: 'balanced_remote_uniform_tension', nominalGrossStressMPa: 10 }, assumption: 'thin_plate_plane_stress_reference',
          units: { length: 'mm', stress: 'MPa', stressIntensity: 'MPa_sqrt_m' } });
        const result={ origin: origin === 'native_owned_process' ? 'genuine_native_fem_cod_extraction' : 'controlled_fixture_cod_not_native',
          jobId: e.jobId, meshDigest: e.meshDigest, fieldDigest: e.fieldDigest, evidenceDigest, ...calculation, analyticalReference: analytical,
          stations: calculation.stations.map(s => ({ ...s, relativeDeviationFromAnalyticalPercent: 100 * (s.extrapolatedKiMPaSqrtM / analytical.kiMPaSqrtM - 1),
            fitQuality: s.fitQuality === 'acceptable_synthetic_fit' ? 'acceptable_cod_fit' : s.fitQuality })),
          status: 'INCONCLUSIVE', reason: '3D plane-stress applicability and mesh/extraction-path convergence remain unvalidated.',
          engineeringUsePermitted: false };
        await host.retainEvidence?.({stage:'ki_extraction',outcome:calculation.stations.some(s=>s.fitQuality==='poor_fit_inconclusive')?'failed':'passed',artifact:JSON.stringify(result)});
        return result;
      } catch (error) {
        await host.retainEvidence?.({stage:'ki_extraction',outcome:'failed',detail:error instanceof Error?error.message.slice(0,16000):'Extraction failed'});
        return { origin: origin === 'native_owned_process' ? 'native_fem_cod_inconclusive' : 'controlled_fixture_cod_inconclusive',
          status: 'INCONCLUSIVE', evidenceDigest, reason: error instanceof Error ? error.message : 'Invalid COD samples', engineeringUsePermitted: false };
      }
    },
    status() { return structuredClone(status); },
    cancel() { controller.abort(); records = new WeakMap(); },
    dispose() { disposed = true; controller.abort(); records = new WeakMap(); },
  });
}

/** Existing quota/termination/monitor/cleanup infrastructure; fixed input/output names, no shell or retries. */
async function runOwnedStage(stage: PilotStage, input: StageInput, signal: AbortSignal, executable: string,retain:RetainFracturePilotEvidence): Promise<StageOutput> {
  check(!signal.aborted, 'cancelled native stage');
  await retain({stage:stage==='gmsh_mesh'?'gmsh_input':'calculix_input',outcome:'started',artifact:input.script});
  const directory = await mkdtemp(join(tmpdir(), 'tunacad-fracture-pilot-'));
  let child: ReturnType<typeof spawnProviderProcess> | null = null, timer: NodeJS.Timeout | null = null;
  let stopMonitor = () => {}, diagnostic = '', exceeded = false;
  let originalFailure:unknown;
  const stop = () => { if (child) void terminateChildProcess(child); };
  try {
    if (stage === 'gmsh_mesh') {
      check(input.step, 'missing approved STEP'); await writeFile(join(directory, 'geometry.step'), input.step, { flag: 'wx', mode: 0o600 });
    }
    await writeFile(join(directory, stage === 'gmsh_mesh' ? 'mesh.geo' : 'fracture.inp'), input.script, { flag: 'wx', mode: 0o600 });
    check(!signal.aborted, 'cancelled before native launch');
    child = spawnProviderProcess(executable, stage === 'gmsh_mesh' ? ['mesh.geo', '-parse_and_exit', '-v', '2'] : ['-i', 'fracture'], {
      cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
        PATH: dirname(executable) + ';' + (process.env.PATH ?? ''), TEMP: process.env.TEMP, TMP: process.env.TMP, OMP_NUM_THREADS: '1' },
    });
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    const collect = (chunk: unknown) => { diagnostic = (diagnostic + String(chunk)).slice(-12000); };
    child.stdout?.on('data', collect); child.stderr?.on('data', collect);
    timer = setTimeout(() => { exceeded = true; stop(); }, 120000); timer.unref();
    stopMonitor = monitorWorkingDirectory({ child, directory, onExceeded: async () => { exceeded = true; stop(); } });
    const code = await new Promise<number>((resolve, reject) => { child!.once('exit', code => resolve(code ?? -1)); child!.once('error', () => reject(new Error('FRACTURE_NATIVE_START_FAILED'))); });
    check(!exceeded && !signal.aborted, 'native timeout/resource/cancellation');
    check(code === 0, 'native executable nonzero exit');
    const output = await readUtf8FileBounded(join(directory, stage === 'gmsh_mesh' ? 'fracture.msh' : 'fracture.dat'), stage === 'gmsh_mesh' ? 64 * 1024 * 1024 : 16 * 1024 * 1024);
    return { code, output, diagnostics: diagnostic, cleanupConfirmed: true };
  } catch(error){originalFailure=error;throw error;} finally {
    if (timer) clearTimeout(timer); stopMonitor(); signal.removeEventListener('abort', stop);
    await finishFractureStage({stage,path:join(directory,stage==='gmsh_mesh'?'fracture.msh':'fracture.dat'),
      retain,diagnostic,exceeded,cancelled:signal.aborted,exitCode:child?.exitCode??null,originalFailure,
      terminate:()=>child?terminateChildProcess(child):Promise.resolve(true),clean:()=>removeWorkingDirectory(directory)});
  }
}
