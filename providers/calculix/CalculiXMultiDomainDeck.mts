import type {
  NeutralFemMesh,
  NeutralFemModelV2,
  NeutralSimulationConstraint,
  NeutralSimulationRequestV2,
  NeutralVector3,
} from '../../src/simulation/externalSimulationContracts.ts';
import { validateNeutralFemModelV2, validateNeutralSimulationRequestV2 } from '../../simulation-bridge/v2Validation.mts';
import {
  buildConstraintSets,
  consistentSurfaceLoads,
  pressureSurfaceLoads,
} from './CalculiXSolverProvider.mts';

/** Generate a deterministic CalculiX C3D10 deck with one element set and solid
 * section per domain and one material card per referenced material. There are
 * deliberately no tie/contact cards in SIM-4A. */
export function createCalculiXInputDeckV2(request: NeutralSimulationRequestV2, model: NeutralFemModelV2): string {
  validateNeutralSimulationRequestV2(request);
  validateNeutralFemModelV2(model, request);
  if (model.element.geometryOrder !== 2 || model.element.solutionOrder !== 2 || model.volumeElements.connectivity.some(cell => cell.length !== 10)) {
    throw deckError('SIMULATION_MESH_ELEMENT_UNSUPPORTED', 'The SIM-4A CalculiX deck requires complete second-order C3D10 tetrahedra.');
  }
  const mesh = asV1Mesh(model);
  const materials = [...request.materials].sort((a, b) => compareText(a.id, b.id));
  const materialNames = new Map(materials.map((material, index) => [material.id, `MATERIAL_${String(index + 1).padStart(3, '0')}`]));
  const domains = [...model.domainRegions].sort((a, b) => compareText(a.domainId, b.domainId));
  const domainSetNames = new Map(domains.map((domain, index) => [domain.domainId, `DOMAIN_${String(index + 1).padStart(3, '0')}`]));
  const nodeSetNames = new Map(domains.map((domain, index) => [domain.domainId, `DOMAIN_NODES_${String(index + 1).padStart(3, '0')}`]));
  const constraints = request.constraints as unknown as NeutralSimulationConstraint[];
  const constraintSets = buildConstraintSets(constraints, mesh);
  const constrainedRegions = new Set(constraintSets.flatMap(set => set.regions.map(region => region.regionId)));
  const nodalLoads = new Map<number, NeutralVector3>();
  const loads = [...request.loads].sort((a, b) => compareText(a.id, b.id));
  for (const load of loads) {
    if (load.type === 'gravity') continue;
    const regions = requireRegions(model, load.semanticReferenceIds);
    if (regions.some(region => constrainedRegions.has(region.regionId))) throw deckError('SIMULATION_FACE_MAPPING_AMBIGUOUS', 'A SIM-4A region cannot be loaded and constrained simultaneously.');
    const facetIndices = [...new Set(regions.flatMap(region => region.facetIndices))].sort((a, b) => a - b);
    addLoads(nodalLoads, load.type === 'surface_force'
      ? consistentSurfaceLoads(mesh, facetIndices, load.forceN)
      : pressureSurfaceLoads(mesh, facetIndices, load.pressureMPa));
  }
  const gravity = loads.filter(load => load.type === 'gravity').reduce<NeutralVector3>((sum, load) => [
    sum[0] + load.accelerationMmPerS2[0], sum[1] + load.accelerationMmPerS2[1], sum[2] + load.accelerationMmPerS2[2],
  ], [0, 0, 0]);
  const gravityMagnitude = Math.hypot(...gravity);
  if (loads.some(load => load.type === 'gravity') && materials.some(material => !(material.densityKgM3 && material.densityKgM3 > 0))) {
    throw deckError('SIMULATION_MATERIAL_INVALID', 'Every material assigned to a gravity-loaded SIM-4A model requires positive density.');
  }
  const allElements = model.volumeElements.connectivity.map((_, index) => index + 1);
  const lines = [
    '*HEADING',
    `TunaCAD SIM-4A multi-domain linear-static study ${safeComment(request.studyId)}`,
    '*NODE, NSET=NALL',
    ...model.nodes.map((point, index) => `${index + 1},${point.map(solverNumber).join(',')}`),
    ...domains.flatMap(domain => {
      const setName = domainSetNames.get(domain.domainId)!;
      return [
        `*ELEMENT, TYPE=C3D10, ELSET=${setName}`,
        ...domain.elementIndices.map(index => `${index + 1},${neutralToCalculiXC3D10(model.volumeElements.connectivity[index]).map(node => node + 1).join(',')}`),
      ];
    }),
    '*ELSET, ELSET=EALL', ...wrapIds(allElements),
    ...domains.flatMap(domain => [`*NSET, NSET=${nodeSetNames.get(domain.domainId)!}`, ...wrapIds(domain.nodeIndices.map(node => node + 1))]),
    ...constraintSets.flatMap(item => [
      `*NSET, NSET=${item.name}`, ...wrapIds(item.nodes.map(node => node + 1)),
      `*NSET, NSET=${item.reactionName}`, ...wrapIds(item.reactionNodes.map(node => node + 1)),
    ]),
    ...materials.flatMap(material => [
      `*MATERIAL, NAME=${materialNames.get(material.id)!}`,
      '*ELASTIC', `${solverNumber(material.youngsModulusMPa)},${solverNumber(material.poissonRatio)}`,
      ...(material.densityKgM3 !== undefined ? ['*DENSITY', solverNumber(material.densityKgM3 * 1e-12)] : []),
    ]),
    ...domains.map(domain => `*SOLID SECTION, ELSET=${domainSetNames.get(domain.domainId)!}, MATERIAL=${materialNames.get(domain.materialId)!}`),
    '*STEP', '*STATIC', '*BOUNDARY',
    ...constraintSets.flatMap(item => boundaryLines(item.name, item.constraint)),
    ...([...nodalLoads.entries()].length ? [
      '*CLOAD',
      ...[...nodalLoads.entries()].sort(([a], [b]) => a - b).flatMap(([node, force]) => force.flatMap((value, axis) => Math.abs(value) > 1e-14 ? [`${node + 1},${axis + 1},${solverNumber(value)}`] : [])),
    ] : []),
    ...(gravityMagnitude > 1e-9 ? ['*DLOAD', `EALL,GRAV,${solverNumber(gravityMagnitude)},${gravity.map(value => solverNumber(value / gravityMagnitude)).join(',')}`] : []),
    '*NODE PRINT, NSET=NALL, GLOBAL=YES', 'U',
    ...constraintSets.flatMap(item => [`*NODE PRINT, NSET=${item.reactionName}, TOTALS=ONLY, GLOBAL=YES`, 'RF']),
    '*EL PRINT, ELSET=EALL', 'S',
    ...domains.flatMap(domain => [
      `*NODE PRINT, NSET=${nodeSetNames.get(domain.domainId)!}, GLOBAL=YES`, 'U',
      `*EL PRINT, ELSET=${domainSetNames.get(domain.domainId)!}`, 'S',
    ]),
    ...(loads.some(load => load.type === 'gravity') ? ['*EL PRINT, ELSET=EALL, TOTALS=ONLY', 'EVOL'] : []),
    '*END STEP',
  ];
  return `${lines.join('\n')}\n`;
}

export function asV1Mesh(model: NeutralFemModelV2): NeutralFemMesh {
  const { perDomain: _perDomain, ...quality } = model.quality;
  return {
    schema: 'tunacad-neutral-fem-mesh/1.0', meshId: model.modelId, requestDigest: model.requestDigest,
    projectRevision: model.projectRevision, geometryDigest: model.modelDigest, coordinateSpace: 'part_definition_local', units: model.units,
    element: structuredClone(model.element), nodes: structuredClone(model.nodes),
    volumeElements: { connectivity: structuredClone(model.volumeElements.connectivity), regionIds: [...model.volumeElements.volumeRegionIds] },
    boundaryFacets: { connectivity: structuredClone(model.boundaryFacets.connectivity), regionIds: [...model.boundaryFacets.regionIds] },
    boundaryRegions: model.boundaryRegions.map(region => ({
      regionId: region.regionId, semanticReferenceIds: [...region.semanticReferenceIds], sourceFeatureIds: [...region.sourceFeatureIds],
      facetIndices: [...region.facetIndices], matchedCadFace: structuredClone(region.matchedCadFaceOwnerLocal), match: structuredClone(region.match),
    })),
    volumeRegions: model.domainRegions.map(region => ({ regionId: region.volumeRegionId, elementIndices: [...region.elementIndices] })),
    quality: structuredClone(quality),
    provenance: { ...structuredClone(model.provenance), meshProviderInterfaceVersion: '1.0', inputGeometryDigest: model.modelDigest },
  };
}

function requireRegions(model: NeutralFemModelV2, referenceIds: string[]): NeutralFemModelV2['boundaryRegions'] {
  const regions = referenceIds.map(referenceId => {
    const matches = model.boundaryRegions.filter(region => region.semanticReferenceIds.includes(referenceId));
    if (matches.length !== 1) throw deckError(matches.length ? 'SIMULATION_FACE_MAPPING_AMBIGUOUS' : 'SIMULATION_FACE_MAPPING_NOT_FOUND', `FACE reference "${referenceId}" maps to ${matches.length} SIM-4A regions.`);
    return matches[0];
  });
  if (new Set(regions.map(region => region.regionId)).size !== regions.length) throw deckError('SIMULATION_FACE_MAPPING_AMBIGUOUS', 'Several FACE references map to one SIM-4A boundary region.');
  return regions;
}

function boundaryLines(name: string, constraint: NeutralSimulationConstraint): string[] {
  if (constraint.type === 'fixed') return [`${name},1,3,0`];
  return constraint.displacementMm.flatMap((value, axis) => value === null ? [] : [`${name},${axis + 1},${axis + 1},${solverNumber(value)}`]);
}

function addLoads(target: Map<number, NeutralVector3>, source: Map<number, NeutralVector3>): void {
  for (const [node, force] of source) {
    const prior = target.get(node) ?? [0, 0, 0];
    target.set(node, [prior[0] + force[0], prior[1] + force[1], prior[2] + force[2]]);
  }
}

function neutralToCalculiXC3D10(cell: number[]): number[] {
  if (cell.length !== 10) throw deckError('SIMULATION_MESH_ELEMENT_UNSUPPORTED', 'CalculiX C3D10 translation requires ten neutral nodes.');
  return [...cell.slice(0, 8), cell[9], cell[8]];
}

function wrapIds(ids: number[]): string[] {
  const lines: string[] = [];
  for (let index = 0; index < ids.length; index += 16) lines.push(ids.slice(index, index + 16).join(','));
  return lines;
}

function solverNumber(value: number): string {
  if (!Number.isFinite(value)) throw deckError('SIMULATION_INPUT_INVALID', 'CalculiX input contains a non-finite number.');
  if (Math.abs(value) < 1e-12) return '0';
  const [mantissa, exponent] = value.toPrecision(12).replace(/e/g, 'E').split('E');
  const compact = mantissa.includes('.') ? mantissa.replace(/0+$/, '').replace(/\.$/, '') : mantissa;
  return exponent === undefined ? compact : `${compact}E${Number(exponent)}`;
}

function safeComment(value: string): string { return value.replace(/[^A-Za-z0-9 _.:-]/g, '').slice(0, 120); }
function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function deckError(code: string, message: string): Error & { code: string } { return Object.assign(new Error(message), { code }); }
