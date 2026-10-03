// Harmless controlled process fixture ONLY; no provider/solver imports.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const [mode,root,...values]=process.argv.slice(2);
if(!['normal','tree','long_tree','descendant','assignment_failure'].includes(mode)||!root)throw new Error('Exact fixture configuration required');
writeFileSync(join(root,mode+'.json'),JSON.stringify({pid:process.pid,ppid:process.ppid,values,
  environment:process.env.TUNACAD_CONTROLLED_CONTAINMENT_FIXTURE??null}));
console.log(JSON.stringify({mode,pid:process.pid,values}));console.error('controlled-stderr');
if(mode==='tree'||mode==='long_tree'){
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'descendant',root,mode],{stdio:'inherit',windowsHide:true});
  child.on('error',error=>{throw error;});
}
setTimeout(()=>process.exit(0),mode==='normal'?50:mode==='tree'?250:mode==='descendant'&&values[0]==='tree'?150:60000);
