import { ElectrostaticLiveSourceReader, type ElectrostaticCadReaders,
  type ElectrostaticHostRecords } from './electrostaticLiveSource.mts';
import { sealElectrostaticFoundation } from './electrostaticFoundation.mts';
import { validateElectrostaticTwoLayer, type ElectrostaticTwoLayer } from './electrostaticTwoLayerFoundation.mts';
import { digest } from './stableDigest.mts';

/** Hash of a native-verified planar rectangle in frozen analysis coordinates.
 * Call this only after both native bodies/FACEs pass the trusted reader. */
export function twoLayerInterfaceGeometryDigest(planeXM: number, widthM: number, heightM: number) {
  return digest({ schema: 'tunacad-two-layer-planar-interface/0.1',
    cornersM: [[planeXM, 0, 0], [planeXM, widthM, 0],
      [planeXM, 0, heightM], [planeXM, widthM, heightM]],
    areaM2: widthM * heightM, edgeLengthsM: [widthM, widthM, heightM, heightM] });
}

export function twoLayerLocalSlabRequest(r: ElectrostaticTwoLayer, index: 0 | 1) {
  const d = r.model.domains[index], m = r.materials[index];
  return sealElectrostaticFoundation({
    schema: 'tunacad-electrostatic-foundation/0.1',
    studyId: r.studyId + '-domain-' + index,
    analysis: { type: 'electrostatic', assumptions: [
      'homogeneous_linear_isotropic_dielectric', 'zero_free_volume_charge',
      'bounded_domain', 'no_coupling', 'ideal_parallel_plate_no_fringing',
    ] },
    model: { projectRevision: r.model.projectRevision, domains: [{
      domainId: d.domainId, partId: d.partId, bodyId: d.bodyId, geometryDigest: d.geometryDigest,
      shape: { kind: 'ideal_parallel_plate_slab',
        lengthM: d.shape.xMaxM - d.shape.xMinM,
        widthM: d.shape.widthM, heightM: d.shape.heightM,
        lengthUnit: 'm', longitudinalAxis: 'x', faces: d.shape.faces },
    }] },
    material: structuredClone(m),
    // Local pseudo-electrodes exist only to reuse the fully trusted body/FACE
    // reader and mesh descriptor. They do not create provider admission.
    prescribedPotentials: [
      { groupId: 'local-left-' + index, domainId: d.domainId,
        faceIds: [d.shape.faces.xMin], kind: 'prescribed_electric_potential',
        potentialV: 0, unit: 'V' },
      { groupId: 'local-right-' + index, domainId: d.domainId,
        faceIds: [d.shape.faces.xMax], kind: 'prescribed_electric_potential',
        potentialV: 1, unit: 'V' },
    ],
    lateralBoundary: { kind: 'zero_normal_electric_displacement',
      appliesTo: 'all_four_lateral_faces', normalElectricDisplacementCPerM2: 0,
      unit: 'C/m^2' },
    output: { normalizedAxialPositions: [0, 1], units: structuredClone(r.output.units) },
  });
}

/** Provider-only verification against live CAD, independently owned domain
 * bindings, native FACE/topology and canonical STEP digests. */
export async function verifyTwoLayerLiveSource(value: unknown,
  records: ElectrostaticHostRecords, cad: ElectrostaticCadReaders) {
  const r = validateElectrostaticTwoLayer(value);
  const before = await cad.getProjectRevision();
  if (before !== r.model.projectRevision) throw new Error('ELECTROSTATIC_TWO_LAYER_SOURCE_STALE');
  const local = [twoLayerLocalSlabRequest(r, 0), twoLayerLocalSlabRequest(r, 1)];
  for (const request of local) {
    const trusted = new ElectrostaticLiveSourceReader({
      readSealedRequest: async () => request,
      readDomainBinding: async (_studyId, domainId) =>
        records.readDomainBinding(r.studyId, domainId),
      readValidatedMesh: records.readValidatedMesh.bind(records),
      readCurrentRuntimeIdentity: records.readCurrentRuntimeIdentity.bind(records),
    }, cad);
    await trusted.readSealedRequest(request.studyId);
    if (await cad.getProjectRevision() !== before) throw new Error('ELECTROSTATIC_TWO_LAYER_SOURCE_STALE');
  }
  const [a, b] = r.model.domains;
  const nativeInterfaceDigest = twoLayerInterfaceGeometryDigest(
    a.shape.xMaxM, a.shape.widthM, a.shape.heightM);
  if (nativeInterfaceDigest !== r.model.interface.surfaceDigest
    || nativeInterfaceDigest !== a.shape.interfaceSurfaceDigest
    || nativeInterfaceDigest !== b.shape.interfaceSurfaceDigest) {
    throw new Error('ELECTROSTATIC_TWO_LAYER_NATIVE_INTERFACE_MISMATCH');
  }
  if (await cad.getProjectRevision() !== before) throw new Error('ELECTROSTATIC_TWO_LAYER_SOURCE_STALE');
  return { requestDigest: r.requestDigest, projectRevision: before,
    domainGeometryDigests: [a.geometryDigest, b.geometryDigest],
    nativeInterfaceDigest, localRequestDigests: local.map(item => item.requestDigest),
    verification: 'live_native_cad_faces_topology_canonical_step' as const };
}
