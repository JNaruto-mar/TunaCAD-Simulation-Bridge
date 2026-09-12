import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CalculiXMultiDomainSolverProvider } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { GmshMultiDomainMeshProvider } from '../providers/gmsh/GmshMultiDomainMeshProvider.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { sealNeutralSimulationRequestV2 } from '../simulation-bridge/v2Validation.mts';
import type { NeutralSimulationRequestV2, NeutralVector3 } from '../src/simulation/externalSimulationContracts.ts';

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (!gmsh || !calculix) throw new Error('Set TUNACAD_GMSH_EXECUTABLE and TUNACAD_CALCULIX_EXECUTABLE to run SIM-6A contact-trend acceptance.');

const directory = await mkdtemp(join(tmpdir(), 'tunacad-sim6a-trends-'));
try {
  const foundationStep = await createStep('foundation', [
    'SetFactory("OpenCASCADE");',
    'Box(1) = {-10, 0, 0, 20, 10, 10};',
  ]);
  const sliderStep = await createStep('half-cylinder', [
    'SetFactory("OpenCASCADE");',
    'Cylinder(1) = {0, 0, 0, 0, 0, 10, 10, 2*Pi};',
    'Box(2) = {-10, -10, 0, 20, 10, 10};',
    'BooleanIntersection(3) = { Volume{1}; Delete; }{ Volume{2}; Delete; };',
  ]);
  const geometry = new Map([['foundation', foundationStep], ['slider', sliderStep]]);
  const mesher = new GmshMultiDomainMeshProvider({ executable: gmsh, runtimeVersion: '4.15.2' });
  const solver = new CalculiXMultiDomainSolverProvider({ executable: calculix, runtimeVersion: '2.16' });
  const samples = [];
  for (const meshSizeMm of [2.25, 1.75, 1.4]) samples.push(await solve(meshSizeMm, 1_050_000));
  const stiffPenalty = await solve(1.75, 2_100_000);
  const curvedAdjustment = await solve(2.25, 1_050_000, true);

  assert.ok(samples.every(sample => sample.status === 'active'));
  assert.ok(samples.every(sample => sample.maximumPressureMPa > sample.activeEdgePressureMPa * 1.25), 'The curved patch must retain a center-high, edge-decaying pressure profile.');
  assert.ok(samples.every(sample => sample.maximumPressureXAbsMm < 2.5), 'Peak pressure must stay near the cylinder centerline.');
  assert.ok(samples.every(sample => sample.activeHalfWidthMm > 0 && sample.activeHalfWidthMm < 6), 'The active Hertz-type strip must remain localized around the tangent line.');
  assert.ok(samples.every(sample => sample.contactEquilibriumRelativeError < 0.12), `Curved contact-force integration must remain in equilibrium with the driven-face reaction: ${JSON.stringify(samples.map(sample => ({ meshSizeMm: sample.meshSizeMm, drivenForceN: sample.drivenForceN, contactForceN: sample.contactForceN, error: sample.contactEquilibriumRelativeError })))}`);
  assert.ok(samples[1].nodeCount > samples[0].nodeCount && samples[2].nodeCount > samples[1].nodeCount, 'Mesh refinement must monotonically increase node count.');
  const refinementChanges = [
    Math.abs(samples[1].maximumPressureMPa - samples[0].maximumPressureMPa) / samples[1].maximumPressureMPa,
    Math.abs(samples[2].maximumPressureMPa - samples[1].maximumPressureMPa) / samples[2].maximumPressureMPa,
  ];
  assert.ok(refinementChanges[1] < refinementChanges[0], 'Peak-pressure changes must contract under mesh refinement.');
  assert.ok(samples[2].hertzHalfWidthRelativeError < 0.3, 'The fine active strip width must remain within 30% of the Hertz line-contact reference.');
  assert.ok(stiffPenalty.maximumPenetrationMm < samples[1].maximumPenetrationMm * 0.93, 'A two-times stiffer penalty must materially reduce penetration.');
  assert.ok(stiffPenalty.maximumPenetrationMm < 0.03, 'Qualified penalty penetration must remain below 0.03 mm.');
  assert.equal(curvedAdjustment.status, 'active');
  assert.equal(curvedAdjustment.initialAdjustmentWarning, true, 'Curved bounded adjustment must emit the mandatory mesh-adjustment warning.');
  assert.ok(curvedAdjustment.maximumPenetrationMm < 0.06, 'Curved bounded adjustment must retain penetration below its declared 0.06 mm bound.');
  assert.ok(curvedAdjustment.contactEquilibriumRelativeError < 0.12, 'Curved bounded adjustment must retain secondary-body force equilibrium.');

  console.log(JSON.stringify({
    fixture: 'deformable half-cylinder on planar steel foundation',
    radiusMm: 10,
    lengthMm: 10,
    prescribedApproachMm: 0.2,
    meshRefinement: samples,
    peakPressureRelativeChanges: refinementChanges,
    penaltyComparison: { baseline: samples[1], twoTimesStiffer: stiffPenalty },
    curvedInitialAdjustment: { initialClearanceMm: 0.05, maximumAdjustmentMm: 0.06, ...curvedAdjustment },
  }, null, 2));

  async function solve(meshSizeMm: number, penaltyStiffnessMPaPerMm: number, curvedInitialAdjustment = false) {
    const request = createRequest(meshSizeMm, penaltyStiffnessMPaPerMm, curvedInitialAdjustment);
    const model = await mesher.mesh(request, { descriptor: request.model, async exportDomain(domainId) { return geometry.get(domainId)!; } });
    const submission = await solver.submit(request, model);
    const deadline = Date.now() + solver.capabilities.execution.totalTimeoutMs;
    while (Date.now() < deadline) {
      const status = await solver.getStatus(submission.providerRunId);
      if (status.status === 'failed') throw new Error(`${status.failure?.code}: ${status.failure?.message}`);
      if (status.status === 'succeeded') {
        const result = await solver.getResult(submission.providerRunId);
        if (!result || result.analysisType !== 'static_contact') throw new Error('CalculiX contact-trend solve completed without a contact result.');
        const contact = result.contact.interfaces[0];
        const reaction = result.reactions.find(entry => entry.constraintId === 'drive-slider')?.forceN;
        if (!reaction) throw new Error('Contact-trend result omitted the driven-face reaction.');
        const vertices: Array<{ x: number; pressure: number }> = [];
        let cursor: string | undefined = '0';
        while (cursor !== undefined) {
          const page = await solver.getFieldDataset(submission.providerRunId, contact.pressureDatasetId, cursor, 128);
          for (const triangle of page.triangles) triangle.values.forEach((pressure, index) => vertices.push({ x: triangle.positionsAnalysisMm[index][0] + triangle.displacementsMm[index][0], pressure }));
          cursor = page.nextCursor ?? undefined;
        }
        const active = vertices.filter(vertex => vertex.pressure > Math.max(1e-8, contact.maximumPressureMPa * 1e-4));
        if (!active.length) throw new Error('Curved contact result contains no active pressure vertices.');
        const peak = active.reduce((best, vertex) => vertex.pressure > best.pressure ? vertex : best);
        const maximumX = Math.max(...active.map(vertex => Math.abs(vertex.x)));
        const edgeBand = active.filter(vertex => Math.abs(vertex.x) >= maximumX - Math.max(meshSizeMm * 0.6, 0.25));
        const activeEdgePressureMPa = edgeBand.reduce((sum, vertex) => sum + vertex.pressure, 0) / edgeBand.length;
        const drivenForceN = Math.abs(reaction[1]);
        const contactForceN = Math.abs(contact.forceOnSecondaryN[1]);
        const effectiveModulusMPa = 210000 / (2 * (1 - 0.3 ** 2));
        const hertzHalfWidthMm = Math.sqrt(4 * (drivenForceN / 10) * 10 / (Math.PI * effectiveModulusMPa));
        return {
          meshSizeMm, penaltyStiffnessMPaPerMm, nodeCount: model.quality.nodeCount, elementCount: model.quality.elementCount,
          status: contact.status, maximumPressureMPa: contact.maximumPressureMPa, maximumPressureXAbsMm: Math.abs(peak.x),
          activeHalfWidthMm: maximumX, activeEdgePressureMPa, maximumPenetrationMm: contact.maximumPenetrationMm,
          hertzHalfWidthMm, hertzHalfWidthRelativeError: Math.abs(maximumX - hertzHalfWidthMm) / hertzHalfWidthMm,
          drivenForceN, contactForceN, contactEquilibriumRelativeError: Math.abs(contactForceN - drivenForceN) / Math.max(drivenForceN, 1e-12),
          initialAdjustmentWarning: result.warnings.some(warning => warning.code === 'SIMULATION_CONTACT_INITIAL_ADJUSTMENT'),
        };
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await solver.cancel(submission.providerRunId);
    throw new Error('CalculiX contact-trend solve exceeded its declared total timeout.');
  }

  async function createStep(name: string, statements: string[]) {
    const stepPath = join(directory, `${name}.step`); const geoPath = join(directory, `${name}.geo`);
    await writeFile(geoPath, `${statements.join('\n')}\nSave "${stepPath.replace(/\\/g, '/')}";\n`, 'utf8');
    execFileSync(gmsh!, [geoPath, '-0', '-v', '2'], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    return new Uint8Array(await readFile(stepPath));
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

function createRequest(meshSizeMm: number, penaltyStiffnessMPaPerMm: number, curvedInitialAdjustment = false): NeutralSimulationRequestV2 {
  const projectRevision = `sim6a-trends-${meshSizeMm}-${penaltyStiffnessMPaPerMm}-${curvedInitialAdjustment ? 'adjusted' : 'touching'}`;
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;
  const translated = [1, 0, 0, 0, 0, 1, 0, curvedInitialAdjustment ? 20.05 : 20, 0, 0, 1, 0, 0, 0, 0, 1] as const;
  const foundationShape = { valid: true as const, connectedSolidCount: 1 as const, faceCount: 6, edgeCount: 12, volumeMm3: 2000, surfaceAreaMm2: 1000,
    boundingBoxOwnerLocalMm: { min: [-10, 0, 0] as NeutralVector3, max: [10, 10, 10] as NeutralVector3, size: [20, 10, 10] as NeutralVector3 } };
  const radius = 10; const length = 10;
  const sliderShape = { valid: true as const, connectedSolidCount: 1 as const, faceCount: 5, edgeCount: 9, volumeMm3: Math.PI * radius ** 2 * length / 2, surfaceAreaMm2: Math.PI * radius * length * 2 + 2 * radius * length,
    boundingBoxOwnerLocalMm: { min: [-10, -10, 0] as NeutralVector3, max: [10, 0, 10] as NeutralVector3, size: [20, 10, 10] as NeutralVector3 } };
  const face = (semanticReferenceId: string, domainId: 'foundation' | 'slider', role: 'constraint' | 'interaction', centroid: NeutralVector3, areaMm2: number,
    outwardDirection: NeutralVector3, geometryType: 'plane' | 'cylinder', min: NeutralVector3, max: NeutralVector3) => ({
    semanticReferenceId, domainId, ownerPartId: domainId, ownerBodyId: `${domainId}-body`, occurrenceId: `${domainId}:1`, geometryKind: 'FACE' as const, role,
    sourceFeatureId: domainId === 'foundation' ? 'box' : 'half-cylinder', resolutionState: 'valid' as const, resolvedAtProjectRevision: projectRevision,
    faceOwnerLocal: { centroidPartLocalMm: centroid, areaMm2, outwardDirection, geometryType, boundingBoxMm: { min, max } },
  });
  return sealNeutralSimulationRequestV2({
    schema: 'tunacad-neutral-simulation-request/2.0', studyId: `sim6a-curved-${meshSizeMm}-${penaltyStiffnessMPaPerMm}${curvedInitialAdjustment ? '-adjusted' : ''}`, name: curvedInitialAdjustment ? 'SIM-6D curved bounded initial adjustment' : 'SIM-6A curved pressure and penalty trends',
    preparedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    analysis: { type: 'static_contact', assumptions: ['small_displacement', 'small_strain', 'quasi_static', 'frictionless_contact'], settings: { initialIncrement: 0.1, minimumIncrement: 0.001, maximumIncrement: 0.2, maximumIncrements: 100 } },
    model: { projectRevision, coordinateSpace: 'frozen_analysis', domains: [
      { domainId: 'foundation', partId: 'foundation', bodyId: 'foundation-body', occurrenceId: 'foundation:1', geometryDigest: digest({ fixture: '20x10x10-foundation' }), transformToAnalysis: [...identity], shape: foundationShape },
      { domainId: 'slider', partId: 'slider', bodyId: 'slider-body', occurrenceId: 'slider:1', geometryDigest: digest({ fixture: 'r10-l10-half-cylinder' }), transformToAnalysis: [...translated], shape: sliderShape },
    ], references: [
      face('foundation-support-face', 'foundation', 'constraint', [0, 0, 5], 200, [0, -1, 0], 'plane', [-10, 0, 0], [10, 0, 10]),
      face('primary-plane', 'foundation', 'interaction', [0, 10, 5], 200, [0, 1, 0], 'plane', [-10, 10, 0], [10, 10, 10]),
      face('secondary-cylinder-negative', 'slider', 'interaction', [-2 * radius / Math.PI, -2 * radius / Math.PI, 5], Math.PI * radius * length / 2, [0, -1, 0], 'cylinder', [-10, -10, 0], [0, 0, 10]),
      face('secondary-cylinder-positive', 'slider', 'interaction', [2 * radius / Math.PI, -2 * radius / Math.PI, 5], Math.PI * radius * length / 2, [0, -1, 0], 'cylinder', [0, -10, 0], [10, 0, 10]),
      face('slider-drive-face', 'slider', 'constraint', [0, 0, 5], 200, [0, 1, 0], 'plane', [-10, 0, 0], [10, 0, 10]),
    ] },
    units: { geometry: 'mm', force: 'N', stress: 'MPa', displacement: 'mm', density: 'kg/m^3', acceleration: 'mm/s^2' },
    materials: [{ id: 'steel', name: 'Steel', model: 'isotropic_linear_elastic', densityKgM3: 7850, youngsModulusMPa: 210000, poissonRatio: 0.3, source: { kind: 'custom', reference: 'SIM-6A curved fixture' } }],
    materialAssignments: [
      { assignmentId: 'foundation-material', domainId: 'foundation', materialId: 'steel', volumeRegionId: 'foundation-volume' },
      { assignmentId: 'slider-material', domainId: 'slider', materialId: 'steel', volumeRegionId: 'slider-volume' },
    ],
    loads: [],
    constraints: [
      { id: 'foundation-support', name: 'Foundation support', type: 'fixed', semanticReferenceIds: ['foundation-support-face'] },
      { id: 'drive-slider', name: 'Prescribed cylinder approach', type: 'prescribed_displacement', semanticReferenceIds: ['slider-drive-face'], displacementMm: [0, -0.2, 0], coordinateSystem: 'analysis' },
    ],
    interactions: [{ id: 'curved-contact', name: 'Half-cylinder to plane', type: 'frictionless_contact', secondaryReferenceIds: ['secondary-cylinder-negative', 'secondary-cylinder-positive'], primaryReferenceIds: ['primary-plane'],
      formulation: 'node_to_surface_penalty', sliding: 'small', normalBehavior: { type: 'linear_penalty', stiffnessMPaPerMm: penaltyStiffnessMPaPerMm, tensionCutoffMPa: 0.000001, searchDistanceFactor: 1 }, tangentialBehavior: { type: 'frictionless' }, initialAdjustment: curvedInitialAdjustment ? { type: 'bounded_to_contact', maximumAdjustmentMm: 0.06 } : 'none' }],
    mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2, globalSizeMm: meshSizeMm, minimumSizeMm: meshSizeMm / 4, maximumNodes: 150000, maximumElements: 75000, qualityMetric: 'provider_normalized', minimumQuality: 0.04 },
    requestedResults: ['von_mises_stress', 'displacement', 'reaction_force', 'contact_status', 'contact_pressure', 'normal_gap', 'tangential_slip', 'contact_force'],
  });
}
