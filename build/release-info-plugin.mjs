import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
export function releaseInfoPlugin() {
  const id='virtual:minhas-financas-release',resolved='\0'+id;
  return {name:'minhas-financas-release',resolveId(source){if(source===id)return resolved;},load(source){
    if(source!==resolved)return;
    let commit=process.env.APP_SOURCE_COMMIT;
    if(!commit){try{commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{commit=null;}}
    if(commit!==null && !/^[0-9a-f]{40}$/.test(commit))throw new Error('APP_SOURCE_COMMIT deve ser um SHA Git completo.');
    const {version}=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
    return 'export default '+JSON.stringify({version,commit,repository:'https://github.com/ZAKOVISCK/Minhas_Finan-as'})+';';
  }};
}
