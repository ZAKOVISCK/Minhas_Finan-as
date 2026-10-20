// Web APIs only: the same binding is covered by native tests and runs at edge.
export function createEmbeddedAssets(files){
 const decoded=new Map();
 return{async fetch(request){
  const name=decodeURIComponent(new URL(request.url).pathname).slice(1)||'index.html';
  if(!Object.hasOwn(files,name))return new Response('Arquivo não encontrado.',{status:404});
  const file=files[name],headers={ETag:file.etag};
  const condition=request.headers.get('If-None-Match');
  if(condition?.split(',').some(value=>value.trim()==='*'||value.trim().replace(/^W\//,'')===file.etag))return new Response(null,{status:304,headers});
  if(request.method==='HEAD')return new Response(null,{headers});
  if(!decoded.has(name))decoded.set(name,Uint8Array.from(atob(file.base64),char=>char.charCodeAt(0)));
  return new Response(decoded.get(name),{headers});
 }};
}
