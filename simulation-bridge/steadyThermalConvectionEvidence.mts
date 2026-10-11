import type { NeutralSteadyThermalResultV2 } from '../src/simulation/externalSimulationContracts.ts';

/** Browser-safe shared integrity gate for the existing convection contract.
 * These are the established Bridge limits, not new qualification tolerances. */
export function isValidSteadyThermalConvectionEvidence(thermal: Pick<NeutralSteadyThermalResultV2,
  'totalAppliedHeatW' | 'totalReactionHeatW' | 'heatBalanceResidualW' | 'reactionHeatFlowEvidence'>): boolean {
  const evidence = thermal.reactionHeatFlowEvidence;
  return !!evidence && [thermal.totalAppliedHeatW, thermal.totalReactionHeatW, thermal.heatBalanceResidualW,
    evidence.sectionBaseReactionHeatW, evidence.nodalRflReactionHeatW, evidence.disagreementW].every(Number.isFinite)
    && thermal.heatBalanceResidualW >= 0 && evidence.disagreementW >= 0
    && Math.abs(Math.abs(thermal.totalAppliedHeatW + thermal.totalReactionHeatW) - thermal.heatBalanceResidualW) <= 1e-9
    && thermal.heatBalanceResidualW <= Math.max(1e-9, Math.abs(thermal.totalAppliedHeatW) * .005)
    && evidence.sectionBaseReactionHeatW === thermal.totalReactionHeatW
    && Math.abs(Math.abs(evidence.sectionBaseReactionHeatW - evidence.nodalRflReactionHeatW) - evidence.disagreementW) <= 1e-9
    && evidence.disagreementW <= Math.max(1e-6, Math.abs(thermal.totalReactionHeatW) * .02);
}
