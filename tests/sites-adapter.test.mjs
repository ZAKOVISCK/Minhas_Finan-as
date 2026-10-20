import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {handleMarketRequest,fetchPublicSource} from '../lib/market-http.mjs';
import {secureResponse} from '../lib/security.mjs';
const request=(path='/api/data?feed=macro',options={})=>new Request('https://minhas-financas-isaque.isaque-silvateixeira.chatgpt.site'+path,options);
test('Sites: assets da versão atual correspondem ao manifesto de publicação',()=>{
 const p=JSON.parse(readFileSync(new URL('../UPSTREAM.json',import.meta.url)));assert.equal(p.version,'1.2.0');
 for(const[file,sha]of Object.entries(p.publicFilesSha256)){
  const path=file==='index.html'?'../lib/shell.html':'../public/'+file;
  assert.equal(createHash('sha256').update(readFileSync(new URL(path,import.meta.url))).digest('hex'),p.hostingPatches?.[file]?.sha256||sha,file);
 }
});
test('Sites: contrato JSON, origem e health preservados no adaptador Worker',async()=>{
 const calls=[];const service={async getFeed(feed){calls.push(feed);return{status:200,body:{items:[{id:'selic',value:10}],fetchedAt:'2026-10-20T12:00:00Z'}};}};
 const r=await handleMarketRequest(request(),service);assert.equal(r.status,200);assert.match(r.headers.get('Content-Type'),/application\/json/);assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);assert.deepEqual((await r.json()).items,[{id:'selic',value:10}]);assert.deepEqual(calls,['macro']);
 assert.deepEqual(await(await handleMarketRequest(request('/api/health'),service)).json(),{ok:true});
});
test('Sites: parâmetros, métodos e origens inválidos não chegam às fontes',async()=>{
 let calls=0;const service={async getFeed(){calls++;throw new Error();}};
 for(const path of ['/api/data','/api/data?feed=macro&feed=global','/api/data?feed=macro&url=https://attacker.test'])assert.equal((await handleMarketRequest(request(path),service)).status,400);
 for(const headers of [{Origin:'https://attacker.test'},{Origin:'null'},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await handleMarketRequest(request(undefined,{headers}),service)).status,403);
 assert.equal((await handleMarketRequest(request(undefined,{method:'POST'}),service)).status,405);assert.equal((await handleMarketRequest(request('/api/unknown'),service)).status,404);assert.equal(calls,0);
});
test('Sites: Retry-After, HEAD e falhas honestas não são substituídos por zeros',async()=>{
 const service={async getFeed(){return{status:503,retryAfter:300,body:{error:'Fonte temporariamente indisponível.'}};}};
 const r=await handleMarketRequest(request(),service);assert.equal(r.status,503);assert.equal(r.headers.get('Retry-After'),'300');assert.match((await r.json()).error,/indisponível/);
 assert.equal(await(await handleMarketRequest(request(undefined,{method:'HEAD'}),service)).text(),'');
 const unavailable=await handleMarketRequest(request(),{async getFeed(){throw new Error('interno');}});assert.equal(unavailable.status,503);assert.doesNotMatch(await unavailable.text(),/interno/);
});
test('Sites: documento mantém CSP, versão verificável e proteção contra enquadramento',()=>{
 const commit='a'.repeat(40),r=secureResponse(new Response('ok'),commit);assert.equal(r.headers.get('X-App-Version'),'1.2.0');assert.equal(r.headers.get('X-App-Source-Commit'),commit);assert.equal(r.headers.get('X-App-Upstream-Commit'),'0c22b907b2f89c79ceb81d9e414a9cea4b4697f2');assert.match(r.headers.get('Content-Security-Policy'),/script-src 'self'/);assert.doesNotMatch(r.headers.get('Content-Security-Policy'),/unsafe-inline|unsafe-eval/);assert.equal(r.headers.get('X-Frame-Options'),'DENY');
 assert.equal(r.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(r.headers.get('Cross-Origin-Resource-Policy'),'same-origin');
});

test('Sites: fetch Worker preserva receptor e recusa redirecionamento sem segui-lo',async()=>{
 const previous=globalThis.fetch;
 try{globalThis.fetch=function(input,init){assert.equal(this,globalThis);assert.equal(input,'https://servicodados.ibge.gov.br/');assert.equal(init.redirect,'manual');return Promise.resolve(new Response('{}',{headers:{'Content-Type':'application/json'}}));};
  assert.equal((await fetchPublicSource('https://servicodados.ibge.gov.br/',{redirect:'error'})).status,200);
  let redirects=0;globalThis.fetch=function(input,init){redirects++;assert.equal(this,globalThis);assert.equal(init.redirect,'manual');return Promise.resolve(new Response('',{status:302,headers:{Location:'https://outside.test/'}}));};
  const oldError=console.error;try{console.error=()=>{};await assert.rejects(fetchPublicSource('https://servicodados.ibge.gov.br/',{redirect:'error'}),/Redirecionamento.*recusado/);}finally{console.error=oldError;}
  assert.equal(redirects,1,'Nenhuma segunda consulta ao destino do redirecionamento.');
 }finally{globalThis.fetch=previous;}
});
