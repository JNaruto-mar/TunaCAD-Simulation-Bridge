import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCalculiXInputDeckV2 } from '../providers/calculix/CalculiXMultiDomainDeck.mts';
import { CalculiXMultiDomainSolverProvider, parseCalculiXSteadyThermalDatV2 } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { GmshMultiDomainMeshProvider } from '../providers/gmsh/GmshMultiDomainMeshProvider.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { solveRectangularConvectionFin } from '../simulation-bridge/steadyThermalValidation.mts';
import { admitV2SimulationRequest, sealNeutralSimulationRequestV2, validateNeutralSimulationRequestV2, validateNeutralSimulationResultV2 } from '../simulation-bridge/v2Validation.mts';
import type { NeutralFemModelV2, NeutralSimulationRequestV2, NeutralVector3, SimulationProviderCapabilitiesV2 } from '../src/simulation/externalSimulationContracts.ts';

const fin = { lengthMm: 50, widthMm: 10, thicknessMm: 2, thermalConductivityWPerMK: 100,
  filmCoefficientWPerM2K: 100, baseTemperatureC: 100, sinkTemperatureC: 20, sampleCount: 11 };
const reference = solveRectangularConvectionFin(fin);
assert.equal(reference.maximumTemperatureC, 100);
assert.ok(reference.minimumTemperatureC > 20 && reference.minimumTemperatureC < 100);
assert.ok(reference.totalAppliedHeatW < 0 && reference.totalReactionHeatW > 0);
assert.equal(reference.heatBalanceResidualW, 0);
assert.throws(() => solveRectangularConvectionFin({ ...fin, filmCoefficientWPerM2K: -1 }), { code: 'SIMULATION_THERMAL_FIXTURE_INVALID' });

const request = createRequest();
assert.deepEqual(validateNeutralSimulationRequestV2(request), request);
const solver = new CalculiXMultiDomainSolverProvider({ executable: process.env.TUNACAD_CALCULIX_EXECUTABLE ?? 'C:\\fixture\\ccx216.exe', runtimeVersion: '2.16' });
assert.deepEqual(admitV2SimulationRequest(request, solver.capabilities), { accepted: true });
const noConvection = structuredClone(solver.capabilities) as SimulationProviderCapabilitiesV2;
noConvection.study.steadyThermal!.loadTypes = ['surface_heat_flux'];
noConvection.study.steadyThermal!.maximumConvectionLoads = 0;
assert.equal(admitV2SimulationRequest(request, noConvection).accepted, false);
const malformed = sealNeutralSimulationRequestV2({ ...request,
  loads: [{ ...request.loads[0], filmCoefficientWPerM2K: -1 }] as any });
assert.throws(() => validateNeutralSimulationRequestV2(malformed), /BRIDGE_V2_REQUEST_INVALID/);
const parserModel = { nodes: [[0, 0, 0], [50, 0, 0]], volumeElements: { connectivity: [[0, 1, 0, 1, 0, 1, 0, 1, 0, 1]] } } as unknown as NeutralFemModelV2;
const sectionRows = [
  ' temperatures for set NALL and time 1', ' 1 100', ' 2 46.7',
  ' heat generation for set THERMAL_REACTION_001 and time 1', ' 1 5.1421',
  ' heat flux (elem, integ.pnt.,qx,qy,qz) for set EALL and time 1', ' 1 1 0.02 0 0',
  ' total surface flux (q) for set THERMAL_BASE_001 and time 1', ' -5.2161',
];
const parsed = parseCalculiXSteadyThermalDatV2(sectionRows.join('\n'), parserModel, ['THERMAL_REACTION_001'], 'THERMAL_BASE_001');
assert.equal(parsed.sectionBaseHeatFlowW, -5.2161);
assert.equal(parsed.reactionHeatBySetW.THERMAL_REACTION_001, 5.1421);
assert.throws(() => parseCalculiXSteadyThermalDatV2(sectionRows.slice(0, -2).join('\n'), parserModel, ['THERMAL_REACTION_001'], 'THERMAL_BASE_001'), /complete bounded NT, HFL, and RFL/);
assert.throws(() => parseCalculiXSteadyThermalDatV2([...sectionRows, ...sectionRows.slice(-2)].join('\n'), parserModel, ['THERMAL_REACTION_001'], 'THERMAL_BASE_001'), /malformed or repeated/);

if (process.env.TUNACAD_SIM8_REAL === '1') {
  const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
  const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
  if (!gmsh || !calculix) throw new Error('Set TUNACAD_GMSH_EXECUTABLE and TUNACAD_CALCULIX_EXECUTABLE for the focused real fin fixture.');
  const directory = await mkdtemp(join(tmpdir(), 'tunacad-sim8-fin-'));
  try {
    const stepPath = join(directory, 'fin.step');
    const geoPath = join(directory, 'fin.geo');
    await writeFile(geoPath, [
      'SetFactory("OpenCASCADE");',
      'Box(1) = {0, 0, 0, 50, 10, 2};',
      'Save "' + stepPath.replace(/\\/g, '/').replace(/"/g, '\\"') + '";',
    ].join('\n'), 'utf8');
    execFileSync(gmsh, [geoPath, '-0', '-v', '2'], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const step = new Uint8Array(await readFile(stepPath));
    const mesher = new GmshMultiDomainMeshProvider({ executable: gmsh, runtimeVersion: '4.15.2' });
    const model = await mesher.mesh(request, { descriptor: request.model,
      async exportDomain(domainId, format) {
        assert.equal(domainId, 'fin'); assert.equal(format, 'step'); return step;
      } });
    const deck = createCalculiXInputDeckV2(request, model);
    assert.equal(deck, createCalculiXInputDeckV2(request, model), 'Convection deck must be deterministic.');
    assert.match(deck, /^\*SURFACE, NAME=THERMAL_CONVECTION_001, TYPE=ELEMENT$/m);
    assert.match(deck, /^\*FILM\nTHERMAL_CONVECTION_001,F0,20,0\.0001$/m);
    assert.match(deck, /^\*SECTION PRINT, NAME=THERMAL_BASE_FLUX, SURFACE=THERMAL_BASE_001\nFLUX$/m);
    assert.doesNotMatch(deck, /^\*DFLUX$/m);
    const submission = await solver.submit(request, model);
    const result = await waitForResult(solver, submission.providerRunId);
    validateNeutralSimulationResultV2(result, request);
    const thermal = result.thermal!;
    const tipErrorC = Math.abs(thermal.minimumTemperatureC - reference.minimumTemperatureC);
    const baseReactionError = Math.abs(thermal.totalReactionHeatW - reference.totalReactionHeatW) / reference.totalReactionHeatW;
    const gradientError = Math.abs(thermal.maximumTemperatureGradientCPerM - reference.maximumTemperatureGradientCPerM) / reference.maximumTemperatureGradientCPerM;
    assert.ok(tipErrorC <= 3, 'Fin tip must agree with the one-dimensional oracle within 3 °C.');
    assert.ok(baseReactionError <= .05, 'Fin base reaction must agree with the one-dimensional oracle within 5%.');
    assert.ok(gradientError <= .1, 'Peak gradient must agree with the one-dimensional oracle within 10%.');
    assert.ok(thermal.heatBalanceResidualW <= Math.max(1e-9, Math.abs(thermal.totalAppliedHeatW) * .005));
    assert.ok(thermal.reactionHeatFlowEvidence);
    assert.ok(thermal.reactionHeatFlowEvidence.disagreementW <= Math.abs(thermal.totalReactionHeatW) * .02);
    assert.ok(result.warnings.some(warning => warning.code === 'SIMULATION_THERMAL_REACTION_METHOD_DISAGREEMENT'));
    assert.equal(result.review.engineeringUsePermitted, false);
    console.log(JSON.stringify({ status: 'PASS', fixture: '50x10x2-mm-convective-tip-fin',
      versions: { gmsh: '4.15.2', calculix: '2.16' },
      mesh: { nodes: model.nodes.length, elements: model.volumeElements.connectivity.length },
      analytical: { tipTemperatureC: reference.minimumTemperatureC, baseHeatFlowW: reference.totalReactionHeatW,
        maximumGradientCPerM: reference.maximumTemperatureGradientCPerM },
      provider: { tipTemperatureC: thermal.minimumTemperatureC, baseReactionHeatW: thermal.totalReactionHeatW,
        integratedConvectionHeatW: thermal.totalAppliedHeatW, heatBalanceResidualW: thermal.heatBalanceResidualW,
        nodalRflReactionHeatW: thermal.reactionHeatFlowEvidence.nodalRflReactionHeatW,
        reactionMethodDisagreementW: thermal.reactionHeatFlowEvidence.disagreementW,
        maximumGradientCPerM: thermal.maximumTemperatureGradientCPerM },
      comparison: { tipErrorC, baseReactionRelativeError: baseReactionError, maximumGradientRelativeError: gradientError } }, null, 2));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
} else {
  console.log('SIM-8 convection-fin analytical/admission PASS; set TUNACAD_SIM8_REAL=1 for one focused Gmsh/CalculiX provider solve.');
}

function createRequest(): NeutralSimulationRequestV2 {
  const now = Date.now();
  const bounds = { min: [0, 0, 0] as NeutralVector3, max: [50, 10, 2] as NeutralVector3 };
  const face = (id: string, role: 'load' | 'constraint', centroid: NeutralVector3, areaMm2: number,
    direction: NeutralVector3, min: NeutralVector3, max: NeutralVector3) => ({
    semanticReferenceId: id, domainId: 'fin', ownerPartId: 'fin-part', ownerBodyId: 'fin-body', occurrenceId: 'fin-occurrence',
    geometryKind: 'FACE' as const, role, sourceFeatureId: 'fin-box', resolutionState: 'valid' as const,
    resolvedAtProjectRevision: 'sim8-fin-r1',
    faceOwnerLocal: { centroidPartLocalMm: centroid, areaMm2, outwardDirection: direction, geometryType: 'plane',
      edgeCount: 4, boundingBoxMm: { min, max } },
  });
  return sealNeutralSimulationRequestV2({
    schema: 'tunacad-neutral-simulation-request/2.0', studyId: 'sim8-convection-fin', name: 'SIM-8 rectangular convection fin',
    preparedAt: new Date(now).toISOString(), expiresAt: new Date(now + 20 * 60_000).toISOString(),
    analysis: { type: 'steady_thermal', assumptions: ['steady_state', 'isotropic_conduction', 'temperature_independent_properties'] },
    model: { projectRevision: 'sim8-fin-r1', coordinateSpace: 'frozen_analysis',
      domains: [{ domainId: 'fin', partId: 'fin-part', bodyId: 'fin-body', occurrenceId: 'fin-occurrence',
        geometryDigest: digest({ fixture: '50x10x2-mm-fin-step' }), transformToAnalysis: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        shape: { valid: true, connectedSolidCount: 1, faceCount: 6, edgeCount: 12, volumeMm3: 1_000, surfaceAreaMm2: 1_240,
          boundingBoxOwnerLocalMm: { ...bounds, size: [50, 10, 2] } } }],
      references: [
        face('base-face', 'constraint', [0, 5, 1], 20, [-1, 0, 0], [0, 0, 0], [0, 10, 2]),
        face('tip-face', 'load', [50, 5, 1], 20, [1, 0, 0], [50, 0, 0], [50, 10, 2]),
        face('side-y0', 'load', [25, 0, 1], 100, [0, -1, 0], [0, 0, 0], [50, 0, 2]),
        face('side-y10', 'load', [25, 10, 1], 100, [0, 1, 0], [0, 10, 0], [50, 10, 2]),
        face('side-z0', 'load', [25, 5, 0], 500, [0, 0, -1], [0, 0, 0], [50, 10, 0]),
        face('side-z2', 'load', [25, 5, 2], 500, [0, 0, 1], [0, 0, 2], [50, 10, 2]),
      ] },
    units: { geometry: 'mm', force: 'N', stress: 'MPa', displacement: 'mm', density: 'kg/m^3', acceleration: 'mm/s^2',
      temperature: 'degC', heatFlux: 'W/m^2', heatFlow: 'W', thermalConductivity: 'W/(m*K)' },
    materials: [{ id: 'fin-material', name: 'Constant-conductivity fin', model: 'isotropic_linear_elastic',
      youngsModulusMPa: 1, poissonRatio: 0, thermalConductivityWPerMK: fin.thermalConductivityWPerMK,
      source: { kind: 'custom', reference: 'SIM-8 convection-fin analytical fixture' } }],
    materialAssignments: [{ assignmentId: 'fin-material-assignment', domainId: 'fin', materialId: 'fin-material', volumeRegionId: 'fin-volume' }],
    loads: [{ id: 'ambient-film', name: 'Five exposed fin faces', type: 'surface_convection',
      semanticReferenceIds: ['tip-face', 'side-y0', 'side-y10', 'side-z0', 'side-z2'],
      filmCoefficientWPerM2K: fin.filmCoefficientWPerM2K, sinkTemperatureC: fin.sinkTemperatureC }],
    constraints: [{ id: 'base-temperature', name: 'Fixed hot base', type: 'prescribed_temperature',
      semanticReferenceIds: ['base-face'], temperatureC: fin.baseTemperatureC }],
    interactions: [], mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2, globalSizeMm: 4,
      minimumSizeMm: 1, maximumNodes: 100_000, maximumElements: 50_000, qualityMetric: 'provider_normalized', minimumQuality: .04 },
    requestedResults: ['temperature', 'heat_flux', 'reaction_heat_flow'],
  });
}

async function waitForResult(solver: CalculiXMultiDomainSolverProvider, providerRunId: string) {
  const deadline = Date.now() + solver.capabilities.execution.totalTimeoutMs;
  while (Date.now() < deadline) {
    const status = await solver.getStatus(providerRunId);
    if (status.status === 'failed') throw new Error((status.failure?.code ?? 'SIMULATION_FAILED') + ': ' + (status.failure?.message ?? 'Unknown failure.'));
    if (status.status === 'succeeded') {
      const result = await solver.getResult(providerRunId);
      if (!result) throw new Error('CalculiX completed without a normalized SIM-8 fin result.');
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  await solver.cancel(providerRunId);
  throw new Error('Focused SIM-8 fin fixture timed out.');
}
