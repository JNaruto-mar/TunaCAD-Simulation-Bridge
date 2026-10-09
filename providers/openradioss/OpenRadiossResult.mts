import { digest } from '../../simulation-bridge/stableDigest.mts';
import { parseBoundedOpenRadiossTFile4 } from '../../simulation-bridge/openRadiossBinaryTFileParser.mts';
import { readOpenRadiossCycleTrace } from '../../simulation-bridge/openRadiossHistoryCoverage.mts';
import type { ExplicitDynamicsResult, ExplicitDynamicsFieldPage } from '../../src/simulation/explicitDynamicsProviderContracts.ts';
import type { PreparedOpenRadioss } from './OpenRadiossDeck.mts';
import {normalizeExplicitHistoryNode,assertExplicitResultByteBudget} from './OpenRadiossHistoryResource.mts';
import {assertExplicitLoadResolution} from '../../simulation-bridge/explicitLoadHistory.mts';

export function recoverOpenRadiossResult(prepared:PreparedOpenRadioss, bytes:Buffer, trace:string, listing:string,
  identity:{providerRunId:string;providerId:string;providerVersion:string;runtimeDigest:string;artifacts:Record<string,string>;provenanceDigest:string}) {
  const fail=(why:string):never=>{throw new Error('OpenRadioss result: '+why);};
  if(!/NORMAL TERMINATION/.test(listing)||/\b(?:NaN|Infinity)\b/i.test(listing+trace)) fail('abnormal/nonfinite execution');
  const totals=[...listing.matchAll(/TOTAL NUMBER OF CYCLES\s*:\s*(\d+)/g)];
  if(totals.length!==1) fail('missing/ambiguous completed cycle count');
  const actualCycles=Number(totals[0][1]);
  if(actualCycles>prepared.request.analysis.integration.maximumIncrements || actualCycles>20000) fail('increment resource bound');
  const cycles=readOpenRadiossCycleTrace(trace,actualCycles);
  assertExplicitLoadResolution(prepared.request.load.history,prepared.request.analysis.durationS,
    cycles.reduce((maximum,c)=>Math.max(maximum,c.timestepS),0));
  if(cycles.some(c=>c.timestepS>prepared.request.analysis.integration.maximumTimeStepS)) fail('actual-cycle timestep resource bound');
  const history=parseBoundedOpenRadiossTFile4(bytes,prepared.request.analysis.durationS,
    {method:'frozen-2026-cycle-trace',cycleTrace:trace,completedCycles:actualCycles,
      historyIntervalS:prepared.historyIntervalS,engineExitCode:0,normalTermination:true},
    {nodeCount:prepared.expected.nodeCount,elementCount:prepared.expected.elementCount},prepared.expected.historyNodeIds);
  const coverage=history.coverage;
  if(!coverage?.complete || coverage.rule!=='frozen-2026-cycle-trace') throw new Error('Incomplete actual-cycle scheduled coverage');
  if(history.frames.some(f=>f.global.timestepS>prepared.request.analysis.integration.maximumTimeStepS ||
    f.global.kineticEnergyNmm<0 || f.global.internalEnergyNmm<0 || f.global.addedMassMg>0 ||
    Math.abs(f.global.massMg-prepared.expected.massMg)>prepared.expected.massMg*2**-22)) fail('mass/energy/timestep integrity');
  const fixed=new Set(prepared.expected.fixedNodeIds);
  for(const f of history.frames) for(const [id,n] of f.nodes) {
    if(fixed.has(id)&&(n.dxMm!==0||n.vxMmPerS!==0||n.axMmPerS2!==0)) fail('prescribed fixed-node motion');
    if(f.timeS===0&&(n.dxMm!==0||n.vxMmPerS!==0)) fail('nonzero initial state');
  }
  const frames=history.frames.map(f=>({timeS:f.timeS,timestepS:f.global.timestepS,
    nodes:[...f.nodes].map(([nodeId,n])=>normalizeExplicitHistoryNode(nodeId,fixed.has(nodeId)?'fixed':prepared.expected.loadedNodeIds.includes(nodeId)?'loaded':'monitor',n)),
    supportImpulseNs:[...f.nodes].filter(([id])=>fixed.has(id)).reduce((s,[,n])=>s+n.reactionImpulseNs,0),
    supportReactionN:[...f.nodes].filter(([id])=>fixed.has(id)).reduce((s,[,n])=>s+n.reactionForceN,0),
    kineticEnergyNmm:f.global.kineticEnergyNmm,internalEnergyNmm:f.global.internalEnergyNmm,externalWorkNmm:f.global.externalWorkNmm,
    totalMassKg:f.global.massMg*1000,addedMassKg:f.global.addedMassMg*1000,
    addedMassChangeKg:f.global.addedMassChangeFromInitializationMg*1000}));
  // The range is execution evidence, not merely the sampled T-file dt values.
  const steps=cycles.map(c=>c.timestepS);
  const requestedTimeSamples=prepared.request.analysis.outputTimesS.map(requestedTimeS=>{
    let frameIndex=0;
    frames.forEach((f,i)=>{if(Math.abs(f.timeS-requestedTimeS)<Math.abs(frames[frameIndex].timeS-requestedTimeS)) frameIndex=i;});
    if(Math.abs(frames[frameIndex].timeS-requestedTimeS)>prepared.historyIntervalS+Math.max(...steps)) fail('uncovered requested time');
    return {requestedTimeS,frameIndex,actualTimeS:frames[frameIndex].timeS};
  });
  const r=prepared.request;
  // Private validated candidate only. The lifecycle adds succeeded/cleanup and
  // seals the final result digest AFTER cleanup actually succeeds.
  const unsigned:Omit<ExplicitDynamicsResult,'resultDigest'|'executionStatus'|'cleanupConfirmed'>={schema:'tunacad-explicit-dynamics-result/0.1',
    studyId:r.studyId,providerRunId:identity.providerRunId,requestDigest:r.requestDigest,revision:r.model.projectRevision,
    domainId:r.model.domainId,bodyId:r.model.bodyId,geometryDigest:r.model.geometryDigest,materialDigest:digest(r.material),
    provider:{id:identity.providerId,version:identity.providerVersion,runtimeVersion:'2026',runtimeDigest:identity.runtimeDigest},
    meshDigest:prepared.meshDigest,durationS:r.analysis.durationS,actualCycles,
    timestepRangeS:[Math.min(...steps),Math.max(...steps)],
    sampling:{axis:'X',location:'nodal',scope:prepared.expected.monitoringFaces?'selected_FACE_nodes':'fixed_and_loaded_FACE_nodes_only',monitoredNodeIds:[...history.nodeIds],
      faceMappingDigest:prepared.faceMappingDigest,fixedNodeIds:[...prepared.expected.fixedNodeIds],loadedNodeIds:[...prepared.expected.loadedNodeIds],
      ...(prepared.expected.monitoringFaces?{monitoringFaces:structuredClone(prepared.expected.monitoringFaces)}:{})},
    units:{time:'s',displacement:'mm',velocity:'mm/s',acceleration:'mm/s^2',impulse:'N*s',force:'N',energy:'N*mm',mass:'kg'},
    frames,requestedTimeSamples,cycleEvidence:{digest:coverage.cycleTraceSha256,
      orderedCycles:cycles.map(c=>({cycle:c.cycle,timeS:c.timeS,timestepS:c.timestepS}))},
    coverageDigest:digest(coverage),actualMassScaling:false,
    artifacts:identity.artifacts,provenanceDigest:identity.provenanceDigest,
    diagnostics:[prepared.expected.monitoringFaces?'Axial X histories at admitted monitoring FACEs plus fixed/load diagnostics; not full-mesh or 3D vector fields.':'Axial X histories at all admitted fixed/loaded FACE nodes only; not full-mesh or 3D vector fields.',
      'Raw impulse preserved; support force is forward/centered/backward dI/dt.',
      'Requested-time samples identify authentic nearest frames without interpolation.',
      'Constant negative added-mass initialization roundoff is retained; no positive addition or later change allowed.'],
    status:'proof_of_concept',engineeringUsePermitted:false};
  // Full real payload, including authentic cycle trace, must still fit the
  // unchanged durable boundary. Reject before a result can be published.
  assertExplicitResultByteBudget({...unsigned,executionStatus:'succeeded',cleanupConfirmed:true,resultDigest:'sha256:'+'0'.repeat(64)});
  return unsigned;
}
const fields={displacement:['displacementMm','mm'],velocity:['velocityMmPerS','mm/s'],acceleration:['accelerationMmPerS2','mm/s^2'],
  reactionImpulse:['reactionImpulseNs','N*s'],reactionForce:['reactionForceN','N']} as const;
export function pageExplicitResult(result:ExplicitDynamicsResult, frameIndex:number, quantity:ExplicitDynamicsFieldPage['quantity'],cursor?:string,limit=10):ExplicitDynamicsFieldPage {
  if(!Number.isInteger(frameIndex)||frameIndex<0||frameIndex>=result.frames.length||!Object.hasOwn(fields,quantity)||
    !Number.isInteger(limit)||limit<1||limit>128) throw new Error('Invalid explicit field/page request');
  const [key,unit]=fields[quantity],frame=result.frames[frameIndex];
  const values=frame.nodes.map(n=>({nodeId:n.nodeId,value:n[key]}));
  const datasetId=digest({result:result.resultDigest,domainId:result.domainId,frameIndex,timeS:frame.timeS,quantity});
  const datasetDigest=digest(values);
  let offset=0;
  if(cursor!==undefined) {
    const match=cursor.match(/^(sha256:[a-f0-9]{64}):(\d+)$/);
    if(!match||match[1]!==datasetId) throw new Error('Cross-result/frame/dataset cursor');
    offset=Number(match[2]); if(!Number.isSafeInteger(offset)||offset<=0||offset>=values.length) throw new Error('Invalid explicit cursor');
  }
  const chunk=values.slice(offset,offset+limit), next=offset+chunk.length;
  return {schema:'tunacad-explicit-dynamics-field-page/0.1',providerRunId:result.providerRunId,resultDigest:result.resultDigest,
    datasetId,datasetDigest,frameIndex,timeS:frame.timeS,domainId:result.domainId,location:'nodal',axis:'X',quantity,unit,offset,
    total:values.length,nextCursor:next<values.length?`${datasetId}:${next}`:null,values:chunk,chunkDigest:digest(chunk)};
}
