import { centrifugalFixture, reseal } from './centrifugalStaticFixture.mts';

/** Reuse the synthetic C3D10 contract mesh; never native acceptance evidence. */
export function uniformThermoelasticFixture(finalTemperatureC = 100) {
  const fixture = centrifugalFixture();
  fixture.request.loads = [{ id: 'temperature', name: 'Uniform temperature change · Experimental Preview',
    type: 'uniform_temperature_change', referenceTemperatureC: 20, finalTemperatureC }];
  fixture.request.materials[0].thermalExpansionPerK = 12e-6;
  fixture.request.materials[0].yieldStrengthMPa = 250;
  fixture.request.units.temperature = 'degC';
  fixture.request = reseal(fixture.request);
  fixture.model.requestDigest = fixture.request.requestDigest;
  fixture.model.modelDigest = fixture.request.model.modelDigest;
  return fixture;
}

/** Proposed only: one future mesh and solve require separate authorization. */
export const uniformThermoelasticBenchmark = {
  geometryMm: { length: 100, width: 5, height: 5 },
  material: { youngsModulusMPa: 210000, poissonRatio: .3, thermalExpansionPerK: 12e-6 },
  referenceTemperatureC: 20, finalTemperatureC: 100, fixedFace: 'X=0',
  meshSizeMm: 5, maximumNodes: 30000, maximumElements: 15000,
  solverTimeoutMs: 120000, engineeringUsePermitted: false,
} as const;
