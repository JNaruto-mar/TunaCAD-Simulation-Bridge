// Historical/debug-only ASCII /TFILE/3 reader for the failed axial-bar fixture.
// Future bounded recovery is planned through binary /TFILE/4 plus strict validation.
// This does not grant OpenRadioss provider admission. A prefix of complete frames
// is diagnostic evidence, never an admissible result when the tail is incomplete.
export type OpenRadiossFrame = Readonly<{
  timeS: number;
  global: readonly number[];
  nodal: ReadonlyMap<number, Readonly<{ dxMm: number; vxMmPerS: number; axMmPerS2: number; reacXN: number }>>;
}>;

export type OpenRadiossHistory = Readonly<{
  nodeIds: readonly number[];
  channelCodes: readonly number[];
  frames: readonly OpenRadiossFrame[];
}>;

const expectedCodes = [1, 4, 7, 620] as const; // DX, VX, AX, REACX in the retained Starter header.
const marker = (line: string, count: number, type: 'I' | 'R', chars?: number) =>
  new RegExp(`^ZZZZZEOR\\s+${count}${type}${chars === undefined ? '' : `\\s+${chars}C`}\\s*$`).test(line);
const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[EeDd][+-]?\d+)?$/;

function values(lines: readonly string[], start: number, count: number, kind: 'I' | 'R') {
  const result: number[] = [];
  let at = start;
  while (at < lines.length && !lines[at].startsWith('ZZZZZEOR')) {
    const line = lines[at++];
    if (!line.trim()) throw new Error('Blank numeric record line');
    for (const token of line.trim().split(/\s+/)) {
      if (!numeric.test(token) || (kind === 'I' && !/^[+-]?\d+$/.test(token))) {
        throw new Error(`Malformed or non-finite ${kind} value`);
      }
      const value = Number(token.replace(/[Dd]/, 'E'));
      if (!Number.isFinite(value) || (kind === 'I' && !Number.isSafeInteger(value))) {
        throw new Error(`Non-finite or unsafe ${kind} value`);
      }
      result.push(value);
      if (result.length > count) throw new Error(`Record exceeds declared ${count}${kind} values`);
    }
  }
  if (result.length !== count) throw new Error(`Incomplete ${count}${kind} record: ${result.length}/${count}`);
  return { result, at };
}

export function parseOpenRadiossAxialTFile(
  raw: string | Buffer,
  expectedNodeIds: readonly number[],
  requiredThroughS: number,
): OpenRadiossHistory {
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'utf8');
  if (!bytes.length || bytes.length > 2 * 1024 * 1024 || bytes.includes(0)) throw new Error('Invalid T-file byte envelope');
  const text = bytes.toString('utf8');
  if (!/\r?\n$/.test(text)) throw new Error('T-file ends without a complete line');
  if (!Number.isFinite(requiredThroughS) || requiredThroughS <= 0) throw new Error('Invalid required duration');
  if (expectedNodeIds.length !== 10 || new Set(expectedNodeIds).size !== 10 ||
      expectedNodeIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Invalid bounded node selection');

  const lines = text.split(/\r?\n/);
  lines.pop(); // trailing line break, not a data line
  const groupMarkers = lines.flatMap((line, index) => marker(line, 5, 'I', 40) ? [index] : []);
  if (groupMarkers.length !== 2) throw new Error('Expected exactly global and nodal history groups');
  const globalMarker = groupMarkers[0];
  if (!/^\s*0\s+0\s+0\s+1\s+0GLOBAL MODEL\s*$/.test(lines[globalMarker + 1])) {
    throw new Error('Unexpected global history group');
  }
  if (!marker(lines[globalMarker + 2], 1, 'I')) throw new Error('Missing global group identity');
  const globalId = values(lines, globalMarker + 3, 1, 'I');
  if (globalId.result[0] !== 1) throw new Error('Unexpected global group identity');
  const group = groupMarkers[1];
  const descriptor = lines[group + 1].match(/^\s*1\s+0\s+0\s+(\d+)\s+(\d+)(?:\D.*)?$/);
  if (!descriptor || Number(descriptor[1]) !== 10 || Number(descriptor[2]) !== 4) {
    throw new Error('Unexpected nodal group cardinality');
  }
  let at = group + 2;
  const nodeIds: number[] = [];
  for (let index = 0; index < 10; index++) {
    if (!marker(lines[at++], 1, 'I', 40)) throw new Error('Missing or reordered nodal identity');
    const match = lines[at++].match(/^\s*(\d+)node_(\d+)\s*$/);
    if (!match || match[1] !== match[2]) throw new Error('Malformed nodal identity');
    nodeIds.push(Number(match[1]));
  }
  if (new Set(nodeIds).size !== 10 || nodeIds.some((id, index) => id !== expectedNodeIds[index])) {
    throw new Error('Duplicate, missing, or reordered node');
  }
  if (!marker(lines[at++], 4, 'I')) throw new Error('Missing or reordered nodal channel record');
  const channelRecord = values(lines, at, 4, 'I');
  at = channelRecord.at;
  if (channelRecord.result.some((code, index) => code !== expectedCodes[index])) {
    throw new Error('Duplicate, missing, or reordered nodal channel');
  }
  const globalCodeMarker = lines.findIndex(line => marker(line, 22, 'I'));
  if (globalCodeMarker < 0 || globalCodeMarker >= globalMarker) throw new Error('Missing global channel schema');
  const globalCodes = values(lines, globalCodeMarker + 1, 22, 'I').result;
  if (globalCodes.some((code, index) => code !== index + 1)) throw new Error('Unexpected global channel schema');
  const frames: OpenRadiossFrame[] = [];
  while (at < lines.length) {
    if (frames.length >= 64) throw new Error('T-file frame count exceeds bound');
    if (!marker(lines[at++], 1, 'R')) throw new Error('Missing or reordered frame-time record');
    const time = values(lines, at, 1, 'R'); at = time.at;
    if (time.result[0] < 0 || (frames.length === 0 && time.result[0] !== 0) ||
        (frames.length > 0 && time.result[0] <= frames[frames.length - 1].timeS)) {
      throw new Error('Invalid or reordered frame time');
    }
    if (!marker(lines[at++], 22, 'R')) throw new Error('Missing or reordered global frame record');
    const global = values(lines, at, 22, 'R'); at = global.at;
    if (!marker(lines[at++], 40, 'R')) throw new Error('Missing or reordered nodal frame record');
    const nodal = values(lines, at, 40, 'R'); at = nodal.at;
    const byNode = new Map<number, { dxMm: number; vxMmPerS: number; axMmPerS2: number; reacXN: number }>();
    for (let index = 0; index < 10; index++) {
      const offset = index * 4;
      byNode.set(nodeIds[index], {
        dxMm: nodal.result[offset], vxMmPerS: nodal.result[offset + 1],
        axMmPerS2: nodal.result[offset + 2], reacXN: nodal.result[offset + 3],
      });
    }
    frames.push({ timeS: time.result[0], global: global.result, nodal: byNode });
  }
  if (!frames.length || frames[frames.length - 1].timeS < requiredThroughS) {
    throw new Error('Complete T-file frames do not cover required result interval');
  }
  return { nodeIds, channelCodes: channelRecord.result, frames };
}
