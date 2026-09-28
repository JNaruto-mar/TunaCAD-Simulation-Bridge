import { electrostaticBrowserDigest } from './electrostaticLiveSource.mts';

/** Versioned, deliberately narrow OCCT 7.6 provenance normalization.
 * All geometry, topology, entity IDs, units, schema, ordering and whitespace
 * remain byte-bound. This is not a general STEP equivalence/repair algorithm. */
export async function electrostaticStepGeometryDigest(bytes: Uint8Array): Promise<string> {
  const fail = (): never => { throw new Error('ELECTROSTATIC_STEP_IDENTITY_INVALID'); };
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 32 * 1024 * 1024) fail();
  let text: string;
  // Preserve BOM so the framing check rejects it rather than silently omitting
  // a third, unapproved serialization difference.
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return fail(); }
  if (!/^ISO-10303-21;\r?\nHEADER;\r?\n/.test(text)
    || !/ENDSEC;\r?\nEND-ISO-10303-21;\r?\n?$/.test(text)
    || text.split('\nDATA;').length !== 2 || text.includes('\0')) fail();
  const headerEnd = text.indexOf('ENDSEC;');
  const header = text.slice(0, headerEnd);
  const filename = /FILE_NAME\('Open CASCADE Shape Model','(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})',/g;
  const matches = [...header.matchAll(filename)];
  if (matches.length !== 1) fail();
  const stamp = matches[0][1];
  if (!Number.isFinite(Date.parse(stamp + 'Z'))
    || new Date(stamp + 'Z').toISOString().slice(0, 19) !== stamp) fail();
  const canonicalHeader = header.replace(filename,
    "FILE_NAME('Open CASCADE Shape Model','2000-01-01T00:00:00',");
  const data = text.slice(headerEnd);
  // Only the two auto-generated ID/name strings of the one native PRODUCT.
  // Descriptions, PRODUCT_CONTEXT and every referenced entity are preserved.
  const product = /(#[1-9]\d* = PRODUCT\('Open CASCADE STEP translator 7\.6 )([1-9]\d{0,9})(',\r?\n  'Open CASCADE STEP translator 7\.6 )\2(')/g;
  if ([...data.matchAll(product)].length !== 1 || [...data.matchAll(/= PRODUCT\(/g)].length !== 1) fail();
  const canonicalData = data.replace(product, (_match, prefix, _counter, middle, suffix) => prefix + '0' + middle + '0' + suffix);
  return electrostaticBrowserDigest({ schema: 'tunacad-electrostatic-native-step-identity/0.1',
    canonicalStep: canonicalHeader + canonicalData });
}
