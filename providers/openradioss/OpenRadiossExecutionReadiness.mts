import { digest } from '../../simulation-bridge/stableDigest.mts';
import { release } from 'node:os';

// Policy ceilings, not observations. No TTL or numerical policy is changed.
export const EXECUTION_STAGE_BUDGET_MS = Object.freeze({ source:25000, runtime:25000,
  storage:15000, starter:65000, handoff:30000, engine:65000, recovery:20000,
  durable:25000, finalization:10000 });
export const REQUIRED_EXECUTION_HEADROOM_MS = Object.values(EXECUTION_STAGE_BUDGET_MS).reduce((a,b)=>a+b,0);
export type ExecutionStage=keyof typeof EXECUTION_STAGE_BUDGET_MS;
export type HeadroomIdentity=Readonly<{authorityId:string;expiresAt:number;lineageDigest:string}>;
export type HeadroomProof=Readonly<{authorityId:string;lineageDigest:string;outputDigest:string}>;
const headroomLedgers=new WeakSet<object>();
/** Trusted Node/provider port only, never request data. Snapshots/JSON/boolean
 * completion claims cannot discharge work. Each discharge executes a read/work
 * and an authoritative component verifier, bound to this exact lineage.
 * Invalidation does not reset the separate cumulative stage-time ceilings. */
export function createExecutionHeadroomLedger(identity:HeadroomIdentity,now:()=>number=Date.now){
  if(!identity.authorityId||!Number.isFinite(identity.expiresAt)||!/^sha256:[a-f0-9]{64}$/.test(identity.lineageDigest))
    throw new Error('EXECUTION_HEADROOM_IDENTITY_INVALID');
  const bound=Object.freeze({...identity}),completed=new Map<ExecutionStage,Readonly<Record<string,unknown>>>();
  const stages=Object.keys(EXECUTION_STAGE_BUDGET_MS) as ExecutionStage[];
  const generations=new Map(stages.map(s=>[s,0]));
  const valid=(stage:ExecutionStage)=>{if(!stages.includes(stage))throw new Error('EXECUTION_HEADROOM_STAGE_INVALID');};
  const unexpired=()=>{if(!Number.isFinite(now())||now()>=bound.expiresAt)throw new Error('EXECUTION_AUTHORITY_EXPIRED');};
  const ledger=Object.freeze({identity:bound,
    snapshot(){const required=stages.filter(s=>!completed.has(s));return Object.freeze({requiredMs:required.reduce((sum,s)=>sum+EXECUTION_STAGE_BUDGET_MS[s],0),
      requiredStages:Object.freeze(required),completed:Object.freeze([...completed.values()])});},
    invalidate(stage:ExecutionStage){valid(stage);completed.delete(stage);generations.set(stage,generations.get(stage)!+1);},
    invalidateAll(){completed.clear();stages.forEach(s=>generations.set(s,generations.get(s)!+1));},
    async verifyStages<T>(selected:readonly ExecutionStage[],work:()=>Promise<T>,verify:(stage:ExecutionStage,value:T)=>HeadroomProof|Promise<HeadroomProof>){
      if(!selected.length||new Set(selected).size!==selected.length||typeof work!=='function'||typeof verify!=='function')
        throw new Error('AUTHORITATIVE_HEADROOM_EVIDENCE_REQUIRED');
      selected.forEach(s=>{valid(s);completed.delete(s);generations.set(s,generations.get(s)!+1);});
      const epochs=selected.map(s=>generations.get(s));unexpired();
      const value=await work();const proofs:Readonly<Record<string,unknown>>[]=[];
      for(const stage of selected){const proof=await verify(stage,value);
        if(!proof||Object.keys(proof).sort().join(',')!=='authorityId,lineageDigest,outputDigest'||
          proof.authorityId!==bound.authorityId||proof.lineageDigest!==bound.lineageDigest||proof.outputDigest!==digest(value))
          throw new Error('AUTHORITATIVE_HEADROOM_EVIDENCE_INVALID');
        proofs.push(Object.freeze({schema:'tunacad-execution-headroom-stage/1',stage,...proof}));}
      unexpired();if(selected.some((s,i)=>generations.get(s)!==epochs[i]))throw new Error('EXECUTION_HEADROOM_EVIDENCE_INVALIDATED');
      selected.forEach((s,i)=>completed.set(s,proofs[i]));return value;
    },
  });headroomLedgers.add(ledger);return ledger;
}
export type ExecutionHeadroomLedger=ReturnType<typeof createExecutionHeadroomLedger>;
export function requireExecutionHeadroomBinding(ledger:ExecutionHeadroomLedger,identity:HeadroomIdentity){
  if(!headroomLedgers.has(ledger)||digest(ledger.identity)!==digest(identity))throw new Error('EXECUTION_HEADROOM_LINEAGE_MISMATCH');
}
export function admitExecutionDeadline(expiresAt:number, now=Date.now(),ledger?:ExecutionHeadroomLedger) {
  if(!Number.isFinite(expiresAt)||!Number.isFinite(now)||now>=expiresAt)throw new Error('EXECUTION_AUTHORITY_EXPIRED');
  if(ledger&&(!headroomLedgers.has(ledger)||ledger.identity.expiresAt!==expiresAt))throw new Error('EXECUTION_HEADROOM_LINEAGE_MISMATCH');
  const required=ledger?ledger.snapshot().requiredMs:REQUIRED_EXECUTION_HEADROOM_MS;
  if(expiresAt-now<required)
    throw new Error('EXECUTION_HEADROOM_INSUFFICIENT');
  return Object.freeze({remainingMs:expiresAt-now,requiredMs:required,
    budgets:EXECUTION_STAGE_BUDGET_MS,authorityRenewed:false});
}
/** Only read-only work: timeout never grants execution or suppresses cleanup. */
export async function boundedReadinessRead<T>(stage:keyof typeof EXECUTION_STAGE_BUDGET_MS,
  read:()=>Promise<T>,expiresAt:number,now:()=>number=Date.now):Promise<T> {
  const limit=Math.min(EXECUTION_STAGE_BUDGET_MS[stage],expiresAt-now());
  if(limit<=0)throw new Error('EXECUTION_AUTHORITY_EXPIRED');
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {const value=await Promise.race([read(),new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>reject(new Error('EXECUTION_STAGE_BUDGET_EXCEEDED: '+stage)),limit);
  })]);if(now()>=expiresAt)throw new Error('EXECUTION_AUTHORITY_EXPIRED');return value;}
  finally {if(timer)clearTimeout(timer);}
}
const executionBudgets=new WeakSet<object>();
export function createExecutionBudget(expiresAt:number,now:()=>number=Date.now){
  const spent=Object.fromEntries(Object.keys(EXECUTION_STAGE_BUDGET_MS).map(k=>[k,0])) as Record<keyof typeof EXECUTION_STAGE_BUDGET_MS,number>;
  const operations:Array<Readonly<Record<string,unknown>>>=[];let verifying=false,dropped=0;
  const budget={expiresAt,snapshot:()=>({...spent}),diagnostics:()=>({
    stages:Object.fromEntries(Object.entries(spent).map(([stage,value])=>[stage,{ceilingMs:EXECUTION_STAGE_BUDGET_MS[stage as ExecutionStage],
      spentMs:value,remainingMs:Math.max(0,EXECUTION_STAGE_BUDGET_MS[stage as ExecutionStage]-value)}])),
    operations:[...operations],dropped}),
    async verify<T>(stage:'source'|'storage'|'runtime',operation:string,work:()=>Promise<T>):Promise<T>{
      if(verifying)throw new Error('VERIFICATION_OWNER_NESTING_REJECTED');
      verifying=true;try{return await budget.run(stage,work,false,operation);}finally{verifying=false;}
    },async run<T>(stage:keyof typeof EXECUTION_STAGE_BUDGET_MS,work:()=>Promise<T>,retention=false,operation='stage_work'):Promise<T>{
    if(!Object.hasOwn(EXECUTION_STAGE_BUDGET_MS,stage)||!Number.isFinite(expiresAt)||!/^[a-zA-Z0-9_:-]{1,80}$/.test(operation))
      throw new Error('EXECUTION_BUDGET_OPERATION_INVALID');
    const start=now(),remaining=EXECUTION_STAGE_BUDGET_MS[stage]-spent[stage];
    const timeout=Math.min(remaining,retention?Infinity:expiresAt-start);
    let timer:ReturnType<typeof setTimeout>|undefined,passed=false;
    const fail=(kind:string)=>new Error(kind+': '+stage+'; operation='+operation);
    try{if(timeout<=0)throw fail('EXECUTION_STAGE_BUDGET_EXHAUSTED');
      const value=await Promise.race([work(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(fail('EXECUTION_STAGE_BUDGET_EXCEEDED')),timeout);})]);
      if(now()-start>timeout||!retention&&now()>=expiresAt)throw fail('EXECUTION_STAGE_BUDGET_EXCEEDED');
      passed=true;
      return value;}
    finally{const end=now(),elapsed=Math.max(0,end-start);spent[stage]+=elapsed;if(timer)clearTimeout(timer);
      operations.push(Object.freeze({stage,operation,startMs:start,endMs:end,elapsedMs:elapsed,passed,
        spentMs:spent[stage],remainingMs:Math.max(0,EXECUTION_STAGE_BUDGET_MS[stage]-spent[stage])}));
      if(operations.length>64){operations.shift();dropped++;}}
  }};executionBudgets.add(budget);return budget;
}
export type ExecutionBudget=ReturnType<typeof createExecutionBudget>;
export function requireExecutionBudgetBinding(budget:ExecutionBudget,expiresAt:number){
  if(!executionBudgets.has(budget)||budget.expiresAt!==expiresAt)throw new Error('EXECUTION_BUDGET_LINEAGE_MISMATCH');
}
export const EXPLICIT_ARTIFACT_POLICY = Object.freeze({schema:'tunacad-explicit-artifact-policy/1',
  restartBytes:16*1024*1024,rawBytes:8*1024*1024,stageBytes:64*1024*1024,count:8,jsonBytes:2*1024*1024});
export const EXPLICIT_ARTIFACT_POLICY_DIGEST=digest(EXPLICIT_ARTIFACT_POLICY);
export function artifactByteLimit(name:string){
  if(!/^[A-Za-z0-9_.-]+$/.test(name))throw new Error('ARTIFACT_NAME_INVALID');
  return name.endsWith('.rst')?EXPLICIT_ARTIFACT_POLICY.restartBytes:EXPLICIT_ARTIFACT_POLICY.rawBytes;
}
export function validateArtifactPins(pins:Record<string,{bytes:number;sha256:string}>) {
  const entries=Object.entries(pins);
  if(!entries.length||entries.length>EXPLICIT_ARTIFACT_POLICY.count)throw new Error('ARTIFACT_COUNT_INVALID');
  let total=0;for(const [name,p] of entries){
    if(!Number.isSafeInteger(p.bytes)||p.bytes<1||p.bytes>artifactByteLimit(name)||!/^[a-f0-9]{64}$/.test(p.sha256))
      throw new Error('ARTIFACT_BOUND_INCOMPATIBLE');total+=p.bytes;
  }if(total>EXPLICIT_ARTIFACT_POLICY.stageBytes)throw new Error('ARTIFACT_TOTAL_BOUND');
}
export const OWNED_TREE_READINESS=Object.freeze({ready:process.platform==='win32'&&process.arch==='x64'&&Number(release().split('.')[0])>=10,code:'WINDOWS_ATOMIC_JOB_CONTAINMENT',
  preAssignmentDescendantsProven:true,abruptWrapperSurvivorsProven:true,
  reason:'Windows10+ atomic job-list suspended creation, verified assignment before resume, exclusive non-inherited kill-on-close ownership.'});
export function requireOwnedTreeReadiness():void {if(!OWNED_TREE_READINESS.ready)throw new Error('WINDOWS_ATOMIC_JOB_CONTAINMENT_REQUIRED');}
export function assessDevelopmentValidation(provider:'succeeded'|'failed'|'cancelled'|null,
  oracle:'PASS'|'FAIL'|'PENDING',evidenceVerified:boolean,infrastructureFailure=false){
  return {PROVIDER_EXECUTION_RESULT:provider??'unverified',AXIAL_BAR_ORACLE_V2_RESULT:oracle,
    EXPLICIT_DYNAMICS_DEVELOPMENT_VALIDATION:infrastructureFailure?'infrastructure_failure':!evidenceVerified||provider===null?
      'incomplete_unverified_evidence':provider!=='succeeded'?'provider_failed':oracle==='PASS'?
      'provider_succeeded_oracle_PASS':oracle==='FAIL'?'provider_succeeded_oracle_FAIL':'incomplete_unverified_evidence'} as const;
}
export function classifyFinalReceipt(r:Record<string,any>):'succeeded'|'failed'|'cancelled'|null {
  if(r.phase==='late_cancellation_quarantined')return r.cancelled===true&&r.quarantined===true?'cancelled':'failed';
  if(r.phase==='retrieval_quarantined')return 'failed';
  if(r.phase!=='finalized')return null;
  if(r.cleaned!==true||r.treeTerminated!==true||r.failure&&!(r.cancelled===true&&r.failure==='Error: Cancelled explicit run'))return 'failed';
  if(r.cancelled===true)return 'cancelled';
  return r.cancelled===false&&r.quarantined===false&&typeof r.resultDigest==='string'&&/^sha256:[a-f0-9]{64}$/.test(r.resultDigest)?'succeeded':'failed';
}
export function explicitFailureDisposition(stage:string,claimed:boolean,treeSafe:boolean,durableFailed:boolean,cancelled=false,cleanupSucceeded=true){
  if(stage==='oracle')return {automaticRetry:false,authorityConsumed:claimed,quarantine:false,resultPublishedByProvider:true,
    scratch:'already_cleaned',terminal:'provider_succeeded_oracle_FAIL'} as const;
  if(!claimed)return {automaticRetry:false,authorityConsumed:false,quarantine:false,resultPublishedByProvider:false,
    scratch:'none',terminal:'rejected_before_claim'} as const;
  const retain=!treeSafe||durableFailed||!cleanupSucceeded;
  return {automaticRetry:false,authorityConsumed:true,quarantine:true,resultPublishedByProvider:false,
    scratch:retain?'retain':'delete_after_capture',terminal:cancelled&&!retain?'cancelled':'failed'} as const;
}
export function cimDisposition(available:boolean,provenanceReady:boolean,treeReady:boolean){
  return {diagnostic:available?'CIM_OBSERVER_READY':'CIM_OBSERVER_UNAVAILABLE',
    nonBlocking:provenanceReady&&treeReady,executionPermitted:provenanceReady&&treeReady};
}
