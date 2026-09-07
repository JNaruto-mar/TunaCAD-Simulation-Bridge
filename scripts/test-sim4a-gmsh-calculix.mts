import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCalculiXInputDeckV2, asV1Mesh } from '../providers/calculix/CalculiXMultiDomainDeck.mts';
import { parseCalculiXDat } from '../providers/calculix/CalculiXSolverProvider.mts';
import { GmshMultiDomainMeshProvider } from '../providers/gmsh/GmshMultiDomainMeshProvider.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { admitV2MeshRequest, sealNeutralSimulationRequestV2, validateNeutralSimulationRequestV2 } from '../simulation-bridge/v2Validation.mts';
import type { NeutralSimulationRequestV2, NeutralVector3 } from '../src/simulation/externalSimulationContracts.ts';

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (!gmsh || !calculix) throw new Error('Set TUNACAD_GMSH_EXECUTABLE and TUNACAD_CALCULIX_EXECUTABLE to run SIM-4A provider acceptance.');

const directory = await mkdtemp(join(tmpdir(), 'tunacad-sim4a-provider-'));
try {
  const stepPath = join(directory, 'coupon.step');
  const geoPath = join(directory, 'coupon.geo');
  const output = stepPath.replace(/\\/g, '/').replace(/"/g, '\\"');
  await writeFile(geoPath, ['SetFactory("OpenCASCADE");', 'Box(1) = {0, 0, 0, 40, 10, 10};', `Save "${output}";`].join('\n'), 'utf8');
  execFileSync(gmsh, [geoPath, '-0', '-v', '2'], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const step = new Uint8Array(await readFile(stepPath));
  const request = createRequest();
  validateNeutralSimulationRequestV2(request);
  const exported: string[] = [];
  const provider = new GmshMultiDomainMeshProvider({ executable: gmsh, runtimeVersion: '4.15.2' });
  assert.deepEqual(admitV2MeshRequest(provider.capabilities), { accepted: true });
  const model = await provider.mesh(request, {
    descriptor: request.model,
    async exportDomain(domainId, format) {
      assert.equal(format, 'step');
      exported.push(domainId);
      return step;
    },
  });
  assert.deepEqual(exported, ['domain-steel', 'domain-aluminum']);
  assert.equal(model.domainRegions.length, 2);
  assert.equal(new Set(model.volumeElements.domainIds).size, 2);
  assert.deepEqual(new Set(model.volumeElements.materialIds), new Set(['steel', 'aluminum']));
  assert.equal(model.quality.cadVolumeMm3, 8000);
  assert.ok(model.quality.volumeRelativeError <= 0.05);
  const steel = model.domainRegions.find(domain => domain.domainId === 'domain-steel')!;
  const aluminum = model.domainRegions.find(domain => domain.domainId === 'domain-aluminum')!;
  assert.ok(Math.max(...steel.nodeIndices.map(node => model.nodes[node][1])) <= 10.000001);
  assert.ok(Math.min(...aluminum.nodeIndices.map(node => model.nodes[node][1])) >= 24.999999, 'The second occurrence transform was not applied in analysis coordinates.');
  assert.equal(steel.geometryDigest, aluminum.geometryDigest, 'Repeated Part occurrences should reuse the same owner-local geometry digest.');
  assert.notEqual(steel.domainDigest, aluminum.domainDigest);

  const deck = createCalculiXInputDeckV2(request, model);
  assert.equal((deck.match(/^\*MATERIAL, NAME=/gm) ?? []).length, 2);
  assert.equal((deck.match(/^\*SOLID SECTION,/gm) ?? []).length, 2);
  assert.equal((deck.match(/^\*ELEMENT, TYPE=C3D10, ELSET=DOMAIN_/gm) ?? []).length, 2);
  assert.match(deck, /\*MATERIAL, NAME=MATERIAL_001\n\*ELASTIC\n70000,0\.33/);
  assert.match(deck, /\*MATERIAL, NAME=MATERIAL_002\n\*ELASTIC\n210000,0\.3/);
  assert.doesNotMatch(deck, /^\*(?:TIE|CONTACT|RIGID BODY)/gm, 'SIM-4A must not infer connected behavior.');
  assert.match(deck, /\*SOLID SECTION, ELSET=DOMAIN_001, MATERIAL=MATERIAL_001/);
  assert.match(deck, /\*SOLID SECTION, ELSET=DOMAIN_002, MATERIAL=MATERIAL_002/);

  await writeFile(join(directory, 'sim4a.inp'), deck, 'utf8');
  execFileSync(calculix, ['-i', 'sim4a'], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const parsed = parseCalculiXDat(await readFile(join(directory, 'sim4a.dat'), 'utf8'), asV1Mesh(model), ['REACTION_001', 'REACTION_002']);
  assert.ok(parsed.maximumDisplacementMm > 0 && Number.isFinite(parsed.maximumDisplacementMm));
  assert.ok(parsed.maximumVonMisesStressMPa > 0 && Number.isFinite(parsed.maximumVonMisesStressMPa));
  const totalReaction = Object.values(parsed.reactionForcesBySet).reduce<NeutralVector3>((sum, force) => [sum[0] + force[0], sum[1] + force[1], sum[2] + force[2]], [0, 0, 0]);
  assert.ok(Math.abs(totalReaction[0] + 200) <= 0.05, `Expected -200 N total X reaction, received ${totalReaction.join(', ')}.`);
  assert.ok(Math.abs(totalReaction[1]) <= 0.05 && Math.abs(totalReaction[2]) <= 0.05);

  const wrongMaterial = structuredClone(model);
  wrongMaterial.volumeElements.materialIds[wrongMaterial.domainRegions[1].elementIndices[0]] = 'steel';
  assert.throws(() => createCalculiXInputDeckV2(request, wrongMaterial), /BRIDGE_V2_FEM_DOMAIN_MAPPING_INVALID/);
  const gravityWithoutDensity = structuredClone(request);
  gravityWithoutDensity.loads.push({ id: 'gravity', name: 'Gravity', type: 'gravity', accelerationMmPerS2: [0, 0, -9810], coordinateSystem: 'analysis' });
  delete gravityWithoutDensity.materials[0].densityKgM3;
  reseal(gravityWithoutDensity);
  assert.throws(() => createCalculiXInputDeckV2(gravityWithoutDensity, { ...structuredClone(model), requestDigest: gravityWithoutDensity.requestDigest, modelDigest: gravityWithoutDensity.model.modelDigest }), { code: 'SIMULATION_MATERIAL_INVALID' });

  console.log(JSON.stringify({
    domains: model.domainRegions.map(domain => ({ domainId: domain.domainId, occurrenceId: domain.occurrenceId, materialId: domain.materialId, elementCount: domain.elementIndices.length })),
    nodeCount: model.nodes.length, elementCount: model.volumeElements.connectivity.length,
    maximumDisplacementMm: parsed.maximumDisplacementMm, maximumVonMisesStressMPa: parsed.maximumVonMisesStressMPa,
    totalReactionN: totalReaction, inferredInteractions: 0,
  }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}

function createRequest(): NeutralSimulationRequestV2 {
  const geometryDigest = digest({ fixture: '40x10x10-owner-local-step' });
  const shape = {
    valid: true as const, connectedSolidCount: 1 as const, faceCount: 6, edgeCount: 12,
    volumeMm3: 4000, surfaceAreaMm2: 1800,
    boundingBoxOwnerLocalMm: { min: [0, 0, 0] as NeutralVector3, max: [40, 10, 10] as NeutralVector3, size: [40, 10, 10] as NeutralVector3 },
  };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;
  const translated = [1, 0, 0, 0, 0, 1, 0, 25, 0, 0, 1, 0, 0, 0, 0, 1] as const;
  const projectRevision = 'sim4a-provider-r1';
  const face = (id: string, domainId: string, occurrenceId: string, role: 'load' | 'constraint', x: number) => ({
    semanticReferenceId: id, domainId, ownerPartId: 'coupon', ownerBodyId: 'body', occurrenceId,
    geometryKind: 'FACE' as const, role, sourceFeatureId: 'box', resolutionState: 'valid' as const, resolvedAtProjectRevision: projectRevision,
    faceOwnerLocal: {
      centroidPartLocalMm: [x, 5, 5] as NeutralVector3, areaMm2: 100,
      outwardDirection: [x === 0 ? -1 : 1, 0, 0] as NeutralVector3, geometryType: 'plane', edgeCount: 4,
      boundingBoxMm: { min: [x, 0, 0] as NeutralVector3, max: [x, 10, 10] as NeutralVector3 },
    },
  });
  return sealNeutralSimulationRequestV2({
    schema: 'tunacad-neutral-simulation-request/2.0', studyId: 'sim4a-gmsh-calculix', name: 'Two-material repeated coupon',
    preparedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    analysis: { type: 'linear_static', assumptions: ['small_displacement', 'small_strain', 'static_loading'] },
    model: {
      projectRevision, coordinateSpace: 'frozen_analysis',
      domains: [
        { domainId: 'domain-steel', partId: 'coupon', bodyId: 'body', occurrenceId: 'coupon:steel', geometryDigest, transformToAnalysis: [...identity], shape },
        { domainId: 'domain-aluminum', partId: 'coupon', bodyId: 'body', occurrenceId: 'coupon:aluminum', geometryDigest, transformToAnalysis: [...translated], shape },
      ],
      references: [
        face('support-steel', 'domain-steel', 'coupon:steel', 'constraint', 0),
        face('support-aluminum', 'domain-aluminum', 'coupon:aluminum', 'constraint', 0),
        face('load-steel', 'domain-steel', 'coupon:steel', 'load', 40),
        face('load-aluminum', 'domain-aluminum', 'coupon:aluminum', 'load', 40),
      ],
    },
    units: { geometry: 'mm', force: 'N', stress: 'MPa', displacement: 'mm', density: 'kg/m^3', acceleration: 'mm/s^2' },
    materials: [
      { id: 'steel', name: 'Steel', model: 'isotropic_linear_elastic', densityKgM3: 7850, youngsModulusMPa: 210000, poissonRatio: 0.3, source: { kind: 'custom', reference: 'SIM-4A fixture' } },
      { id: 'aluminum', name: 'Aluminum', model: 'isotropic_linear_elastic', densityKgM3: 2700, youngsModulusMPa: 70000, poissonRatio: 0.33, source: { kind: 'custom', reference: 'SIM-4A fixture' } },
    ],
    materialAssignments: [
      { assignmentId: 'assign-steel', domainId: 'domain-steel', materialId: 'steel', volumeRegionId: 'volume-steel' },
      { assignmentId: 'assign-aluminum', domainId: 'domain-aluminum', materialId: 'aluminum', volumeRegionId: 'volume-aluminum' },
    ],
    loads: [
      { id: 'pull-steel', name: 'Pull steel', type: 'surface_force', semanticReferenceIds: ['load-steel'], forceN: [100, 0, 0], coordinateSystem: 'analysis' },
      { id: 'pull-aluminum', name: 'Pull aluminum', type: 'surface_force', semanticReferenceIds: ['load-aluminum'], forceN: [100, 0, 0], coordinateSystem: 'analysis' },
    ],
    constraints: [
      { id: 'fix-steel', name: 'Fix steel', type: 'fixed', semanticReferenceIds: ['support-steel'] },
      { id: 'fix-aluminum', name: 'Fix aluminum', type: 'fixed', semanticReferenceIds: ['support-aluminum'] },
    ],
    interactions: [], mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2, globalSizeMm: 5, minimumSizeMm: 1.25, maximumNodes: 100000, maximumElements: 50000, qualityMetric: 'provider_normalized', minimumQuality: 0.04 },
    requestedResults: ['von_mises_stress', 'displacement', 'reaction_force'],
  });
}

function reseal(request: NeutralSimulationRequestV2): void {
  const sealed = sealNeutralSimulationRequestV2({ ...(request as any), requestDigest: undefined, model: { ...(request.model as any), modelDigest: undefined, domains: request.model.domains.map(domain => ({ ...domain, domainDigest: undefined })) } });
  Object.assign(request, sealed);
}
