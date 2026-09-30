import type {
  NeutralFemMesh, NeutralFemModelV2, NeutralMeshJobRequestV2, NeutralVector3,
} from '../../src/simulation/externalSimulationContracts.ts';
import { composeNeutralFemModelV2 } from '../../src/simulation/multiDomainFemModel.ts';
import { validateNeutralFemMesh, quadraticTriangleSurfaceSamples } from '../../src/simulation/neutralFemMesh.ts';
import { electrostaticSlabMeshInputs } from '../calculix/CalculiXElectrostaticSlab.mts';
import { validateElectrostaticTwoLayer, type ElectrostaticTwoLayer } from '../../simulation-bridge/electrostaticTwoLayerFoundation.mts';
import { twoLayerLocalSlabRequest } from '../../simulation-bridge/electrostaticTwoLayerSource.mts';
import { digest } from '../../simulation-bridge/stableDigest.mts';

const faceKeys = ['xMin', 'xMax', 'yMin', 'yMax', 'zMin', 'zMax'] as const;
const fail = (why: string): never => { throw new Error('ELECTROSTATIC_TWO_LAYER_MESH_INVALID: ' + why); };
type LayerDomain = {
  domainId: string; partId: string; bodyId: string; geometryDigest: string;
  shape: { xMinM: number; xMaxM: number; widthM: number; heightM: number;
    faces: Record<typeof faceKeys[number], string> };
};

/** Each domain remains a hardened v1 native-STEP/Gmsh mesh request. The mesh
 * identity is rebound to the sealed two-domain request, never to caller JSON. */
export function electrostaticTwoLayerMeshInputs(value: unknown, globalSizeMm = 2) {
  const r = validateElectrostaticTwoLayer(value);
  return ([0, 1] as const).map(index => {
    const local = twoLayerLocalSlabRequest(r, index);
    const { meshRequest, descriptor } = electrostaticSlabMeshInputs(local, globalSizeMm);
    return { domainId: r.model.domains[index].domainId,
      meshRequest: { ...meshRequest, studyId: r.studyId, requestDigest: r.requestDigest },
      descriptor };
  });
}

/** Existing SIM-4A shared-topology merge rejects unmatched quadratic nodes,
 * facets or orientation. This guard additionally checks exact interface
 * ownership, completeness, area and unique domain element coverage. */
export function verifyAndComposeTwoLayerMesh(value: unknown,
  localMeshes: [NeutralFemMesh, NeutralFemMesh], globalSizeMm = 2) {
  const r = validateElectrostaticTwoLayer(value);
  const inputs = electrostaticTwoLayerMeshInputs(r, globalSizeMm);
  const domains = r.model.domains as unknown as [LayerDomain, LayerDomain];
  for (const [index, mesh] of localMeshes.entries()) {
    validateNeutralFemMesh(mesh, inputs[index].meshRequest);
    if (mesh.element.geometryOrder !== 2 || mesh.volumeRegions.length !== 1
      || mesh.boundaryRegions.length !== 6 || mesh.volumeElements.connectivity.length > 4000
      || mesh.nodes.length > 8000) fail('bounded quadratic domain mesh required');
    const expected = domains[index].shape;
    for (const point of mesh.nodes) if (point.some((v, axis) =>
      v < -1e-7 || v > [1000 * (expected.xMaxM - expected.xMinM),
        1000 * expected.widthM, 1000 * expected.heightM][axis] + 1e-7))
      fail('node outside trusted owner-local slab');
  }
  const meshRequest: NeutralMeshJobRequestV2 = {
    schema: 'tunacad-neutral-mesh-request/2.0', studyId: r.studyId,
    requestDigest: r.requestDigest, projectRevision: r.model.projectRevision,
    modelDigest: digest(r.model), coordinateSpace: 'frozen_analysis', units: 'mm',
    mesh: structuredClone(inputs[0].meshRequest.mesh),
    domains: domains.map((d, index) => {
      const shape = inputs[index].descriptor.shape;
      const xMm = d.shape.xMinM * 1000;
      return { domainId: d.domainId, partId: d.partId, bodyId: d.bodyId,
        occurrenceId: 'electrical-domain-' + index, geometryDigest: d.geometryDigest,
        domainDigest: digest({ d, material: r.materials[index] }),
        transformToAnalysis: [1, 0, 0, xMm, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        volumeRegionId: 'electrical-volume-' + index,
        materialId: (r.materials[index] as { materialId: string }).materialId,
        shape: { ...shape, boundingBoxOwnerLocalMm: shape.boundingBoxMm } };
    }),
    boundaryRegions: domains.flatMap((d, index) =>
      inputs[index].meshRequest.boundaryRegions.map((region, n) => ({
        regionId: d.domainId + '-' + region.regionId, domainId: d.domainId,
        role: n === (index === 0 ? 1 : 0)
          ? 'interaction' as const : 'constraint' as const,
        semanticReferenceId: d.shape.faces[faceKeys[n]], sourceFeatureId: null,
        faceOwnerLocal: region.face,
      }))),
    interactions: [{
      id: 'electrical-shared-interface', name: 'Verified planar dielectric interface',
      type: 'shared_topology', adjustment: 'none',
      secondaryReferenceIds: [domains[1].shape.faces.xMin],
      primaryReferenceIds: [domains[0].shape.faces.xMax],
      positionToleranceMm: 1e-7,
    }],
  };
  const model = composeNeutralFemModelV2(meshRequest,
    domains.map((d, index) => ({ domainId: d.domainId, mesh: localMeshes[index] })),
    { adapterId: 'tunacad-electrostatic-two-layer-provider-fixture', adapterVersion: '0.1.0',
      engine: 'Gmsh', engineVersion: '4.15.2',
      optionsDigest: digest({ globalSizeMm, sharedTopology: true }) });
  if (model.nodes.length > 16000 || model.volumeElements.connectivity.length > 8000
    || model.domainRegions.length !== 2 || model.boundaryRegions.length !== 12)
    fail('composed mesh bounds or ownership');
  const interfaceRegions = [r.model.interface.leftFaceId, r.model.interface.rightFaceId].map(faceId => {
    const matches = model.boundaryRegions.filter(region =>
      region.semanticReferenceIds.length === 1 && region.semanticReferenceIds[0] === faceId);
    if (matches.length !== 1) fail('missing/ambiguous interface FACE ownership');
    return matches[0];
  });
  const facetKeys = interfaceRegions.map(region => region.facetIndices.map(index => {
    const facet = model.boundaryFacets.connectivity[index];
    if (facet.length !== 6 || facet.some(node =>
      Math.abs(model.nodes[node][0] - r.model.interface.planeXM * 1000) > 1e-7))
      fail('interface facet outside verified plane');
    return [...facet].sort((a, b) => a - b).join(':');
  }).sort());
  if (!facetKeys[0].length || digest(facetKeys[0]) !== digest(facetKeys[1]))
    fail('interface quadratic facets not shared one-to-one');
  const interfaceNodes = [...new Set(interfaceRegions[0].facetIndices.flatMap(
    index => model.boundaryFacets.connectivity[index]))].sort((a, b) => a - b);
  const secondNodes = [...new Set(interfaceRegions[1].facetIndices.flatMap(
    index => model.boundaryFacets.connectivity[index]))].sort((a, b) => a - b);
  if (digest(interfaceNodes) !== digest(secondNodes)) fail('interface nodes not shared');
  const areaMm2 = interfaceRegions[0].facetIndices.reduce((sum, index) =>
    sum + quadraticTriangleSurfaceSamples(model.boundaryFacets.connectivity[index]
      .map(node => model.nodes[node])).reduce((total, sample) =>
      total + sample.areaWeightMm2, 0), 0);
  const expectedAreaMm2 = r.model.interface.areaM2 * 1e6;
  if (Math.abs(areaMm2 - expectedAreaMm2) > expectedAreaMm2 * 1e-6)
    fail('incomplete interface area');
  for (const [index, domain] of model.domainRegions.entries()) {
    if (domain.domainId !== domains[index].domainId
      || domain.elementIndices.length !== localMeshes[index].volumeElements.connectivity.length
      || domain.nodeIndices.some(node => !model.volumeElements.connectivity
        .some((cell, element) => domain.elementIndices.includes(element) && cell.includes(node))))
      fail('domain element/node ownership mismatch');
  }
  const stableMesh = { nodes: model.nodes, cells: model.volumeElements,
    boundaryFacets: model.boundaryFacets, domains: model.domainRegions.map(d => ({
      domainId: d.domainId, geometryDigest: d.geometryDigest, materialId: d.materialId,
      elementIndices: d.elementIndices, nodeIndices: d.nodeIndices })),
    interfaceFacetKeys: facetKeys[0] };
  return { model, meshDigest: digest(stableMesh),
    interfaceEvidence: { facetCount: facetKeys[0].length, sharedNodeCount: interfaceNodes.length,
      areaMm2, sharedFacetDigest: digest(facetKeys[0]), sharedNodeDigest: digest(interfaceNodes) } };
}
