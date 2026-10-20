import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CENTS, MAX_BACKUP_BYTES, SCALE, emptyState, validateState, addMonths,
  parseMoney, units, multiply, outstanding, balances, summary, budgetUsage,
  settle, purchase, payStatement, generateRecurrences, positions, portfolio,
  migrate, serializeBackup, parseBackup, ledgerCSV, demo,
} from '../public/finance.mjs';

const AS_OF='2026-10-20', MONTH='2026-10';
const account=(id='bank',overrides={})=>({id,name:id,kind:'bank',opening:100000,openingDate:'2026-01-01',archived:false,...overrides});
const entry=(id='expense',overrides={})=>({id,description:id,type:'expense',category:'Alimentação',amount:10000,dueDate:'2026-10-19',competence:MONTH,accountId:'bank',cardId:null,...overrides});
const payment=(id='payment',overrides={})=>({id,entryId:'expense',accountId:'bank',amount:10000,date:'2026-10-19',...overrides});
const asset=(id='asset',overrides={})=>({id,symbol:id,name:id,kind:'stock',manualPrice:null,...overrides});
const trade=(id='buy',overrides={})=>({id,assetId:'asset',accountId:'bank',side:'buy',quantity:SCALE,price:1000,fees:0,date:'2026-10-19',...overrides});
const recurrence=(overrides={})=>({id:'rent',description:'Aluguel',type:'expense',category:'Moradia',amount:1000,accountId:'bank',day:31,start:'2026-01',end:'',active:true,...overrides});
const state=(overrides={})=>({...emptyState('Teste',AS_OF),accounts:[account()],...overrides});
const safe=overrides=>validateState(state(overrides),AS_OF);

test('demo and empty personal state validate without shared mutable collections',()=>{
  assert.equal(validateState(demo(AS_OF),AS_OF).version,3);
  const a=emptyState(),b=emptyState();a.accounts.push(account());assert.equal(b.accounts.length,0);
});
test('centavos e quantidades têm precisão de entrada explícita',()=>{
  assert.equal(parseMoney('1.234,56'),123456);assert.equal(parseMoney('0,29'),29);
  assert.equal(parseMoney('0,001'),null);assert.equal(units('1,000001'),1000001);
  assert.equal(units('1.0000001'),null);assert.equal(multiply(1500000,101),152);
});
test('meses preservam último dia e anos bissextos',()=>{
  assert.equal(addMonths('2024-01-31',1),'2024-02-29');
  assert.equal(addMonths('2026-01-31',1),'2026-02-28');
  assert.equal(addMonths('2026-01',1,31),'2026-02-28');
});
for(const value of ['2026-13','2026-02-30','invalida'])test(`calendário rejeita origem inválida: ${value}`,()=>assert.throws(()=>addMonths(value,1),/inválido/));
test('calendário rejeita dia e intervalo fora do contrato',()=>{
  assert.throws(()=>addMonths('2026-10',0,0),/Dia/);
  assert.throws(()=>addMonths('2026-10',0.5),/inválido/);
  assert.throws(()=>addMonths('2199-12',1),/mês válido/);
});
test('pagamento parcial preserva vencimento e competência',()=>{
  const before=safe({entries:[entry()]});
  const after=settle(before,'expense',3000,'2026-10-20','bank','partial');
  assert.equal(after.entries[0].dueDate,'2026-10-19');assert.equal(after.entries[0].competence,MONTH);
  assert.equal(outstanding(after,after.entries[0]),7000);assert.equal(balances(after,AS_OF).get('bank'),97000);
});
test('quitação provisionada não reduz o disponível duas vezes',()=>{
  const before=safe({entries:[entry()]});const after=settle(before,'expense',10000,'2026-10-20','bank','paid');
  assert.equal(summary(before,MONTH,AS_OF).available,summary(after,MONTH,AS_OF).available);
  assert.equal(summary(after,MONTH,AS_OF).pending,0);assert.equal(summary(after,MONTH,AS_OF).expense,10000);
});
test('pagamento com chave de importação sobrevive à validação e ao backup',()=>{
  const original=safe({entries:[entry()],payments:[payment('p',{importKey:'bank-fitid-2026'})]});
  assert.equal(original.payments[0].importKey,'bank-fitid-2026');
  assert.equal(parseBackup(serializeBackup(original)).payments[0].importKey,'bank-fitid-2026');
});
test('pagamento antigo sem chave de importação continua válido',()=>assert.equal(safe({entries:[entry()],payments:[payment()]}).payments[0].importKey,''));
test('chave de importação acima do limite é recusada',()=>assert.throws(()=>safe({entries:[entry()],payments:[payment('p',{importKey:'x'.repeat(401)})]}),/Texto/));
test('superpagamento, data futura e data anterior à conta são recusados',()=>{
  assert.throws(()=>safe({entries:[entry()],payments:[payment('p',{amount:10001})]}),/excedem/);
  assert.throws(()=>safe({entries:[entry()],payments:[payment('p',{date:'2026-10-21'})]}),/futuro/);
  assert.throws(()=>safe({entries:[entry()],payments:[payment('p',{date:'2025-12-31'})]}),/abertura/);
});
test('histórico considera apenas pagamentos realizados até o corte',()=>{
  const s=safe({entries:[entry('expense',{dueDate:'2026-09-30',competence:'2026-09'})],payments:[payment()]});
  const september=summary(s,'2026-09',AS_OF),october=summary(s,MONTH,AS_OF);
  assert.equal(september.cash,100000);assert.equal(september.pending,10000);
  assert.equal(october.cash,90000);assert.equal(october.pending,0);assert.equal(october.expense,10000);
});
test('transferência altera contas sem virar receita ou despesa',()=>{
  const s=safe({accounts:[account(),account('cash',{kind:'cash',opening:0})],transfers:[{id:'transfer',fromId:'bank',toId:'cash',amount:12000,date:AS_OF}]});
  assert.deepEqual([...balances(s,AS_OF).values()],[88000,12000]);
  const totals=summary(s,MONTH,AS_OF);assert.equal(totals.cash,100000);assert.equal(totals.income,0);assert.equal(totals.expense,0);
});
test('transferência para corretora mantém caixa da corretora separado',()=>{
  const s=safe({accounts:[account(),account('broker',{kind:'investment',opening:0})],transfers:[{id:'transfer',fromId:'bank',toId:'broker',amount:12000,date:AS_OF}]});
  assert.equal(summary(s,MONTH,AS_OF).cash,88000);assert.equal(summary(s,MONTH,AS_OF).brokerCash,12000);
});
test('transferência entre a mesma conta é recusada',()=>assert.throws(()=>safe({transfers:[{id:'t',fromId:'bank',toId:'bank',amount:1,date:AS_OF}]}),/diferentes/));
test('parcelamento divide centavos sem criar despesa no pagamento da fatura',()=>{
  const s=safe({cards:[{id:'card',name:'Cartão',limit:100000,closingDay:15,dueDay:22,accountId:'bank'}]});
  const bought=purchase(s,{cardId:'card',description:'Compra',category:'Lazer',amount:10000,date:'2026-10-01',installments:3,firstStatement:MONTH});
  assert.deepEqual(bought.entries.map(e=>e.amount),[3334,3333,3333]);
  assert.equal(budgetUsage(bought,MONTH,'Lazer').spent,3334);
  const paid=payStatement(bought,'card',MONTH,3334,AS_OF,'bank');
  assert.equal(paid.entries.length,3);assert.equal(outstanding(paid,paid.entries[0]),0);
  assert.equal(budgetUsage(paid,MONTH,'Lazer').spent,3334);assert.equal(summary(paid,MONTH,AS_OF).expense,3334);
});
test('pagamento de fatura inválido não vira operação silenciosa',()=>{
  const s=safe({cards:[{id:'card',name:'Cartão',limit:100000,closingDay:15,dueDay:22,accountId:'bank'}]});
  for(const amount of [NaN,undefined,0,-1,1.5])assert.throws(()=>payStatement(s,'card',MONTH,amount,AS_OF,'bank'));
});
test('receita vinculada a fatura não pode transformar pagamento em crédito no caixa',()=>{
  assert.throws(()=>safe({cards:[{id:'card',name:'Cartão',limit:100000,closingDay:15,dueDay:22,accountId:'bank'}],entries:[entry('cashback',{type:'income',cardId:'card',statementMonth:MONTH})]}),/devem ser despesas/);
});
test('compra rejeita data e fatura inválidas antes de normalizar o calendário',()=>{
  const s=safe({cards:[{id:'card',name:'Cartão',limit:100000,closingDay:15,dueDay:22,accountId:'bank'}]});
  const input={cardId:'card',description:'Compra',category:'Lazer',amount:1000,date:'2026-10-01',installments:1,firstStatement:MONTH};
  assert.throws(()=>purchase(s,{...input,date:'2026-02-30'}),/Data/);
  assert.throws(()=>purchase(s,{...input,firstStatement:'2026-13'}),/Mês/);
});
test('recorrência é idempotente e dia 31 é ajustado ao fim do mês',()=>{
  const s=safe({recurrences:[recurrence()]});const once=generateRecurrences(s,'2026-02');const twice=generateRecurrences(once,'2026-02');
  assert.equal(twice.entries.length,1);assert.equal(twice.entries[0].dueDate,'2026-02-28');
});
test('recorrências respeitam início, fim e pausa',()=>{
  const s=safe({recurrences:[recurrence({start:'2026-02',end:'2026-03'})]});
  assert.equal(generateRecurrences(s,'2026-01').entries.length,0);
  assert.equal(generateRecurrences(s,'2026-02').entries.length,1);
  assert.equal(generateRecurrences(s,'2026-04').entries.length,0);
  assert.equal(generateRecurrences(safe({recurrences:[recurrence({active:false})]}),MONTH).entries.length,0);
});
test('backup não contorna intervalo de recorrência nem duplica ocorrência',()=>{
  assert.throws(()=>safe({recurrences:[recurrence({start:'2026-03',end:'2026-02'})]}),/último mês/);
  assert.throws(()=>safe({entries:[entry('a',{recurrenceKey:'rent_2026-10'}),entry('b',{recurrenceKey:'rent_2026-10'})]}),/duplicada/);
});
test('ajuste de orçamento vale a partir do mês sem reescrever meses anteriores',()=>{
  const s=safe({budgets:[{id:'old',month:'2026-09',category:'Lazer',amount:10000},{id:'new',month:MONTH,category:'Lazer',amount:20000}]});
  assert.equal(budgetUsage(s,'2026-09','Lazer').amount,10000);assert.equal(budgetUsage(s,'2026-11','Lazer').amount,20000);
});
test('comprar e vender ativos afeta caixa, custo e resultado sem despesa de consumo',()=>{
  const s=safe({assets:[asset()],trades:[trade('buy',{quantity:2*SCALE,price:1000,fees:20}),trade('sell',{side:'sell',quantity:SCALE,price:1200,fees:10})]});
  const p=positions(s,AS_OF)[0];assert.equal(p.quantity,SCALE);assert.equal(p.cost,1010);assert.equal(p.realized,180);
  assert.equal(balances(s,AS_OF).get('bank'),99170);assert.equal(summary(s,MONTH,AS_OF).expense,0);
});
test('venda superior à posição é recusada',()=>assert.throws(()=>safe({assets:[asset()],trades:[trade('sell',{side:'sell'})]}),/superior/));
test('atualização mais recente no mesmo dia vence no histórico de preços',()=>{
  const s=safe({assets:[asset('asset',{manualPrice:2000,priceDate:'2026-10-19'})],trades:[trade()],prices:[{id:'old',assetId:'asset',date:'2026-10-19',amount:1000,source:'Primeira'},{id:'new',assetId:'asset',date:'2026-10-19',amount:2000,source:'Atualizada'}]});
  assert.equal(positions(s,AS_OF)[0].value,2000);assert.equal(positions(s,AS_OF)[0].asset.source,'Atualizada');
});
test('cotação manual mais recente não é escondida por histórico antigo',()=>{
  const s=safe({assets:[asset('asset',{manualPrice:3000,priceDate:AS_OF})],trades:[trade()],prices:[{id:'old',assetId:'asset',date:'2026-10-19',amount:1000,source:'Antiga'}]});
  assert.equal(positions(s,AS_OF)[0].value,3000);
});
test('backup não contorna rejeição de cotação ou posição global futura',()=>{
  assert.throws(()=>safe({assets:[asset('asset',{manualPrice:1000,priceDate:'2026-10-21'})]}),/Cotação futura/);
  assert.throws(()=>safe({assets:[asset()],prices:[{id:'p',assetId:'asset',date:'2026-10-21',amount:1000,source:'Manual'}]}),/Cotação futura/);
  assert.throws(()=>safe({snapshots:[{id:'s',date:'2026-10-21',amount:1000,source:'Manual'}]}),/Posição futura/);
});
test('posição global mais recente no mesmo dia vence',()=>{
  const s=safe({snapshots:[{id:'old',date:AS_OF,amount:1000,source:'Antiga'},{id:'new',date:AS_OF,amount:2000,source:'Nova'}]});
  assert.equal(portfolio(s,AS_OF).snapshot.amount,2000);
});
test('quantidade acumulada rejeita excesso antes de perder micro-unidade',()=>assert.throws(()=>safe({assets:[asset()],trades:[trade('a',{quantity:1e15,price:1}),trade('b',{quantity:1,price:1})]}),/Quantidade acumulada/));
test('desdobramento mantém custo e quantidade exata',()=>{
  const s=safe({assets:[asset()],trades:[trade(),trade('split',{side:'split',quantity:2*SCALE,price:0})]});
  assert.equal(positions(s,AS_OF)[0].quantity,2*SCALE);assert.equal(positions(s,AS_OF)[0].cost,1000);
});
test('desdobramento não ignora preço ou custos do backup',()=>{
  for(const patch of [{fees:123},{price:123}])assert.throws(()=>safe({assets:[asset()],trades:[trade(),trade('split',{side:'split',quantity:2*SCALE,price:0,...patch})]}),/iguais a zero/);
});
test('grupamento não trunca frações menores que seis casas',()=>assert.throws(()=>safe({assets:[asset()],trades:[trade('a',{quantity:1}),trade('split',{side:'split',quantity:500000,price:0})]}),/seis casas/));
test('nova operação após exclusões recebe sequência posterior às existentes',()=>{
  const s=safe({assets:[asset()],trades:[trade('z-buy',{sequence:100}),trade('a-sell',{side:'sell'})]});
  assert.equal(s.trades[1].sequence,101);assert.equal(positions(s,AS_OF)[0].quantity,0);
});
test('rendimentos anunciados não entram no caixa; recebidos entram uma vez',()=>{
  const s=safe({assets:[asset()],dividends:[{id:'a',assetId:'asset',accountId:'bank',amount:1000,date:AS_OF,status:'announced'},{id:'b',assetId:'asset',accountId:'bank',amount:2000,date:AS_OF,status:'received'}]});
  assert.equal(balances(s,AS_OF).get('bank'),102000);assert.equal(positions(s,AS_OF)[0].dividends,2000);
});
test('soma de metas participa da proteção de precisão do disponível',()=>{
  const goals=Array.from({length:9010},(_,i)=>({id:'g'+i,name:'Meta',target:MAX_CENTS,allocated:MAX_CENTS,dueDate:AS_OF}));
  assert.throws(()=>safe({goals}),/precisão/);
});
test('reserva participa da proteção de precisão do disponível',()=>{
  const entries=Array.from({length:9007},(_,i)=>entry('e'+i,{amount:MAX_CENTS}));
  assert.throws(()=>safe({entries,reserves:[{id:'r',month:MONTH,amount:MAX_CENTS}]}),/precisão/);
});
test('soma de posições valorizadas não excede o inteiro seguro',()=>{
  const assets=Array.from({length:9008},(_,i)=>asset('a'+i,{manualPrice:MAX_CENTS,priceDate:AS_OF}));
  const trades=assets.map((a,i)=>trade('t'+i,{assetId:a.id,price:1}));
  assert.throws(()=>safe({assets,trades}),/carteira acima da precisão/);
});
test('estado aceito tem backup restaurável com 10 mil descrições Unicode',()=>{
  const entries=Array.from({length:10000},(_,i)=>entry('e'+i,{description:'漢'.repeat(100),amount:1}));
  const s=safe({entries});const backup=serializeBackup(s);
  assert.ok(Buffer.byteLength(backup)<MAX_BACKUP_BYTES);assert.equal(parseBackup(backup).entries.length,10000);
});
test('estado maior que o limite de backup é recusado antes de persistir',()=>{
  const large='\u0001'.repeat(400);
  const entries=Array.from({length:3600},(_,i)=>entry('e'+i,{origin:large,importKey:large,recurrenceKey:String(i)+large.slice(String(i).length),groupId:large}));
  assert.throws(()=>safe({entries}),/limite de backup de 33 MiB/);
});
test('migração V1/V2 preserva saldo, pendências e posição global separada',()=>{
  for(const version of [1,2]){
    const old={version,revision:0,name:'Teste',opening:100000,reserve:10000,investments:50000,budgets:{Alimentação:8000,Transporte:4000,Lazer:4000},entries:[{id:'paid',description:'Pago',category:'Alimentação',amount:1000,type:'expense',status:'paid',date:'2026-10-01'},{id:'pending',description:'Previsto',category:'Outros',amount:2000,type:'expense',status:'pending',date:'2026-10-22'}]};
    const s=migrate(old,AS_OF),totals=summary(s,MONTH,AS_OF);
    assert.equal(totals.cash,99000);assert.equal(totals.pending,2000);assert.equal(totals.available,87000);
    assert.equal(portfolio(s,AS_OF).snapshot.amount,50000);assert.equal(portfolio(s,AS_OF).known,0);
    assert.ok(s.entries.every(e=>e.assumedDate));assert.equal(s.migrationNotes.length,3);
  }
});
test('migração antiga bloqueia realizado futuro',()=>{
  const old={version:2,revision:0,name:'Teste',opening:0,reserve:0,investments:0,budgets:{Alimentação:0,Transporte:0,Lazer:0},entries:[{id:'future',description:'Futuro',category:'Salário',amount:1,type:'income',status:'paid',date:'2026-10-21'}]};
  assert.throws(()=>migrate(old,AS_OF),/realizado futuro/);
});
test('CSV usa competência e neutraliza fórmula em texto',()=>{
  const s=safe({entries:[entry('a',{description:'=1+1'}),entry('b',{competence:'2026-09'})]});
  const csv=ledgerCSV(s,MONTH);assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"\'=1+1"'));assert.equal(csv.split('\r\n').length,2);
});
test('CSV preserva total pendente e nomes após pagamento parcial',()=>{
  const s=safe({accounts:[account('bank',{name:'Conta principal'})],entries:[entry()],payments:[payment('partial',{amount:3000})]});
  const csv=ledgerCSV(s,MONTH);assert.ok(csv.includes('"100,00";"70,00";"Conta principal";""'));
});
test('resumo escala sem consultar todos os pagamentos para cada pendência',()=>{
  const entries=Array.from({length:5000},(_,i)=>entry('e'+i,{amount:10}));
  const payments=entries.map((e,i)=>payment('p'+i,{entryId:e.id,amount:4}));
  const s=safe({entries,payments});const result=summary(s,MONTH,AS_OF);
  assert.equal(result.pending,30000);assert.equal(result.expense,20000);assert.equal(result.cash,80000);assert.equal(result.available,50000);
});
