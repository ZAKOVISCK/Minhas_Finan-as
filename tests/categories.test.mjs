import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES,MAX_CATEGORIES,emptyState,validateState,demo,categoryList,categoryNames,
  categoryUsage,addCategory,updateCategory,serializeBackup,parseBackup,balances,summary,
  generateRecurrences,ledgerCSV,
} from '../finance.mjs';
import {renderView,currency} from '../views.mjs';

const AS_OF='2026-10-20';
const MONTH='2026-10';
function seeded(){
  const state=addCategory(demo(AS_OF),'Animais de estimação','pets');
  state.entries.push({id:'vet',description:'Veterinário',category:'Animais de estimação',type:'expense',amount:12345,dueDate:AS_OF,competence:MONTH,accountId:'bank',cardId:null});
  state.payments.push({id:'pay-vet',entryId:'vet',accountId:'bank',amount:12345,date:AS_OF});
  state.budgets.push({id:'budget-pets',month:MONTH,category:'Animais de estimação',amount:20000});
  state.recurrences.push({id:'food-pets',description:'Ração',type:'expense',category:'Animais de estimação',amount:3000,accountId:'bank',start:MONTH,end:'',day:20,active:true});
  return validateState(state,AS_OF);
}
function context(state,view='configuracoes'){
  return {state,month:MONTH,view,slot:'demo',hidden:false,search:'',typeFilter:'all',statusFilter:'all',scope:'month',page:1};
}

test('schema 3 without category metadata gains independent defaults without changing financial data',()=>{
  const old=demo(AS_OF);delete old.categories;
  const before=structuredClone(old);
  const safe=validateState(old,AS_OF);
  assert.deepEqual(categoryNames(safe),CATEGORIES);
  assert.deepEqual(safe.entries,before.entries);
  assert.equal(safe.version,3);
  assert.deepEqual(old,before);
  safe.categories[0].name='Changed only here';
  assert.equal(emptyState().categories[0].name,CATEGORIES[0]);
});

test('adding a category survives validation and backup without modifying the input',()=>{
  const initial=emptyState('Teste',AS_OF),before=structuredClone(initial);
  const added=addCategory(initial,'Animais de estimação','pets');
  assert.deepEqual(initial,before);
  assert.equal(added.categories.at(-1).id,'pets');
  assert.deepEqual(parseBackup(serializeBackup(added)),added);
  assert.ok(categoryNames(added).includes('Animais de estimação'));
});

test('rename updates entries, monthly budgets and recurrences atomically without changing cash or totals',()=>{
  const before=seeded(),original=structuredClone(before);
  const next=updateCategory(before,'pets',{name:'Cuidados com animais'});
  assert.deepEqual(before,original);
  for(const key of ['entries','budgets','recurrences']){
    assert.ok(next[key].some(row=>row.category==='Cuidados com animais'));
    assert.ok(!next[key].some(row=>row.category==='Animais de estimação'));
  }
  assert.deepEqual(categoryUsage(next,'pets'),{entries:1,budgets:1,recurrences:1});
  assert.deepEqual(balances(next,AS_OF),balances(before,AS_OF));
  assert.equal(summary(next,MONTH,AS_OF).expense,summary(before,MONTH,AS_OF).expense);
  assert.equal(summary(next,MONTH,AS_OF).available,summary(before,MONTH,AS_OF).available);
  assert.match(ledgerCSV(next,MONTH),/Cuidados com animais/);
});

test('archived categories remain visible in reports and budget history but leave new selections',()=>{
  const state=updateCategory(seeded(),'pets',{archived:true});
  assert.ok(!categoryNames(state).includes('Animais de estimação'));
  assert.ok(categoryNames(state,{selected:'Animais de estimação'}).includes('Animais de estimação'));
  assert.ok(categoryNames(state,{includeArchived:true}).includes('Animais de estimação'));
  assert.equal(categoryList(state,{includeArchived:false}).some(row=>row.id==='pets'),false);
  assert.match(renderView(context(state,'inicio')),/Animais de estimação/);
  const report=renderView(context(state,'relatorios'));
  assert.match(report,/Animais de estimação/);
  assert.ok(report.includes(currency(12345)));
  assert.match(renderView(context(state)),/Reativar categoria Animais de estimação/);
  const generated=generateRecurrences(state,MONTH);
  assert.ok(generated.entries.some(row=>row.recurrenceKey==='food-pets_'+MONTH&&row.category==='Animais de estimação'));
  assert.ok(categoryNames(updateCategory(state,'pets',{archived:false})).includes('Animais de estimação'));
});

test('a historical category missing from the catalog is preserved as archived instead of discarded',()=>{
  const old=demo(AS_OF);delete old.categories;
  old.entries[0].category='Categoria antiga personalizada';
  const safe=validateState(old,AS_OF),restored=safe.categories.find(row=>row.name==='Categoria antiga personalizada');
  assert.ok(restored);
  assert.equal(restored.archived,true);
  assert.equal(safe.entries[0].category,old.entries[0].category);
  assert.deepEqual(parseBackup(serializeBackup(safe)),safe);
  assert.ok(!categoryNames(safe).includes(restored.name));
});

test('duplicate category names, normalization collisions and malformed catalogs are rejected without mutation',()=>{
  const initial=seeded(),before=structuredClone(initial);
  for(const name of ['salário',' SALÁRIO ','Ｓａｌáｒｉｏ'])assert.throws(()=>addCategory(initial,name),/Já existe/);
  assert.throws(()=>updateCategory(initial,'pets',{name:'Salário'}),/Já existe/);
  for(const categories of [null,{},[{id:'same',name:'One'},{id:'same',name:'Two'}],[{id:'a',name:'One',archived:'false'}]]){
    assert.throws(()=>validateState({...emptyState('Teste',AS_OF),categories},AS_OF));
  }
  assert.throws(()=>updateCategory(initial,'pets',{archived:'false'}),/Situação/);
  assert.deepEqual(initial,before);
});

test('limits and the last active category protect usable selectors',()=>{
  let state=emptyState('Teste',AS_OF);
  state.categories=[{id:'only',name:'Única',archived:false}];
  assert.throws(()=>updateCategory(state,'only',{archived:true}),/ao menos uma/);
  assert.throws(()=>addCategory(state,'x'.repeat(61)),/Categoria inválid/);
  state.categories=Array.from({length:MAX_CATEGORIES},(_,i)=>({id:'cat'+i,name:'Categoria '+i,archived:false}));
  assert.throws(()=>addCategory(state,'Além do limite'),/100 categorias/);
  assert.equal(state.categories.length,MAX_CATEGORIES);
  assert.throws(()=>updateCategory(state,'missing',{name:'Ausente'}),/não encontrada/);
});

test('all configured budget categories render after the original ten and category names are escaped',()=>{
  let state=demo(AS_OF);
  state=addCategory(state,'<img src=x onerror=alert(1)>','escaped');
  state.budgets.push({id:'budget-escaped',month:MONTH,category:'<img src=x onerror=alert(1)>',amount:100});
  for(let i=0;i<11;i++){
    state=addCategory(state,'Custom '+i,'custom-'+i);
    state.budgets.push({id:'budget-custom-'+i,month:MONTH,category:'Custom '+i,amount:100});
  }
  const settings=renderView(context(state));
  assert.match(settings,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(settings,/<img src=x/);
  assert.match(settings,/aria-label="Editar categoria/);
  const planning=renderView(context(state,'planejamento'));
  assert.match(planning,/Custom 10/);
  assert.match(planning,/&lt;img src=x onerror=alert\(1\)&gt;/);
});
