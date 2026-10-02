import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { positiveCancellationTime,requireNoOwnedSurvivors,snapshotNativeTree,type TreeSnapshot } from './openradiossNativeCancellationWitness.mts';
const retained=process.env.TUNACAD_OPENRADIOSS_MEDIUM_SOURCE_DIR;assert.ok(retained);
const bytes=await readFile(join(retained,'ExplicitBarProbeT01'));
const witness=positiveCancellationTime(new Uint8Array(bytes),0.006)!;assert.ok(witness.timeS>0);
assert.equal(witness.timeS,1.2777336451108567e-6);assert.equal(witness.record,25);
assert.equal(positiveCancellationTime(new Uint8Array(bytes.subarray(0,witness.completePrefixBytes-1)),0.006),null);
assert.equal(positiveCancellationTime(new Uint8Array(bytes.subarray(0,witness.completePrefixBytes)),0.006)!.timeS,witness.timeS);
const bad=Buffer.from(bytes);bad.writeInt32BE(9999,4);assert.throws(()=>positiveCancellationTime(new Uint8Array(bad),0.006),/Unsupported/);
const nonfinite=Buffer.from(bytes);nonfinite.writeFloatBE(NaN,witness.timeRecordOffset);assert.throws(()=>positiveCancellationTime(new Uint8Array(nonfinite),0.006),/Invalid/);
const node={pid:1,parentPid:9,name:'engine_win64.exe',executable:'test',createdAt:'a'};
const before:TreeSnapshot={at:'before',nodes:[node],engines:[],unrelated:[{...node,pid:2,name:'unrelated'}],solvers:[],alive:[]};
const after:TreeSnapshot={...before,at:'after',nodes:[],unrelated:before.unrelated,alive:[{pid:2,createdAt:'a'}]};
assert.equal(requireNoOwnedSurvivors(before,after).survivors.length,0);
assert.throws(()=>requireNoOwnedSurvivors(before,{...after,alive:[...after.alive,{pid:1,createdAt:'a'}]}),/survived/);
assert.throws(()=>requireNoOwnedSurvivors(before,{...after,alive:[]}),/Unrelated/);
assert.equal(requireNoOwnedSurvivors(before,{...after,alive:[...after.alive,{pid:1,createdAt:'new process'}]}).survivors.length,0);
const preflight=await snapshotNativeTree(0);assert.equal(preflight.nodes.length,0);assert.equal(preflight.solvers.length,0);
assert.ok(preflight.unrelated.some(p=>p.pid===process.pid));
console.log(JSON.stringify({result:'PASS',solverExecutions:0,checks:['authentic positive-time record','incomplete frame not a trigger',
  'unsupported/nonfinite witness rejected','owned survivor rejected','unrelated loss rejected','PID reuse distinguished',
  'read-only native process inventory'],unrelatedBaseline:preflight.unrelated}));
