import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import * as S from "../public/storage.mjs";
import * as F from "../public/finance.mjs";
import * as C from "../public/crypto.mjs";
import { isBuiltInDemo, retireBuiltInDemo } from "../public/access.mjs";
const day="2026-10-20",password="senha sintética de acesso e preservação";
async function personal(db){
 const kdf=C.newKdf(),key=await C.deriveKey(password,kdf),state=F.emptyState("Cofre pessoal real de teste",day);
 state.accounts.push({id:"real",name:"Conta pessoal",kind:"bank",opening:98765,openingDate:day,archived:false});
 const a=await S.saveSlot(db,"personal",null,state,-1,{key,kdf});
 await S.saveSlot(db,"personal",a,{...a,name:"Cofre preservado"},a.revision,{key,kdf});
 return{key,raw:JSON.stringify(await S.loadRaw(db,"personal"))};
}
test("acesso: sem demonstração e sem cofre não cria registros financeiros",async()=>{
 const db=await S.openDatabase(new IDBFactory());
 assert.deepEqual(await retireBuiltInDemo(db),{status:"none",raw:null});
 for(const slot of ["personal","demo"]){const raw=await S.loadRaw(db,slot);assert.equal(raw.head,undefined);assert.equal(raw.records.length,0);assert.equal(raw.journal,undefined);}
 db.close();
});
test("acesso: reconhece somente os exemplos intactos, independentemente de ordem e revisão",()=>{
 const original=F.demo(day),reordered=structuredClone(original);reordered.revision=99;
 reordered.entries.reverse();reordered.payments.reverse();
 assert.equal(isBuiltInDemo(reordered),true);
 for(const mutate of [s=>s.accounts[0].opening++,s=>s.entries[0].description="Descrição pessoal",s=>s.name="Outro nome",s=>s.categories[0].name="Minha categoria"]){
  const changed=structuredClone(original);mutate(changed);assert.equal(isBuiltInDemo(changed),false);
 }
});
test("limpeza: remove exemplos e checkpoint intactos sem alterar um byte do cofre pessoal",async()=>{
 const factory=new IDBFactory(),db=await S.openDatabase(factory),vault=await personal(db);
 const seeded=await S.saveSlot(db,"demo",null,F.demo(day),-1);
 await S.saveSlot(db,"demo",seeded,seeded,seeded.revision);
 assert.equal((await retireBuiltInDemo(db)).status,"removed");
 const clean=await S.loadRaw(db,"demo");assert.equal(clean.head,undefined);assert.equal(clean.records.length,0);assert.equal(clean.journal,undefined);
 assert.equal(JSON.stringify(await S.loadRaw(db,"personal")),vault.raw);
 db.close();const reopened=await S.openDatabase(factory);
 assert.equal(JSON.stringify(await S.loadRaw(reopened,"personal")),vault.raw);
 assert.equal((await S.decodeRaw(await S.loadRaw(reopened,"personal"),vault.key)).accounts[0].opening,98765);
 assert.equal((await retireBuiltInDemo(reopened)).status,"none");reopened.close();
});
test("limpeza: registros alterados no espaço antigo ficam separados e preservados para revisão",async()=>{
 const db=await S.openDatabase(new IDBFactory()),vault=await personal(db),demo=F.demo(day);
 demo.entries[0].description="Registro que pode ser pessoal";
 await S.saveSlot(db,"demo",null,demo,-1);const before=JSON.stringify(await S.loadRaw(db,"demo"));
 assert.equal((await retireBuiltInDemo(db)).status,"review");
 assert.equal(JSON.stringify(await S.loadRaw(db,"demo")),before);assert.equal(JSON.stringify(await S.loadRaw(db,"personal")),vault.raw);db.close();
});
test("limpeza: checkpoint com alterações pessoais não é apagado mesmo após voltar aos exemplos",async()=>{
 const db=await S.openDatabase(new IDBFactory()),demo=F.demo(day);demo.accounts[0].opening=43210;
 const modified=await S.saveSlot(db,"demo",null,demo,-1);
 await S.saveSlot(db,"demo",modified,{...F.demo(day),revision:modified.revision},modified.revision);
 const before=JSON.stringify(await S.loadRaw(db,"demo"));assert.equal((await retireBuiltInDemo(db)).status,"review");
 assert.equal(JSON.stringify(await S.loadRaw(db,"demo")),before);db.close();
});
test("limpeza: dados órfãos ou corrompidos são preservados para recuperação",async()=>{
 const db=await S.openDatabase(new IDBFactory());await S.saveSlot(db,"demo",null,F.demo(day),-1);
 await new Promise((resolve,reject)=>{const tx=db.transaction("data","readwrite");tx.objectStore("data").delete("head:demo");tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
 const before=JSON.stringify(await S.loadRaw(db,"demo"));assert.equal((await retireBuiltInDemo(db)).status,"review");
 assert.equal(JSON.stringify(await S.loadRaw(db,"demo")),before);db.close();
});
test("limpeza: CAS recusa exclusão se outra aba gravou e jamais aceita o slot pessoal",async()=>{
 const db=await S.openDatabase(new IDBFactory()),vault=await personal(db),saved=await S.saveSlot(db,"demo",null,F.demo(day),-1),stale=await S.loadRaw(db,"demo");
 await S.saveSlot(db,"demo",saved,{...saved,name:"Mudança concorrente"},saved.revision);
 const before=JSON.stringify(await S.loadRaw(db,"demo"));
 await assert.rejects(S.removeDemoSlot(db,stale),S.StorageConflict);
 assert.equal(JSON.stringify(await S.loadRaw(db,"demo")),before);
 await assert.rejects(S.removeDemoSlot(db,await S.loadRaw(db,"personal")),/espaço de testes/);
 assert.equal(JSON.stringify(await S.loadRaw(db,"personal")),vault.raw);db.close();
});
test("limpeza: descarte explícito é atômico, restrito ao espaço de testes e idempotente",async()=>{
 const db=await S.openDatabase(new IDBFactory()),vault=await personal(db),demo=F.demo(day);demo.name="Teste modificado";
 await S.saveSlot(db,"demo",null,demo,-1);const raw=await S.loadRaw(db,"demo");await S.removeDemoSlot(db,raw);
 const empty=await S.loadRaw(db,"demo");await S.removeDemoSlot(db,empty);assert.equal((await S.loadRaw(db,"demo")).records.length,0);
 assert.equal(JSON.stringify(await S.loadRaw(db,"personal")),vault.raw);db.close();
});
