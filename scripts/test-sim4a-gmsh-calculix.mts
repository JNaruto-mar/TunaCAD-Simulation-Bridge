import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCalculiXInputDeckV2 } from '../providers/calculix/CalculiXMultiDomainDeck.mts';
import { CalculiXMultiDomainSolverProvider } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
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
  const tiedRequest = createBondedRequest();
  const tiedModel = await provider.mesh(tiedRequest, { descriptor: tiedRequest.model, async exportDomain() { return step; } });
  const tiedDeck = createCalculiXInputDeckV2(tiedRequest, tiedModel);
  assert.match(tiedDeck, /^\*SURFACE, NAME=TIE_SECONDARY_001, TYPE=ELEMENT$/m);
  assert.match(tiedDeck, /^\*SURFACE, NAME=TIE_PRIMARY_001, TYPE=ELEMENT$/m);
  assert.match(tiedDeck, /^\*TIE, NAME=TIE_001, ADJUST=NO, POSITION TOLERANCE=0\.05$/m);
  assert.match(tiedDeck, /^TIE_SECONDARY_001,TIE_PRIMARY_001$/m);
  const sharedRequest = createSharedTopologyRequest();
  const sharedModel = await provider.mesh(sharedRequest, { descriptor: sharedRequest.model, async exportDomain() { return step; } });
  const sharedNodes = new Set(sharedModel.domainRegions[0].nodeIndices.filter(node => sharedModel.domainRegions[1].nodeIndices.includes(node)));
  assert.ok(sharedNodes.size > 0, 'A conformal interface must share node identities across both domains.');
  assert.ok(sharedModel.nodes.length < tiedModel.nodes.length, 'Shared topology must compact duplicate interface nodes.');
  const sharedDeck = createCalculiXInputDeckV2(sharedRequest, sharedModel);
  assert.doesNotMatch(sharedDeck, /^\*(?:TIE|CONTACT)/gm, 'Conformal shared topology must not emit a solver tie or contact card.');
  const remoteLoadRequest = createRemoteLoadRequest();
  const remoteLoadModel = await provider.mesh(remoteLoadRequest, { descriptor: remoteLoadRequest.model, async exportDomain() { return step; } });
  const remoteLoadDeck = createCalculiXInputDeckV2(remoteLoadRequest, remoteLoadModel);
  assert.match(remoteLoadDeck, /^\*RIGID BODY, NSET=RIGID_CONNECTOR_001, REF NODE=\d+, ROT NODE=\d+$/m);
  assert.match(remoteLoadDeck, /^\d+,1,100$/m, 'Remote force must be applied to the generated reference node.');
  assert.match(remoteLoadDeck, /^\d+,3,250$/m, 'Remote moment must be applied through the generated rotation node.');
  const remoteSupportRequest = createRemoteSupportRequest();
  const remoteSupportModel = await provider.mesh(remoteSupportRequest, { descriptor: remoteSupportRequest.model, async exportDomain() { return step; } });
  const remoteSupportDeck = createCalculiXInputDeckV2(remoteSupportRequest, remoteSupportModel);
  assert.match(remoteSupportDeck, /^\*NSET, NSET=REACTION_001\n\d+$/m);
  assert.ok((remoteSupportDeck.match(/^\d+,[123],[123],0$/gm) ?? []).length >= 6, 'A fixed remote support must constrain three reference translations and three reference rotations.');
  const nonconformal = structuredClone(sharedRequest);
  nonconformal.model.domains[1].transformToAnalysis[3] += .01;
  nonconformal.interactions[0].positionToleranceMm = .001;
  reseal(nonconformal);
  await assert.rejects(() => provider.mesh(nonconformal, { descriptor: nonconformal.model, async exportDomain() { return step; } }), { code: 'SIMULATION_SHARED_TOPOLOGY_NONCONFORMAL' });
  const overlapping = structuredClone(sharedRequest);
  overlapping.model.domains[1].transformToAnalysis = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const overlapPrimary = overlapping.model.references.find(reference => reference.semanticReferenceId === 'tie-primary')!;
  overlapPrimary.faceOwnerLocal.centroidPartLocalMm = [40, 5, 5]; overlapPrimary.faceOwnerLocal.outwardDirection = [1, 0, 0];
  overlapPrimary.faceOwnerLocal.boundingBoxMm = { min: [40, 0, 0], max: [40, 10, 10] };
  const overlapLoad = overlapping.model.references.find(reference => reference.semanticReferenceId === 'load-aluminum')!;
  overlapLoad.faceOwnerLocal.centroidPartLocalMm = [0, 5, 5]; overlapLoad.faceOwnerLocal.outwardDirection = [-1, 0, 0];
  overlapLoad.faceOwnerLocal.boundingBoxMm = { min: [0, 0, 0], max: [0, 10, 10] };
  reseal(overlapping);
  await assert.rejects(() => provider.mesh(overlapping, { descriptor: overlapping.model, async exportDomain() { return step; } }), { code: 'SIMULATION_SHARED_TOPOLOGY_ORIENTATION_INVALID' });

  const solver = new CalculiXMultiDomainSolverProvider({ executable: calculix, runtimeVersion: '2.16' });
  const submission = await solver.submit(request, model);
  const result = await waitForResult(solver, submission.providerRunId);
  assert.equal(result.perDomain.length, 2);
  const steelResult = result.perDomain.find(domain => domain.domainId === 'domain-steel')!;
  const aluminumResult = result.perDomain.find(domain => domain.domainId === 'domain-aluminum')!;
  assert.ok(aluminumResult.metrics.maximumDisplacementMm! > steelResult.metrics.maximumDisplacementMm! * 2.9, 'Per-domain recovery did not preserve the expected stiffness contrast.');
  assert.equal(new Set(result.perDomain.flatMap(domain => domain.fieldDatasetIds)).size, 4);
  for (const domain of result.perDomain) for (const datasetId of domain.fieldDatasetIds) {
    let cursor: string | undefined = '0'; const triangles: unknown[] = []; let datasetDigest = '';
    do {
      const page = await solver.getFieldDataset(submission.providerRunId, datasetId, cursor, 17);
      assert.equal(page.dataset.domainId, domain.domainId); assert.ok(page.triangleCount <= 17);
      assert.equal(page.chunkDigest, digest(page.triangles)); datasetDigest ||= page.dataset.datasetDigest;
      assert.equal(page.dataset.datasetDigest, datasetDigest); triangles.push(...page.triangles); cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    assert.equal(digest(triangles), datasetDigest, 'Complete paginated field digest must match.');
  }
  const totalReaction = result.reactions.reduce<NeutralVector3>((sum, reaction) => [sum[0] + reaction.forceN[0], sum[1] + reaction.forceN[1], sum[2] + reaction.forceN[2]], [0, 0, 0]);
  assert.ok(Math.abs(totalReaction[0] + 200) <= 0.05, `Expected -200 N total X reaction, received ${totalReaction.join(', ')}.`);
  assert.ok(Math.abs(totalReaction[1]) <= 0.05 && Math.abs(totalReaction[2]) <= 0.05);
  const tiedSubmission = await solver.submit(tiedRequest, tiedModel); const tiedResult = await waitForResult(solver, tiedSubmission.providerRunId);
  assert.ok(Math.abs(tiedResult.reactions[0].forceN[0] + 100) <= .1, 'Explicit bonded coupon must balance its 100 N load.');
  assert.ok(tiedResult.metrics.maximumDisplacementMm! > .00065 && tiedResult.metrics.maximumDisplacementMm! < .0009, 'Two-material bonded coupon displacement must follow the series-stiffness trend.');
  const sharedSubmission = await solver.submit(sharedRequest, sharedModel); const sharedResult = await waitForResult(solver, sharedSubmission.providerRunId);
  const sharedReactionX = sharedResult.reactions.reduce((sum, reaction) => sum + reaction.forceN[0], 0);
  assert.ok(Math.abs(sharedReactionX + 100) <= .1, 'Shared-topology coupon must balance its 100 N load.');
  assert.ok(sharedResult.metrics.maximumDisplacementMm! > .00065 && sharedResult.metrics.maximumDisplacementMm! < .0009, 'Shared-topology coupon displacement must follow the series-stiffness trend.');
  assert.ok(Math.abs(sharedResult.metrics.maximumDisplacementMm! - tiedResult.metrics.maximumDisplacementMm!) / tiedResult.metrics.maximumDisplacementMm! < .08,
    'Tie and conformal formulations should agree for the matching linear coupon.');
  const remoteLoadSubmission = await solver.submit(remoteLoadRequest, remoteLoadModel); const remoteLoadResult = await waitForResult(solver, remoteLoadSubmission.providerRunId);
  assert.ok(Math.abs(remoteLoadResult.reactions[0].forceN[0] + 100) <= .1, 'Rigid remote force must balance at the fixed support.');
  assert.ok(remoteLoadResult.metrics.maximumDisplacementMm! > 0, 'Rigid remote force and moment must produce a finite non-zero response.');
  assert.equal(remoteLoadResult.reactions[0].momentNmm, null, 'A direct FACE support does not claim a normalized moment resultant.');
  const remoteSupportSubmission = await solver.submit(remoteSupportRequest, remoteSupportModel); const remoteSupportResult = await waitForResult(solver, remoteSupportSubmission.providerRunId);
  assert.ok(Math.abs(remoteSupportResult.reactions[0].forceN[0] + 100) <= .1, 'Rigid remote support must recover the applied force resultant at its reference point.');
  assert.deepEqual(remoteSupportResult.reactions[0].semanticReferenceIds, ['connector-support-face']);
  assert.deepEqual(remoteSupportResult.reactions[0].connectorId, 'support-connector');
  assert.ok(remoteSupportResult.reactions[0].momentNmm?.every(value => Math.abs(value) <= .1), 'Centered axial loading should recover an approximately zero remote-support moment.');
  const cancelledSubmission = await solver.submit(request, model);
  const cancelled = await solver.cancel(cancelledSubmission.providerRunId);
  assert.equal(cancelled.status, 'cancelled');
  assert.match(cancelled.phase, /^cancelled_/);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal((await solver.getStatus(cancelledSubmission.providerRunId)).status, 'cancelled', 'Late process exit must not resurrect a cancelled v2 solver run.');
  assert.equal(await solver.getResult(cancelledSubmission.providerRunId), null);
  await assert.rejects(() => solver.getFieldDataset(cancelledSubmission.providerRunId, `${cancelledSubmission.providerRunId}:domain-steel:stress`), /Unknown or expired field dataset/);

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
    maximumDisplacementMm: result.metrics.maximumDisplacementMm, maximumVonMisesStressMPa: result.metrics.maximumVonMisesStressMPa,
    perDomain: result.perDomain.map(domain => ({ domainId: domain.domainId, metrics: domain.metrics })),
    totalReactionN: totalReaction, inferredInteractions: 0,
    sharedTopology: { nodeCount: sharedModel.nodes.length, sharedNodeCount: sharedNodes.size,
      maximumDisplacementMm: sharedResult.metrics.maximumDisplacementMm, totalReactionXN: sharedReactionX,
      relativeDisplacementDifferenceFromTie: Math.abs(sharedResult.metrics.maximumDisplacementMm! - tiedResult.metrics.maximumDisplacementMm!) / tiedResult.metrics.maximumDisplacementMm! },
    rigidConnectors: {
      remoteLoad: { forceN: [100, 0, 0], momentNmm: [0, 0, 250], supportReactionN: remoteLoadResult.reactions[0].forceN },
      remoteSupport: { prescribedTranslationMm: [0, 0, 0], prescribedRotationRad: [0, 0, 0], reactionN: remoteSupportResult.reactions[0].forceN, reactionMomentNmm: remoteSupportResult.reactions[0].momentNmm },
    },
  }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}

function createBondedRequest(): NeutralSimulationRequestV2 {
  const request = structuredClone(createRequest());
  request.studyId = 'sim4b-bonded-coupon'; request.name = 'Explicit two-material bonded coupon';
  request.model.domains[1].transformToAnalysis = [1, 0, 0, 40, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const secondary = { ...structuredClone(request.model.references.find(reference => reference.semanticReferenceId === 'load-steel')!), semanticReferenceId: 'tie-secondary', role: 'interaction' as const };
  const primary = { ...structuredClone(request.model.references.find(reference => reference.semanticReferenceId === 'support-aluminum')!), semanticReferenceId: 'tie-primary', role: 'interaction' as const };
  request.model.references = [
    request.model.references.find(reference => reference.semanticReferenceId === 'support-steel')!,
    request.model.references.find(reference => reference.semanticReferenceId === 'load-aluminum')!, secondary, primary,
  ];
  request.loads = [request.loads.find(load => load.id === 'pull-aluminum')!];
  request.constraints = [request.constraints.find(constraint => constraint.id === 'fix-steel')!];
  request.interactions = [{ id: 'bonded-interface', name: 'Explicit bonded interface', type: 'bonded_tie', secondaryReferenceIds: ['tie-secondary'], primaryReferenceIds: ['tie-primary'], adjustment: 'none', positionToleranceMm: .05 }];
  reseal(request); return request;
}

function createSharedTopologyRequest(): NeutralSimulationRequestV2 {
  const request = createBondedRequest();
  request.studyId = 'sim4b-shared-topology-coupon'; request.name = 'Explicit conformal two-material coupon';
  request.mesh.globalSizeMm = 20; request.mesh.minimumSizeMm = 5;
  request.interactions = [{ ...request.interactions[0], id: 'shared-interface', name: 'Explicit shared topology', type: 'shared_topology' }];
  reseal(request); return request;
}

function createRemoteLoadRequest(): NeutralSimulationRequestV2 {
  const request = createBondedRequest();
  request.studyId = 'sim4b-rigid-remote-load'; request.name = 'Rigid remote load point';
  const connectorReference = { ...structuredClone(request.model.references.find(reference => reference.semanticReferenceId === 'load-aluminum')!), semanticReferenceId: 'connector-load-face', role: 'interaction' as const };
  request.model.references = request.model.references.filter(reference => reference.semanticReferenceId !== 'load-aluminum');
  request.model.references.push(connectorReference);
  request.loads = [{ id: 'remote-load', name: 'Remote force and moment', type: 'remote_force', connectorId: 'load-connector', forceN: [100, 0, 0], momentNmm: [0, 0, 250], coordinateSystem: 'analysis' }];
  request.interactions.push({ id: 'load-connector', name: 'Rigid end plate', type: 'rigid_connector', semanticReferenceIds: ['connector-load-face'], referencePointAnalysisMm: [80, 5, 5], coupling: 'rigid_6dof' });
  reseal(request); return request;
}

function createRemoteSupportRequest(): NeutralSimulationRequestV2 {
  const request = createBondedRequest();
  request.studyId = 'sim4b-rigid-remote-support'; request.name = 'Rigid remote support point';
  const connectorReference = { ...structuredClone(request.model.references.find(reference => reference.semanticReferenceId === 'support-steel')!), semanticReferenceId: 'connector-support-face', role: 'interaction' as const };
  request.model.references = request.model.references.filter(reference => reference.semanticReferenceId !== 'support-steel');
  request.model.references.push(connectorReference);
  request.constraints = [{ id: 'remote-support', name: 'Fixed remote support', type: 'remote_displacement', connectorId: 'support-connector', translationMm: [0, 0, 0], rotationRad: [0, 0, 0], coordinateSystem: 'analysis' }];
  request.interactions.push({ id: 'support-connector', name: 'Rigid support plate', type: 'rigid_connector', semanticReferenceIds: ['connector-support-face'], referencePointAnalysisMm: [0, 5, 5], coupling: 'rigid_6dof' });
  reseal(request); return request;
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

async function waitForResult(solver: CalculiXMultiDomainSolverProvider, providerRunId: string) {
  const deadline = Date.now() + solver.capabilities.execution.totalTimeoutMs;
  while (Date.now() < deadline) {
    const status = await solver.getStatus(providerRunId);
    if (status.status === 'failed') throw new Error(`${status.failure?.code}: ${status.failure?.message}`);
    if (status.status === 'succeeded') {
      const result = await solver.getResult(providerRunId);
      if (!result) throw new Error('CalculiX v2 completed without a result.');
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  await solver.cancel(providerRunId);
  throw new Error('CalculiX v2 provider timed out.');
}
