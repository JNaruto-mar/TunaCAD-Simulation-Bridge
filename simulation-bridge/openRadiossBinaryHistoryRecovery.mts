// Optional diagnostic comparison for the bounded /TFILE/4 probe.
// The direct T01 reader is authoritative; converter CSV and its REACX column
// are never trusted for canonical reaction semantics or provider admission.
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const globals = [
  'INTERNAL ENERGY', 'KINETIC ENERGY', 'X-MOMENTUM', 'Y-MOMENTUM', 'Z-MOMENTUM',
  'MASS', 'TIME STEP', 'ROTATION ENERGY', 'EXTERNAL WORK', 'SPRING ENERGY',
  'CONTACT ENERGY', 'HOURGLASS ENERGY', 'ELASTIC CONTACT ENERGY',
  'FRICTIONAL CONTACT ENERGY', 'DAMPING CONTACT ENERGY ', 'PLASTIC WORK',
  'ADDED MASS', 'PERCENTAGE ADDED MASS', 'INLET MASS', 'OUTLET MASS',
  'INLET ENERGY', 'OUTLET ENERGY',
] as const;

export type BoundedCsvFrame = Readonly<{
  timeS: number;
  global: Readonly<{ internalEnergyNmm: number; kineticEnergyNmm: number;
    externalWorkNmm: number; massMg: number; addedMassMg: number }>;
  nodes: ReadonlyMap<number, Readonly<{ dxMm: number; vxMmPerS: number;
    axMmPerS2: number; reactionCsvValue: number }>>;
}>;

export type BoundedCsvHistory = Readonly<{
  frames: readonly BoundedCsvFrame[];
  columnCount: number;
  // The installed converter has not yet proved that this column is raw impulse.
  reactionProvenance: 'unverified_converter_column';
}>;

export async function inspectOpenRadiossConverter(executablePath: string) {
  if (basename(executablePath).toLowerCase() !== 'th_to_csv_win64.exe') {
    throw new Error('Unexpected converter executable identity');
  }
  const details = await stat(executablePath);
  if (!details.isFile() || details.size < 1024) throw new Error('Missing or invalid converter executable');
  const bytes = await readFile(executablePath);
  if (bytes.subarray(0, 2).toString('ascii') !== 'MZ') throw new Error('Converter is not a Windows PE executable');
  return Object.freeze({ executablePath, bytes: bytes.length, sha256: sha256(bytes) });
}

export function planOpenRadiossConversion(converterPath: string, binaryTfilePath: string) {
  const name = basename(binaryTfilePath);
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,45}T\d{2}$/.test(name)) {
    throw new Error('Unexpected bounded binary T-file name');
  }
  if (converterPath.toLowerCase() === binaryTfilePath.toLowerCase()) throw new Error('Converter and input paths collide');
  // The official converter accepts one T-file pathname and writes <input>.csv.
  // Keep the path short: its published C implementation uses 100-byte buffers.
  if (binaryTfilePath.length > 75) throw new Error('T-file path exceeds bounded converter input length');
  return Object.freeze({ executablePath: converterPath, args: [binaryTfilePath],
    cwd: dirname(binaryTfilePath), outputPath: `${binaryTfilePath}.csv`,
    titlesPath: join(dirname(binaryTfilePath), `${name}_TITLES`) });
}

export function identifyConversionArtifacts(input: Buffer, output: Buffer, converterExitCode: number) {
  if (converterExitCode !== 0) throw new Error('OpenRadioss converter failed');
  if (!input.length || input.length > 8 * 1024 * 1024 || !output.length || output.length > 8 * 1024 * 1024) {
    throw new Error('Missing or oversized binary/CSV conversion artifact');
  }
  return Object.freeze({ inputBytes: input.length, inputSha256: sha256(input),
    csvBytes: output.length, csvSha256: sha256(output) });
}

function csvCells(line: string): string[] {
  // The official converter emits only simple quoted header cells and bare
  // comma-separated numeric cells for this fixture; reject other CSV dialects.
  return line.split(',').map(cell => cell.trim());
}

export function parseOpenRadiossConvertedCsv(
  csv: string | Buffer,
  expectedNodeIds: readonly number[],
  requiredThroughS: number,
): BoundedCsvHistory {
  const bytes = Buffer.isBuffer(csv) ? csv : Buffer.from(csv, 'utf8');
  if (!bytes.length || bytes.length > 8 * 1024 * 1024 || bytes.includes(0)) throw new Error('Invalid CSV byte envelope');
  const text = bytes.toString('utf8');
  if (!/\r?\n$/.test(text)) throw new Error('Incomplete CSV final line');
  if (!Number.isFinite(requiredThroughS) || requiredThroughS <= 0) throw new Error('Invalid required duration');
  if (expectedNodeIds.length !== 10 || new Set(expectedNodeIds).size !== 10 ||
      expectedNodeIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Invalid bounded node identities');
  const lines = text.split(/\r?\n/);
  lines.pop();
  if (lines.length < 3 || lines.length > 66 || lines.some(line => !line.trim())) throw new Error('Missing or excessive CSV frames');
  const header = csvCells(lines[0]);
  if (header.length !== 63) throw new Error('Unexpected CSV column count');
  const quoted = (value: string) => `"${value}"`;
  if (header[0] !== quoted('time') || globals.some((name, i) => header[i + 1] !== quoted(name))) {
    throw new Error('Missing, duplicate, or reordered global energy/history columns');
  }
  for (let index = 0; index < 10; index++) {
    const id = expectedNodeIds[index];
    for (let channel = 0; channel < 4; channel++) {
      const column = 23 + index * 4 + channel;
      const candidate = header[column].match(/^"Bounded axial bar nodes\s+(\d+)\s+node_(\d+)\s+var (\d+)"$/);
      if (!candidate || Number(candidate[1]) !== id || Number(candidate[2]) !== id ||
          Number(candidate[3]) !== column) {
        throw new Error('Missing, duplicate, or reordered node/channel identity');
      }
    }
  }
  const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/;
  const frames: BoundedCsvFrame[] = [];
  for (const line of lines.slice(1)) {
    const cells = csvCells(line);
    if (cells.length !== 63) throw new Error('Incomplete or excess CSV frame values');
    const numbers = cells.map(value => {
      if (!numeric.test(value)) throw new Error('Malformed or non-finite CSV value');
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) throw new Error('Non-finite CSV value');
      return parsed;
    });
    const timeS = numbers[0];
    if (timeS < 0 || (frames.length === 0 && timeS !== 0) ||
        (frames.length > 0 && timeS <= frames[frames.length - 1].timeS)) {
      throw new Error('Missing, duplicate, or reordered CSV frame time');
    }
    if (numbers[6] <= 0 || Math.abs(numbers[17]) > 1e-12) {
      throw new Error('Invalid total mass or actual mass scaling in converted history');
    }
    const nodes = new Map<number, { dxMm: number; vxMmPerS: number;
      axMmPerS2: number; reactionCsvValue: number }>();
    for (let index = 0; index < 10; index++) {
      const at = 23 + index * 4;
      nodes.set(expectedNodeIds[index], { dxMm: numbers[at], vxMmPerS: numbers[at + 1],
        axMmPerS2: numbers[at + 2], reactionCsvValue: numbers[at + 3] });
    }
    frames.push({ timeS, global: { internalEnergyNmm: numbers[1], kineticEnergyNmm: numbers[2],
      massMg: numbers[6], externalWorkNmm: numbers[9], addedMassMg: numbers[17] }, nodes });
  }
  if (frames.length < 2 || frames[frames.length - 1].timeS < requiredThroughS) {
    throw new Error('Complete CSV frames do not cover required positive-time interval');
  }
  return { frames, columnCount: 63, reactionProvenance: 'unverified_converter_column' };
}

export function differentiateVerifiedReactionImpulse(
  timesS: readonly number[], impulseNs: readonly number[],
) {
  if (timesS.length < 2 || timesS.length !== impulseNs.length || timesS.length > 64 ||
      timesS[0] !== 0 || timesS.some((t, i) => !Number.isFinite(t) || t < 0 ||
        (i > 0 && t <= timesS[i - 1])) || impulseNs.some(value => !Number.isFinite(value))) {
    throw new Error('Incomplete, unordered, or non-finite verified impulse history');
  }
  return timesS.map((timeS, index) => {
    const lo = index === 0 ? 0 : index - 1;
    const hi = index === 0 ? 1 : index === timesS.length - 1 ? index : index + 1;
    const forceN = (impulseNs[hi] - impulseNs[lo]) / (timesS[hi] - timesS[lo]);
    if (!Number.isFinite(forceN)) throw new Error('Non-finite derived reaction force');
    return Object.freeze({ timeS, rawImpulseNs: impulseNs[index], derivedReactionN: forceN });
  });
}
