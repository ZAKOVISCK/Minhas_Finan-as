import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {PUBLIC_FILES} from '../lib/public-files.mjs';
import {servePublicAsset} from '../lib/static-http.mjs';
import {createAppServer} from '../server.mjs';
const commit='b'.repeat(40);
test('Worker: todos os assets, HEAD e 304 recebem nosniff, CORP, CSP e MIME corretos',async()=>{
 const calls=[];
 const binding={async fetch(request){calls.push(request.url);return new Response(request.headers.has('If-None-Match')?null:'conteúdo sintético',{status:request.headers.has('If-None-Match')?304:200,headers:{'Content-Type':'application/octet-stream',ETag:'"fixture"'}});}};
 for(const[file,mime]of Object.entries(PUBLIC_FILES)){
  for(const options of [{},{method:'HEAD'},{headers:{'If-None-Match':'"fixture"'}}]){
   const request=new Request('https://financas.test/'+file,options),response=await servePublicAsset(request,binding,commit);
   assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff',file);assert.equal(response.headers.get('Cross-Origin-Resource-Policy'),'same-origin',file);
   assert.equal(response.headers.get('Content-Type'),mime,file);assert.equal(response.headers.get('X-App-Source-Commit'),commit);assert.equal(response.headers.get('Cache-Control'),'no-cache, no-transform');
   assert.doesNotMatch(response.headers.get('Content-Security-Policy'),/unsafe-inline|unsafe-eval/);
   if(file==='sw.js')assert.equal(response.headers.get('Service-Worker-Allowed'),'/');
   if(request.method==='HEAD'||options.headers)assert.equal(await response.text(),'');
  }
 }
 assert.equal(calls.length,Object.keys(PUBLIC_FILES).length*3);
 const root=await servePublicAsset(new Request('https://financas.test/'),binding,commit);assert.equal(root.headers.get('Content-Type'),PUBLIC_FILES['index.html']);assert.match(root.headers.get('Cache-Control'),/no-transform/);
});
test('Worker: arquivos privados e métodos de escrita não acessam o binding de assets',async()=>{
 let called=0;const assets={async fetch(){called++;return new Response('erro');}};
 for(const path of ['/.git/config','/.env','/tests/history.test.mjs','/lib/market-server.mjs','/release/storage.mjs','/foo.css','/%ZZ'])assert.equal(await servePublicAsset(new Request('https://financas.test'+path),assets,commit),null);
 const r=await servePublicAsset(new Request('https://financas.test/storage.mjs',{method:'POST'}),assets,commit);assert.equal(r.status,405);assert.equal(called,0);
});
test('Node: o servidor reproduzível entrega todos os arquivos com cabeçalhos e escopo seguros',async t=>{
 const server=createAppServer();server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port;
 for(const[file,mime]of Object.entries(PUBLIC_FILES)){
  const r=await fetch(base+'/'+file);assert.equal(r.status,200,file);assert.equal(r.headers.get('Content-Type'),mime,file);assert.equal(r.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(r.headers.get('Cross-Origin-Resource-Policy'),'same-origin');
  const etag=r.headers.get('etag');await r.arrayBuffer();const cached=await fetch(base+'/'+file,{headers:{'If-None-Match':etag}});assert.equal(cached.status,304);assert.equal(cached.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(cached.headers.get('Cross-Origin-Resource-Policy'),'same-origin');
 }
 const local=await fetch(base+'/');assert.doesNotMatch(local.headers.get('content-security-policy'),/upgrade-insecure-requests/);await local.arrayBuffer();
 const secure=await fetch(base+'/',{headers:{'X-Forwarded-Proto':'https'}});assert.match(secure.headers.get('content-security-policy'),/upgrade-insecure-requests/);await secure.arrayBuffer();
 const release=await(await fetch(base+'/version.json')).json();assert.equal(release.version,'1.1.2');assert.equal(release.repository,'https://github.com/ZAKOVISCK/Minhas_Finan-as');
});
