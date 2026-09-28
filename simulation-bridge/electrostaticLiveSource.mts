import { electrostaticFoundationSchema, type ElectrostaticFoundation } from './electrostaticContract.mts';
import type { TrustedElectrostaticSourceReader } from './electrostaticAdmission.mts';
import type { NeutralFemMesh } from '../src/simulation/externalSimulationContracts.ts';
import { electrostaticStepGeometryDigest } from './electrostaticStepIdentity.mts';

/** Host-owned study/mesh/runtime records; never constructed from client JSON.
 * Domain bindings are independently looked up, not copied from a request. */
export interface ElectrostaticHostRecords {
  readSealedRequest(studyId: string): Promise<unknown>;
  readDomainBinding(studyId: string, domainId: string): Promise<{
    domainId: string; partId: string; bodyId: string; projectRevision: string;
  } | null>;
  readValidatedMesh(studyId: string): Promise<NeutralFemMesh>;
  readCurrentRuntimeIdentity(): Promise<unknown>;
}
export interface ElectrostaticCadReaders {
  getProjectRevision(): Promise<string>;
  inspectBody(bodyId: string): Promise<unknown>;
  readPartMaterial(partId: string): Promise<unknown>;
  resolveFace(partId: string, faceId: string): Promise<unknown>;
  exportGeometry(bodyId: string): Promise<Uint8Array>;
}

/** Same canonical encoding/hash as existing Bridge sealing, via WebCrypto so
 * the live TunaCAD reader never imports node:crypto into a browser bundle. */
export async function electrostaticBrowserDigest(value: unknown): Promise<string> {
  const serialize = (item: unknown): string => {
    if (item === null || typeof item !== 'object') return JSON.stringify(item);
    if (Array.isArray(item)) return '[' + item.map(serialize).join(',') + ']';
    return '{' + Object.entries(item).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => JSON.stringify(key) + ':' + serialize(entry)).join(',') + '}';
  };
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialize(value)));
  return 'sha256:' + Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
function fail(detail: string): never { throw new Error('ELECTROSTATIC_LIVE_SOURCE_INVALID: ' + detail); }
function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('missing trusted object');
  return value as Record<string, any>;
}
function near(actual: unknown, expected: number) {
  // CAD inspection matching only; electrical numerical tolerances unchanged.
  if (typeof actual !== 'number' || !Number.isFinite(actual)
    || Math.abs(actual - expected) > Math.max(1e-7, Math.abs(expected) * 1e-7)) fail('slab geometry mismatch');
}
function vector(actual: unknown, expected: number[]) {
  if (!Array.isArray(actual) || actual.length !== 3) fail('missing geometry vector');
  actual.forEach((value, axis) => near(value, expected[axis]));
}

/** Provider-closed source reader. Revalidation on every request/mesh read is
 * reusable by preparation, approval and existing immutable completion checks.
 * It does not approve, submit, export to a provider, or expose an MCP tool. */
export class ElectrostaticLiveSourceReader implements TrustedElectrostaticSourceReader {
  private readonly records: ElectrostaticHostRecords;
  private readonly cad: ElectrostaticCadReaders;
  constructor(records: ElectrostaticHostRecords, cad: ElectrostaticCadReaders) {
    this.records = records; this.cad = cad;
  }
  async readCurrentProjectRevision(_studyId: string) { return this.cad.getProjectRevision(); }
  async readCurrentRuntimeIdentity() { return this.records.readCurrentRuntimeIdentity(); }
  async readSealedRequest(studyId: string): Promise<ElectrostaticFoundation> {
    const before = await this.cad.getProjectRevision();
    const request = electrostaticFoundationSchema.parse(await this.records.readSealedRequest(studyId));
    const { requestDigest, ...unsigned } = request;
    if (request.studyId !== studyId || request.model.projectRevision !== before
      || await electrostaticBrowserDigest(unsigned) !== requestDigest) fail('sealed request/revision mismatch');
    const domain = request.model.domains[0];
    const binding = await this.records.readDomainBinding(studyId, domain.domainId);
    if (!binding || binding.domainId !== domain.domainId || binding.partId !== domain.partId
      || binding.bodyId !== domain.bodyId || binding.projectRevision !== before) fail('domain no longer bound');
    const body = object(await this.cad.inspectBody(domain.bodyId));
    if (body.bodyId !== domain.bodyId || body.ownerPartId !== domain.partId || body.projectRevision !== before
      || body.shapeType !== 'solid' || body.isValid !== true || body.solidCount !== 1
      || body.connectedComponentCount !== 1 || body.faceCount !== 6
      || body.closed !== true || body.manifold !== true) fail('body identity/topology mismatch');
    const slab = domain.shape;
    const sizes = [slab.lengthM, slab.widthM, slab.heightM].map(value => value * 1000);
    const bounds = object(body.boundingBox);
    vector(bounds.min, [0, 0, 0]); vector(bounds.max, sizes); vector(bounds.size, sizes);
    near(body.volume, sizes[0] * sizes[1] * sizes[2]);
    near(body.surfaceArea, 2 * (sizes[0] * sizes[1] + sizes[1] * sizes[2] + sizes[0] * sizes[2]));
    const assignment = object(await this.cad.readPartMaterial(domain.partId));
    if (assignment.projectRevision !== before || assignment.identity?.componentId !== domain.partId
      || assignment.identity?.definitionId !== domain.partId) fail('material definition/revision mismatch');
    const material = object(assignment.engineeringMaterial);
    const dielectric = object(material.dielectric);
    if (Object.keys(dielectric).sort().join(',') !== 'absolutePermittivityFPerM,model,permittivityUnit'
      || material.libraryId !== request.material.materialId
      || dielectric.model !== request.material.model
      || dielectric.permittivityUnit !== request.material.permittivityUnit
      || dielectric.absolutePermittivityFPerM !== request.material.absolutePermittivityFPerM
      || material.revision !== request.material.source.revision
      || material.source !== request.material.source.reference
      || (material.custom === true ? 'custom' : 'library') !== request.material.source.kind) fail('dielectric/provenance mismatch');
    const faces = Object.entries(slab.faces);
    if (!body.nativeTopology) fail('unique topology evidence missing');
    const topology = object(body.nativeTopology);
    if (topology.method !== 'TopExp.MapShapes+MapShapesAndAncestors'
      || !Array.isArray(topology.faces) || topology.faces.length !== faces.length
      || !Array.isArray(topology.edges) || topology.edges.length > 64) fail('unique topology evidence missing');
    const semanticNativeFaces: number[] = [];
    for (const [index, [, faceId]] of faces.entries()) {
      const response = object(await this.cad.resolveFace(domain.partId, faceId));
      if (response.projectRevision !== before || response.context?.ownerId !== domain.partId
        || !Array.isArray(response.references) || response.references.length !== 1) fail('missing/ambiguous FACE');
      const face = object(response.references[0]); const resolution = object(face.resolution);
      if (face.id !== faceId || face.ownerId !== domain.partId || face.sourceFeatureId !== domain.bodyId
        || face.geometryKind !== 'FACE' || resolution.state !== 'valid' || resolution.candidateCount !== 1
        || resolution.lastSuccessfullyResolvedProjectRevision !== before
        || resolution.resolved?.sourceFeatureId !== domain.bodyId
        || resolution.resolved?.geometryType !== 'plane') fail('FACE ownership/revision mismatch');
      const signature = object(resolution.resolved?.signature);
      if (signature.shapeType !== 'FACE') fail('FACE signature kind mismatch');
      const axis = Math.floor(index / 2); const upper = index % 2 === 1;
      const center = sizes.map(value => value / 2); center[axis] = upper ? sizes[axis] : 0;
      const direction = [0, 0, 0]; direction[axis] = upper ? 1 : -1;
      vector(signature.centroid, center); vector(signature.dir, direction);
      near(signature.measure, sizes[(axis + 1) % 3] * sizes[(axis + 2) % 3]);
      const nativeMatches = topology.faces.flatMap((candidate: any, nativeIndex: number) => {
        const s = candidate?.signature;
        return s?.shapeType === 'FACE' && s.kind === signature.kind
          && Array.isArray(s.centroid) && s.centroid.length === 3 && Array.isArray(s.dir) && s.dir.length === 3
          && s.centroid.every((value: number, axis: number) => Number.isFinite(value)
            && Math.abs(value - signature.centroid[axis]) <= 1e-7)
          && s.dir.every((value: number, axis: number) => Number.isFinite(value)
            && Math.abs(value - signature.dir[axis]) <= 1e-7)
          && Number.isFinite(s.measure) && Math.abs(s.measure - signature.measure) <= 1e-7
          ? [nativeIndex + 1] : [];
      });
      if (nativeMatches.length !== 1 || semanticNativeFaces.includes(nativeMatches[0])) fail('native FACE identity mismatch');
      semanticNativeFaces.push(nativeMatches[0]);
    }
    // Six quadrilateral faces: each use belongs to one unique edge; each edge
    // joins exactly two distinct faces. Derive counts from incidence, not 24/2.
    let uses = 0;
    for (const [index, face] of topology.faces.entries()) {
      if (!Array.isArray(face.edgeIndices) || face.edgeIndices.length !== 4
        || new Set(face.edgeIndices).size !== 4) fail('slab face-edge incidence mismatch');
      uses += face.edgeIndices.length;
      for (const edgeIndex of face.edgeIndices) {
        const edge = topology.edges[edgeIndex - 1];
        if (!Number.isSafeInteger(edgeIndex) || edgeIndex < 1 || !edge
          || edge.index !== edgeIndex || !Array.isArray(edge.faceIndices)
          || edge.faceIndices.length !== 2 || new Set(edge.faceIndices).size !== 2
          || !edge.faceIndices.includes(index + 1)) fail('unique edge adjacency mismatch');
      }
    }
    if (topology.uniqueEdgeCount !== topology.edges.length || topology.edgeUseCount !== uses
      || body.edgeCount !== uses || topology.edges.length * 2 !== uses) fail('edge count semantics mismatch');
    for (let i = 0; i < faces.length; i++) for (let j = i + 1; j < faces.length; j++) {
      const shared = topology.edges.filter((edge: any) =>
        edge.faceIndices.includes(semanticNativeFaces[i]) && edge.faceIndices.includes(semanticNativeFaces[j])).length;
      if (shared !== (Math.floor(i / 2) === Math.floor(j / 2) ? 0 : 1)) fail('slab FACE adjacency mismatch');
    }
    const bytes = await this.cad.exportGeometry(domain.bodyId);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > 32 * 1024 * 1024) fail('geometry export missing/oversize');
    // Versioned narrow provenance normalization; all other STEP content remains
    // digest-bound, alongside independent native topology/material/revision.
    if (await electrostaticStepGeometryDigest(bytes) !== domain.geometryDigest) fail('geometry digest mismatch');
    const after = await this.cad.getProjectRevision();
    if (after !== before) fail('source changed during trusted read');
    return structuredClone(request);
  }
  async readValidatedMesh(studyId: string) {
    const before = await this.readSealedRequest(studyId);
    const mesh = structuredClone(await this.records.readValidatedMesh(studyId));
    const after = await this.readSealedRequest(studyId);
    if (after.requestDigest !== before.requestDigest || mesh.projectRevision !== before.model.projectRevision
      || mesh.requestDigest !== before.requestDigest || mesh.geometryDigest !== before.model.domains[0].geometryDigest) fail('mesh source mismatch');
    return mesh;
  }
}
