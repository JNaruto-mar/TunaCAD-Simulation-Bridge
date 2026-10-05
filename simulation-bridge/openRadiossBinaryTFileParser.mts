// Bounded provider-private IEEE T01 reader. The format follows OpenRadioss
// Tools th_to_csv.c (t01Read/read_i_c/read_r_c/eor_c_read) and Engine hist1.F.
import { createHash } from 'node:crypto';
import { differentiateVerifiedReactionImpulse } from './openRadiossBinaryHistoryRecovery.mts';
import { validateOpenRadiossExplicitCadence, type ExplicitCadenceCompletion } from './openRadiossHistoryCoverage.mts';

const CHANNELS = [1, 4, 7, 620] as const; // DX VX AX REACX
const MAX_BYTES = 8 * 1024 * 1024;
const reject = (why: string): never => { throw new Error(`OpenRadioss T01: ${why}`); };
const ints = (data: Buffer, count: number) => {
  if (data.length !== count * 4) reject('integer record length');
  return Array.from({ length: count }, (_, i) => data.readInt32BE(i * 4));
};
const floats = (data: Buffer, count: number) => {
  if (data.length !== count * 4) reject('real record length');
  const values = Array.from({ length: count }, (_, i) => data.readFloatBE(i * 4));
  if (values.some(v => !Number.isFinite(v))) reject('non-finite value');
  return values;
};
const text = (data: Buffer, offset: number, count: number) => {
  const bytes = data.subarray(offset, offset + count);
  if (bytes.length !== count || bytes.some(b => b < 32 || b > 126)) reject('invalid title');
  return bytes.toString('ascii').trimEnd();
};
const equals = (a: readonly number[], b: readonly number[], name: string) => {
  if (a.length !== b.length || a.some((v, i) => v !== b[i])) reject(`wrong ${name} identities/order`);
};
class Reader {
  at = 0;
  readonly bytes: Buffer;
  constructor(bytes: Buffer) { this.bytes = bytes; }
  get done() { return this.at === this.bytes.length; }
  record(): Buffer {
    if (this.at + 8 > this.bytes.length) reject('truncated record');
    const size = this.bytes.readInt32BE(this.at);
    if (size < 0 || size > MAX_BYTES || this.at + 8 + size > this.bytes.length) reject('truncated/oversized record');
    const start = this.at + 4;
    const end = start + size;
    if (this.bytes.readInt32BE(end) !== size) reject('record boundary mismatch');
    this.at = end + 4;
    return this.bytes.subarray(start, end);
  }
}
function decode3040Header(r: Reader) {
  // t01Read: THICODE<3041 => 40-char hierarchy titles; no additional records.
  return { version: 3040 as const, titleWidth: 40 as const };
}
function decode4021Header(r: Reader) {
  // t01Read: THICODE=4021 => 100-char titles and three additional records.
  equals(ints(r.record(), 1), [2], 'additional-record count');
  equals(ints(r.record(), 1), [100], 'title width');
  if (floats(r.record(), 3).some(v => v <= 0)) reject('invalid unit factors');
  return { version: 4021 as const, titleWidth: 100 as const };
}
export function parseBoundedOpenRadiossTFile4(bytes: Buffer, requiredThroughS: number,
  completion?: ExplicitCadenceCompletion,
  meshSummation?: { nodeCount: number; elementCount: number },
  expectedNodeIds:readonly number[] = []) {
  // A file cannot choose its own trusted entities. Production obtains this
  // exact ordered set from the mesh/FACE admission used to emit the deck.
  if(expectedNodeIds.length<4 || expectedNodeIds.length>128 || new Set(expectedNodeIds).size!==expectedNodeIds.length
    ||expectedNodeIds.some(id=>!Number.isSafeInteger(id)||id<=0||id>999999999))reject('invalid expected node identities');
  const nodeIds=Object.freeze([...expectedNodeIds]);
  // Historical no-solver/oracle callers retain their frozen mesh. Production
  // recovery supplies counts independently admitted from the actual mesh. These
  // counts affect ONLY the double-summation roundoff bound, never binary layout.
  if (!meshSummation || !Number.isSafeInteger(meshSummation.nodeCount) || meshSummation.nodeCount < 4 || meshSummation.nodeCount > 100000
    || !Number.isSafeInteger(meshSummation.elementCount) || meshSummation.elementCount < 1 || meshSummation.elementCount > 50000)
    reject('invalid admitted mesh summation counts');
  if (!Buffer.isBuffer(bytes) || bytes.length < 32 || bytes.length > MAX_BYTES) reject('invalid T01 envelope');
  if (!Number.isFinite(requiredThroughS) || requiredThroughS <= 0) reject('invalid required duration');
  const r = new Reader(bytes);
  const header = r.record();
  if (header.length !== 84) reject('unsupported T01 version/header');
  const thicode = header.readInt32BE(0);
  if (thicode !== 3040 && thicode !== 4021) reject('unsupported T01 version/header');
  text(header, 4, 80);
  if (r.record().length !== 80) reject('wrong release/date record');
  const schema = thicode === 3040 ? decode3040Header(r) : decode4021Header(r);
  const width = schema.titleWidth;
  const [parts, mats, geos, subsets, groups, globalCount] = ints(r.record(), 6);
  if (parts !== 1 || mats !== 2 || geos !== 1 || subsets !== 1 || groups !== 1 || globalCount !== 22)
    reject('unsupported hierarchy');
  equals(ints(r.record(), 22), Array.from({ length: 22 }, (_, i) => i + 1), 'global channel');
  const part = r.record();
  if (part.length !== width + 20 || part.readInt32BE(0) !== 1) reject('wrong part identity');
  text(part, 4, width);
  const partChannelCount = part.readInt32BE(width + 16);
  if (partChannelCount < 0 || partChannelCount > 22) reject('invalid part channel count');
  if (partChannelCount) {
    const codes = ints(r.record(), partChannelCount);
    if (new Set(codes).size !== codes.length) reject('duplicate part channel');
  }
  const materialIds = [];
  for (let i = 0; i < 2; i++) {
    const material = r.record();
    if (material.length !== width + 4) reject('wrong material record');
    materialIds.push(material.readInt32BE(0));
    text(material, 4, width);
  }
  equals(materialIds, [1, 0], 'material');
  const geo = r.record();
  if (geo.length !== width + 4 || geo.readInt32BE(0) !== 1) reject('wrong geometry record');
  text(geo, 4, width);
  const subset = r.record();
  if (subset.length !== width + 20) reject('wrong subset record');
  const [subsetId, , childCount, childParts, subsetChannels] = Array.from({ length: 5 }, (_, i) => subset.readInt32BE(i * 4));
  if (subsetId !== 0 || childCount < 0 || childCount > 1 || childParts < 0 || childParts > 1 ||
      subsetChannels < 0 || subsetChannels > 22) reject('unsupported subset');
  text(subset, 20, width);
  if (childCount) ints(r.record(), childCount);
  if (childParts) ints(r.record(), childParts);
  if (subsetChannels) {
    const codes = ints(r.record(), subsetChannels);
    if (new Set(codes).size !== codes.length) reject('duplicate subset channel');
  }
  const group = r.record();
  if (group.length !== width + 20) reject('wrong group record');
  const groupFields = Array.from({ length: 5 }, (_, i) => group.readInt32BE(i * 4));
  if (groupFields[0] !== 1 || groupFields[1] !== 0 || groupFields[2] !== 0 ||
      groupFields[3] !== nodeIds.length || groupFields[4] !== 4 ||
      text(group, 20, width) !== 'Bounded axial bar nodes') reject('wrong group identity');
  for (const id of nodeIds) {
    const node = r.record();
    if (node.length !== width + 4 || node.readInt32BE(0) !== id || text(node, 4, width) !== `node_${id}`)
      reject('missing/duplicate/reordered node');
  }
  equals(ints(r.record(), 4), CHANNELS, 'node channel');
  const raw: { timeS: number; global: number[]; nodes: number[][] }[] = [];
  while (!r.done) {
    if (raw.length >= 64) reject('too many frames');
    const [timeS] = floats(r.record(), 1);
    if (timeS < 0 || (raw.length === 0 && timeS !== 0) ||
        (raw.length > 0 && timeS <= raw[raw.length - 1].timeS)) reject('non-monotonic/missing time');
    const global = floats(r.record(), 22);
    if (global[5] <= 0) reject('invalid mass or mass scaling');
    if (global[16] !== 0) {
      // hist2.F writes XMASS-MASS0_START; ecrit.F recomputes XMASS by a
      // double-precision nodal sum. An admitted mesh can retain a constant
      // negative initialization subtraction
      // residual within the standard gamma_n double-summation error bound.
      // Do not allow positive added mass or any later residual/mass change.
      const u = 2 ** -53;
      const n = meshSummation!.nodeCount + meshSummation!.elementCount;
      const sumRoundoffBound = (n * u / (1 - n * u)) * global[5];
      if (!completion || global[16] > 0 || Math.abs(global[16]) > sumRoundoffBound)
        reject('invalid mass or mass scaling');
    }
    if (raw.length && global[5] !== raw[0].global[5]) reject('inconsistent mass history');
    if (raw.length && global[16] !== raw[0].global[16]) reject('changed added mass history');
    if (partChannelCount) floats(r.record(), partChannelCount);
    if (subsetChannels) floats(r.record(), subsetChannels);
    const nodeValues = floats(r.record(), nodeIds.length*4);
    raw.push({ timeS, global, nodes: nodeIds.map((_, i) => nodeValues.slice(i * 4, i * 4 + 4)) });
  }
  if (raw.length < 2) reject('incomplete time coverage');
  const coverage = completion
    ? validateOpenRadiossExplicitCadence(raw.map(row => row.timeS),
      raw.map(row => row.global[6]), requiredThroughS, completion)
    : undefined;
  if (!completion && raw[raw.length - 1].timeS < requiredThroughS) reject('incomplete time coverage');
  const times = raw.map(row => row.timeS);
  const reactions = nodeIds.map((_, n) =>
    differentiateVerifiedReactionImpulse(times, raw.map(row => row.nodes[n][3])));
  const frames = raw.map((row, i) => ({
    timeS: row.timeS,
    global: { rawOrderedValues: Object.freeze([...row.global]),
      internalEnergyNmm: row.global[0], kineticEnergyNmm: row.global[1],
      externalWorkNmm: row.global[8], massMg: row.global[5], addedMassMg: row.global[16],
      addedMassChangeFromInitializationMg: row.global[16] - raw[0].global[16],
      timestepS: row.global[6] },
    nodes: new Map(nodeIds.map((id, n) => [id, {
      dxMm: row.nodes[n][0], vxMmPerS: row.nodes[n][1], axMmPerS2: row.nodes[n][2],
      reactionImpulseNs: row.nodes[n][3], reactionForceN: reactions[n][i].derivedReactionN,
    }] as const)),
  }));
  return Object.freeze({ format: `TFILE/4 T01 ${schema.version}`, thicode: schema.version, coverage, nodeIds,
    channelCodes: CHANNELS, sha256: createHash('sha256').update(Uint8Array.from(bytes)).digest('hex'),
    reactionProvenance: 'raw REACX impulse N.s; TunaCAD dI/dt force N' as const, frames });
}
