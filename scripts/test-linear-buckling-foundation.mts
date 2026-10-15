// Pure provider/contract checks. No executable is launched and no geometry is meshed.
import assert from 'node:assert/strict';
import {parseCalculiXBucklingDatV2,CalculiXMultiDomainSolverProvider} from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import {bucklingCriticalLoads,validBucklingCriticalLoads,isBucklingReferenceLoad,isBucklingRestraint,bucklingStepCards,assertBucklingModeCount,assertBucklingSolverConverged,bucklingForcesActInward} from '../simulation-bridge/linearBuckling.mts';
import type {NeutralSimulationLoadV2} from '../src/simulation/externalSimulationContracts.ts';
const heading='B U C K L I N G F A C T O R O U T P U T\n MODE NO BUCKLING FACTOR\n';
assert.deepEqual(parseCalculiXBucklingDatV2(heading+'1 1.079488D+01\n2 1.0800E+01').modes.map(m=>m.eigenvalueLoadFactor),[10.79488,10.8]);
for(const value of ['-2','0','NaN','Infinity','1E999','****'])assert.throws(()=>parseCalculiXBucklingDatV2(heading+'1 '+value));
assert.throws(()=>parseCalculiXBucklingDatV2(heading+'1 2\n1 3'));
for(const fatal of ['*ERROR in ARPACK','NO CONVERGENCE','not converged','ARPACK iteration FAILED']){
  assert.throws(()=>assertBucklingSolverConverged(fatal));assert.throws(()=>parseCalculiXBucklingDatV2(heading+'1 2\n'+fatal));
}
assert.doesNotThrow(()=>assertBucklingSolverConverged('*WARNING requested precision may be insufficient'));
// Real-format reference/eigenmode parsing is covered by test-buckling-frd-parser.mts.
for(const counts of [[3,2,2],[3,3,2],[3,4,4]])assert.throws(()=>assertBucklingModeCount(...counts as [number,number,number]));
assert.doesNotThrow(()=>assertBucklingModeCount(3,3,3));
const loads:NeutralSimulationLoadV2[]=[{id:'compression',name:'Reference compression',type:'surface_force',semanticReferenceIds:['loaded'],forceN:[-1000,0,0],coordinateSystem:'analysis'}];
assert.deepEqual(bucklingCriticalLoads(loads,2),[{loadId:'compression',type:'surface_force',forceN:[-2000,0,0],magnitudeN:2000}]);
const pressure:NeutralSimulationLoadV2={id:'pressure',name:'Reference pressure',type:'pressure',semanticReferenceIds:['loaded'],pressureMPa:10};
assert.deepEqual(bucklingCriticalLoads([pressure],2),[{loadId:'pressure',type:'pressure',pressureMPa:20}]);
for(const factor of [-1,0,NaN,Infinity])assert.throws(()=>bucklingCriticalLoads(loads,factor));
const mode={modeNumber:1,eigenvalueLoadFactor:2,fieldDatasetIds:['mode-1'],criticalLoads:bucklingCriticalLoads(loads,2)};
assert(validBucklingCriticalLoads(mode,loads));assert(!validBucklingCriticalLoads({...mode,criticalLoads:bucklingCriticalLoads(loads,3)},loads));
assert(validBucklingCriticalLoads({...mode,criticalLoads:undefined},loads),'legacy retained results are still readable');
assert(isBucklingReferenceLoad(pressure));assert(!isBucklingReferenceLoad({...pressure,pressureMPa:-10}));
assert(!isBucklingReferenceLoad({...loads[0],type:'surface_force',forceN:[0,0,0]} as NeutralSimulationLoadV2));
assert(isBucklingRestraint({id:'r',name:'r',type:'fixed',semanticReferenceIds:['fixed']}));
for(const displacementMm of [[0,0,0],[0,null,null]] as [number|null,number|null,number|null][])
  assert(isBucklingRestraint({id:'r',name:'r',type:'prescribed_displacement',semanticReferenceIds:['fixed'],coordinateSystem:'analysis',displacementMm}));
for(const displacementMm of [[1,0,0],[null,null,null]] as [number|null,number|null,number|null][])
  assert(!isBucklingRestraint({id:'r',name:'r',type:'prescribed_displacement',semanticReferenceIds:['fixed'],coordinateSystem:'analysis',displacementMm}));
const cards=bucklingStepCards(3,['*BOUNDARY','FIXED,1,3,0'],['*CLOAD','12,1,-1000']).join('\n');
assert.match(cards,/^\*STEP\n\*BUCKLE\n3$/m);assert.match(cards,/^\*CLOAD$/m);assert.doesNotMatch(cards,/STATIC|PERTURBATION|FREQUENCY/);
for(const count of [0,13,1.5])assert.throws(()=>bucklingStepCards(count,[],[]));
const profile=new CalculiXMultiDomainSolverProvider({executable:'ccx.exe',runtimeVersion:'2.16'}).capabilities;
assert(profile.study.buckling?.loadTypes.includes('pressure'));assert(profile.study.buckling?.constraintTypes.includes('prescribed_displacement'));
assert.equal(profile.qualification.engineeringUsePermitted,false);
const request:any={loads,model:{references:[{semanticReferenceId:'loaded',domainId:'solid',role:'load',faceOwnerLocal:{outwardDirection:[1,0,0]}}],domains:[{domainId:'solid',transformToAnalysis:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}]}};
assert(bucklingForcesActInward(request));const reverse=structuredClone(request);reverse.loads[0].forceN=[1000,0,0];assert(!bucklingForcesActInward(reverse));
const rotated=structuredClone(request);rotated.model.domains[0].transformToAnalysis=[0,-1,0,0,1,0,0,0,0,0,1,0,0,0,0,1];rotated.loads[0].forceN=[0,-1000,0];assert(bucklingForcesActInward(rotated));
console.log('PASS buckling foundation: DAT parsing, dedicated FRD regression documented, signed/invalid/nonconverged factors, complete mode counts, reference force/pressure estimates, homogeneous restraints, direct 2.16 BUCKLE cards, rotated FACE compression, preview admission. No native processes.');
