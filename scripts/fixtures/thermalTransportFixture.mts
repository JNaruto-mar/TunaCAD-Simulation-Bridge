// Synthetic transport regression only. No probes, geometry export or native processes.
// Engineering-shaped envelopes deliberately exercise the strict production ID checks;
// these fixture values are NOT numerical/native acceptance evidence.
import assert from 'node:assert/strict';
import { ComposedSimulationProviderV2 } from '../../providers/ComposedSimulationProviderV2.mts';
import { CalculiXMultiDomainSolverProvider } from '../../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { GmshMultiDomainMeshProvider } from '../../providers/gmsh/GmshMultiDomainMeshProvider.mts';
import { sealNeutralSimulationRequestV2, validateNeutralSimulationResultV2,
  validateNeutralFemModelV2, validateNeutralSimulationFieldPageV2 } from '../../simulation-bridge/v2Validation.mts';
import { digest } from '../../simulation-bridge/stableDigest.mts';
import type { ExternalSolverProviderV2, NeutralFemModelV2, NeutralSimulationRequestV2,
  NeutralSimulationResultV2, NeutralSimulationFieldPageV2 } from '../../src/simulation/externalSimulationContracts.ts';

const metrics = { maximumVonMisesStressMPa: null, maximumDisplacementMm: null, minimumFactorOfSafety: null };
const identity = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1] as const;
const nodes: [number,number,number][] = [[0,0,0],[1,0,0],[0,1,0],[0,0,1],[.5,0,0],[.5,.5,0],[0,.5,0],[0,0,.5],[0,.5,.5],[.5,0,.5]];
export function makeRequest(type: 'transient_thermal' | 'steady_thermal'): NeutralSimulationRequestV2 {
 const transient = type === 'transient_thermal', now = Date.now();
 return sealNeutralSimulationRequestV2({
  schema:'tunacad-neutral-simulation-request/2.0',studyId:'composed-'+type,name:'Synthetic thermal transport',
  preparedAt:new Date(now).toISOString(),expiresAt:new Date(now+120000).toISOString(),
  analysis:transient?{type,assumptions:['transient','isotropic_conduction','temperature_independent_properties','uniform_initial_temperature','step_boundary_conditions'],
   settings:{initialTemperatureC:20,durationS:2,outputTimesS:[1,2]}}:
   {type,assumptions:['steady_state','isotropic_conduction','temperature_independent_properties']},
  model:{projectRevision:'transport-r1',coordinateSpace:'frozen_analysis',domains:[{
   domainId:'solid',partId:'part',bodyId:'tetra',occurrenceId:'part',geometryDigest:digest('synthetic-tetra'),transformToAnalysis:[...identity],
   shape:{valid:true,connectedSolidCount:1,faceCount:4,edgeCount:6,volumeMm3:1/6,surfaceAreaMm2:2.3660254,
    boundingBoxOwnerLocalMm:{min:[0,0,0],max:[1,1,1],size:[1,1,1]}}}],
   references:([{id:'cold',role:'constraint',centroid:[0,1/3,1/3],normal:[-1,0,0]},
    {id:'heated',role:'load',centroid:[1/3,1/3,0],normal:[0,0,-1]}] as const).map(face=>({
     semanticReferenceId:face.id,domainId:'solid',ownerPartId:'part',ownerBodyId:'tetra',occurrenceId:'part',geometryKind:'FACE',
     role:face.role,sourceFeatureId:'tetra',resolutionState:'valid',resolvedAtProjectRevision:'transport-r1',
     faceOwnerLocal:{centroidPartLocalMm:[...face.centroid],areaMm2:.5,outwardDirection:[...face.normal],geometryType:'plane'}}))},
  units:{geometry:'mm',force:'N',stress:'MPa',displacement:'mm',density:'kg/m^3',acceleration:'mm/s^2',
   temperature:'degC',heatFlux:'W/m^2',heatFlow:'W',thermalConductivity:'W/(m*K)',...(transient?{time:'s',specificHeat:'J/(kg*K)'}:{})},
  materials:[{id:'conductor',name:'Synthetic conductor',model:'isotropic_linear_elastic',youngsModulusMPa:1,poissonRatio:0,
   thermalConductivityWPerMK:50,...(transient?{densityKgM3:7800,specificHeatJPerKgK:500}:{}),source:{kind:'custom',reference:'Synthetic transport fixture'}}],
  materialAssignments:[{assignmentId:'material',domainId:'solid',materialId:'conductor',volumeRegionId:'volume'}],
  loads:[{id:'flux',name:'Flux',type:'surface_heat_flux',semanticReferenceIds:['heated'],heatFluxWPerM2:1000}],
  constraints:[{id:'temperature',name:'Temperature',type:'prescribed_temperature',semanticReferenceIds:['cold'],temperatureC:20}],interactions:[],
  mesh:{dimensionality:'3d',elementFamily:'tetrahedral',order:2,globalSizeMm:.5,maximumNodes:100,maximumElements:10,qualityMetric:'provider_normalized',minimumQuality:.04},
  requestedResults:transient?['temperature_history','heat_flow_history']:['temperature','heat_flux','reaction_heat_flow'],
 } as Parameters<typeof sealNeutralSimulationRequestV2>[0]);
}
export function makeModel(request: NeutralSimulationRequestV2): NeutralFemModelV2 {
 const domain=request.model.domains[0];
 const quality={minimum:.8,average:.9,invalidElementCount:0 as const,nodeCount:10,elementCount:1,cadVolumeMm3:1/6,meshVolumeMm3:1/6,volumeRelativeError:0};
 return {schema:'tunacad-neutral-fem-model/2.0',modelId:'synthetic-mesh',requestDigest:request.requestDigest,
  projectRevision:request.model.projectRevision,modelDigest:request.model.modelDigest,coordinateSpace:'frozen_analysis',units:'mm',
  element:{family:'tetrahedral',geometryOrder:2,solutionOrder:2},nodes:structuredClone(nodes),
  volumeElements:{connectivity:[[0,1,2,3,4,5,6,7,8,9]],domainIds:['solid'],materialIds:['conductor'],volumeRegionIds:['volume']},
  boundaryFacets:{connectivity:[[0,3,2,7,8,6],[0,2,1,6,5,4]],domainIds:['solid','solid'],regionIds:['cold-region','heated-region']},
  domainRegions:[{domainId:'solid',partId:domain.partId,bodyId:domain.bodyId,occurrenceId:domain.occurrenceId,
   domainDigest:domain.domainDigest,geometryDigest:domain.geometryDigest,materialId:'conductor',volumeRegionId:'volume',
   transformToAnalysis:domain.transformToAnalysis,elementIndices:[0],nodeIndices:nodes.map((_,index)=>index)}],
  boundaryRegions:request.model.references.map((reference,index)=>({regionId:index?'heated-region':'cold-region',domainId:'solid',
   semanticReferenceIds:[reference.semanticReferenceId],sourceFeatureIds:['tetra'],facetIndices:[index],matchedCadFaceOwnerLocal:reference.faceOwnerLocal,
   match:{state:'verified',method:'geometric_signature',candidateCount:1,centroidToleranceMm:.01,areaRelativeTolerance:.01}})),
  quality:{...quality,metric:'mean_ratio',boundaryFacetCount:2,perDomain:[{...quality,domainId:'solid'}]},
  provenance:{meshProviderInterfaceVersion:'2.0',adapterId:'synthetic',adapterVersion:'1',engine:'synthetic',engineVersion:'1',
   optionsDigest:digest('synthetic'),inputGeometryDigest:request.model.modelDigest,generatedAt:new Date().toISOString()}};
}
export function createThermalTransportFixture(type: 'transient_thermal' | 'steady_thermal', preparedRequest?: NeutralSimulationRequestV2) {
 const request=preparedRequest??makeRequest(type),model=makeModel(request);validateNeutralFemModelV2(model,request);
let nativeId='';let nativeResult:NeutralSimulationResultV2;let requestedPageId='';let tamper='';
const solver:ExternalSolverProviderV2={
 id:'synthetic-solver',version:'1',capabilities:new CalculiXMultiDomainSolverProvider({executable:'fixture/ccx216.exe',runtimeVersion:'2.16'}).capabilities,
 async submit(request){
  nativeId='solver_'+crypto.randomUUID();const now=new Date().toISOString();const transient=request.analysis.type==='transient_thermal';
  const frames=request.analysis.type==='transient_thermal'?request.analysis.settings.outputTimesS:[];
  nativeResult={schema:'tunacad-neutral-simulation-result/2.0',studyId:request.studyId,jobId:nativeId,requestDigest:request.requestDigest,
   projectRevision:request.model.projectRevision,modelDigest:request.model.modelDigest,analysisType:request.analysis.type,status:'succeeded',authority:'engineering',
   metrics:{...metrics},perDomain:[{domainId:'solid',metrics:{...metrics},fieldDatasetIds:transient?frames.flatMap((_,index)=>
    ['temperature','heat-flux'].map(component=>`${nativeId}:solid:frame:${String(index+1).padStart(3,'0')}:${component}`)):
    [`${nativeId}:solid:temperature`,`${nativeId}:solid:heat-flux`]}],reactions:[],criticalRegions:[],failedConstraints:[],
   warnings:[{code:transient?'SIMULATION_TRANSIENT_THERMAL_POC':'SIMULATION_STEADY_THERMAL_POC',message:'Synthetic transport fixture only.',severity:'warning'}],
   convergence:{status:'converged',iterations:null,residual:null,providerDeclared:true},suggestedEngineeringIssues:[],
   ...(transient?{transientThermal:{formulation:'transient_isotropic_conduction',frames:frames.map((timeS,index)=>({timeS,minimumTemperatureC:20,maximumTemperatureC:21+index,
    maximumHeatFluxMagnitudeWPerM2:1000,totalAppliedHeatW:.0005,totalReactionHeatW:-.0002,storedThermalEnergyJ:.1,
    temperatureSamples:[{positionAnalysisMm:[0,0,0],temperatureC:20},{positionAnalysisMm:[1,0,0],temperatureC:21+index}]}))}}:
    {thermal:{formulation:'steady_state_isotropic_conduction',minimumTemperatureC:20,maximumTemperatureC:21,maximumTemperatureGradientCPerM:1000,
     totalAppliedHeatW:.0005,totalReactionHeatW:-.0005,heatBalanceResidualW:0,
     temperatureSamples:[{positionAnalysisMm:[0,0,0],temperatureC:20},{positionAnalysisMm:[1,0,0],temperatureC:21}]}}),
   provenance:{providerInterfaceVersion:'2.0',adapterId:'synthetic',adapterVersion:'1',providerRunId:nativeId,submittedAt:now,completedAt:now,normalizedAt:now},
   review:{engineerReviewRequired:true,engineeringUsePermitted:false,disclaimer:'Synthetic fixture, not native evidence.'},
   mutation:{occurred:false,projectRevisionBefore:request.model.projectRevision,projectRevisionAfter:request.model.projectRevision}} as NeutralSimulationResultV2;
  validateNeutralSimulationResultV2(nativeResult,request);return {providerRunId:nativeId,acceptedAt:now};
 },
 async getStatus(providerRunId){return {providerRunId,status:'succeeded',progress:1,phase:'synthetic',updatedAt:new Date().toISOString()};},
 async getResult(){return structuredClone(nativeResult);},async cancel(){throw Error('Unexpected cancellation');},
 async getFieldDataset(id,datasetId,cursor='0',limit=128){
  assert.equal(id,nativeId);assert(nativeResult.perDomain[0].fieldDatasetIds.includes(datasetId));requestedPageId=datasetId;
  const temperature=datasetId.endsWith(':temperature');const frame=Number(/:frame:(\d+):/.exec(datasetId)?.[1]??0);
  const maximumTemperature=20+(frame||1);
  const triangles=[{facetIndex:0,elementIndex:0,positionsAnalysisMm:[nodes[0],nodes[3],nodes[2]],
   displacementsMm:[[0,0,0],[0,0,0],[0,0,0]],values:temperature?[20,maximumTemperature,20]:[1000,1000,1000]}];
  return {schema:'tunacad-neutral-simulation-field-page/2.0',cursor,nextCursor:null,triangleOffset:0,triangleCount:1,chunkDigest:digest(triangles),triangles,
   dataset:{schema:'tunacad-neutral-simulation-field-dataset/2.0',datasetId:tamper==='dataset'?'foreign-dataset':datasetId,
    jobId:tamper==='job'?'foreign-job':nativeId,domainId:tamper==='domain'?'foreign-domain':'solid',
    analysisType:tamper==='analysis'?'linear_static':nativeResult.analysisType,
    step:frame?{index:frame,label:'transient_thermal',timeS:frame}:{index:0,label:'steady_thermal'},component:temperature?'temperature':'heat_flux_magnitude',unit:temperature?'degC':'W/m^2',
    location:'boundary_facet',topology:'triangle_soup',valueRange:{minimum:temperature?20:1000,maximum:temperature?maximumTemperature:1000,minimumPositionAnalysisMm:nodes[0],maximumPositionAnalysisMm:nodes[3]},
    deformation:{vectorsIncluded:true,trueScale:1,recommendedScale:1},mapping:{domain:'exact',cadRegions:'exact',semanticReferenceIds:['cold','heated']},
    totalTriangles:1,maximumPageTriangles:128,datasetDigest:digest(triangles)}} as NeutralSimulationFieldPageV2;
 },
};
 const mesher=new GmshMultiDomainMeshProvider({executable:'fixture/gmsh.exe',runtimeVersion:'4.15.2',maximumDomains:1});mesher.mesh=async()=>structuredClone(model);
 const provider=new ComposedSimulationProviderV2({id:'synthetic-composed',version:'1',meshProvider:mesher,solverProvider:solver});
 return {request,model,provider,solver,get nativeResult(){return nativeResult;},get requestedPageId(){return requestedPageId;},
  get tamper(){return tamper;},set tamper(value:string){tamper=value;}};
}
