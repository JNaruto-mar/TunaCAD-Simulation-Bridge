import type {
  MeshProviderCapabilitiesV2,
  NeutralFemMesh,
  NeutralFemModelV2,
  NeutralMeshJobRequest,
  NeutralSimulationRequestV2,
  SimulationGeometryResolver,
  SimulationGeometryResolverV2,
} from '../../src/simulation/externalSimulationContracts.ts';
import { composeNeutralFemModelV2, createNeutralMeshJobRequestV2 } from '../../src/simulation/multiDomainFemModel.ts';
import { digest } from '../../simulation-bridge/stableDigest.mts';
import { validateNeutralFemModelV2, validateNeutralSimulationRequestV2 } from '../../simulation-bridge/v2Validation.mts';
import { GmshMeshProvider } from './GmshMeshProvider.mts';

/** SIM-4A/4B composition adapter. Each domain passes independently through the
 * hardened v1 STEP/Gmsh boundary in owner-local coordinates. Only validated
 * neutral meshes are transformed and concatenated, so repeated occurrences do
 * not rely on ambiguous STEP volume/entity ordering. Explicit conformal
 * interfaces are merged only after exact quadratic topology checks. */
export class GmshMultiDomainMeshProvider {
  readonly id = 'tunacad-gmsh-multi-domain-poc';
  readonly version = '0.1.0-poc';
  readonly capabilities: MeshProviderCapabilitiesV2;
  private readonly local: GmshMeshProvider;
  private readonly runtimeVersion: string;

  constructor(options: { executable: string; runtimeVersion: string; maximumDomains?: number }) {
    this.local = new GmshMeshProvider(options);
    this.runtimeVersion = options.runtimeVersion;
    this.capabilities = {
      ...this.local.capabilities,
      interfaceVersion: '2.0',
      maximumDomains: options.maximumDomains ?? 16,
      multiDomain: true,
      rigidOccurrenceTransforms: true,
      domainRegionMapping: true,
      interactionTypes: ['shared_topology'],
      qualification: {
        ...this.local.capabilities.qualification,
        status: this.local.capabilities.qualification.status,
        engineeringUsePermitted: false,
        statement: `${this.local.capabilities.qualification.statement} SIM-4A per-domain composition and fail-closed conformal node sharing pass TunaCAD internal validation and remain experimental.`,
        limitations: [...this.local.capabilities.qualification.limitations, 'Domains are meshed independently; shared topology requires an exact one-to-one quadratic interface match, otherwise an explicit solver-side bonded tie is required'],
        evidence: { schema: 'tunacad-simulation-qualification-matrix/1.0', matrixId: 'sim4a-windows-x64-gmsh-4.15.2-calculix-2.16', pendingLaneIds: ['independent-engineering-review'] },
      },
    };
  }

  async mesh(request: NeutralSimulationRequestV2, geometry: SimulationGeometryResolverV2, signal?: AbortSignal): Promise<NeutralFemModelV2> {
    validateNeutralSimulationRequestV2(request);
    if (request.model.domains.length > this.capabilities.maximumDomains) throw meshError('SIMULATION_MESH_DOMAIN_LIMIT', `The SIM-4A mesher accepts at most ${this.capabilities.maximumDomains} domains.`);
    if (geometry.descriptor.projectRevision !== request.model.projectRevision || geometry.descriptor.modelDigest !== request.model.modelDigest) {
      throw meshError('SIMULATION_GEOMETRY_IDENTITY_INVALID', 'The multi-domain geometry resolver does not match the admitted model revision and digest.');
    }
    const meshRequest = createNeutralMeshJobRequestV2(request);
    const meshes: Array<{ domainId: string; mesh: NeutralFemMesh }> = [];
    for (const domain of meshRequest.domains) {
      if (signal?.aborted) throw meshError('SIMULATION_CANCELLED', 'SIM-4A meshing was cancelled before the next domain export.');
      const localRequest: NeutralMeshJobRequest = {
        schema: 'tunacad-neutral-mesh-request/1.0', studyId: request.studyId, requestDigest: request.requestDigest,
        projectRevision: request.model.projectRevision, geometryDigest: domain.geometryDigest,
        coordinateSpace: 'part_definition_local', units: 'mm', mesh: structuredClone(request.mesh),
        boundaryRegions: meshRequest.boundaryRegions.filter(region => region.domainId === domain.domainId).map(region => ({
          regionId: region.regionId, role: region.role === 'interaction' ? 'constraint' : region.role,
          semanticReferenceId: region.semanticReferenceId, sourceFeatureId: region.sourceFeatureId, face: structuredClone(region.faceOwnerLocal),
        })),
      };
      const references = request.model.references.filter(reference => reference.domainId === domain.domainId).map(reference => ({
        semanticReferenceId: reference.semanticReferenceId, ownerPartId: reference.ownerPartId,
        geometryKind: 'FACE' as const, role: reference.role === 'interaction' ? 'constraint' as const : reference.role,
        sourceFeatureId: reference.sourceFeatureId, resolutionState: 'valid' as const,
        resolvedAtProjectRevision: reference.resolvedAtProjectRevision, face: structuredClone(reference.faceOwnerLocal),
      }));
      const { boundingBoxOwnerLocalMm, ...shapeWithoutBox } = domain.shape;
      const descriptor: SimulationGeometryResolver['descriptor'] = {
        projectRevision: request.model.projectRevision, partId: domain.partId, bodyId: domain.bodyId,
        geometryDigest: domain.geometryDigest, coordinateSpace: 'part_definition_local',
        shape: { ...structuredClone(shapeWithoutBox), boundingBoxMm: structuredClone(boundingBoxOwnerLocalMm) },
        references,
      };
      const submission = await this.local.submit(localRequest, {
        descriptor,
        export: format => geometry.exportDomain(domain.domainId, format),
      });
      const localMesh = await this.waitForMesh(submission.meshRunId, signal);
      if (signal?.aborted) throw meshError('SIMULATION_CANCELLED', 'SIM-4A meshing was cancelled before domain composition.');
      meshes.push({ domainId: domain.domainId, mesh: localMesh });
    }
    const model = composeNeutralFemModelV2(meshRequest, meshes, {
      adapterId: this.id, adapterVersion: this.version, engine: 'Gmsh',
      engineVersion: this.runtimeVersion,
      optionsDigest: digest({ mode: 'independent-domain-composition', domainIds: request.model.domains.map(domain => domain.domainId), mesh: request.mesh,
        sharedTopologyInteractionIds: request.interactions.filter(interaction => interaction.type === 'shared_topology').map(interaction => interaction.id).sort() }),
    });
    validateNeutralFemModelV2(model, request);
    return model;
  }

  private async waitForMesh(meshRunId: string, signal?: AbortSignal): Promise<NeutralFemMesh> {
    const deadline = Date.now() + this.local.capabilities.execution.totalTimeoutMs;
    while (Date.now() < deadline) {
      if (signal?.aborted) { await this.local.cancel(meshRunId); throw meshError('SIMULATION_CANCELLED', 'SIM-4A domain meshing was cancelled.'); }
      const status = await this.local.getStatus(meshRunId);
      if (signal?.aborted) { await this.local.cancel(meshRunId); throw meshError('SIMULATION_CANCELLED', 'SIM-4A domain meshing was cancelled.'); }
      if (status.status === 'succeeded') {
        const mesh = await this.local.getMesh(meshRunId);
        if (signal?.aborted) throw meshError('SIMULATION_CANCELLED', 'SIM-4A domain meshing was cancelled before result composition.');
        if (!mesh) throw meshError('SIMULATION_MESH_INVALID', 'Gmsh completed without a neutral domain mesh.');
        return mesh;
      }
      if (status.status === 'failed') throw meshError(status.failure?.code ?? 'SIMULATION_MESH_FAILED', status.failure?.message ?? 'Gmsh domain meshing failed.');
      if (status.status === 'cancelled') throw meshError('SIMULATION_MESH_CANCELLED', 'Gmsh domain meshing was cancelled.');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await this.local.cancel(meshRunId).catch(() => undefined);
    throw meshError('SIMULATION_MESH_TIMEOUT', 'Gmsh domain meshing exceeded its declared total timeout.');
  }
}

function meshError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
