import { createInterface } from 'node:readline/promises';
import { loadExternalPipeline, testExternalProviderPaths } from './providers.mts';
import { startSimulationBridge } from './server.mts';
import { browseExternalProviderExecutable } from './windowsExecutablePicker.mts';

if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Start the Simulation Bridge in an interactive terminal for explicit transfer approval.');
const pipeline = await loadExternalPipeline(process.env.TUNACAD_GMSH_EXECUTABLE, process.env.TUNACAD_CALCULIX_EXECUTABLE);
const terminal = createInterface({ input: process.stdin, output: process.stdout });
const bridge = await startSimulationBridge({ ...pipeline,
  allowedOrigin: process.env.TUNACAD_SIMULATION_ORIGIN,
  configureProviders: testExternalProviderPaths,
  browseProviderExecutable: browseExternalProviderExecutable,
  async approve(request, signal) {
    // JSON escaping prevents terminal escape/control injection in model names.
    console.log(`\nSimulation transfer request: ${JSON.stringify({ study: request.name, part: request.geometry.partId, revision: request.geometry.projectRevision, material: request.material.name, loads: request.loads, constraints: request.constraints, mesh: request.mesh, digest: request.requestDigest })}`);
    console.log('Approve transfer of up to 16 MiB of STEP geometry to local external providers. No CAD changes. Experimental results require engineer review.');
    try { return (await terminal.question('Type approve to allow this request only: ', { signal })).trim() === 'approve'; }
    catch { return false; }
  },
});
console.log(`TunaCAD Simulation Bridge ${bridge.url}\nAllowed origin: ${process.env.TUNACAD_SIMULATION_ORIGIN ?? 'https://tunacad.com'}\nPairing code (one use, expires in 5 minutes): ${bridge.pairingCode}`);
console.log(`Gmsh ready: ${pipeline.readiness.meshing.ready}; CalculiX ready: ${pipeline.readiness.solving.ready}. No provider installation is performed.`);
console.log('Open TunaCAD Simulation → Local Simulation Bridge. Restart to pair again. Ctrl+C revokes the session and cancels jobs.');
let closing = false;
async function shutdown() { if (closing) return; closing = true; await bridge.close(); terminal.close(); process.exit(0); }
process.on('SIGINT', () => void shutdown()); process.on('SIGTERM', () => void shutdown());
// Readline owns Ctrl+C in an interactive terminal; process SIGINT alone is not sufficient.
terminal.on('SIGINT', () => void shutdown());
terminal.on('close', () => void shutdown());
