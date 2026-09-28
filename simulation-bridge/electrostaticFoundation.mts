import { electrostaticFoundationSchema, electrostaticFoundationDraftSchema, type ElectrostaticFoundation, type ElectrostaticFoundationDraft } from './electrostaticContract.mts';
export { electrostaticFoundationSchema, type ElectrostaticFoundation, type ElectrostaticFoundationDraft } from './electrostaticContract.mts';
import { digest } from './stableDigest.mts';

/** Fixed reference constant, not an assertion of certified material data. */
export const VACUUM_PERMITTIVITY_F_PER_M = 8.8541878128e-12;
export function validateElectrostaticFoundation(value: unknown): ElectrostaticFoundation {
  const request = electrostaticFoundationSchema.parse(value);
  const { requestDigest, ...unsigned } = request;
  if (digest(unsigned) !== requestDigest) throw new Error('Electrostatic request digest mismatch.');
  return request;
}

/** Normalize valid opposite-face group order before sealing. Does not verify CAD. */
export function sealElectrostaticFoundation(draft: ElectrostaticFoundationDraft): ElectrostaticFoundation {
  // superRefine requires canonical order: sort only the two supplied groups,
  // never repair identities, domains, duplicates, missing faces or geometry.
  const canonical = structuredClone(draft);
  const xMin = canonical.model?.domains?.[0]?.shape?.faces?.xMin;
  if (Array.isArray(canonical.prescribedPotentials)) {
    canonical.prescribedPotentials.sort((a, b) =>
      Number(b.faceIds?.[0] === xMin) - Number(a.faceIds?.[0] === xMin));
  }
  const unsigned = electrostaticFoundationDraftSchema.parse(canonical);
  return validateElectrostaticFoundation({ ...unsigned, requestDigest: digest(unsigned) });
}

export function parallelPlateElectrostaticReference(value: unknown) {
  const request = validateElectrostaticFoundation(value);
  const domain = request.model.domains[0];
  const slab = domain.shape;
  const [left, right] = request.prescribedPotentials;
  const voltageDifferenceV = right.potentialV - left.potentialV;
  const areaM2 = slab.widthM * slab.heightM;
  const volumeM3 = areaM2 * slab.lengthM;
  const epsilon = request.material.absolutePermittivityFPerM;
  const fieldX = -voltageDifferenceV / slab.lengthM;
  const displacementX = epsilon * fieldX;
  const capacitanceF = epsilon * areaM2 / slab.lengthM;
  // Charge on each conductor, not outward flux from the dielectric domain.
  const leftChargeC = displacementX * areaM2;
  const rightChargeC = -leftChargeC;
  const energyDensityJPerM3 = 0.5 * epsilon * fieldX ** 2;
  const fieldEnergyJ = energyDensityJPerM3 * volumeM3;
  const capacitanceEnergyJ = 0.5 * capacitanceF * voltageDifferenceV ** 2;
  // Equivalent to 0.5*sum(Q_i*V_i), paired to avoid gauge-offset cancellation.
  const electrodeEnergyJ = 0.5 * rightChargeC * voltageDifferenceV;
  const reference = {
    schema: 'tunacad-electrostatic-analytical-reference/0.1' as const,
    analysisType: 'electrostatic' as const,
    authority: 'analytical_reference_only' as const,
    sourceVerification: 'declared_geometry_material_not_provider_verified' as const,
    requestDigest: request.requestDigest, projectRevision: request.model.projectRevision,
    domainId: domain.domainId, geometryDigest: domain.geometryDigest,
    materialProvenance: structuredClone(request.material.source),
    status: 'proof_of_concept' as const,
    engineeringUsePermitted: false as const,
    providerAdmission: 'closed' as const,
    units: structuredClone(request.output.units),
    areaM2, volumeM3, voltageDifferenceV,
    samples: request.output.normalizedAxialPositions.map(fraction => ({
      normalizedAxialPosition: fraction, xM: fraction * slab.lengthM,
      electricPotentialV: (1 - fraction) * left.potentialV + fraction * right.potentialV,
      electricFieldVPerM: [fieldX, 0, 0] as [number, number, number],
      electricDisplacementCPerM2: [displacementX, 0, 0] as [number, number, number],
      electrostaticEnergyDensityJPerM3: energyDensityJPerM3,
    })),
    electrodes: [
      { groupId: left.groupId, faceId: left.faceIds[0], potentialV: left.potentialV,
        chargeC: leftChargeC, surfaceChargeDensityCPerM2: displacementX },
      { groupId: right.groupId, faceId: right.faceIds[0], potentialV: right.potentialV,
        chargeC: rightChargeC, surfaceChargeDensityCPerM2: -displacementX },
    ],
    capacitanceF,
    electrostaticEnergyJ: fieldEnergyJ,
    consistency: {
      netElectrodeChargeC: leftChargeC + rightChargeC,
      capacitanceEnergyJ, electrodeEnergyJ,
      fieldMinusCapacitanceEnergyJ: fieldEnergyJ - capacitanceEnergyJ,
      fieldMinusElectrodeEnergyJ: fieldEnergyJ - electrodeEnergyJ,
    },
    limitations: [
      'Ideal complete opposing planar electrodes; lateral insulation excludes fringing.',
      'No CAD verification, provider solve, free volume charge, open exterior, nonlinear dielectric or coupling.',
      'Analytical reference only; not an admissible completed Simulation Bridge result.',
    ],
  };
  return { ...reference, referenceDigest: digest(reference) };
}

export type ElectrostaticAnalyticalReference = ReturnType<typeof parallelPlateElectrostaticReference>;
