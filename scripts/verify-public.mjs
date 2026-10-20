import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PUBLIC_FILES} from '../lib/public-files.mjs';
const args=process.argv.slice(2),arg=name=>args[args.indexOf(name)+1];
const base=(args.includes('--base-url')?arg('--base-url'):'https://minhas-financas-isaque.isaque-silvateixeira.chatgpt.site').replace(/\/$/,'');
const url=new URL(base);assert.ok(url.protocol==='https:'||(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.protocol==='http:'));
assert.equal(url.pathname,'/');assert.ok(!url.username&&!url.password&&!url.search&&!url.hash);
const commit=args.includes('--commit')?arg('--commit'):null,output=args.includes('--output')?arg('--output'):null;
const manifest=JSON.parse(readFileSync(new URL('../UPSTREAM.json',import.meta.url),'utf8'));
const report={url:base,checkedAt:new Date().toISOString(),version:manifest.version,files:[],feeds:[],guards:[],failures:[]};
async function check(name,fn){try{await fn();}catch(error){report.failures.push({check:name,error:error.message});}}
const fetchURL=(path,options={})=>fetch(base+path,{...options,redirect:'error',signal:AbortSignal.timeout(25000)});
const security=response=>{assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.get('cross-origin-resource-policy'),'same-origin');assert.match(response.headers.get('content-security-policy')||'',/script-src 'self'/);assert.doesNotMatch(response.headers.get('content-security-policy'),/unsafe-inline|unsafe-eval/);};
await check('version',async()=>{
 const r=await fetchURL('/version.json');assert.equal(r.status,200);security(r);const version=await r.json();assert.equal(version.version,manifest.version);assert.match(version.commit,/^[a-f0-9]{40}$/);if(commit)assert.equal(version.commit,commit);report.source=version;assert.equal(r.headers.get('x-app-source-commit'),version.commit);
});
for(const[file,mime]of Object.entries(PUBLIC_FILES))await check(file,async()=>{
 const r=await fetchURL('/'+file);assert.equal(r.status,200);security(r);assert.equal(r.headers.get('content-type').split(';')[0],mime.split(';')[0]);assert.equal(r.headers.get('x-app-version'),manifest.version);if(report.source)assert.equal(r.headers.get('x-app-source-commit'),report.source.commit);
 const body=new Uint8Array(await r.arrayBuffer()),sha=createHash('sha256').update(body).digest('hex');assert.equal(sha,manifest.publicFilesSha256[file]);
 if(file==='sw.js'){assert.equal(r.headers.get('service-worker-allowed'),'/');assert.match(r.headers.get('cache-control'),/no-cache/);assert.ok(new TextDecoder().decode(body).includes('mf-core-'+manifest.version));}
 const head=await fetchURL('/'+file,{method:'HEAD'});assert.equal(head.status,200);security(head);assert.equal((await head.arrayBuffer()).byteLength,0);
 const etag=r.headers.get('etag');assert.ok(etag,'ETag ausente');const cached=await fetchURL('/'+file,{headers:{'If-None-Match':etag}});assert.equal(cached.status,304);security(cached);
 report.files.push({file,status:200,sha256:sha,mime:r.headers.get('content-type'),head:head.status,conditional:cached.status});
});
await check('root',async()=>{const r=await fetchURL('/');assert.equal(r.status,200);security(r);assert.equal(createHash('sha256').update(new Uint8Array(await r.arrayBuffer())).digest('hex'),manifest.publicFilesSha256['index.html']);assert.equal(r.headers.get('clear-site-data'),null);});
for(const feed of ['macro','brazil','global','samples'])await check('feed:'+feed,async()=>{
 const r=await fetchURL('/api/data?feed='+feed),data=await r.json();assert.equal(r.status,200,JSON.stringify(data));security(r);assert.ok(data.items.length>0);assert.ok(!data.errors?.length,JSON.stringify(data.errors));assert.ok(Number.isFinite(Date.parse(data.fetchedAt)));assert.ok(data.source);report.feeds.push({feed,status:r.status,items:data.items.length,source:data.source,fetchedAt:data.fetchedAt,expiresAt:data.expiresAt});
});
for(const[path,options,status]of [
 ['/api/health',{},200],['/api/data?feed=macro&feed=global',{},400],['/api/data?feed=macro&url=https://example.com',{},400],['/api/data?feed=macro',{headers:{Origin:'https://example.com'}},403],['/api/data?feed=macro',{method:'POST'},405],['/server.mjs',{},404],['/lib/market-server.mjs',{},404],['/release/storage.mjs',{},404],['/tests/history.test.mjs',{},404],['/.openai/hosting.json',{},404],['/README.md',{},404],
])await check('guard:'+path,async()=>{const r=await fetchURL(path,options);assert.equal(r.status,status);security(r);await r.arrayBuffer();report.guards.push({path,method:options.method||'GET',status:r.status});});
report.passed=report.failures.length===0;if(output)writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));process.exitCode=report.passed?0:1;
