import {ELECTROSTATIC_SLAB_LIMITS} from './electrostaticSlabLimits.mjs';
// Shared bounded consent for manual controls and authenticated client calls.
// Device pairing is NOT consent. Only an owner-approved scope creates a session.
// No credentials, files, reservations, recovery records or native processes here.
const fail=code=>{throw Error('SIMULATION_SESSION_'+code);};
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
const text=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(v);
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
export const TRUSTED_SIMULATION_CAPABILITIES=Object.freeze(['linear_static','modal','linear_buckling','static_contact','nonlinear_static','steady_thermal','thermal','transient_thermal','thermoelastic','implicit_dynamics','harmonic_response','centrifugal_static','explicit_structural_dynamics','electrostatic']);
export function validateSimulationSessionScope(value){
 if(!plain(value)||Object.keys(value).some(k=>!['workspaceId','clients','capabilities','maximumJobs','maximumMeshes','maximumSolverProcesses','maximumNodes','maximumElements'].includes(k))||!text(value.workspaceId))fail('SCOPE_INVALID');
 const list=(v,allowed)=>Array.isArray(v)&&v.length>0&&v.length<=32&&new Set(v).size===v.length&&v.every(x=>text(x)&&(!allowed||allowed.includes(x)));
 if(!list(value.clients)||!list(value.capabilities,TRUSTED_SIMULATION_CAPABILITIES)||!integer(value.maximumJobs,1,10000)||!integer(value.maximumMeshes,1,10000)||!integer(value.maximumSolverProcesses,1,20000)||!integer(value.maximumNodes,1,1000000)||!integer(value.maximumElements,1,500000))fail('SCOPE_INVALID');
 return Object.freeze({...structuredClone(value),clients:Object.freeze([...value.clients]),capabilities:Object.freeze([...value.capabilities])});
}
export function simulationRequestCost(request){
 const capability=request?.analysis?.type;
 if(!TRUSTED_SIMULATION_CAPABILITIES.includes(capability)||!/^sha256:[a-f0-9]{64}$/.test(request?.requestDigest))fail('REQUEST_INVALID');
 const mesh=capability==='electrostatic'&&request.schema==='tunacad-electrostatic-foundation/0.1'?ELECTROSTATIC_SLAB_LIMITS:request.mesh;
 const nodes=mesh?.maximumNodes??100000,elements=mesh?.maximumElements??50000;
 if(!integer(nodes,1,1000000)||!integer(elements,1,500000))fail('RESOURCE_INVALID');
 return {capability,requestDigest:request.requestDigest,jobs:1,meshes:1,solverProcesses:capability==='explicit_structural_dynamics'?2:1,nodes,elements};
}
/** approve() is the existing native/terminal human boundary, never a request
 * parameter. Controlled tests must label their callback evidence explicitly. */
export async function authorizeSimulationSession({scope,deviceId,origin,approve,resolveClient,id=crypto.randomUUID(),onRevoke=async()=>{}}){
 scope=validateSimulationSessionScope(scope);
 if(!text(deviceId)||typeof resolveClient!=='function'||typeof approve!=='function'||new URL(origin).origin!==origin)fail('CONTEXT_INVALID');
 let controller=new AbortController();let revoked=false,pending=false,reviewing=false,epoch=0,used={jobs:0,meshes:0,solverProcesses:0};
 const review=Object.freeze({schema:'tunacad-trusted-simulation-consent/1',deviceId,origin,...scope,engineeringUsePermitted:false});
 if(await approve(review)!==true)fail('DECLINED');
 const revoke=()=>{if(pending)return pending;revoked=true;epoch++;controller.abort(Error('SIMULATION_SESSION_REVOKED'));return pending=Promise.resolve().then(onRevoke);};
 const current=()=>{if(revoked)fail('REVOKED');};
 const verifyContext=async context=>{
  if(!plain(context)||context.workspaceId!==scope.workspaceId||context.deviceId!==deviceId||context.origin!==origin)fail('CONTEXT_MISMATCH');
  const client=await resolveClient(context.clientId);
  if(!scope.clients.includes(client))fail('CLIENT_DENIED');
  return client;
 };
 const check=async(context,request)=>{
  current();const client=await verifyContext(context);current();const cost=simulationRequestCost(request);
  if(!scope.capabilities.includes(cost.capability)||cost.nodes>scope.maximumNodes||cost.elements>scope.maximumElements)fail('OUT_OF_SCOPE');
  return {client,cost};
 };
 return Object.freeze({id,get scope(){return scope;},deviceId,origin,get signal(){return controller.signal;},verifyContext,
  // Only a new explicit scope request opens consent, never ordinary work or
  // elapsed time. Existing jobs keep their original admitted limits.
  async authorizeScope(replacement){if(reviewing)fail('CONSENT_PENDING');const next=validateSimulationSessionScope(replacement);if(next.workspaceId!==scope.workspaceId)fail('CONTEXT_MISMATCH');reviewing=true;const before=epoch;
   try{await resolveClient('manual');if(await approve({...review,...next,scopeChange:true})!==true)fail('DECLINED');if(epoch!==before)fail('REVOKED_DURING_REVIEW');
    scope=next;used={jobs:0,meshes:0,solverProcesses:0};revoked=false;pending=false;controller=new AbortController();return this.status();
   }finally{reviewing=false;}},
  async check(context,request){await check(context,request);return true;},
  async admit(context,request){const {client,cost}=await check(context,request);current();
   // Synchronous commit after asynchronous identity checks; concurrent callers
   // cannot exceed totals. A denied/out-of-scope operation never opens consent.
   if(used.jobs+cost.jobs>scope.maximumJobs||used.meshes+cost.meshes>scope.maximumMeshes||used.solverProcesses+cost.solverProcesses>scope.maximumSolverProcesses)fail('BUDGET_EXHAUSTED');
   used={jobs:used.jobs+cost.jobs,meshes:used.meshes+cost.meshes,solverProcesses:used.solverProcesses+cost.solverProcesses};
   return Object.freeze({sessionId:id,client,requestDigest:cost.requestDigest,workspaceId:scope.workspaceId});
  },
  status(){return {id,workspaceId:scope.workspaceId,clients:[...scope.clients],capabilities:[...scope.capabilities],revoked,used:{...used},limits:{...scope},engineeringUsePermitted:false};},revoke,
 });
}
