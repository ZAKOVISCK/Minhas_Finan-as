import { PUBLIC_FILES } from './public-files.mjs';
import { secureResponse } from './security.mjs';
export async function servePublicAsset(request, assets, sourceCommit) {
  let path;
  try {path=decodeURIComponent(new URL(request.url).pathname).slice(1);} catch {return null;}
  if(path==='index.html' || !Object.hasOwn(PUBLIC_FILES,path))return null;
  if(!['GET','HEAD'].includes(request.method))return secureResponse(new Response(null,{status:405,headers:{Allow:'GET, HEAD'}}),sourceCommit);
  const response=await assets.fetch(request);
  const headers=new Headers(response.headers);
  headers.set('Content-Type',PUBLIC_FILES[path]);
  headers.set('Cache-Control','no-cache');
  if(path==='sw.js')headers.set('Service-Worker-Allowed','/');
  return secureResponse(new Response(request.method==='HEAD'||[204,304].includes(response.status)?null:response.body,{status:response.status,statusText:response.statusText,headers}),sourceCommit);
}
