import { digest } from '../../simulation-bridge/stableDigest.mts';
import type { ExplicitDynamicsRequest } from '../../simulation-bridge/explicitDynamicsFoundation.mts';
import type { assessExplicitC3D4Mesh } from './ExplicitDynamicsMeshAdmission.mts';
import { assertCalculiX216ExplicitFixedStep } from './ExplicitDynamicsMeshAdmission.mts';

type Admission = ReturnType<typeof assessExplicitC3D4Mesh>;

/** Provider-private, bounded evidence written before the feasibility solver starts. */
export function createExplicitDiagnosticReceipt(
  request: ExplicitDynamicsRequest, admitted: Admission, deck: string,
) {
  if(request.load.history!=='constant_after_onset')throw new Error('EXPLICIT_DIAGNOSTIC_INVALID: frozen CalculiX diagnostic supports step only');
  const lines = deck.split(/\r?\n/);
  const dynamicAt = lines.findIndex(line => /^\*DYNAMIC\b/i.test(line));
  const dynamicCard = lines[dynamicAt];
  const values = lines[dynamicAt + 1]?.split(',').map(Number);
  if (dynamicAt < 0 || !/^\*DYNAMIC, DIRECT, EXPLICIT=2, ALPHA=0$/i.test(dynamicCard)
    || values?.length !== 2 || values.some(value => !Number.isFinite(value))
    || Math.abs(values[0] - admitted.selectedTimeStepS) > admitted.selectedTimeStepS * 1e-10
    || Math.abs(values[1] - request.analysis.durationS) > request.analysis.durationS * 1e-10)
    throw new Error('EXPLICIT_DIAGNOSTIC_INVALID: fixed two-value explicit step mismatch');
  if (/(?:MASS SCAL|MASS_SCAL|MASS-SCAL)/i.test(deck))
    throw new Error('EXPLICIT_DIAGNOSTIC_INVALID: mass-scaling directive');
  const densityAt = lines.findIndex(line => /^\*DENSITY$/i.test(line));
  const densityInDeckTonnePerMm3 = Number(lines[densityAt + 1]);
  const expectedDensityKgPerMm3 = request.material.densityKgM3 * 1e-9;
  // CalculiX mm/N/s consistent mass density is tonne/mm^3, not kg/mm^3.
  const expectedDensityTonnePerMm3 = request.material.densityKgM3 * 1e-12;
  if (densityAt < 0 || !Number.isFinite(densityInDeckTonnePerMm3)
    || Math.abs(densityInDeckTonnePerMm3 - expectedDensityTonnePerMm3)
      > expectedDensityTonnePerMm3 * 1e-10)
    throw new Error('EXPLICIT_DIAGNOSTIC_INVALID: density unit conversion mismatch');
  const exactExpectedIncrements = Math.ceil(values[1] / values[0]);
  assertCalculiX216ExplicitFixedStep(values[0], admitted.providerCriticalTimeStepS,
    admitted.providerAdmissionMargin, values[1], 20_000);
  if (exactExpectedIncrements > admitted.incrementCount + 2
    || exactExpectedIncrements > 20_000 || admitted.incrementCount > 20_000
    || admitted.selectedTimeStepS > admitted.trustedStabilityLimitS * (1 + 1e-12))
    throw new Error('EXPLICIT_DIAGNOSTIC_INVALID: increment/CFL admission mismatch');
  const step = lines.find(line => /^\*STEP\b/i.test(line));
  if (step !== '*STEP, INC=' + (admitted.incrementCount + 2) + ', AMPLITUDE=STEP')
    throw new Error('EXPLICIT_DIAGNOSTIC_INVALID: step budget or load onset mismatch');
  if (!lines.includes('FIXED,1,3,0') || !lines.includes('*SOLID SECTION, ELSET=EALL, MATERIAL=STEEL'))
    throw new Error('EXPLICIT_DIAGNOSTIC_INVALID: restraint/material assignment mismatch');
  if (lines.some(line => /^\*INITIAL CONDITIONS\b/i.test(line)))
    throw new Error('EXPLICIT_DIAGNOSTIC_INVALID: nonzero/ambiguous initial state');
  const cardRows = (card: string) => {
    const at = lines.indexOf(card);
    if (at < 0) throw new Error('EXPLICIT_DIAGNOSTIC_INVALID: missing ' + card);
    const end = lines.findIndex((line, index) => index > at && line.startsWith('*'));
    return lines.slice(at + 1, end < 0 ? lines.length : end).filter(Boolean);
  };
  const setIds = (card: string) => cardRows(card).flatMap(row => row.split(',').map(Number));
  if (JSON.stringify(setIds('*NSET, NSET=FIXED')) !== JSON.stringify(admitted.fixedFace.nodeIds)
    || JSON.stringify(setIds('*NSET, NSET=LOADED')) !== JSON.stringify(admitted.loadedFace.nodeIds))
    throw new Error('EXPLICIT_DIAGNOSTIC_INVALID: fixed/load FACE sets mismatch');
  const faceLoad = request.load.forceN[0] / admitted.loadedFace.nodeIds.length;
  const forces = cardRows('*CLOAD').map(row => row.split(',').map(Number));
  if (forces.length !== admitted.loadedFace.nodeIds.length
    || forces.some((row, index) => row.length !== 3
      || row[0] !== admitted.loadedFace.nodeIds[index] || row[1] !== 1
      || !Number.isFinite(row[2])
      || Math.abs(row[2] - faceLoad) > Math.abs(faceLoad) * 1e-10)
    || Math.abs(forces.reduce((sum, row) => sum + row[2], 0)
      - request.load.forceN[0]) > Math.abs(request.load.forceN[0]) * 1e-10)
    throw new Error('EXPLICIT_DIAGNOSTIC_INVALID: step force mismatch');
  const evidence = {
    schema: 'tunacad-explicit-pre-dispatch-diagnostic/0.1',
    requestDigest: request.requestDigest, meshDigest: admitted.meshDigest, deckDigest: digest(deck),
    runtime: { gmsh: '4.15.2', calculix: '2.16' },
    mesh: { nodes: admitted.nodeCount, elements: admitted.elementCount, elementType: 'C3D4',
      minimumVolumeMm3: admitted.minimumVolumeMm3,
      minimumCharacteristicLengthMm: admitted.minimumCharacteristicLengthMm,
      totalVolumeMm3: admitted.totalVolumeMm3,
      materialAssignedElements: admitted.materialAssignedElementCount,
      expectedMassKg: admitted.expectedMassKg, meshMassKg: admitted.meshMassKg,
      minimumLumpedNodalMassKg: admitted.minimumNodalMassKg,
      maximumLumpedNodalMassKg: admitted.maximumNodalMassKg },
    material: { youngsModulusMPa: request.material.youngsModulusMPa,
      poissonRatio: request.material.poissonRatio, densityKgM3: request.material.densityKgM3,
      densityTonnePerMm3: densityInDeckTonnePerMm3,
      densityKgPerMm3: expectedDensityKgPerMm3 },
    waveSpeedMmPerS: { axial: admitted.axialWaveSpeedMmPerS,
      governingDilatational: admitted.governingWaveSpeedMmPerS },
    time: { legacyAltitudeCflS: admitted.legacyAltitudeCflS,
      providerCharacteristicLengthMm: admitted.providerCharacteristicLengthMm,
      providerCriticalTimeStepS: admitted.providerCriticalTimeStepS,
      providerAdmissionMargin: admitted.providerAdmissionMargin,
      hostTrustedCflS: admitted.trustedStabilityLimitS,
      selectedFixedIncrementS: admitted.selectedTimeStepS,
      durationS: request.analysis.durationS,
      admittedIncrementCount: admitted.incrementCount,
      exactExpectedIncrements, maximumIncrements: 20_000,
      deckStepIncrementLimit: admitted.incrementCount + 2 },
    faces: { fixed: admitted.fixedFace, loaded: admitted.loadedFace,
      forceN: request.load.forceN, forcePerLoadedNodeN: faceLoad,
      fixedDegreesOfFreedom: [1, 2, 3] },
    procedure: { card: dynamicCard, dataLine: lines[dynamicAt + 1],
      valueCount: values.length, minimumIncrementPresent: false,
      massScalingPermitted: false, loadAmplitude: 'STEP', zeroInitialState: true,
      energyOutput: 'ELKE,ELSE element totals; solver diagnostics separately' },
  } as const;
  return { ...evidence, receiptDigest: digest(evidence) };
}
