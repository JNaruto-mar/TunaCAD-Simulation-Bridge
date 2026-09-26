import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCalculiXInputDeckV2 } from '../providers/calculix/CalculiXMultiDomainDeck.mts';
import { CalculiXMultiDomainSolverProvider } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { validateNonconformalThermalInterface } from '../providers/calculix/CalculiXThermalInterface.mts';
import { GmshMeshProvider } from '../providers/gmsh/GmshMeshProvider.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { solveTwoMaterialConductiveInterface } from '../simulation-bridge/steadyThermalValidation.mts';
import { admitV2SimulationRequest, sealNeutralSimulationRequestV2, validateNeutralFemModelV2, validateNeutralSimulationRequestV2, validateNeutralSimulationResultV2 } from '../simulation-bridge/v2Validation.mts';
import { composeNeutralFemModelV2, createNeutralMeshJobRequestV2 } from '../src/simulation/multiDomainFemModel.ts';
import type { NeutralFemMesh, NeutralMeshJobRequest, NeutralSimulationRequestV2, SimulationGeometryResolver } from '../src/simulation/externalSimulationContracts.ts';
import { createRequest } from './test-sim8-two-material-interface.mts';

const analytical = solveTwoMaterialConductiveInterface({
  firstLengthMm: 50, secondLengthMm: 50, areaMm2: 100,
  firstConductivityWPerMK: 50, secondConductivityWPerMK: 100,
  conductanceWPerM2K: 1000,
  baseTemperatureC: 20, inwardHeatFluxWPerM2: 10_000,
});
assert.deepEqual(analytical, {
  secondaryTemperatureC: 30, primaryTemperatureC: 40,
  endTemperatureC: 45, interfaceHeatFlowW: 1,
});
const original = createRequest();
const request: NeutralSimulationRequestV2 = sealNeutralSimulationRequestV2({
  ...original, studyId: 'sim8-nonconformal-interface-conductance',
  name: 'SIM-8 nonconformal finite-conductance interface',
  interactions: [{
    id: 'finite-interface', name: 'Finite conductance between distinct interface meshes',
    type: 'thermal_interface_conductance',
    secondaryReferenceIds: ['first-interface-face'],
    primaryReferenceIds: ['second-interface-face'],
    adjustment: 'none', positionToleranceMm: .001,
    conductanceWPerM2K: 1000,
  }],
});
validateNeutralSimulationRequestV2(request);
const solver = new CalculiXMultiDomainSolverProvider({
  executable: process.env.TUNACAD_CALCULIX_EXECUTABLE ?? 'C:\\fixture\\ccx216.exe',
  runtimeVersion: '2.16',
});
assert.deepEqual(admitV2SimulationRequest(request, solver.capabilities), { accepted: true });
for (const conductance of [0, -1, Number.NaN, 1e12]) {
  const malformed = sealNeutralSimulationRequestV2({
    ...request, interactions: [{ ...request.interactions[0], conductanceWPerM2K: conductance }],
  });
  assert.throws(() => validateNeutralSimulationRequestV2(malformed));
}
assert.throws(() => validateNeutralSimulationRequestV2(sealNeutralSimulationRequestV2({
  ...request, interactions: [{ ...request.interactions[0], primaryReferenceIds: ['end-face'] }],
})));
assert.throws(() => validateNeutralSimulationRequestV2(sealNeutralSimulationRequestV2({
  ...request, interactions: [{ ...request.interactions[0], adjustment: 'project' }],
})));
assert.throws(() => validateNeutralSimulationRequestV2(sealNeutralSimulationRequestV2({
  ...request, model: {
    ...request.model,
    domains: request.model.domains.map(domain => domain.domainId === 'second'
      ? { ...domain, transformToAnalysis: domain.transformToAnalysis.map((value, index) => index === 3 ? value + .1 : value) }
      : domain),
  },
})), /BRIDGE_V2_THERMAL_INTERFACE_INVALID/);

if (process.env.TUNACAD_SIM8_REAL === '1') {
  const gmshPath = process.env.TUNACAD_GMSH_EXECUTABLE;
  const calculixPath = process.env.TUNACAD_CALCULIX_EXECUTABLE;
  if (!gmshPath || !calculixPath) throw new Error('Set Gmsh and CalculiX paths for the focused fixture.');
  const directory = await mkdtemp(join(tmpdir(), 'tunacad-sim8-nonconformal-'));
  try {
    const stepPath = join(directory, 'slab.step');
    const geoPath = join(directory, 'slab.geo');
    await writeFile(geoPath, [
      'SetFactory("OpenCASCADE");',
      'Box(1) = {0, 0, 0, 50, 10, 10};',
      'Save "' + stepPath.replace(/\\/g, '/').replace(/"/g, '\\"') + '";',
    ].join('\n'), 'utf8');
    execFileSync(gmshPath, [geoPath, '-0', '-v', '2'], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const step = new Uint8Array(await readFile(stepPath));
    const meshRequest = createNeutralMeshJobRequestV2(request);
    const mesher = new GmshMeshProvider({ executable: gmshPath, runtimeVersion: '4.15.2' });
    const meshes: Array<{ domainId: string; mesh: NeutralFemMesh }> = [];
    for (const domain of meshRequest.domains) {
      const size = domain.domainId === 'first' ? 10 : 3;
      const localRequest: NeutralMeshJobRequest = {
        schema: 'tunacad-neutral-mesh-request/1.0',
        studyId: request.studyId, requestDigest: request.requestDigest,
        projectRevision: request.model.projectRevision, geometryDigest: domain.geometryDigest,
        coordinateSpace: 'part_definition_local', units: 'mm',
        mesh: { ...structuredClone(request.mesh), globalSizeMm: size },
        boundaryRegions: meshRequest.boundaryRegions.filter(region => region.domainId === domain.domainId).map(region => ({
          regionId: region.regionId, role: region.role === 'interaction' ? 'constraint' : region.role,
          semanticReferenceId: region.semanticReferenceId, sourceFeatureId: region.sourceFeatureId,
          face: structuredClone(region.faceOwnerLocal),
        })),
      };
      const references = request.model.references.filter(reference => reference.domainId === domain.domainId).map(reference => ({
        semanticReferenceId: reference.semanticReferenceId, ownerPartId: reference.ownerPartId,
        geometryKind: 'FACE' as const, role: reference.role === 'interaction' ? 'constraint' as const : reference.role,
        sourceFeatureId: reference.sourceFeatureId, resolutionState: 'valid' as const,
        resolvedAtProjectRevision: reference.resolvedAtProjectRevision,
        face: structuredClone(reference.faceOwnerLocal),
      }));
      const { boundingBoxOwnerLocalMm, ...shapeWithoutBox } = domain.shape;
      const descriptor: SimulationGeometryResolver['descriptor'] = {
        projectRevision: request.model.projectRevision, partId: domain.partId, bodyId: domain.bodyId,
        geometryDigest: domain.geometryDigest, coordinateSpace: 'part_definition_local',
        shape: { ...structuredClone(shapeWithoutBox), boundingBoxMm: structuredClone(boundingBoxOwnerLocalMm) },
        references,
      };
      const submitted = await mesher.submit(localRequest, { descriptor, export: async () => step });
      let mesh: NeutralFemMesh | null = null;
      for (let attempt = 0; attempt < 200 && !mesh; attempt++) {
        const status = await mesher.getStatus(submitted.meshRunId);
        if (status.status === 'failed') throw new Error('Gmsh failed: ' + status.failure?.message);
        if (status.status === 'succeeded') mesh = await mesher.getMesh(submitted.meshRunId);
        else await new Promise(resolve => setTimeout(resolve, 25));
      }
      if (!mesh) throw new Error('Gmsh did not produce the bounded domain mesh.');
      meshes.push({ domainId: domain.domainId, mesh });
    }
    const model = composeNeutralFemModelV2(meshRequest, meshes, {
      adapterId: 'tunacad-gmsh-multi-domain-poc', adapterVersion: '0.1.0-poc',
      engine: 'Gmsh', engineVersion: '4.15.2',
      optionsDigest: digest({ fixture: 'nonconformal-interface', firstGlobalSizeMm: 10, secondGlobalSizeMm: 3 }),
    });
    validateNeutralFemModelV2(model, request);
    const interaction = request.interactions[0];
    if (interaction.type !== 'thermal_interface_conductance') throw new Error('Wrong fixture interaction.');
    const mapped = validateNonconformalThermalInterface(model, interaction);
    assert.notEqual(mapped.secondaryFacets.length, mapped.primaryFacets.length,
      'The two interface triangulations must be nonmatching: ' + mapped.secondaryFacets.length + ' versus ' + mapped.primaryFacets.length + '.');
    const badModel = structuredClone(model);
    const badNode = badModel.boundaryFacets.connectivity[mapped.primaryFacets[0]][0];
    badModel.nodes[badNode] = [badModel.nodes[badNode][0], badModel.nodes[badNode][1] + .1, badModel.nodes[badNode][2]];
    assert.throws(() => validateNonconformalThermalInterface(badModel, interaction),
      { code: 'SIMULATION_THERMAL_INTERFACE_INVALID' });
    assert.throws(() => createCalculiXInputDeckV2(request, badModel));
    const incompleteCoverage = structuredClone(model);
    incompleteCoverage.boundaryRegions.find(region => region.semanticReferenceIds.includes('second-interface-face'))!.facetIndices.pop();
    assert.throws(() => validateNonconformalThermalInterface(incompleteCoverage, interaction),
      { code: 'SIMULATION_THERMAL_INTERFACE_INVALID' });
    const deck = createCalculiXInputDeckV2(request, model);
    assert.equal(deck, createCalculiXInputDeckV2(request, model));
    assert.match(deck, /^\*GAP CONDUCTANCE\n0\.001,,20$/m);
    assert.match(deck, /^\*CONTACT PAIR, INTERACTION=THERMAL_CONDUCTANCE_001, TYPE=SURFACE TO SURFACE$/m);
    const submission = await solver.submit(request, model);
    const result = await waitForResult(solver, submission.providerRunId);
    validateNeutralSimulationResultV2(result, request);
    const repeated = await solver.submit(request, model);
    const repeatedResult = await waitForResult(solver, repeated.providerRunId);
    validateNeutralSimulationResultV2(repeatedResult, request);
    assert.deepEqual(repeatedResult.thermal, result.thermal);
    const thermal = result.thermal!;
    const interfaceResult = thermal.interfaceConductance!;
    assert.ok(Math.abs(interfaceResult.secondaryTemperatureC - analytical.secondaryTemperatureC) <= .2);
    assert.ok(Math.abs(interfaceResult.primaryTemperatureC - analytical.primaryTemperatureC) <= .2);
    assert.ok(Math.abs(thermal.maximumTemperatureC - analytical.endTemperatureC) <= .2);
    assert.ok(Math.abs(interfaceResult.secondaryHeatFlowW - 1) <= .02);
    assert.ok(Math.abs(interfaceResult.primaryHeatFlowW - 1) <= .02);
    assert.ok(thermal.heatBalanceResidualW <= .02);
    const incomplete = structuredClone(result);
    if (incomplete.thermal) delete incomplete.thermal.interfaceConductance;
    assert.throws(() => validateNeutralSimulationResultV2(incomplete, request));
    console.log(JSON.stringify({
      status: 'PASS', fixture: 'nonconformal-thermal-interface-conductance',
      versions: { gmsh: '4.15.2', calculix: '2.16' },
      mesh: {
        sourceNodes: meshes[0].mesh.nodes.length, sourceElements: meshes[0].mesh.volumeElements.connectivity.length,
        targetNodes: meshes[1].mesh.nodes.length, targetElements: meshes[1].mesh.volumeElements.connectivity.length,
        secondaryFacets: mapped.secondaryFacets.length, primaryFacets: mapped.primaryFacets.length,
      },
      analytical,
      provider: {
        secondaryTemperatureC: interfaceResult.secondaryTemperatureC,
        primaryTemperatureC: interfaceResult.primaryTemperatureC,
        endTemperatureC: thermal.maximumTemperatureC,
        secondaryHeatFlowW: interfaceResult.secondaryHeatFlowW,
        primaryHeatFlowW: interfaceResult.primaryHeatFlowW,
        heatBalanceResidualW: thermal.heatBalanceResidualW,
        interfaceHeatImbalanceW: interfaceResult.interfaceHeatImbalanceW,
        conductancePredictedHeatFlowW: interfaceResult.conductancePredictedHeatFlowW,
      },
      deterministicDeck: true, deterministicNormalizedThermal: true,
    }, null, 2));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
} else {
  console.log('SIM-8 nonconformal interface analytical/admission PASS; set TUNACAD_SIM8_REAL=1 for the focused provider solve.');
}

async function waitForResult(provider: CalculiXMultiDomainSolverProvider, id: string) {
  const deadline = Date.now() + provider.capabilities.execution.totalTimeoutMs;
  while (Date.now() < deadline) {
    const status = await provider.getStatus(id);
    if (status.status === 'failed') throw new Error((status.failure?.code ?? 'SIMULATION_FAILED') + ': ' + (status.failure?.message ?? 'Unknown failure.'));
    if (status.status === 'succeeded') {
      const result = await provider.getResult(id);
      if (!result) throw new Error('CalculiX completed without a normalized result.');
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  await provider.cancel(id);
  throw new Error('Focused nonconformal thermal fixture timed out.');
}
