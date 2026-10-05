import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import { spawnSync } from 'node:child_process';

// Packaging only. No CLI import, executable probe, provider or process launcher.
const manifest=JSON.parse(await readFile('package.json','utf8'));
const lock=JSON.parse(await readFile('package-lock.json','utf8'));
assert.equal(manifest.name,'@tunacad/simulation-bridge');
assert.equal(manifest.version,lock.version);assert.equal(manifest.version,lock.packages[''].version);
assert.equal(manifest.private,false);assert.equal(manifest.publishConfig.access,'public');
assert.equal(manifest.main,undefined,'Do not declare a nonexistent JS API entry.');
assert.equal(manifest.scripts.start,'node --experimental-transform-types simulation-bridge/cli.mts');
const npm=process.env.npm_execpath;
assert.ok(npm,'Run through npm run test:package.');
const output=spawnSync(process.execPath,[npm,'pack','--dry-run','--json','--ignore-scripts'],{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:4*1024*1024});
assert.equal(output.status,0,output.stderr);
const [pack]=JSON.parse(output.stdout),files=new Set(pack.files.map(file=>file.path));
for(const file of ['package.json','README.md','simulation-bridge/cli.mts','simulation-bridge/providerSettingsCli.mts',
  'providers/windowsJobObjectRunner.ps1','providers/windowsSuspendedChild.cs',
  'providers/openradioss/OpenRadiossExplicitSolverProvider.mts','simulation-bridge/privateExplicitExecutionEvidence.mts','simulation-bridge/privateExplicitExecutionReadiness.mts'])
  assert.ok(files.has(file),'Missing runtime file '+file);
for(const file of files){
  assert.ok(file==='package.json'||file==='README.md'||/^(providers|simulation-bridge|src\/simulation)\//.test(file),'Unexpected package file '+file);
  assert.doesNotMatch(file,/\.(step|stp|msh|t01|inp|exe|dll|zip|log|tgz|csv|jsonl)$/i);
  if(!/\.(mts|ts|ps1|cs)$/.test(file))continue;
  const source=await readFile(file,'utf8');
  assert.doesNotMatch(source,/C:[\\/](Users|Tools)[\\/]|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/i,'Machine-specific data in '+file);
  if(!/\.(mts|ts)$/.test(file))continue;
  for(const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bnew URL\(\s*)['"]([^'"]+)['"]/g)){
    const specifier=match[1];
    if(specifier.startsWith('.')){
      const target=posix.normalize(posix.join(posix.dirname(file),specifier));
      assert.ok(files.has(target),'Unpacked relative dependency '+target+' from '+file);
    }else if(!specifier.startsWith('node:')){
      const dependency=specifier.startsWith('@')?specifier.split('/').slice(0,2).join('/'):specifier.split('/')[0];
      assert.ok(manifest.dependencies[dependency],'Undeclared dependency '+dependency);
    }
  }
}
console.log(JSON.stringify({pass:true,package:pack.id,files:files.size,bytes:pack.unpackedSize,
  checks:'version/lock, runtime entry/sidecars, closed dependency graph, allowlist, machine-data exclusion; no solver'}));
