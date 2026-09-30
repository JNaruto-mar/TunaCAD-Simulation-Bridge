import type { NeutralFemModelV2 } from '../../src/simulation/externalSimulationContracts.ts';
import { quadraticTetraVolumeSamples } from '../../src/simulation/neutralFemMesh.ts';
import { validateElectrostaticTwoLayer } from '../../simulation-bridge/electrostaticTwoLayerFoundation.mts';
import { twoLayerSeriesCapacitorReference } from '../../simulation-bridge/electrostaticTwoLayerFoundation.mts';
import { VACUUM_PERMITTIVITY_F_PER_M } from '../../simulation-bridge/electrostaticFoundation.mts';
import { digest } from '../../simulation-bridge/stableDigest.mts';
import { neutralToCalculiXC3D10 } from './CalculiXMultiDomainDeck.mts';
import { verifyAndComposeTwoLayerMesh } from '../gmsh/ElectrostaticTwoLayerMesh.mts';

export const ELECTROSTATIC_TWO_LAYER_LIMITS = Object.freeze({
  maximumNodes: 16000, maximumElements: 8000, maximumOutputBytes: 16 * 1024 * 1024,
  potentialToleranceV: 0.02, fieldRelativeTolerance: 0.002,
  chargeRelativeTolerance: 0.002, energyRelativeTolerance: 0.002,
});
const fail = (why: string): never => { throw new Error('ELECTROSTATIC_TWO_LAYER_OUTPUT_INVALID: ' + why); };
const num = (value: number) => Number(value.toPrecision(15)).toString();
const lines = (indices: number[]) => Array.from({ length: Math.ceil(indices.length / 16) },
  (_, row) => indices.slice(row * 16, row * 16 + 16).map(i => i + 1).join(','));
const near = (a: number, b: number, relative: number, floor: number, label: string) => {
  if (!Number.isFinite(a) || Math.abs(a - b) > Math.max(Math.abs(b) * relative, floor))
    fail(label + ' (actual=' + a + ', expected=' + b + ')');
};
type Vector = [number, number, number];
const subtract = (a: number[], b: number[]) => a.map((v, i) => v - b[i]) as Vector;
const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a: number[], b: number[]): Vector =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const tetEdges = [[0, 1], [1, 2], [2, 0], [0, 3], [2, 3], [1, 3]];
function basis(model: NeutralFemModelV2, cell: number[]) {
  const p = model.nodes[cell[0]], a = subtract(model.nodes[cell[1]], p);
  const b = subtract(model.nodes[cell[2]], p), c = subtract(model.nodes[cell[3]], p);
  const determinant = dot(a, cross(b, c));
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-18) fail('degenerate tetrahedron');
  return { p, gradients: [cross(b, c), cross(c, a), cross(a, b)]
    .map(v => v.map(x => x / determinant) as Vector) };
}
function electrodeNodes(model: NeutralFemModelV2, faceId: string) {
  const regions = model.boundaryRegions.filter(r =>
    r.semanticReferenceIds.length === 1 && r.semanticReferenceIds[0] === faceId);
  if (regions.length !== 1 || !regions[0].facetIndices.length) fail('missing electrode FACE');
  return [...new Set(regions[0].facetIndices.flatMap(i =>
    model.boundaryFacets.connectivity[i]))].sort((a, b) => a - b);
}
function assertMesh(request: ReturnType<typeof validateElectrostaticTwoLayer>,
  model: NeutralFemModelV2, meshDigest: string, evidence: { facetCount: number; sharedNodeCount: number }) {
  if (model.requestDigest !== request.requestDigest || model.projectRevision !== request.model.projectRevision
    || model.modelDigest !== digest(request.model) || model.element.geometryOrder !== 2
    || model.nodes.length > ELECTROSTATIC_TWO_LAYER_LIMITS.maximumNodes
    || model.volumeElements.connectivity.length > ELECTROSTATIC_TWO_LAYER_LIMITS.maximumElements
    || evidence.facetCount < 1 || evidence.sharedNodeCount < 6
    || !/^sha256:[a-f0-9]{64}$/.test(meshDigest)) fail('unverified bound two-domain mesh');
}

/** Private scalar analogy: native temperature = V; k_i = eps_i/eps0.
 * HFL_i = k_i E_i/1000; RFL*eps0/1000 = electrode C. */
export function createCalculiXElectrostaticTwoLayerDeck(value: unknown,
  verified: ReturnType<typeof verifyAndComposeTwoLayerMesh>) {
  // The full strict runtime parse is authoritative. Zod's fixed tuple indexed
  // dynamically is inferred as unknown by this isolated compiler invocation.
  const r = validateElectrostaticTwoLayer(value) as any;
  const { model, meshDigest, interfaceEvidence } = verified;
  assertMesh(r, model, meshDigest, interfaceEvidence);
  const left = electrodeNodes(model, r.prescribedPotentials[0].faceId);
  const right = electrodeNodes(model, r.prescribedPotentials[1].faceId);
  if (left.some(node => right.includes(node))) fail('overlapping electrodes');
  const deck = [
    '*HEADING', 'TunaCAD provider-only two-layer dielectric scalar analogy',
    '*NODE, NSET=NALL',
    ...model.nodes.map((point, node) => String(node + 1) + ',' + point.map(num).join(',')),
    '*ELEMENT, TYPE=DC3D10, ELSET=EALL',
    ...model.volumeElements.connectivity.map((cell, element) =>
      String(element + 1) + ',' + neutralToCalculiXC3D10(cell).map(node => node + 1).join(',')),
    ...model.domainRegions.flatMap((domain, index) => [
      '*ELSET, ELSET=LAYER_' + (index + 1),
      ...lines(domain.elementIndices).map(row => row),
      '*MATERIAL, NAME=DIELECTRIC_' + (index + 1),
      '*CONDUCTIVITY',
      num(r.materials[index].absolutePermittivityFPerM / VACUUM_PERMITTIVITY_F_PER_M),
      '*SOLID SECTION, ELSET=LAYER_' + (index + 1) + ', MATERIAL=DIELECTRIC_' + (index + 1),
    ]),
    '*NSET, NSET=ELECTRODE_LEFT', ...lines(left),
    '*NSET, NSET=ELECTRODE_RIGHT', ...lines(right),
    '*STEP', '*HEAT TRANSFER, STEADY STATE', '1,1',
    '*BOUNDARY',
    'ELECTRODE_LEFT,11,11,' + num(r.prescribedPotentials[0].potentialV),
    'ELECTRODE_RIGHT,11,11,' + num(r.prescribedPotentials[1].potentialV),
    '*NODE PRINT, NSET=NALL', 'NT',
    '*NODE PRINT, NSET=ELECTRODE_LEFT', 'RFL',
    '*NODE PRINT, NSET=ELECTRODE_RIGHT', 'RFL',
    '*EL PRINT, ELSET=EALL', 'HFL', '*END STEP',
  ].join('\n') + '\n';
  return { deck, deckDigest: digest(deck), meshDigest, interfaceEvidence };
}

/** All native rows, frame identity, electrode ownership and per-domain fields
 * must be complete before a normalized electrical result is constructed. */
export function recoverCalculiXElectrostaticTwoLayer(value: unknown,
  verified: ReturnType<typeof verifyAndComposeTwoLayerMesh>, raw: string) {
  const r = validateElectrostaticTwoLayer(value) as any, analytical = twoLayerSeriesCapacitorReference(r);
  const { model, meshDigest, interfaceEvidence } = verified;
  assertMesh(r, model, meshDigest, interfaceEvidence);
  if (Buffer.byteLength(raw, 'utf8') > ELECTROSTATIC_TWO_LAYER_LIMITS.maximumOutputBytes)
    fail('native output byte limit');
  const potentials = new Map<number, number>(), flux = new Map<string, Vector>();
  const reaction = [new Map<number, number>(), new Map<number, number>()];
  const expectedElectrodeNodes = r.prescribedPotentials.map(e => electrodeNodes(model, e.faceId));
  const blocks = new Set<string>();
  let mode: 'potential' | 'flux' | 'reaction' | null = null, electrode = -1;
  for (const record of raw.split(/\r?\n/)) {
    if (record.length > 4096) fail('oversize native row');
    const row = record.trim();
    if (!row) continue;
    const header = /^(temperatures(?:\s*\([^)]*\))?|heat generation(?:\s*\([^)]*\))?|heat flux\s*\([^)]*\))\s+for set\s+([A-Z0-9_]+)\s+and time\s+([0-9.EeDd+-]+)$/i.exec(row);
    if (header) {
      const kind = header[1].toLowerCase(), set = header[2].toUpperCase();
      if (Number(header[3].replace(/[dD]/g, 'E')) !== 1
        || blocks.has(set + ':' + kind)) fail('wrong/duplicate native frame or block');
      blocks.add(set + ':' + kind);
      electrode = ['ELECTRODE_LEFT', 'ELECTRODE_RIGHT'].indexOf(set);
      if (kind.startsWith('temperatures') && set === 'NALL') mode = 'potential';
      else if (kind.startsWith('heat flux') && set === 'EALL') mode = 'flux';
      else if (kind.startsWith('heat generation') && electrode >= 0) mode = 'reaction';
      else fail('wrong native set or result type');
      continue;
    }
    if (!mode) fail('unrecognized native record');
    const tokens = row.split(/\s+/);
    if (tokens.length !== (mode === 'flux' ? 5 : 2)
      || tokens.some(token => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[EeDd][+-]?\d+)?$/.test(token)))
      fail('malformed native numeric record');
    const values = tokens.map(token => Number(token.replace(/[dD]/g, 'E')));
    if (values.some(v => !Number.isFinite(v)) || !Number.isSafeInteger(values[0]))
      fail('nonfinite native record');
    const index = values[0] - 1;
    if (mode === 'potential') {
      if (index < 0 || index >= model.nodes.length || potentials.has(index)) fail('wrong/duplicate node');
      potentials.set(index, values[1]);
    } else if (mode === 'reaction') {
      if (!expectedElectrodeNodes[electrode].includes(index) || reaction[electrode].has(index))
        fail('wrong-face/duplicate reaction');
      reaction[electrode].set(index, values[1]);
    } else {
      const ip = values[1], key = index + ':' + ip;
      if (index < 0 || index >= model.volumeElements.connectivity.length
        || !Number.isSafeInteger(ip) || ip < 1 || ip > 4 || flux.has(key))
        fail('wrong/duplicate integration point');
      flux.set(key, values.slice(2) as Vector);
    }
  }
  if (blocks.size !== 4 || potentials.size !== model.nodes.length
    || flux.size !== model.volumeElements.connectivity.length * 4
    || reaction.some((set, i) => set.size !== expectedElectrodeNodes[i].length))
    fail('incomplete two-domain native output');
  const nodalElectricPotential = model.nodes.map((point, index) => {
    const v = potentials.get(index)!;
    const xM = point[0] / 1000, interfaceXM = r.model.interface.planeXM;
    const expected = xM <= interfaceXM
      ? r.prescribedPotentials[0].potentialV - analytical.layers[0].electricFieldVPerM[0] * xM
      : analytical.interface.electricPotentialV
        - analytical.layers[1].electricFieldVPerM[0] * (xM - interfaceXM);
    near(v, expected, 0, ELECTROSTATIC_TWO_LAYER_LIMITS.potentialToleranceV,
      'potential profile inconsistent');
    return { nodeId: index + 1, positionM: point.map(x => x / 1000),
      domainIds: model.domainRegions.filter(d => d.nodeIndices.includes(index))
        .map(d => d.domainId), electricPotentialV: v };
  });
  const energy = [0, 0], meanD = [0, 0], volumes = [0, 0];
  const electricFields = model.volumeElements.connectivity.flatMap((cell, element) => {
    const domainId = model.volumeElements.domainIds[element];
    const layer = r.model.domains.findIndex(d => d.domainId === domainId);
    if (layer < 0 || model.volumeElements.materialIds[element] !== r.materials[layer].materialId)
      fail('element domain/material ownership');
    const tet = basis(model, cell), epsilon = r.materials[layer].absolutePermittivityFPerM;
    const gradient = [0, 1, 2].map(axis => tet.gradients.reduce((sum, g, j) =>
      sum + g[axis] * (potentials.get(cell[j + 1])! - potentials.get(cell[0])!), 0));
    for (const [edge, [a, b]] of tetEdges.entries())
      near(potentials.get(cell[edge + 4])!,
        (potentials.get(cell[a])! + potentials.get(cell[b])!) / 2, 0,
        ELECTROSTATIC_TWO_LAYER_LIMITS.potentialToleranceV, 'midside potential inconsistent');
    const weights = quadraticTetraVolumeSamples(cell.map(node => model.nodes[node]));
    return [1, 2, 3, 4].map(ip => {
      const vector = flux.get(element + ':' + ip)!.map(v =>
        v * 1000 * VACUUM_PERMITTIVITY_F_PER_M / epsilon) as Vector;
      vector.forEach((v, axis) => {
        const expected = axis === 0 ? analytical.layers[layer].electricFieldVPerM[0] : 0;
        near(v, -gradient[axis] * 1000, ELECTROSTATIC_TWO_LAYER_LIMITS.fieldRelativeTolerance,
          Math.abs(analytical.layers[layer].electricFieldVPerM[0]) * 1e-6,
          'potential/field inconsistency');
        near(v, expected, ELECTROSTATIC_TWO_LAYER_LIMITS.fieldRelativeTolerance,
          Math.abs(analytical.layers[layer].electricFieldVPerM[0]) * 1e-4,
          'field/reference inconsistency');
      });
      const displacement = vector.map(v => v * epsilon) as Vector;
      const weightM3 = weights[ip - 1].volumeWeightMm3 * 1e-9;
      const density = 0.5 * dot(vector, displacement);
      energy[layer] += density * weightM3;
      meanD[layer] += displacement[0] * weightM3; volumes[layer] += weightM3;
      return { elementId: element + 1, integrationPoint: ip, domainId,
        electricFieldVPerM: vector, electricFieldMagnitudeVPerM: Math.hypot(...vector),
        electricDisplacementCPerM2: displacement,
        electrostaticEnergyDensityJPerM3: density };
    });
  });
  meanD.forEach((_, i) => { if (!(volumes[i] > 0)) fail('missing domain volume'); meanD[i] /= volumes[i]; });
  const interfaceDisplacementJumpCPerM2 = meanD[1] - meanD[0];
  near(interfaceDisplacementJumpCPerM2, 0, 0,
    Math.abs(analytical.layers[0].electricDisplacementCPerM2[0]) * ELECTROSTATIC_TWO_LAYER_LIMITS.fieldRelativeTolerance,
    'interface normal D discontinuity');
  const electrodes = reaction.map((set, i) => {
    const chargeC = [...set.entries()].sort(([a], [b]) => a - b)
      .reduce((sum, [, native]) => sum + native, 0)
      * VACUUM_PERMITTIVITY_F_PER_M / 1000;
    near(chargeC, analytical.electrodes[i].chargeC,
      ELECTROSTATIC_TWO_LAYER_LIMITS.chargeRelativeTolerance, 1e-24,
      'electrode charge inconsistent');
    return { groupId: r.prescribedPotentials[i].groupId, domainId: r.prescribedPotentials[i].domainId,
      faceId: r.prescribedPotentials[i].faceId, chargeC };
  });
  const netChargeC = electrodes[0].chargeC + electrodes[1].chargeC;
  near(netChargeC, 0, 0, Math.abs(analytical.electrodes[1].chargeC)
    * ELECTROSTATIC_TWO_LAYER_LIMITS.chargeRelativeTolerance, 'net charge imbalance');
  const capacitanceF = r.prescribedPotentials[1].potentialV === r.prescribedPotentials[0].potentialV
    ? analytical.capacitanceF : electrodes[1].chargeC / analytical.voltageDifferenceV;
  near(capacitanceF, analytical.capacitanceF, ELECTROSTATIC_TWO_LAYER_LIMITS.chargeRelativeTolerance,
    1e-24, 'capacitance inconsistent');
  const electrostaticEnergyJ = energy[0] + energy[1];
  near(electrostaticEnergyJ, analytical.electrostaticEnergyJ,
    ELECTROSTATIC_TWO_LAYER_LIMITS.energyRelativeTolerance, 1e-24, 'field energy inconsistent');
  const chargeEnergyJ = 0.5 * electrodes[1].chargeC * analytical.voltageDifferenceV;
  near(electrostaticEnergyJ, chargeEnergyJ,
    ELECTROSTATIC_TWO_LAYER_LIMITS.energyRelativeTolerance, 1e-24, 'charge/field energy inconsistent');
  const samples = r.output.axialPositionsM.map(xM => {
    const point = [xM * 1000, r.model.domains[0].shape.widthM * 500,
      r.model.domains[0].shape.heightM * 500];
    for (const cell of model.volumeElements.connectivity) {
      const tet = basis(model, cell), delta = subtract(point, tet.p);
      const coords = tet.gradients.map(g => dot(g, delta));
      const bary = [1 - coords.reduce((a, b) => a + b, 0), ...coords];
      if (bary.some(v => v < -1e-9 || v > 1 + 1e-9)) continue;
      const shape = [...bary.map(v => v * (2 * v - 1)),
        ...tetEdges.map(([a, b]) => 4 * bary[a] * bary[b])];
      const electricPotentialV = shape.reduce((sum, w, i) =>
        sum + w * potentials.get(cell[i])!, 0);
      const expected = analytical.samples.find(s => s.xM === xM)!.electricPotentialV;
      near(electricPotentialV, expected, 0,
        ELECTROSTATIC_TWO_LAYER_LIMITS.potentialToleranceV, 'sample potential inconsistent');
      return { xM, electricPotentialV };
    }
    return fail('sample outside mesh; extrapolation forbidden');
  });
  const lowV = samples[0].electricPotentialV;
  const interfaceV = samples.find(sample => sample.xM === r.model.interface.planeXM)!.electricPotentialV;
  const highV = samples[samples.length - 1].electricPotentialV;
  const recoveredDropsV = [interfaceV - lowV, highV - interfaceV];
  recoveredDropsV.forEach((v, i) => near(v, analytical.layers[i].voltageDropV,
    0, ELECTROSTATIC_TWO_LAYER_LIMITS.potentialToleranceV,
    'per-domain voltage drop inconsistent'));
  const result = {
    schema: 'tunacad-electrostatic-two-layer-provider-fixture-result/0.1' as const,
    analysisType: 'electrostatic' as const, authority: 'provider_development_fixture_only' as const,
    status: 'proof_of_concept' as const, engineeringUsePermitted: false as const,
    providerAdmission: 'closed' as const, requestDigest: r.requestDigest,
    projectRevision: r.model.projectRevision,
    domainIds: r.model.domains.map(d => d.domainId), meshDigest, interfaceEvidence,
    rawOutputDigest: digest(raw), materialProvenance: r.materials.map(m => m.source),
    units: r.output.units, nodalElectricPotential, electricFields, samples,
    domains: r.model.domains.map((d, i) => ({
      domainId: d.domainId, voltageDropV: recoveredDropsV[i],
      meanNormalElectricDisplacementCPerM2: meanD[i],
      electrostaticEnergyJ: energy[i],
    })),
    electrodes, capacitanceF, electrostaticEnergyJ,
    consistency: { netElectrodeChargeC: netChargeC, interfaceDisplacementJumpCPerM2,
      chargeEnergyJ, fieldMinusChargeEnergyJ: electrostaticEnergyJ - chargeEnergyJ },
    recovery: { engine: 'CalculiX' as const, engineVersion: '2.16' as const,
      formulation: 'steady_scalar_permittivity_ratio' as const,
      fieldOrigin: 'native_scalar_flux' as const,
      chargeOrigin: 'native_electrode_reactions' as const },
  };
  return { ...result, resultDigest: digest(result) };
}
