// Dependencies live in this project's ignored .venv.
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const windows=process.platform==='win32';
const interpreter=join(root,'.venv',windows?'Scripts':'bin',windows?'python.exe':'python');
function execute(command,args){
 const result=spawnSync(command,args,{cwd:root,stdio:'inherit',windowsHide:true});
 if(result.error)throw result.error;
 if(result.status!==0)throw new Error(`${command} exited with code ${result.status}`);
}
try{
 if(!existsSync(interpreter)){
  const override=process.argv[2];
  const candidates=override?[[override,[]]]:windows?[['py',['-3']],['python',[]]]:[['python3',[]],['python',[]]];
  const python=candidates.find(([command,args])=>spawnSync(command,[...args,'-c','import sys; sys.exit(0 if (3, 10) <= sys.version_info[:2] <= (3, 13) else 1)'],{stdio:'ignore',windowsHide:true,timeout:10000}).status===0);
  if(!python)throw new Error('Install Python 3.10–3.13, or pass its executable: npm run sandbox:setup -- /path/to/python');
  execute(python[0],[...python[1],'-m','venv',join(root,'.venv')]);
 }
 execute(interpreter,['-m','pip','install','-r',join(root,'requirements-sandbox.txt')]);
 execute(interpreter,['-c','from swmm.toolkit import solver, output; print("SWMM engine:", solver.swmm_get_version())']);
 console.log('Sandbox ready. Run npm run dev, then open http://localhost:3000/sandbox/demo');
}catch(error){console.error(error.message);process.exitCode=1;}
