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

export interface QuadraticTriangleSurfaceSample {
  positionMm: NeutralVector3;
  /** Oriented differential-area vector, including the quadrature weight. */
  areaVectorMm2: NeutralVector3;
  areaWeightMm2: number;
  shapeFunctions: [number, number, number, number, number, number];
}

export interface QuadraticTetraVolumeSample {
  volumeWeightMm3: number;
  shapeFunctions: number[];
}

/** Four-point tetrahedral quadrature for a ten-node isoparametric tetrahedron.
 * It preserves curved midside geometry and supplies the shape functions needed
 * for consistent body loads. */
export function quadraticTetraVolumeSamples(points: NeutralVector3[]): QuadraticTetraVolumeSample[] {
  if (points.length !== 10 || points.some(point => point.length !== 3 || point.some(value => !Number.isFinite(value)))) {
    throw meshError('SIMULATION_MESH_ELEMENT_UNSUPPORTED', 'C3D10 volume integration requires ten finite neutral nodes.');
  }
  const a = 0.5854101966249685;
  const b = 0.1381966011250105;
  const barycentricPoints: NeutralVector3[] = [[b, b, b], [a, b, b], [b, a, b], [b, b, a]];
  let orientation = 0;
  return barycentricPoints.map(([r, s, t]) => {
    const barycentric = [1 - r - s - t, r, s, t];
    const shapeFunctions = barycentric.map(value => value * (2 * value - 1));
    for (const [node, i, j] of [[4, 0, 1], [5, 1, 2], [6, 2, 0], [7, 0, 3], [8, 2, 3], [9, 1, 3]] as const) {
      shapeFunctions[node] = 4 * barycentric[i] * barycentric[j];
    }
    const derivatives = [[-1, 1, 0, 0], [-1, 0, 1, 0], [-1, 0, 0, 1]];
    const gradients = derivatives.map(derivative => {
      const result = barycentric.map((value, index) => (4 * value - 1) * derivative[index]);
      for (const [node, i, j] of [[4, 0, 1], [5, 1, 2], [6, 2, 0], [7, 0, 3], [8, 2, 3], [9, 1, 3]] as const) {
        result[node] = 4 * (derivative[i] * barycentric[j] + barycentric[i] * derivative[j]);
      }
      return result;
    });
    const columns = gradients.map(gradient => interpolate(points, gradient)) as [NeutralVector3, NeutralVector3, NeutralVector3];
    const jacobian = determinant(columns);
    if (!Number.isFinite(jacobian) || Math.abs(jacobian) <= 1e-18) throw meshError('SIMULATION_MESH_INVALID', 'C3D10 volume integration encountered a singular Jacobian.');
    const sign = Math.sign(jacobian);
    if (orientation && sign !== orientation) throw meshError('SIMULATION_MESH_INVALID', 'C3D10 volume integration encountered an inverted element.');
    orientation = sign;
    return { volumeWeightMm3: Math.abs(jacobian) / 24, shapeFunctions };
  });
}

export function quadraticTetraVolume(points: NeutralVector3[]): number {
  return quadraticTetraVolumeSamples(points).reduce((sum, sample) => sum + sample.volumeWeightMm3, 0);
}

/** Seven-point, degree-five integration of a six-node isoparametric triangle.
 * Connectivity is corners (0,1,2), then edge nodes (0-1,1-2,2-0), matching
 * the neutral Gmsh triangle-6 convention. Curved areas, centroids, normals,
 * and consistent tractions must use all six nodes rather than planar chords. */
export function quadraticTriangleSurfaceSamples(points: NeutralVector3[]): QuadraticTriangleSurfaceSample[] {
  if (points.length !== 6 || points.some(point => point.length !== 3 || point.some(value => !Number.isFinite(value)))) {
    throw meshError('SIMULATION_MESH_ELEMENT_UNSUPPORTED', 'Quadratic surface integration requires six finite triangle nodes.');
  }
  const quadrature = [
    [1 / 3, 1 / 3, 0.1125],
    [0.470142064105115, 0.470142064105115, 0.066197076394253],
    [0.059715871789770, 0.470142064105115, 0.066197076394253],
    [0.470142064105115, 0.059715871789770, 0.066197076394253],
    [0.101286507323456, 0.101286507323456, 0.062969590272414],
    [0.797426985353087, 0.101286507323456, 0.062969590272414],
    [0.101286507323456, 0.797426985353087, 0.062969590272414],
  ] as const;
  return quadrature.map(([r, s, weight]) => {
    const l1 = 1 - r - s;
    const shapeFunctions: QuadraticTriangleSurfaceSample['shapeFunctions'] = [
      l1 * (2 * l1 - 1), r * (2 * r - 1), s * (2 * s - 1), 4 * l1 * r, 4 * r * s, 4 * s * l1,
    ];
    const derivativeR = [-(4 * l1 - 1), 4 * r - 1, 0, 4 * (l1 - r), 4 * s, -4 * s];
    const derivativeS = [-(4 * l1 - 1), 0, 4 * s - 1, -4 * r, 4 * r, 4 * (l1 - s)];
    const positionMm = interpolate(points, shapeFunctions);
    const tangentR = interpolate(points, derivativeR);
    const tangentS = interpolate(points, derivativeS);
    const rawAreaVector = cross(tangentR, tangentS);
    const jacobian = Math.hypot(...rawAreaVector);
    if (!Number.isFinite(jacobian) || jacobian <= 1e-18) throw meshError('SIMULATION_MESH_INVALID', 'Quadratic boundary triangle has a singular surface Jacobian.');
    const areaVectorMm2 = rawAreaVector.map(value => value * weight) as NeutralVector3;
    return { positionMm, areaVectorMm2, areaWeightMm2: jacobian * weight, shapeFunctions };
  });
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

function interpolate(points: NeutralVector3[], weights: readonly number[]): NeutralVector3 {
  return [0, 1, 2].map(axis => points.reduce((sum, point, index) => sum + point[axis] * weights[index], 0)) as NeutralVector3;
}

function cross(a: NeutralVector3, b: NeutralVector3): NeutralVector3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
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
