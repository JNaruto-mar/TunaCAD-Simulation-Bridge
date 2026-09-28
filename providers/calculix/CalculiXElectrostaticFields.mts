import type { NeutralFemMesh } from '../../src/simulation/externalSimulationContracts.ts';
import type { CompletedElectrostaticResult } from '../../simulation-bridge/electrostaticAdmission.mts';
import { digest } from '../../simulation-bridge/stableDigest.mts';
import { ELECTRICAL_COMPONENTS, electricalUnits, electricalExtrema, electricalDatasetSchema,
  type ElectricalDataset, type ElectricalTriangle, type ElectricalPage } from '../../simulation-bridge/electrostaticFields.mts';

export function buildElectricalFields(jobId: string, completed: CompletedElectrostaticResult, mesh: NeutralFemMesh) {
  if (completed.completedProviderState !== 'completed_converged' || completed.electrical.meshDigest !== completed.binding.meshDigest
    || digest(mesh) !== completed.binding.meshDigest) throw new Error('ELECTROSTATIC_FIELD_SOURCE_INVALID');
  const nodal = new Map(completed.electrical.nodalElectricPotential.map(n => [n.nodeId, n]));
  if (nodal.size !== mesh.nodes.length) throw new Error('ELECTROSTATIC_FIELD_NODES_INCOMPLETE');
  const fields = new Map<number, typeof completed.electrical.electricFields>();
  for (const f of completed.electrical.electricFields) {
    const list = fields.get(f.elementId) ?? []; list.push(f); fields.set(f.elementId, list);
  }
  const owners = new Map<string, number[]>();
  mesh.volumeElements.connectivity.forEach((cell, element) => {
    for (const face of [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]]) {
      const key = face.map(i => cell[i]).sort((a,b) => a-b).join(':');
      const list = owners.get(key) ?? []; list.push(element); owners.set(key, list);
    }
  });
  return new Map(ELECTRICAL_COMPONENTS.map(component => {
    const triangles: ElectricalTriangle[] = mesh.boundaryFacets.connectivity.flatMap((facet, facetIndex) => {
      if (facet.length !== 6) throw new Error('ELECTROSTATIC_FIELD_TOPOLOGY_INVALID');
      const matching = owners.get(facet.slice(0, 3).sort((a,b) => a-b).join(':'));
      if (matching?.length !== 1) throw new Error('ELECTROSTATIC_FIELD_AMBIGUOUS_OWNER');
      const elementIndex = matching[0], ips = fields.get(elementIndex + 1);
      if (ips?.length !== 4 || ips.some((f, i) => f.integrationPoint !== i + 1)) throw new Error('ELECTROSTATIC_FIELD_IP_INCOMPLETE');
      const average = component === 'electric_potential' ? null : [0, 1, 2].map(axis => ips.reduce((sum, f) =>
        sum + (component === 'electric_field_magnitude' ? f.electricFieldVPerM[axis] : f.electricDisplacementCPerM2[axis]), 0) / 4) as [number,number,number];
      return [[0,3,5],[3,1,4],[5,4,2],[3,4,5]].map((indices, subtriangleIndex) => {
        const nodes = indices.map(i => facet[i]);
        const values = nodes.map(node => {
          const n = nodal.get(node + 1);
          if (!n || n.positionM.some((v, axis) => Math.abs(v * 1000 - mesh.nodes[node][axis]) > 1e-9)) throw new Error('ELECTROSTATIC_FIELD_NODE_MISMATCH');
          return average ? Math.hypot(...average) : n.electricPotentialV;
        }) as [number,number,number];
        return { facetIndex, subtriangleIndex, elementIndex, nodeIds: nodes.map(n => n + 1) as [number,number,number],
          positionsAnalysisMm: nodes.map(n => mesh.nodes[n]) as ElectricalTriangle['positionsAnalysisMm'], values,
          vectors: average ? [average, average, average] as ElectricalTriangle['vectors'] : null };
      });
    });
    const datasetId = jobId + ':' + completed.binding.domainId + ':electrostatic:' + component;
    const descriptor = electricalDatasetSchema.parse({
      schema: 'tunacad-electrostatic-field-dataset/0.1', analysisType: 'electrostatic', datasetId,
      jobId, domainId: completed.binding.domainId, requestDigest: completed.binding.requestDigest,
      resultDigest: completed.resultDigest, canonicalSourceDigest: completed.binding.geometryDigest,
      meshDigest: completed.binding.meshDigest, step: { index: 0, label: 'electrostatic' },
      component, unit: electricalUnits[component], positionUnit: 'mm', location: 'boundary_facet', topology: 'triangle_soup',
      sampling: averageSampling(component), vectorsIncluded: component !== 'electric_potential',
      valueRange: electricalExtrema(triangles), totalTriangles: triangles.length, maximumPageTriangles: 128,
      datasetDigest: digest(triangles),
    });
    return [datasetId, { descriptor, triangles }] as const;
  }));
}
function averageSampling(component: string) { return component === 'electric_potential' ? 'nodal' : 'element_average_of_four_integration_points'; }
export function electricalFieldPage(field: { descriptor: ElectricalDataset; triangles: ElectricalTriangle[] }, cursor = '0', limit = 128): ElectricalPage {
  if (!/^(0|[1-9][0-9]{0,5})$/.test(cursor) || !Number.isInteger(limit) || limit < 1 || limit > 128
    || Number(cursor) >= field.triangles.length) throw new Error('ELECTROSTATIC_FIELD_PAGE_INVALID');
  const offset = Number(cursor), triangles = field.triangles.slice(offset, offset + limit), end = offset + triangles.length;
  return { schema: 'tunacad-electrostatic-field-page/0.1', dataset: field.descriptor, cursor,
    nextCursor: end < field.triangles.length ? String(end) : null, triangleOffset: offset,
    triangleCount: triangles.length, triangles, chunkDigest: digest(triangles) };
}
