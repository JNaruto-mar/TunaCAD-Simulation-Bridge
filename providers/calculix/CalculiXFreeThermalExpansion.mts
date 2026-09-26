import type { NeutralFemModelV2, NeutralSimulationMaterial, NeutralVector3 } from '../../src/simulation/externalSimulationContracts.ts';
import { digest } from '../../simulation-bridge/stableDigest.mts';
import { parseCalculiXDatV2 } from './CalculiXMultiDomainSolverProvider.mts';
import { neutralToCalculiXC3D10 } from './CalculiXMultiDomainDeck.mts';

export interface ExactThermalTransfer {
  /** Present only after bounded nonmatching-mesh projection. */
  method?: 'quadratic_tetra_barycentric';
  sourceModelId: string;
  targetModelId: string;
  nodeCount: number;
  temperatureDigest: string;
  temperatureSumC: number;
  temperaturesByNodeC: Map<number, number>;
}

/** The first sequential SIM-8 lane accepts only a complete field on the
 * identical FEM model. Sparse summaries, interpolation, and remeshing fail. */
export function transferThermalFieldSameMesh(
  source: NeutralFemModelV2,
  target: NeutralFemModelV2,
  temperaturesByNode: Map<number, number>,
): ExactThermalTransfer {
  if (source.modelId !== target.modelId || source.requestDigest !== target.requestDigest
    || source.modelDigest !== target.modelDigest
    || digest({ nodes: source.nodes, volumeElements: source.volumeElements, domainRegions: source.domainRegions })
      !== digest({ nodes: target.nodes, volumeElements: target.volumeElements, domainRegions: target.domainRegions })
    || temperaturesByNode.size !== source.nodes.length) {
    throw new Error('SIMULATION_THERMAL_TRANSFER_MESH_MISMATCH');
  }
  const ordered = source.nodes.map((_point, node) => {
    const value = temperaturesByNode.get(node);
    if (value === undefined || !Number.isFinite(value) || value < -273.15 || value > 1e6) {
      throw new Error('SIMULATION_THERMAL_TRANSFER_FIELD_INVALID');
    }
    return value;
  });
  return {
    sourceModelId: source.modelId, targetModelId: target.modelId, nodeCount: ordered.length,
    temperatureDigest: digest(ordered), temperatureSumC: ordered.reduce((sum, value) => sum + value, 0),
    temperaturesByNodeC: new Map(ordered.map((temperatureC, node) => [node, temperatureC])),
  };
}

export function createCalculiXFreeThermalExpansionDeck(
  model: NeutralFemModelV2,
  transfer: ExactThermalTransfer,
  material: NeutralSimulationMaterial,
  initialTemperatureC: number,
): { deck: string; endNode: number; reactionSets: string[] } {
  const alpha = material.thermalExpansionPerK;
  if (model.domainRegions.length !== 1 || model.element.geometryOrder !== 2 || model.element.solutionOrder !== 2
    || model.volumeElements.connectivity.some(cell => cell.length !== 10)
    || (transfer.sourceModelId !== model.modelId && transfer.method !== 'quadratic_tetra_barycentric')
    || transfer.targetModelId !== model.modelId
    || transfer.nodeCount !== model.nodes.length || transfer.temperaturesByNodeC.size !== model.nodes.length
    || digest(model.nodes.map((_point, node) => transfer.temperaturesByNodeC.get(node))) !== transfer.temperatureDigest
    || !(alpha && alpha > 0 && alpha <= 1e-2)
    || !(material.youngsModulusMPa > 0) || !(material.poissonRatio >= 0 && material.poissonRatio < .5)
    || !Number.isFinite(initialTemperatureC) || initialTemperatureC < -273.15 || initialTemperatureC > 1e6) {
    throw new Error('SIMULATION_THERMAL_EXPANSION_INPUT_INVALID');
  }
  const xs = model.nodes.map(point => point[0]); const ys = model.nodes.map(point => point[1]); const zs = model.nodes.map(point => point[2]);
  const x0 = Math.min(...xs); const x1 = Math.max(...xs); const y0 = Math.min(...ys); const y1 = Math.max(...ys); const z0 = Math.min(...zs);
  const findCorner = (x: number, y: number, z: number) => {
    const node = model.nodes.findIndex(point => Math.abs(point[0] - x) < 1e-8 && Math.abs(point[1] - y) < 1e-8 && Math.abs(point[2] - z) < 1e-8);
    if (node < 0) throw new Error('SIMULATION_THERMAL_EXPANSION_ANCHOR_MISSING');
    return node;
  };
  const base = findCorner(x0, y0, z0); const end = findCorner(x1, y0, z0); const transverse = findCorner(x0, y1, z0);
  if (new Set([base, end, transverse]).size !== 3) throw new Error('SIMULATION_THERMAL_EXPANSION_ANCHOR_INVALID');
  const reactionSets = ['THERMAL_ANCHOR_001', 'THERMAL_ANCHOR_002', 'THERMAL_ANCHOR_003'];
  const number = (value: number) => Number(value.toPrecision(12)).toString();
  const lines = [
    '*HEADING', 'TunaCAD SIM-8 exact-mesh free thermal expansion fixture',
    '*NODE, NSET=NALL',
    ...model.nodes.map((point, node) => String(node + 1) + ',' + point.map(number).join(',')),
    '*ELEMENT, TYPE=C3D10, ELSET=EALL',
    ...model.volumeElements.connectivity.map((cell, element) => String(element + 1) + ',' + neutralToCalculiXC3D10(cell).map(node => node + 1).join(',')),
    ...[base, end, transverse].flatMap((node, index) => ['*NSET, NSET=' + reactionSets[index], String(node + 1)]),
    '*MATERIAL, NAME=THERMAL_EXPANSION_MATERIAL',
    '*ELASTIC', number(material.youngsModulusMPa) + ',' + number(material.poissonRatio),
    '*EXPANSION, ZERO=' + number(initialTemperatureC), number(alpha),
    '*SOLID SECTION, ELSET=EALL, MATERIAL=THERMAL_EXPANSION_MATERIAL',
    '*INITIAL CONDITIONS, TYPE=TEMPERATURE', 'NALL,' + number(initialTemperatureC),
    '*STEP', '*STATIC', '1,1',
    '*BOUNDARY',
    reactionSets[0] + ',1,3,0',
    reactionSets[1] + ',2,3,0',
    reactionSets[2] + ',3,3,0',
    '*TEMPERATURE',
    ...model.nodes.map((_point, node) => String(node + 1) + ',' + number(transfer.temperaturesByNodeC.get(node)!)),
    '*NODE PRINT, NSET=NALL, GLOBAL=YES', 'U',
    ...reactionSets.flatMap(name => ['*NODE PRINT, NSET=' + name + ', TOTALS=ONLY, GLOBAL=YES', 'RF']),
    '*EL PRINT, ELSET=EALL', 'S',
    '*END STEP',
  ];
  return { deck: lines.join('\n') + '\n', endNode: end, reactionSets };
}

export function normalizeFreeThermalExpansionResult(
  dat: string,
  model: NeutralFemModelV2,
  transfer: ExactThermalTransfer,
  endNode: number,
  reactionSets: string[],
) {
  const parsed = parseCalculiXDatV2(dat, model, reactionSets);
  if (parsed.displacements.size !== model.nodes.length || parsed.vonMisesByElement.size !== model.volumeElements.connectivity.length
    || reactionSets.some(name => !parsed.reactions[name]) || !parsed.displacements.has(endNode)) {
    throw new Error('SIMULATION_THERMAL_EXPANSION_RESULT_INCOMPLETE');
  }
  const reactionForceN = reactionSets.reduce<NeutralVector3>((sum, name) => {
    const value = parsed.reactions[name]; return [sum[0] + value[0], sum[1] + value[1], sum[2] + value[2]];
  }, [0, 0, 0]);
  return {
    sourceModelId: transfer.sourceModelId,
    targetModelId: transfer.targetModelId,
    transferredNodeCount: transfer.nodeCount,
    transferredTemperatureDigest: transfer.temperatureDigest,
    transferredTemperatureSumC: transfer.temperatureSumC,
    endDisplacementMm: parsed.displacements.get(endNode)!,
    resultantReactionForceN: reactionForceN,
    maximumVonMisesStressMPa: Math.max(...parsed.vonMisesByElement.values()),
    engineeringUsePermitted: false as const,
  };
}
