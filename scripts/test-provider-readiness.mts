import assert from 'node:assert/strict';
import { loadExternalPipeline } from '../simulation-bridge/providers.mts';

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (!gmsh || !calculix) throw new Error('Set TUNACAD_GMSH_EXECUTABLE and TUNACAD_CALCULIX_EXECUTABLE to absolute executable paths.');

const pipeline = await loadExternalPipeline(gmsh, calculix);
assert.equal(pipeline.readiness.ready, true);
assert.deepEqual(pipeline.provider?.capabilities.study.loadTypes, ['surface_force']);
assert.equal(pipeline.provider?.capabilities.study.maximumLoads, 64);
assert.deepEqual(pipeline.provider?.capabilities.study.constraintTypes, ['fixed']);
assert.equal(pipeline.provider?.capabilities.study.maximumConstraints, 64);

console.log(JSON.stringify({
  ready: pipeline.readiness.ready,
  gmsh: { ready: pipeline.readiness.meshing.ready, version: pipeline.readiness.meshing.runtimeVersion },
  calculix: { ready: pipeline.readiness.solving.ready, version: pipeline.readiness.solving.runtimeVersion },
  admission: pipeline.provider?.capabilities.study,
}, null, 2));
