// Provider-private bounded Starter-listing reader. No solver or admission bypass.
import {boundedRadiossDecimal as decimal,exactRadiossDecimalSumWithin,exactRadiossDecimalSum} from './openRadiossDecimal.mts';
export const STARTER_LOAD_RESULTANT_TOLERANCE_N = 1e-12; // Existing standalone fixture tolerance.
const reject = (why: string): never => { throw new Error(`OpenRadioss Starter loads: ${why}`); };
const HEADING = 'CONCENTRATED LOADS';
const COLUMNS = ['NODE', 'SKEW', 'DIR', 'LOAD_CURVE', 'SENSOR', 'SCALE_X', 'SCALE_Y'];
const BOUNDARY = 'SPMD IS CHECKING FOR ELEMENT DELETION IN :';
const numeric = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[Ee][+-]?\\d+)?';
const rowPattern = new RegExp(`^\\s*(\\d+)\\s+(\\d+)\\s+([A-Za-z])\\s+(\\d+)\\s+(\\d+)\\s+(${numeric})\\s+(${numeric})\\s*$`);

// Frozen hm_read_cload.F (a62b27e6baa555d222a580d6218867d0be4d70b5,
// lines 271-275): FORC(1,I)=FCY, then FCY is printed with 1PG20.13.
// This is a rounded report of the interpreted load, not its exact storage.
// Compare decimal rounding intervals exactly, including half-quantum ties.
function roundedListingValue(token:string, expected:string) {
  const printed=decimal(token), trusted=decimal(expected);
  // Fixed G form has 13 significant digits; scaled exponential G form can
  // have 14. Never admit a coarser report by deriving a larger tolerance.
  if(printed.digits<13||printed.digits>14) reject('unsupported listing precision');
  const exponent=Math.min(printed.exponent,trusted.exponent);
  const p=printed.coefficient*10n**BigInt(printed.exponent-exponent);
  const t=trusted.coefficient*10n**BigInt(trusted.exponent-exponent);
  const difference=p>t?p-t:t-p;
  const quantum=10n**BigInt(printed.exponent-exponent);
  if(2n*difference>quantum) reject('wrong interpreted force beyond printed precision');
  return 0.5*10**printed.exponent;
}

/** Frozen listing structure: standalone heading, 18-hyphen underline,
 * seven-column schema, rows, then the standalone SPMD deck-check boundary.
 * NCONLD count-summary text cannot be a heading. Reordering rows is harmless;
 * normalized output is sorted by trusted node ID, never inferred from a deck. */
export function readBoundedStarterConcentratedLoads(listing: string,
  expected: readonly { id: number; forceN: number; forceText?:string }[], expectedResultantN = 100) {
  if (typeof listing !== 'string' || Buffer.byteLength(listing) > 8 * 1024 * 1024 ||
      !Number.isFinite(expectedResultantN) || expectedResultantN <= 0 ||
      expected.length < 3 || expected.length > 128 || new Set(expected.map(n => n.id)).size !== expected.length ||
      expected.some(n => !Number.isSafeInteger(n.id) || n.id <= 0 || !Number.isFinite(n.forceN) || n.forceN <= 0))
    reject('invalid bounded listing or trusted expected loads');
  const serialized=expected.some(n=>n.forceText!==undefined);
  if(serialized&&expected.some(n=>typeof n.forceText!=='string'||!/^\d{1,7}\.\d{12}$/.test(n.forceText)
      ||n.forceText.length>20||Number(n.forceText)!==n.forceN))reject('inconsistent serialized load evidence');
  const lines = listing.split(/\r?\n/);
  if (lines.length > 20000) reject('line bound exceeded');
  const headings = lines.flatMap((line, i) => line.trim() === HEADING ? [i] : []);
  if (headings.length !== 1) reject('missing or duplicate detailed heading');
  const at = headings[0];
  if (lines[at + 1]?.trim() !== '------------------' ||
      lines[at + 2]?.trim().split(/\s+/).join('|') !== COLUMNS.join('|'))
    reject('wrong detailed heading underline/column schema');
  const end = lines.findIndex((line, i) => i > at + 2 && line.trim() === BOUNDARY);
  if (end < 0 || end - at > expected.length+16) reject('missing or unbounded detailed section terminator');
  const rows = lines.slice(at + 3, end).filter(line => line.trim());
  if (rows.length !== expected.length) reject('missing or extra detailed load row');
  const seen = new Set<string>();
  const printedTokens:string[]=[];
  let listingRoundingBoundN=0, rounded=false;
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
    if (!target) return reject('wrong node or interpreted force value');
    const trustedToken=target.forceText??String(target.forceN);printedTokens.push(m[7]);
    if(serialized?!exactRadiossDecimalSumWithin([m[7]],trustedToken,0,true):target.forceN!==forceN){
      listingRoundingBoundN+=roundedListingValue(m[7],trustedToken);rounded=true;
    }
    return { nodeId, component: 'X' as const, skewId, loadCurveId, sensorId, scaleX, scaleY, forceN };
  }).sort((a, b) => a.nodeId - b.nodeId);
  if (loads.some((n, i) => n.nodeId !== [...expected].sort((a, b) => a.id - b.id)[i].id))
    reject('wrong loaded-node ownership');
  const resultantN = loads.reduce((s, n) => s + n.forceN, 0);
  const trustedTokens=expected.map(n=>n.forceText??String(n.forceN));
  const trustedResultantN=serialized?Number(exactRadiossDecimalSum(trustedTokens)):expected.reduce((s,n)=>s+n.forceN,0);
  // Live exact-topology loads carry their emitted decimal fields. Prove their
  // conservation exactly; a JS reduce at a larger force/node count is not that
  // proof. Keep legacy/reference admission and all tolerances unchanged.
  const conserved=serialized?exactRadiossDecimalSumWithin(trustedTokens,String(expectedResultantN),STARTER_LOAD_RESULTANT_TOLERANCE_N)
    :Math.abs(trustedResultantN-expectedResultantN)<STARTER_LOAD_RESULTANT_TOLERANCE_N;
  const reported=serialized?exactRadiossDecimalSumWithin(printedTokens,String(expectedResultantN),listingRoundingBoundN+STARTER_LOAD_RESULTANT_TOLERANCE_N,true)
    :Math.abs(resultantN-expectedResultantN)<=listingRoundingBoundN+STARTER_LOAD_RESULTANT_TOLERANCE_N;
  if (!Number.isFinite(resultantN) || !Number.isFinite(trustedResultantN) ||
      !conserved||!reported)
    reject('wrong axial resultant');
  return Object.freeze({ selector: 'standalone heading + underline + exact columns + SPMD terminator',
    loads: Object.freeze(loads.map(n => Object.freeze(n))), resultantN,
    resultantToleranceN: STARTER_LOAD_RESULTANT_TOLERANCE_N,
    ...(serialized?{serializedLoadConservation:Object.freeze({method:'bounded-exact-decimal',
      trustedResultantDecimalN:exactRadiossDecimalSum(trustedTokens),printedResultantDecimalN:exactRadiossDecimalSum(printedTokens)})}:{}),
    ...(rounded?{listingPrecision:Object.freeze({format:'1PG20.13',trustedResultantN,
      listingRoundingBoundN,printedResultantN:resultantN})}:{}) });
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
