import { digest } from './stableDigest.mts';
import { validateNeutralSimulationFieldPageV2 } from './v2Validation.mts';
import type { NeutralSimulationFieldDatasetV2, NeutralSimulationFieldPageV2, NeutralSimulationFieldTriangleV2 } from '../src/simulation/externalSimulationContracts.ts';

/** A trusted reader must consume the entire provider-owned field, not accept
 * a descriptor or caller-supplied digest as proof that the result is complete. */
export async function readVerifiedOptimizationStressField(
  jobId: string, datasetId: string,
  readPage: (cursor: string, limit: number) => Promise<unknown>,
  pageLimit = 128,
): Promise<{ descriptor: NeutralSimulationFieldDatasetV2; maximumSurfaceStressMPa: number }> {
  if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > 128) throw new Error('SIM9_OPTIMIZATION_STRESS_FIELD_INVALID: page limit');
  let cursor = '0';
  let descriptor: NeutralSimulationFieldDatasetV2 | null = null;
  const triangles: NeutralSimulationFieldTriangleV2[] = [];
  for (;;) {
    let page: NeutralSimulationFieldPageV2;
    try { page = validateNeutralSimulationFieldPageV2(await readPage(cursor, pageLimit)); }
    catch { throw new Error('SIM9_OPTIMIZATION_STRESS_FIELD_INVALID: malformed or missing page'); }
    const field = page.dataset;
    if (field.jobId !== jobId || field.datasetId !== datasetId
      || field.analysisType !== 'linear_static' || field.component !== 'von_mises_stress'
      || field.unit !== 'MPa' || page.cursor !== cursor
      || page.triangleOffset !== triangles.length
      || field.totalTriangles > 100_000
      || descriptor && digest(field) !== digest(descriptor)) {
      throw new Error('SIM9_OPTIMIZATION_STRESS_FIELD_INVALID: identity, order, or descriptor mismatch');
    }
    descriptor ??= field;
    triangles.push(...page.triangles);
    if (!page.nextCursor) break;
    if (triangles.length >= field.totalTriangles) throw new Error('SIM9_OPTIMIZATION_STRESS_FIELD_INVALID: page cycle');
    cursor = page.nextCursor;
  }
  if (!descriptor || triangles.length !== descriptor.totalTriangles
    || digest(triangles) !== descriptor.datasetDigest) {
    throw new Error('SIM9_OPTIMIZATION_STRESS_FIELD_INVALID: incomplete or altered dataset');
  }
  let minimumSurfaceStressMPa = Infinity, maximumSurfaceStressMPa = -Infinity;
  for (const triangle of triangles) for (const value of triangle.values) {
    minimumSurfaceStressMPa = Math.min(minimumSurfaceStressMPa, value);
    maximumSurfaceStressMPa = Math.max(maximumSurfaceStressMPa, value);
  }
  if (!Number.isFinite(maximumSurfaceStressMPa)
    || Math.abs(minimumSurfaceStressMPa - descriptor.valueRange.minimum) > 1e-8
    || Math.abs(maximumSurfaceStressMPa - descriptor.valueRange.maximum) > 1e-8) {
    throw new Error('SIM9_OPTIMIZATION_STRESS_FIELD_INVALID: extrema mismatch');
  }
  return { descriptor, maximumSurfaceStressMPa };
}
