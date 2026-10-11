// Small synthetic postprocessing regression. No native executables or approvals.
import assert from 'node:assert/strict';
import {makeRequest,makeModel} from './fixtures/thermalTransportFixture.mts';
import {sealNeutralSimulationRequestV2,validateNeutralSimulationResultV2} from '../simulation-bridge/v2Validation.mts';
import {mappedThermalFaceAreaMm2,mappedThermalFluxNodalLoadsW} from '../providers/calculix/CalculiXMultiDomainDeck.mts';
import {normalizeSteadyThermal,type CalculiXSteadyThermalDatV2} from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';

const seed=makeRequest('steady_thermal');
for(const power of [3,9,27]){
 const request=sealNeutralSimulationRequestV2({...seed,loads:[{id:'power',name:'Synthetic total heat power',type:'surface_heat_power',semanticReferenceIds:['heated'],heatPowerW:power}]});
 const model=makeModel(request),area=mappedThermalFaceAreaMm2(model,[1]);
 const nodal=mappedThermalFluxNodalLoadsW(model,[1],power/area);
 const fixed=new Set(model.boundaryFacets.connectivity[0]);
 const shared=[...nodal].filter(([node])=>fixed.has(node)).reduce((sum,[,value])=>sum+value,0);
 assert(Math.abs([...nodal.values()].reduce((a,b)=>a+b,0)-power)<1e-12);
 assert(Math.abs(shared-power/3)<1e-12,'One shared quadratic midside node carries one third; corner-only/equal shares are wrong.');
 assert.deepEqual(mappedThermalFluxNodalLoadsW(model,[1,1],power/area),nodal);
 const parsed:CalculiXSteadyThermalDatV2={temperaturesByNode:new Map(model.nodes.map((_,i)=>[i,fixed.has(i)?20:21])),
  heatFluxByElementWPerMm2:new Map([[0,[power/area,0,0]]]),maximumHeatFluxMagnitudeByElementWPerMm2:new Map([[0,power/area]]),
  maximumHeatFluxMagnitudeWPerMm2:power/area,reactionHeatBySetW:{THERMAL_REACTION_001:-power+shared},sectionBaseHeatFlowW:null,interfaceFluxBySurfaceW:{}};
 const run={request,model,providerRunId:'synthetic-thermal-reaction',submittedAt:request.preparedAt};
 const normalized=normalizeSteadyThermal(run,parsed,'synthetic','1','synthetic');
 validateNeutralSimulationResultV2(normalized.result,request);
 assert('thermal' in normalized.result);assert(Math.abs(normalized.result.thermal.totalReactionHeatW+power)<1e-12);
 assert(normalized.result.thermal.heatBalanceResidualW<1e-12);
 assert(normalized.result.warnings.some(w=>w.code==='SIMULATION_THERMAL_PRESCRIBED_NODE_HEAT_CORRECTION'));
 // The same mapped-flux physics must recover the same support reaction.
 const fluxRequest=sealNeutralSimulationRequestV2({...request,loads:[{id:'flux',name:'Equivalent flux',type:'surface_heat_flux',semanticReferenceIds:['heated'],heatFluxWPerM2:power/area*1e6}]});
 const fluxResult=normalizeSteadyThermal({...run,request:fluxRequest,model:makeModel(fluxRequest)},parsed,'synthetic','1','synthetic').result;
 validateNeutralSimulationResultV2(fluxResult,fluxRequest);assert('thermal' in fluxResult);assert(Math.abs(fluxResult.thermal.totalReactionHeatW+power)<1e-12);
 // Normalization is NOT a balance repair: unrelated native imbalance still fails.
 const broken=structuredClone(parsed);broken.reactionHeatBySetW.THERMAL_REACTION_001+=.01;
 const unbalanced=normalizeSteadyThermal(run,broken,'synthetic','1','synthetic').result;
 assert.throws(()=>validateNeutralSimulationResultV2(unbalanced,request));
 for(const invalid of [0,-1,NaN,Infinity,1e6+1])assert.throws(()=>mappedThermalFluxNodalLoadsW(model,[1],invalid));
 assert.throws(()=>mappedThermalFluxNodalLoadsW(model,[99],1));
}
// Convection retains its independent section-FLUX method; no DFLUX correction.
const convection=sealNeutralSimulationRequestV2({...seed,loads:[{id:'convection',name:'Synthetic convection reaction-method isolation',type:'surface_convection',semanticReferenceIds:['heated'],filmCoefficientWPerM2K:75,sinkTemperatureC:10}]});
const convectionModel=makeModel(convection);
const equilibrium:CalculiXSteadyThermalDatV2={temperaturesByNode:new Map(convectionModel.nodes.map((_,i)=>[i,20])),
 heatFluxByElementWPerMm2:new Map([[0,[0,0,0]]]),maximumHeatFluxMagnitudeByElementWPerMm2:new Map([[0,0]]),
 maximumHeatFluxMagnitudeWPerMm2:0,reactionHeatBySetW:{THERMAL_REACTION_001:75*.5e-6*10},sectionBaseHeatFlowW:-75*.5e-6*10,interfaceFluxBySurfaceW:{}};
const convectionResult=normalizeSteadyThermal({request:convection,model:convectionModel,providerRunId:'synthetic-convection',submittedAt:convection.preparedAt},equilibrium,'synthetic','1','synthetic').result;
validateNeutralSimulationResultV2(convectionResult,convection);assert('thermal' in convectionResult);
assert(convectionResult.thermal.heatBalanceResidualW<1e-12);assert(convectionResult.thermal.reactionHeatFlowEvidence);
assert(!convectionResult.warnings.some(w=>w.code==='SIMULATION_THERMAL_PRESCRIBED_NODE_HEAT_CORRECTION'));
console.log('PASS steady thermal shared-node reaction: generalized power/flux integration, duplicate facets, independent imbalance rejection and unchanged limits; zero native runs.');
