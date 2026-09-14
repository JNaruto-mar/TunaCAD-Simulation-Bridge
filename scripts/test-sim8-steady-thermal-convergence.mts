import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (!gmsh || !calculix) throw new Error('Set TUNACAD_GMSH_EXECUTABLE and TUNACAD_CALCULIX_EXECUTABLE to run SIM-8 convergence.');

interface FixtureEvidence {
  status: 'PASS';
  fixture: string;
  versions: { gmsh: string; calculix: string };
  mesh: { globalSizeMm: number; nodes: number; elements: number };
  calculated: {
    minimumTemperatureC: number;
    maximumTemperatureC: number;
    maximumTemperatureGradientCPerM: number;
    totalAppliedHeatW: number;
    totalReactionHeatW: number;
    heatBalanceResidualW: number;
    boundedTemperatureSampleCount: number;
  };
  analytical: {
    minimumTemperatureC: number;
    maximumTemperatureC: number;
    maximumTemperatureGradientCPerM: number;
    totalAppliedHeatW: number;
    totalReactionHeatW: number;
  };
  maximumProfileErrorC: number;
  engineeringUsePermitted: false;
}

const fixtureScript = fileURLToPath(new URL('./test-sim8-steady-thermal-real.mts', import.meta.url));
const sizes = [10, 6, 4];
const refinements = sizes.map(runFixture);
for (let index = 1; index < refinements.length; index += 1) {
  assert.ok(refinements[index].mesh.elements > refinements[index - 1].mesh.elements, 'Element count must increase under SIM-8 mesh refinement.');
  assert.ok(refinements[index].mesh.nodes > refinements[index - 1].mesh.nodes, 'Node count must increase under SIM-8 mesh refinement.');
}
for (const evidence of refinements) {
  assert.equal(evidence.status, 'PASS');
  assert.equal(evidence.engineeringUsePermitted, false);
  assert.ok(Math.abs(evidence.calculated.minimumTemperatureC - 20) <= 0.01);
  assert.ok(Math.abs(evidence.calculated.maximumTemperatureC - 40) <= 0.05);
  assert.ok(Math.abs(evidence.calculated.maximumTemperatureGradientCPerM - 200) <= 2);
  assert.ok(Math.abs(evidence.calculated.totalReactionHeatW + 1) <= 1e-6);
  assert.ok(evidence.calculated.heatBalanceResidualW <= 1e-6);
  assert.ok(evidence.maximumProfileErrorC <= 0.05);
}
const maximumTemperatureDriftC = range(refinements.map(item => item.calculated.maximumTemperatureC));
const maximumGradientDriftCPerM = range(refinements.map(item => item.calculated.maximumTemperatureGradientCPerM));
const maximumReactionDriftW = range(refinements.map(item => item.calculated.totalReactionHeatW));
assert.ok(maximumTemperatureDriftC <= 0.01, 'Refined maximum temperatures must be mesh invariant for the linear patch fixture.');
assert.ok(maximumGradientDriftCPerM <= 0.1, 'Refined HFL gradients must be mesh invariant for the linear patch fixture.');
assert.ok(maximumReactionDriftW <= 1e-6, 'Refined RFL resultants must remain mesh invariant.');

const repeatedFine = runFixture(4);
assert.deepEqual(repeatedFine.mesh, refinements.at(-1)!.mesh, 'Repeated Gmsh mesh counts must be deterministic.');
assert.deepEqual(repeatedFine.calculated, refinements.at(-1)!.calculated, 'Repeated normalized thermal summaries must be deterministic.');
assert.equal(repeatedFine.maximumProfileErrorC, refinements.at(-1)!.maximumProfileErrorC);

console.log(JSON.stringify({
  status: 'PASS',
  fixture: 'SIM-8 one-dimensional conduction mesh convergence and repeatability',
  versions: { gmsh: '4.15.2', calculix: '2.16', node: process.versions.node },
  refinements: refinements.map(item => ({
    globalSizeMm: item.mesh.globalSizeMm,
    nodes: item.mesh.nodes,
    elements: item.mesh.elements,
    maximumTemperatureC: item.calculated.maximumTemperatureC,
    maximumTemperatureGradientCPerM: item.calculated.maximumTemperatureGradientCPerM,
    totalReactionHeatW: item.calculated.totalReactionHeatW,
    heatBalanceResidualW: item.calculated.heatBalanceResidualW,
    maximumProfileErrorC: item.maximumProfileErrorC,
  })),
  drift: { maximumTemperatureDriftC, maximumGradientDriftCPerM, maximumReactionDriftW },
  repeatability: { meshAndNormalizedSummaryExact: true, repeatedGlobalSizeMm: repeatedFine.mesh.globalSizeMm },
  engineeringUsePermitted: false,
}, null, 2));

function runFixture(globalSizeMm: number): FixtureEvidence {
  const output = execFileSync(process.execPath, ['--experimental-strip-types', fixtureScript], {
    env: { ...process.env, TUNACAD_SIM8_GLOBAL_SIZE_MM: String(globalSizeMm) },
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
  return JSON.parse(output) as FixtureEvidence;
}

function range(values: number[]): number {
  return Math.max(...values) - Math.min(...values);
}
