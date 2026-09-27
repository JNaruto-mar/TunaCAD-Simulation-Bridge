import type { NeutralFemModelV2, NeutralVector3 } from '../src/simulation/externalSimulationContracts.ts';
import { quadraticTetraVolumeSamples } from '../src/simulation/neutralFemMesh.ts';
import { digest } from './stableDigest.mts';
import type { ExactThermalTransfer } from '../providers/calculix/CalculiXFreeThermalExpansion.mts';

export interface ProjectedThermalTransfer extends ExactThermalTransfer {
  method: 'quadratic_tetra_barycentric';
  sourceNodeCount: number;
  sourceElementCount: number;
  targetElementCount: number;
  sourceVolumeMm3: number;
  targetVolumeMm3: number;
  sourceIntegratedTemperatureRiseKmm3: number;
  targetIntegratedTemperatureRiseKmm3: number;
  conservationErrorKmm3: number;
}

/** Bounded straight-sided C3D10 projection. Every target node must be inside
 * a source tetrahedron. The four corner barycentric coordinates locate the
 * point; all ten quadratic shape functions interpolate its temperature.
 * Nonconserved or incomplete transfers fail instead of silently correcting
 * the field or extrapolating across geometry. */
export function projectThermalFieldBetweenMeshes(
  source: NeutralFemModelV2,
  target: NeutralFemModelV2,
  temperaturesByNode: Map<number, number>,
  referenceTemperatureC: number,
): ProjectedThermalTransfer {
  if (source.modelId === target.modelId || source.modelDigest !== target.modelDigest
    || source.projectRevision !== target.projectRevision || source.domainRegions.length !== 1 || target.domainRegions.length !== 1
    || source.domainRegions[0].geometryDigest !== target.domainRegions[0].geometryDigest
    || source.domainRegions[0].materialId !== target.domainRegions[0].materialId
    || digest({ nodes: source.nodes, connectivity: source.volumeElements.connectivity })
      === digest({ nodes: target.nodes, connectivity: target.volumeElements.connectivity })
    || source.element.geometryOrder !== 2 || target.element.geometryOrder !== 2
    || source.element.solutionOrder !== 2 || target.element.solutionOrder !== 2
    || temperaturesByNode.size !== source.nodes.length || !Number.isFinite(referenceTemperatureC)) {
    throw new Error('SIMULATION_THERMAL_TRANSFER_MESH_MISMATCH');
  }
  const sourceTemperatures = source.nodes.map((_point, node) => {
    const value = temperaturesByNode.get(node);
    if (value === undefined || !Number.isFinite(value) || value < -273.15 || value > 1e6) {
      throw new Error('SIMULATION_THERMAL_TRANSFER_FIELD_INVALID');
    }
    return value;
  });
  const sourceCells = source.volumeElements.connectivity.map(cell => {
    if (cell.length !== 10 || new Set(cell).size !== 10
      || cell.some(node => !Number.isSafeInteger(node) || node < 0 || node >= source.nodes.length)) {
      throw new Error('SIMULATION_THERMAL_TRANSFER_ELEMENT_INVALID');
    }
    const corners = cell.slice(0, 4).map(node => source.nodes[node]);
    if (corners.some(point => !point || point.some(value => !Number.isFinite(value)))) throw new Error('SIMULATION_THERMAL_TRANSFER_ELEMENT_INVALID');
    const edges = [[0, 1], [1, 2], [2, 0], [0, 3], [2, 3], [1, 3]];
    if (edges.some(([a, b], index) => source.nodes[cell[index + 4]].some((value, axis) =>
      Math.abs(value - (corners[a][axis] + corners[b][axis]) / 2) > 1e-5))) {
      throw new Error('SIMULATION_THERMAL_TRANSFER_CURVED_ELEMENT_UNSUPPORTED');
    }
    return { cell, corners: corners as [NeutralVector3, NeutralVector3, NeutralVector3, NeutralVector3] };
  });
  const targetTemperatures = target.nodes.map(point => {
    if (point.some(value => !Number.isFinite(value))) throw new Error('SIMULATION_THERMAL_TRANSFER_TARGET_INVALID');
    for (const { cell, corners } of sourceCells) {
      const barycentric = tetraBarycentric(point, corners);
      if (!barycentric || barycentric.some(value => value < -1e-7 || value > 1 + 1e-7)) continue;
      const bounded = barycentric.map(value => Math.max(0, Math.min(1, value)));
      const total = bounded.reduce((sum, value) => sum + value, 0);
      const l = bounded.map(value => value / total);
      const shape = l.map(value => value * (2 * value - 1));
      for (const [node, a, b] of [[4, 0, 1], [5, 1, 2], [6, 2, 0], [7, 0, 3], [8, 2, 3], [9, 1, 3]] as const) {
        shape[node] = 4 * l[a] * l[b];
      }
      return shape.reduce((sum, weight, local) => sum + weight * sourceTemperatures[cell[local]], 0);
    }
    throw new Error('SIMULATION_THERMAL_TRANSFER_TARGET_OUTSIDE_SOURCE');
  });
  const sourceMinimum = Math.min(...sourceTemperatures); const sourceMaximum = Math.max(...sourceTemperatures);
  if (targetTemperatures.some(value => !Number.isFinite(value) || value < sourceMinimum - .05 || value > sourceMaximum + .05)) {
    throw new Error('SIMULATION_THERMAL_TRANSFER_EXTREMA_INVALID');
  }
  const sourceIntegral = integrateTemperatureRise(source, sourceTemperatures, referenceTemperatureC);
  const targetIntegral = integrateTemperatureRise(target, targetTemperatures, referenceTemperatureC);
  const conservationErrorKmm3 = Math.abs(sourceIntegral.contentKmm3 - targetIntegral.contentKmm3);
  if (Math.abs(sourceIntegral.volumeMm3 - targetIntegral.volumeMm3) > Math.max(1e-6, sourceIntegral.volumeMm3 * 1e-5)
    || conservationErrorKmm3 > Math.max(1e-5, Math.abs(sourceIntegral.contentKmm3) * 1e-5)) {
    throw new Error('SIMULATION_THERMAL_TRANSFER_CONSERVATION_INVALID');
  }
  return {
    method: 'quadratic_tetra_barycentric',
    sourceModelId: source.modelId, targetModelId: target.modelId,
    nodeCount: target.nodes.length, sourceNodeCount: source.nodes.length,
    sourceElementCount: source.volumeElements.connectivity.length,
    targetElementCount: target.volumeElements.connectivity.length,
    temperatureDigest: digest(targetTemperatures),
    temperatureSumC: targetTemperatures.reduce((sum, value) => sum + value, 0),
    temperaturesByNodeC: new Map(targetTemperatures.map((temperatureC, node) => [node, temperatureC])),
    sourceVolumeMm3: sourceIntegral.volumeMm3, targetVolumeMm3: targetIntegral.volumeMm3,
    sourceIntegratedTemperatureRiseKmm3: sourceIntegral.contentKmm3,
    targetIntegratedTemperatureRiseKmm3: targetIntegral.contentKmm3,
    conservationErrorKmm3,
  };
}

export function integrateTemperatureRise(model: NeutralFemModelV2, temperatures: number[], referenceC: number) {
  let volumeMm3 = 0; let contentKmm3 = 0;
  for (const cell of model.volumeElements.connectivity) {
    if (cell.length !== 10 || cell.some(node => node < 0 || node >= temperatures.length)) {
      throw new Error('SIMULATION_THERMAL_TRANSFER_ELEMENT_INVALID');
    }
    const samples = quadraticTetraVolumeSamples(cell.map(node => model.nodes[node]));
    for (const sample of samples) {
      volumeMm3 += sample.volumeWeightMm3;
      contentKmm3 += sample.volumeWeightMm3 * (sample.shapeFunctions.reduce((sum, weight, local) =>
        sum + weight * temperatures[cell[local]], 0) - referenceC);
    }
  }
  return { volumeMm3, contentKmm3 };
}

function tetraBarycentric(point: NeutralVector3, [a, b, c, d]: [NeutralVector3, NeutralVector3, NeutralVector3, NeutralVector3]): number[] | null {
  const subtract = (left: NeutralVector3, right: NeutralVector3): NeutralVector3 =>
    [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
  const cross = (left: NeutralVector3, right: NeutralVector3): NeutralVector3 =>
    [left[1] * right[2] - left[2] * right[1], left[2] * right[0] - left[0] * right[2], left[0] * right[1] - left[1] * right[0]];
  const dot = (left: NeutralVector3, right: NeutralVector3) =>
    left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
  const ab = subtract(b, a); const ac = subtract(c, a); const ad = subtract(d, a); const ap = subtract(point, a);
  const determinant = dot(ab, cross(ac, ad));
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
  const r = dot(ap, cross(ac, ad)) / determinant;
  const s = dot(ab, cross(ap, ad)) / determinant;
  const t = dot(ab, cross(ac, ap)) / determinant;
  return [1 - r - s - t, r, s, t];
}
