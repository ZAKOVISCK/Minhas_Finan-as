import test from 'node:test';
import assert from 'node:assert/strict';
import {COLLECTIONS, emptyState, validateState} from '../public/finance.mjs';
import {decodeRaw, previousRaw, diffRecords, storageInfo, requestPersistence} from '../public/storage.mjs';

function rawState(state=emptyState('Teste'),slot='demo') {
  const safe=validateState(state),root={...safe,recordKeys:[]},records=[];
  for(const collection of COLLECTIONS){
    for(const value of safe[collection]){
      root.recordKeys.push(`${collection}:${value.id}`);
      records.push({key:`${slot}:${collection}:${value.id}`,slot,collection,id:value.id,payload:value});
    }
    delete root[collection];
  }
  return {slot,head:{version:3,revision:safe.revision,encrypted:false,kdf:null,payload:root},records,journal:null};
}
function account(id='account_a') {return {id,name:'Conta teste',kind:'bank',opening:10000,openingDate:'2026-01-01',archived:false};}

test('round trip restores collection ordering and validates data',async()=>{
 const state=emptyState('Teste');state.accounts=[account('second'),account('first')];
 const raw=rawState(state);raw.records.reverse();
 assert.deepEqual(await decodeRaw(raw),validateState(state));
});
test('missing head with surviving records is corruption, not empty space',async()=>{
 const state=emptyState('Teste');state.accounts=[account()];const raw=rawState(state);delete raw.head;
 await assert.rejects(decodeRaw(raw),/Cabeçalho ausente/);
 await assert.rejects(decodeRaw({slot:'demo',records:[],journal:{head:rawState().head,records:[]}}),/Cabeçalho ausente/);
 assert.equal(await decodeRaw({slot:'demo',head:undefined,records:[]}),null);
});
test('personal namespace never accepts plaintext head',async()=>{
 const raw=rawState(emptyState('Teste'),'personal');
 await assert.rejects(decodeRaw(raw,{}),/Proteção do espaço/);
});
test('malformed root index and duplicate keys are rejected',async()=>{
 const raw=rawState();delete raw.head.payload.recordKeys;
 await assert.rejects(decodeRaw(raw),/índice de registros/);
 const state=emptyState('Teste');state.accounts=[account()];const duplicate=rawState(state);
 duplicate.head.payload.recordKeys.push(duplicate.head.payload.recordKeys[0]);
 await assert.rejects(decodeRaw(duplicate),/ausentes ou duplicados/);
});
test('state digest accepts canonical key ordering and rejects a stale record',async()=>{
 const state=validateState({...emptyState('Teste'),accounts:[account()]});
 const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(state)));
 const digest=[...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('');
 const raw=rawState(state);raw.head.payload.stateDigest=digest;
 raw.records[0].payload=Object.fromEntries(Object.entries(raw.records[0].payload).reverse());
 assert.deepEqual(await decodeRaw(raw),state);
 raw.records[0].payload.opening=9999;
 await assert.rejects(decodeRaw(raw),/não correspondem/);
});
test('records from another slot or mismatched primary key are rejected',async()=>{
 const state=emptyState('Teste');state.accounts=[account()];const raw=rawState(state);
 raw.records[0].slot='personal';await assert.rejects(decodeRaw(raw),/outro espaço/);
 raw.records[0].slot='demo';raw.records[0].key='demo:accounts:wrong';
 await assert.rejects(decodeRaw(raw),/outro espaço/);
});
test('checkpoint reconstruction restores changed and deleted records',async()=>{
 const before=emptyState('Antes');before.accounts=[account('a'),account('b')];
 const after=structuredClone(before);after.revision=1;after.name='Depois';after.accounts=[{...account('a'),opening:12000},account('c')];
 const old=rawState(before),raw=rawState(after);
 const changes=diffRecords(validateState(before),validateState(after),'demo');
 raw.journal={head:old.head,records:changes.map(change=>[change.key,old.records.find(record=>record.key===change.key)||null])};
 const previous=previousRaw(raw);
 assert.equal(previous.slot,'demo');assert.deepEqual(await decodeRaw(previous),validateState(before));
 raw.head.revision='corrompida';
 assert.deepEqual(await decodeRaw(previousRaw(raw)),validateState(before));
});
test('checkpoint refuses cross-space writes, duplicates and skipped revisions',()=>{
 const raw=rawState({...emptyState('Teste'),revision:1});
 raw.journal={head:rawState().head,records:[['personal:accounts:a',null]]};
 assert.throws(()=>previousRaw(raw),/outro espaço/);
 raw.journal.records=[['demo:accounts:a',null],['demo:accounts:a',null]];
 assert.throws(()=>previousRaw(raw),/inconsistente/);
 raw.journal.records=[];raw.journal.head.revision=1;assert.throws(()=>previousRaw(raw),/inconsistente/);
});
test('storage persistence APIs safely degrade outside browser',async()=>{
 assert.deepEqual(await storageInfo(),{persistent:false});assert.equal(await requestPersistence(),false);
});
