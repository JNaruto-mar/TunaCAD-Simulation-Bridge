import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sealElectrostaticTwoLayer } from '../simulation-bridge/electrostaticTwoLayerFoundation.mts';
import { twoLayerInterfaceGeometryDigest } from '../simulation-bridge/electrostaticTwoLayerSource.mts';
import { ElectrostaticHostStorage, ELECTROSTATIC_SOURCE_IDENTITY } from '../simulation-bridge/electrostaticHostStorage.mts';
import { HostTwoLayerProviderAdmission, liveTwoLayerPreparationReceiptPath,
  readLiveTwoLayerPreparationReceipt, verifyTwoLayerHostAdmission }
  from '../simulation-bridge/electrostaticTwoLayerHostAdmission.mts';
import { writeElectrostaticHostOnce } from '../simulation-bridge/electrostaticHostStorage.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';

const faceNames = ['xMin', 'xMax', 'yMin', 'yMax', 'zMin', 'zMax'] as const;
const face = (prefix: string) => Object.fromEntries(faceNames.map(name =>
  [name, prefix + '-' + name])) as Record<(typeof faceNames)[number], string>;
const aFace = face('a'), bFace = face('b');
const surfaceDigest = twoLayerInterfaceGeometryDigest(0.0004, 0.01, 0.01);
const request = sealElectrostaticTwoLayer({
  schema: 'tunacad-electrostatic-two-layer-foundation/0.1',
  studyId: 'host-owned-admission-controlled',
  analysis: { type: 'electrostatic', assumptions: [
    'two_linear_isotropic_dielectrics', 'zero_free_volume_and_interface_charge',
    'bounded_domain', 'no_coupling', 'ideal_parallel_plate_no_fringing',
  ] },
  model: { projectRevision: 'cad-r1',
    domains: [
      { domainId: 'a', partId: 'part-a', bodyId: 'body-a',
        geometryDigest: digest({ geometry: 'a' }),
        shape: { kind: 'origin_aligned_rectangular_dielectric_layer',
          xMinM: 0, xMaxM: 0.0004, widthM: 0.01, heightM: 0.01,
          lengthUnit: 'm', longitudinalAxis: 'x', faces: aFace,
          interfaceSurfaceDigest: surfaceDigest } },
      { domainId: 'b', partId: 'part-b', bodyId: 'body-b',
        geometryDigest: digest({ geometry: 'b' }),
        shape: { kind: 'origin_aligned_rectangular_dielectric_layer',
          xMinM: 0.0004, xMaxM: 0.001, widthM: 0.01, heightM: 0.01,
          lengthUnit: 'm', longitudinalAxis: 'x', faces: bFace,
          interfaceSurfaceDigest: surfaceDigest } },
    ],
    interface: { kind: 'declared_conformal_planar_dielectric_interface',
      leftDomainId: 'a', leftFaceId: aFace.xMax, rightDomainId: 'b',
      rightFaceId: bFace.xMin, planeXM: 0.0004, areaM2: 0.0001,
      surfaceDigest, lengthUnit: 'm', areaUnit: 'm^2',
      normalFromLeftToRight: [1, 0, 0] },
  },
  materials: [
    { materialId: 'mat-a', domainId: 'a',
      model: 'homogeneous_linear_isotropic_dielectric',
      absolutePermittivityFPerM: 1.77083756256e-11, permittivityUnit: 'F/m',
      source: { kind: 'custom', reference: 'a', revision: 'r1' } },
    { materialId: 'mat-b', domainId: 'b',
      model: 'homogeneous_linear_isotropic_dielectric',
      absolutePermittivityFPerM: 5.31251268768e-11, permittivityUnit: 'F/m',
      source: { kind: 'custom', reference: 'b', revision: 'r1' } },
  ],
  prescribedPotentials: [
    { groupId: 'left', domainId: 'a', faceId: aFace.xMin,
      kind: 'prescribed_electric_potential', potentialV: 0, unit: 'V' },
    { groupId: 'right', domainId: 'b', faceId: bFace.xMax,
      kind: 'prescribed_electric_potential', potentialV: 100, unit: 'V' },
  ],
  lateralBoundary: { kind: 'zero_normal_electric_displacement',
    faces: [aFace, bFace].flatMap((faces, index) =>
      (['yMin', 'yMax', 'zMin', 'zMax'] as const).map(key =>
        ({ domainId: index === 0 ? 'a' : 'b', faceId: faces[key] }))) as any,
    normalElectricDisplacementCPerM2: 0, unit: 'C/m^2' },
  output: { axialPositionsM: [0, 0.0002, 0.0004, 0.0007, 0.001],
    units: { electricPotential: 'V', electricField: 'V/m',
      electricDisplacement: 'C/m^2', electrodeCharge: 'C',
      capacitance: 'F', electrostaticEnergy: 'J',
      electrostaticEnergyDensity: 'J/m^3' } },
});
const runtime = { providerId: 'tunacad-calculix-electrostatic-development',
  providerVersion: '0.1.0', engine: 'CalculiX', engineVersion: '2.16',
  executableDigest: digest({ executable: 'controlled-no-solver' }),
  nodeMajor: 24, platform: 'win32', architecture: 'x64' };
const evidence = { facetCount: 246, sharedNodeCount: 533, areaMm2: 100,
  sharedFacetDigest: digest({ facets: 'controlled' }),
  sharedNodeDigest: digest({ nodes: 'controlled' }) };
const meshDigest = digest({ mesh: 'controlled' });
const unsignedIdentity = {
  requestDigest: request.requestDigest, studyId: request.studyId,
  projectRevision: request.model.projectRevision,
  modelDigest: digest(request.model),
  domains: request.model.domains.map((d, i) => ({
    domainId: d.domainId, partId: d.partId, bodyId: d.bodyId,
    canonicalGeometryDigest: d.geometryDigest, faceDigest: digest(d.shape.faces),
    materialId: request.materials[i].materialId,
    absolutePermittivityFPerM: request.materials[i].absolutePermittivityFPerM,
    materialDigest: digest(request.materials[i]),
    provenanceDigest: digest(request.materials[i].source),
  })),
  electrodeDigest: digest(request.prescribedPotentials),
  electrodeFaceIds: request.prescribedPotentials.map(group => group.faceId),
  interfaceFaceIds: [request.model.interface.leftFaceId, request.model.interface.rightFaceId],
  nativeInterfaceDigest: surfaceDigest,
  localMeshDigests: [digest({ local: 'a' }), digest({ local: 'b' })],
  fragmentMeshDigest: meshDigest,
  conformalInterfaceEvidenceDigest: digest(evidence),
  deckDigest: digest({ deck: 'controlled' }), runtime,
};
const identity = { ...unsignedIdentity, sourceDigest: digest(unsignedIdentity) };
const source = { request, identity,
  verified: { meshDigest, interfaceEvidence: evidence,
    model: { nodes: Array.from({ length: 2956 }, () => [0, 0, 0]),
      volumeElements: { connectivity: Array.from({ length: 1641 }, () => []) } } },
  deck: '*HEAT TRANSFER, STEADY STATE' } as any;
const unsignedRecord = {
  schema: 'tunacad-electrostatic-two-layer-host-study/0.1',
  sourceIdentityVersion: ELECTROSTATIC_SOURCE_IDENTITY,
  configurationDigest: digest({ protected: true }), studyId: request.studyId,
  request, meshSizeMm: 1,
  localMeshes: request.model.domains.map(domain => ({
    requestDigest: request.requestDigest, projectRevision: request.model.projectRevision,
    geometryDigest: domain.geometryDigest,
    provenance: { adapterId: 'tunacad-gmsh-occt-fragment',
      engine: 'Gmsh', engineVersion: '4.15.2',
      optionsDigest: digest({ globalSizeMm: 1,
        sourceDigests: request.model.domains.map(d => d.geometryDigest) }),
      inputGeometryDigest: domain.geometryDigest },
  })),
  domains: request.model.domains.map((d, i) => ({
    domainId: d.domainId, partId: d.partId, bodyId: d.bodyId,
    projectRevision: request.model.projectRevision,
    canonicalGeometryDigest: d.geometryDigest, material: request.materials[i],
  })),
  electrodeFaceIds: identity.electrodeFaceIds,
  interfaceFaceIds: identity.interfaceFaceIds,
  validatedMesh: { fragmentMeshDigest: meshDigest, interfaceEvidence: evidence,
    nodes: 2956, elements: 1641, deckDigest: identity.deckDigest, runtime },
  binding: identity,
};
const recordDigest = digest(unsignedRecord);
const unsignedReceipt = {
  schema: 'tunacad-electrostatic-two-layer-live-preparation/0.1',
  sourceIdentityVersion: ELECTROSTATIC_SOURCE_IDENTITY,
  configurationDigest: unsignedRecord.configurationDigest,
  studyId: request.studyId, recordDigest,
  requestDigest: request.requestDigest, sourceDigest: identity.sourceDigest,
  fragmentMeshDigest: meshDigest, conformityEvidenceDigest: digest(evidence),
};
const receipt = { ...unsignedReceipt, receiptDigest: digest(unsignedReceipt) };
function rejects(label: string, mutate: (input: any) => void) {
  const item = { receipt: structuredClone(receipt), recordDigest,
    record: structuredClone(unsignedRecord), source: structuredClone(source) };
  mutate(item);
  // A fresh binder would seal a changed source identity again. Rehash it so
  // stale-domain/runtime/mesh cases cannot pass merely by tripping the
  // preliminary malformed-digest check.
  const { sourceDigest: _old, ...unsigned } = item.source.identity;
  item.source.identity.sourceDigest = digest(unsigned);
  assert.throws(() => verifyTwoLayerHostAdmission(
    item.receipt, item.recordDigest, item.record, item.source), undefined, label);
}

test('fresh controlled protected identity passes exact-scope no-solver admission comparison', () => {
  assert.equal(verifyTwoLayerHostAdmission(receipt as any, recordDigest,
    unsignedRecord, source).sourceDigest, identity.sourceDigest);
});
test('stale and altered protected sources fail closed', () => {
  rejects('revision', item => { item.source.identity.projectRevision = 'cad-r2'; });
  rejects('material', item => { item.source.identity.domains[1].absolutePermittivityFPerM *= 2; });
  rejects('electrode FACE', item => { item.source.identity.electrodeFaceIds[0] = 'wrong'; });
  rejects('interface FACE', item => { item.source.identity.interfaceFaceIds[1] = 'wrong'; });
  rejects('source geometry', item => { item.source.identity.domains[0].canonicalGeometryDigest = digest({ substitute: true }); });
  rejects('mesh', item => { item.source.verified.meshDigest = digest({ substitute: true }); });
  rejects('independently meshed interface', item => {
    item.record.localMeshes[1].provenance.adapterId = 'independent-gmsh';
  });
  rejects('nonconformal facets', item => { item.source.verified.interfaceEvidence.facetCount = 0; });
  rejects('incomplete area', item => { item.source.verified.interfaceEvidence.areaMm2 = 99; });
  rejects('runtime', item => { item.source.identity.runtime.providerId = 'other'; });
  rejects('provider executable', item => { item.source.identity.runtime.executableDigest = digest({ other: true }); });
  rejects('unsupported physics', item => { item.source.request.analysis.type = 'thermal'; });
  rejects('fixture-owned missing receipt', item => { item.receipt.schema = 'fixture'; });
  rejects('unprotected record', item => { item.record.schema = 'caller-json'; });
  rejects('changed record', item => { item.record.validatedMesh.deckDigest = digest({ other: true }); });
  rejects('changed receipt', item => { item.receipt.recordDigest = digest({ other: true }); });
});
test('private facade cannot dispatch fixture or unprotected input', async () => {
  let dispatches = 0;
  const storage = { async assertReady() { throw new Error('UNPROTECTED_STORAGE'); },
    paths: { 'source-catalog': 'C:\\invalid' } } as any;
  const admission = new HostTwoLayerProviderAdmission(storage, {} as any,
    async () => runtime, { async execute() { dispatches++; throw new Error('BYPASS'); } });
  await assert.rejects(() => admission.submit(request.studyId), /UNPROTECTED_STORAGE/);
  assert.equal(dispatches, 0);
  assert.equal('execute' in admission, false);
  assert.equal('lifecycle' in admission, false);
});
test('protected preparation receipt replays and missing host record cannot dispatch', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'two-layer-host-admission-'));
  try {
    const storage = await ElectrostaticHostStorage.provisionNew(join(parent, 'protected'));
    let dispatches = 0;
    const admission = new HostTwoLayerProviderAdmission(storage, {} as any,
      async () => runtime, { async execute() { dispatches++; throw new Error('BYPASS'); } });
    await assert.rejects(() => admission.submit(request.studyId),
      'protected storage without live-preparation receipt must not admit fixture-owned work');
    assert.equal(dispatches, 0);
    const persisted = { ...unsignedReceipt,
      configurationDigest: storage.configurationDigest };
    const receiptForStorage = { ...persisted, receiptDigest: digest(persisted) };
    await writeElectrostaticHostOnce(
      liveTwoLayerPreparationReceiptPath(storage, request.studyId),
      receiptForStorage, 4096);
    assert.deepEqual(await readLiveTwoLayerPreparationReceipt(storage, request.studyId), receiptForStorage);
    await assert.rejects(() => admission.submit(request.studyId));
    assert.equal(dispatches, 0, 'receipt without immutable study pin must not dispatch');
    const names = (await readdir(storage.paths['source-catalog']))
      .filter(name => name.endsWith('.preparation.json'));
    assert.equal(names.length, 1);
    const path = join(storage.paths['source-catalog'], names[0]);
    const altered = JSON.parse(await readFile(path, 'utf8'));
    altered.fragmentMeshDigest = digest({ tampered: true });
    await writeFile(path, JSON.stringify(altered));
    await assert.rejects(() => readLiveTwoLayerPreparationReceipt(storage, request.studyId));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
