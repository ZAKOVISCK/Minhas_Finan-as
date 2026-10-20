import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {IDBFactory} from 'fake-indexeddb';
import {largeHistory} from './fixtures/history.mjs';
import {historyPage,renderView,HISTORY_LISTS} from '../public/views.mjs';
import {balances,summary,portfolio} from '../public/finance.mjs';
import {openDatabase,saveSlot,loadRaw,decodeRaw,previousRaw} from '../public/storage.mjs';
const cutoff='2000-03-31';
const ctx=(state,collection,page,hidden=false)=>({state,month:'2000-03',view:collection==='transfers'?'contas':'investimentos',slot:'demo',hidden,historyPages:{[collection]:page}});
const documentOf=(state,c,p,hidden)=>parseHTML(renderView(ctx(state,c,p,hidden))).document;
for(const collection of Object.keys(HISTORY_LISTS))test(`histórico ${collection}: todas as páginas mantêm IDs, ações e totais completos`,()=>{
 const state=largeHistory(),before=structuredClone(state),ids=[],snap=summary(state,'2000-03',cutoff),port=portfolio(state,cutoff);
 const action={transfers:'delete-transfer',trades:'delete-trade',dividends:'delete-dividend'}[collection];
 const pages=historyPage(state,collection).pages;
 assert.equal(pages,3);
 for(let page=1;page<=pages;page++){
  const doc=documentOf(state,collection,page),list=doc.querySelector(`#history-${collection}`);
  const rows=historyPage(state,collection,page).rows;
  assert.equal(list.querySelectorAll(`[data-action="${action}"]`).length,rows.length);
  for(const row of rows){assert.ok(list.querySelector(`[data-action="${action}"][data-id="${row.id}"]`));ids.push(row.id);}
  if(collection==='dividends')assert.equal(list.querySelectorAll('[data-action="receive-dividend"]').length,rows.length);
  assert.equal(list.querySelector('nav').getAttribute('aria-label'),`Paginação de ${HISTORY_LISTS[collection].label}`);
  assert.ok(list.querySelector('[role="status"]').textContent.includes(`Página ${page} de ${pages}`));
  assert.equal(list.querySelector('[id$="-first"]').hasAttribute('disabled'),page===1);
  assert.equal(list.querySelector('[id$="-last"]').hasAttribute('disabled'),page===pages);
 }
 assert.equal(new Set(ids).size,state[collection].length);assert.equal(ids.length,state[collection].length);
 assert.deepEqual(new Set(ids),new Set(state[collection].map(x=>x.id)));
 assert.deepEqual(state,before);assert.deepEqual(summary(state,'2000-03',cutoff),snap);assert.deepEqual(portfolio(state,cutoff),port);
});
test('histórico: provento antigo pode ser recebido, reaberto e excluído sem duplicar caixa',async()=>{
 const db=await openDatabase(new IDBFactory());let state=await saveSlot(db,'demo',null,largeHistory(),-1);
 const id='dividend-000',oldCash=balances(state,cutoff).get('broker');
 assert.ok(documentOf(state,'dividends',3).querySelector(`[data-action="receive-dividend"][data-id="${id}"]`));
 const before=state,next=structuredClone(state);next.dividends.find(x=>x.id===id).status='received';
 state=await saveSlot(db,'demo',before,next,before.revision,{operationId:'receive-old'});
 assert.deepEqual(await saveSlot(db,'demo',before,next,before.revision,{operationId:'receive-old'}),state);
 state=await decodeRaw(await loadRaw(db,'demo'));
 assert.equal(state.dividends.length,65);assert.equal(balances(state,cutoff).get('broker'),oldCash+1234);
 assert.equal(documentOf(state,'dividends',3).querySelector(`[data-action="receive-dividend"][data-id="${id}"]`),null);
 assert.ok(documentOf(state,'dividends',3).querySelector(`[data-action="delete-dividend"][data-id="${id}"]`));
 const removed={...state,dividends:state.dividends.filter(x=>x.id!==id)};
 state=await saveSlot(db,'demo',state,removed,state.revision);
 assert.equal(balances(await decodeRaw(await loadRaw(db,'demo')),cutoff).get('broker'),oldCash);
 assert.equal(state.dividends.length,64);db.close();
});
for(const collection of ['transfers','trades'])test(`histórico ${collection}: exclusão antiga persiste e pode ser recuperada por checkpoint`,async()=>{
 const db=await openDatabase(new IDBFactory());const before=await saveSlot(db,'demo',null,largeHistory(),-1),id=collection==='transfers'?'transfer-000':'trade-000';
 assert.ok(historyPage(before,collection,3).rows.some(x=>x.id===id));
 const next={...before,[collection]:before[collection].filter(x=>x.id!==id)};
 const saved=await saveSlot(db,'demo',before,next,before.revision,{operationId:'delete-old'}),raw=await loadRaw(db,'demo');
 assert.deepEqual(await decodeRaw(raw),saved);assert.equal(saved[collection].length,before[collection].length-1);
 assert.deepEqual(await saveSlot(db,'demo',before,next,before.revision,{operationId:'delete-old'}),saved);
 assert.deepEqual(await decodeRaw(previousRaw(raw)),before);
 const oldB=balances(before,cutoff),newB=balances(saved,cutoff);
 assert.equal(newB.get('broker')-oldB.get('broker'),collection==='transfers'?-1000:1000);
 if(collection==='transfers')assert.equal(newB.get('bank')-oldB.get('bank'),1000);
 else assert.equal(portfolio(saved,cutoff).cost,portfolio(before,cutoff).cost-1000);
 for(const field of ['income','expense'])assert.equal(summary(saved,'2000-03',cutoff)[field],summary(before,'2000-03',cutoff)[field]);
 db.close();
});
test('histórico: página inválida e última página removida continuam navegáveis; valores ocultos',()=>{
 const state=largeHistory();
 for(const collection of Object.keys(HISTORY_LISTS)){
  for(const bad of [undefined,NaN,Infinity,-2,0,1.5,'2'])assert.equal(historyPage(state,collection,bad).page,1);
  assert.equal(historyPage(state,collection,999).page,3);
  const next={...state,[collection]:state[collection].slice(0,HISTORY_LISTS[collection].size)};
  assert.equal(historyPage(next,collection,3).page,1);
  const doc=documentOf(state,collection,3,true);
  assert.doesNotMatch(doc.querySelector(`#history-${collection}`).textContent,/R\$\s*\d/);
 }
});
