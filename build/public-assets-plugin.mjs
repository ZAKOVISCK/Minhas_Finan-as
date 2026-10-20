import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PUBLIC_FILES} from '../lib/public-files.mjs';
// Sites can serve uploaded assets before invoking the user Worker. Embed the
// small, closed asset set so those requests always execute our header policy.
export function publicAssetsPlugin(){
 const id='virtual:minhas-financas-assets',resolved='\0'+id;
 return{name:'minhas-financas-assets',resolveId(source){if(source===id)return resolved;},load(source){
  if(source!==resolved)return;
  const files={};
  for(const file of Object.keys(PUBLIC_FILES)){
   const path=new URL(file==='index.html'?'../lib/shell.html':'../public/'+file,import.meta.url);this.addWatchFile(path.pathname);
   const body=readFileSync(path);files[file]={base64:body.toString('base64'),etag:'"'+createHash('sha256').update(body).digest('hex')+'"'};
  }
  return 'export default '+JSON.stringify(files)+';';
 }};
}
