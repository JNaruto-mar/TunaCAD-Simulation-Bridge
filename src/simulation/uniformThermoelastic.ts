import type { NeutralSimulationConstraintV2, NeutralSimulationLoadV2, NeutralSimulationMaterial } from './externalSimulationContracts.ts';

export type UniformTemperatureLoad = Extract<NeutralSimulationLoadV2, { type: 'uniform_temperature_change' }>;

/** Bounded, single-solid thermal strain; this is not a transferred thermal field. */
export function uniformThermoelasticIssue(
  analysisType: string, domainCount: number, materials: NeutralSimulationMaterial[],
  loads: NeutralSimulationLoadV2[], constraints: NeutralSimulationConstraintV2[], interactionCount: number,
): string | null {
  const thermal = loads.filter((load): load is UniformTemperatureLoad => load.type === 'uniform_temperature_change');
  if (!thermal.length) return null;
  const load = thermal[0];
  if (Object.keys(load).some(key => !['id', 'name', 'type', 'referenceTemperatureC', 'finalTemperatureC'].includes(key)))
    return 'Uniform thermoelastic loading accepts only reference and final scalar temperatures.';
  if (analysisType !== 'linear_static' || domainCount !== 1 || materials.length !== 1
    || loads.length !== 1 || thermal.length !== 1 || interactionCount !== 0
    || !constraints.length || constraints.length > 32 || constraints.some(constraint => constraint.type !== 'fixed'))
    return 'Uniform thermoelastic Preview requires one elastic solid, one temperature change, fixed FACE restraints, and no other loads or interactions.';
  const material = materials[0];
  if (material.model !== 'isotropic_linear_elastic' || !Number.isFinite(material.thermalExpansionPerK)
    || material.thermalExpansionPerK! <= 0 || material.thermalExpansionPerK! > 1e-2)
    return 'Assign a source-governed positive thermal expansion coefficient (1/K) to the elastic material.';
  if (!Number.isFinite(material.youngsModulusMPa) || material.youngsModulusMPa < 1 || material.youngsModulusMPa > 1e6
    || !Number.isFinite(material.poissonRatio) || material.poissonRatio < 0 || material.poissonRatio > .499999)
    return 'Uniform thermoelastic Preview requires E from 1 to 1000000 MPa and Poisson ratio from 0 to 0.499999.';
  if (!Number.isFinite(load.referenceTemperatureC) || !Number.isFinite(load.finalTemperatureC)
    || load.referenceTemperatureC < -273.15 || load.referenceTemperatureC > 1000
    || load.finalTemperatureC < -273.15 || load.finalTemperatureC > 1000
    || Math.abs(load.finalTemperatureC - load.referenceTemperatureC) < 1e-9
    || Math.abs(load.finalTemperatureC - load.referenceTemperatureC) > 1000)
    return 'Specify finite reference and final temperatures from -273.15 to 1000 C with a nonzero change no greater than 1000 K.';
  if (Math.abs(material.thermalExpansionPerK! * (load.finalTemperatureC - load.referenceTemperatureC)) > .01)
    return 'Uniform thermoelastic Preview limits the magnitude of free thermal strain to 1%.';
  return null;
}
