import type { NeutralFemModelV2, NeutralSimulationRequestV2 } from '../../src/simulation/externalSimulationContracts.ts';
import type { StructuralStressHistory } from '../../simulation-bridge/fatigueStructuralBinding.mts';

export interface StressHistorySelection {
  domainId: string;
  elementId: number; // 1-based CalculiX element label
  integrationPoint: number;
  axisAnalysis: [number, number, number];
}

export function validateStressHistorySelection(
  request: NeutralSimulationRequestV2, model: NeutralFemModelV2, selection: StressHistorySelection,
): void {
  if (request.analysis.type !== 'nonlinear_static' || request.model.domains.length !== 1
    || request.materials.length !== 1 || request.materials[0].model !== 'isotropic_linear_elastic'
    || request.loads.length !== 1 || request.loads[0].type !== 'surface_force'
    || request.constraints.length !== 1 || request.constraints[0].type !== 'fixed'
    || request.analysis.settings.steps.length !== 3
    || !Number.isInteger(selection.elementId) || selection.elementId < 1
    || !Number.isInteger(selection.integrationPoint) || selection.integrationPoint < 1 || selection.integrationPoint > 4
    || model.volumeElements.domainIds[selection.elementId - 1] !== selection.domainId
    || selection.domainId !== request.model.domains[0].domainId
    || selection.axisAnalysis.length !== 3 || selection.axisAnalysis.some(value => !Number.isFinite(value))
    || Math.abs(Math.hypot(...selection.axisAnalysis) - 1) > 1e-9) {
    throw new Error('SIM9_FATIGUE_HISTORY_UNSUPPORTED: one elastic domain, fixed face, force face, and exact mesh location are required.');
  }
  const steps = request.analysis.settings.steps;
  if (steps.some((step, index) => step.loadAmplitudes.length !== 1
    || step.loadAmplitudes[0].loadId !== request.loads[0].id
    || step.duration !== steps[0].duration
    || step.loadAmplitudes[0].points.at(-1)?.scaleFactor !== [-1, 1, -1][index])) {
    throw new Error('SIM9_FATIGUE_HISTORY_UNSUPPORTED: only three equal-duration -1/+1/-1 force endpoints are supported.');
  }
}

/** Read signed Cauchy normal stress n·S·n at one actual C3D10 integration
 * point. The first completed endpoint becomes the cycle's time origin;
 * every sample is still a real converged provider frame. */
export function extractCalculiXStressHistory(
  dat: string, stepFrameCounts: number[], stepEndTimesS: number[],
  selection: StressHistorySelection,
): StructuralStressHistory['samples'] {
  const starts = [...dat.matchAll(/^.*displacements.*for set\s+NALL\b.*$/gim)].map(match => match.index!);
  if (stepFrameCounts.length !== 3 || stepEndTimesS.length !== 3
    || stepFrameCounts.some(count => !Number.isInteger(count) || count < 1)
    || starts.length !== stepFrameCounts.reduce((sum, count) => sum + count, 0)) {
    throw new Error('SIM9_FATIGUE_HISTORY_INCOMPLETE: missing or duplicate converged frame.');
  }
  let cumulative = 0;
  const stresses = stepFrameCounts.map(count => {
    cumulative += count;
    const frame = dat.slice(starts[cumulative - 1], starts[cumulative] ?? dat.length);
    const lines = frame.split(/\r?\n/);
    let eall = false; let found: number | null = null; let blocks = 0;
    for (const line of lines) {
      if (/stresses.*for set\s+EALL\b/i.test(line)) { eall = true; blocks++; continue; }
      if (/\bfor set\s+[A-Za-z][A-Za-z0-9_-]*\b/i.test(line)) eall = false;
      if (!eall) continue;
      const fields = line.trim().split(/\s+/);
      if (fields.length !== 8 || !/^\d+$/.test(fields[0]) || !/^\d+$/.test(fields[1])) continue;
      if (Number(fields[0]) !== selection.elementId || Number(fields[1]) !== selection.integrationPoint) continue;
      const components = fields.slice(2).map(value => Number(value.replace(/[dD]/g, 'E')));
      if (found !== null || components.some(value => !Number.isFinite(value))) {
        throw new Error('SIM9_FATIGUE_HISTORY_INVALID: duplicate or nonfinite selected stress row.');
      }
      const [xx, yy, zz, xy, xz, yz] = components;
      const [x, y, z] = selection.axisAnalysis;
      found = x * x * xx + y * y * yy + z * z * zz + 2 * (x * y * xy + x * z * xz + y * z * yz);
    }
    if (blocks !== 1 || found === null || !Number.isFinite(found)) {
      throw new Error('SIM9_FATIGUE_HISTORY_INCOMPLETE: selected integration-point stress was not unique and complete.');
    }
    return found;
  });
  const times = stepEndTimesS.map(time => time - stepEndTimesS[0]);
  if (times[0] !== 0 || !(times[1] > 0) || times[2] !== times[1] * 2) {
    throw new Error('SIM9_FATIGUE_HISTORY_INVALID: selected endpoint times are not a closed three-sample cycle.');
  }
  return [
    { timeS: times[0], stressMPa: stresses[0] },
    { timeS: times[1], stressMPa: stresses[1] },
    { timeS: times[2], stressMPa: stresses[2] },
  ];
}
