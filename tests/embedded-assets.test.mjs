import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PUBLIC_FILES} from '../lib/public-files.mjs';
import {createEmbeddedAssets} from '../lib/embedded-assets.mjs';
import {servePublicAsset} from '../lib/static-http.mjs';
import {publicAssetsPlugin} from '../build/public-assets-plugin.mjs';
test('assets empacotados: todos os bytes, MIME, proteção, HEAD e ETag 304 são preservados',async()=>{
 const files={},commit='c'.repeat(40);
 for(const name of Object.keys(PUBLIC_FILES)){
  const bytes=readFileSync(new URL(name==='index.html'?'../lib/shell.html':'../public/'+name,import.meta.url));files[name]={base64:bytes.toString('base64'),etag:'"'+createHash('sha256').update(bytes).digest('hex')+'"'};
 }
 const assets=createEmbeddedAssets(files);
 for(const[file,mime]of Object.entries(PUBLIC_FILES)){
  const request=new Request('https://financas.test/'+file),r=await servePublicAsset(request,assets,commit);
  assert.equal(r.headers.get('Content-Type'),mime);assert.equal(r.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(r.headers.get('Cross-Origin-Resource-Policy'),'same-origin');
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()),new Uint8Array(readFileSync(new URL(file==='index.html'?'../lib/shell.html':'../public/'+file,import.meta.url))));
  const head=await servePublicAsset(new Request(request,{method:'HEAD'}),assets,commit);assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
  for(const etag of [r.headers.get('etag'),'W/'+r.headers.get('etag'),'*']){
   const cached=await servePublicAsset(new Request(request,{headers:{'If-None-Match':etag}}),assets,commit);assert.equal(cached.status,304);assert.equal(cached.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(await cached.text(),'');
  }
 }
 const root=await servePublicAsset(new Request('https://financas.test/'),assets,commit);assert.equal(await root.text(),readFileSync(new URL('../lib/shell.html',import.meta.url),'utf8'));
 assert.equal((await assets.fetch(new Request('https://financas.test/.git/config'))).status,404);
});
test('plugin: bundle contém somente a lista pública e observa os arquivos sem publicá-los à parte',()=>{
 const plugin=publicAssetsPlugin(),watched=[];
 const source=plugin.load.call({addWatchFile(path){watched.push(path);}},plugin.resolveId('virtual:minhas-financas-assets'));
 const files=JSON.parse(source.slice('export default '.length,-1));assert.equal(Object.keys(files).length,Object.keys(PUBLIC_FILES).length);assert.equal(watched.length,Object.keys(files).length);assert.ok(!Object.keys(files).some(x=>x.includes('storage.test')||x.includes('.env')));
});
