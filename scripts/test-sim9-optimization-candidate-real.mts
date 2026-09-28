import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GmshMultiDomainMeshProvider } from '../providers/gmsh/GmshMultiDomainMeshProvider.mts';
import { normalizeMesh, parseMsh41 } from '../providers/gmsh/GmshMeshProvider.mts';
import { CalculiXMultiDomainSolverProvider } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { composeNeutralFemModelV2, createNeutralMeshJobRequestV2 } from '../src/simulation/multiDomainFemModel.ts';
import { sealNeutralSimulationRequestV2, validateNeutralFemModelV2 } from '../simulation-bridge/v2Validation.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { readVerifiedOptimizationStressField } from '../simulation-bridge/optimizationVerifiedStressField.mts';
import { OptimizationRefinementArchive, FileOptimizationArchiveCatalog,
  type TrustedRefinementCaptureSource } from '../simulation-bridge/optimizationRefinementArchive.mts';
import { sealOptimizationFoundation, type OptimizationFoundationDraft } from '../simulation-bridge/optimizationFoundation.mts';
import { compareOptimizationCandidate, sealOptimizationCandidate, type OptimizationCandidateDraft, type TrustedOptimizationCandidateReader } from '../simulation-bridge/optimizationCandidate.mts';
import type { NeutralSimulationFieldTriangleV2, NeutralSimulationRequestV2, NeutralSimulationResultV2, NeutralVector3 } from '../src/simulation/externalSimulationContracts.ts';

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (!gmsh || !calculix) throw new Error('Set explicit TUNACAD_GMSH_EXECUTABLE and TUNACAD_CALCULIX_EXECUTABLE.');
const convergenceOnly = process.argv.includes('--convergence-only');
const stabilityOnly = process.argv.includes('--stability-only');
const captureOne = process.argv.includes('--capture-one');
const completeArchive = process.argv.includes('--complete-archive');
const replayCompleteArchive = process.argv.includes('--replay-complete-archive');
const domainId = 'bar', partId = 'bar-part', bodyId = 'bar-body';
const featureId = 'thickness-extrude', parameterId = 'thickness';
const materialProvenance = { kind: 'custom' as const, reference: 'SIM-9 optimization real-candidate elastic steel', revision: 'r1' };
const cadReference = 'SIM-9 optimization parameterized box CAD fixture';
const design = (thicknessMm: number) => ({ lengthMm: 40, widthMm: 10, thicknessMm });
const baselineCad = design(10), candidateCad = design(9);
assert.deepEqual(Object.keys(candidateCad).filter(key => candidateCad[key as keyof typeof candidateCad] !== baselineCad[key as keyof typeof baselineCad]), ['thicknessMm']);
const baselineRevision = 'opt-cad-' + digest(baselineCad).slice(7, 19);
const candidateRevision = 'opt-cad-' + digest(candidateCad).slice(7, 19);

function requestFor(cad: ReturnType<typeof design>, revision: string, label: string,
  meshSizeMm = 8): NeutralSimulationRequestV2 {
  const { lengthMm: length, widthMm: width, thicknessMm: thickness } = cad;
  const face = (semanticReferenceId: string, role: 'load' | 'constraint', x: number, outward: NeutralVector3) => ({
    semanticReferenceId, domainId, ownerPartId: partId, ownerBodyId: bodyId, occurrenceId: 'bar:1',
    geometryKind: 'FACE' as const, role, sourceFeatureId: featureId,
    resolutionState: 'valid' as const, resolvedAtProjectRevision: revision,
    faceOwnerLocal: { centroidPartLocalMm: [x, width / 2, thickness / 2] as NeutralVector3,
      areaMm2: width * thickness, outwardDirection: outward, geometryType: 'plane',
      edgeCount: 4, boundingBoxMm: { min: [x, 0, 0] as NeutralVector3,
        max: [x, width, thickness] as NeutralVector3 } },
  });
  return sealNeutralSimulationRequestV2({
    schema: 'tunacad-neutral-simulation-request/2.0', studyId: 'sim9-opt-' + label,
    name: 'SIM-9 one-candidate structural study ' + label,
    preparedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    analysis: { type: 'linear_static', assumptions: ['small_displacement', 'small_strain', 'static_loading'] },
    model: { projectRevision: revision, coordinateSpace: 'frozen_analysis',
      domains: [{ domainId, partId, bodyId, occurrenceId: 'bar:1',
        geometryDigest: digest({ cad, generator: 'Gmsh OpenCASCADE Box(1)' }),
        transformToAnalysis: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        shape: { valid: true, connectedSolidCount: 1, faceCount: 6, edgeCount: 12,
          volumeMm3: length * width * thickness,
          surfaceAreaMm2: 2 * (length * width + length * thickness + width * thickness),
          boundingBoxOwnerLocalMm: { min: [0, 0, 0], max: [length, width, thickness],
            size: [length, width, thickness] } } }],
      references: [face('fixed-face', 'constraint', 0, [-1, 0, 0]),
        face('load-face', 'load', length, [1, 0, 0])] },
    units: { geometry: 'mm', force: 'N', stress: 'MPa', displacement: 'mm',
      density: 'kg/m^3', acceleration: 'mm/s^2' },
    materials: [{ id: 'steel', name: 'Elastic steel', model: 'isotropic_linear_elastic',
      densityKgM3: 7850, youngsModulusMPa: 210000, poissonRatio: .3,
      source: materialProvenance }],
    materialAssignments: [{ assignmentId: 'bar-steel', domainId, materialId: 'steel', volumeRegionId: 'bar-volume' }],
    loads: [{ id: 'axial-force', name: 'Axial force', type: 'surface_force',
      semanticReferenceIds: ['load-face'], forceN: [100, 0, 0], coordinateSystem: 'analysis' }],
    constraints: [{ id: 'fixed-end', name: 'Fixed end', type: 'fixed', semanticReferenceIds: ['fixed-face'] }],
    interactions: [],
    mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2,
      globalSizeMm: meshSizeMm, minimumSizeMm: meshSizeMm / 4,
      maximumNodes: 15000, maximumElements: 7500,
      qualityMetric: 'provider_normalized', minimumQuality: .04 },
    requestedResults: ['von_mises_stress', 'displacement', 'reaction_force', 'factor_of_safety', 'critical_regions'],
  });
}
type Solved = { request: NeutralSimulationRequestV2; result: NeutralSimulationResultV2;
  model: any;
  parameter: any; field: any; mesh: { nodes: number; elements: number; volumeMm3: number };
  peakPositionAnalysisMm: NeutralVector3;
  probe: { positionAnalysisMm: NeutralVector3; stressMPa: number; distanceFromTargetMm: number } };
const directory = await mkdtemp(join(tmpdir(), 'tunacad-sim9-opt-candidate-'));
try {
  const mesher = new GmshMultiDomainMeshProvider({ executable: gmsh, runtimeVersion: '4.15.2' });
  const solver = new CalculiXMultiDomainSolverProvider({ executable: calculix, runtimeVersion: '2.16' });
  async function geometryFor(cad: ReturnType<typeof design>, label: string) {
    const geoPath = join(directory, label + '.geo'), stepPath = join(directory, label + '.step');
    await writeFile(geoPath, `SetFactory("OpenCASCADE");\nBox(1) = {0, 0, 0, ${cad.lengthMm}, ${cad.widthMm}, ${cad.thicknessMm}};\nSave "${stepPath.replace(/\\/g, '/')}";\n`, 'utf8');
    execFileSync(gmsh!, [geoPath, '-0', '-v', '2'], { cwd: directory, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 });
    return new Uint8Array(await readFile(stepPath));
  }
  async function terminal(provider: CalculiXMultiDomainSolverProvider, jobId: string) {
    for (let i = 0; i < 600; i++) {
      const status = await provider.getStatus(jobId);
      if (status.status !== 'running' && status.status !== 'queued') return status;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('SIM-9 candidate solver timed out');
  }
  async function solve(cad: ReturnType<typeof design>, revision: string, label: string,
    meshSizeMm = 8): Promise<Solved> {
    const request = requestFor(cad, revision, label, meshSizeMm);
    const geometry = await geometryFor(cad, label);
    const model = await mesher.mesh(request, { descriptor: request.model, async exportDomain() { return geometry; } });
    assert(Math.abs(model.quality.cadVolumeMm3 - cad.lengthMm * cad.widthMm * cad.thicknessMm) < .01);
    assert(model.quality.volumeRelativeError < .03);
    const submission = await solver.submit(request, model);
    const status = await terminal(solver, submission.providerRunId);
    assert.equal(status.status, 'succeeded', JSON.stringify(status));
    const result = (await solver.getResult(submission.providerRunId))!;
    assert.equal(result.convergence.status, 'converged');
    assert.equal(result.requestDigest, request.requestDigest);
    const axialReactionN = result.reactions.reduce((sum, entry) => sum + entry.forceN[0], 0);
    assert(Math.abs(axialReactionN + 100) < .01);
    const nominalAxialStressMPa = 100 / (cad.widthMm * cad.thicknessMm);
    assert(result.perDomain[0].metrics.maximumVonMisesStressMPa >= nominalAxialStressMPa * .95);
    assert(result.perDomain[0].metrics.maximumVonMisesStressMPa <= nominalAxialStressMPa * 1.5);
    const datasetId = result.perDomain[0].fieldDatasetIds.find(id => id.endsWith(':stress'))!;
    const field = await readVerifiedOptimizationStressField(result.jobId, datasetId,
      (cursor, limit) => solver.getFieldDataset(result.jobId, datasetId, cursor, limit), 32);
    assert(field.maximumSurfaceStressMPa <= result.perDomain[0].metrics.maximumVonMisesStressMPa + 1e-6);
    const peak = result.criticalRegions.find(entry => entry.domainId === domainId && entry.kind === 'stress');
    assert(peak && Math.abs(peak.value - result.perDomain[0].metrics.maximumVonMisesStressMPa) < 1e-9);
    const triangles: NeutralSimulationFieldTriangleV2[] = [];
    let cursor = '0';
    for (;;) {
      const page = await solver.getFieldDataset(result.jobId, datasetId, cursor, 128);
      triangles.push(...page.triangles);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    assert.equal(digest(triangles), field.descriptor.datasetDigest);
    const target: NeutralVector3 = [cad.lengthMm / 2, 0, cad.thicknessMm / 2];
    const probes = triangles.flatMap(triangle => {
      if (!triangle.positionsAnalysisMm.every(point => Math.abs(point[1]) < 1e-8)) return [];
      const position = [0, 1, 2].map(axis => triangle.positionsAnalysisMm
        .reduce((sum, point) => sum + point[axis], 0) / 3) as NeutralVector3;
      const distance = Math.hypot(...position.map((value, axis) => value - target[axis]));
      return [{ positionAnalysisMm: position, stressMPa: triangle.values[0], distanceFromTargetMm: distance }];
    });
    probes.sort((a, b) => a.distanceFromTargetMm - b.distanceFromTargetMm);
    assert(probes.length && probes[0].distanceFromTargetMm < 5);
    const parameter = { schema: 'tunacad-cad-parameter-snapshot/0.1',
      projectRevision: revision, modelDigest: request.model.modelDigest,
      domainId, partId, bodyId, featureId, parameterId, kind: 'length',
      valueMm: cad.thicknessMm, unit: 'mm',
      provenance: { kind: 'cad_project', reference: cadReference, revision } };
    return { request, result, parameter, field, model,
      mesh: { nodes: model.quality.nodeCount, elements: model.quality.elementCount,
        volumeMm3: model.quality.meshVolumeMm3 },
      peakPositionAnalysisMm: peak.positionAnalysisMm, probe: probes[0] };
  }
  async function localDiagnostic(cad: ReturnType<typeof design>, revision: string,
    label: string, localSizeMm: number, capture = false): Promise<any> {
    const request = requestFor(cad, revision, label, 4);
    const step = await geometryFor(cad, label);
    const stepPath = join(directory, label + '.local.step');
    const geoPath = join(directory, label + '.local.geo');
    const mshPath = join(directory, label + '.local.msh');
    await writeFile(stepPath, step);
    const localField = { globalSizeMm: 4, localSizeMm, xMaxMm: 5,
      yMaxMm: cad.widthMm, zMaxMm: cad.thicknessMm };
    await writeFile(geoPath, [
      'SetFactory("OpenCASCADE");', 'Mesh.MshFileVersion = 4.1;',
      'Mesh.Binary = 0;', 'Mesh.ElementOrder = 2;',
      'Mesh.SecondOrderIncomplete = 0;',
      'Mesh.MeshSizeMax = 4;', `Mesh.MeshSizeMin = ${localSizeMm / 4};`,
      `Merge "${stepPath.replace(/\\/g, '/')}";`,
      'Field[1] = Box;', `Field[1].VIn = ${localSizeMm};`,
      'Field[1].VOut = 4;', 'Field[1].XMin = -0.1;',
      'Field[1].XMax = 5;', 'Field[1].YMin = -0.1;',
      `Field[1].YMax = ${cad.widthMm + .1};`,
      'Field[1].ZMin = -0.1;',
      `Field[1].ZMax = ${cad.thicknessMm + .1};`,
      'Field[1].Thickness = 1;', 'Background Field = 1;',
    ].join('\n'), 'utf8');
    execFileSync(gmsh!, [geoPath, '-3', '-format', 'msh4', '-o', mshPath, '-v', '2'],
      { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 });
    assert((await stat(mshPath)).size < 24 * 1024 * 1024);
    const meshRequest = createNeutralMeshJobRequestV2(request);
    const domain = request.model.domains[0];
    const { boundingBoxOwnerLocalMm, ...shapeWithoutBox } = domain.shape;
    const descriptor = {
      projectRevision: revision, partId, bodyId,
      geometryDigest: domain.geometryDigest, coordinateSpace: 'part_definition_local',
      shape: { ...shapeWithoutBox, boundingBoxMm: boundingBoxOwnerLocalMm },
      references: request.model.references.map(reference => ({
        semanticReferenceId: reference.semanticReferenceId,
        ownerPartId: reference.ownerPartId, geometryKind: reference.geometryKind,
        role: reference.role, sourceFeatureId: reference.sourceFeatureId,
        resolutionState: reference.resolutionState,
        resolvedAtProjectRevision: reference.resolvedAtProjectRevision,
        face: reference.faceOwnerLocal,
      })),
    } as any;
    const localRequest = {
      schema: 'tunacad-neutral-mesh-request/1.0', studyId: request.studyId,
      requestDigest: request.requestDigest, projectRevision: revision,
      geometryDigest: domain.geometryDigest, coordinateSpace: 'part_definition_local',
      units: 'mm', mesh: request.mesh,
      boundaryRegions: meshRequest.boundaryRegions.map(region => ({
        regionId: region.regionId, role: region.role,
        semanticReferenceId: region.semanticReferenceId,
        sourceFeatureId: region.sourceFeatureId, face: region.faceOwnerLocal,
      })),
    } as any;
    const parsed = parseMsh41(await readFile(mshPath, 'utf8'),
      request.mesh.maximumNodes, request.mesh.maximumElements);
    const localMesh = normalizeMesh(parsed, localRequest, descriptor,
      'tunacad-gmsh-local-diagnostic', '0.1.0', '4.15.2');
    const model = composeNeutralFemModelV2(meshRequest, [{ domainId, mesh: localMesh }], {
      adapterId: 'tunacad-gmsh-local-diagnostic', adapterVersion: '0.1.0',
      engine: 'Gmsh', engineVersion: '4.15.2',
      optionsDigest: digest({ localField, requestMesh: request.mesh }),
    });
    validateNeutralFemModelV2(model, request);
    assert(model.quality.volumeRelativeError < .03);
    const submitted = await solver.submit(request, model);
    const status = await terminal(solver, submitted.providerRunId);
    assert.equal(status.status, 'succeeded', JSON.stringify(status));
    const result = (await solver.getResult(submitted.providerRunId))!;
    const peak = result.criticalRegions.find(entry => entry.domainId === domainId && entry.kind === 'stress');
    assert(peak && result.convergence.status === 'converged');
    const datasetId = result.perDomain[0].fieldDatasetIds.find(id => id.endsWith(':stress'))!;
    const field = await readVerifiedOptimizationStressField(result.jobId, datasetId,
      (cursor, limit) => solver.getFieldDataset(result.jobId, datasetId, cursor, limit), 32);
    assert(field.maximumSurfaceStressMPa <= peak.value + 1e-6);
    const summary = { localSizeMm, nodes: model.quality.nodeCount,
      elements: model.quality.elementCount, peakStressMPa: peak.value,
      peakPositionAnalysisMm: peak.positionAnalysisMm,
      distanceToFixedPerimeterMm: Math.hypot(peak.positionAnalysisMm[0],
        Math.min(peak.positionAnalysisMm[1], cad.widthMm - peak.positionAnalysisMm[1],
          peak.positionAnalysisMm[2], cad.thicknessMm - peak.positionAnalysisMm[2])),
      cadVolumeMm3: request.model.domains[0].shape.volumeMm3,
      meshVolumeMm3: model.quality.meshVolumeMm3,
      meshOptionsDigest: model.provenance.optionsDigest };
    return capture ? { request, result, model, field, summary,
      parameter: { schema: 'tunacad-cad-parameter-snapshot/0.1',
        projectRevision: revision, modelDigest: request.model.modelDigest,
        domainId, partId, bodyId, featureId, parameterId, kind: 'length',
        valueMm: cad.thicknessMm, unit: 'mm',
        provenance: { kind: 'cad_project', reference: cadReference, revision } },
      meshDefinition: { mode: 'local_diagnostic', globalSizeMm: 4, localSizeMm,
        definition: { localField, requestMesh: request.mesh } } } : summary;
  }
  if (completeArchive || replayCompleteArchive) {
    const { completeOptimizationArchiveMatrix } = await import('./sim9-optimization-archive-matrix.mts');
    await completeOptimizationArchiveMatrix({ solve, localDiagnostic, solver, gmsh: gmsh!,
      calculix: calculix!, baselineCad, candidateCad, baselineRevision, candidateRevision,
      replayOnly: replayCompleteArchive });
  } else if (captureOne) {
    const root = process.env.TUNACAD_OPTIMIZATION_EVIDENCE_DIRECTORY;
    if (!root) throw new Error('Set an explicit local TUNACAD_OPTIMIZATION_EVIDENCE_DIRECTORY (not repository source).');
    const gmshVersion = execFileSync(gmsh!, ['-version'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 }).trim();
    const ccxProbe = spawnSync(calculix!, ['-v'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
    // CalculiX 2.16 Windows returns 201 for its informational -v command.
    assert(!ccxProbe.error && !ccxProbe.signal && [0, 201].includes(ccxProbe.status!));
    const ccxVersion = ccxProbe.stdout;
    assert.equal(gmshVersion, '4.15.2');
    assert.match(ccxVersion, /Version 2\.16(?:\s|$)/);
    assert.equal(Number(process.versions.node.split('.')[0]), 24);
    const solved = await solve(baselineCad, baselineRevision, 'baseline-capture-mesh4', 4);
    let revision = baselineRevision, runtime = { gmsh: '4.15.2', calculix: '2.16', nodeMajor: 24 };
    const authority: TrustedRefinementCaptureSource = {
      async readCurrentProjectRevision() { return revision; },
      async readCurrentRuntimeTuple() { return structuredClone(runtime); },
      async readCompletedStudyId(id) { assert.equal(id, solved.result.jobId); return solved.request.studyId; },
      async readStudyRequest(id) { return id === solved.request.studyId ? structuredClone(solved.request) : null; },
      async readCompletedResult(id) { return solver.getResult(id); },
      async readCadParameter() { return structuredClone(solved.parameter); },
      async readCadChangeSet() { return null; },
      async readStressFieldDescriptor() { return structuredClone(solved.field.descriptor); },
      async readStressFieldPage(id, dataset, cursor, limit) { return solver.getFieldDataset(id, dataset, cursor, limit); },
      async readValidatedFemModel(id) { assert.equal(id, solved.result.jobId); return structuredClone(solved.model); },
      async readMeshDefinition() { return { mode: 'global', globalSizeMm: 4,
        localSizeMm: null, definition: { mode: 'independent-domain-composition',
          domainIds: [domainId], mesh: structuredClone(solved.request.mesh),
          sharedTopologyInteractionIds: [] } }; },
    };
    const catalog = new FileOptimizationArchiveCatalog(join(root, 'completion-ledger'));
    const archive = new OptimizationRefinementArchive(join(root, 'blobs'), authority, catalog);
    const pin = await archive.captureCompletedRefinement(solved.result.jobId);
    const original = await archive.readRefinement(solved.result.jobId);
    assert.equal(original.record.rawMaximumStressMPa, solved.result.perDomain[0].metrics.maximumVonMisesStressMPa);
    assert.equal(original.record.mesh.nodeCount, solved.model.nodes.length);
    assert.equal(original.record.mesh.elementCount, solved.model.volumeElements.connectivity.length);
    const reopened = new OptimizationRefinementArchive(join(root, 'blobs'), authority,
      new FileOptimizationArchiveCatalog(join(root, 'completion-ledger')));
    assert.deepEqual(await reopened.readRefinement(solved.result.jobId), original);
    assert.deepEqual(await archive.captureCompletedRefinement(solved.result.jobId), pin);
    const readers = reopened.readers();
    assert.deepEqual(await readers.readCompletedResult(solved.result.jobId), solved.result);
    const verified = await readVerifiedOptimizationStressField(solved.result.jobId,
      solved.field.descriptor.datasetId, (cursor, limit) =>
        readers.readStressFieldPage(solved.result.jobId, solved.field.descriptor.datasetId, cursor, limit));
    assert.deepEqual(verified, solved.field);
    const path = join(root, 'blobs', pin.blobDigest.slice(7) + '.json');
    let rejected = 0;
    for (const mutate of [
      (row: any) => { row.model.quality.nodeCount++; },
      (row: any) => { row.record.rawMaximumStressMPa += .01; },
      (row: any) => { row.record.peakPositionAnalysisMm[0] += .01; },
      (row: any) => { row.peak.elementIndex++; },
      (row: any) => { row.runtime.calculix = '2.17'; },
      (row: any) => { row.record.source.projectRevision = candidateRevision; },
      (row: any) => { row.result.jobId = 'substituted-result'; },
      (row: any) => { row.pages[0].triangles[0].values[0] += .01; },
      (row: any) => { row.record.source.materialProvenance.revision = 'changed'; },
      (row: any) => { row.recordDigest = digest('different-record'); },
    ]) {
      const altered = structuredClone(original); mutate(altered);
      await writeFile(path, JSON.stringify(altered));
      await assert.rejects(readers.readRefinementRecord(solved.result.jobId), /ARCHIVE_INVALID/); rejected++;
      await writeFile(path, JSON.stringify(original));
    }
    revision = candidateRevision;
    await assert.rejects(readers.readMeshSummary(solved.result.jobId), /ARCHIVE_INVALID/); rejected++;
    revision = baselineRevision;
    runtime = { ...runtime, gmsh: '4.16.0' };
    await assert.rejects(readers.readCompletedResult(solved.result.jobId), /ARCHIVE_INVALID/); rejected++;
    runtime = { gmsh: '4.15.2', calculix: '2.16', nodeMajor: 24 };
    await assert.rejects(readers.readRefinementRecord('missing-job'), /ARCHIVE_INVALID/); rejected++;
    await assert.rejects(catalog.pinOnce('refinement', solved.result.jobId, digest('substituted-root')), /ARCHIVE_INVALID/); rejected++;
    await assert.rejects(archive.admit('unarchived-matrix', {}, {}, archive), /ARCHIVE_INVALID/); rejected++;
    assert.deepEqual(await reopened.readRefinement(solved.result.jobId), original);
    console.log(JSON.stringify({ status: 'PASS', capture: 'one actual 10 mm baseline / 4 mm global mesh',
      revision: baselineRevision, jobId: solved.result.jobId, ...pin,
      nodes: solved.model.nodes.length, elements: solved.model.volumeElements.connectivity.length,
      rawMaximumStressMPa: original.record.rawMaximumStressMPa, peak: original.peak,
      stressFieldDigest: original.record.source.stressFieldDatasetDigest,
      runtime: original.runtime, reloadedExact: true, rejected,
      requiredMatrixRecords: 10, capturedRealRecords: 1,
      completeMatrixAdmission: 'PENDING', currentCandidateRobustGate: 'FAIL' }));
  } else {
  const selectedMeshMm = convergenceOnly || stabilityOnly ? 2 : 8;
  const base = await solve(baselineCad, baselineRevision, 'baseline', selectedMeshMm);
  const candidate = await solve(candidateCad, candidateRevision, 'candidate', selectedMeshMm);
  function sourceOf(solved: Solved) {
    const { request, result, field } = solved;
    return { studyId: request.studyId, structuralJobId: result.jobId,
      requestDigest: request.requestDigest, resultDigest: digest(result),
      projectRevision: request.model.projectRevision, modelDigest: request.model.modelDigest,
      domainId, partId, bodyId, materialId: 'steel', materialProvenance,
      semanticReferenceId: 'load-face', stressFieldDatasetId: field.descriptor.datasetId,
      stressFieldDatasetDigest: field.descriptor.datasetDigest,
      stressFieldDescriptorDigest: digest(field.descriptor) };
  }
  const change = { schema: 'tunacad-cad-single-parameter-change/0.1' as const,
    baselineProjectRevision: baselineRevision, candidateProjectRevision: candidateRevision,
    baselineModelDigest: base.request.model.modelDigest,
    candidateModelDigest: candidate.request.model.modelDigest,
    changedParameter: { domainId, partId, bodyId, featureId, parameterId,
      fromMm: baselineCad.thicknessMm, toMm: candidateCad.thicknessMm, unit: 'mm' as const },
    otherChanges: false as const };
  const baselineInput = sealOptimizationFoundation({
    schema: 'tunacad-optimization-foundation/0.1', source: sourceOf(base),
    variable: { kind: 'cad_length', featureId, parameterId,
      baselineMm: baselineCad.thicknessMm, minimumMm: 8, maximumMm: 12, unit: 'mm',
      snapshotDigest: digest(base.parameter), provenance: base.parameter.provenance },
    objective: { kind: 'minimize_domain_volume', domainId,
      baselineVolumeMm3: base.request.model.domains[0].shape.volumeMm3, unit: 'mm^3' },
    constraint: { kind: 'domain_von_mises_upper_bound', domainId,
      semanticReferenceId: 'load-face', stressFieldDatasetId: base.field.descriptor.datasetId,
      baselineStressMPa: base.result.perDomain[0].metrics.maximumVonMisesStressMPa,
      upperBoundMPa: 2, unit: 'MPa' },
  } satisfies OptimizationFoundationDraft);
  const candidateInput = sealOptimizationCandidate({
    schema: 'tunacad-optimization-candidate/0.1',
    baselineInputDigest: baselineInput.inputDigest, cadChangeSetDigest: digest(change),
    source: sourceOf(candidate),
    variable: { featureId, parameterId, valueMm: candidateCad.thicknessMm, unit: 'mm',
      snapshotDigest: digest(candidate.parameter), provenance: candidate.parameter.provenance },
    objective: { kind: 'minimize_domain_volume', domainId,
      volumeMm3: candidate.request.model.domains[0].shape.volumeMm3, unit: 'mm^3' },
    constraint: { kind: 'domain_von_mises_upper_bound', domainId,
      semanticReferenceId: 'load-face', stressFieldDatasetId: candidate.field.descriptor.datasetId,
      observedStressMPa: candidate.result.perDomain[0].metrics.maximumVonMisesStressMPa,
      unit: 'MPa' },
  } satisfies OptimizationCandidateDraft);
  function reader(solved: Solved, overrides: {
    revision?: string; result?: unknown; request?: unknown; parameter?: unknown;
    change?: unknown; page?: (value: unknown) => unknown;
  } = {}): TrustedOptimizationCandidateReader {
    const { request, result, parameter } = solved;
    return {
      async readCurrentProjectRevision() { return overrides.revision ?? request.model.projectRevision; },
      async readStudyRequest(id) { return id === request.studyId ? structuredClone(overrides.request ?? request) : null; },
      async readCompletedResult(id) { return id === result.jobId
        ? structuredClone('result' in overrides ? overrides.result : await solver.getResult(id)) : null; },
      async readCadParameter(revision, feature, selected) {
        return revision === request.model.projectRevision && feature === featureId && selected === parameterId
          ? structuredClone(overrides.parameter ?? parameter) : null;
      },
      async readStressFieldDescriptor(id, datasetId) {
        if (id !== result.jobId || datasetId !== solved.field.descriptor.datasetId) return null;
        const verified = await readVerifiedOptimizationStressField(id, datasetId,
          async (cursor, limit) => {
            const page = await solver.getFieldDataset(id, datasetId, cursor, limit);
            return overrides.page ? overrides.page(page) : page;
          }, 32);
        if (verified.maximumSurfaceStressMPa > result.perDomain[0].metrics.maximumVonMisesStressMPa + 1e-6)
          throw new Error('SIM9_OPTIMIZATION_STRESS_FIELD_INVALID: surface stress exceeds reported domain maximum');
        return verified.descriptor;
      },
      async readCadChangeSet() { return structuredClone(overrides.change ?? change); },
    };
  }
  const compare = (candidateReader = reader(candidate), baseReader = reader(base)) =>
    compareOptimizationCandidate(baselineInput, candidateInput, baseReader, candidateReader);
  const comparison = await compare();
  assert.equal(comparison.candidateFeasible, true);
  assert.equal(comparison.objectiveOutcome, 'improved');
  assert.equal(comparison.objectiveDeltaMm3, 400);
  assert.equal(comparison.objectiveChangePercent, 10);
  assert.deepEqual(await compare(), comparison);
  if (convergenceOnly) {
    const coarseBase = await solve(baselineCad, baselineRevision, 'baseline-mesh4', 4);
    const coarseCandidate = await solve(candidateCad, candidateRevision, 'candidate-mesh4', 4);
    const mediumBase = await solve(baselineCad, baselineRevision, 'baseline-mesh3', 3);
    const mediumCandidate = await solve(candidateCad, candidateRevision, 'candidate-mesh3', 3);
    const levels = [
      { sizeMm: 4, baseline: coarseBase, candidate: coarseCandidate },
      { sizeMm: 3, baseline: mediumBase, candidate: mediumCandidate },
      { sizeMm: 2, baseline: base, candidate },
    ];
    const summarize = (kind: 'baseline' | 'candidate') => {
      const rows = levels.map(level => {
        const solved = level[kind];
        const stressMPa = solved.result.perDomain[0].metrics.maximumVonMisesStressMPa;
        return { globalSizeMm: level.sizeMm, nodes: solved.mesh.nodes,
          elements: solved.mesh.elements,
          cadVolumeMm3: solved.request.model.domains[0].shape.volumeMm3,
          meshVolumeMm3: solved.mesh.volumeMm3, stressMPa,
          peakPositionAnalysisMm: solved.peakPositionAnalysisMm,
          midspanSideProbe: solved.probe,
          feasibleAt2MPa: stressMPa <= 2,
          requestDigest: solved.request.requestDigest,
          resultDigest: digest(solved.result) };
      });
      assert(rows.every((row, index) => index === 0 || row.nodes > rows[index - 1].nodes
        && row.elements > rows[index - 1].elements),
      JSON.stringify(rows.map(row => ({ size: row.globalSizeMm, nodes: row.nodes,
        elements: row.elements, stressMPa: row.stressMPa }))));
      assert(rows.every(row => row.cadVolumeMm3 === rows[0].cadVolumeMm3
        && Math.abs(row.meshVolumeMm3 - row.cadVolumeMm3) < .01));
      const adjacentChangesMPa = [Math.abs(rows[0].stressMPa - rows[1].stressMPa),
        Math.abs(rows[1].stressMPa - rows[2].stressMPa)];
      const uncertaintyMPa = Math.max(
        ...rows.map(row => Math.abs(row.stressMPa - rows[2].stressMPa)),
        ...adjacentChangesMPa);
      const stressMarginMPa = 2 - rows[2].stressMPa;
      const fineStepRelativeChange = adjacentChangesMPa[1] / rows[2].stressMPa;
      const stable = fineStepRelativeChange <= .05
        && adjacentChangesMPa[1] <= adjacentChangesMPa[0];
      const robustFeasibility = stable && rows.every(row => row.feasibleAt2MPa)
        && stressMarginMPa > 2 * uncertaintyMPa;
      return {
        rows: rows.map((row, index) => ({ ...row,
          stressChangeToNextFinerMPa: index < 2 ? adjacentChangesMPa[index] : null })),
        uncertaintyMethod: 'maximum observed pairwise mesh-stress spread; no formal convergence order',
        stabilityRule: 'fine adjacent relative change <= 5% and no increase in adjacent change; robust feasibility additionally requires all mesh levels feasible and stress margin > 2 times observed spread',
        uncertaintyMPa, fineStepRelativeChange, stressMarginMPa,
        stable, robustFeasibility,
        gate: robustFeasibility ? 'PASS' : 'FAIL',
      };
    };
    const baselineConvergence = summarize('baseline');
    const candidateConvergence = summarize('candidate');
    const rebound = await compare();
    assert.deepEqual(rebound, comparison);
    assert.equal(baselineConvergence.rows[2].stressMPa, rebound.baseline.maximumVonMisesStressMPa);
    assert.equal(candidateConvergence.rows[2].stressMPa, rebound.candidate.maximumVonMisesStressMPa);
    assert.equal(candidateConvergence.rows[2].cadVolumeMm3, rebound.candidate.volumeMm3);
    const report = {
      schema: 'tunacad-sim9-optimization-mesh-evidence/0.1',
      baselineRevision, candidateRevision, selectedGlobalSizeMm: 2,
      objective: { improvementMm3: rebound.objectiveDeltaMm3,
        improvementPercent: rebound.objectiveChangePercent },
      stressLimitMPa: 2, baseline: baselineConvergence,
      candidate: candidateConvergence,
      robustCandidateFeasibility: candidateConvergence.robustFeasibility,
      providerAdmission: 'closed', engineeringUsePermitted: false,
    };
    assert.equal(digest(report), digest(structuredClone(report)));
    console.log(JSON.stringify(report));
  } else if (stabilityOnly) {
    const baselineLocal = [
      await localDiagnostic(baselineCad, baselineRevision, 'baseline-local1p5', 1.5),
      await localDiagnostic(baselineCad, baselineRevision, 'baseline-local1', 1),
    ];
    const candidateLocal = [
      await localDiagnostic(candidateCad, candidateRevision, 'candidate-local1p5', 1.5),
      await localDiagnostic(candidateCad, candidateRevision, 'candidate-local1', 1),
    ];
    const rebound = await compare();
    assert.deepEqual(rebound, comparison);
    const candidateLastPeakIncreaseMPa = candidateLocal[1].peakStressMPa
      - candidateLocal[0].peakStressMPa;
    const candidateFinestMarginMPa = 2 - candidateLocal[1].peakStressMPa;
    assert(candidateLastPeakIncreaseMPa > candidateFinestMarginMPa);
    assert(candidateLocal[1].distanceToFixedPerimeterMm
      < candidateLocal[0].distanceToFixedPerimeterMm);
    console.log(JSON.stringify({
      schema: 'tunacad-sim9-optimization-local-stability-diagnostic/0.1',
      baselineRevision, candidateRevision, comparisonGlobalSizeMm: 2,
      standard: {
        baseline: { nodes: base.mesh.nodes, elements: base.mesh.elements,
          peakStressMPa: rebound.baseline.maximumVonMisesStressMPa,
          peakPositionAnalysisMm: base.peakPositionAnalysisMm, midspanSideProbe: base.probe },
        candidate: { nodes: candidate.mesh.nodes, elements: candidate.mesh.elements,
          peakStressMPa: rebound.candidate.maximumVonMisesStressMPa,
          peakPositionAnalysisMm: candidate.peakPositionAnalysisMm,
          midspanSideProbe: candidate.probe },
      },
      localField: { globalSizeMm: 4, supportZoneXMaxMm: 5,
        levelsMm: [1.5, 1] },
      baselineLocal, candidateLocal,
      candidateLastPeakIncreaseMPa, candidateFinestMarginMPa,
      stableComparisonMetricEstablished: false,
      localMeshIsDiagnosticOnly: true, robustFeasibilityGate: 'FAIL',
      providerAdmission: 'closed', engineeringUsePermitted: false,
    }));
  } else {
  let rejected = 0;
  async function reject(overrides: Parameters<typeof reader>[1]) {
    await assert.rejects(compare(reader(candidate, overrides)), /SIM9_OPTIMIZATION_(FOUNDATION|CANDIDATE|STRESS_FIELD)_INVALID/);
    rejected++;
  }
  // No completed candidate exists before submit or after a cancelled/failed run.
  await reject({ result: { ...candidate.result, status: 'cancelled' } });
  await reject({ result: { ...candidate.result, status: 'failed' } });
  await reject({ result: { ...candidate.result, convergence: { ...candidate.result.convergence, status: 'not_converged' } } });
  await reject({ revision: baselineRevision });
  await reject({ request: { ...candidate.request, model: { ...candidate.request.model, projectRevision: 'changed-after-solve' } } });
  await reject({ result: { ...candidate.result, requestDigest: base.request.requestDigest } });
  await reject({ parameter: { ...candidate.parameter, valueMm: 9.1 } });
  await reject({ change: { ...change, changedParameter: { ...change.changedParameter, toMm: 9.1 } } });
  await reject({ page: value => {
    const page = structuredClone(value) as any;
    if (page.triangleOffset > 0) return null;
    return page;
  } });
  await reject({ page: value => {
    const page = structuredClone(value) as any;
    page.triangles[0].values[0] += 1;
    return page;
  } });
  // Active cancellation of the same immutable candidate geometry is a
  // separate unsuccessful attempt; it must never replace the completed job.
  const cancelGeometry = await geometryFor(candidateCad, 'cancel-candidate');
  const cancelRequest = requestFor(candidateCad, candidateRevision, 'candidate-cancel');
  const cancelModel = await mesher.mesh(cancelRequest, { descriptor: cancelRequest.model,
    async exportDomain() { return cancelGeometry; } });
  const cancelRun = await solver.submit(cancelRequest, cancelModel);
  const cancelled = await solver.cancel(cancelRun.providerRunId);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(await solver.getResult(cancelRun.providerRunId), null);
  await assert.rejects(solver.getFieldDataset(cancelRun.providerRunId,
    `${cancelRun.providerRunId}:${domainId}:stress`), /Unknown or expired/);
  // Provider startup failure follows the same no-result/no-field quarantine.
  const unavailableSolver = new CalculiXMultiDomainSolverProvider({
    executable: join(directory, 'ccx-unavailable.exe'), runtimeVersion: '2.16' });
  const failedRun = await unavailableSolver.submit(cancelRequest, cancelModel);
  const failed = await terminal(unavailableSolver, failedRun.providerRunId);
  assert.equal(failed.status, 'failed');
  assert.equal(await unavailableSolver.getResult(failedRun.providerRunId), null);
  await assert.rejects(unavailableSolver.getFieldDataset(failedRun.providerRunId,
    `${failedRun.providerRunId}:${domainId}:stress`), /Unknown or expired/);
  // A pre-submit cancellation has no provider job/result and also fails binding.
  await reject({ result: null });
  console.log(JSON.stringify({
    baselineRevision, candidateRevision, parameter: { fromMm: 10, toMm: 9 },
    baseline: { volumeMm3: 4000, maximumVonMisesStressMPa: base.result.perDomain[0].metrics.maximumVonMisesStressMPa, mesh: base.mesh },
    candidate: { volumeMm3: 3600, maximumVonMisesStressMPa: candidate.result.perDomain[0].metrics.maximumVonMisesStressMPa, mesh: candidate.mesh },
    comparison: { feasible: comparison.candidateFeasible, stressCapMPa: 2,
      deltaMm3: comparison.objectiveDeltaMm3, changePercent: comparison.objectiveChangePercent },
    activeCancellation: cancelled.phase, providerStartupFailure: failed.phase,
    rejected, repeatedComparisonDigest: digest(comparison),
  }));
  }
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
