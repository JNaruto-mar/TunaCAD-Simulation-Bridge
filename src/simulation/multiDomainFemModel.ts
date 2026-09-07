import {
  NEUTRAL_MESH_REQUEST_V2_SCHEMA,
  type NeutralFemMesh,
  type NeutralFemModelV2,
  type NeutralMeshJobRequestV2,
  type NeutralSimulationRequestV2,
  type NeutralVector3,
} from './externalSimulationContracts.ts';

export function createNeutralMeshJobRequestV2(request: NeutralSimulationRequestV2): NeutralMeshJobRequestV2 {
  const assignments = new Map(request.materialAssignments.map(assignment => [assignment.domainId, assignment]));
  return {
    schema: NEUTRAL_MESH_REQUEST_V2_SCHEMA,
    studyId: request.studyId,
    requestDigest: request.requestDigest,
    projectRevision: request.model.projectRevision,
    modelDigest: request.model.modelDigest,
    coordinateSpace: request.model.coordinateSpace,
    units: request.units.geometry,
    mesh: structuredClone(request.mesh),
    domains: request.model.domains.map(domain => {
      const assignment = assignments.get(domain.domainId);
      if (!assignment) throw multiDomainError('SIMULATION_MATERIAL_ASSIGNMENT_INVALID', `Domain "${domain.domainId}" has no material assignment.`);
      return {
        domainId: domain.domainId, partId: domain.partId, bodyId: domain.bodyId, occurrenceId: domain.occurrenceId,
        geometryDigest: domain.geometryDigest, domainDigest: domain.domainDigest,
        transformToAnalysis: structuredClone(domain.transformToAnalysis), volumeRegionId: assignment.volumeRegionId,
        materialId: assignment.materialId, shape: structuredClone(domain.shape),
      };
    }),
    boundaryRegions: request.model.references.map((binding, index) => ({
      regionId: `boundary_region_${String(index + 1).padStart(3, '0')}`,
      domainId: binding.domainId, role: binding.role, semanticReferenceId: binding.semanticReferenceId,
      sourceFeatureId: binding.sourceFeatureId, faceOwnerLocal: structuredClone(binding.faceOwnerLocal),
    })),
  };
}

export interface MeshedDomainV2 {
  domainId: string;
  mesh: NeutralFemMesh;
}

export function composeNeutralFemModelV2(
  request: NeutralMeshJobRequestV2,
  meshedDomains: MeshedDomainV2[],
  provenance: { adapterId: string; adapterVersion: string; engine: string; engineVersion: string; optionsDigest: string },
): NeutralFemModelV2 {
  const supplied = new Map(meshedDomains.map(entry => [entry.domainId, entry.mesh]));
  if (supplied.size !== meshedDomains.length || supplied.size !== request.domains.length
    || request.domains.some(domain => !supplied.has(domain.domainId))) {
    throw multiDomainError('SIMULATION_MESH_DOMAIN_MAPPING_INVALID', 'Exactly one local mesh is required for every admitted domain.');
  }
  const nodes: NeutralVector3[] = [];
  const connectivity: number[][] = [];
  const elementDomainIds: string[] = [];
  const materialIds: string[] = [];
  const volumeRegionIds: string[] = [];
  const boundaryConnectivity: number[][] = [];
  const boundaryDomainIds: string[] = [];
  const boundaryRegionIds: string[] = [];
  const domainRegions: NeutralFemModelV2['domainRegions'] = [];
  const boundaryRegions: NeutralFemModelV2['boundaryRegions'] = [];
  const perDomain: NeutralFemModelV2['quality']['perDomain'] = [];

  for (const domain of request.domains) {
    const mesh = supplied.get(domain.domainId)!;
    if (mesh.requestDigest !== request.requestDigest || mesh.projectRevision !== request.projectRevision
      || mesh.geometryDigest !== domain.geometryDigest || mesh.coordinateSpace !== 'part_definition_local') {
      throw multiDomainError('SIMULATION_MESH_DOMAIN_IDENTITY_INVALID', `Local mesh identity does not match domain "${domain.domainId}".`);
    }
    const nodeOffset = nodes.length;
    const elementOffset = connectivity.length;
    const facetOffset = boundaryConnectivity.length;
    nodes.push(...mesh.nodes.map(point => transformPoint(domain.transformToAnalysis, point)));
    connectivity.push(...mesh.volumeElements.connectivity.map(cell => cell.map(node => node + nodeOffset)));
    elementDomainIds.push(...mesh.volumeElements.connectivity.map(() => domain.domainId));
    materialIds.push(...mesh.volumeElements.connectivity.map(() => domain.materialId));
    volumeRegionIds.push(...mesh.volumeElements.connectivity.map(() => domain.volumeRegionId));
    boundaryConnectivity.push(...mesh.boundaryFacets.connectivity.map(facet => facet.map(node => node + nodeOffset)));
    boundaryDomainIds.push(...mesh.boundaryFacets.connectivity.map(() => domain.domainId));
    boundaryRegionIds.push(...mesh.boundaryFacets.regionIds);
    domainRegions.push({
      domainId: domain.domainId, partId: domain.partId, bodyId: domain.bodyId, occurrenceId: domain.occurrenceId,
      domainDigest: domain.domainDigest, geometryDigest: domain.geometryDigest, materialId: domain.materialId,
      volumeRegionId: domain.volumeRegionId, transformToAnalysis: structuredClone(domain.transformToAnalysis),
      elementIndices: mesh.volumeElements.connectivity.map((_, index) => elementOffset + index),
      nodeIndices: mesh.nodes.map((_, index) => nodeOffset + index),
    });
    boundaryRegions.push(...mesh.boundaryRegions.map(region => ({
      regionId: region.regionId, domainId: domain.domainId,
      semanticReferenceIds: [...region.semanticReferenceIds], sourceFeatureIds: [...region.sourceFeatureIds],
      facetIndices: region.facetIndices.map(index => index + facetOffset),
      matchedCadFaceOwnerLocal: structuredClone(region.matchedCadFace), match: structuredClone(region.match),
    })));
    perDomain.push({
      domainId: domain.domainId, nodeCount: mesh.quality.nodeCount, elementCount: mesh.quality.elementCount,
      cadVolumeMm3: domain.shape.volumeMm3, meshVolumeMm3: mesh.quality.meshVolumeMm3,
      volumeRelativeError: Math.abs(mesh.quality.meshVolumeMm3 - domain.shape.volumeMm3) / domain.shape.volumeMm3,
      minimum: mesh.quality.minimum, average: mesh.quality.average, invalidElementCount: 0,
    });
  }
  const cadVolumeMm3 = perDomain.reduce((sum, domain) => sum + domain.cadVolumeMm3, 0);
  const meshVolumeMm3 = perDomain.reduce((sum, domain) => sum + domain.meshVolumeMm3, 0);
  const elementCount = connectivity.length;
  return {
    schema: 'tunacad-neutral-fem-model/2.0', modelId: `femmodel_${crypto.randomUUID()}`,
    requestDigest: request.requestDigest, projectRevision: request.projectRevision, modelDigest: request.modelDigest,
    coordinateSpace: 'frozen_analysis', units: 'mm', element: { family: 'tetrahedral', geometryOrder: 2, solutionOrder: 2 }, nodes,
    volumeElements: { connectivity, domainIds: elementDomainIds, materialIds, volumeRegionIds },
    boundaryFacets: { connectivity: boundaryConnectivity, domainIds: boundaryDomainIds, regionIds: boundaryRegionIds },
    domainRegions, boundaryRegions,
    quality: {
      metric: 'mean_ratio', minimum: Math.min(...perDomain.map(domain => domain.minimum)),
      average: perDomain.reduce((sum, domain) => sum + domain.average * domain.elementCount, 0) / elementCount,
      invalidElementCount: 0, nodeCount: nodes.length, elementCount, boundaryFacetCount: boundaryConnectivity.length,
      cadVolumeMm3, meshVolumeMm3, volumeRelativeError: Math.abs(meshVolumeMm3 - cadVolumeMm3) / cadVolumeMm3, perDomain,
    },
    provenance: {
      meshProviderInterfaceVersion: '2.0', adapterId: provenance.adapterId, adapterVersion: provenance.adapterVersion,
      engine: provenance.engine, engineVersion: provenance.engineVersion, optionsDigest: provenance.optionsDigest,
      inputGeometryDigest: request.modelDigest, generatedAt: new Date().toISOString(),
    },
  };
}

function transformPoint(matrix: readonly number[], point: NeutralVector3): NeutralVector3 {
  const transformed = [0, 1, 2].map(row => matrix[row * 4] * point[0] + matrix[row * 4 + 1] * point[1]
    + matrix[row * 4 + 2] * point[2] + matrix[row * 4 + 3]) as NeutralVector3;
  if (transformed.some(value => !Number.isFinite(value))) throw multiDomainError('SIMULATION_TRANSFORM_INVALID', 'A domain transform produced non-finite analysis coordinates.');
  return transformed;
}

function multiDomainError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
