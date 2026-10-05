import { digest } from './stableDigest.mts';
import { explicitDynamicsDraftSchema, explicitDynamicsSchema, explicitWaveSpeedsMmPerS,
  type ExplicitDynamicsDraft, type ExplicitDynamicsRequest } from './explicitDynamicsContract.mts';
export * from './explicitDynamicsContract.mts';

export function validateExplicitDynamics(value: unknown): ExplicitDynamicsRequest {
  const request = explicitDynamicsSchema.parse(value);
  const { requestDigest, ...unsigned } = request;
  if (digest(unsigned) !== requestDigest) throw new Error('Explicit dynamics request digest mismatch.');
  return request;
}

export function sealExplicitDynamics(value: ExplicitDynamicsDraft): ExplicitDynamicsRequest {
  const unsigned = explicitDynamicsDraftSchema.parse(value);
  return validateExplicitDynamics({ ...unsigned, requestDigest: digest(unsigned) });
}

/** Exact for the consistent-mass one-coordinate approximation, not a 3D continuum solution. */
export function explicitAxialBarReference(value: unknown) {
  const r = validateExplicitDynamics(value);
  if(r.model.kind!=='straight_rectangular_axial_bar')throw new Error('Axial reference applies only to the frozen rectangular reference problem.');
  const areaMm2 = r.model.widthMm * r.model.heightMm;
  const stiffnessNPerMm = r.material.youngsModulusMPa * areaMm2 / r.model.lengthMm;
  const generalizedMassKg = r.material.densityKgM3 * areaMm2 * r.model.lengthMm * 1e-9 / 3;
  const generalizedMassNs2PerMm = generalizedMassKg / 1000;
  const angularFrequencyRadS = Math.sqrt(stiffnessNPerMm / generalizedMassNs2PerMm);
  const periodS = 2 * Math.PI / angularFrequencyRadS;
  const forceN = r.load.forceN[0];
  const staticDisplacementMm = forceN / stiffnessNPerMm;
  const wave = explicitWaveSpeedsMmPerS(r.material.youngsModulusMPa,
    r.material.poissonRatio, r.material.densityKgM3);
  const samples = r.analysis.outputTimesS.map(timeS => {
    const phase = angularFrequencyRadS * timeS;
    const displacementMm = staticDisplacementMm * (1 - Math.cos(phase));
    const velocityMmPerS = staticDisplacementMm * angularFrequencyRadS * Math.sin(phase);
    const accelerationMmPerS2 = staticDisplacementMm * angularFrequencyRadS ** 2 * Math.cos(phase);
    const supportReactionN = -stiffnessNPerMm * displacementMm;
    const kineticEnergyNmm = generalizedMassNs2PerMm * velocityMmPerS ** 2 / 2;
    const strainEnergyNmm = stiffnessNPerMm * displacementMm ** 2 / 2;
    const appliedWorkNmm = forceN * displacementMm;
    return { timeS, displacementMm, velocityMmPerS, accelerationMmPerS2,
      supportReactionN, kineticEnergyNmm, strainEnergyNmm, appliedWorkNmm,
      forceBalanceResidualN: forceN + supportReactionN
        - generalizedMassNs2PerMm * accelerationMmPerS2,
      workEnergyResidualNmm: appliedWorkNmm - kineticEnergyNmm - strainEnergyNmm };
  });
  const reference = {
    schema: 'tunacad-explicit-dynamics-analytical-reference/0.1' as const,
    analysisType: 'explicit_structural_dynamics' as const,
    authority: 'consistent_mass_single_mode_analytical_reference_only' as const,
    requestDigest: r.requestDigest, providerAdmission: 'closed' as const,
    status: 'proof_of_concept' as const, engineeringUsePermitted: false as const,
    areaMm2, stiffnessNPerMm, generalizedMassKg, angularFrequencyRadS,
    periodS, staticDisplacementMm, axialWaveSpeedMmPerS: wave.axialMmPerS,
    dilatationalWaveSpeedMmPerS: wave.dilatationalMmPerS,
    axialTransitTimeS: r.model.lengthMm / wave.axialMmPerS,
    stableTimeStepLimitS: r.analysis.integration.safetyFactor
      * r.analysis.integration.minimumCharacteristicLengthMm / wave.dilatationalMmPerS,
    requestedMaximumTimeStepS: r.analysis.integration.maximumTimeStepS,
    estimatedIncrements: Math.ceil(r.analysis.durationS / r.analysis.integration.maximumTimeStepS),
    samples, units: r.units,
    limitations: [
      'Single-mode bar reference is not an exact continuum wave solution.',
      'C3D4 provider support, actual mesh length and stable time step are not verified.',
      'No deck, solver result, browser/MCP authoring or visualization is admitted.',
    ],
  };
  return { ...reference, referenceDigest: digest(reference) };
}
