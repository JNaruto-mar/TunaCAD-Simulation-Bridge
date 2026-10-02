// Installation fingerprint only: no study, job, provider or child-process import.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectOpenRadiossInstallation } from '../providers/openradioss/OpenRadiossInstallation.mts';
import { OPENRADIOSS_RUNTIME_POLICY as policy } from '../providers/openradioss/OpenRadiossRuntimeManifest.mts';
const required=(key:string)=>{const value=process.env[key];assert.ok(value,'Explicit '+key+' required');return value;};
const root=required('TUNACAD_OPENRADIOSS_ROOT');
const inspection=await inspectOpenRadiossInstallation({root,starterExecutable:join(root,'exec/starter_win64.exe'),
  engineExecutable:join(root,'exec/engine_win64.exe'),runtimeVersion:'2026',
  starterSha256:required('TUNACAD_OPENRADIOSS_STARTER_SHA256'),engineSha256:required('TUNACAD_OPENRADIOSS_ENGINE_SHA256')});
const directory=await mkdtemp(join(tmpdir(),'tunacad-openradioss-preflight-'));
const report={schema:'tunacad-openradioss-runtime-preflight/0.1',result:'PASS',solverExecutions:0,studiesCreated:0,
  policy,inspection};
await writeFile(join(directory,'runtime-preflight.json'),JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({result:report.result,solverExecutions:0,studiesCreated:0,directory,
  files:inspection.identity.files.length,totalBytes:inspection.totalBytes,hashingBytes:inspection.hashingBytes,
  maximumTotalBytes:policy.maximumTotalBytes,manifestDigest:inspection.manifestDigest,runtimeDigest:inspection.runtimeDigest,
  executableIdentities:inspection.identity.files.filter(f=>f.path.startsWith('exec/')),complianceIdentity:inspection.complianceIdentity}));
