import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import * as S from '../public/storage.mjs';
import * as F from '../public/finance.mjs';
import * as C from '../public/crypto.mjs';
import {openLocalSpace,retireBuiltInDemo} from '../public/access.mjs';
const day='2026-10-20';
const account={id:'qa-account',name:'Conta de teste',kind:'bank',opening:12345,openingDate:day,archived:false};
test('abertura direta: cria apenas espaço local vazio e reabre sem senha nem nova gravação',async()=>{
 const db=await S.openDatabase(new IDBFactory());const a=await openLocalSpace(db),raw=JSON.stringify(await S.loadRaw(db,'local'));
 for(const collection of F.COLLECTIONS)assert.equal(a[collection].length,0);
 assert.equal((await S.loadRaw(db,'local')).head.encrypted,false);
 assert.deepEqual(await openLocalSpace(db),a);assert.equal(JSON.stringify(await S.loadRaw(db,'local')),raw);
 for(const slot of ['personal','demo'])assert.equal((await S.loadRaw(db,slot)).head,undefined);db.close();
});
test('abertura direta: dados locais persistem após fechar a conexão sem senha',async()=>{
 const factory=new IDBFactory(),db=await S.openDatabase(factory),a=await openLocalSpace(db);
 const saved=await S.saveSlot(db,'local',a,{...a,accounts:[account]},a.revision);db.close();
 const reopened=await S.openDatabase(factory);assert.deepEqual(await openLocalSpace(reopened),saved);reopened.close();
});
test('abertura direta: duas abas inicializam o mesmo espaço sem duplicar dados',async()=>{
 const factory=new IDBFactory(),a=await S.openDatabase(factory),b=await S.openDatabase(factory);
 const [x,y]=await Promise.all([openLocalSpace(a),openLocalSpace(b)]);assert.deepEqual(x,y);assert.equal(x.revision,0);assert.equal((await S.loadRaw(a,'local')).records.length,0);a.close();b.close();
});
test('abertura direta: gravações e limpeza preservam exatamente cofre e checkpoint cifrados',async()=>{
 const db=await S.openDatabase(new IDBFactory()),kdf=C.newKdf(),key=await C.deriveKey('senha sintética de preservação do cofre',kdf);
 const a=await S.saveSlot(db,'personal',null,{...F.emptyState('Protegido',day),accounts:[account]},-1,{key,kdf});
 await S.saveSlot(db,'personal',a,{...a,name:'Nome protegido'},a.revision,{key,kdf});const before=JSON.stringify(await S.loadRaw(db,'personal'));
 const local=await openLocalSpace(db);await S.saveSlot(db,'local',local,{...local,name:'Sem senha'},local.revision);await retireBuiltInDemo(db);
 assert.equal(JSON.stringify(await S.loadRaw(db,'personal')),before);await assert.rejects(S.decodeRaw(await S.loadRaw(db,'personal')),/Desbloqueie/);
 assert.equal((await S.decodeRaw(await S.loadRaw(db,'personal'),key)).name,'Nome protegido');db.close();
});
test('abertura direta: dados locais sem cabeçalho são preservados e nunca reinicializados',async()=>{
 const db=await S.openDatabase(new IDBFactory()),a=await openLocalSpace(db);await S.saveSlot(db,'local',a,{...a,accounts:[account]},a.revision);
 await new Promise((resolve,reject)=>{const tx=db.transaction('data','readwrite');tx.objectStore('data').delete('head:local');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
 const before=JSON.stringify(await S.loadRaw(db,'local'));await assert.rejects(openLocalSpace(db),/Cabeçalho ausente/);assert.equal(JSON.stringify(await S.loadRaw(db,'local')),before);db.close();
});
test('abertura direta: revisão concorrente e checkpoint continuam protegidos no espaço local',async()=>{
 const db=await S.openDatabase(new IDBFactory()),a=await openLocalSpace(db),b=await S.saveSlot(db,'local',a,{...a,accounts:[account]},a.revision);
 await assert.rejects(S.saveSlot(db,'local',a,{...a,name:'Conflitante'},a.revision),S.StorageConflict);
 assert.deepEqual(await openLocalSpace(db),b);assert.deepEqual(await S.decodeRaw(S.previousRaw(await S.loadRaw(db,'local'))),a);db.close();
});
