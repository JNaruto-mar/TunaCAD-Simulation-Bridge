// Controlled pairing only; no owner, provider, storage or solver is started.
import assert from 'node:assert/strict';import {createHmac,randomBytes} from 'node:crypto';
import {NEW_PROJECT_RESULT_CAPTURE_ENABLED} from '../src/simulation/projectResultDeliveryPolicy.ts';
import {startSimulationBridge} from '../simulation-bridge/server.mts';
assert.equal(NEW_PROJECT_RESULT_CAPTURE_ENABLED,false);let approvals=0;
const origin='http://127.0.0.1:8080',bridge=await startSimulationBridge({port:0,allowedOrigin:origin,provider:null,providerElectrical:null,
 readiness:{ready:false,provider:null,meshing:{ready:false,adapterVersion:'controlled',runtimeVersion:null,geometryFormats:[],elementFamilies:[]},solving:{ready:false,adapterVersion:'controlled',runtimeVersion:null,analysisTypes:[]}},async approve(){approvals++;throw Error('Approval must not be reached');}});
try{const challenge=randomBytes(32).toString('hex'),paired=await fetch(bridge.url+'/v1/pair',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({challenge,proof:createHmac('sha256',bridge.pairingCode).update('client:'+challenge).digest('hex')})});
 assert.equal(paired.status,200);const token=(await paired.json()).sessionToken;
 const denied=await fetch(bridge.url+'/v1/jobs/controlled/project-result',{headers:{Origin:origin}});assert.equal(denied.status,401);
 const disabled=await fetch(bridge.url+'/v1/jobs/controlled/project-result',{headers:{Origin:origin,Authorization:'Bearer '+token}});assert.equal(disabled.status,403);assert.equal((await disabled.json()).error,'BRIDGE_PROJECT_RESULT_CAPTURE_DISABLED');assert.equal(approvals,0);
 console.log(JSON.stringify({status:'PASS',captureEnabled:false,checks:4,authentication:'CONTROLLED ONLY',nativeSolvers:0,protectedStorageOperations:0,engineeringUsePermitted:false}));
}finally{await bridge.close();}
