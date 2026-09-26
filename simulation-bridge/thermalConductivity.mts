import type { NeutralSimulationMaterial } from '../src/simulation/externalSimulationContracts.ts';

export type ThermalConductivityCurve = NonNullable<NeutralSimulationMaterial['thermalConductivityCurve']>;

/** Narrow SIM-8 tabular law: bounded positive k, strictly increasing
 * temperatures and k, and at most a tenfold conductivity change. */
export function isBoundedThermalConductivityCurve(curve: unknown): curve is ThermalConductivityCurve {
  if (!Array.isArray(curve) || curve.length < 2 || curve.length > 16) return false;
  for (let index = 0; index < curve.length; index += 1) {
    const point = curve[index];
    if (!point || typeof point !== 'object' || Object.keys(point).sort().join(',') !== 'conductivityWPerMK,temperatureC'
      || !Number.isFinite(point.temperatureC) || point.temperatureC < -273.15 || point.temperatureC > 1e6
      || !Number.isFinite(point.conductivityWPerMK) || point.conductivityWPerMK <= 0 || point.conductivityWPerMK > 1e7
      || index > 0 && (point.temperatureC <= curve[index - 1].temperatureC
        || point.conductivityWPerMK <= curve[index - 1].conductivityWPerMK)) return false;
  }
  return curve.at(-1)!.conductivityWPerMK / curve[0].conductivityWPerMK <= 10;
}

/** Piecewise-linear interpolation. Values beyond the declared temperature
 * interval are rejected, never silently clamped or extrapolated. */
export function interpolateThermalConductivity(curve: ThermalConductivityCurve, temperatureC: number): number {
  if (!isBoundedThermalConductivityCurve(curve) || !Number.isFinite(temperatureC)
    || temperatureC < curve[0].temperatureC || temperatureC > curve.at(-1)!.temperatureC) {
    throw thermalConductivityError('SIMULATION_THERMAL_CONDUCTIVITY_OUT_OF_RANGE');
  }
  for (let index = 1; index < curve.length; index += 1) {
    const upper = curve[index]; const lower = curve[index - 1];
    if (temperatureC <= upper.temperatureC) {
      const fraction = (temperatureC - lower.temperatureC) / (upper.temperatureC - lower.temperatureC);
      return lower.conductivityWPerMK + fraction * (upper.conductivityWPerMK - lower.conductivityWPerMK);
    }
  }
  return curve.at(-1)!.conductivityWPerMK;
}

/** Exact integral of the piecewise-linear k(T), in W/m, from base to end. */
export function integratedThermalConductivity(curve: ThermalConductivityCurve, baseC: number, endC: number): number {
  if (!isBoundedThermalConductivityCurve(curve) || !Number.isFinite(baseC) || !Number.isFinite(endC)
    || baseC < curve[0].temperatureC || endC > curve.at(-1)!.temperatureC || endC < baseC) {
    throw thermalConductivityError('SIMULATION_THERMAL_CONDUCTIVITY_OUT_OF_RANGE');
  }
  let integral = 0;
  for (let index = 1; index < curve.length; index += 1) {
    const low = Math.max(baseC, curve[index - 1].temperatureC);
    const high = Math.min(endC, curve[index].temperatureC);
    if (high > low) integral += (interpolateThermalConductivity(curve, low) + interpolateThermalConductivity(curve, high)) * (high - low) / 2;
  }
  return integral;
}

function thermalConductivityError(code: string): Error {
  return Object.assign(new Error('Temperature is outside the bounded tabulated conductivity interval.'), { code });
}
