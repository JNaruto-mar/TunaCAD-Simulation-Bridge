import {
  electrostaticTwoLayerDraftSchema, electrostaticTwoLayerSchema,
  type ElectrostaticTwoLayer, type ElectrostaticTwoLayerDraft,
} from './electrostaticTwoLayerContract.mts';
export {
  electrostaticTwoLayerDraftSchema, electrostaticTwoLayerSchema,
  type ElectrostaticTwoLayer, type ElectrostaticTwoLayerDraft,
} from './electrostaticTwoLayerContract.mts';
import { digest } from './stableDigest.mts';

export function validateElectrostaticTwoLayer(value: unknown): ElectrostaticTwoLayer {
  const request = electrostaticTwoLayerSchema.parse(value);
  const { requestDigest, ...unsigned } = request;
  if (digest(unsigned) !== requestDigest) throw new Error('Two-layer electrostatic request digest mismatch.');
  return request;
}

export function sealElectrostaticTwoLayer(draft: ElectrostaticTwoLayerDraft): ElectrostaticTwoLayer {
  // Fail rather than reorder or repair ownership, FACE, electrode or interface declarations.
  const unsigned = electrostaticTwoLayerDraftSchema.parse(draft);
  return validateElectrostaticTwoLayer({ ...unsigned, requestDigest: digest(unsigned) });
}

export function twoLayerSeriesCapacitorReference(value: unknown) {
  const r = validateElectrostaticTwoLayer(value);
  const [a, b] = r.model.domains;
  const [ma, mb] = r.materials;
  const [ea, eb] = r.prescribedPotentials;
  const lengthsM = [a.shape.xMaxM - a.shape.xMinM, b.shape.xMaxM - b.shape.xMinM];
  const eps = [ma.absolutePermittivityFPerM, mb.absolutePermittivityFPerM];
  const areaM2 = a.shape.widthM * a.shape.heightM;
  const voltageDifferenceV = eb.potentialV - ea.potentialV;
  const seriesElastanceM2PerF = lengthsM[0] / eps[0] + lengthsM[1] / eps[1];
  const capacitanceF = areaM2 / seriesElastanceM2PerF;
  // Zero free interface charge makes normal D continuous.
  const displacementX = -voltageDifferenceV / seriesElastanceM2PerF;
  const fieldX = [displacementX / eps[0], displacementX / eps[1]];
  const voltageDropsV = [-fieldX[0] * lengthsM[0], -fieldX[1] * lengthsM[1]];
  const interfacePotentialV = ea.potentialV + voltageDropsV[0];
  const leftChargeC = displacementX * areaM2;
  const rightChargeC = -leftChargeC;
  const layers = [a, b].map((domain, n) => {
    const material = n === 0 ? ma : mb;
    const electrostaticEnergyDensityJPerM3 = 0.5 * eps[n] * fieldX[n] ** 2;
    return {
      domainId: domain.domainId, bodyId: domain.bodyId, geometryDigest: domain.geometryDigest,
      materialId: material.materialId, materialProvenance: structuredClone(material.source),
      absolutePermittivityFPerM: eps[n], thicknessM: lengthsM[n],
      voltageDropV: voltageDropsV[n],
      electricFieldVPerM: [fieldX[n], 0, 0] as [number, number, number],
      electricDisplacementCPerM2: [displacementX, 0, 0] as [number, number, number],
      electrostaticEnergyDensityJPerM3,
      electrostaticEnergyJ: electrostaticEnergyDensityJPerM3 * areaM2 * lengthsM[n],
    };
  });
  const fieldEnergyJ = layers[0].electrostaticEnergyJ + layers[1].electrostaticEnergyJ;
  const capacitanceEnergyJ = 0.5 * capacitanceF * voltageDifferenceV ** 2;
  const electrodeEnergyJ = 0.5 * rightChargeC * voltageDifferenceV;
  const normalElectricDisplacementJumpCPerM2 =
    layers[1].electricDisplacementCPerM2[0] - layers[0].electricDisplacementCPerM2[0];
  const reference = {
    schema: 'tunacad-electrostatic-two-layer-analytical-reference/0.1' as const,
    analysisType: 'electrostatic' as const, authority: 'analytical_reference_only' as const,
    sourceVerification: 'declared_geometry_material_interface_not_cad_or_mesh_verified' as const,
    requestDigest: r.requestDigest, projectRevision: r.model.projectRevision,
    status: 'proof_of_concept' as const, engineeringUsePermitted: false as const,
    providerAdmission: 'closed' as const, units: structuredClone(r.output.units),
    areaM2, voltageDifferenceV, seriesElastanceM2PerF, capacitanceF, layers,
    interface: {
      leftDomainId: a.domainId, rightDomainId: b.domainId,
      leftFaceId: r.model.interface.leftFaceId, rightFaceId: r.model.interface.rightFaceId,
      surfaceDigest: r.model.interface.surfaceDigest, xM: r.model.interface.planeXM,
      electricPotentialV: interfacePotentialV,
      normalElectricDisplacementJumpCPerM2, freeSurfaceChargeCPerM2: 0,
    },
    samples: r.output.axialPositionsM.map(xM => {
      const inLeft = xM < r.model.interface.planeXM;
      const onInterface = xM === r.model.interface.planeXM;
      return {
        xM,
        electricPotentialV: inLeft
          ? ea.potentialV - fieldX[0] * xM
          : interfacePotentialV - fieldX[1] * (xM - r.model.interface.planeXM),
        domainId: onInterface ? null : inLeft ? a.domainId : b.domainId,
        // The field is discontinuous at the interface; expose one-sided limits.
        interfaceFieldLimitsVPerM: onInterface
          ? { left: layers[0].electricFieldVPerM, right: layers[1].electricFieldVPerM }
          : null,
      };
    }),
    electrodes: [
      { groupId: ea.groupId, domainId: a.domainId, faceId: ea.faceId,
        potentialV: ea.potentialV, chargeC: leftChargeC },
      { groupId: eb.groupId, domainId: b.domainId, faceId: eb.faceId,
        potentialV: eb.potentialV, chargeC: rightChargeC },
    ],
    electrostaticEnergyJ: fieldEnergyJ,
    consistency: {
      summedVoltageDropMinusAppliedV: voltageDropsV[0] + voltageDropsV[1] - voltageDifferenceV,
      normalElectricDisplacementJumpCPerM2, netElectrodeChargeC: leftChargeC + rightChargeC,
      capacitanceEnergyJ, electrodeEnergyJ,
      fieldMinusCapacitanceEnergyJ: fieldEnergyJ - capacitanceEnergyJ,
      fieldMinusElectrodeEnergyJ: fieldEnergyJ - electrodeEnergyJ,
    },
    limitations: [
      'Matching declared planar surfaces are not trusted native CAD or conformal-mesh evidence.',
      'Ideal complete electrodes and insulated lateral boundaries exclude fringing.',
      'No provider solve, free charge, nonlinear dielectric, open domain or coupling.',
      'Analytical reference only; no retrievable Simulation Bridge result.',
    ],
  };
  return { ...reference, referenceDigest: digest(reference) };
}

export type ElectrostaticTwoLayerAnalyticalReference =
  ReturnType<typeof twoLayerSeriesCapacitorReference>;
