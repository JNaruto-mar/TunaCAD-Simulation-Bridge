// Shared admission/adapter constants; no change to numerical acceptance.
export const ELECTROSTATIC_SLAB_LIMITS = Object.freeze({
  maximumNodes: 8000, maximumElements: 4000, maximumOutputBytes: 8 * 1024 * 1024,
  maximumPotentialErrorV: 0.002, fieldRelativeTolerance: 1e-4,
  chargeRelativeTolerance: 1e-4, energyRelativeTolerance: 1e-4,
});
