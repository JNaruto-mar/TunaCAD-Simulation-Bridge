// Focused contract/native serialization checks. No CAD, Gmsh or solver process.
import assert from 'node:assert/strict';
import {explicitLoadHistoryPoints,assertExplicitLoadResolution} from '../simulation-bridge/explicitLoadHistory.mts';
import {sealExplicitDynamics,validateExplicitDynamics,explicitAxialBarReference} from '../simulation-bridge/explicitDynamicsFoundation.mts';
import {prepareOpenRadiossDeck} from '../providers/openradioss/OpenRadiossDeck.mts';
import {digest} from '../simulation-bridge/stableDigest.mts';
import {admitOpenRadiossStarter} from '../providers/openradioss/OpenRadiossStarterAdmission.mts';
import {readBoundedStarterConcentratedLoads} from '../simulation-bridge/openRadiossStarterLoads.mts';
import {readFile} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {sha256} from '../providers/openradioss/OpenRadiossInstallation.mts';
const histories=[{kind:'linear_ramp',riseTimeS:25e-6},
  {kind:'trapezoidal_pulse',riseTimeS:20e-6,holdTimeS:30e-6,fallTimeS:25e-6},
  {kind:'trapezoidal_pulse',riseTimeS:20e-6,holdTimeS:0,fallTimeS:105e-6}] as const;
assert.deepEqual(explicitLoadHistoryPoints('constant_after_onset',125e-6),[[0,1],[125e-6,1]]);
for(const h of histories){
 const points=explicitLoadHistoryPoints(h,125e-6);assert.equal(points[0][1],0);assert.equal(points.at(-1)![0],125e-6);
 assert.equal(points.at(-1)![1],h.kind==='linear_ramp'?1:0);assert.ok(points.every((p,i)=>!i||p[0]>points[i-1][0]));
 assertExplicitLoadResolution(h,125e-6,1e-7);assert.throws(()=>assertExplicitLoadResolution(h,125e-6,h.riseTimeS));
}
for(const h of [{kind:'linear_ramp',riseTimeS:0},{kind:'linear_ramp',riseTimeS:Infinity},
 {kind:'linear_ramp',riseTimeS:126e-6},{kind:'linear_ramp',riseTimeS:25e-6,arbitrary:true},
 {kind:'trapezoidal_pulse',riseTimeS:50e-6,holdTimeS:50e-6,fallTimeS:50e-6},
 {kind:'trapezoidal_pulse',riseTimeS:20e-6,holdTimeS:-1,fallTimeS:25e-6},
 {kind:'trapezoidal_pulse',riseTimeS:20e-6,holdTimeS:0,fallTimeS:Number.MIN_VALUE}])
 assert.throws(()=>explicitLoadHistoryPoints(h,125e-6));
// An exact mathematical endpoint can differ by binary addition roundoff.
assert.equal(explicitLoadHistoryPoints({kind:'trapezoidal_pulse',riseTimeS:10e-6,holdTimeS:10e-6,fallTimeS:30e-6},50e-6).at(-1)![0],50e-6);
const draft:any={schema:'tunacad-explicit-dynamics-foundation/0.1',studyId:'load-history-test',
 analysis:{type:'explicit_structural_dynamics',assumptions:['one_linear_elastic_solid','small_displacement','zero_initial_conditions','undamped','no_contact','no_mass_scaling'],
 durationS:125e-6,outputTimesS:[2.5e-6,125e-6],integration:{kind:'central_difference_cfl_bound',minimumCharacteristicLengthMm:1,safetyFactor:.8,maximumTimeStepS:1e-7,maximumIncrements:20000}},
 model:{projectRevision:'r1',domainId:'part',partId:'part',bodyId:'synthetic-solid',geometryDigest:digest('synthetic-cube'),kind:'straight_rectangular_axial_bar',
 lengthMm:10,widthMm:10,heightMm:10,fixedFaceId:'support',loadedFaceId:'load'},
 material:{materialId:'elastic',domainId:'part',model:'isotropic_linear_elastic',youngsModulusMPa:200000,poissonRatio:.3,densityKgM3:7800,source:{kind:'custom',reference:'test',revision:'1'}},
 initialConditions:{displacementMm:[0,0,0],velocityMmPerS:[0,0,0]},restraint:{kind:'fixed_face',faceId:'support',displacementMm:[0,0,0]},
 load:{kind:'axial_step_face_force',faceId:'load',onsetS:0,forceN:[250.125,0,0],coordinateSystem:'analysis',history:'constant_after_onset'},
 mesh:{elementFormulation:'C3D4',maximumNodes:100000,maximumElements:50000},requestedResults:['loaded_face_axial_displacement_history','fixed_face_axial_reaction_history','kinetic_energy_history','strain_energy_history','applied_work_history'],
 units:{length:'mm',time:'s',force:'N',stress:'MPa',density:'kg/m^3',velocity:'mm/s',acceleration:'mm/s^2',energy:'N*mm'}};
const xyz=[[0,0,0],[10,0,0],[0,10,0],[10,10,0],[0,0,10],[10,0,10],[0,10,10],[10,10,10]];
const nodes=xyz.map((xyzMm,i)=>({id:101+i*11,xyzMm}));
const elements=[[0,1,3,7],[0,3,2,7],[0,2,6,7],[0,6,4,7],[0,4,5,7],[0,5,1,7]].map((ids,i)=>({id:500+i*7,type:'C3D4',nodes:ids.map(n=>nodes[n].id)}));
const facets=new Map<string,{nodes:number[];uses:number}>();
for(const e of elements)for(let i=0;i<4;i++){
 const ids=e.nodes.filter((_,j)=>i!==j),key=[...ids].sort((a,b)=>a-b).join(',');facets.set(key,{nodes:ids,uses:(facets.get(key)?.uses??0)+1});
}
const mesh={runtime:'Gmsh 4.15.2',inputGeometryDigest:draft.model.geometryDigest,nodes,elements,
 surfaceTriangles:[...facets.values()].filter(f=>f.uses===1).map((f,i)=>({id:i+1,nodes:f.nodes}))};
const base=sealExplicitDynamics(draft),step=prepareOpenRadiossDeck(base,mesh);
for(const count of [2,25,63]){
 const altered={...draft,analysis:{...draft.analysis,outputTimesS:[draft.analysis.durationS/count,draft.analysis.durationS]}};
 const request=sealExplicitDynamics(altered),deck=prepareOpenRadiossDeck(request,mesh);
 assert.notEqual(request.requestDigest,base.requestDigest);
 assert.equal(deck.starter,step.starter);assert.deepEqual(deck.expected,step.expected);
 assert.ok(deck.engine.includes('/TFILE/4\n'+(draft.analysis.durationS/count).toExponential(12).padStart(20)));
 assert.equal(deck.dtNodaScale,step.dtNodaScale);
 const tampered=structuredClone(request);tampered.analysis.outputTimesS[0]*=1.1;
 assert.throws(()=>validateExplicitDynamics(tampered),/digest/);
}
assert.throws(()=>sealExplicitDynamics({...draft,analysis:{...draft.analysis,outputTimesS:[draft.analysis.durationS/64,draft.analysis.durationS]}}),/64-frame/);
console.log('PASS sampling deck: source-bound TFILE cadence, unchanged Starter/loads/timestep, request tamper and excess frames rejected.');
assert.ok(step.starter.includes('/FUNCT/1\nAxial step from t zero\n'+(0).toExponential(12).padStart(20)+(1).toExponential(12).padStart(20)+'\n'));
for(const history of histories){
 const request=sealExplicitDynamics({...draft,load:{...draft.load,kind:'axial_history_face_force',history}});
 assert.notEqual(request.requestDigest,base.requestDigest);assert.deepEqual(validateExplicitDynamics(JSON.parse(JSON.stringify(request))),request);
 const deck=prepareOpenRadiossDeck(request,mesh),lines=deck.starter.split('\n'),start=lines.indexOf('/FUNCT/1')+2;
 const stop=lines.findIndex((line,i)=>i>=start&&line.startsWith('/'));
 const points=lines.slice(start,stop).map(line=>[Number(line.slice(0,20)),Number(line.slice(20,40))]);
 const nominal=explicitLoadHistoryPoints(history,request.analysis.durationS);
 if(nominal.at(-1)![1]!==nominal.at(-2)![1])nominal.push([nominal.at(-1)![0]+request.analysis.durationS,nominal.at(-1)![1]]);
 const expected=nominal.map(p=>p.map(n=>Number(n.toExponential(12))));
 assert.deepEqual(points,expected);assert.deepEqual(deck.expected.loads,step.expected.loads);assert.equal(deck.engine,step.engine);
 assert.equal(deck.dtNodaScale,.6);assert.equal(deck.faceMappingDigest,step.faceMappingDigest);
 assert.throws(()=>explicitAxialBarReference(request),/step load/);
 const tampered=structuredClone(request);(tampered.load.history as any).riseTimeS*=.9;
 assert.throws(()=>validateExplicitDynamics(tampered),/digest/);
 assert.throws(()=>sealExplicitDynamics({...draft,load:{...draft.load,history}}),/kind\/history/);
 assert.throws(()=>sealExplicitDynamics({...draft,load:{...draft.load,kind:'axial_history_face_force',history:{kind:'linear_ramp',riseTimeS:1e-6}}}),/history interval/);
}
const collapsed=sealExplicitDynamics({...draft,load:{...draft.load,kind:'axial_history_face_force',
 history:{kind:'trapezoidal_pulse',riseTimeS:20e-6,holdTimeS:1e-18,fallTimeS:25e-6}}});
assert.throws(()=>prepareOpenRadiossDeck(collapsed,mesh),/unrepresentable load-history timing/);
console.log('PASS load histories: timeline/limits/roundoff, strict schema/digest/replay identity, native FUNCT serialization, unchanged peak FACE loads/engine/stability, unresolved/collapsed phases reject, step reference retained. Gmsh/Starter/Engine=0.');
const delayed=[{kind:'step',onsetS:10e-6},
 {kind:'linear_ramp',onsetS:10e-6,riseTimeS:25e-6},
 {kind:'trapezoidal_pulse',onsetS:10e-6,riseTimeS:20e-6,holdTimeS:30e-6,fallTimeS:25e-6},
 {kind:'trapezoidal_pulse',onsetS:10e-6,riseTimeS:20e-6,holdTimeS:0,fallTimeS:95e-6}] as const;
const listingFor=(deck:ReturnType<typeof prepareOpenRadiossDeck>)=>{
 const e=deck.expected;
 return ['NORMAL TERMINATION','0 ERROR(S)','0 WARNING(S)','INPUT UNIT SYSTEM ( Mg , mm , s )','WORK UNIT SYSTEM ( Mg , mm , s )',
  'NUMNOD '+e.nodeCount,'NUMELS '+e.elementCount,'NUMBCS 1','NCONLD '+e.loads.length,
  'INITIAL DENSITY = '+e.densityMgPerMm3.toExponential(12).toUpperCase(),"YOUNG'S MODULUS = "+e.E.toExponential(12).toUpperCase(),
  "POISSON'S RATIO = "+e.nu.toExponential(12).toUpperCase(),'TETRA4 FORMULATION FLAG = 1000',
  'Part id,name: 1 One elastic bar Elm type: TETRA4','TOTAL MASS AND MASS CENTER',e.massMg.toExponential(12).toUpperCase()+' 0 0 0',
  'TOTAL INERTIA','TOTAL ADDED MASS = 0','CONCENTRATED LOADS','------------------','NODE SKEW DIR LOAD_CURVE SENSOR SCALE_X SCALE_Y',
  ...e.loads.map(n=>`${n.id} 0 X 1 ${e.loadSensorId} 1 ${n.forceN.toExponential(13)}`),
  ...(e.loadSensorId?['SENSORS','-------','SENSOR TYPE 0: TIME','--------------------',
   'SENSOR ID. . . . . . . . . . . . . . . . . =         1',
   'TIME DELAY BEFORE ACTIVATION . . . . . . .=  '+e.loadOnsetS.toExponential(3),
   'STOP TIME. . . . . . . . . . . . . . . . .=  0.1000E+21']:[]),
  'SPMD IS CHECKING FOR ELEMENT DELETION IN :','NODAL TIME STEP (estimation)','1.000000E-07 1','NODAL TIME STEP DISTRIBUTION'].join('\n');
};
for(const history of delayed){
 const request=sealExplicitDynamics({...draft,load:{...draft.load,kind:'axial_history_face_force',onsetS:history.onsetS,history}});
 const deck=prepareOpenRadiossDeck(request,mesh),listing=listingFor(deck);
 assert.equal(deck.expected.loadOnsetS,10e-6);assert.equal(deck.expected.loadSensorId,1);
 assert.ok(deck.starter.includes('/SENSOR/TIME/1\nApproved load onset\n'+(10e-6).toExponential(12).padStart(20)+'\n\n'));
 const lines=deck.starter.split('\n');
 for(let i=0;i<lines.length;i++)if(lines[i].startsWith('/CLOAD/'))assert.equal(Number(lines[i+2].slice(30,40)),1);
 assert.deepEqual(deck.expected.loads,step.expected.loads);assert.equal(deck.engine,step.engine);
 assert.equal(admitOpenRadiossStarter(listing,deck).loads.loads[0].sensorId,1);
 assert.throws(()=>readBoundedStarterConcentratedLoads(listing,deck.expected.loads,deck.expected.forceN),/sensor interpretation/);
 for(const wrong of [listing.replace('SENSOR TYPE 0: TIME','SENSOR TYPE 1: FORCE'),
  listing.replace('SENSOR ID. . . . . . . . . . . . . . . . . =         1','SENSOR ID. . . . . . . . . . . . . . . . . =         2'),
  listing.replace('1.000e-5','1.001e-5'),listing.replace('0.1000E+21','0.1000E-03'),
  listing.replace('SENSORS','SENSORS\nUnknown sensor record')])
  assert.throws(()=>admitOpenRadiossStarter(wrong,deck),/sensor|onset/);
 const altered={...deck,starter:deck.starter.replace('Approved load onset\n'+(10e-6).toExponential(12).padStart(20),
   'Approved load onset\n'+(11e-6).toExponential(12).padStart(20))};
 assert.throws(()=>admitOpenRadiossStarter(listing,altered),/sensor mapping/);
 assert.throws(()=>admitOpenRadiossStarter(listing,{...deck,starter:deck.starter+'\n/SENSOR/TIME/2\n'}),/sensor mapping/);
 assertExplicitLoadResolution(history,125e-6,2.5e-6);
 assert.throws(()=>assertExplicitLoadResolution(history,125e-6,10e-6),/onset/);
 const mutated=structuredClone(request);mutated.load.onsetS=11e-6;
 assert.throws(()=>validateExplicitDynamics(mutated),/onset\/history mismatch/);
 const changed=structuredClone(request);(changed.load.history as any).onsetS=11e-6;changed.load.onsetS=11e-6;
 if(history.kind!=='trapezoidal_pulse'||history.holdTimeS!==0)assert.throws(()=>validateExplicitDynamics(changed),/digest/);
}
for(const history of [{kind:'step',onsetS:-1},{kind:'step',onsetS:NaN},{kind:'step',onsetS:125e-6},
 {kind:'linear_ramp',onsetS:110e-6,riseTimeS:20e-6},{kind:'trapezoidal_pulse',onsetS:10e-6,riseTimeS:50e-6,holdTimeS:30e-6,fallTimeS:50e-6}])
 assert.throws(()=>explicitLoadHistoryPoints(history,125e-6));
assert.equal(admitOpenRadiossStarter(listingFor(step),step).loads.loads[0].sensorId,0);
assert.throws(()=>sealExplicitDynamics({...draft,load:{...draft.load,onsetS:10e-6}}),/onset\/history/);
assert.throws(()=>sealExplicitDynamics({...draft,load:{...draft.load,kind:'axial_history_face_force',onsetS:1e-6,history:{kind:'step',onsetS:1e-6}}}),/history interval/);
console.log('PASS onset: unified step/ramp/pulse, delayed-phase bounds, one-shot native sensor/cards, strict interpreted sensor ownership and pinning, native resolution and request tamper rejection. Controlled listing only; no solver execution.');
if(process.argv.includes('--retained-starter-root')){
 const root=process.argv[process.argv.indexOf('--retained-starter-root')+1];assert.ok(isAbsolute(root));
 const pkg=JSON.parse(await readFile(join(root,'studies/execution-package.json'),'utf8'));
 const pin=JSON.parse(await readFile(join(root,'results/starter_output_pin-manifest.json'),'utf8'));
 const listing=await readFile(join(root,'results/starter_output_pin-ExplicitBarProbe_0000.out'),'utf8');
 assert.equal(sha256(listing),pin.artifacts['ExplicitBarProbe_0000.out'].sha256);
 const deck=prepareOpenRadiossDeck(pkg.input.request,pkg.input.mesh);
 assert.equal('sha256:'+sha256(deck.starter+deck.engine),pkg.authority.deckDigest);
 assert.equal(admitOpenRadiossStarter(listing,deck).loads.sensorInterpretation!.onsetS,20e-6);
 console.log('PASS authentic retained delayed Starter listing against contemporaneous pins; zero native reruns.');
}
