import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import * as S from '../public/storage.mjs';
import * as C from '../public/crypto.mjs';
import * as oldS from './compat-v101/storage.mjs';
import * as oldF from './compat-v101/finance.mjs';
import {largeHistory} from './fixtures/history.mjs';
const pass='senha de teste anterior com várias palavras',nextPass='senha de teste posterior com várias palavras';
for(const legacy of [false,true])test(`KDF: troca parcial ${legacy?'legada':'atual'} informa recriptografia antes de abrir a raiz e preserva todos os bytes`,async()=>{
 const db=await S.openDatabase(new IDBFactory()),kdf=C.newKdf(),key=await C.deriveKey(pass,kdf),newKdf=C.newKdf(),newKey=await C.deriveKey(nextPass,newKdf);
 const writer=legacy?oldS:S;
 await writer.saveSlot(db,'personal',null,legacy?oldF.demo('2026-10-20'):largeHistory(),-1,{key,kdf});
 const before=await S.decodeRaw(await S.loadRaw(db,'personal'),key);
 const legacyBytes=JSON.stringify(await S.loadRaw(db,'personal'));
 await assert.rejects(S.saveSlot(db,'personal',before,before,before.revision,{key:newKey,kdf:newKdf}),/A troca da senha exige recriptografar todos os registros/);
 assert.equal(JSON.stringify(await S.loadRaw(db,'personal')),legacyBytes);
 // Create a real checkpoint as well; failure must preserve it byte for byte.
 const state=await S.saveSlot(db,'personal',before,{...before,name:'Cofre com checkpoint'},before.revision,{key,kdf});
 const raw=JSON.stringify(await S.loadRaw(db,'personal'));
 await assert.rejects(S.saveSlot(db,'personal',state,{...state,name:'Tentativa inválida'},state.revision,{key:newKey,kdf:newKdf}),{message:'A troca da senha exige recriptografar todos os registros.'});
 assert.equal(JSON.stringify(await S.loadRaw(db,'personal')),raw);
 assert.deepEqual(await S.decodeRaw(await S.loadRaw(db,'personal'),key),state);
 const previous=await S.decodeRaw(S.previousRaw(await S.loadRaw(db,'personal')),key);assert.equal(previous.name,before.name);
 db.close();
});
test('KDF: troca completa recriptografa todos os IDs, reabre com a nova senha e recria checkpoints com a nova chave',async()=>{
 const factory=new IDBFactory(),db=await S.openDatabase(factory),kdf=C.newKdf(),key=await C.deriveKey(pass,kdf);
 const before=await S.saveSlot(db,'personal',null,largeHistory(),-1,{key,kdf}),backup=await C.backupWithKey(before,key,kdf);
 const newKdf=C.newKdf(),newKey=await C.deriveKey(nextPass,newKdf);
 const saved=await S.saveSlot(db,'personal',before,before,before.revision,{key:newKey,kdf:newKdf,force:true});
 const raw=await S.loadRaw(db,'personal');assert.deepEqual(raw.head.kdf,newKdf);assert.equal(raw.journal,null);
 await assert.rejects(S.decodeRaw(raw,key));assert.deepEqual(await S.decodeRaw(raw,newKey),saved);
 for(const collection of ['accounts','transfers','trades','dividends'])assert.deepEqual(saved[collection],before[collection]);
 db.close();const reopened=await S.openDatabase(factory),read=await S.decodeRaw(await S.loadRaw(reopened,'personal'),await C.deriveKey(nextPass,newKdf));assert.deepEqual(read,saved);
 const edited=await S.saveSlot(reopened,'personal',saved,{...saved,name:'Depois da troca'},saved.revision,{key:newKey,kdf:newKdf});
 assert.deepEqual(await S.decodeRaw(S.previousRaw(await S.loadRaw(reopened,'personal')),newKey),saved);
 assert.deepEqual((await C.readBackup(backup,pass)).dividends,before.dividends);
 assert.deepEqual((await C.readBackup(await C.backupWithKey(edited,newKey,newKdf),nextPass)),edited);reopened.close();
});
test('KDF: abas concorrentes mantêm CAS e checkpoint, inclusive contra uma rotação de senha',async()=>{
 const factory=new IDBFactory(),a=await S.openDatabase(factory),b=await S.openDatabase(factory),kdf=C.newKdf(),key=await C.deriveKey(pass,kdf);
 const initial=await S.saveSlot(a,'personal',null,largeHistory(),-1,{key,kdf}),announced=initial.dividends.find(x=>x.id==='dividend-000');
 const received=structuredClone(initial);received.dividends.find(x=>x.id===announced.id).status='received';
 const results=await Promise.allSettled([
  S.saveSlot(a,'personal',initial,received,initial.revision,{key,kdf,operationId:'tab-a'}),
  S.saveSlot(b,'personal',initial,{...initial,name:'Outra aba'},initial.revision,{key,kdf,operationId:'tab-b'}),
 ]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.ok(results.find(x=>x.status==='rejected').reason instanceof S.StorageConflict);
 const raw=await S.loadRaw(a,'personal'),winner=await S.decodeRaw(raw,key);assert.equal(winner.revision,initial.revision+1);
 assert.deepEqual(await S.decodeRaw(S.previousRaw(raw),key),initial);
 const nextKdf=C.newKdf(),nextKey=await C.deriveKey(nextPass,nextKdf);
 const rotated=await S.saveSlot(a,'personal',winner,winner,winner.revision,{key:nextKey,kdf:nextKdf,force:true});
 const bytes=JSON.stringify(await S.loadRaw(a,'personal'));
 await assert.rejects(S.saveSlot(b,'personal',winner,{...winner,name:'Aba antiga'},winner.revision,{key,kdf}),S.StorageConflict);
 assert.equal(JSON.stringify(await S.loadRaw(a,'personal')),bytes);assert.deepEqual(await S.decodeRaw(await S.loadRaw(a,'personal'),nextKey),rotated);a.close();b.close();
});
