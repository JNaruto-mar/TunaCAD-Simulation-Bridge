import type { NeutralFemModelV2, NeutralThermalInterfaceConductanceV2, NeutralVector3 } from '../../src/simulation/externalSimulationContracts.ts';
import { quadraticTriangleSurfaceSamples } from '../../src/simulation/neutralFemMesh.ts';

export interface ValidatedThermalInterface {
  secondaryFacets: number[];
  primaryFacets: number[];
  areaMm2: number;
}

/** Preflight a bounded planar, coincident, opposed interface before ccx is
 * launched. Every node and quadrature witness must lie inside the other
 * triangulation. No node merge, projection extension, or position repair. */
export function validateNonconformalThermalInterface(
  model: NeutralFemModelV2, interaction: NeutralThermalInterfaceConductanceV2,
): ValidatedThermalInterface {
  const getFacets = (ids: string[]) => {
    const regions = ids.map(id => {
      const found = model.boundaryRegions.filter(region => region.semanticReferenceIds.includes(id));
      if (found.length !== 1) throw invalid('Interface FACE mapping is missing or ambiguous.');
      return found[0];
    });
    return [...new Set(regions.flatMap(region => region.facetIndices))].sort((a, b) => a - b);
  };
  const secondaryFacets = getFacets(interaction.secondaryReferenceIds);
  const primaryFacets = getFacets(interaction.primaryReferenceIds);
  if (!secondaryFacets.length || !primaryFacets.length || secondaryFacets.length > 256 || primaryFacets.length > 256
    || secondaryFacets.some(index => primaryFacets.includes(index))) throw invalid('Interface FACE groups are empty, oversized, or overlapping.');
  const secondaryNodes = new Set(secondaryFacets.flatMap(index => model.boundaryFacets.connectivity[index]));
  const primaryNodes = new Set(primaryFacets.flatMap(index => model.boundaryFacets.connectivity[index]));
  if ([...secondaryNodes].some(node => primaryNodes.has(node))) throw invalid('Conductive interface must retain distinct domain node identities.');
  const tolerance = interaction.positionToleranceMm;
  const first = model.boundaryFacets.connectivity[secondaryFacets[0]];
  const origin = model.nodes[first[0]];
  const normal = unit(cross(sub(model.nodes[first[1]], origin), sub(model.nodes[first[2]], origin)));
  const side = (indices: number[], sign: 1 | -1) => {
    let area = 0;
    const triangles: NeutralVector3[][] = [];
    const witnesses: NeutralVector3[] = [];
    for (const index of indices) {
      const facet = model.boundaryFacets.connectivity[index];
      if (!facet || facet.length !== 6) throw invalid('Interface requires complete quadratic triangles.');
      const points = facet.map(node => model.nodes[node]);
      if (points.some(point => Math.abs(dot(sub(point, origin), normal)) > tolerance)) throw invalid('Interface surfaces are not coincident and planar.');
      for (const [middle, a, b] of [[3, 0, 1], [4, 1, 2], [5, 2, 0]]) {
        const midpoint = points[a].map((value, axis) => (value + points[b][axis]) / 2) as NeutralVector3;
        if (Math.hypot(...sub(points[middle], midpoint)) > tolerance) throw invalid('Curved or non-straight interface facet is unsupported.');
      }
      const facetNormal = unit(cross(sub(points[1], points[0]), sub(points[2], points[0])));
      if (sign * dot(facetNormal, normal) < .99) throw invalid('Interface facet orientation is inconsistent or not opposed.');
      const samples = quadraticTriangleSurfaceSamples(points);
      area += samples.reduce((sum, sample) => sum + sample.areaWeightMm2, 0);
      triangles.push(points.slice(0, 3));
      witnesses.push(...points, ...samples.map(sample => sample.positionMm));
    }
    return { area, triangles, witnesses };
  };
  const secondary = side(secondaryFacets, 1);
  const primary = side(primaryFacets, -1);
  if (!(secondary.area > 0) || Math.abs(secondary.area - primary.area) > Math.max(1e-6, secondary.area * .001)) {
    throw invalid('Interface sides have different mapped area.');
  }
  for (const [source, target] of [[secondary, primary], [primary, secondary]] as const) {
    if (source.witnesses.some(point => !target.triangles.some(triangle => insideTriangle(point, triangle, normal, tolerance)))) {
      throw invalid('Interface coverage is incomplete; extrapolation and topology repair are forbidden.');
    }
  }
  return { secondaryFacets, primaryFacets, areaMm2: (secondary.area + primary.area) / 2 };
}

/** Quadratic, area-weighted mean surface NT from complete nodal output. */
export function thermalInterfaceMeanTemperatureC(
  model: NeutralFemModelV2, temperatures: Map<number, number>, facets: number[],
): number {
  let total = 0; let area = 0;
  for (const index of facets) {
    const nodes = model.boundaryFacets.connectivity[index];
    const values = nodes.map(node => temperatures.get(node));
    if (values.some(value => value === undefined || !Number.isFinite(value))) throw invalid('Interface NT data is incomplete.');
    for (const sample of quadraticTriangleSurfaceSamples(nodes.map(node => model.nodes[node]))) {
      total += sample.shapeFunctions.reduce((sum, weight, node) => sum + weight * values[node]!, 0) * sample.areaWeightMm2;
      area += sample.areaWeightMm2;
    }
  }
  if (!(area > 0) || !Number.isFinite(total)) throw invalid('Interface temperature integral is invalid.');
  return total / area;
}

function insideTriangle(point: NeutralVector3, [a, b, c]: NeutralVector3[], normal: NeutralVector3, tolerance: number): boolean {
  if (Math.abs(dot(sub(point, a), normal)) > tolerance) return false;
  const u = sub(b, a); const v = sub(c, a); const w = sub(point, a);
  const uu = dot(u, u); const uv = dot(u, v); const vv = dot(v, v);
  const wu = dot(w, u); const wv = dot(w, v); const denominator = uu * vv - uv * uv;
  if (!(denominator > 1e-18)) throw invalid('Interface has a degenerate projected triangle.');
  const r = (wu * vv - wv * uv) / denominator;
  const s = (wv * uu - wu * uv) / denominator;
  const margin = Math.max(1e-8, tolerance / Math.sqrt(Math.max(uu, vv)));
  return r >= -margin && s >= -margin && r + s <= 1 + margin;
}
function sub(a: NeutralVector3, b: NeutralVector3): NeutralVector3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a: NeutralVector3, b: NeutralVector3): NeutralVector3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: NeutralVector3, b: NeutralVector3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function unit(a: NeutralVector3): NeutralVector3 {
  const length = Math.hypot(...a);
  if (!(length > 1e-12)) throw invalid('Interface facet normal is degenerate.');
  return a.map(value => value / length) as NeutralVector3;
}
function invalid(message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code: 'SIMULATION_THERMAL_INTERFACE_INVALID' });
}
