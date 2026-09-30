import { createInterface } from 'node:readline/promises';
import { loadExternalPipeline, testExternalProviderPaths } from './providers.mts';
import { startSimulationBridge } from './server.mts';
import { browseExternalProviderExecutable } from './windowsExecutablePicker.mts';
import { HARMONIC_MODE_POLICY, selectHarmonicModeCount } from './harmonicModePolicy.mts';

if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Start the Simulation Bridge in an interactive terminal for explicit transfer approval.');
const pipeline = await loadExternalPipeline(process.env.TUNACAD_GMSH_EXECUTABLE, process.env.TUNACAD_CALCULIX_EXECUTABLE);
const terminal = createInterface({ input: process.stdin, output: process.stdout });
const bridge = await startSimulationBridge({ ...pipeline,
  allowedOrigin: process.env.TUNACAD_SIMULATION_ORIGIN,
  configureProviders: testExternalProviderPaths,
  browseProviderExecutable: browseExternalProviderExecutable,
  async approve(request, signal) {
    if (request.schema === 'tunacad-electrostatic-two-layer-approval/0.1') {
      console.log('Two-layer electrostatic approval: ' + JSON.stringify({
        protectedStudyId: request.studyId, revision: request.projectRevision,
        sourceEpoch: request.sourceEpoch, sourceDigest: request.sourceDigest,
        requestDigest: request.requestDigest,
        preparationReceiptDigest: request.preparationReceiptDigest,
        domains: request.domains, electrodes: request.electrodes,
        interfaceFaces: request.interfaceFaces, conformalMesh: request.mesh,
      }));
      console.log('Authorize this one protected two-layer study only. This terminal approval does not dispatch a provider.');
      try { return (await terminal.question('Type approve to authorize this two-layer study only: ', { signal })).trim() === 'approve'; }
      catch { return false; }
    }
    if (request.schema === 'tunacad-electrostatic-foundation/0.1') {
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
});
console.log(`TunaCAD Simulation Bridge ${bridge.url}\nAllowed origin: ${process.env.TUNACAD_SIMULATION_ORIGIN ?? 'https://tunacad.com'}\nPairing code (one use, expires in 5 minutes): ${bridge.pairingCode}`);
console.log(`Gmsh ready: ${pipeline.readiness.meshing.ready}; CalculiX ready: ${pipeline.readiness.solving.ready}. No provider installation is performed.`);
console.log('Open TunaCAD Simulation → Local Simulation Bridge. Restart to pair again. Ctrl+C revokes the session and cancels jobs.');
console.log('Electrostatic dispatch requires TUNACAD_ELECTROSTATIC_STORAGE_PARENT naming an existing host-owned durable directory; each approved job gets a newly protected record vault. No old records are upgraded.');
let closing = false;
async function shutdown() { if (closing) return; closing = true; await bridge.close(); terminal.close(); process.exit(0); }
process.on('SIGINT', () => void shutdown()); process.on('SIGTERM', () => void shutdown());
// Readline owns Ctrl+C in an interactive terminal; process SIGINT alone is not sufficient.
terminal.on('SIGINT', () => void shutdown());
terminal.on('close', () => void shutdown());
