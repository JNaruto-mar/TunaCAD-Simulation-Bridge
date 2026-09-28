import type { NeutralFemMesh, NeutralMeshJobRequest, NeutralVector3, SimulationGeometryResolver } from '../../src/simulation/externalSimulationContracts.ts';
import { quadraticTetraVolumeSamples, quadraticTriangleSurfaceSamples, validateNeutralFemMesh } from '../../src/simulation/neutralFemMesh.ts';
import { validateElectrostaticFoundation, type ElectrostaticFoundation } from '../../simulation-bridge/electrostaticFoundation.mts';
import { digest } from '../../simulation-bridge/stableDigest.mts';
import { neutralToCalculiXC3D10 } from './CalculiXMultiDomainDeck.mts';

export const ELECTROSTATIC_SLAB_LIMITS = Object.freeze({
  maximumNodes: 8000, maximumElements: 4000, maximumOutputBytes: 8 * 1024 * 1024,
  maximumPotentialErrorV: 0.002, fieldRelativeTolerance: 1e-4,
  chargeRelativeTolerance: 1e-4, energyRelativeTolerance: 1e-4,
});
const reactionNames = ['ELECTRODE_LEFT', 'ELECTRODE_RIGHT'] as const;
const faceKeys = ['xMin', 'xMax', 'yMin', 'yMax', 'zMin', 'zMax'] as const;
const edges = [[0, 1], [1, 2], [2, 0], [0, 3], [2, 3], [1, 3]];
const fail = (message: string): never => { throw new Error('ELECTROSTATIC_SLAB_INVALID: ' + message); };
const near = (actual: number, expected: number, relative: number, floor: number, label: string) => {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > Math.max(Math.abs(expected) * relative, floor)) fail(label);
};
const number = (value: number) => Number(value.toPrecision(15)).toString();
const ids = (values: number[]) => Array.from({ length: Math.ceil(values.length / 16) },
  (_, row) => values.slice(row * 16, row * 16 + 16).map(value => value + 1).join(','));

/** Meshing only. No thermal or electrical solver admission is implied. */
export function electrostaticSlabMeshInputs(value: unknown, globalSizeMm = 2) {
  const request = validateElectrostaticFoundation(value);
  if (!Number.isFinite(globalSizeMm) || globalSizeMm < 0.1 || globalSizeMm > 3) fail('mesh size');
  const domain = request.model.domains[0];
  const shape = domain.shape;
  const sizes = [shape.lengthM, shape.widthM, shape.heightM].map(value => value * 1000) as NeutralVector3;
  const [length, width, height] = sizes;
  const boundaryRegions = faceKeys.map((key, index) => {
    const axis = Math.floor(index / 2); const upper = index % 2 === 1;
    const center = sizes.map(value => value / 2) as NeutralVector3;
    center[axis] = upper ? sizes[axis] : 0;
    const min = [0, 0, 0] as NeutralVector3; const max = [...sizes] as NeutralVector3;
    min[axis] = center[axis]; max[axis] = center[axis];
    const normal = [0, 0, 0] as NeutralVector3; normal[axis] = upper ? 1 : -1;
    return {
      regionId: 'electrical_face_' + key, role: 'constraint' as const,
      semanticReferenceId: shape.faces[key], sourceFeatureId: null,
      face: { centroidPartLocalMm: center, areaMm2: sizes[(axis + 1) % 3] * sizes[(axis + 2) % 3],
        outwardDirection: normal, geometryType: 'plane', edgeCount: 4,
        boundingBoxMm: { min, max } },
    };
  });
  const meshRequest: NeutralMeshJobRequest = {
    schema: 'tunacad-neutral-mesh-request/1.0', studyId: request.studyId,
    requestDigest: request.requestDigest, projectRevision: request.model.projectRevision,
    geometryDigest: domain.geometryDigest, coordinateSpace: 'part_definition_local', units: 'mm',
    mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2, globalSizeMm,
      minimumSizeMm: globalSizeMm / 4, maximumNodes: ELECTROSTATIC_SLAB_LIMITS.maximumNodes,
      maximumElements: ELECTROSTATIC_SLAB_LIMITS.maximumElements,
      qualityMetric: 'provider_normalized', minimumQuality: 0.01 },
    boundaryRegions,
  };
  const descriptor: SimulationGeometryResolver['descriptor'] = {
    projectRevision: request.model.projectRevision, partId: domain.partId, bodyId: domain.bodyId,
    geometryDigest: domain.geometryDigest, coordinateSpace: 'part_definition_local',
    shape: { valid: true, connectedSolidCount: 1, faceCount: 6, edgeCount: 12,
      volumeMm3: length * width * height, surfaceAreaMm2: 2 * (length * width + width * height + length * height),
      boundingBoxMm: { min: [0, 0, 0], max: sizes, size: sizes } },
    references: boundaryRegions.map(region => ({ semanticReferenceId: region.semanticReferenceId,
      ownerPartId: domain.partId, geometryKind: 'FACE', role: 'constraint',
      sourceFeatureId: null, resolutionState: 'valid',
      resolvedAtProjectRevision: request.model.projectRevision, face: region.face })),
  };
  return { meshRequest, descriptor };
}

function bindMesh(request: ElectrostaticFoundation, mesh: NeutralFemMesh) {
  const { meshRequest } = electrostaticSlabMeshInputs(request);
  validateNeutralFemMesh(mesh, meshRequest);
  if (mesh.element.geometryOrder !== 2 || mesh.volumeRegions.length !== 1
    || mesh.boundaryRegions.length !== 6) fail('quadratic single-domain slab mesh required');
  const owned = mesh.volumeRegions[0].elementIndices;
  if (owned.length !== mesh.volumeElements.connectivity.length || new Set(owned).size !== owned.length
    || owned.some(element => !Number.isSafeInteger(element) || element < 0 || element >= owned.length)) fail('incomplete domain element ownership');
  const slab = request.model.domains[0].shape;
  const sizes = [slab.lengthM, slab.widthM, slab.heightM].map(value => value * 1000);
  for (const point of mesh.nodes) {
    if (point.some((value, axis) => value < -1e-7 || value > sizes[axis] + 1e-7)) fail('node outside slab');
  }
  const electrodeNodes: number[][] = [];
  for (const [index, key] of faceKeys.entries()) {
    const region = mesh.boundaryRegions.find(item => item.regionId === 'electrical_face_' + key)!;
    const axis = Math.floor(index / 2); const position = index % 2 ? sizes[axis] : 0;
    let area = 0;
    const nodes = new Set<number>();
    for (const facet of region.facetIndices) {
      const points = mesh.boundaryFacets.connectivity[facet].map(node => {
        nodes.add(node);
        if (Math.abs(mesh.nodes[node][axis] - position) > 1e-7) fail('wrong-face mesh mapping');
        return mesh.nodes[node];
      });
      area += quadraticTriangleSurfaceSamples(points).reduce((sum, sample) => sum + sample.areaWeightMm2, 0);
    }
    near(area, sizes[(axis + 1) % 3] * sizes[(axis + 2) % 3], 1e-7, 1e-8, 'incomplete FACE area');
    if (index < 2) electrodeNodes.push([...nodes].sort((a, b) => a - b));
  }
  if (electrodeNodes[0].some(node => electrodeNodes[1].includes(node))) fail('overlapping electrodes');
  let volumeMm3 = 0;
  const weights: number[][] = [];
  for (const cell of mesh.volumeElements.connectivity) {
    const points = cell.map(node => mesh.nodes[node]);
    // This first recovery integrates only straight-sided, affine quadratic tets.
    for (const [edge, [a, b]] of edges.entries()) {
      if (points[edge + 4].some((value, axis) =>
        Math.abs(value - (points[a][axis] + points[b][axis]) / 2) > 1e-7)) fail('curved tetrahedron unsupported');
    }
    const elementWeights = quadraticTetraVolumeSamples(points).map(sample => sample.volumeWeightMm3);
    weights.push(elementWeights);
    volumeMm3 += elementWeights.reduce((a, b) => a + b, 0);
  }
  near(volumeMm3, sizes[0] * sizes[1] * sizes[2], 1e-7, 1e-8, 'incomplete slab volume');
  return { electrodeNodes, weights, volumeMm3, meshDigest: digest(mesh) };
}

/** Provider-development helper only: no registered Bridge solver capability.
 * Native unknown = volts; normalized scalar conductivity = 1 per mm.
 * HFL*1000 = E[V/m]; RFL*epsilon/1000 = conductor Q[C]. */
export function createCalculiXElectrostaticSlabDeck(value: unknown, mesh: NeutralFemMesh) {
  const request = validateElectrostaticFoundation(value);
  const binding = bindMesh(request, mesh);
  const deck = [
    '*HEADING', 'TunaCAD bounded electrostatic slab; internal scalar analogy only',
    '*NODE, NSET=NALL',
    ...mesh.nodes.map((point, node) => String(node + 1) + ',' + point.map(number).join(',')),
    '*ELEMENT, TYPE=DC3D10, ELSET=EALL',
    ...mesh.volumeElements.connectivity.map((cell, element) =>
      String(element + 1) + ',' + neutralToCalculiXC3D10(cell).map(node => node + 1).join(',')),
    ...reactionNames.flatMap((name, index) => ['*NSET, NSET=' + name, ...ids(binding.electrodeNodes[index])]),
    '*MATERIAL, NAME=ELECTRICAL_SCALAR_NORMALIZATION', '*CONDUCTIVITY', '1',
    '*SOLID SECTION, ELSET=EALL, MATERIAL=ELECTRICAL_SCALAR_NORMALIZATION',
    '*STEP', '*HEAT TRANSFER, STEADY STATE', '1,1', '*BOUNDARY',
    ...reactionNames.map((name, index) => name + ',11,11,' + number(request.prescribedPotentials[index].potentialV)),
    '*NODE PRINT, NSET=NALL', 'NT',
    ...reactionNames.flatMap(name => ['*NODE PRINT, NSET=' + name, 'RFL']),
    '*EL PRINT, ELSET=EALL', 'HFL', '*END STEP',
  ].join('\n') + '\n';
  return { deck, deckDigest: digest(deck), meshDigest: binding.meshDigest };
}

type Vector = [number, number, number];
const cross = (a: number[], b: number[]): Vector =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const subtract = (a: number[], b: number[]): Vector => a.map((value, i) => value - b[i]) as Vector;
const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);
function tetraBasis(mesh: NeutralFemMesh, cell: number[]) {
  const p = mesh.nodes[cell[0]];
  const a = subtract(mesh.nodes[cell[1]], p);
  const b = subtract(mesh.nodes[cell[2]], p);
  const c = subtract(mesh.nodes[cell[3]], p);
  const determinant = dot(a, cross(b, c));
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-18) fail('degenerate tetrahedron');
  return { p, gradients: [cross(b, c), cross(c, a), cross(a, b)].map(v => v.map(x => x / determinant) as Vector) };
}

/** Bounded native .dat reader. Thermal names exist only in this private scalar
 * encoding; no thermal parser restrictions/units are inherited by electrical data. */
export function recoverCalculiXElectrostaticSlab(value: unknown, mesh: NeutralFemMesh, text: string) {
  const request = validateElectrostaticFoundation(value);
  const binding = bindMesh(request, mesh);
  if (Buffer.byteLength(text, 'utf8') > ELECTROSTATIC_SLAB_LIMITS.maximumOutputBytes) fail('output budget');
  const potentials = new Map<number, number>();
  const fluxes = new Map<string, Vector>();
  const reactions = [new Map<number, number>(), new Map<number, number>()];
  const blocks = new Set<string>();
  let mode: 'potential' | 'field' | 'reaction' | null = null; let electrode = -1;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.length > 4096) fail('record budget');
    const line = raw.trim();
    if (!line) continue;
    const header = /^(temperatures(?:\s*\([^)]*\))?|heat generation(?:\s*\([^)]*\))?|heat flux\s*\([^)]*\))\s+for set\s+([A-Z0-9_]+)\s+and time\s+([0-9.EeDd+-]+)$/i.exec(line);
    if (header) {
      const type = header[1].toLowerCase(); const set = header[2].toUpperCase();
      if (Number(header[3].replace(/[dD]/g, 'E')) !== 1) fail('incomplete/wrong solve frame');
      if (blocks.has(set + ':' + type)) fail('duplicate output block');
      blocks.add(set + ':' + type);
      electrode = reactionNames.indexOf(set as typeof reactionNames[number]);
      if (type.startsWith('temperatures') && set === 'NALL') mode = 'potential';
      else if (type.startsWith('heat flux') && set === 'EALL') mode = 'field';
      else if (type.startsWith('heat generation') && electrode >= 0) mode = 'reaction';
      else fail('wrong output FACE/set');
      continue;
    }
    if (!mode) fail('unrecognized output header');
    const tokens = line.split(/\s+/);
    if (tokens.length !== (mode === 'field' ? 5 : 2)) fail('malformed record');
    if (tokens.some(value => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[EeDd][+-]?\d+)?$/.test(value))) fail('malformed numeric encoding');
    const values = tokens.map(value => Number(value.replace(/[dD]/g, 'E')));
    if (values.some(value => !Number.isFinite(value)) || !Number.isSafeInteger(values[0])) fail('nonfinite/invalid record');
    const index = values[0] - 1;
    if (mode === 'potential') {
      if (index < 0 || index >= mesh.nodes.length || potentials.has(index)) fail('missing/duplicate/invalid node');
      potentials.set(index, values[1]);
    } else if (mode === 'reaction') {
      if (!binding.electrodeNodes[electrode].includes(index) || reactions[electrode].has(index)) fail('wrong-face/duplicate charge record');
      reactions[electrode].set(index, values[1]);
    } else {
      const ip = values[1]; const key = index + ':' + ip;
      if (index < 0 || index >= mesh.volumeElements.connectivity.length
        || !Number.isSafeInteger(ip) || ip < 1 || ip > 4 || fluxes.has(key)) fail('invalid/duplicate integration point');
      fluxes.set(key, values.slice(2) as Vector);
    }
  }
  if (blocks.size !== 4 || potentials.size !== mesh.nodes.length
    || fluxes.size !== mesh.volumeElements.connectivity.length * 4
    || reactions.some((values, i) => values.size !== binding.electrodeNodes[i].length)) fail('incomplete electrical output');
  const slab = request.model.domains[0].shape;
  const [left, right] = request.prescribedPotentials;
  const voltage = right.potentialV - left.potentialV;
  const epsilon = request.material.absolutePermittivityFPerM;
  const expectedField = -voltage / slab.lengthM;
  const nodalElectricPotential = mesh.nodes.map((point, node) => {
    const potentialV = potentials.get(node)!;
    near(potentialV, left.potentialV + voltage * point[0] / (1000 * slab.lengthM),
      0, ELECTROSTATIC_SLAB_LIMITS.maximumPotentialErrorV, 'inconsistent potential profile');
    return { nodeId: node + 1, positionM: point.map(value => value / 1000), electricPotentialV: potentialV };
  });
  let energyJ = 0; let meanFieldX = 0;
  const electricFields = mesh.volumeElements.connectivity.flatMap((cell, element) => {
    const basis = tetraBasis(mesh, cell);
    const gradient = [0, 1, 2].map(axis => basis.gradients.reduce((sum, vector, j) =>
      sum + vector[axis] * (potentials.get(cell[j + 1])! - potentials.get(cell[0])!), 0));
    for (const [edge, [a, b]] of edges.entries()) {
      near(potentials.get(cell[edge + 4])!, (potentials.get(cell[a])! + potentials.get(cell[b])!) / 2,
        0, ELECTROSTATIC_SLAB_LIMITS.maximumPotentialErrorV, 'inconsistent midside potential');
    }
    return [1, 2, 3, 4].map(ip => {
      const vector = fluxes.get(element + ':' + ip)!.map(value => value * 1000) as Vector;
      vector.forEach((value, axis) => {
        near(value, -gradient[axis] * 1000, ELECTROSTATIC_SLAB_LIMITS.fieldRelativeTolerance,
          Math.max(Math.abs(expectedField) * 1e-4, 1e-8), 'field/potential inconsistency');
        near(value, axis === 0 ? expectedField : 0, ELECTROSTATIC_SLAB_LIMITS.fieldRelativeTolerance,
          Math.max(Math.abs(expectedField) * 1e-4, 1e-8), 'inconsistent field vector');
      });
      const displacement = vector.map(value => epsilon * value) as Vector;
      const magnitude = Math.hypot(...vector);
      const weightM3 = binding.weights[element][ip - 1] * 1e-9;
      const density = 0.5 * dot(vector, displacement);
      energyJ += density * weightM3; meanFieldX += vector[0] * weightM3;
      return { elementId: element + 1, integrationPoint: ip, electricFieldVPerM: vector,
        electricFieldMagnitudeVPerM: magnitude, electricDisplacementCPerM2: displacement,
        electrostaticEnergyDensityJPerM3: density };
    });
  });
  meanFieldX /= binding.volumeMm3 * 1e-9;
  const areaM2 = slab.widthM * slab.heightM;
  const expectedChargeRight = epsilon * areaM2 * voltage / slab.lengthM;
  const electrodes = reactions.map((values, i) => {
    const chargeC = [...values.entries()].sort(([a], [b]) => a - b).reduce((sum, [, value]) => sum + value, 0) * epsilon / 1000;
    near(chargeC, i === 0 ? -expectedChargeRight : expectedChargeRight,
      ELECTROSTATIC_SLAB_LIMITS.chargeRelativeTolerance, 1e-24, 'inconsistent electrode charge');
    return { groupId: request.prescribedPotentials[i].groupId,
      faceId: request.prescribedPotentials[i].faceIds[0], chargeC };
  });
  const chargeBalanceC = electrodes[0].chargeC + electrodes[1].chargeC;
  near(chargeBalanceC, 0, 0, Math.max(Math.abs(expectedChargeRight) * 1e-4, 1e-24), 'charge imbalance');
  const fieldCapacitanceF = voltage === 0 ? epsilon * areaM2 / slab.lengthM : -epsilon * meanFieldX * areaM2 / voltage;
  const capacitanceF = voltage === 0 ? fieldCapacitanceF : electrodes[1].chargeC / voltage;
  near(capacitanceF, fieldCapacitanceF, 1e-4, 1e-24, 'charge/field capacitance inconsistency');
  const chargeEnergyJ = 0.5 * electrodes[1].chargeC * voltage;
  const expectedEnergyJ = 0.5 * epsilon * areaM2 / slab.lengthM * voltage ** 2;
  near(energyJ, expectedEnergyJ, ELECTROSTATIC_SLAB_LIMITS.energyRelativeTolerance, 1e-24, 'field energy inconsistent');
  near(energyJ, chargeEnergyJ, ELECTROSTATIC_SLAB_LIMITS.energyRelativeTolerance, 1e-24, 'charge energy inconsistent');
  const samples = request.output.normalizedAxialPositions.map(fraction => {
    const point = [slab.lengthM * fraction * 1000, slab.widthM * 500, slab.heightM * 500];
    for (const cell of mesh.volumeElements.connectivity) {
      const basis = tetraBasis(mesh, cell); const distance = subtract(point, basis.p);
      const coordinates = basis.gradients.map(gradient => dot(gradient, distance));
      const bary = [1 - coordinates.reduce((a, b) => a + b, 0), ...coordinates];
      if (bary.some(value => value < -1e-9 || value > 1 + 1e-9)) continue;
      const shape = [...bary.map(value => value * (2 * value - 1)), ...edges.map(([a, b]) => 4 * bary[a] * bary[b])];
      return { normalizedAxialPosition: fraction, electricPotentialV: shape.reduce((sum, weight, index) => sum + weight * potentials.get(cell[index])!, 0) };
    }
    return fail('sample outside mesh; extrapolation forbidden');
  });
  const result = {
    schema: 'tunacad-electrostatic-provider-fixture-result/0.1',
    analysisType: 'electrostatic', authority: 'provider_development_fixture_only',
    status: 'proof_of_concept', engineeringUsePermitted: false,
    providerAdmission: 'closed', requestDigest: request.requestDigest,
    projectRevision: request.model.projectRevision, domainId: request.model.domains[0].domainId,
    geometryDigest: request.model.domains[0].geometryDigest, meshDigest: binding.meshDigest,
    rawOutputDigest: digest(text), materialProvenance: request.material.source,
    units: request.output.units, nodalElectricPotential, electricFields, samples,
    electrodes, capacitanceF, electrostaticEnergyJ: energyJ,
    consistency: { netElectrodeChargeC: chargeBalanceC, fieldCapacitanceF,
      chargeEnergyJ, fieldMinusChargeEnergyJ: energyJ - chargeEnergyJ },
    recovery: { engine: 'CalculiX', engineVersion: '2.16',
      fieldOrigin: 'native_scalar_flux', chargeOrigin: 'native_electrode_reactions',
      electricDisplacementOrigin: 'declared_permittivity_times_recovered_field' },
  };
  return { ...result, resultDigest: digest(result) };
}
