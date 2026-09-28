/** Provider-only SIM-9 envelope derived from the bounded axial-bar evidence. */
export const HARMONIC_MODE_POLICY = Object.freeze({
  minimumFrequencyHz: 1_000,
  tierBoundaryHz: 8_000,
  maximumFrequencyHz: 22_000,
  lowFrequencyModes: 96,
  highFrequencyModes: 192,
  maximumNodes: 2_000,
  maximumElements: 1_000,
  minimumUpperFrequencyRatio: 2,
  resonanceExclusionFraction: .005,
});

export function selectHarmonicModeCount(frequencyHz: number, nodeCount?: number, elementCount?: number): number {
  if (!Number.isFinite(frequencyHz) || frequencyHz < HARMONIC_MODE_POLICY.minimumFrequencyHz
    || frequencyHz > HARMONIC_MODE_POLICY.maximumFrequencyHz) {
    throw new Error('SIMULATION_HARMONIC_FREQUENCY_UNSUPPORTED: outside the bounded provider envelope.');
  }
  const count = frequencyHz <= HARMONIC_MODE_POLICY.tierBoundaryHz
    ? HARMONIC_MODE_POLICY.lowFrequencyModes : HARMONIC_MODE_POLICY.highFrequencyModes;
  if (nodeCount !== undefined && (!Number.isInteger(nodeCount) || nodeCount < 1
    || nodeCount > HARMONIC_MODE_POLICY.maximumNodes || nodeCount * 3 <= count + 6)) {
    throw new Error('SIMULATION_HARMONIC_RESOURCE_LIMIT: mesh node count cannot support the modal solve.');
  }
  if (elementCount !== undefined && (!Number.isInteger(elementCount) || elementCount < 1
    || elementCount > HARMONIC_MODE_POLICY.maximumElements)) {
    throw new Error('SIMULATION_HARMONIC_RESOURCE_LIMIT: mesh element count exceeds the modal bound.');
  }
  return count;
}

export interface HarmonicModalCoverage {
  retainedModes: number;
  lowestFrequencyHz: number;
  highestFrequencyHz: number;
  modesBelowExcitation: number;
  modesAboveExcitation: number;
  upperFrequencyRatio: number;
}

export function validateHarmonicModalCoverage(
  frequencyHz: number, frequenciesHz: readonly number[], expectedModes: number,
  minimumUpperFrequencyRatio = HARMONIC_MODE_POLICY.minimumUpperFrequencyRatio,
): HarmonicModalCoverage {
  if (!Number.isInteger(expectedModes) || expectedModes < 1
    || expectedModes > HARMONIC_MODE_POLICY.highFrequencyModes
    || frequenciesHz.length !== expectedModes
    || frequenciesHz.some((value, index) => !Number.isFinite(value) || value <= 0
      || index > 0 && value < frequenciesHz[index - 1])) {
    throw new Error('SIMULATION_HARMONIC_MODAL_COVERAGE_INVALID: modal table is incomplete or unordered.');
  }
  const modesBelowExcitation = frequenciesHz.filter(value => value < frequencyHz).length;
  const modesAboveExcitation = frequenciesHz.filter(value => value > frequencyHz).length;
  const highestFrequencyHz = frequenciesHz.at(-1)!;
  const upperFrequencyRatio = highestFrequencyHz / frequencyHz;
  if (!modesBelowExcitation || !modesAboveExcitation
    || upperFrequencyRatio < minimumUpperFrequencyRatio
    || frequenciesHz.some(value => Math.abs(value - frequencyHz)
      <= frequencyHz * HARMONIC_MODE_POLICY.resonanceExclusionFraction)) {
    throw new Error('SIMULATION_HARMONIC_MODAL_COVERAGE_INADEQUATE: modal coverage lacks bracketing or upper margin, or is near undamped resonance.');
  }
  return { retainedModes: frequenciesHz.length, lowestFrequencyHz: frequenciesHz[0],
    highestFrequencyHz, modesBelowExcitation, modesAboveExcitation, upperFrequencyRatio };
}
