import type {NeutralSimulationLoadV2, NeutralSimulationConstraintV2, NeutralBucklingModeV2, NeutralSimulationRequestV2} from '../src/simulation/externalSimulationContracts.ts';

/** Legacy preloadCase names the scaled BUCKLE-step pattern, not independent prestress. */
export function isBucklingReferenceLoad(load: NeutralSimulationLoadV2) {
  return load.type === 'surface_force'&&load.forceN.every(Number.isFinite)&&Math.hypot(...load.forceN)>1e-14
    || load.type === 'pressure' && Number.isFinite(load.pressureMPa) && load.pressureMPa > 0;
}
export function isBucklingRestraint(constraint: NeutralSimulationConstraintV2) {
  return constraint.type === 'fixed' || constraint.type === 'prescribed_displacement'
    && constraint.displacementMm.some(value => value === 0)
    && constraint.displacementMm.every(value => value === null || value === 0);
}
export function bucklingCriticalLoads(loads: readonly NeutralSimulationLoadV2[], factor: number): NonNullable<NeutralBucklingModeV2['criticalLoads']> {
  if (!Number.isFinite(factor) || factor <= 0) throw Error('Buckling factor must be finite and positive; reverse/zero factors are not critical loads for this reference direction.');
  return loads.map(load => {
    if (load.type === 'surface_force') {
      const forceN = load.forceN.map(value => value * factor) as [number,number,number];
      const magnitudeN = Math.hypot(...forceN);
      if (!forceN.every(Number.isFinite) || !(magnitudeN > 0) || !Number.isFinite(magnitudeN)) throw Error('Invalid critical force.');
      return {loadId:load.id,type:'surface_force' as const,forceN,magnitudeN};
    }
    if (load.type === 'pressure' && load.pressureMPa > 0 && load.pressureMPa * factor > 0 && Number.isFinite(load.pressureMPa * factor))
      return {loadId:load.id,type:'pressure' as const,pressureMPa:load.pressureMPa * factor};
    throw Error('Buckling accepts only nonzero reference force or positive inward pressure.');
  });
}
/** Optional for retained results; newly normalized provider modes include estimates. */
export function validBucklingCriticalLoads(mode: NeutralBucklingModeV2, loads: readonly NeutralSimulationLoadV2[]) {
  return mode.criticalLoads === undefined || JSON.stringify(mode.criticalLoads) === JSON.stringify(bucklingCriticalLoads(loads,mode.eigenvalueLoadFactor));
}
export function assertBucklingSolverConverged(text: string) {
  if (/\*\s*ERROR\b|\b(?:NO CONVERGENCE|NOT CONVERGED|FAILED TO CONVERGE)\b|ARPACK[^\r\n]*(?:ERROR|FAILED)/i.test(text))
    throw Error('CalculiX buckling did not converge or reported a solver error. No critical-load estimate is available.');
}
/** Evaluate FACE normals in frozen analysis axes, including rotated occurrences. */
export function bucklingForcesActInward(request:NeutralSimulationRequestV2) {
  return request.loads.every(load=>load.type!=='surface_force'||load.semanticReferenceIds.every(id=>{
    const ref=request.model.references.find(ref=>ref.semanticReferenceId===id&&ref.role==='load');
    const domain=request.model.domains.find(domain=>domain.domainId===ref?.domainId);
    const normal=ref?.faceOwnerLocal.outwardDirection,m=domain?.transformToAnalysis;
    if(!normal||!m||normal.length!==3||!normal.every(Number.isFinite))return false;
    const n=[m[0]*normal[0]+m[1]*normal[1]+m[2]*normal[2],m[4]*normal[0]+m[5]*normal[1]+m[6]*normal[2],m[8]*normal[0]+m[9]*normal[1]+m[10]*normal[2]];
    return load.forceN.reduce((sum,value,index)=>sum+value*n[index],0)<-1e-10*Math.hypot(...load.forceN)*Math.hypot(...n);
  }));
}
/** Direct reference-load procedure from CalculiX 2.16 sections 6.9.4 / 8.6. */
export function bucklingStepCards(modeCount:number,boundaryCards:readonly string[],loadCards:readonly string[]) {
  if(!Number.isInteger(modeCount)||modeCount<1||modeCount>12)throw Error('Buckling provider requires 1–12 modes.');
  return ['*STEP','*BUCKLE',String(modeCount),...boundaryCards,...loadCards,'*NODE FILE, NSET=NALL, GLOBAL=YES','U','*END STEP'];
}
export function assertBucklingModeCount(requested:number,factors:number,shapes:number) {
  if(factors!==requested||shapes!==requested)throw Error('CalculiX did not return every requested buckling factor and eigenvector; convergence is incomplete.');
}
