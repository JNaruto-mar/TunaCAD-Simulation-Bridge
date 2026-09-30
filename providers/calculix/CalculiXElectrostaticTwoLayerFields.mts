import type { CompletedTwoLayerElectricalResult } from '../../simulation-bridge/electrostaticTwoLayerAdmission.mts';
import type { ElectrostaticTwoLayer } from '../../simulation-bridge/electrostaticTwoLayerContract.mts';
import type { verifyAndComposeTwoLayerMesh } from '../gmsh/ElectrostaticTwoLayerMesh.mts';
import { digest } from '../../simulation-bridge/stableDigest.mts';
import { ELECTRICAL_COMPONENTS, electricalDatasetSchema, electricalExtrema,
  type ElectricalDataset, type ElectricalTriangle, type ElectricalViewerResult } from '../../simulation-bridge/electrostaticFields.mts';

type VerifiedMesh = ReturnType<typeof verifyAndComposeTwoLayerMesh>;
type Vector = [number, number, number];
const subtriangles = [[0, 3, 5], [3, 1, 4], [5, 4, 2], [3, 4, 5]] as const;
const components = {
  electric_potential: 'V',
  electric_field_magnitude: 'V/m',
  electric_displacement_magnitude: 'C/m^2',
} as const;
function invalid(reason: string): never {
  throw new Error('ELECTROSTATIC_TWO_LAYER_FIELD_INVALID: ' + reason);
}
function faceKey(nodes: number[]) { return nodes.slice(0, 3).sort((a, b) => a - b).join(':'); }

/** Presentation-only fields from an authenticated completion and its exact
 * verified shared-topology model. No provider solve or result admission. */
export function buildTwoLayerElectricalFields(jobId: string,
  completed: CompletedTwoLayerElectricalResult, request: ElectrostaticTwoLayer,
  verified: VerifiedMesh) {
  // The isolated compiler widens strict Zod tuple entries to unknown.
  // Runtime authority remains the already validated sealed request.
  const r = request as any;
  const model = verified.model, electrical = completed.electrical;
  if (completed.completedProviderState !== 'completed_converged'
    || completed.binding.requestDigest !== r.requestDigest
    || completed.binding.fragmentMeshDigest !== verified.meshDigest
    || electrical.meshDigest !== verified.meshDigest
    || electrical.resultDigest !== digest((({ resultDigest, ...rest }) => rest)(electrical))
    || completed.normalizedElectricalResultDigest !== electrical.resultDigest
    || completed.resultDigest !== digest((({ resultDigest, ...rest }) => rest)(completed))
    || model.domainRegions.length !== 2
    || r.model.domains.length !== 2) invalid('completion/source identity');
  const domainIds = r.model.domains.map((domain: any) => domain.domainId);
  if (new Set(domainIds).size !== 2
    || electrical.domainIds.join('|') !== domainIds.join('|'))
    invalid('domain identity');
  const nodal = new Map(electrical.nodalElectricPotential.map(row => [row.nodeId, row]));
  if (nodal.size !== model.nodes.length) invalid('nodal potential incomplete');
  const fields = new Map<number, typeof electrical.electricFields>();
  for (const row of electrical.electricFields) {
    const list = fields.get(row.elementId) ?? [];
    list.push(row); fields.set(row.elementId, list);
  }
  if (fields.size !== model.volumeElements.connectivity.length) invalid('element field incomplete');
  const owners = new Map<string, number[]>();
  model.volumeElements.connectivity.forEach((cell, element) => {
    for (const face of [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]]) {
      const key = faceKey(face.map(index => cell[index]));
      const list = owners.get(key) ?? [];
      list.push(element); owners.set(key, list);
    }
  });
  const output = new Map<string, { descriptor: ElectricalDataset; triangles: ElectricalTriangle[] }>();
  for (const domain of r.model.domains) {
    const region = model.domainRegions.find(row => row.domainId === domain.domainId);
    if (!region) invalid('domain region missing');
    const elements = new Set(region.elementIndices);
    const facets = model.boundaryRegions.filter(row => row.domainId === domain.domainId)
      .flatMap(row => row.facetIndices).sort((a, b) => a - b);
    if (!facets.length || new Set(facets).size !== facets.length) invalid('facet ownership');
    for (const component of ELECTRICAL_COMPONENTS) {
      const triangles: ElectricalTriangle[] = [];
      for (const facetIndex of facets) {
        const facet = model.boundaryFacets.connectivity[facetIndex];
        if (facet?.length !== 6) invalid('quadratic facet');
        const candidates = (owners.get(faceKey(facet)) ?? []).filter(element => elements.has(element));
        if (candidates.length !== 1) invalid('ambiguous domain element owner');
        const elementIndex = candidates[0];
        const ips = fields.get(elementIndex + 1);
        if (ips?.length !== 4 || ips.some((row, index) =>
          row.integrationPoint !== index + 1 || row.domainId !== domain.domainId))
          invalid('integration-point ownership');
        const average: Vector | null = component === 'electric_potential' ? null
          : [0, 1, 2].map(axis => ips.reduce((sum, row) => sum +
            (component === 'electric_field_magnitude'
              ? row.electricFieldVPerM[axis] : row.electricDisplacementCPerM2[axis]), 0) / 4) as Vector;
        subtriangles.forEach((indices, subtriangleIndex) => {
          const nodes = indices.map(index => facet[index]);
          const values = nodes.map(node => {
            const sample = nodal.get(node + 1);
            if (!sample || !sample.domainIds.includes(domain.domainId)
              || sample.positionM.some((v, axis) =>
                Math.abs(v * 1000 - model.nodes[node][axis]) > 1e-9))
              invalid('nodal/domain position');
            return average ? Math.hypot(...average) : sample.electricPotentialV;
          }) as Vector;
          triangles.push({ facetIndex, subtriangleIndex, elementIndex,
            nodeIds: nodes.map(node => node + 1) as Vector,
            positionsAnalysisMm: nodes.map(node => model.nodes[node]) as ElectricalTriangle['positionsAnalysisMm'],
            values, vectors: average ? [average, average, average] : null });
        });
      }
      const datasetId = jobId + ':' + domain.domainId + ':electrostatic:' + component;
      const descriptor = electricalDatasetSchema.parse({
        schema: 'tunacad-electrostatic-field-dataset/0.1', analysisType: 'electrostatic',
        datasetId, jobId, domainId: domain.domainId, requestDigest: r.requestDigest,
        resultDigest: completed.resultDigest,
        canonicalSourceDigest: completed.binding.sourceDigest,
        meshDigest: verified.meshDigest, step: { index: 0, label: 'electrostatic' },
        component, unit: components[component], positionUnit: 'mm',
        location: 'boundary_facet', topology: 'triangle_soup',
        sampling: component === 'electric_potential' ? 'nodal'
          : 'element_average_of_four_integration_points',
        vectorsIncluded: component !== 'electric_potential',
        valueRange: electricalExtrema(triangles), totalTriangles: triangles.length,
        maximumPageTriangles: 128, datasetDigest: digest(triangles),
      });
      output.set(datasetId, { descriptor, triangles });
    }
  }
  if (output.size !== 6) invalid('six domain-owned datasets required');
  return output;
}

export function twoLayerElectricalViewerResult(request: ElectrostaticTwoLayer,
  completed: CompletedTwoLayerElectricalResult,
  fields: ReturnType<typeof buildTwoLayerElectricalFields>): ElectricalViewerResult {
  const r = request as any;
  if (fields.size !== 6 || completed.electrical.requestDigest !== r.requestDigest)
    invalid('viewer manifest source');
  const fieldDatasets = [...fields.values()].map(field => field.descriptor);
  return {
    analysisType: 'electrostatic', fieldDatasets,
    perDomain: r.model.domains.map((domain: any, index: number) => ({
      domainId: domain.domainId,
      fieldDatasetIds: fieldDatasets.filter(field => field.domainId === domain.domainId)
        .map(field => field.datasetId),
      materialId: r.materials[index].materialId,
      absolutePermittivityFPerM: r.materials[index].absolutePermittivityFPerM,
      permittivityUnit: 'F/m',
    })),
    twoLayerSummary: {
      electrodeChargesC: completed.electrical.electrodes.map(item =>
        ({ faceId: item.faceId, chargeC: item.chargeC })),
      capacitanceF: completed.electrical.capacitanceF,
      electrostaticEnergyJ: completed.electrical.electrostaticEnergyJ,
      interfaceNormalDJumpCPerM2:
        completed.electrical.consistency.interfaceDisplacementJumpCPerM2,
      netElectrodeChargeC: completed.electrical.consistency.netElectrodeChargeC,
    },
  };
}
