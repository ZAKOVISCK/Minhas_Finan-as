import { parseMoney, localDate, validMonth, validDate, endOfMonth, csvCell, validateState as legacyValidate } from './legacy-finance.mjs';
export {parseMoney,localDate,validMonth,validDate,endOfMonth,csvCell};
export const CATEGORIES=['Alimentação','Transporte','Lazer','Moradia','Serviços','Saúde','Educação','Salário','Rendimentos','Outros'];
export const COLLECTIONS=['accounts','entries','payments','transfers','cards','budgets','reserves','goals','recurrences','assets','prices','trades','dividends','snapshots','watchlist'];
export const MAX_CENTS=999_999_999_999, MAX_RECORDS=30_000, MAX_BACKUP_BYTES=32*1024*1024, SCALE=1_000_000;
const fail=m=>{throw new Error(m);};
export const uid=()=>crypto.randomUUID();
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const text=(x,label,max=100)=>typeof x==='string'&&x.trim()&&x.trim().length<=max?x.trim():fail(`${label} inválido.`);
const ident=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(x)?x:fail('Identificador inválido.');
const cents=(x,label,signed=false)=>Number.isSafeInteger(x)&&Math.abs(x)<=MAX_CENTS&&(signed||x>=0)?x:fail(`Valor inválido: ${label}.`);
const positive=(x,label)=>cents(x,label)>0?x:fail(`${label} deve ser maior que zero.`);
const date=x=>validDate(x)?x:fail('Data inválida.');
const month=x=>validMonth(x)?x:fail('Mês inválido.');
const choice=(x,values)=>values.includes(x)?x:fail('Opção inválida.');
const optionalText=x=>x==null||x===''?'':text(x,'Texto',400);
export function addMonths(value,n,day){const [y,m]=value.slice(0,7).split('-').map(Number);const d=new Date(y,m-1+n,1);const ym=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;return `${ym}-${String(Math.min(day??Number(value.slice(8)||1),Number(endOfMonth(ym).slice(8)))).padStart(2,'0')}`;}
export function units(value){const s=String(value??'').trim().replace(',','.');if(!/^\d+(\.\d{1,6})?$/.test(s))return null;const[a,b='']=s.split('.');const n=Number(a)*SCALE+Number(b.padEnd(6,'0'));return Number.isSafeInteger(n)&&n>0&&n<=1e15?n:null;}
export function multiply(quantity,price){const n=(BigInt(quantity)*BigInt(price)+BigInt(SCALE/2))/BigInt(SCALE);if(n>BigInt(MAX_CENTS))fail('Valor da operação excede o limite.');return Number(n);}
export function emptyState(name='Meu espaço',asOf=localDate()){return {version:3,revision:0,name,createdAt:asOf,migrationNotes:[],...Object.fromEntries(COLLECTIONS.map(c=>[c,[]]))};}
export function validateState(raw,asOf=localDate()){
 if(!object(raw)||raw.version!==3)fail('Formato de dados não reconhecido.');
 const s=emptyState(text(raw.name,'Nome',40),date(raw.createdAt));
 if(!Number.isSafeInteger(raw.revision)||raw.revision<0||raw.revision>=Number.MAX_SAFE_INTEGER-1)fail('Revisão inválida.');s.revision=raw.revision;
 s.migrationNotes=Array.isArray(raw.migrationNotes)?raw.migrationNotes.slice(0,30).map(x=>text(x,'Nota',300)):[];
 let count=0;for(const c of COLLECTIONS){if(!Array.isArray(raw[c])||(count+=raw[c].length)>MAX_RECORDS)fail('Limite de 30.000 registros excedido.');const ids=new Set();s[c]=raw[c].map(x=>{if(!object(x))fail('Registro inválido.');const id=ident(x.id);if(ids.has(id))fail('Identificador duplicado.');ids.add(id);return {...x,id};});}
 s.accounts=s.accounts.map(a=>({id:a.id,name:text(a.name,'Conta',60),kind:choice(a.kind,['bank','cash','investment']),opening:cents(a.opening,'saldo inicial',true),openingDate:date(a.openingDate),archived:!!a.archived}));
 const accountIds=new Set(s.accounts.map(a=>a.id));const account=x=>accountIds.has(x)?x:fail('Conta não encontrada.');
 s.cards=s.cards.map(c=>({id:c.id,name:text(c.name,'Cartão',60),limit:cents(c.limit,'limite'),closingDay:choice(c.closingDay,Array.from({length:31},(_,i)=>i+1)),dueDay:choice(c.dueDay,Array.from({length:31},(_,i)=>i+1)),accountId:account(c.accountId)}));
 const cardIds=new Set(s.cards.map(c=>c.id));
 s.entries=s.entries.map(e=>({id:e.id,description:text(e.description,'Descrição'),type:choice(e.type,['income','expense']),category:choice(e.category,CATEGORIES),amount:positive(e.amount,'Valor'),dueDate:date(e.dueDate),competence:month(e.competence),accountId:account(e.accountId),cardId:e.cardId?(cardIds.has(e.cardId)?e.cardId:fail('Cartão não encontrado.')):null,statementMonth:e.cardId?month(e.statementMonth):null,origin:optionalText(e.origin),importKey:optionalText(e.importKey),recurrenceKey:optionalText(e.recurrenceKey),groupId:optionalText(e.groupId),assumedDate:!!e.assumedDate}));
 const entryMap=new Map(s.entries.map(e=>[e.id,e]));const paid=new Map();
 s.payments=s.payments.map(p=>{const e=entryMap.get(p.entryId);if(!e)fail('Pagamento sem lançamento.');const when=date(p.date);if(when>asOf)fail('Pagamento futuro: use um compromisso previsto.');const a=account(p.accountId);if(when<s.accounts.find(x=>x.id===a).openingDate)fail('Pagamento anterior à abertura da conta.');const amount=positive(p.amount,'Pagamento');paid.set(e.id,(paid.get(e.id)||0)+amount);return{id:p.id,entryId:e.id,accountId:a,amount,date:when};});
 for(const[id,total]of paid)if(total>entryMap.get(id).amount)fail('Pagamentos excedem o valor do lançamento.');
 s.transfers=s.transfers.map(t=>{const fromId=account(t.fromId),toId=account(t.toId),when=date(t.date);if(fromId===toId)fail('Escolha contas diferentes.');if(when>asOf||[fromId,toId].some(id=>when<s.accounts.find(a=>a.id===id).openingDate))fail('Data de transferência inválida para as contas.');return{id:t.id,fromId,toId,date:when,amount:positive(t.amount,'Transferência')};});
 s.budgets=s.budgets.map(b=>({id:b.id,month:month(b.month),category:choice(b.category,CATEGORIES),amount:cents(b.amount,'orçamento')}));
 s.reserves=s.reserves.map(r=>({id:r.id,month:month(r.month),amount:cents(r.amount,'reserva')}));
 for(const c of ['budgets','reserves']){const keys=new Set();for(const x of s[c]){const k=x.month+(x.category||'');if(keys.has(k))fail('Plano mensal duplicado.');keys.add(k);}}
 s.goals=s.goals.map(g=>({id:g.id,name:text(g.name,'Objetivo',60),target:positive(g.target,'Meta'),allocated:cents(g.allocated,'valor separado'),dueDate:date(g.dueDate)}));
 s.recurrences=s.recurrences.map(r=>({id:r.id,description:text(r.description,'Descrição'),type:choice(r.type,['income','expense']),category:choice(r.category,CATEGORIES),amount:positive(r.amount,'Recorrência'),accountId:account(r.accountId),start:month(r.start),end:r.end?month(r.end):'',day:choice(r.day,Array.from({length:31},(_,i)=>i+1)),active:r.active!==false}));
 s.assets=s.assets.map(a=>({id:a.id,symbol:text(a.symbol,'Ativo',20).toUpperCase(),name:text(a.name,'Nome do ativo',80),kind:choice(a.kind,['stock','fii','fixed','fund','other']),manualPrice:a.manualPrice==null?null:positive(a.manualPrice,'Cotação'),priceDate:a.manualPrice==null?'':date(a.priceDate),source:optionalText(a.source)||'Manual',maturity:a.maturity?date(a.maturity):'',annualRate:a.annualRate==null?null:(Number.isFinite(a.annualRate)&&a.annualRate>=0&&a.annualRate<=100?a.annualRate:fail('Taxa inválida.'))}));
 const assetIds=new Set(s.assets.map(a=>a.id));
 s.prices=s.prices.map(p=>{if(!assetIds.has(p.assetId))fail('Ativo do preço não encontrado.');return{id:p.id,assetId:p.assetId,amount:positive(p.amount,'Preço'),date:date(p.date),source:text(p.source,'Fonte',160)};});
 s.trades=s.trades.map((t,index)=>{if(!assetIds.has(t.assetId))fail('Ativo da operação não encontrado.');const q=t.quantity;if(!Number.isSafeInteger(q)||q<=0||q>1e15)fail('Quantidade inválida.');const when=date(t.date);if(when>asOf)fail('Operação futura não realizada.');const a=account(t.accountId);if(when<s.accounts.find(x=>x.id===a).openingDate)fail('Operação anterior à abertura da conta.');return{id:t.id,sequence:Number.isSafeInteger(t.sequence)&&t.sequence>=0?t.sequence:index,assetId:t.assetId,accountId:a,side:choice(t.side,['buy','sell','split']),quantity:q,price:t.side==='split'?0:positive(t.price,'Preço'),fees:cents(t.fees,'Custos'),date:when};});
 s.dividends=s.dividends.map(d=>{if(!assetIds.has(d.assetId))fail('Ativo do rendimento não encontrado.');const status=choice(d.status,['announced','received']);const when=date(d.date);if(status==='received'&&when>asOf)fail('Rendimento recebido com data futura.');if(status==='received'&&when<s.accounts.find(a=>a.id===d.accountId)?.openingDate)fail('Rendimento anterior à abertura da conta.');return{id:d.id,assetId:d.assetId,accountId:account(d.accountId),amount:positive(d.amount,'Rendimento'),date:when,status};});
 s.snapshots=s.snapshots.map(x=>({id:x.id,date:date(x.date),amount:cents(x.amount,'posição informada'),source:optionalText(x.source)||'Manual'}));
 s.watchlist=s.watchlist.map(w=>({id:w.id,symbol:text(w.symbol,'Código',20).toUpperCase(),kind:choice(w.kind,['stock','fii','index','currency','other'])}));
 // Somatórios financeiros permanecem exatos em centavos, inclusive no pior caso.
 const exposure=[...s.accounts.map(x=>Math.abs(x.opening)),...s.entries.map(x=>x.amount),...s.transfers.map(x=>x.amount),...s.trades.map(x=>multiply(x.quantity,x.price)+x.fees),...s.dividends.map(x=>x.amount)].reduce((a,b)=>a+b,0);if(!Number.isSafeInteger(exposure))fail('Total acima da precisão permitida.');
 positions(s,asOf);return s;
}
export function outstanding(s,e,asOf='2199-12-31'){return e.amount-s.payments.filter(p=>p.entryId===e.id&&p.date<=asOf).reduce((n,p)=>n+p.amount,0);}
export function balances(s,asOf=localDate()){
 const map=new Map(s.accounts.map(a=>[a.id,a.openingDate<=asOf?a.opening:0]));const entries=new Map(s.entries.map(e=>[e.id,e]));
 for(const p of s.payments)if(p.date<=asOf)map.set(p.accountId,map.get(p.accountId)+p.amount*(entries.get(p.entryId).type==='income'?1:-1));
 for(const t of s.transfers)if(t.date<=asOf){map.set(t.fromId,map.get(t.fromId)-t.amount);map.set(t.toId,map.get(t.toId)+t.amount);}
 for(const t of s.trades)if(t.date<=asOf&&t.side!=='split'){const amount=multiply(t.quantity,t.price);map.set(t.accountId,map.get(t.accountId)+(t.side==='buy'?-amount-t.fees:amount-t.fees));}
 for(const d of s.dividends)if(d.status==='received'&&d.date<=asOf)map.set(d.accountId,map.get(d.accountId)+d.amount);
 return map;
}
export function monthlyPlan(rows,m,category){return rows.filter(r=>r.month<=m&&(!category||r.category===category)).sort((a,b)=>b.month.localeCompare(a.month))[0]?.amount||0;}
export function summary(s,m,asOf=localDate()){
 const cutoff=[endOfMonth(m),asOf].sort()[0], b=balances(s,cutoff),em=new Map(s.entries.map(e=>[e.id,e]));
 const cash=s.accounts.filter(a=>a.kind!=='investment').reduce((n,a)=>n+b.get(a.id),0),brokerCash=s.accounts.filter(a=>a.kind==='investment').reduce((n,a)=>n+b.get(a.id),0);
 const due=s.entries.filter(e=>e.type==='expense'&&e.dueDate<=endOfMonth(m)&&outstanding(s,e,cutoff)>0);
 const pending=due.reduce((n,e)=>n+outstanding(s,e,cutoff),0),reserve=monthlyPlan(s.reserves,m),earmarks=s.goals.reduce((n,g)=>n+g.allocated,0);
 const payments=s.payments.filter(p=>p.date.startsWith(m)&&p.date<=cutoff);
 return {cash,brokerCash,pending,reserve,earmarks,available:cash-pending-reserve-earmarks,overdue:due.filter(e=>e.dueDate<cutoff).reduce((n,e)=>n+outstanding(s,e,cutoff),0),income:payments.filter(p=>em.get(p.entryId).type==='income').reduce((n,p)=>n+p.amount,0),expense:payments.filter(p=>em.get(p.entryId).type==='expense').reduce((n,p)=>n+p.amount,0),cutoff,due};
}
export function budgetUsage(s,m,category){const amount=monthlyPlan(s.budgets,m,category),spent=s.entries.filter(e=>e.type==='expense'&&e.competence===m&&e.category===category).reduce((n,e)=>n+e.amount,0);return{amount,spent,percent:amount?spent/amount*100:null};}
export function settle(s,entryId,amount,when,accountId,id=uid()){
 const next=structuredClone(s),e=next.entries.find(e=>e.id===entryId);if(!e)fail('Lançamento não encontrado.');if(amount>outstanding(s,e))fail('Valor maior que o saldo pendente.');next.payments.push({id,entryId,amount,date:when,accountId});return validateState(next);
}
export function statementDue(card,statementMonth){return addMonths(statementMonth+'-01',0,card.dueDay);}
export function purchase(s,{cardId,description,category,amount,date:when,installments,firstStatement}){
 const card=s.cards.find(c=>c.id===cardId);if(!card)fail('Cartão não encontrado.');if(!Number.isInteger(installments)||installments<1||installments>60||amount<installments)fail('Parcelamento inválido.');const next=structuredClone(s),groupId=uid();
 for(let i=0;i<installments;i++){const sm=addMonths(firstStatement+'-01',i).slice(0,7);next.entries.push({id:uid(),description:`${description} (${i+1}/${installments})`,category,type:'expense',amount:Math.floor(amount/installments)+(i<amount%installments?1:0),dueDate:statementDue(card,sm),competence:addMonths(when,i).slice(0,7),accountId:card.accountId,cardId,statementMonth:sm,origin:'Cartão',groupId});}
 return validateState(next);
}
export function payStatement(s,cardId,m,amount,when,accountId){let next=structuredClone(s),left=amount;for(const e of next.entries.filter(e=>e.cardId===cardId&&e.statementMonth===m).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||a.id.localeCompare(b.id))){const n=Math.min(left,outstanding(next,e));if(n>0){next.payments.push({id:uid(),entryId:e.id,amount:n,date:when,accountId});left-=n;}}if(left||amount<=0)fail('Pagamento maior que a fatura ou inválido.');return validateState(next);}
export function generateRecurrences(s,m){const next=structuredClone(s),seen=new Set(next.entries.map(e=>e.recurrenceKey));for(const r of s.recurrences){const key=`${r.id}_${m}`;if(!r.active||m<r.start||(r.end&&m>r.end)||seen.has(key))continue;next.entries.push({id:uid(),description:r.description,type:r.type,category:r.category,amount:r.amount,dueDate:addMonths(m+'-01',0,r.day),competence:m,accountId:r.accountId,cardId:null,origin:'Recorrência',recurrenceKey:key});}return validateState(next);}
export function positions(s,asOf=localDate()){
 const result=new Map(s.assets.map(a=>[a.id,{asset:a,quantity:0,cost:0,realized:0,dividends:0,value:null}]));
 for(const t of s.trades.filter(t=>t.date<=asOf).sort((a,b)=>a.date.localeCompare(b.date)||(a.sequence??0)-(b.sequence??0)||a.id.localeCompare(b.id))){const p=result.get(t.assetId);if(!p)fail('Ativo não encontrado.');if(t.side==='split'){if(p.quantity<=0)fail('Desdobramento exige posição existente.');const q=Number((BigInt(p.quantity)*BigInt(t.quantity))/BigInt(SCALE));if(!Number.isSafeInteger(q)||q<=0||q>1e15)fail('Quantidade após evento inválida.');p.quantity=q;continue;}const total=multiply(t.quantity,t.price);if(t.side==='buy'){p.quantity+=t.quantity;p.cost+=total+t.fees;}else{if(t.quantity>p.quantity)fail('Venda superior à posição disponível.');const removed=Number((BigInt(p.cost)*BigInt(t.quantity)+BigInt(Math.floor(p.quantity/2)))/BigInt(p.quantity));p.realized+=total-t.fees-removed;p.quantity-=t.quantity;p.cost-=removed;}}
 for(const d of s.dividends)if(d.status==='received'&&d.date<=asOf)result.get(d.assetId).dividends+=d.amount;
 for(const p of result.values()){const price=s.prices.filter(x=>x.assetId===p.asset.id&&x.date<=asOf).sort((a,b)=>b.date.localeCompare(a.date))[0];if(price){p.value=multiply(p.quantity,price.amount);p.asset={...p.asset,manualPrice:price.amount,priceDate:price.date,source:price.source};}else if(p.asset.manualPrice!=null&&p.asset.priceDate<=asOf)p.value=multiply(p.quantity,p.asset.manualPrice);if(p.quantity===0)p.value=0;}
 return [...result.values()];
}
export function portfolio(s,asOf=localDate()){const list=positions(s,asOf),valued=list.filter(p=>p.value!==null),missing=list.filter(p=>p.quantity>0&&p.value===null).length;const snapshot=s.snapshots.filter(x=>x.date<=asOf).sort((a,b)=>b.date.localeCompare(a.date))[0];return{list,known:valued.reduce((n,p)=>n+p.value,0),cost:list.reduce((n,p)=>n+p.cost,0),missing,snapshot};}
export function migrate(raw,asOf=localDate()){
 if(raw?.version===3)return validateState(raw,asOf);const old=legacyValidate(raw);const s=emptyState(old.name,asOf);s.revision=old.revision;
 // A versão antiga não registrava a data do saldo inicial nem vencimento/pagamento separados.
 const first=[asOf,...old.entries.map(e=>e.date)].sort()[0];s.accounts.push({id:'legacy-account',name:'Conta migrada — conferir abertura',kind:'bank',opening:old.opening,openingDate:first,archived:false});
 for(const e of old.entries){if(e.status==='paid'&&e.date>asOf)fail('Backup antigo contém realizado futuro. Corrija a origem antes de importar.');s.entries.push({id:e.id,description:e.description,type:e.type,category:e.category,amount:e.amount,dueDate:e.date,competence:e.date.slice(0,7),accountId:'legacy-account',cardId:null,origin:'Migração v2',assumedDate:true});if(e.status==='paid')s.payments.push({id:`pay_${e.id}`,entryId:e.id,accountId:'legacy-account',amount:e.amount,date:e.date});}
 for(const[c,amount]of Object.entries(old.budgets))s.budgets.push({id:`legacy_${s.createdAt.slice(0,7)}_${CATEGORIES.indexOf(c)}`,category:c,month:s.createdAt.slice(0,7),amount});s.reserves.push({id:'legacy-reserve',month:s.createdAt.slice(0,7),amount:old.reserve});if(old.investments)s.snapshots.push({id:'legacy-position',date:asOf,amount:old.investments,source:'Total migrado v2, sem composição'});
 s.migrationNotes=['Confira a abertura da conta migrada: a versão antiga não tinha data de referência.','Vencimento e pagamento foram copiados da data única antiga; os lançamentos estão sinalizados para conferência.','Orçamentos e reserva antigos passam a valer a partir do mês da migração. O total antigo da carteira foi preservado separadamente.'];return validateState(s,asOf);
}
export function serializeBackup(s){const text=JSON.stringify(validateState(s));if(new TextEncoder().encode(text).length>MAX_BACKUP_BYTES)fail('Backup excede 32 MiB.');return text;}
export function parseBackup(text){if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_BACKUP_BYTES)fail('Arquivo excede 32 MiB.');let raw;try{raw=JSON.parse(text.replace(/^\uFEFF/,''));}catch{fail('JSON inválido.');}return migrate(raw);}
export function ledgerCSV(s,m){const rows=[['Descrição','Categoria','Vencimento','Competência','Tipo','Valor (R$)','Pendente (R$)','Conta','Cartão'],...s.entries.filter(e=>!m||e.competence===m).map(e=>[e.description,e.category,e.dueDate,e.competence,e.type==='income'?'Receita':'Despesa',(e.amount/100).toFixed(2).replace('.',','),(outstanding(s,e)/100).toFixed(2).replace('.',','),s.accounts.find(a=>a.id===e.accountId)?.name,s.cards.find(c=>c.id===e.cardId)?.name||''])];return '\uFEFF'+rows.map(r=>r.map(csvCell).join(';')).join('\r\n');}
export function demo(asOf=localDate()){
 const m=asOf.slice(0,7),s=emptyState('Isaque',asOf);s.accounts=[{id:'bank',name:'Conta principal',kind:'bank',opening:530000,openingDate:m+'-01',archived:false},{id:'broker',name:'Conta de investimentos',kind:'investment',opening:0,openingDate:m+'-01',archived:false}];
 const day=n=>m+'-'+String(Math.min(n,Number(asOf.slice(8)))).padStart(2,'0');
 const examples=[['Salário','Salário',780000,'income',5,true],['Moradia','Moradia',280000,'expense',6,true],['Supermercado','Alimentação',62000,'expense',8,true],['Transporte do mês','Transporte',22000,'expense',9,true],['Cinema e encontros','Lazer',18000,'expense',11,true],['Outras despesas','Outros',83000,'expense',12,true],['Internet','Serviços',12000,'expense',25,false],['Compromissos do mês','Outros',81000,'expense',28,false]];
 for(let i=0;i<examples.length;i++){const[d,c,a,t,n,paid]=examples[i],id=`example-${i}`;s.entries.push({id,description:d,category:c,amount:a,type:t,dueDate:paid?day(n):m+'-'+n,competence:m,accountId:'bank',cardId:null,origin:'Exemplo'});if(paid)s.payments.push({id:`payment-${i}`,entryId:id,accountId:'bank',amount:a,date:day(n)});}
 s.cards.push({id:'card',name:'Cartão de exemplo',limit:600000,closingDay:15,dueDay:22,accountId:'bank'});s.entries.push({id:'card-example',description:'Compra parcelada — exemplo',category:'Outros',type:'expense',amount:125000,dueDate:m+'-22',competence:m,accountId:'bank',cardId:'card',statementMonth:m,origin:'Exemplo'});
 for(const[c,amount]of [['Alimentação',80000],['Transporte',40000],['Lazer',40000]])s.budgets.push({id:`budget-${s.budgets.length}`,month:m,category:c,amount});s.reserves.push({id:'reserve',month:m,amount:100000});s.goals.push({id:'goal',name:'Viagem de férias',target:600000,allocated:50000,dueDate:addMonths(asOf,6)});
 s.snapshots.push({id:'example-position',date:asOf,amount:3441000,source:'Exemplo de posição global, sem composição'});for(const[symbol,kind]of [['PETR4','stock'],['VALE3','stock'],['HGLG11','fii'],['IBOV','index']])s.watchlist.push({id:symbol,symbol,kind});return validateState(s,asOf);
}
