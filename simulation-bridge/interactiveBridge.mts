import { createInterface } from 'node:readline/promises';
import { approveTwoLayerInTerminal } from './twoLayerTerminalApproval.mts';
import { loadExternalPipeline, testExternalProviderPaths } from './providers.mts';
import { startSimulationBridge } from './server.mts';
import {approvePortableExportInTerminal} from './nativePortableExport.mts';
import { browseExternalProviderExecutable } from './windowsExecutablePicker.mts';
import { HARMONIC_MODE_POLICY, selectHarmonicModeCount } from './harmonicModePolicy.mts';
import { openNativeProviderSettings, resolveConfiguredProviderPaths } from './providerSettings.mts';

/** Same normal interactive owner used by the CLI and bounded local qualification.
 * No injected provider/approval callback or storage-root override is accepted. */
export async function startInteractiveSimulationBridge(options:{allowedOrigin?:string;port?:number;announce?:boolean;onInterrupt?():void}={}){
if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Start the Simulation Bridge in an interactive terminal for explicit transfer approval.');
const providerSettings = await openNativeProviderSettings();
const savedSettings=await providerSettings.readVerified();
const configuredPaths = resolveConfiguredProviderPaths(savedSettings.paths, process.env);
const pipeline = await loadExternalPipeline(configuredPaths.gmshExecutable, configuredPaths.calculixExecutable, { discovery: false });
const terminal = createInterface({ input: process.stdin, output: process.stdout });
let bridge:Awaited<ReturnType<typeof startSimulationBridge>>;
try{bridge = await startSimulationBridge({ ...pipeline,
  allowedOrigin: options.allowedOrigin??process.env.TUNACAD_SIMULATION_ORIGIN,port:options.port,
  saveProviderSettings: paths => providerSettings.save(paths),
  async configureProviders(paths) {
    const configured = await testExternalProviderPaths(paths);
    if (configured.readiness.meshing.ready && configured.readiness.solving.ready) await providerSettings.save(paths);
    return configured;
  },
  browseProviderExecutable: browseExternalProviderExecutable,
  async approve(request, signal) {
    if(request.schema==='tunacad-portable-result-export-consent/1')return approvePortableExportInTerminal(request,signal,terminal);
    // Fracture dispatch is not registered by this public launcher. Never let a
    // pilot operation fall through to an ordinary Structural transfer prompt.
    if (request.schema === 'tunacad-stationary-fracture-operation-approval/0.1') return false;
    if(request.schema==='tunacad-private-simulation-solve-approval/0.1') {
      if(request.request.resultDelivery==='project_archive')console.log('This new study includes its completed FACE-node numerical results in Save Project. The saved project is readable/shareable; no raw evidence or execution authority is included.');
      console.log('Private explicit-dynamics solver authorization: '+JSON.stringify(request));
      console.log('This is the separate Bridge terminal approval for the displayed protected study and exact exported geometry/mesh. Geometry-transfer confirmation alone is insufficient. This increment does not launch a solver.');
      try {return (await terminal.question('Type approve for this exact private solve binding only: ',{signal})).trim()==='approve';}
      catch {return false;}
    }
    if (request.schema === 'tunacad-electrostatic-two-layer-approval/0.1') {
      return approveTwoLayerInTerminal(request,signal,terminal);
    }
    if (request.schema === 'tunacad-electrostatic-foundation/0.1') {
      if(request.resultDelivery==='project_archive')console.log('This new study includes its completed single-dielectric numerical results in Save Project. The saved project is readable/shareable; no raw evidence or execution authority is included.');
      console.log('Electrostatic approval: ' + JSON.stringify({ study: request.studyId,
        domain: request.model.domains[0], material: request.material,
        electrodes: request.prescribedPotentials, electricalUnits: request.output.units,
        requestDigest: request.requestDigest, meshSizeMm: 2, maximumNodes: 8000, maximumElements: 4000,
        cpuTimeLimitMs: 30000, memoryLimitBytes: 512 * 1024 * 1024 }));
      console.log('Only this approved canonical STEP source may be transferred. Linear dielectric slab only; no engineering-use permission.');
      try { return (await terminal.question('Type approve to allow this electrical request only: ', { signal })).trim() === 'approve'; }
      catch { return false; }
    }
    // JSON escaping prevents terminal escape/control injection in model names.
    const model = request.schema === 'tunacad-neutral-simulation-request/2.0'
      ? { analysis: request.analysis, domains: request.model.domains.map(domain => ({ domainId: domain.domainId, partId: domain.partId, occurrenceId: domain.occurrenceId })), revision: request.model.projectRevision, materials: request.materials.map(material => material.name), interactions: request.interactions.map(interaction => interaction.type === 'rigid_connector'
        ? { id: interaction.id, type: interaction.type, semanticReferenceIds: interaction.semanticReferenceIds, referencePointAnalysisMm: interaction.referencePointAnalysisMm, coupling: interaction.coupling }
        : interaction.type === 'frictionless_contact' || interaction.type === 'frictional_contact'
          ? { id: interaction.id, type: interaction.type, secondaryReferenceIds: interaction.secondaryReferenceIds, primaryReferenceIds: interaction.primaryReferenceIds, formulation: interaction.formulation, sliding: interaction.sliding, normalBehavior: interaction.normalBehavior, tangentialBehavior: interaction.tangentialBehavior, initialAdjustment: interaction.initialAdjustment }
          : { id: interaction.id, type: interaction.type, secondaryReferenceIds: interaction.secondaryReferenceIds, primaryReferenceIds: interaction.primaryReferenceIds, adjustment: interaction.adjustment, positionToleranceMm: interaction.positionToleranceMm }) }
      : { part: request.geometry.partId, revision: request.geometry.projectRevision, material: request.material.name };
    console.log(`\nSimulation transfer request: ${JSON.stringify({ study: request.name, ...model, loads: request.loads, constraints: request.constraints, mesh: request.mesh, digest: request.requestDigest })}`);
    if (request.schema === 'tunacad-neutral-simulation-request/2.0' && request.analysis.type === 'harmonic_response') {
      console.log(`Harmonic approval: ${JSON.stringify({ frequencyHz: request.analysis.settings.frequencyHz,
        forcePhaseRad: request.analysis.settings.forcePhaseRad, selectedModes: selectHarmonicModeCount(request.analysis.settings.frequencyHz),
        material: request.materials.map(material => ({ name: material.name, youngsModulusMPa: material.youngsModulusMPa,
          poissonRatio: material.poissonRatio, densityKgM3: material.densityKgM3 })), limits: HARMONIC_MODE_POLICY })}`);
    }
    console.log(`Approve transfer of ${request.schema === 'tunacad-neutral-simulation-request/2.0' ? 'up to 64 MiB across explicitly listed STEP domains' : 'up to 16 MiB of STEP geometry'} to local external providers. No CAD changes. Experimental results require engineer review.`);
    try { return (await terminal.question('Type approve to allow this request only: ', { signal })).trim() === 'approve'; }
    catch { return false; }
  },
});}catch(error){terminal.close();throw error;}
if(options.announce!==false){
console.log(`TunaCAD Simulation Bridge ${bridge.url}\nAllowed origin: ${options.allowedOrigin??process.env.TUNACAD_SIMULATION_ORIGIN ?? 'https://tunacad.com'}\nPairing code (one use, expires in 5 minutes): ${bridge.pairingCode}`);
console.log(`Gmsh ready: ${pipeline.readiness.meshing.ready}; CalculiX ready: ${pipeline.readiness.solving.ready}. No provider installation is performed.`);
console.log(`Explicit provider settings: ${providerSettings.filePath}. Save paths in TunaCAD; no executable discovery is used.`);
console.log('Open TunaCAD Simulation → Local Simulation Bridge. Restart to pair again. Ctrl+C revokes the session and cancels jobs.');
console.log('New Electrostatics jobs use temporary per-job scratch. Authentication and both human approvals remain required.');
}
let closing:Promise<void>|undefined;
const close=()=>closing??=Promise.resolve().then(async()=>{try{await bridge.close();}finally{terminal.close();}});
// Readline owns interactive Ctrl+C. The embedding runner owns its process signals.
const interrupted=()=>{options.onInterrupt?.();void close().catch(()=>{
  if(!options.onInterrupt){console.error('BRIDGE_SHUTDOWN_UNCONFIRMED');process.exitCode=1;}
});};
terminal.on('SIGINT',interrupted);
terminal.on('close',()=>{if(!closing)interrupted();});
return {...bridge,readiness:pipeline.readiness,close};
}
