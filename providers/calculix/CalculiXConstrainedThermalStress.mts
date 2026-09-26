import type { NeutralFemModelV2, NeutralSimulationMaterial, NeutralVector3 } from '../../src/simulation/externalSimulationContracts.ts';
import { digest } from '../../simulation-bridge/stableDigest.mts';
import { neutralToCalculiXC3D10 } from './CalculiXMultiDomainDeck.mts';
import { parseCalculiXDatV2 } from './CalculiXMultiDomainSolverProvider.mts';
import type { ExactThermalTransfer } from './CalculiXFreeThermalExpansion.mts';

/** Constant pointwise heating can be isolated even when the transferred
 * final thermal field is nonuniform: T_initial(node)=T_final(node)-deltaT.
 * This fixture uses the complete thermal result, not its bounded samples. */
export function createCalculiXConstrainedThermalStressDeck(
  model: NeutralFemModelV2,
  transfer: ExactThermalTransfer,
  material: NeutralSimulationMaterial,
  temperatureChangeK: number,
): { deck: string; reactionSets: ['THERMAL_END_REACTION', 'NALL'] } {
  const alpha = material.thermalExpansionPerK;
  if (model.domainRegions.length !== 1 || model.element.geometryOrder !== 2 || model.element.solutionOrder !== 2
    || model.volumeElements.connectivity.some(cell => cell.length !== 10)
    || transfer.sourceModelId !== model.modelId || transfer.targetModelId !== model.modelId
    || transfer.nodeCount !== model.nodes.length || transfer.temperaturesByNodeC.size !== model.nodes.length
    || digest(model.nodes.map((_point, node) => transfer.temperaturesByNodeC.get(node))) !== transfer.temperatureDigest
    || !(alpha && alpha > 0 && alpha <= 1e-2)
    || !(material.youngsModulusMPa > 0) || !(material.poissonRatio >= 0 && material.poissonRatio < .5)
    || !Number.isFinite(temperatureChangeK) || temperatureChangeK <= 0 || temperatureChangeK > 1e6) {
    throw new Error('SIMULATION_THERMAL_STRESS_INPUT_INVALID');
  }
  const initial = model.nodes.map((_point, node) => transfer.temperaturesByNodeC.get(node)! - temperatureChangeK);
  if (initial.some(value => !Number.isFinite(value) || value < -273.15 || value > 1e6)) {
    throw new Error('SIMULATION_THERMAL_STRESS_INITIAL_FIELD_INVALID');
  }
  const maximumX = Math.max(...model.nodes.map(point => point[0]));
  const endNodes = model.nodes.flatMap((point, node) => Math.abs(point[0] - maximumX) < 1e-8 ? [node + 1] : []);
  if (endNodes.length < 6) throw new Error('SIMULATION_THERMAL_STRESS_END_FACE_INVALID');
  const number = (value: number) => Number(value.toPrecision(12)).toString();
  const lines = [
    '*HEADING', 'TunaCAD SIM-8 exact-mesh fully constrained thermal stress fixture',
    '*NODE, NSET=NALL',
    ...model.nodes.map((point, node) => String(node + 1) + ',' + point.map(number).join(',')),
    '*ELEMENT, TYPE=C3D10, ELSET=EALL',
    ...model.volumeElements.connectivity.map((cell, element) => String(element + 1) + ',' + neutralToCalculiXC3D10(cell).map(node => node + 1).join(',')),
    '*NSET, NSET=THERMAL_END_REACTION',
    ...Array.from({ length: Math.ceil(endNodes.length / 16) }, (_, line) => endNodes.slice(line * 16, line * 16 + 16).join(',')),
    '*MATERIAL, NAME=THERMAL_STRESS_MATERIAL',
    '*ELASTIC', number(material.youngsModulusMPa) + ',' + number(material.poissonRatio),
    '*EXPANSION, ZERO=0', number(alpha),
    '*SOLID SECTION, ELSET=EALL, MATERIAL=THERMAL_STRESS_MATERIAL',
    '*INITIAL CONDITIONS, TYPE=TEMPERATURE',
    ...initial.map((temperature, node) => String(node + 1) + ',' + number(temperature)),
    '*STEP', '*STATIC', '1,1',
    '*BOUNDARY', 'NALL,1,3,0',
    '*TEMPERATURE',
    ...model.nodes.map((_point, node) => String(node + 1) + ',' + number(transfer.temperaturesByNodeC.get(node)!)),
    '*NODE PRINT, NSET=NALL, GLOBAL=YES', 'U',
    '*NODE PRINT, NSET=THERMAL_END_REACTION, TOTALS=ONLY, GLOBAL=YES', 'RF',
    '*NODE PRINT, NSET=NALL, TOTALS=ONLY, GLOBAL=YES', 'RF',
    '*EL PRINT, ELSET=EALL', 'S',
    '*END STEP',
  ];
  return { deck: lines.join('\n') + '\n', reactionSets: ['THERMAL_END_REACTION', 'NALL'] };
}

/** Signed principal/normal stress is essential here: a hydrostatic state has
 * zero von Mises stress even when each normal stress is large. */
export function normalizeConstrainedThermalStressResult(
  dat: string,
  model: NeutralFemModelV2,
  transfer: ExactThermalTransfer,
) {
  const structural = parseCalculiXDatV2(dat, model, ['THERMAL_END_REACTION', 'NALL']);
  if (structural.displacements.size !== model.nodes.length
    || structural.vonMisesByElement.size !== model.volumeElements.connectivity.length) {
    throw new Error('SIMULATION_THERMAL_STRESS_RESULT_INCOMPLETE');
  }
  const stresses = new Map<number, NeutralVector3[]>();
  let reading = false;
  for (const raw of dat.split(/\r?\n/)) {
    if (raw.length > 4096) throw new Error('SIMULATION_THERMAL_STRESS_RESULT_OVERSIZED');
    const lower = raw.toLowerCase();
    if (lower.includes('stresses') && lower.includes('for set eall')) { reading = true; continue; }
    if (lower.includes('for set') && !lower.includes('stresses')) { reading = false; continue; }
    if (!reading) continue;
    const values = raw.trim().split(/\s+/).map(value => Number(value.replace(/[dD]/g, 'E')));
    if (values.length < 8 || values.some(value => !Number.isFinite(value))) continue;
    const element = values[0] - 1;
    if (!Number.isSafeInteger(element) || element < 0 || element >= model.volumeElements.connectivity.length) {
      throw new Error('SIMULATION_THERMAL_STRESS_RESULT_INVALID');
    }
    const diagonal = values.slice(2, 5) as NeutralVector3;
    const list = stresses.get(element) ?? [];
    list.push(diagonal); stresses.set(element, list);
  }
  if (stresses.size !== model.volumeElements.connectivity.length || [...stresses.values()].some(list => !list.length)) {
    throw new Error('SIMULATION_THERMAL_STRESS_RESULT_INCOMPLETE');
  }
  const diagonalValues = [...stresses.values()].flat();
  const meanNormalStressMPa = diagonalValues.reduce<NeutralVector3>((sum, value) =>
    [sum[0] + value[0], sum[1] + value[1], sum[2] + value[2]], [0, 0, 0])
    .map(value => value / diagonalValues.length) as NeutralVector3;
  const maximumConstrainedDisplacementMm = Math.max(...[...structural.displacements.values()].map(vector => Math.hypot(...vector)));
  return {
    sourceModelId: transfer.sourceModelId,
    targetModelId: transfer.targetModelId,
    transferredNodeCount: transfer.nodeCount,
    transferredTemperatureDigest: transfer.temperatureDigest,
    transferredTemperatureSumC: transfer.temperatureSumC,
    meanNormalStressMPa,
    maximumConstrainedDisplacementMm,
    endFaceReactionForceN: structural.reactions.THERMAL_END_REACTION,
    wholeBodyReactionForceN: structural.reactions.NALL,
    maximumVonMisesStressMPa: Math.max(...structural.vonMisesByElement.values()),
    engineeringUsePermitted: false as const,
  };
}
