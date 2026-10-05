import type { ExplicitDynamicsRequest } from '../../simulation-bridge/explicitDynamicsFoundation.mts';
import { explicitWaveSpeedsMmPerS, validateExplicitDynamics }
  from '../../simulation-bridge/explicitDynamicsFoundation.mts';
import { digest } from '../../simulation-bridge/stableDigest.mts';
import type {ExplicitStepTopology} from '../gmsh/ExplicitStepTopology.mts';

export interface ExplicitC3D4Mesh {
  runtime: 'Gmsh 4.15.2';
  inputGeometryDigest: string;
  nodes: Array<{ id: number; xyzMm: [number, number, number] }>;
  elements: Array<{ id: number; type: 'C3D4'; nodes: [number, number, number, number] }>;
  surfaceTriangles: Array<{ id: number; nodes: [number, number, number];entityTag?:number }>;
  curveSegments?:Array<{id:number;nodes:[number,number];entityTag:number}>;
  cadEvidence?:{topology:ExplicitStepTopology;stepByteDigest:string;metadataDigest:string};
}

function invalid(reason: string): never {
  throw new Error('EXPLICIT_MESH_ADMISSION_INVALID: ' + reason);
}
const cross = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a: number[]) => Math.hypot(...a);
const subtract = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);

/** CalculiX 2.16 calcstabletimeincvol.f, C3D4, ALPHA=0, no damping:
 * volume=weight3d4*xsj/3 = V/3; area=A; h=V/(3*Amax)=altitude/9;
 * critom/2=0.98; provider's final safefac=0.80. */
export function calculix216C3D4CriticalStepS(
  minimumAltitudeMm: number, governingWaveSpeedMmPerS: number,
) {
  if (!Number.isFinite(minimumAltitudeMm) || minimumAltitudeMm <= 0
    || !Number.isFinite(governingWaveSpeedMmPerS) || governingWaveSpeedMmPerS <= 0)
    invalid('invalid CalculiX 2.16 C3D4 CFL inputs');
  return 0.80 * 0.98 * (minimumAltitudeMm / 9) / governingWaveSpeedMmPerS;
}

export function assertCalculiX216ExplicitFixedStep(
  selectedS: number, providerCriticalS: number, admissionMargin: number,
  durationS: number, maximumIncrements: number,
) {
  if (!Number.isFinite(selectedS) || selectedS <= 0
    || !Number.isFinite(providerCriticalS) || providerCriticalS <= 0
    || !Number.isFinite(admissionMargin) || admissionMargin <= 0
    || admissionMargin > 0.8 || !Number.isFinite(durationS) || durationS <= 0
    || !Number.isSafeInteger(maximumIncrements) || maximumIncrements <= 0
    || selectedS >= providerCriticalS
    || selectedS > providerCriticalS * admissionMargin * (1 + 1e-12)
    || Math.ceil(durationS / selectedS) > Math.min(20_000, maximumIncrements))
    invalid('fixed step exceeds CalculiX 2.16 CFL or increment budget');
}

/** Provider-private gate over parsed Gmsh output. It never trusts the
 * contract's declared characteristic length as the actual mesh minimum. */
export function assessExplicitC3D4Geometry(requestValue: unknown, mesh: ExplicitC3D4Mesh,
  selections?:{fixed:{facetIndices:number[]};loaded:{facetIndices:number[]}}) {
  const request = validateExplicitDynamics(requestValue);
  if (mesh.runtime !== 'Gmsh 4.15.2'
    || mesh.inputGeometryDigest !== request.model.geometryDigest)
    invalid('mesh runtime/source mismatch');
  if (!mesh.nodes.length || !mesh.elements.length
    || mesh.nodes.length > request.mesh.maximumNodes
    || mesh.elements.length > request.mesh.maximumElements)
    invalid('mesh node/element resource bound');
  const nodes = new Map<number, [number, number, number]>();
  for (const node of mesh.nodes) {
    if (!Number.isSafeInteger(node.id) || node.id <= 0 || nodes.has(node.id)
      || node.xyzMm.length !== 3 || node.xyzMm.some(value => !Number.isFinite(value)))
      invalid('malformed or duplicate node');
    nodes.set(node.id, node.xyzMm);
  }
  const seen = new Set<string>(), elementIds = new Set<number>();
  const facetUses = new Map<string, number>();
  const nodalMassKg = new Map<number, number>([...nodes.keys()].map(id => [id, 0]));
  let minimumAltitudeMm = Infinity, minimumVolumeMm3 = Infinity, totalVolumeMm3 = 0;
  for (const element of mesh.elements) {
    if (element.type !== 'C3D4' || !Number.isSafeInteger(element.id) || element.id <= 0
      || element.nodes.length !== 4 || new Set(element.nodes).size !== 4
      || element.nodes.some(node => !nodes.has(node))) invalid('unsupported or malformed tetrahedron');
    const key = [...element.nodes].sort((a, b) => a - b).join(',');
    if (seen.has(key) || elementIds.has(element.id)) invalid('duplicate tetrahedron');
    seen.add(key); elementIds.add(element.id);
    for (let opposite = 0; opposite < 4; opposite++) {
      const facet = element.nodes.filter((_, index) => index !== opposite)
        .sort((a, b) => a - b).join(',');
      facetUses.set(facet, (facetUses.get(facet) ?? 0) + 1);
    }
    const [a, b, c, d] = element.nodes.map(node => nodes.get(node)!);
    const ab = subtract(b, a), ac = subtract(c, a), ad = subtract(d, a);
    const signedVolume = cross(ab, ac).reduce((sum, v, i) => sum + v * ad[i], 0) / 6;
    if (!Number.isFinite(signedVolume) || signedVolume <= 1e-9)
      invalid('nonpositive or degenerate C3D4 Jacobian');
    const areas = [
      length(cross(subtract(c, b), subtract(d, b))) / 2,
      length(cross(ac, ad)) / 2,
      length(cross(ab, ad)) / 2,
      length(cross(ab, ac)) / 2,
    ];
    const altitude = 3 * signedVolume / Math.max(...areas);
    if (!Number.isFinite(altitude) || altitude < 0.01)
      invalid('element quality prevents a trustworthy CFL length');
    minimumAltitudeMm = Math.min(minimumAltitudeMm, altitude);
    minimumVolumeMm3 = Math.min(minimumVolumeMm3, signedVolume);
    totalVolumeMm3 += signedVolume;
    const elementMassKg = signedVolume * request.material.densityKgM3 * 1e-9;
    if (!Number.isFinite(elementMassKg) || elementMassKg <= 0)
      invalid('nonpositive or nonfinite element mass');
    for (const id of element.nodes)
      nodalMassKg.set(id, nodalMassKg.get(id)! + elementMassKg / 4);
  }
  if ([...nodalMassKg.values()].some(mass => !Number.isFinite(mass) || mass <= 0))
    invalid('unused node or invalid lumped nodal mass');
  const expectedVolumeMm3 = request.model.cad?.volumeMm3??request.model.lengthMm * request.model.widthMm * request.model.heightMm;
  // Existing neutral FEM policy permits <=5% linear CAD discretization error.
  // Preserve the exact-volume legacy rectangular reference gate unchanged.
  const volumeTolerance=request.model.kind==='single_solid_cad'?.05:1e-5;
  if (Math.abs(totalVolumeMm3 - expectedVolumeMm3) > expectedVolumeMm3 * volumeTolerance)
    invalid('mesh volume does not match the bounded bar');
  const meshMassKg = [...nodalMassKg.values()].reduce((sum, mass) => sum + mass, 0);
  const expectedMassKg = expectedVolumeMm3 * request.material.densityKgM3 * 1e-9;
  if (!Number.isFinite(meshMassKg)
    || Math.abs(meshMassKg - expectedMassKg) > expectedMassKg * volumeTolerance)
    invalid('lumped mesh mass does not match the bounded bar');
  let minimumNodalMassKg = Infinity, maximumNodalMassKg = 0;
  for (const mass of nodalMassKg.values()) {
    minimumNodalMassKg = Math.min(minimumNodalMassKg, mass);
    maximumNodalMassKg = Math.max(maximumNodalMassKg, mass);
  }
  const faceArea = (xMm: number,indices?:number[]) => {
    const keys = new Set<string>();
    const owned = new Set<number>();
    let area = 0, count = 0;
    for (const [index,face] of mesh.surfaceTriangles.entries()) {
      if (!Number.isSafeInteger(face.id) || face.id <= 0
        || face.nodes.length !== 3 || new Set(face.nodes).size !== 3
        || face.nodes.some(node => !nodes.has(node))) invalid('malformed surface facet');
      const key = [...face.nodes].sort((a, b) => a - b).join(',');
      if (keys.has(key)) invalid('duplicate surface facet');
      if (facetUses.get(key) !== 1) invalid('surface facet is not an owned boundary facet');
      keys.add(key);
      const points = face.nodes.map(node => nodes.get(node)!);
      if (indices?!indices.includes(index):!points.every(point => Math.abs(point[0] - xMm) <= 1e-7)) continue;
      area += length(cross(subtract(points[1], points[0]),
        subtract(points[2], points[0]))) / 2;
      face.nodes.forEach(node => owned.add(node));
      count++;
    }
    return { areaMm2: area, facetCount: count,
      nodeIds: [...owned].sort((a, b) => a - b) };
  };
  if(request.model.kind==='single_solid_cad'&&!selections)invalid('CAD FACE mapping required');
  const fixed = faceArea(0,selections?.fixed.facetIndices), loaded = faceArea(request.model.lengthMm,selections?.loaded.facetIndices);
  const expectedAreaMm2 = request.model.widthMm * request.model.heightMm;
  if (!fixed.facetCount || !loaded.facetCount
    || !selections&&Math.abs(fixed.areaMm2 - expectedAreaMm2) > expectedAreaMm2 * 1e-6
    || !selections&&Math.abs(loaded.areaMm2 - expectedAreaMm2) > expectedAreaMm2 * 1e-6
    || !selections&&fixed.nodeIds.some(node => loaded.nodeIds.includes(node)))
    invalid('fixed/load FACE mapping or area mismatch');
  return {
    meshDigest: digest(mesh), nodeCount: mesh.nodes.length, elementCount: mesh.elements.length,
    minimumVolumeMm3, totalVolumeMm3, expectedVolumeMm3, meshMassKg, expectedMassKg,
    minimumNodalMassKg, maximumNodalMassKg, materialAssignedElementCount: elementIds.size,
    minimumCharacteristicLengthMm: minimumAltitudeMm, fixedFace: fixed, loadedFace: loaded,
  };
}

/** CalculiX-specific stability remains separate from shared geometric admission.
 * OpenRadioss capture must not apply this provider's critical-step formula. */
export function assessExplicitC3D4Mesh(requestValue: unknown, mesh: ExplicitC3D4Mesh) {
  const request = validateExplicitDynamics(requestValue);
  const geometry = assessExplicitC3D4Geometry(request, mesh);
  const minimumAltitudeMm = geometry.minimumCharacteristicLengthMm;
  const wave = explicitWaveSpeedsMmPerS(request.material.youngsModulusMPa,
    request.material.poissonRatio, request.material.densityKgM3);
  const legacyAltitudeCflS = request.analysis.integration.safetyFactor
    * minimumAltitudeMm / wave.dilatationalMmPerS;
  const providerCriticalTimeStepS = calculix216C3D4CriticalStepS(
    minimumAltitudeMm, wave.dilatationalMmPerS);
  // The request's bounded safetyFactor (<=0.8) is an additional admission
  // margin below the installed provider's own 0.80-scaled critical step.
  const trustedStabilityLimitS = request.analysis.integration.safetyFactor
    * providerCriticalTimeStepS;
  const candidateS = Math.min(request.analysis.integration.maximumTimeStepS,
    trustedStabilityLimitS);
  const incrementCount = Math.ceil(request.analysis.durationS / candidateS);
  if (!Number.isFinite(candidateS) || candidateS <= 0
    || incrementCount > Math.min(20_000, request.analysis.integration.maximumIncrements))
    invalid('actual-mesh CFL requires excessive increments');
  const selectedTimeStepS = request.analysis.durationS / incrementCount;
  assertCalculiX216ExplicitFixedStep(selectedTimeStepS, providerCriticalTimeStepS,
    request.analysis.integration.safetyFactor, request.analysis.durationS,
    request.analysis.integration.maximumIncrements);
  return {
    ...geometry,
    axialWaveSpeedMmPerS: wave.axialMmPerS,
    governingWaveSpeedMmPerS: wave.dilatationalMmPerS,
    providerCharacteristicLengthMm: minimumAltitudeMm / 9,
    providerCriticalTimeStepS, legacyAltitudeCflS,
    providerAdmissionMargin: request.analysis.integration.safetyFactor,
    trustedStabilityLimitS, selectedTimeStepS, incrementCount,
    durationS: request.analysis.durationS,
    massScalingPermitted: false as const,
  };
}
