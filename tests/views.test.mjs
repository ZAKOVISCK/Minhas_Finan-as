import test from 'node:test';
import assert from 'node:assert/strict';
import {demo} from '../public/finance.mjs';
import {marketState} from '../public/market.mjs';
import {renderView,ledgerRows,filteredEntries,currency,routes} from '../public/views.mjs';

function context(overrides={}){
 return {state:demo('2000-10-20'),month:'2000-10',view:'inicio',slot:'demo',hidden:false,search:'',typeFilter:'all',statusFilter:'all',scope:'month',page:1,...overrides};
}

test('cash-flow chart has a readable weekly table with the paid amounts',()=>{
 const html=renderView(context());
 assert.match(html,/<summary>Ver valores por semana<\/summary>/);
 assert.match(html,/<caption class="sr-only">Receitas e despesas pagas por semana, em reais<\/caption>/);
 assert.ok(html.includes(`<th scope="row">Semana 1</th><td>${currency(780000)}</td><td>${currency(280000)}</td>`));
 assert.match(html,/<th scope="row">Semana 5<\/th>/);
});

test('exceeded budgets identify the excess with text and an accessible value',()=>{
 const c=context();
 c.state.budgets.find(b=>b.category==='Alimentação').amount=50000;
 const html=renderView(c);
 assert.match(html,/class="budget-row budget-over"/);
 assert.ok(html.includes('Acima do limite em '+currency(12000)));
 assert.match(html,/124% utilizado; acima do limite/);
 assert.match(html,/<progress max="50000" value="50000"/);
});

test('hidden values suppress private amounts and chart/progress attributes on every route',()=>{
 const c=context({hidden:true});
 for(const view of Object.keys(routes)){
  const html=renderView({...c,view});
  for(const value of [3441000,530000,62000,600000])assert.ok(!html.includes(currency(value)),`${view} exposed ${currency(value)}`);
  assert.doesNotMatch(html,/<progress\b/,view+' exposed quantitative progress');
  if(view==='inicio')assert.doesNotMatch(html,/chart-svg/, 'hidden chart exposed a visual amount');
 }
});

test('ledger keeps one set of contextual actions and scoped table headers',()=>{
 const c=context();
 const html=ledgerRows(c,currency);
 const entry=c.state.entries.find(e=>e.description==='Internet');
 assert.match(html,/<table class="ledger-table" role="table">/);
 assert.match(html,/<th scope="col" role="columnheader">Valor<\/th>/);
 assert.ok(html.includes(`data-action="payment" data-id="${entry.id}" aria-label="Pagar Internet"`));
 assert.equal(html.split(`data-action="entry" data-id="${entry.id}"`).length-1,1);
 assert.match(html,/aria-label="Paginação dos lançamentos"/);
 assert.match(html,/id="ledger-count">9 registro\(s\) nos filtros/);
});

test('settings do not expose an unrelated month filter',()=>{
 const html=renderView(context({view:'configuracoes'}));
 assert.doesNotMatch(html,/id="month"/);
 assert.match(renderView(context({view:'planejamento'})),/id="month"/);
});


test('news views refuse executable or external links even from directly mutated state',()=>{
 const previous=marketState.brazil;
 try{
  const urls=['javascript:alert(1)','data:text/html,test','https://ibge.gov.br.evil.example/news','https://ibge.gov.br@evil.example/news','https://ibge.gov.br:8443/news','https://agenciadenoticias.ibge.gov.br/noticias'];
  marketState.brazil={items:urls.map((url,i)=>({url,title:'Notícia '+i,kind:'Publicação',source:'IBGE',language:'pt'}))};
  const html=renderView(context({view:'mercado'}));
  assert.equal((html.match(/Link da publicação indisponível/g)||[]).length,5);
  assert.ok(html.includes('href="https://agenciadenoticias.ibge.gov.br/noticias"'));
  assert.doesNotMatch(html,/href="(?:javascript:|data:|https:\/\/[^"]*evil\.example)/);
 }finally{marketState.brazil=previous;}
});


test('pending ledger filters and pagination remain correct with 10,000 entries',()=>{
 const c=context({scope:'all',statusFilter:'pending'});
 c.state.entries=Array.from({length:10000},(_,i)=>({id:'large-'+i,description:'Lançamento '+i,category:'Outros',type:'expense',amount:1000,dueDate:'2000-10-20',competence:'2000-10',accountId:'bank',cardId:null}));
 c.state.payments=c.state.entries.filter((_,i)=>i%2===1).map(e=>({id:'payment-'+e.id,entryId:e.id,amount:1000,date:'2000-10-20',accountId:'bank'}));
 c.state.payments.push({id:'partial',entryId:'large-0',amount:500,date:'2000-10-20',accountId:'bank'});
 const filtered=filteredEntries(c);
 assert.equal(filtered.length,5000);
 assert.ok(filtered.every(e=>Number(e.id.slice(6))%2===0));
 const html=ledgerRows(c,currency);
 assert.match(html,/5000 registro\(s\) nos filtros/);
 assert.equal((html.match(/<tr role="row">/g)||[]).length,51);
 assert.ok(html.includes('Pendente '+currency(500)));
 assert.match(html,/Página 1 de 100/);
});

test('historical portfolio view never displays a later price beside an unavailable position',()=>{
 const c=context({view:'investimentos'});
 c.state.assets=[{id:'historical',symbol:'TEST3',name:'Ativo de teste',kind:'stock',manualPrice:123456,priceDate:'2000-11-01',source:'Preço posterior'}];
 c.state.trades=[{id:'buy-history',assetId:'historical',accountId:'broker',side:'buy',quantity:1000000,price:10000,fees:0,date:'2000-10-15'}];
 const html=renderView(c);
 assert.match(html,/Sem cotação no período/);
 assert.ok(!html.includes(currency(123456)));
 assert.doesNotMatch(html,/Preço posterior/);
});
