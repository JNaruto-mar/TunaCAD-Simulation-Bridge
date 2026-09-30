import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { NeutralFemMesh, NeutralVector3 } from '../../src/simulation/externalSimulationContracts.ts';
import { quadraticTetraVolume, quadraticTriangleSurfaceSamples,
  tetraMeanRatio, validateNeutralFemMesh } from '../../src/simulation/neutralFemMesh.ts';
import { validateElectrostaticTwoLayer } from '../../simulation-bridge/electrostaticTwoLayerFoundation.mts';
import { electrostaticStepGeometryDigest } from '../../simulation-bridge/electrostaticStepIdentity.mts';
import { digest } from '../../simulation-bridge/stableDigest.mts';
import { parseMsh41 } from './GmshMeshProvider.mts';
import { electrostaticTwoLayerMeshInputs } from './ElectrostaticTwoLayerMesh.mts';
import { hasEnforcedProviderProcessQuotas, monitorWorkingDirectory, readUtf8FileBounded,
  removeWorkingDirectory, spawnProviderProcess, terminateChildProcess } from '../processLifecycle.mts';

const fail = (reason: string): never => { throw new Error('ELECTROSTATIC_TWO_LAYER_COMPOUND_MESH_INVALID: ' + reason); };
const edges = [[0, 1, 4], [1, 2, 5], [2, 0, 6], [0, 3, 7], [2, 3, 8], [1, 3, 9]];
const faces = [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]];
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-7;
const cross = (a: number[], b: number[]) =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i], 0);

/** One OCC fragment mesh of two independently canonical-verified native STEP
 * bodies. No nodal projection or nonconformal tie is used. The generated
 * interface is split back into two owner-local neutral meshes, then passed to
 * the existing exact quadratic shared-topology composer. */
export async function meshTwoLayerNativeSteps(value: unknown,
  steps: [Uint8Array, Uint8Array], executable: string, globalSizeMm = 2):
  Promise<[NeutralFemMesh, NeutralFemMesh]> {
  const r = validateElectrostaticTwoLayer(value) as any;
  if (!hasEnforcedProviderProcessQuotas() || basename(executable).toLowerCase() !== 'gmsh.exe'
    || !Number.isFinite(globalSizeMm) || globalSizeMm < 0.2 || globalSizeMm > 2)
    fail('unsupported runtime or mesh budget');
  for (let i = 0; i < 2; i++) if (!(steps[i] instanceof Uint8Array)
    || steps[i].byteLength < 1 || steps[i].byteLength > 32 * 1024 * 1024
    || await electrostaticStepGeometryDigest(steps[i]) !== r.model.domains[i].geometryDigest)
    fail('native STEP source digest mismatch');
  const folder = await mkdtemp(join(tmpdir(), 'tunacad-electrical-two-layer-mesh-'));
  let child: ReturnType<typeof spawnProviderProcess> | null = null;
  let stopMonitor = () => undefined;
  try {
    await writeFile(join(folder, 'layer-a.step'), steps[0]);
    await writeFile(join(folder, 'layer-b.step'), steps[1]);
    const shiftMm = r.model.interface.planeXM * 1000;
    await writeFile(join(folder, 'mesh.geo'), [
      'SetFactory("OpenCASCADE");',
      'a() = ShapeFromFile("layer-a.step");',
      'b() = ShapeFromFile("layer-b.step");',
      'Translate {' + shiftMm + ',0,0} { Volume{b()}; }',
      'fragments() = BooleanFragments{Volume{a()}; Delete;}{Volume{b()}; Delete;};',
      'Mesh.MeshSizeMin = ' + globalSizeMm + ';',
      'Mesh.MeshSizeMax = ' + globalSizeMm + ';',
      'Mesh.ElementOrder = 2;',
      'Mesh.MshFileVersion = 4.1;',
      'Mesh.Binary = 0;',
    ].join('\n') + '\n', 'utf8');
    child = spawnProviderProcess(executable,
      ['mesh.geo', '-3', '-format', 'msh4', '-o', 'mesh.msh', '-v', '2'],
      { cwd: folder, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PATH: dirname(executable) + ';' + (process.env.PATH ?? '') } },
      { cpuTimeLimitMs: 30_000, memoryLimitBytes: 512 * 1024 * 1024 });
    let output = '', exceeded = false;
    const collect = (chunk: unknown) => {
      output += String(chunk);
      if (output.length > 16384) { exceeded = true; void terminateChildProcess(child!); }
    };
    child.stdout?.on('data', collect); child.stderr?.on('data', collect);
    stopMonitor = monitorWorkingDirectory({ child, directory: folder,
      maximumBytes: 64 * 1024 * 1024,
      async onExceeded() { exceeded = true; await terminateChildProcess(child!); } });
    const timer = setTimeout(() => { exceeded = true; void terminateChildProcess(child!); }, 60_000);
    timer.unref();
    let code: number | null;
    try { code = await new Promise((resolve, reject) => {
      child!.once('error', reject); child!.once('close', resolve);
    }); } finally { clearTimeout(timer); }
    if (code !== 0 || exceeded) fail('Gmsh fragment mesh failed: ' + output.slice(-1000));
    const text = await readUtf8FileBounded(join(folder, 'mesh.msh'), 32 * 1024 * 1024);
    const parsed = parseMsh41(text, 16000, 8000);
    const inputs = electrostaticTwoLayerMeshInputs(r, globalSizeMm);
    const domains = [0, 1].map(index =>
      localMesh(index as 0 | 1, parsed, r, inputs[index], globalSizeMm)) as
      [NeutralFemMesh, NeutralFemMesh];
    if (domains.reduce((sum, mesh) => sum + mesh.volumeElements.connectivity.length, 0)
      !== parsed.tetrahedra.length) fail('unassigned or overlapping fragment volume elements');
    return domains;
  } finally {
    stopMonitor();
    if (child) await terminateChildProcess(child);
    if (!await removeWorkingDirectory(folder)) fail('Gmsh compound mesh cleanup failed');
  }
}

function localMesh(index: 0 | 1, parsed: ReturnType<typeof parseMsh41>,
  r: ReturnType<typeof validateElectrostaticTwoLayer>,
  input: ReturnType<typeof electrostaticTwoLayerMeshInputs>[number],
  globalSizeMm: number): NeutralFemMesh {
  const domain = r.model.domains[index] as { shape: {
    xMinM: number; xMaxM: number; widthM: number; heightM: number } }, shape = domain.shape;
  const xMinMm = shape.xMinM * 1000, xMaxMm = shape.xMaxM * 1000;
  const globalCells = parsed.tetrahedra.filter(tet => {
    const cornerX = tet.connectivity.slice(0, 4).map(node => parsed.nodes[node][0]);
    const center = cornerX.reduce((a, b) => a + b, 0) / 4;
    if (center > xMinMm + 1e-7 && center < xMaxMm - 1e-7) {
      if (cornerX.some(x => x < xMinMm - 1e-7 || x > xMaxMm + 1e-7))
        fail('tetrahedron crosses dielectric interface');
      return true;
    }
    return false;
  }).map(tet => tet.connectivity);
  if (!globalCells.length) fail('missing domain volume');
  const used = [...new Set(globalCells.flat())].sort((a, b) => a - b);
  const remap = new Map(used.map((old, current) => [old, current]));
  const nodes = used.map(old => {
    const [x, y, z] = parsed.nodes[old];
    return [x - xMinMm, y, z] as NeutralVector3;
  });
  const cells = globalCells.map(cell => cell.map(old => remap.get(old)!));
  const boundary = new Map<string, { count: number; facet: number[]; cell: number[] }>();
  for (const cell of cells) for (const corners of faces) {
    const key = corners.map(j => cell[j]).sort((a, b) => a - b).join(':');
    const edge = (a: number, b: number) => {
      const found = edges.find(([u, v]) => (u === a && v === b) || (u === b && v === a));
      if (!found) return fail('quadratic edge missing');
      return cell[found[2]];
    };
    const [a, b, c] = corners;
    const facet = [cell[a], cell[b], cell[c], edge(a, b), edge(b, c), edge(c, a)];
    const existing = boundary.get(key);
    if (existing) existing.count++;
    else boundary.set(key, { count: 1, facet, cell });
  }
  const facetEntries: Array<{ facet: number[]; regionId: string }> = [];
  for (const item of boundary.values()) if (item.count === 1) {
    const facet = item.facet, p = facet.slice(0, 3).map(node => nodes[node]);
    const region = input.meshRequest.boundaryRegions.find(region => {
      const box = region.face.boundingBoxMm!;
      const axis = box.min.findIndex((v, i) => near(v, box.max[i]));
      return axis >= 0 && p.every(v => near(v[axis], box.min[axis]));
    });
    if (!region) fail('unowned exterior/interface facet');
    // Orient each surface out of its own dielectric volume.
    const a = p[1].map((v, i) => v - p[0][i]), b = p[2].map((v, i) => v - p[0][i]);
    const normal = cross(a, b);
    const faceCenter = p[0].map((v, i) => (v + p[1][i] + p[2][i]) / 3);
    const tetCenter = [0, 1, 2].map(axis =>
      item.cell.slice(0, 4).reduce((sum, node) => sum + nodes[node][axis], 0) / 4);
    if (dot(normal, faceCenter.map((v, i) => v - tetCenter[i])) < 0)
      facetEntries.push({ facet: [facet[0], facet[2], facet[1], facet[5], facet[4], facet[3]],
        regionId: region.regionId });
    else facetEntries.push({ facet, regionId: region.regionId });
  }
  if (facetEntries.length === 0 || facetEntries.length > 16000) fail('boundary facet budget');
  const boundaryFacets = facetEntries.map(item => item.facet);
  const regionIds = facetEntries.map(item => item.regionId);
  const measures = cells.map(cell => {
    const points = cell.map(node => nodes[node]);
    const volume = quadraticTetraVolume(points);
    const quality = tetraMeanRatio(points.slice(0, 4) as
      [NeutralVector3, NeutralVector3, NeutralVector3, NeutralVector3]);
    if (!(volume > 0) || !(quality > 0)) fail('degenerate/negative tetrahedron');
    return { volume, quality };
  });
  const meshVolumeMm3 = measures.reduce((sum, x) => sum + x.volume, 0);
  const size = [xMaxMm - xMinMm, shape.widthM * 1000, shape.heightM * 1000];
  const cadVolumeMm3 = size[0] * size[1] * size[2];
  if (Math.abs(meshVolumeMm3 - cadVolumeMm3) > cadVolumeMm3 * 1e-5)
    fail('wrong domain volume or overlap');
  const regions = input.meshRequest.boundaryRegions.map(region => {
    const facetIndices = regionIds.flatMap((id, i) => id === region.regionId ? [i] : []);
    if (!facetIndices.length) fail('incomplete mapped FACE');
    const area = facetIndices.reduce((sum, facetIndex) =>
      sum + quadraticTriangleSurfaceSamples(boundaryFacets[facetIndex].map(node => nodes[node]))
        .reduce((total, sample) => total + sample.areaWeightMm2, 0), 0);
    if (Math.abs(area - region.face.areaMm2) > region.face.areaMm2 * 1e-5)
      fail('incomplete mapped FACE area');
    return { regionId: region.regionId, semanticReferenceIds: [region.semanticReferenceId],
      sourceFeatureIds: [], facetIndices, matchedCadFace: structuredClone(region.face),
      match: { state: 'verified' as const, method: 'geometric_signature' as const,
        candidateCount: 1 as const, centroidToleranceMm: 1e-7,
        areaRelativeTolerance: 1e-5 } };
  });
  const result: NeutralFemMesh = {
    schema: 'tunacad-neutral-fem-mesh/1.0',
    meshId: 'electrical-compound-domain-' + index,
    requestDigest: input.meshRequest.requestDigest,
    projectRevision: input.meshRequest.projectRevision,
    geometryDigest: input.meshRequest.geometryDigest,
    coordinateSpace: 'part_definition_local', units: 'mm',
    element: { family: 'tetrahedral', geometryOrder: 2, solutionOrder: 2 },
    nodes, volumeElements: { connectivity: cells, regionIds: cells.map(() => 'volume') },
    boundaryFacets: { connectivity: boundaryFacets, regionIds },
    boundaryRegions: regions,
    volumeRegions: [{ regionId: 'volume', elementIndices: cells.map((_, i) => i) }],
    quality: { metric: 'mean_ratio', minimum: Math.min(...measures.map(x => x.quality)),
      average: measures.reduce((sum, x) => sum + x.quality, 0) / measures.length,
      invalidElementCount: 0, nodeCount: nodes.length, elementCount: cells.length,
      boundaryFacetCount: boundaryFacets.length, cadVolumeMm3, meshVolumeMm3,
      volumeRelativeError: Math.abs(meshVolumeMm3 - cadVolumeMm3) / cadVolumeMm3 },
    provenance: { meshProviderInterfaceVersion: '1.0', adapterId: 'tunacad-gmsh-occt-fragment',
      adapterVersion: '0.1.0', engine: 'Gmsh', engineVersion: '4.15.2',
      optionsDigest: digest({ globalSizeMm, sourceDigests:
        (r.model.domains as Array<{ geometryDigest: string }>).map(d => d.geometryDigest) }),
      inputGeometryDigest: input.meshRequest.geometryDigest,
      generatedAt: new Date().toISOString() },
  };
  validateNeutralFemMesh(result, input.meshRequest);
  return result;
}
