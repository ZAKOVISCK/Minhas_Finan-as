import test from 'node:test';import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import * as oldFinance from './compat-v101/finance.mjs';
import * as oldCrypto from './compat-v101/crypto.mjs';
import * as oldStorage from './compat-v101/storage.mjs';
import * as finance from '../public/finance.mjs';
import * as cryptoModule from '../public/crypto.mjs';
import * as storage from '../public/storage.mjs';
const password='senha sintética de migração 1.0.1 para 1.1.0';
const asOf='2026-10-20';
test('atualização: cofre real do formato 1.0.1 abre e grava na 1.1 sem perder IDs ou centavos',async()=>{
 const factory=new IDBFactory(),oldDb=await oldStorage.openDatabase(factory),kdf=oldCrypto.newKdf(),key=await oldCrypto.deriveKey(password,kdf);
 const oldState=await oldStorage.saveSlot(oldDb,'personal',null,oldFinance.demo(asOf),-1,{key,kdf});oldDb.close();
 const db=await storage.openDatabase(factory),raw=await storage.loadRaw(db,'personal'),newKey=await cryptoModule.deriveKey(password,kdf),upgraded=await storage.decodeRaw(raw,newKey);
 assert.equal(db.name,'minhas-financas-demo');assert.equal(db.version,2);assert.equal(upgraded.version,3);
 for(const c of oldFinance.COLLECTIONS)assert.deepEqual(upgraded[c].map(x=>x.id),oldState[c].map(x=>x.id),c);
 for(const field of ['cash','pending','available','income','expense'])assert.equal(finance.summary(upgraded,'2026-10',asOf)[field],oldFinance.summary(oldState,'2026-10',asOf)[field],field);
 assert.ok(upgraded.categories.length>0);
 const saved=await storage.saveSlot(db,'personal',upgraded,upgraded,upgraded.revision,{key:newKey,kdf});
 const persisted=await storage.decodeRaw(await storage.loadRaw(db,'personal'),newKey);assert.deepEqual(persisted,saved);assert.equal(persisted.revision,oldState.revision+1);db.close();
});
test('atualização: backup criptografado 1.0.1 restaura no envelope v1 da 1.1.0',async()=>{
 const oldState=oldFinance.demo(asOf),kdf=oldCrypto.newKdf(),key=await oldCrypto.deriveKey(password,kdf),backup=await oldCrypto.backupWithKey(oldState,key,kdf),restored=await cryptoModule.readBackup(backup,password);
 assert.equal(JSON.parse(backup).version,1);assert.equal(restored.accounts[0].opening,oldState.accounts[0].opening);assert.equal(restored.entries.length,oldState.entries.length);assert.equal(restored.payments.length,oldState.payments.length);
 const fresh=await cryptoModule.backupWithKey(restored,key,kdf);assert.equal(JSON.parse(fresh).version,1);assert.deepEqual(await cryptoModule.readBackup(fresh,password),restored);
});
test('atualização: senha errada preserva material antigo; nova categoria é salva com o mesmo cofre',async()=>{
 const db=await oldStorage.openDatabase(new IDBFactory()),kdf=oldCrypto.newKdf(),key=await oldCrypto.deriveKey(password,kdf);
 await oldStorage.saveSlot(db,'personal',null,oldFinance.demo(asOf),-1,{key,kdf});
 const raw=await storage.loadRaw(db,'personal'),before=JSON.stringify(raw),wrong=await cryptoModule.deriveKey('outra senha sintética inválida',kdf);
 await assert.rejects(storage.decodeRaw(raw,wrong));assert.equal(JSON.stringify(await storage.loadRaw(db,'personal')),before);
 const loaded=await storage.decodeRaw(raw,key),changed=finance.addCategory(loaded,'Categoria sintética de teste');
 const saved=await storage.saveSlot(db,'personal',loaded,changed,loaded.revision,{key,kdf});
 assert.ok(saved.categories.some(x=>x.name==='Categoria sintética de teste'));assert.equal(saved.entries.length,loaded.entries.length);db.close();
});
test('atualização: primeira gravação da demonstração antiga regrava defaults e preserva exclusões/checkpoint',async()=>{
 const db=await oldStorage.openDatabase(new IDBFactory()),oldState=await oldStorage.saveSlot(db,'demo',null,oldFinance.demo(asOf),-1),upgraded=await storage.decodeRaw(await storage.loadRaw(db,'demo'));
 const next=structuredClone(upgraded),id=next.entries.find(e=>e.type==='expense').id;next.entries=next.entries.filter(e=>e.id!==id);next.payments=next.payments.filter(p=>p.entryId!==id);next.name='Demonstração atualizada';
 const saved=await storage.saveSlot(db,'demo',upgraded,next,upgraded.revision),raw=await storage.loadRaw(db,'demo');assert.deepEqual(await storage.decodeRaw(raw),saved);assert.equal(saved.entries.length,oldState.entries.length-1);
 const previous=await storage.decodeRaw(storage.previousRaw(raw));assert.equal(previous.entries.length,oldState.entries.length);assert.equal(previous.name,oldState.name);db.close();
});
test('atualização: segunda gravação continua incremental e replay mantém o estado persistido',async()=>{
 const db=await oldStorage.openDatabase(new IDBFactory()),oldState=await oldStorage.saveSlot(db,'demo',null,oldFinance.demo(asOf),-1),before=await storage.decodeRaw(await storage.loadRaw(db,'demo'));
 const first=await storage.saveSlot(db,'demo',before,{...before,name:'Primeira gravação'},before.revision),raw=await storage.loadRaw(db,'demo');
 const second=await storage.saveSlot(db,'demo',first,{...first,name:'Segunda gravação'},first.revision,{operationId:'replay-legacy'}),after=await storage.loadRaw(db,'demo');
 assert.equal(after.journal.records.length,0);assert.equal(raw.records[0].payload.id,after.records[0].payload.id);assert.deepEqual(await storage.decodeRaw(after),second);
 assert.deepEqual(await storage.saveSlot(db,'demo',first,{...first,name:'Segunda gravação'},first.revision,{operationId:'replay-legacy'}),second);db.close();
});
