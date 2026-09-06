import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { NeutralFemMesh, NeutralMeshJobRequest, NeutralSimulationRequest } from '../src/simulation/externalSimulationContracts.ts';
import { GmshMeshProvider, parseMsh41, validateStepEnvelope } from '../providers/gmsh/GmshMeshProvider.mts';
import { parseCalculiXDat } from '../providers/calculix/CalculiXSolverProvider.mts';

const validEnvelope = new TextEncoder().encode([
  'ISO-10303-21;', 'HEADER;', "FILE_DESCRIPTION(('hostile acceptance'),'2;1');",
  "FILE_NAME('fixture.step','','',(''),(''),'','','');", "FILE_SCHEMA(('AUTOMOTIVE_DESIGN_CC2'));",
  'ENDSEC;', 'DATA;', '#1=CARTESIAN_POINT(\'\',(0.,0.,0.));', 'ENDSEC;', 'END-ISO-10303-21;',
].join('\n'));
assert.doesNotThrow(() => validateStepEnvelope(validEnvelope));
for (const invalid of [
  new Uint8Array(127),
  new TextEncoder().encode(`ISO-10303-21;\nHEADER;\n${' '.repeat(160)}\nEND-ISO-10303-21;`),
  new TextEncoder().encode(`ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n#1=X();\u0000\nENDSEC;\nEND-ISO-10303-21;${' '.repeat(128)}`),
]) assert.throws(() => validateStepEnvelope(invalid), { code: 'SIMULATION_GEOMETRY_EXPORT_INVALID' });

const countBomb = '$MeshFormat\n4.1 0 8\n$EndMeshFormat\n$Nodes\n1 9007199254740991 1 1\n$EndNodes\n$Elements\n0 0 0 0\n$EndElements';
assert.throws(() => parseMsh41(countBomb, 1_000, 1_000), { code: 'SIMULATION_MESH_LIMIT' });
const fractionalCount = '$MeshFormat\n4.1 0 8\n$EndMeshFormat\n$Nodes\n1 1.5 1 1\n$EndNodes\n$Elements\n0 0 0 0\n$EndElements';
assert.throws(() => parseMsh41(fractionalCount, 1_000, 1_000), { code: 'SIMULATION_MESH_FORMAT_INVALID' });

const mesh = parserMesh();
assert.throws(() => parseCalculiXDat('displacements for set NALL\n1 1 0 0', mesh, ['FIXED_001']), /complete finite/);
assert.throws(() => parseCalculiXDat(`displacements for set NALL\n${'1'.repeat(4_097)}`, mesh, ['FIXED_001']), /oversized record/);
assert.throws(() => parseCalculiXDat([
  'displacements for set NALL', '1 1.7e308 1.7e308 1.7e308',
  'stresses for set EALL', '1 1 10 0 0 0 0 0',
  'total force for set FIXED_001', '1 0 0 1',
].join('\n'), mesh, ['FIXED_001']), /overflowed/);
assert.throws(() => parseCalculiXDat([
  'displacements for set NALL', '1 1 0 0',
  'stresses for set EALL', '1 1 1.7e308 -1.7e308 0 0 0 0',
  'total force for set FIXED_001', '1 0 0 1',
].join('\n'), mesh, ['FIXED_001']), /overflowed/);
const parsed = parseCalculiXDat([
  'displacements for set NALL', '1 0.1 0 0',
  'stresses for set EALL', '1 1 10 0 0 0 0 0',
  'total force for set FIXED_001', '1 0 0 500',
].join('\n'), mesh, ['FIXED_001']);
assert.equal(parsed.maximumDisplacementMm, 0.1);
assert.deepEqual(parsed.reactionForcesBySet.FIXED_001, [0, 0, 500]);

const gmshExecutable = process.env.TUNACAD_GMSH_EXECUTABLE;
if (gmshExecutable) {
  const before = await providerTemporaryDirectories();
  const provider = new GmshMeshProvider({ executable: gmshExecutable, runtimeVersion: 'hostile-input-acceptance' });
  Object.assign(provider.capabilities.execution, { executionTimeoutMs: 5_000, totalTimeoutMs: 10_000 });
  const request = meshRequest();
  const submission = await provider.submit(request, {
    descriptor: descriptor(),
    async export() { return validEnvelope; },
  });
  const deadline = Date.now() + 15_000;
  let status = await provider.getStatus(submission.meshRunId);
  while (status.status === 'running' || status.status === 'queued') {
    if (Date.now() >= deadline) throw new Error('Malformed STEP provider acceptance timed out.');
    await new Promise(resolve => setTimeout(resolve, 25));
    status = await provider.getStatus(submission.meshRunId);
  }
  assert.equal(status.status, 'failed');
  assert.match(status.failure?.code ?? '', /^SIMULATION_MESH_(FAILED|UNTRUSTED|FORMAT_INVALID|TIMEOUT)$/);
  assert.equal(await provider.getMesh(submission.meshRunId), null);
  await new Promise(resolve => setTimeout(resolve, 100));
  const after = await providerTemporaryDirectories();
  assert.deepEqual([...after].filter(name => !before.has(name)), [], 'Malformed STEP processing must not leave a new provider working directory.');
}

console.log(`Hostile provider-input acceptance passed: STEP envelopes, MSH count bombs, and malformed/overflowing CalculiX results fail closed${gmshExecutable ? ' with real Gmsh cleanup' : ''}.`);

function meshRequest(): NeutralMeshJobRequest {
  return {
    schema: 'tunacad-neutral-mesh-request/1.0', studyId: 'hostile-step', requestDigest: `sha256:${'1'.repeat(64)}`,
    projectRevision: 'hostile-r1', geometryDigest: `sha256:${'2'.repeat(64)}`, coordinateSpace: 'part_definition_local', units: 'mm',
    mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2, globalSizeMm: 5, minimumSizeMm: 1, maximumNodes: 10_000, maximumElements: 10_000, qualityMetric: 'provider_normalized', minimumQuality: 0.04 },
    boundaryRegions: [],
  };
}

function descriptor(): NeutralSimulationRequest['geometry'] {
  return {
    projectRevision: 'hostile-r1', partId: 'part', bodyId: 'body', geometryDigest: `sha256:${'2'.repeat(64)}`, coordinateSpace: 'part_definition_local',
    shape: { valid: true, connectedSolidCount: 1, faceCount: 6, edgeCount: 12, volumeMm3: 1_000, surfaceAreaMm2: 600, boundingBoxMm: { min: [0, 0, 0], max: [10, 10, 10], size: [10, 10, 10] } }, references: [],
  };
}

function parserMesh(): NeutralFemMesh {
  return {
    nodes: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.5, 0, 0], [0.5, 0.5, 0], [0, 0.5, 0], [0, 0, 0.5], [0, 0.5, 0.5], [0.5, 0, 0.5]],
    volumeElements: { connectivity: [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]], regionIds: ['solid'] },
  } as NeutralFemMesh;
}

async function providerTemporaryDirectories(): Promise<Set<string>> {
  return new Set((await readdir(tmpdir(), { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name.startsWith('tunacad-gmsh-mesh-')).map(entry => entry.name));
}
