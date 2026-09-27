import type { NeutralFemModelV2, NeutralVector3 } from '../../src/simulation/externalSimulationContracts.ts';

export interface CalculiXHarmonicDatV2 {
  frequencyHz: number;
  realDisplacementsByNode: Map<number, NeutralVector3>;
  imaginaryDisplacementsByNode: Map<number, NeutralVector3>;
  realReactionN: NeutralVector3;
  imaginaryReactionN: NeutralVector3;
}

/** CalculiX 2.16 NODE PRINT emits one real U/RF pair and one imaginary U/RF
 * pair for a degenerate two-point, one-distinct-frequency harmonic card. */
export function parseCalculiXHarmonicDatV2(
  text: string, model: NeutralFemModelV2, requestedFrequencyHz: number,
): CalculiXHarmonicDatV2 {
  if (text.length > 32_000_000) throw new Error('SIM-9 harmonic result exceeds its bounded text limit.');
  const lines = text.split(/\r?\n/);
  if (lines.length > 500_000 || lines.some(line => line.length > 4096)) {
    throw new Error('SIM-9 harmonic result exceeds its bounded record limit.');
  }
  const u: Array<Map<number, NeutralVector3>> = [];
  const rf: NeutralVector3[] = [];
  const heading = /^\s*(displacements \(vx,vy,vz\) for set NALL|total force \(fx,fy,fz\) for set REACTION_001) and time\s+([+\-\d.EeDd]+)\s*$/i;
  const number = '[+\\-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)[EeDd][+\\-]?\\d+';
  const displacement = new RegExp('^\\s*(\\d+)\\s+(' + number + ')\\s+(' + number + ')\\s+(' + number + ')\\s*$');
  const reaction = new RegExp('^\\s*(' + number + ')\\s+(' + number + ')\\s+(' + number + ')\\s*$');
  const modeRow = new RegExp('^\\s*\\d+\\s+(' + number + ')\\s+(' + number + ')\\s+(' + number + ')\\s+(' + number + ')\\s*$');
  const modalFrequencies: number[] = [];
  let inModalTable = false;
  for (const line of lines) {
    if (/MODE NO\s+EIGENVALUE/.test(line)) { inModalTable = true; continue; }
    if (/MODE NO\s+FREQUENCY\s+FACTOR/.test(line)) inModalTable = false;
    if (!inModalTable) continue;
    const row = modeRow.exec(line);
    if (row) modalFrequencies.push(Number(row[3].replace(/[dD]/g, 'E')));
  }
  if (!modalFrequencies.length || modalFrequencies.some(value => !Number.isFinite(value) || value < 0)
    || requestedFrequencyHz > Math.max(...modalFrequencies)
    || modalFrequencies.some(value => Math.abs(value - requestedFrequencyHz) <= requestedFrequencyHz * .005)) {
    throw new Error('SIM-9 harmonic frequency is outside modal coverage or too close to an undamped resonance.');
  }
  let state: 'u' | 'rf' | null = null;
  let active = new Map<number, NeutralVector3>();
  const parseNumber = (value: string) => Number(value.replace(/[dD]/g, 'E'));
  for (const line of lines) {
    const match = heading.exec(line);
    if (!match && /^\s*(displacements|total force).*for set/i.test(line)) {
      throw new Error('SIM-9 harmonic result contains an unexpected output set or malformed frequency header.');
    }
    if (match) {
      const frequencyHz = parseNumber(match[2]);
      if (!Number.isFinite(frequencyHz)
        || Math.abs(frequencyHz - requestedFrequencyHz) > Math.max(1e-5, requestedFrequencyHz * 1e-6)) {
        throw new Error('SIM-9 harmonic result has a missing or unexpected excitation frequency.');
      }
      if (state === 'u' && active.size !== model.nodes.length) {
        throw new Error('SIM-9 harmonic displacement block is incomplete.');
      }
      if (state === 'u') u.push(active);
      if (state === 'rf' && rf.length !== u.length - 1) {
        throw new Error('SIM-9 harmonic reaction block is incomplete.');
      }
      if (u.length > 2 || rf.length > 2
        || (match[1].toLowerCase().startsWith('displacements') && u.length !== rf.length)
        || (match[1].toLowerCase().startsWith('total force') && u.length !== rf.length + 1)) {
        throw new Error('SIM-9 harmonic complex blocks are duplicated or reordered.');
      }
      state = match[1].toLowerCase().startsWith('displacements') ? 'u' : 'rf';
      active = new Map();
      continue;
    }
    if (state === 'u') {
      const row = displacement.exec(line);
      if (!row) continue;
      const node = Number(row[1]) - 1;
      const value = row.slice(2).map(parseNumber) as NeutralVector3;
      if (!Number.isInteger(node) || node < 0 || node >= model.nodes.length
        || active.has(node) || value.some(component => !Number.isFinite(component))) {
        throw new Error('SIM-9 harmonic displacement node is malformed or duplicated.');
      }
      active.set(node, value);
    } else if (state === 'rf') {
      const row = reaction.exec(line);
      if (!row) continue;
      const value = row.slice(1).map(parseNumber) as NeutralVector3;
      if (rf.length >= 2 || value.some(component => !Number.isFinite(component))) {
        throw new Error('SIM-9 harmonic reaction is malformed or duplicated.');
      }
      rf.push(value);
      state = null;
    } else if (u.length && reaction.test(line)) {
      throw new Error('SIM-9 harmonic reaction block contains an unexpected extra row.');
    }
  }
  if (state !== null || u.length !== 2 || rf.length !== 2
    || u.some(block => block.size !== model.nodes.length)) {
    throw new Error('SIM-9 harmonic complex history is incomplete.');
  }
  return { frequencyHz: requestedFrequencyHz, realDisplacementsByNode: u[0],
    imaginaryDisplacementsByNode: u[1], realReactionN: rf[0], imaginaryReactionN: rf[1] };
}
