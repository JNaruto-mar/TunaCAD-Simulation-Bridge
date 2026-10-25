// Controlled consent only. No human approval, solver or protected storage.
import assert from 'node:assert/strict';
import {authorizeSimulationSession,validateSimulationSessionScope} from '../simulation-bridge/trustedSimulationSession.mjs';
let prompts=0,allow=true,revocations=0,checks=0;
const scope={workspaceId:'editable-project',clients:['manual','codex'],capabilities:['electrostatic','linear_static'],maximumJobs:3,maximumMeshes:3,maximumSolverProcesses:3,maximumNodes:8000,maximumElements:4000};
const session=await authorizeSimulationSession({scope,deviceId:'trusted-device',origin:'https://tunacad.com',
 async approve(review){assert(!('durationMs' in (review as any)));prompts++;return allow;},resolveClient:async id=>id==='manual'?'manual':id==='verified-relay'?'codex':'unknown',onRevoke:async()=>{revocations++;}});
const manual={deviceId:'trusted-device',origin:'https://tunacad.com',workspaceId:'editable-project',clientId:'manual'},ai={...manual,clientId:'verified-relay'};
const request=(n:number)=>({analysis:{type:'electrostatic'},requestDigest:'sha256:'+String(n).padStart(64,'0'),mesh:{maximumNodes:8000,maximumElements:4000}});
await session.admit(manual,request(1));await session.admit(ai,request(2));await session.admit(manual,request(3));assert.equal(prompts,1);assert.equal(session.status().used.jobs,3);checks++;
await assert.rejects(()=>session.admit(manual,request(4)),/BUDGET_EXHAUSTED/);checks++;
for(const change of [{workspaceId:'other'},{origin:'https://other.example'},{deviceId:'other'}])await assert.rejects(()=>session.check({...manual,...change},request(4)),/CONTEXT_MISMATCH/);
await assert.rejects(()=>session.check({...ai,clientId:'codex'},request(4)),/CLIENT_DENIED/);checks++;
await assert.rejects(()=>session.check(manual,{...request(5),mesh:{maximumNodes:8001,maximumElements:4000}}),/OUT_OF_SCOPE/);checks++;
const date=Date.now;try{Date.now=()=>date()+365*24*3600000;assert.equal(await session.check(ai,request(6)),true);assert.equal(session.signal.aborted,false);assert(!('expiresAt' in session));assert(!('expired' in session.status()));assert.equal(revocations,0);}finally{Date.now=date;}checks++;
const id=session.id;await session.authorizeScope({...scope,maximumJobs:4,maximumMeshes:4,maximumSolverProcesses:4});assert.equal(session.id,id);assert.equal(prompts,2);assert.equal(session.status().used.jobs,0);checks++;
allow=false;await assert.rejects(()=>session.authorizeScope(scope),/DECLINED/);assert.equal(session.scope.maximumJobs,4);checks++;
allow=true;await session.revoke();assert.equal(revocations,1);await assert.rejects(()=>session.admit(ai,request(7)),/REVOKED/);assert.equal(await session.verifyContext(manual),'manual');checks++;
await session.authorizeScope(scope);assert.equal(session.status().revoked,false);assert.equal(session.id,id);checks++;
const results=await Promise.allSettled([session.admit(ai,request(8)),session.admit(manual,request(9)),session.admit(ai,request(10)),session.admit(manual,request(11))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,3);assert.equal(session.status().used.jobs,3);checks++;
assert.throws(()=>validateSimulationSessionScope({...scope,durationMs:18000000}),/SCOPE_INVALID/);assert.throws(()=>validateSimulationSessionScope({...scope,maximumNodes:Infinity}),/SCOPE_INVALID/);checks++;
await session.revoke();console.log(JSON.stringify({status:'PASS',checks,consent:'CONTROLLED ONLY',nativeSolvers:0,protectedStorageOperations:0,noAuthorizationAgeTimeout:true,engineeringUsePermitted:false}));
