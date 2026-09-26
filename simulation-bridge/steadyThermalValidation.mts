import type { NeutralSteadyThermalResultV2, NeutralVector3 } from '../src/simulation/externalSimulationContracts.ts';
import { integratedThermalConductivity, interpolateThermalConductivity, isBoundedThermalConductivityCurve, type ThermalConductivityCurve } from './thermalConductivity.mts';

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

/** Total inward FACE power for a constant-area slab; the power-to-flux
 * conversion is explicit so watts cannot be confused with W/m^2. */
export function solveOneDimensionalSurfaceHeatPower(input: Omit<OneDimensionalSteadyConductionInput, 'inwardHeatFluxWPerM2'> & { heatPowerW: number }): NeutralSteadyThermalResultV2 {
  if (!Number.isFinite(input.heatPowerW) || input.heatPowerW <= 0 || input.heatPowerW > 1e12
    || !Number.isFinite(input.areaMm2) || input.areaMm2 <= 0) {
    throw thermalError('SIMULATION_THERMAL_FIXTURE_INVALID', 'Surface heat power and area must be finite and positive.');
  }
  return solveOneDimensionalSteadyConduction({
    ...input,
    inwardHeatFluxWPerM2: input.heatPowerW / (input.areaMm2 * 1e-6),
  });
}

/** Exact 1D Kirchhoff-transform reference for piecewise-linear k(T):
 * integral(base..T(x)) k(T)dT = inwardFlux * x(m). */
export function solveOneDimensionalTemperatureDependentConduction(input: {
  lengthMm: number; areaMm2: number; prescribedTemperatureC: number;
  inwardHeatFluxWPerM2: number; conductivityCurve: ThermalConductivityCurve;
  sampleCount?: number;
}): NeutralSteadyThermalResultV2 {
  const { lengthMm, areaMm2, prescribedTemperatureC: base, inwardHeatFluxWPerM2: flux, conductivityCurve: curve } = input;
  const sampleCount = input.sampleCount ?? 11;
  if (![lengthMm, areaMm2, base, flux].every(Number.isFinite)
    || lengthMm <= 0 || lengthMm > 1e6 || areaMm2 <= 0 || areaMm2 > 1e12
    || flux <= 0 || flux > 1e12 || !Number.isInteger(sampleCount) || sampleCount < 2 || sampleCount > 256
    || !isBoundedThermalConductivityCurve(curve)
    || base < curve[0].temperatureC || base >= curve.at(-1)!.temperatureC
    || flux * lengthMm / 1000 > integratedThermalConductivity(curve, base, curve.at(-1)!.temperatureC) + 1e-9) {
    throw thermalError('SIMULATION_THERMAL_FIXTURE_INVALID', 'The temperature-dependent slab is outside its bounded curve or flux range.');
  }
  const temperatureAt = (distanceMm: number): number => {
    if (distanceMm === 0) return base;
    const target = flux * distanceMm / 1000;
    let low = base; let high = curve.at(-1)!.temperatureC;
    for (let index = 0; index < 72; index += 1) {
      const middle = (low + high) / 2;
      if (integratedThermalConductivity(curve, base, middle) < target) low = middle;
      else high = middle;
    }
    return (low + high) / 2;
  };
  const maximumTemperatureC = temperatureAt(lengthMm);
  const totalAppliedHeatW = flux * areaMm2 * 1e-6;
  return {
    formulation: 'steady_state_isotropic_conduction',
    minimumTemperatureC: base,
    maximumTemperatureC,
    maximumTemperatureGradientCPerM: flux / interpolateThermalConductivity(curve, base),
    totalAppliedHeatW,
    totalReactionHeatW: -totalAppliedHeatW,
    heatBalanceResidualW: 0,
    temperatureSamples: Array.from({ length: sampleCount }, (_, index) => {
      const x = lengthMm * index / (sampleCount - 1);
      return { positionAnalysisMm: [x, 0, 0], temperatureC: temperatureAt(x) };
    }),
  };
}

export interface TwoMaterialSeriesConductionInput {
  firstLengthMm: number;
  secondLengthMm: number;
  areaMm2: number;
  firstConductivityWPerMK: number;
  secondConductivityWPerMK: number;
  prescribedTemperatureC: number;
  inwardHeatFluxWPerM2: number;
}

/** Constant-area two-slab reference with a zero-thickness finite-conductance
 * interface. Temperatures jump by q/h while the same q crosses both solids. */
export function solveTwoMaterialConductiveInterface(input: {
  firstLengthMm: number; secondLengthMm: number; areaMm2: number;
  firstConductivityWPerMK: number; secondConductivityWPerMK: number;
  conductanceWPerM2K: number; baseTemperatureC: number; inwardHeatFluxWPerM2: number;
}): { secondaryTemperatureC: number; primaryTemperatureC: number; endTemperatureC: number; interfaceHeatFlowW: number } {
  const { firstLengthMm: l1, secondLengthMm: l2, areaMm2: area,
    firstConductivityWPerMK: k1, secondConductivityWPerMK: k2,
    conductanceWPerM2K: h, baseTemperatureC: base, inwardHeatFluxWPerM2: q } = input;
  if (![l1, l2, area, k1, k2, h, base, q].every(Number.isFinite)
    || Math.min(l1, l2, area, k1, k2, h, q) <= 0
    || l1 + l2 > 1e6 || area > 1e12 || Math.max(k1, k2) > 1e7
    || h > 1e9 || q > 1e12 || base < -273.15 || base > 1e6) {
    throw thermalError('SIMULATION_THERMAL_FIXTURE_INVALID', 'The conductive-interface reference is outside its bounded domain.');
  }
  const secondaryTemperatureC = base + q * l1 / (1000 * k1);
  const primaryTemperatureC = secondaryTemperatureC + q / h;
  const endTemperatureC = primaryTemperatureC + q * l2 / (1000 * k2);
  if (endTemperatureC > 1e6) throw thermalError('SIMULATION_THERMAL_FIXTURE_INVALID', 'The conductive-interface reference temperature is too high.');
  return { secondaryTemperatureC, primaryTemperatureC, endTemperatureC, interfaceHeatFlowW: q * area * 1e-6 };
}

/** Axial end-to-end free expansion for a linear slab temperature profile.
 * Three-two-one point restraints remove only rigid-body modes. */
export function solveFreeExpansionOfLinearSlab(input: {
  lengthMm: number;
  thermalExpansionPerK: number;
  initialTemperatureC: number;
  baseTemperatureC: number;
  endTemperatureC: number;
}): number {
  const { lengthMm, thermalExpansionPerK: alpha, initialTemperatureC: initial,
    baseTemperatureC: base, endTemperatureC: end } = input;
  if (![lengthMm, alpha, initial, base, end].every(Number.isFinite)
    || lengthMm <= 0 || lengthMm > 1e6 || alpha <= 0 || alpha > 1e-2
    || Math.min(initial, base, end) < -273.15 || Math.max(initial, base, end) > 1e6) {
    throw thermalError('SIMULATION_THERMAL_FIXTURE_INVALID', 'The free-expansion comparator is outside its bounded domain.');
  }
  return alpha * lengthMm * ((base + end) / 2 - initial);
}

/** All displacement DOFs restrained, with a uniform pointwise temperature
 * increment. Isotropic thermoelastic stress is hydrostatic; von Mises alone
 * cannot prove this fixture because its exact value is zero. */
export function solveFullyConstrainedThermalStress(input: {
  youngsModulusMPa: number;
  poissonRatio: number;
  thermalExpansionPerK: number;
  temperatureChangeK: number;
  endFaceAreaMm2: number;
}): { normalStressMPa: number; endFaceReactionMagnitudeN: number; displacementMm: 0 } {
  const { youngsModulusMPa: youngs, poissonRatio: nu, thermalExpansionPerK: alpha,
    temperatureChangeK: change, endFaceAreaMm2: area } = input;
  if (![youngs, nu, alpha, change, area].every(Number.isFinite)
    || youngs <= 0 || youngs > 1e8 || nu < 0 || nu >= .5
    || alpha <= 0 || alpha > 1e-2 || change <= 0 || change > 1e6
    || area <= 0 || area > 1e12) {
    throw thermalError('SIMULATION_THERMAL_FIXTURE_INVALID', 'The constrained thermal-stress comparator is outside its bounded domain.');
  }
  const normalStressMPa = -youngs * alpha * change / (1 - 2 * nu);
  return { normalStressMPa, endFaceReactionMagnitudeN: Math.abs(normalStressMPa) * area, displacementMm: 0 };
}

/** Perfectly bonded, constant-area series slab. The interface shares one
 * temperature and one heat-flow density; no contact resistance is assumed. */
export function solveTwoMaterialSeriesConduction(input: TwoMaterialSeriesConductionInput): NeutralSteadyThermalResultV2 {
  const { firstLengthMm: l1, secondLengthMm: l2, areaMm2: area,
    firstConductivityWPerMK: k1, secondConductivityWPerMK: k2,
    prescribedTemperatureC: base, inwardHeatFluxWPerM2: flux } = input;
  if (![l1, l2, area, k1, k2, base, flux].every(Number.isFinite)
    || l1 <= 0 || l2 <= 0 || area <= 0 || k1 <= 0 || k2 <= 0 || flux <= 0
    || l1 + l2 > 1e6 || area > 1e12 || k1 > 1e7 || k2 > 1e7
    || flux > 1e12 || base < -273.15 || base > 1e6) {
    throw thermalError('SIMULATION_THERMAL_FIXTURE_INVALID', 'The two-material series fixture is outside its bounded domain.');
  }
  const interfaceTemperatureC = base + flux * l1 / (1000 * k1);
  const endTemperatureC = interfaceTemperatureC + flux * l2 / (1000 * k2);
  if (endTemperatureC > 1e6) throw thermalError('SIMULATION_THERMAL_FIXTURE_INVALID', 'The two-material fixture temperature exceeds its bounded range.');
  const totalAppliedHeatW = flux * area * 1e-6;
  return {
    formulation: 'steady_state_isotropic_conduction',
    minimumTemperatureC: base,
    maximumTemperatureC: endTemperatureC,
    maximumTemperatureGradientCPerM: Math.max(flux / k1, flux / k2),
    totalAppliedHeatW,
    totalReactionHeatW: -totalAppliedHeatW,
    heatBalanceResidualW: 0,
    temperatureSamples: [
      { positionAnalysisMm: [0, 0, 0], temperatureC: base },
      { positionAnalysisMm: [l1, 0, 0], temperatureC: interfaceTemperatureC },
      { positionAnalysisMm: [l1 + l2, 0, 0], temperatureC: endTemperatureC },
    ],
  };
}

export interface RectangularConvectionFinInput {
  lengthMm: number;
  widthMm: number;
  thicknessMm: number;
  thermalConductivityWPerMK: number;
  filmCoefficientWPerM2K: number;
  baseTemperatureC: number;
  sinkTemperatureC: number;
  sampleCount?: number;
}

/** One-dimensional constant-cross-section fin with convection on the four
 * lateral faces and at the tip. The 3D FEM fixture is compared to this
 * analytical approximation only within its small transverse-Biot envelope. */
export function solveRectangularConvectionFin(input: RectangularConvectionFinInput): NeutralSteadyThermalResultV2 {
  const sampleCount = input.sampleCount ?? 11;
  const { lengthMm, widthMm, thicknessMm, thermalConductivityWPerMK: k, filmCoefficientWPerM2K: h,
    baseTemperatureC: base, sinkTemperatureC: sink } = input;
  if (![lengthMm, widthMm, thicknessMm, k, h, base, sink].every(Number.isFinite)
    || lengthMm <= 0 || widthMm <= 0 || thicknessMm <= 0 || k <= 0 || h <= 0
    || lengthMm > 1e6 || widthMm > 1e5 || thicknessMm > 1e5 || k > 1e7 || h > 1e9
    || sink < -273.15 || base <= sink || base > 1e6
    || !Number.isInteger(sampleCount) || sampleCount < 2 || sampleCount > 256) {
    throw thermalError('SIMULATION_THERMAL_FIXTURE_INVALID', 'The rectangular convection-fin fixture is outside its bounded cooling domain.');
  }
  const areaM2 = widthMm * thicknessMm * 1e-6;
  const perimeterM = 2 * (widthMm + thicknessMm) / 1000;
  const mPerM = Math.sqrt(h * perimeterM / (k * areaM2));
  const lengthM = lengthMm / 1000;
  const transverseBiot = h * Math.min(widthMm, thicknessMm) / (1000 * k);
  if (mPerM * lengthM > 20 || transverseBiot > 0.05) {
    throw thermalError('SIMULATION_THERMAL_FIXTURE_INVALID', 'The fin exceeds the bounded one-dimensional analytical envelope.');
  }
  const tipFactor = h / (mPerM * k);
  const denominator = Math.cosh(mPerM * lengthM) + tipFactor * Math.sinh(mPerM * lengthM);
  const baseSlopeRatio = (Math.sinh(mPerM * lengthM) + tipFactor * Math.cosh(mPerM * lengthM)) / denominator;
  const baseHeatFlowW = k * areaM2 * mPerM * (base - sink) * baseSlopeRatio;
  const temperatureSamples = Array.from({ length: sampleCount }, (_, index) => {
    const positionMm = lengthMm * index / (sampleCount - 1);
    const remainingM = (lengthMm - positionMm) / 1000;
    return { positionAnalysisMm: [positionMm, widthMm / 2, thicknessMm / 2] as NeutralVector3,
      temperatureC: sink + (base - sink) * (Math.cosh(mPerM * remainingM) + tipFactor * Math.sinh(mPerM * remainingM)) / denominator };
  });
  return {
    formulation: 'steady_state_isotropic_conduction',
    minimumTemperatureC: temperatureSamples.at(-1)!.temperatureC,
    maximumTemperatureC: base,
    maximumTemperatureGradientCPerM: mPerM * (base - sink) * baseSlopeRatio,
    totalAppliedHeatW: -baseHeatFlowW,
    totalReactionHeatW: baseHeatFlowW,
    heatBalanceResidualW: 0,
    temperatureSamples,
  };
}

function thermalError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
