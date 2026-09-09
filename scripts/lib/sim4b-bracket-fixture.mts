import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digest } from '../../simulation-bridge/stableDigest.mts';
import { sealNeutralSimulationRequestV2 } from '../../simulation-bridge/v2Validation.mts';
import type { NeutralSimulationRequestV2, NeutralVector3 } from '../../src/simulation/externalSimulationContracts.ts';

export interface Sim4bBracketFixture {
  schema: string;
  fixtureId: string;
  status: string;
  geometry: { baseSizeMm: NeutralVector3; webSizeMm: NeutralVector3; webTranslationAnalysisMm: NeutralVector3 };
  material: { densityKgM3: number; youngsModulusMPa: number; poissonRatio: number };
  load: { referencePointAnalysisMm: NeutralVector3; forceN: NeutralVector3; momentNmm: NeutralVector3 };
  support: { referencePointAnalysisMm: NeutralVector3; translationMm: NeutralVector3; rotationRad: NeutralVector3 };
  expected: {
    supportReactionForceN: NeutralVector3; supportReactionMomentNmm: NeutralVector3;
    forceAbsoluteToleranceN: number; momentAbsoluteToleranceNmm: number; minimumNonzeroDisplacementMm: number;
  };
}

export async function loadSim4bBracketFixture(): Promise<Sim4bBracketFixture> {
  return JSON.parse(await readFile(new URL('../../qualification/sim4b-bolted-bracket-rigid-connectors.json', import.meta.url), 'utf8')) as Sim4bBracketFixture;
}

export async function makeSim4bBoxStep(executable: string, directory: string, name: string, size: NeutralVector3): Promise<Uint8Array> {
  const stepPath = join(directory, `${name}.step`);
  const geoPath = join(directory, `${name}.geo`);
  const output = stepPath.replace(/\\/g, '/').replace(/"/g, '\\"');
  await writeFile(geoPath, [`SetFactory("OpenCASCADE");`, `Box(1) = {0, 0, 0, ${size.join(', ')}};`, `Save "${output}";`].join('\n'), 'utf8');
  execFileSync(executable, [geoPath, '-0', '-v', '2'], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Uint8Array(await readFile(stepPath));
}

export function createSim4bBracketRequest(fixture: Sim4bBracketFixture): NeutralSimulationRequestV2 {
  const baseSize = fixture.geometry.baseSizeMm;
  const webSize = fixture.geometry.webSizeMm;
  const webTranslation = fixture.geometry.webTranslationAnalysisMm;
  const projectRevision = 'sim4b-bracket-r1';
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;
  const webTransform = [1, 0, 0, webTranslation[0], 0, 1, 0, webTranslation[1], 0, 0, 1, webTranslation[2], 0, 0, 0, 1] as const;
  const shape = (size: NeutralVector3) => ({
    valid: true as const, connectedSolidCount: 1 as const, faceCount: 6, edgeCount: 12,
    volumeMm3: size[0] * size[1] * size[2],
    surfaceAreaMm2: 2 * (size[0] * size[1] + size[0] * size[2] + size[1] * size[2]),
    boundingBoxOwnerLocalMm: { min: [0, 0, 0] as NeutralVector3, max: [...size] as NeutralVector3, size: [...size] as NeutralVector3 },
  });
  const face = (semanticReferenceId: string, domainId: string, ownerPartId: string, occurrenceId: string, centroid: NeutralVector3, areaMm2: number, outwardDirection: NeutralVector3, min: NeutralVector3, max: NeutralVector3) => ({
    semanticReferenceId, domainId, ownerPartId, ownerBodyId: `${ownerPartId}-body`, occurrenceId, geometryKind: 'FACE' as const, role: 'interaction' as const,
    sourceFeatureId: `${ownerPartId}-box`, resolutionState: 'valid' as const, resolvedAtProjectRevision: projectRevision,
    faceOwnerLocal: { centroidPartLocalMm: centroid, areaMm2, outwardDirection, geometryType: 'plane', edgeCount: 4, boundingBoxMm: { min, max } },
  });
  return sealNeutralSimulationRequestV2({
    schema: 'tunacad-neutral-simulation-request/2.0', studyId: fixture.fixtureId, name: 'SIM-4B bolted L-bracket connector fixture',
    preparedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    analysis: { type: 'linear_static', assumptions: ['small_displacement', 'small_strain', 'static_loading'] },
    model: {
      projectRevision, coordinateSpace: 'frozen_analysis',
      domains: [
        { domainId: 'bracket-base', partId: 'bracket-base-part', bodyId: 'bracket-base-part-body', occurrenceId: 'bracket-base-occurrence', geometryDigest: digest({ box: baseSize }), transformToAnalysis: [...identity], shape: shape(baseSize) },
        { domainId: 'bracket-web', partId: 'bracket-web-part', bodyId: 'bracket-web-part-body', occurrenceId: 'bracket-web-occurrence', geometryDigest: digest({ box: webSize }), transformToAnalysis: [...webTransform], shape: shape(webSize) },
      ],
      references: [
        face('base-bottom-bolt-group', 'bracket-base', 'bracket-base-part', 'bracket-base-occurrence', [20, 10, 0], 800, [0, 0, -1], [0, 0, 0], [40, 20, 0]),
        face('base-top-bond', 'bracket-base', 'bracket-base-part', 'bracket-base-occurrence', [20, 10, 5], 800, [0, 0, 1], [0, 0, 5], [40, 20, 5]),
        face('web-bottom-bond', 'bracket-web', 'bracket-web-part', 'bracket-web-occurrence', [2.5, 10, 0], 100, [0, 0, -1], [0, 0, 0], [5, 20, 0]),
        face('web-top-load-plate', 'bracket-web', 'bracket-web-part', 'bracket-web-occurrence', [2.5, 10, 40], 100, [0, 0, 1], [0, 0, 40], [5, 20, 40]),
      ],
    },
    units: { geometry: 'mm', force: 'N', stress: 'MPa', displacement: 'mm', density: 'kg/m^3', acceleration: 'mm/s^2' },
    materials: [{ id: 'steel', name: 'Fixture steel', model: 'isotropic_linear_elastic', densityKgM3: fixture.material.densityKgM3, youngsModulusMPa: fixture.material.youngsModulusMPa, poissonRatio: fixture.material.poissonRatio, source: { kind: 'custom', reference: fixture.fixtureId } }],
    materialAssignments: [
      { assignmentId: 'base-steel', domainId: 'bracket-base', materialId: 'steel', volumeRegionId: 'base-volume' },
      { assignmentId: 'web-steel', domainId: 'bracket-web', materialId: 'steel', volumeRegionId: 'web-volume' },
    ],
    loads: [{ id: 'eccentric-remote-load', name: 'Eccentric remote bracket load', type: 'remote_force', connectorId: 'load-point-connector', forceN: fixture.load.forceN, momentNmm: fixture.load.momentNmm, coordinateSystem: 'analysis' }],
    constraints: [{ id: 'bolt-group-support', name: 'Fixed bolt-group support', type: 'remote_displacement', connectorId: 'bolt-group-connector', translationMm: fixture.support.translationMm, rotationRad: fixture.support.rotationRad, coordinateSystem: 'analysis' }],
    interactions: [
      { id: 'web-base-bond', name: 'Bonded web to base', type: 'bonded_tie', secondaryReferenceIds: ['web-bottom-bond'], primaryReferenceIds: ['base-top-bond'], adjustment: 'none', positionToleranceMm: 0.05 },
      { id: 'bolt-group-connector', name: 'Rigid bolt-group connector', type: 'rigid_connector', semanticReferenceIds: ['base-bottom-bolt-group'], referencePointAnalysisMm: fixture.support.referencePointAnalysisMm, coupling: 'rigid_6dof' },
      { id: 'load-point-connector', name: 'Rigid remote load connector', type: 'rigid_connector', semanticReferenceIds: ['web-top-load-plate'], referencePointAnalysisMm: fixture.load.referencePointAnalysisMm, coupling: 'rigid_6dof' },
    ],
    mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2, globalSizeMm: 6, minimumSizeMm: 1.5, maximumNodes: 150000, maximumElements: 75000, qualityMetric: 'provider_normalized', minimumQuality: 0.04 },
    requestedResults: ['von_mises_stress', 'displacement', 'reaction_force', 'critical_regions'],
  });
}

export function resealSim4bRequest(request: NeutralSimulationRequestV2): void {
  const sealed = sealNeutralSimulationRequestV2({ ...(request as any), requestDigest: undefined, model: { ...(request.model as any), modelDigest: undefined, domains: request.model.domains.map(domain => ({ ...domain, domainDigest: undefined })) } });
  Object.assign(request, sealed);
}
