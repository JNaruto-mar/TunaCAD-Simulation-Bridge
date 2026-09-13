import type { NeutralSteadyThermalResultV2, NeutralVector3 } from '../src/simulation/externalSimulationContracts.ts';

export interface OneDimensionalSteadyConductionInput {
  lengthMm: number;
  areaMm2: number;
  thermalConductivityWPerMK: number;
  prescribedTemperatureC: number;
  inwardHeatFluxWPerM2: number;
  sampleCount?: number;
  originAnalysisMm?: NeutralVector3;
  axis?: NeutralVector3;
}

/** Closed-form constant-area slab solution used only as versioned SIM-8
 * validation evidence. Positive flux enters at x=L and exits through the
 * prescribed-temperature face at x=0. It is not a substitute FEM solver. */
export function solveOneDimensionalSteadyConduction(input: OneDimensionalSteadyConductionInput): NeutralSteadyThermalResultV2 {
  const sampleCount = input.sampleCount ?? 5;
  const values = [input.lengthMm, input.areaMm2, input.thermalConductivityWPerMK, input.inwardHeatFluxWPerM2];
  if (values.some(value => !Number.isFinite(value) || value <= 0)
    || input.lengthMm > 1e6 || input.areaMm2 > 1e12 || input.thermalConductivityWPerMK > 1e7
    || input.inwardHeatFluxWPerM2 > 1e12 || !Number.isFinite(input.prescribedTemperatureC)
    || input.prescribedTemperatureC < -273.15 || input.prescribedTemperatureC > 1e6
    || !Number.isInteger(sampleCount) || sampleCount < 2 || sampleCount > 256) {
    throw thermalError('SIMULATION_THERMAL_FIXTURE_INVALID', 'The one-dimensional conduction fixture is outside its bounded domain.');
  }
  const origin = input.originAnalysisMm ?? [0, 0, 0];
  const rawAxis = input.axis ?? [1, 0, 0];
  if ([...origin, ...rawAxis].some(value => !Number.isFinite(value))) throw thermalError('SIMULATION_THERMAL_FIXTURE_INVALID', 'Fixture coordinates must be finite.');
  const axisLength = Math.hypot(...rawAxis);
  if (!(axisLength > 1e-12)) throw thermalError('SIMULATION_THERMAL_FIXTURE_INVALID', 'Fixture axis must be non-zero.');
  const axis = rawAxis.map(value => value / axisLength) as NeutralVector3;
  const gradientCPerM = input.inwardHeatFluxWPerM2 / input.thermalConductivityWPerMK;
  const maximumTemperatureC = input.prescribedTemperatureC + gradientCPerM * input.lengthMm / 1000;
  if (!Number.isFinite(maximumTemperatureC) || maximumTemperatureC > 1e6) throw thermalError('SIMULATION_THERMAL_FIXTURE_INVALID', 'Fixture temperature exceeds its bounded range.');
  const totalAppliedHeatW = input.inwardHeatFluxWPerM2 * input.areaMm2 * 1e-6;
  const temperatureSamples = Array.from({ length: sampleCount }, (_, index) => {
    const distanceMm = input.lengthMm * index / (sampleCount - 1);
    return {
      positionAnalysisMm: origin.map((value, component) => value + axis[component] * distanceMm) as NeutralVector3,
      temperatureC: input.prescribedTemperatureC + gradientCPerM * distanceMm / 1000,
    };
  });
  return {
    formulation: 'steady_state_isotropic_conduction',
    minimumTemperatureC: input.prescribedTemperatureC,
    maximumTemperatureC,
    maximumTemperatureGradientCPerM: gradientCPerM,
    totalAppliedHeatW,
    totalReactionHeatW: -totalAppliedHeatW,
    heatBalanceResidualW: 0,
    temperatureSamples,
  };
}

function thermalError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
