// Provider-private bounded Starter-listing reader. No solver or admission bypass.
export const STARTER_LOAD_RESULTANT_TOLERANCE_N = 1e-12; // Existing standalone fixture tolerance.
const reject = (why: string): never => { throw new Error(`OpenRadioss Starter loads: ${why}`); };
const HEADING = 'CONCENTRATED LOADS';
const COLUMNS = ['NODE', 'SKEW', 'DIR', 'LOAD_CURVE', 'SENSOR', 'SCALE_X', 'SCALE_Y'];
const BOUNDARY = 'SPMD IS CHECKING FOR ELEMENT DELETION IN :';
const numeric = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[Ee][+-]?\\d+)?';
const rowPattern = new RegExp(`^\\s*(\\d+)\\s+(\\d+)\\s+([A-Za-z])\\s+(\\d+)\\s+(\\d+)\\s+(${numeric})\\s+(${numeric})\\s*$`);

/** Frozen listing structure: standalone heading, 18-hyphen underline,
 * seven-column schema, rows, then the standalone SPMD deck-check boundary.
 * NCONLD count-summary text cannot be a heading. Reordering rows is harmless;
 * normalized output is sorted by trusted node ID, never inferred from a deck. */
export function readBoundedStarterConcentratedLoads(listing: string,
  expected: readonly { id: number; forceN: number }[], expectedResultantN = 100) {
  if (typeof listing !== 'string' || Buffer.byteLength(listing) > 8 * 1024 * 1024 ||
      !Number.isFinite(expectedResultantN) || expectedResultantN <= 0 ||
      expected.length !== 5 || new Set(expected.map(n => n.id)).size !== 5 ||
      expected.some(n => !Number.isSafeInteger(n.id) || n.id <= 0 || !Number.isFinite(n.forceN) || n.forceN <= 0))
    reject('invalid bounded listing or trusted expected loads');
  const lines = listing.split(/\r?\n/);
  if (lines.length > 20000) reject('line bound exceeded');
  const headings = lines.flatMap((line, i) => line.trim() === HEADING ? [i] : []);
  if (headings.length !== 1) reject('missing or duplicate detailed heading');
  const at = headings[0];
  if (lines[at + 1]?.trim() !== '------------------' ||
      lines[at + 2]?.trim().split(/\s+/).join('|') !== COLUMNS.join('|'))
    reject('wrong detailed heading underline/column schema');
  const end = lines.findIndex((line, i) => i > at + 2 && line.trim() === BOUNDARY);
  if (end < 0 || end - at > 32) reject('missing or unbounded detailed section terminator');
  const rows = lines.slice(at + 3, end).filter(line => line.trim());
  if (rows.length !== 5) reject('missing or extra detailed load row');
  const seen = new Set<string>();
  const loads = rows.map(line => {
    const m = line.match(rowPattern);
    if (!m) return reject('malformed detailed load row');
    const nodeId = Number(m[1]), skewId = Number(m[2]), component = m[3];
    const loadCurveId = Number(m[4]), sensorId = Number(m[5]);
    const scaleX = Number(m[6]), scaleY = Number(m[7]);
    const forceN = scaleX * scaleY, key = `${nodeId}:${component}`;
    if (seen.has(key)) reject('duplicate node/component pair');
    seen.add(key);
    if (!Number.isSafeInteger(nodeId) || nodeId <= 0 || component !== 'X' ||
        skewId !== 0 || loadCurveId !== 1 || sensorId !== 0 || scaleX !== 1 ||
        !Number.isFinite(scaleY) || !Number.isFinite(forceN)) reject('unsupported component/load interpretation');
    const target = expected.find(n => n.id === nodeId);
    if (!target || target.forceN !== forceN) reject('wrong node or interpreted force value');
    return { nodeId, component: 'X' as const, skewId, loadCurveId, sensorId, scaleX, scaleY, forceN };
  }).sort((a, b) => a.nodeId - b.nodeId);
  if (loads.some((n, i) => n.nodeId !== [...expected].sort((a, b) => a.id - b.id)[i].id))
    reject('wrong loaded-node ownership');
  const resultantN = loads.reduce((s, n) => s + n.forceN, 0);
  if (!Number.isFinite(resultantN) || Math.abs(resultantN - expectedResultantN) >= STARTER_LOAD_RESULTANT_TOLERANCE_N)
    reject('wrong axial resultant');
  return Object.freeze({ selector: 'standalone heading + underline + exact columns + SPMD terminator',
    loads: Object.freeze(loads.map(n => Object.freeze(n))), resultantN,
    resultantToleranceN: STARTER_LOAD_RESULTANT_TOLERANCE_N });
}

/** A newly captured hash is a checkpoint, not retroactive completion provenance.
 * Only a separately retained contemporaneous artifact pin can prove original
 * byte identity. Do not synthesize such a pin while correcting a parser. */
export function verifyRetainedStarterArtifactPin(current: Readonly<{
  attemptDigest: string; starterListingDigest: string; restartDigest: string;
  starterDeckDigest: string; engineDeckDigest: string; runtimeDigest: string;
}>, original: typeof current | undefined) {
  const values = Object.values(current);
  if (values.some(v => !/^[a-f0-9]{64}$/.test(v))) reject('invalid artifact checkpoint');
  if (!original) return Object.freeze({ complete: false, state: 'PENDING' as const,
    reason: 'no contemporaneous post-Starter listing/restart pin; current hashes are retrospective checkpoints only' });
  if (Object.keys(current).some(key => current[key as keyof typeof current] !== original[key as keyof typeof current]))
    reject('changed attempt/listing/restart/deck/runtime artifact pin');
  return Object.freeze({ complete: true, state: 'PASS' as const, reason: 'retained original pin matches all bindings' });
}
