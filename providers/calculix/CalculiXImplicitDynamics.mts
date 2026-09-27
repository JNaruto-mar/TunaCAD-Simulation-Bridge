import type { NeutralFemModelV2, NeutralVector3 } from '../../src/simulation/externalSimulationContracts.ts';

export interface DynamicsDatFrame {
  timeS: number;
  displacementsByNode: Map<number, NeutralVector3>;
  supportReactionForceN: NeutralVector3;
  kineticEnergyNmm: number;
  strainEnergyNmm: number;
}

/** Strict ordered U/RF/ELKE/ELSE reader. A partial .dat is never a result. */
export function parseCalculiXImplicitDynamicsDatV2(
  text: string, model: NeutralFemModelV2, requestedTimesS: number[],
): DynamicsDatFrame[] {
  if (text.length > 64 * 1024 * 1024) throw new Error('SIM-9 dynamics result exceeds the bounded parser limit.');
  const lines = text.split(/\r?\n/);
  if (lines.length > 2_000_000 || lines.some(line => line.length > 4096)) {
    throw new Error('SIM-9 dynamics result has oversized records.');
  }
  const heading = /^\s*(displacements \(vx,vy,vz\) for set NALL|total force \(fx,fy,fz\) for set REACTION_001|total kinetic energy for set EALL|total internal energy for set EALL) and time\s+(\S+)\s*$/i;
  const sections: Array<{ kind: number; timeS: number; rows: string[] }> = [];
  let active: (typeof sections)[number] | null = null;
  for (const line of lines) {
    const match = heading.exec(line);
    if (match) {
      const kind = ['displacements (vx,vy,vz) for set NALL',
        'total force (fx,fy,fz) for set REACTION_001',
        'total kinetic energy for set EALL',
        'total internal energy for set EALL'].findIndex(label => label.toLowerCase() === match[1].toLowerCase());
      const timeS = Number(match[2].replace(/[dD]/g, 'E'));
      if (kind < 0 || !Number.isFinite(timeS)) throw new Error('SIM-9 dynamics frame heading is malformed.');
      active = { kind, timeS, rows: [] };
      sections.push(active);
    } else if (line.trim()) {
      if (!active) throw new Error('SIM-9 dynamics result contains an unexpected record.');
      active.rows.push(line.trim());
    }
  }
  if (sections.length !== requestedTimesS.length * 4) throw new Error('SIM-9 dynamics history is incomplete or duplicated.');
  const number = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[EeDd][-+]?\\d+)?';
  const nodeRow = new RegExp('^(\\d+)\\s+(' + number + ')\\s+(' + number + ')\\s+(' + number + ')$');
  const vectorRow = new RegExp('^(' + number + ')\\s+(' + number + ')\\s+(' + number + ')$');
  const scalarRow = new RegExp('^(' + number + ')$');
  const numeric = (value: string) => Number(value.replace(/[dD]/g, 'E'));
  return requestedTimesS.map((timeS, frameIndex) => {
    const group = sections.slice(frameIndex * 4, frameIndex * 4 + 4);
    if (group.some((section, index) => section.kind !== index
      || Math.abs(section.timeS - timeS) > Math.max(1e-9, timeS * 1e-5))) {
      throw new Error('SIM-9 dynamics frames are missing, reordered, or at unexpected times.');
    }
    const displacementsByNode = new Map<number, NeutralVector3>();
    if (group[0].rows.length !== model.nodes.length) throw new Error('SIM-9 dynamics U frame has incomplete nodal coverage.');
    for (const row of group[0].rows) {
      const match = nodeRow.exec(row);
      if (!match) throw new Error('SIM-9 dynamics U frame has malformed nodal data.');
      const node = Number(match[1]) - 1;
      const value: NeutralVector3 = [numeric(match[2]), numeric(match[3]), numeric(match[4])];
      if (!Number.isInteger(node) || node < 0 || node >= model.nodes.length
        || displacementsByNode.has(node) || value.some(component => !Number.isFinite(component))) {
        throw new Error('SIM-9 dynamics U frame has duplicate or nonfinite nodal data.');
      }
      displacementsByNode.set(node, value);
    }
    const reactionMatch = group[1].rows.length === 1 ? vectorRow.exec(group[1].rows[0]) : null;
    const kineticMatch = group[2].rows.length === 1 ? scalarRow.exec(group[2].rows[0]) : null;
    const strainMatch = group[3].rows.length === 1 ? scalarRow.exec(group[3].rows[0]) : null;
    if (!reactionMatch || !kineticMatch || !strainMatch) throw new Error('SIM-9 dynamics RF/energy frame is incomplete.');
    const supportReactionForceN: NeutralVector3 = [
      numeric(reactionMatch[1]), numeric(reactionMatch[2]), numeric(reactionMatch[3]),
    ];
    const kineticEnergyNmm = numeric(kineticMatch[1]);
    const strainEnergyNmm = numeric(strainMatch[1]);
    if (supportReactionForceN.some(value => !Number.isFinite(value))
      || !Number.isFinite(kineticEnergyNmm) || kineticEnergyNmm < 0
      || !Number.isFinite(strainEnergyNmm) || strainEnergyNmm < 0) {
      throw new Error('SIM-9 dynamics RF/energy frame contains nonphysical data.');
    }
    return { timeS, displacementsByNode, supportReactionForceN, kineticEnergyNmm, strainEnergyNmm };
  });
}
