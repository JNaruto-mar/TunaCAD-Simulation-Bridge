import type { NeutralFemMesh, NeutralVector3 } from '../src/simulation/externalSimulationContracts.ts';
import { quadraticTetraVolume } from '../src/simulation/neutralFemMesh.ts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { sealElectrostaticFoundation, VACUUM_PERMITTIVITY_F_PER_M } from '../simulation-bridge/electrostaticFoundation.mts';
import { electrostaticSlabMeshInputs } from '../providers/calculix/CalculiXElectrostaticSlab.mts';

export function slabRequest(geometryDigest = digest({ declaredDimensionsM: [0.001, 0.01, 0.01] })) {
  return sealElectrostaticFoundation({
    schema: 'tunacad-electrostatic-foundation/0.1', studyId: 'electrical-provider-slab',
    analysis: { type: 'electrostatic', assumptions: ['homogeneous_linear_isotropic_dielectric',
      'zero_free_volume_charge', 'bounded_domain', 'no_coupling', 'ideal_parallel_plate_no_fringing'] },
    model: { projectRevision: 'electrical-slab-r1', domains: [{
      domainId: 'dielectric', partId: 'slab-part', bodyId: 'slab-body', geometryDigest,
      shape: { kind: 'ideal_parallel_plate_slab', lengthM: 0.001, widthM: 0.01, heightM: 0.01,
        lengthUnit: 'm', longitudinalAxis: 'x', faces: { xMin: 'face-left', xMax: 'face-right',
          yMin: 'face-bottom', yMax: 'face-top', zMin: 'face-back', zMax: 'face-front' } },
    }] },
    material: { materialId: 'linear-dielectric', domainId: 'dielectric',
      model: 'homogeneous_linear_isotropic_dielectric',
      absolutePermittivityFPerM: 4 * VACUUM_PERMITTIVITY_F_PER_M, permittivityUnit: 'F/m',
      source: { kind: 'custom', reference: 'Analytical epsilon_r=4; not certified', revision: 'r1' } },
    prescribedPotentials: [
      { groupId: 'left-electrode', domainId: 'dielectric', faceIds: ['face-left'],
        kind: 'prescribed_electric_potential', potentialV: 0, unit: 'V' },
      { groupId: 'right-electrode', domainId: 'dielectric', faceIds: ['face-right'],
        kind: 'prescribed_electric_potential', potentialV: 100, unit: 'V' },
    ],
    lateralBoundary: { kind: 'zero_normal_electric_displacement',
      appliesTo: 'all_four_lateral_faces', normalElectricDisplacementCPerM2: 0, unit: 'C/m^2' },
    output: { normalizedAxialPositions: [0, 0.25, 0.5, 0.75, 1],
      units: { electricPotential: 'V', electricField: 'V/m', electricDisplacement: 'C/m^2',
        electrodeCharge: 'C', capacitance: 'F', electrostaticEnergy: 'J', electrostaticEnergyDensity: 'J/m^3' } },
  });
}

/** Synthetic straight-sided mesh for parser negatives, not solver evidence. */
export function syntheticSlabMesh(): NeutralFemMesh {
  const request = slabRequest(); const { meshRequest } = electrostaticSlabMeshInputs(request);
  const nodes: NeutralVector3[] = [[0, 0, 0], [1, 0, 0], [0, 10, 0], [1, 10, 0],
    [0, 0, 10], [1, 0, 10], [0, 10, 10], [1, 10, 10]];
  const tets = [[0, 1, 3, 7], [0, 3, 2, 7], [0, 2, 6, 7], [0, 6, 4, 7], [0, 4, 5, 7], [0, 5, 1, 7]];
  const edgeNodes = new Map<string, number>();
  function edge(a: number, b: number) {
    const key = [a, b].sort((x, y) => x - y).join(':');
    if (!edgeNodes.has(key)) {
      edgeNodes.set(key, nodes.length);
      nodes.push(nodes[a].map((value, i) => (value + nodes[b][i]) / 2) as NeutralVector3);
    }
    return edgeNodes.get(key)!;
  }
  const cells = tets.map(([a, b, c, d]) => [a, b, c, d, edge(a, b), edge(b, c), edge(c, a), edge(a, d), edge(c, d), edge(b, d)]);
  const surface = new Map<string, number[][]>();
  for (const [a, b, c, d] of tets) for (const face of [[a, b, c], [a, b, d], [a, c, d], [b, c, d]]) {
    const key = [...face].sort((x, y) => x - y).join(':');
    surface.set(key, [...(surface.get(key) ?? []), face]);
  }
  const facets: number[][] = []; const regionIds: string[] = [];
  for (const values of surface.values()) if (values.length === 1) {
    const [a, b, c] = values[0];
    const region = meshRequest.boundaryRegions.find(region => {
      const box = region.face.boundingBoxMm!;
      const axis = box.min.findIndex((value, i) => value === box.max[i]);
      return [a, b, c].every(node => nodes[node][axis] === box.min[axis]);
    })!;
    facets.push([a, b, c, edge(a, b), edge(b, c), edge(c, a)]); regionIds.push(region.regionId);
  }
  const mesh: NeutralFemMesh = {
    schema: 'tunacad-neutral-fem-mesh/1.0', meshId: 'synthetic-electrical-slab',
    requestDigest: request.requestDigest, projectRevision: request.model.projectRevision,
    geometryDigest: request.model.domains[0].geometryDigest, coordinateSpace: 'part_definition_local', units: 'mm',
    element: { family: 'tetrahedral', geometryOrder: 2, solutionOrder: 2 }, nodes,
    volumeElements: { connectivity: cells, regionIds: cells.map(() => 'volume') },
    boundaryFacets: { connectivity: facets, regionIds },
    boundaryRegions: meshRequest.boundaryRegions.map(region => ({
      regionId: region.regionId, semanticReferenceIds: [region.semanticReferenceId], sourceFeatureIds: [],
      facetIndices: regionIds.flatMap((id, i) => id === region.regionId ? [i] : []),
      matchedCadFace: region.face, match: { state: 'verified', method: 'geometric_signature',
        candidateCount: 1, centroidToleranceMm: 1e-8, areaRelativeTolerance: 1e-8 },
    })),
    volumeRegions: [{ regionId: 'volume', elementIndices: cells.map((_, i) => i) }],
    quality: { metric: 'mean_ratio', minimum: 0.1, average: 0.1, invalidElementCount: 0,
      nodeCount: nodes.length, elementCount: cells.length, boundaryFacetCount: facets.length,
      cadVolumeMm3: 100, meshVolumeMm3: cells.reduce((sum, cell) => sum + quadraticTetraVolume(cell.map(node => nodes[node])), 0),
      volumeRelativeError: 0 },
    provenance: { meshProviderInterfaceVersion: '1.0', adapterId: 'synthetic', adapterVersion: '0.1',
      engine: 'synthetic', engineVersion: 'none', optionsDigest: digest({ fixture: 'synthetic' }),
      inputGeometryDigest: request.model.domains[0].geometryDigest, generatedAt: '2026-09-28T00:00:00.000Z' },
  };
  return mesh;
}

export function syntheticElectricalDat(mesh: NeutralFemMesh) {
  const sets = ['xMin', 'xMax'].map(face => {
    const region = mesh.boundaryRegions.find(item => item.regionId === 'electrical_face_' + face)!;
    return [...new Set(region.facetIndices.flatMap(i => mesh.boundaryFacets.connectivity[i]))].sort((a, b) => a - b);
  });
  return [' temperatures (node,temperature) for set NALL and time 1',
    ...mesh.nodes.map((point, node) => (node + 1) + ' ' + (point[0] * 100)), '',
    ' heat generation (node,RFL) for set ELECTRODE_LEFT and time 1',
    ...sets[0].map(node => (node + 1) + ' ' + (-10000 / sets[0].length)), '',
    ' heat generation (node,RFL) for set ELECTRODE_RIGHT and time 1',
    ...sets[1].map(node => (node + 1) + ' ' + (10000 / sets[1].length)), '',
    ' heat flux (elem, integ.pnt.,qx,qy,qz) for set EALL and time 1',
    ...mesh.volumeElements.connectivity.flatMap((_, i) => [1, 2, 3, 4].map(ip => (i + 1) + ' ' + ip + ' -100 0 0')),
    ''].join('\n');
}
