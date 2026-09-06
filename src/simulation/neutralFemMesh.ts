import {
  NEUTRAL_FEM_MESH_SCHEMA,
  type NeutralFemMesh,
  type NeutralMeshJobRequest,
  type NeutralSimulationRequest,
  type NeutralVector3,
} from './externalSimulationContracts.ts';

export function createNeutralMeshJobRequest(request: NeutralSimulationRequest): NeutralMeshJobRequest {
  return {
    schema: 'tunacad-neutral-mesh-request/1.0',
    studyId: request.studyId,
    requestDigest: request.requestDigest,
    projectRevision: request.geometry.projectRevision,
    geometryDigest: request.geometry.geometryDigest,
    coordinateSpace: request.geometry.coordinateSpace,
    units: request.units.geometry,
    mesh: structuredClone(request.mesh),
    boundaryRegions: request.geometry.references.map((binding, index) => ({
      regionId: `boundary_region_${String(index + 1).padStart(3, '0')}`,
      role: binding.role,
      semanticReferenceId: binding.semanticReferenceId,
      sourceFeatureId: binding.sourceFeatureId,
      face: structuredClone(binding.face),
    })),
  };
}

export function validateNeutralFemMesh(mesh: NeutralFemMesh, request: NeutralMeshJobRequest): void {
  if (mesh.schema !== NEUTRAL_FEM_MESH_SCHEMA
    || mesh.requestDigest !== request.requestDigest
    || mesh.projectRevision !== request.projectRevision
    || mesh.geometryDigest !== request.geometryDigest
    || mesh.coordinateSpace !== request.coordinateSpace
    || mesh.units !== request.units) {
    throw meshError('SIMULATION_MESH_IDENTITY_INVALID', 'The neutral mesh identity does not match the approved revision-bound request.');
  }
  if (mesh.element.family !== 'tetrahedral' || mesh.element.solutionOrder !== request.mesh.order) {
    throw meshError('SIMULATION_MESH_ELEMENT_UNSUPPORTED', 'The mesh does not provide the requested tetrahedral solution order.');
  }
  const expectedWidth = mesh.element.geometryOrder === 2 ? 10 : 4;
  if (mesh.nodes.length === 0 || mesh.volumeElements.connectivity.length === 0
    || mesh.volumeElements.regionIds.length !== mesh.volumeElements.connectivity.length
    || mesh.boundaryFacets.regionIds.length !== mesh.boundaryFacets.connectivity.length) {
    throw meshError('SIMULATION_MESH_EMPTY', 'The neutral FEM mesh is empty or has inconsistent region arrays.');
  }
  if (mesh.nodes.length > request.mesh.maximumNodes || mesh.volumeElements.connectivity.length > request.mesh.maximumElements) {
    throw meshError('SIMULATION_MESH_BUDGET_EXCEEDED', 'The neutral FEM mesh exceeds the requested node or element budget.');
  }
  for (const point of mesh.nodes) requireVector(point, 'mesh node');
  for (const cell of mesh.volumeElements.connectivity) requireConnectivity(cell, expectedWidth, mesh.nodes.length, 'volume element');
  const facetWidth = mesh.element.geometryOrder === 2 ? 6 : 3;
  for (const facet of mesh.boundaryFacets.connectivity) requireConnectivity(facet, facetWidth, mesh.nodes.length, 'boundary facet');

  const required = new Map(request.boundaryRegions.map((region) => [region.regionId, region]));
  for (const region of mesh.boundaryRegions) {
    const expected = required.get(region.regionId);
    if (!expected || region.match.state !== 'verified' || region.match.candidateCount !== 1
      || !region.semanticReferenceIds.includes(expected.semanticReferenceId)
      || region.facetIndices.length === 0) {
      throw meshError('SIMULATION_FACE_MAPPING_INVALID', `Boundary region "${region.regionId}" is missing, ambiguous, or not bound to the requested durable FACE.`);
    }
    for (const facetIndex of region.facetIndices) {
      if (!Number.isInteger(facetIndex) || facetIndex < 0 || facetIndex >= mesh.boundaryFacets.connectivity.length
        || mesh.boundaryFacets.regionIds[facetIndex] !== region.regionId) {
        throw meshError('SIMULATION_FACE_MAPPING_INVALID', `Boundary region "${region.regionId}" contains an invalid surface-facet mapping.`);
      }
    }
    required.delete(region.regionId);
  }
  if (required.size > 0) {
    throw meshError('SIMULATION_FACE_MAPPING_NOT_FOUND', `Required durable FACE regions were not mapped: ${[...required.keys()].join(', ')}.`);
  }

  const quality = mesh.quality;
  if (quality.invalidElementCount !== 0 || quality.nodeCount !== mesh.nodes.length
    || quality.elementCount !== mesh.volumeElements.connectivity.length
    || quality.boundaryFacetCount !== mesh.boundaryFacets.connectivity.length
    || !Number.isFinite(quality.minimum) || quality.minimum < request.mesh.minimumQuality
    || !Number.isFinite(quality.average) || quality.average < quality.minimum
    || !Number.isFinite(quality.volumeRelativeError) || quality.volumeRelativeError > 0.05) {
    throw meshError('SIMULATION_MESH_QUALITY_INVALID', 'The neutral FEM mesh failed its quality, count, or CAD-volume validation gate.');
  }
}

export function tetraMeanRatio(points: [NeutralVector3, NeutralVector3, NeutralVector3, NeutralVector3]): number {
  const [a, b, c, d] = points;
  const matrix = [subtract(b, a), subtract(c, a), subtract(d, a)] as const;
  const volume = Math.abs(determinant(matrix)) / 6;
  const edges: Array<[NeutralVector3, NeutralVector3]> = [[a, b], [a, c], [a, d], [b, c], [b, d], [c, d]];
  const edgeSquared = edges.reduce((sum, [p, q]) => sum + squaredLength(subtract(p, q)), 0);
  return edgeSquared > 0 ? 12 * Math.pow(3 * volume, 2 / 3) / edgeSquared : 0;
}

export function tetraVolume(points: [NeutralVector3, NeutralVector3, NeutralVector3, NeutralVector3]): number {
  const [a, b, c, d] = points;
  return Math.abs(determinant([subtract(b, a), subtract(c, a), subtract(d, a)])) / 6;
}

function requireVector(value: unknown, label: string): asserts value is NeutralVector3 {
  if (!Array.isArray(value) || value.length !== 3 || value.some((entry) => !Number.isFinite(entry))) {
    throw meshError('SIMULATION_MESH_INVALID', `A ${label} contains non-finite coordinates.`);
  }
}

function requireConnectivity(value: number[], width: number, nodeCount: number, label: string): void {
  if (!Array.isArray(value) || value.length !== width
    || new Set(value).size !== width
    || value.some((entry) => !Number.isInteger(entry) || entry < 0 || entry >= nodeCount)) {
    throw meshError('SIMULATION_MESH_INVALID', `A ${label} has invalid neutral connectivity.`);
  }
}

function subtract(a: NeutralVector3, b: NeutralVector3): NeutralVector3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function squaredLength(a: NeutralVector3): number {
  return a[0] ** 2 + a[1] ** 2 + a[2] ** 2;
}

function determinant(columns: readonly [NeutralVector3, NeutralVector3, NeutralVector3]): number {
  const [a, b, c] = columns;
  return a[0] * (b[1] * c[2] - b[2] * c[1])
    - b[0] * (a[1] * c[2] - a[2] * c[1])
    + c[0] * (a[1] * b[2] - a[2] * b[1]);
}

function meshError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
