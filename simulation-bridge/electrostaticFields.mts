import * as z from 'zod/v4';
import { electrostaticBrowserDigest } from './electrostaticLiveSource.mts';

const finite = z.number().finite(), index = z.number().int().nonnegative();
const vector = z.tuple([finite, finite, finite]);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const ELECTRICAL_COMPONENTS = ['electric_potential', 'electric_field_magnitude', 'electric_displacement_magnitude'] as const;
export const electricalUnits = { electric_potential: 'V', electric_field_magnitude: 'V/m', electric_displacement_magnitude: 'C/m^2' } as const;
export const electricalDatasetSchema = z.object({
  schema: z.literal('tunacad-electrostatic-field-dataset/0.1'),
  analysisType: z.literal('electrostatic'), datasetId: z.string().min(1).max(500),
  jobId: z.string().min(1).max(160), domainId: z.string().min(1).max(160),
  requestDigest: hash, resultDigest: hash, canonicalSourceDigest: hash, meshDigest: hash,
  step: z.object({ index: z.literal(0), label: z.literal('electrostatic') }).strict(),
  component: z.enum(ELECTRICAL_COMPONENTS), unit: z.enum(['V', 'V/m', 'C/m^2']),
  positionUnit: z.literal('mm'), location: z.literal('boundary_facet'), topology: z.literal('triangle_soup'),
  sampling: z.enum(['nodal', 'element_average_of_four_integration_points']),
  vectorsIncluded: z.boolean(),
  valueRange: z.object({ minimum: finite, maximum: finite,
    minimumPositionAnalysisMm: vector, maximumPositionAnalysisMm: vector }).strict(),
  totalTriangles: z.number().int().min(1).max(64000), maximumPageTriangles: z.literal(128),
  datasetDigest: hash,
}).strict().superRefine((d, ctx) => {
  if (d.unit !== electricalUnits[d.component] || d.valueRange.minimum > d.valueRange.maximum
    || d.datasetId !== d.jobId + ':' + d.domainId + ':electrostatic:' + d.component
    || d.vectorsIncluded !== (d.component !== 'electric_potential')
    || d.sampling !== (d.component === 'electric_potential' ? 'nodal' : 'element_average_of_four_integration_points')
    || (d.component !== 'electric_potential' && d.valueRange.minimum < 0)) {
    ctx.addIssue({ code: 'custom', message: 'Electrical dataset semantics/identity/range invalid' });
  }
});
export type ElectricalDataset = z.infer<typeof electricalDatasetSchema>;
export const electricalTriangleSchema = z.object({
  facetIndex: index, subtriangleIndex: index.max(3), elementIndex: index.max(7999),
  nodeIds: z.tuple([index.min(1).max(16000), index.min(1).max(16000), index.min(1).max(16000)]),
  positionsAnalysisMm: z.tuple([vector, vector, vector]),
  values: z.tuple([finite, finite, finite]),
  vectors: z.tuple([vector, vector, vector]).nullable(),
}).strict();
export type ElectricalTriangle = z.infer<typeof electricalTriangleSchema>;
const pageSchema = z.object({
  schema: z.literal('tunacad-electrostatic-field-page/0.1'), dataset: electricalDatasetSchema,
  cursor: z.string().regex(/^(0|[1-9][0-9]{0,5})$/), nextCursor: z.string().regex(/^[1-9][0-9]{0,5}$/).nullable(),
  triangleOffset: index, triangleCount: index.min(1).max(128),
  chunkDigest: hash, triangles: z.array(electricalTriangleSchema).min(1).max(128),
}).strict();
export type ElectricalPage = z.infer<typeof pageSchema>;
export interface ElectricalViewerResult {
  analysisType: 'electrostatic'; fieldDatasets: ElectricalDataset[];
  perDomain: Array<{ domainId: string; fieldDatasetIds: string[];
    materialId?: string; absolutePermittivityFPerM?: number; permittivityUnit?: 'F/m' }>;
  twoLayerSummary?: {
    electrodeChargesC: Array<{ faceId: string; chargeC: number }>;
    capacitanceF: number; electrostaticEnergyJ: number;
    interfaceNormalDJumpCPerM2: number; netElectrodeChargeC: number;
  };
}
const invalid = (message: string): never => { throw new Error('ELECTROSTATIC_FIELD_INVALID: ' + message); };
export function electricalExtrema(triangles: ElectricalTriangle[]): ElectricalDataset['valueRange'] {
  let minimum = Infinity, maximum = -Infinity;
  let minimumPositionAnalysisMm: [number, number, number] = [0, 0, 0], maximumPositionAnalysisMm = minimumPositionAnalysisMm;
  for (const t of triangles) t.values.forEach((value, i) => {
    if (value < minimum) { minimum = value; minimumPositionAnalysisMm = t.positionsAnalysisMm[i]; }
    if (value > maximum) { maximum = value; maximumPositionAnalysisMm = t.positionsAnalysisMm[i]; }
  });
  return { minimum, maximum, minimumPositionAnalysisMm, maximumPositionAnalysisMm };
}
export async function validateElectricalPage(value: unknown, expected: ElectricalDataset, cursor: string, limit = 128): Promise<ElectricalPage> {
  electricalDatasetSchema.parse(expected);
  if (!Number.isInteger(limit) || limit < 1 || limit > 128) invalid('page size');
  const p = pageSchema.parse(value), end = p.triangleOffset + p.triangleCount;
  if (await electrostaticBrowserDigest(p.dataset) !== await electrostaticBrowserDigest(expected)
    || p.cursor !== cursor || String(p.triangleOffset) !== cursor || end > expected.totalTriangles
    || p.triangleCount !== p.triangles.length || p.triangleCount > limit
    || p.nextCursor !== (end < expected.totalTriangles ? String(end) : null)) invalid('dataset/frame identity or page ordering');
  if (await electrostaticBrowserDigest(p.triangles) !== p.chunkDigest) invalid('chunk digest');
  for (const t of p.triangles) {
    if (new Set(t.nodeIds).size !== 3 || (t.vectors !== null) !== expected.vectorsIncluded) invalid('triangle/vector identity');
    t.values.forEach((v, i) => {
      if (v < expected.valueRange.minimum || v > expected.valueRange.maximum) invalid('range');
      if (t.vectors && (!Number.isFinite(Math.hypot(...t.vectors[i]))
        || Math.abs(Math.hypot(...t.vectors[i]) - v) > Math.max(Math.abs(v) * 1e-10, 1e-24))) invalid('vector/magnitude mismatch');
    });
  }
  return p;
}
/** Same bounded page/chunk/full-digest protocol as the shared thermal viewer.
 * Expected descriptor MUST come from the authenticated immutable result manifest. */
export async function loadElectricalDataset(expected: ElectricalDataset,
  fetchPage: (cursor: string, limit: number) => Promise<unknown>, limit = 128) {
  const triangles: ElectricalTriangle[] = [];
  let cursor: string | null = '0', previousKey = -1;
  while (cursor !== null) {
    const page = await validateElectricalPage(await fetchPage(cursor, limit), expected, cursor, limit);
    for (const t of page.triangles) {
      const key = t.facetIndex * 4 + t.subtriangleIndex;
      if (key <= previousKey) invalid('duplicate/reordered triangles');
      previousKey = key; triangles.push(t);
    }
    cursor = page.nextCursor;
  }
  if (triangles.length !== expected.totalTriangles || await electrostaticBrowserDigest(triangles) !== expected.datasetDigest) invalid('missing/tampered full dataset');
  if (await electrostaticBrowserDigest(electricalExtrema(triangles)) !== await electrostaticBrowserDigest(expected.valueRange)) invalid('untruthful extrema');
  return { descriptor: expected, triangles };
}
