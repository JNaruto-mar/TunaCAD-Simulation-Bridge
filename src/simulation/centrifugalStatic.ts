import type {NeutralSimulationLoadV2, NeutralSimulationMaterial, NeutralSimulationDomainV2, NeutralVector3} from './externalSimulationContracts.ts';
export const CENTRIFUGAL_STATIC_LIMITS = {maximumRpm:60000, maximumAxisCoordinateMm:1e6, maximumAccelerationMmPerS2:1e9} as const;
export type CentrifugalLoad = Extract<NeutralSimulationLoadV2,{type:'centrifugal'}>;
export function isCentrifugalLoad(value:unknown):value is CentrifugalLoad {
 if(!value||typeof value!=='object')return false;const v=value as CentrifugalLoad;
 return v.type==='centrifugal'&&v.coordinateSystem==='analysis'&&Number.isFinite(v.speedRpm)&&v.speedRpm>0&&v.speedRpm<=60000
  &&Array.isArray(v.axisPointMm)&&v.axisPointMm.length===3&&v.axisPointMm.every(x=>Number.isFinite(x)&&Math.abs(x)<=1e6)
  &&Array.isArray(v.axisDirection)&&v.axisDirection.length===3&&v.axisDirection.every(Number.isFinite)&&Math.abs(Math.hypot(...v.axisDirection)-1)<=1e-10;
}
/** Constant-speed, undeformed-geometry body loading, not rotating dynamics. */
export function centrifugalStudyIssue(analysis:string,domains:number,materials:readonly NeutralSimulationMaterial[],
 loads:readonly NeutralSimulationLoadV2[],constraints:ReadonlyArray<{type:string}>,interactions:number):string|null {
 if(!loads.some(l=>l.type==='centrifugal'))return null;
 if(analysis!=='linear_static'||domains!==1||materials.length!==1||loads.length!==1||!isCentrifugalLoad(loads[0])
  ||!constraints.length||constraints.some(c=>c.type!=='fixed')||interactions||materials[0].model!=='isotropic_linear_elastic'
  ||materials[0].thermalExpansionPerK!==undefined||materials[0].specificHeatJPerKgK!==undefined||materials[0].thermalConductivityWPerMK!==undefined||materials[0].thermalConductivityCurve!==undefined||!Number.isFinite(materials[0].densityKgM3)||!(materials[0].densityKgM3!>0)||materials[0].densityKgM3!>100000)
  return 'Centrifugal Preview requires one elastic solid/material with density, one bounded constant-RPM load, fixed FACE supports and no other loads/interactions.';
 return null;
}
export function centrifugalAcceleration(load:CentrifugalLoad,point:NeutralVector3):NeutralVector3 {
 if(!isCentrifugalLoad(load)||point.length!==3||!point.every(Number.isFinite))throw Error('SIMULATION_CENTRIFUGAL_INPUT_INVALID');
 const delta=point.map((x,i)=>x-load.axisPointMm[i]),axial=delta.reduce((s,x,i)=>s+x*load.axisDirection[i],0),omegaSquared=(load.speedRpm*Math.PI/30)**2;
 const a=delta.map((x,i)=>omegaSquared*(x-axial*load.axisDirection[i])) as NeutralVector3;
 if(!a.every(Number.isFinite)||Math.hypot(...a)>1e9)throw Error('SIMULATION_CENTRIFUGAL_ACCELERATION_LIMIT');return a;
}

/** Conservative CAD-bounds preflight in frozen analysis coordinates, before transfer. */
export function assertCentrifugalDomainAcceleration(load:CentrifugalLoad,domains:ReadonlyArray<Pick<NeutralSimulationDomainV2,'shape'|'transformToAnalysis'>>):void{
 for(const d of domains){const b=d.shape.boundingBoxOwnerLocalMm,m=d.transformToAnalysis;
  for(const x of [b.min[0],b.max[0]])for(const y of [b.min[1],b.max[1]])for(const z of [b.min[2],b.max[2]])
   centrifugalAcceleration(load,[m[0]*x+m[1]*y+m[2]*z+m[3],m[4]*x+m[5]*y+m[6]*z+m[7],m[8]*x+m[9]*y+m[10]*z+m[11]]);
 }
}
