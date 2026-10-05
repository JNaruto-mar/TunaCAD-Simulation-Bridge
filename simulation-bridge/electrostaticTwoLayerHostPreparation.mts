import type { NeutralFemMesh } from '../src/simulation/externalSimulationContracts.ts';
import { meshTwoLayerNativeSteps } from '../providers/gmsh/ElectrostaticTwoLayerCompoundMesh.mts';
import { verifyAndComposeTwoLayerMesh } from '../providers/gmsh/ElectrostaticTwoLayerMesh.mts';
import type { ElectrostaticCadReaders, ElectrostaticHostRecords } from './electrostaticLiveSource.mts';
import { electrostaticStepGeometryDigest } from './electrostaticStepIdentity.mts';
import { ElectrostaticHostStorage, ELECTROSTATIC_SOURCE_IDENTITY,
  writeElectrostaticHostOnce } from './electrostaticHostStorage.mts';
import { sealElectrostaticTwoLayer, type ElectrostaticTwoLayerDraft } from './electrostaticTwoLayerFoundation.mts';
import { FileElectrostaticTwoLayerHostRecords } from './electrostaticTwoLayerHostRecords.mts';
import { bindTwoLayerSource } from './electrostaticTwoLayerAdmission.mts';
import { liveTwoLayerPreparationReceiptPath } from './electrostaticTwoLayerHostAdmission.mts';
import { twoLayerInterfaceGeometryDigest, verifyTwoLayerLiveSource } from './electrostaticTwoLayerSource.mts';
import { digest } from './stableDigest.mts';
import { verifyTwoLayerAuthoring, type TwoLayerAuthoring }
  from './electrostaticTwoLayerAuthoring.mts';

const faceKeys = ['xMin', 'xMax', 'yMin', 'yMax', 'zMin', 'zMax'] as const;
type Faces = LiveTwoLayerDomain['faces'];
import type { LiveTwoLayerDomain,LiveTwoLayerInventory } from './electrostaticTwoLayerInventoryContract.mts';
export type { LiveTwoLayerDomain,LiveTwoLayerInventory } from './electrostaticTwoLayerInventoryContract.mts';
export interface TwoLayerPreparationHost {
  cad: ElectrostaticCadReaders;
  /** Host CAD/model store only. No client request, mesh or digest accepted. */
  readLiveInventory(): Promise<LiveTwoLayerInventory>;
  subscribeSourceChanges(listener: () => void): () => void;
  readCurrentRuntimeIdentity(): Promise<unknown>;
  gmshExecutable: string;
  storage: ElectrostaticHostStorage;
  /** Optional UI/MCP choices; never an alternative trusted source. */
  authoring?: TwoLayerAuthoring;
  /** Trusted host testing seam; production leaves this unset. */
  mesh?: (request: unknown, steps: [Uint8Array, Uint8Array], executable: string,
    sizeMm: number) => Promise<[NeutralFemMesh, NeutralFemMesh]>;
}
function fail(reason: string): never {
  throw new Error('ELECTROSTATIC_TWO_LAYER_HOST_PREPARATION_INVALID: ' + reason);
}
function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('missing native source');
  return value as Record<string, any>;
}
function near(a: number, b: number) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-7;
}
function checkMatrix(matrix: number[], xMm: number) {
  const expected = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, xMm, 0, 0, 1];
  if (!Array.isArray(matrix) || matrix.length !== 16
    || matrix.some((value, index) => !near(value, expected[index])))
    fail('physical placement is not the admitted contiguous, axis-aligned pair');
}
function facesOf(value: unknown): Faces {
  const faces = object(value);
  if (Object.keys(faces).sort().join(',') !== [...faceKeys].sort().join(',')
    || faceKeys.some(key => typeof faces[key] !== 'string' || !faces[key])
    || new Set(Object.values(faces)).size !== 6) fail('missing/ambiguous FACE roles');
  return faces as Faces;
}
function requireInventory(value: LiveTwoLayerInventory) {
  if (!value || typeof value.projectRevision !== 'string'
    || !Array.isArray(value.domains) || value.domains.length !== 2)
    fail('exactly two live dielectric domains required');
  const domains = value.domains.map(domain => ({ ...domain, faces: facesOf(domain.faces) }));
  if (domains.some(domain => !domain.domainId || !domain.partId || !domain.bodyId)
    || new Set(domains.map(domain => domain.domainId)).size !== 2
    || new Set(domains.map(domain => domain.partId)).size !== 2
    || new Set(domains.map(domain => domain.bodyId)).size !== 2)
    fail('duplicate/missing live domain identity');
  return { projectRevision: value.projectRevision, domains };
}

/** Host-only capture. It cannot accept a caller-built electrical request or mesh.
 * Native source reads and an OCC fragment mesh are bracketed by live revision
 * reads; the protected record is published only after final rebinding. */
export async function prepareHostTwoLayerElectrostaticStudy(
  studyId: string, host: TwoLayerPreparationHost) {
  await host.storage.assertReady();
  const first = requireInventory(await host.readLiveInventory());
  const authoring = host.authoring
    ? verifyTwoLayerAuthoring(host.authoring, first) : null;
  const changed = { value: false };
  const unsubscribe = host.subscribeSourceChanges(() => { changed.value = true; });
  try {
    if (changed.value || await host.cad.getProjectRevision() !== first.projectRevision)
      fail('CAD changed before preparation');
    const inspected = [];
    for (const domain of first.domains) {
      const body = object(await host.cad.inspectBody(domain.bodyId));
      const assignment = object(await host.cad.readPartMaterial(domain.partId));
      const material = object(assignment.engineeringMaterial);
      const dielectric = object(material.dielectric);
      const bounds = object(body.boundingBox);
      const size = bounds.size;
      if (body.projectRevision !== first.projectRevision || body.bodyId !== domain.bodyId
        || body.ownerPartId !== domain.partId || body.shapeType !== 'solid'
        || body.isValid !== true || body.solidCount !== 1
        || body.connectedComponentCount !== 1 || body.faceCount !== 6
        || body.closed !== true || body.manifold !== true
        || !Array.isArray(size) || size.length !== 3
        || size.some((n: unknown) => typeof n !== 'number' || !Number.isFinite(n) || n <= 0)
        || !Array.isArray(bounds.min) || bounds.min.length !== 3
        || bounds.min.some((n: number) => !near(n, 0))
        || assignment.projectRevision !== first.projectRevision
        || assignment.identity?.componentId !== domain.partId
        || assignment.identity?.definitionId !== domain.partId
        || !material.libraryId || !material.source || !material.revision
        || dielectric.model !== 'homogeneous_linear_isotropic_dielectric'
        || dielectric.permittivityUnit !== 'F/m'
        || typeof dielectric.absolutePermittivityFPerM !== 'number'
        || !(dielectric.absolutePermittivityFPerM >= 1e-15
          && dielectric.absolutePermittivityFPerM <= 1e-3))
        fail('native body/material/provenance invalid');
      inspected.push({ domain, size: size as [number, number, number],
        material, dielectric });
    }
    // The local native STEP exports are translated by Gmsh exactly as these
    // trusted occurrence transforms prescribe. No silent gap/overlap repair.
    const [a, b] = inspected;
    checkMatrix(a.domain.worldMatrix, 0);
    checkMatrix(b.domain.worldMatrix, a.size[0]);
    if (!near(a.size[1], b.size[1]) || !near(a.size[2], b.size[2]))
      fail('dielectric interface footprints disagree');
    const steps = [] as Uint8Array[];
    const geometryDigests = [] as string[];
    for (const item of inspected) {
      const bytes = await host.cad.exportGeometry(item.domain.bodyId);
      steps.push(bytes);
      geometryDigests.push(await electrostaticStepGeometryDigest(bytes));
    }
    const planeXM = a.size[0] / 1000, totalXM = (a.size[0] + b.size[0]) / 1000;
    const widthM = a.size[1] / 1000, heightM = a.size[2] / 1000;
    const surfaceDigest = twoLayerInterfaceGeometryDigest(planeXM, widthM, heightM);
    const draft: ElectrostaticTwoLayerDraft = {
      schema: 'tunacad-electrostatic-two-layer-foundation/0.1', studyId,
      analysis: { type: 'electrostatic', assumptions: [
        'two_linear_isotropic_dielectrics', 'zero_free_volume_and_interface_charge',
        'bounded_domain', 'no_coupling', 'ideal_parallel_plate_no_fringing',
      ] },
      model: {
        projectRevision: first.projectRevision,
        domains: inspected.map((item, index) => ({
          domainId: item.domain.domainId, partId: item.domain.partId,
          bodyId: item.domain.bodyId, geometryDigest: geometryDigests[index],
          shape: { kind: 'origin_aligned_rectangular_dielectric_layer',
            xMinM: index === 0 ? 0 : planeXM,
            xMaxM: index === 0 ? planeXM : totalXM,
            widthM, heightM, lengthUnit: 'm', longitudinalAxis: 'x',
            faces: item.domain.faces, interfaceSurfaceDigest: surfaceDigest },
        })) as ElectrostaticTwoLayerDraft['model']['domains'],
        interface: { kind: 'declared_conformal_planar_dielectric_interface',
          leftDomainId: a.domain.domainId, leftFaceId: a.domain.faces.xMax,
          rightDomainId: b.domain.domainId, rightFaceId: b.domain.faces.xMin,
          planeXM, areaM2: widthM * heightM, surfaceDigest,
          lengthUnit: 'm', areaUnit: 'm^2', normalFromLeftToRight: [1, 0, 0] },
      },
      materials: inspected.map(item => ({
        materialId: item.material.libraryId, domainId: item.domain.domainId,
        model: 'homogeneous_linear_isotropic_dielectric',
        absolutePermittivityFPerM: item.dielectric.absolutePermittivityFPerM,
        permittivityUnit: 'F/m',
        source: { kind: item.material.custom === true ? 'custom' : 'library',
          reference: item.material.source, revision: item.material.revision },
      })) as ElectrostaticTwoLayerDraft['materials'],
      prescribedPotentials: [
        { groupId: studyId + '-left', domainId: a.domain.domainId, faceId: a.domain.faces.xMin,
          kind: 'prescribed_electric_potential',
          potentialV: authoring?.electrodes[0].potentialV ?? 0, unit: 'V' },
        { groupId: studyId + '-right', domainId: b.domain.domainId, faceId: b.domain.faces.xMax,
          kind: 'prescribed_electric_potential',
          potentialV: authoring?.electrodes[1].potentialV ?? 100, unit: 'V' },
      ],
      lateralBoundary: { kind: 'zero_normal_electric_displacement',
        faces: inspected.flatMap(item => (['yMin', 'yMax', 'zMin', 'zMax'] as const)
          .map(key => ({ domainId: item.domain.domainId, faceId: item.domain.faces[key] }))) as
          ElectrostaticTwoLayerDraft['lateralBoundary']['faces'],
        normalElectricDisplacementCPerM2: 0, unit: 'C/m^2' },
      output: { axialPositionsM: [0, planeXM / 2, planeXM,
        planeXM + b.size[0] / 2000, totalXM],
        units: { electricPotential: 'V', electricField: 'V/m',
          electricDisplacement: 'C/m^2', electrodeCharge: 'C', capacitance: 'F',
          electrostaticEnergy: 'J', electrostaticEnergyDensity: 'J/m^3' } },
    };
    const request = sealElectrostaticTwoLayer(draft);
    const records: ElectrostaticHostRecords = {
      readSealedRequest: async () => structuredClone(request),
      readDomainBinding: async (_id, domainId) => {
        const current = requireInventory(await host.readLiveInventory());
        const matches = current.domains.filter(d => d.domainId === domainId);
        return current.projectRevision === first.projectRevision && matches.length === 1
          ? { domainId, partId: matches[0].partId, bodyId: matches[0].bodyId,
            projectRevision: current.projectRevision } : null;
      },
      readValidatedMesh: async () => fail('no single-domain mesh'),
      readCurrentRuntimeIdentity: () => host.readCurrentRuntimeIdentity(),
    };
    const before = await verifyTwoLayerLiveSource(request, records, host.cad);
    if (changed.value) fail('source changed during native inspection');
    const meshes = await (host.mesh ?? meshTwoLayerNativeSteps)(
      request, steps as [Uint8Array, Uint8Array], host.gmshExecutable, 1);
    if (changed.value || await host.cad.getProjectRevision() !== first.projectRevision)
      fail('source changed during meshing');
    const verified = verifyAndComposeTwoLayerMesh(request, meshes, 1);
    const final = requireInventory(await host.readLiveInventory());
    if (changed.value || digest(final) !== digest(first)
      || authoring && digest(verifyTwoLayerAuthoring(authoring, final)) !== digest(authoring)
      || await host.cad.getProjectRevision() !== first.projectRevision
      || digest(await verifyTwoLayerLiveSource(request, records, host.cad)) !== digest(before))
      fail('source changed before sealing');
    const capture = {
      cad: host.cad, records,
      readSealedRequest: async () => structuredClone(request),
      readLocalMeshes: async () => structuredClone(meshes),
      readCurrentRuntimeIdentity: () => host.readCurrentRuntimeIdentity(),
      meshSizeMm: 1,
    };
    const durable = new FileElectrostaticTwoLayerHostRecords(
      host.storage, host.cad, () => host.readCurrentRuntimeIdentity(), capture);
    if (changed.value) fail('source changed before protected publication');
    const assertUnchanged = async () => {
      if (changed.value || await host.cad.getProjectRevision() !== first.projectRevision
        || digest(requireInventory(await host.readLiveInventory())) !== digest(first)
        || digest(await verifyTwoLayerLiveSource(request, records, host.cad)) !== digest(before))
        fail('source changed before protected publication');
    };
    const published = await durable.publishStudy(studyId, assertUnchanged);
    await assertUnchanged();
    const source = await bindTwoLayerSource(studyId, durable);
    const protectedStudy = await durable.readAdmissionRecord(studyId);
    if (protectedStudy.recordDigest !== published.recordDigest
      || source.identity.sourceDigest !== published.sourceDigest)
      fail('protected study changed before admission receipt');
    await assertUnchanged();
    const unsignedReceipt = {
      schema: 'tunacad-electrostatic-two-layer-live-preparation/0.1' as const,
      sourceIdentityVersion: ELECTROSTATIC_SOURCE_IDENTITY,
      configurationDigest: host.storage.configurationDigest,
      studyId, recordDigest: published.recordDigest,
      requestDigest: source.request.requestDigest,
      sourceDigest: source.identity.sourceDigest,
      fragmentMeshDigest: source.verified.meshDigest,
      conformityEvidenceDigest: digest(source.verified.interfaceEvidence),
    };
    await host.storage.assertReady();
    await writeElectrostaticHostOnce(
      liveTwoLayerPreparationReceiptPath(host.storage, studyId),
      { ...unsignedReceipt, receiptDigest: digest(unsignedReceipt) }, 4096);
    // The receipt is the admission marker. If the source changes after this
    // point, admission's fresh double rebound refuses dispatch.
    return { studyId, requestDigest: request.requestDigest,
      projectRevision: first.projectRevision, sourceDigests: geometryDigests,
      fragmentMeshDigest: verified.meshDigest,
      interfaceEvidence: verified.interfaceEvidence,
      nodes: verified.model.nodes.length,
      elements: verified.model.volumeElements.connectivity.length,
      recordDigest: published.recordDigest, sourceDigest: published.sourceDigest,
      providerAdmission: 'closed' as const };
  } finally { unsubscribe(); }
}
