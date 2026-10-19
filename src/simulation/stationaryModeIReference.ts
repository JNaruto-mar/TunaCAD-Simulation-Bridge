import * as z from 'zod/v4';

/** Analytical reference only: not a provider request, extracted FEM result or execution authorization. */
const scalar = (minimum: number, maximum: number) => z.number().finite().min(minimum).max(maximum);
const text = z.string().trim().min(1).max(240).regex(/^[^\x00-\x1f\x7f]+$/);
const vector = z.tuple([scalar(-1, 1), scalar(-1, 1), scalar(-1, 1)]);
const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export const stationaryModeIReferenceSchema = z.object({
  schema: z.literal('tunacad-stationary-mode-i-analytical-reference/0.1'),
  provenance: z.object({ kind: z.literal('user_defined_analytical_geometry'), reference: text }).strict(),
  geometry: z.object({
    type: z.literal('center_cracked_through_thickness_plate'),
    fullWidthMm: scalar(1, 10000), fullHeightMm: scalar(4, 40000), thicknessMm: scalar(.1, 100),
    halfCrackLengthMm: scalar(.01, 2500),
    centerMm: z.tuple([scalar(-1e6, 1e6), scalar(-1e6, 1e6), scalar(-1e6, 1e6)]),
    crackDirection: vector, openingNormal: vector, thicknessDirection: vector,
  }).strict(),
  material: z.object({ model: z.literal('homogeneous_isotropic_linear_elastic'),
    youngsModulusMPa: scalar(1, 1e6), poissonRatio: scalar(0, .49), provenance: text }).strict(),
  loading: z.object({ type: z.literal('balanced_remote_uniform_tension'),
    nominalGrossStressMPa: scalar(1e-6, 1000) }).strict(),
  assumption: z.literal('thin_plate_plane_stress_reference'),
  units: z.object({ length: z.literal('mm'), stress: z.literal('MPa'), stressIntensity: z.literal('MPa_sqrt_m') }).strict(),
  toughness: z.object({ valueMPaSqrtM: scalar(1e-6, 10000),
    designation: z.enum(['K_IC', 'K_c']), materialCondition: text, orientation: text,
    temperatureC: scalar(-273.15, 2000), specimenThicknessMm: scalar(.01, 10000),
    testMethod: text, provenance: text }).strict().optional(),
}).strict().superRefine((input, ctx) => {
  const g = input.geometry;
  // Deliberately narrow reference envelope, not universal LEFM validity criteria.
  if (g.halfCrackLengthMm / g.fullWidthMm > .25 || g.fullHeightMm / g.fullWidthMm < 4
    || g.thicknessMm / g.fullWidthMm > .02 || g.thicknessMm / g.halfCrackLengthMm > .1)
    ctx.addIssue({ code: 'custom', message: 'Reference envelope requires a/W <= 0.25, H/W >= 4, B/W <= 0.02 and B/a <= 0.1.' });
  const axes = [g.crackDirection, g.openingNormal, g.thicknessDirection];
  if (axes.some(axis => Math.abs(dot(axis, axis) - 1) > 1e-8)
    || Math.abs(dot(axes[0], axes[1])) > 1e-8
    || dot(cross(axes[0], axes[1]), axes[2]) < 1 - 1e-8)
    ctx.addIssue({ code: 'custom', message: 'Crack frame must be an orthonormal right-handed unit frame.' });
});

export type StationaryModeIReferenceInput = z.infer<typeof stationaryModeIReferenceSchema>;

export function evaluateStationaryModeIReference(value: unknown) {
  const input = stationaryModeIReferenceSchema.parse(value);
  const g = input.geometry;
  const geometryFactor = 1 / Math.sqrt(Math.cos(Math.PI * g.halfCrackLengthMm / g.fullWidthMm));
  const kiMPaSqrtM = geometryFactor * input.loading.nominalGrossStressMPa * Math.sqrt(Math.PI * g.halfCrackLengthMm / 1000);
  return {
    schema: 'tunacad-stationary-mode-i-analytical-result/0.1' as const,
    origin: 'analytical_reference_not_fem' as const,
    status: 'analytical_checks_passed_fem_unvalidated' as const,
    formula: 'sigma_gross * sqrt(pi * a_m) / sqrt(cos(pi * a_mm / W_mm))' as const,
    geometryFactor, kiMPaSqrtM,
    kiMPaSqrtMm: kiMPaSqrtM * Math.sqrt(1000),
    remoteForceMagnitudePerEndN: input.loading.nominalGrossStressMPa * g.fullWidthMm * g.thicknessMm,
    input,
    provenance: { method: 'finite_width_center_crack_secant_approximation',
      source: 'https://ntrs.nasa.gov/api/citations/19840002544/downloads/19840002544.pdf', equation: '3.4' },
    toughnessComparison: input.toughness ? {
      analyticalReferenceRatio: kiMPaSqrtM / input.toughness.valueMPaSqrtM,
      applicability: 'not_established' as const,
      interpretation: 'Informational analytical ratio only. Verify material condition, orientation, temperature, thickness, test validity and small-scale yielding; plane stress does not establish K_IC applicability.',
      certifiesStructuralSafety: false as const,
    } : null,
    warnings: [
      'Experimental / Preview; engineeringUsePermitted=false.',
      'Finite-width long-plate approximation, not an exact finite-height or three-dimensional crack-front solution.',
      'Linear elasticity and small-scale yielding are assumptions, not validated by this reference.',
      'No mesh, solver, crack extraction, convergence, source-binding verification or safety certification is performed.',
    ],
    engineeringUsePermitted: false as const,
  };
}
