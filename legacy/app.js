import { CATEGORIES, MAX_ENTRIES, localDate, validMonth, validateState, validateEntry, parseMoney, revisionOf, monthEntries, commitments, summarize, budgetUsage, toCSV, parseBackup } from './finance.mjs';
import { openDatabase, loadState, saveState, StorageConflict } from './storage.mjs';
const icons={inicio:'<path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/>',lancamentos:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',planejamento:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M8 14h2M14 14h2M8 17h2"/>',investimentos:'<path d="M4 20V12h4v8M10 20V7h4v13M16 20V3h4v17"/>',mercado:'<path d="m3 17 6-6 4 3 8-10M15 4h6v6"/>',configuracoes:'<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',wallet:'<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 7V4h13v2M16 12h5v4h-5z"/>'};
const icon=(name)=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.wallet}</svg>`;
const routes={inicio:'Visão geral',lancamentos:'Lançamentos',planejamento:'Planejamento',investimentos:'Investimentos',mercado:'Mercado',configuracoes:'Configurações'};
const today = () => localDate();
const thisMonth=()=>today().slice(0,7);
const esc=(s)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const currencyFormatter = new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' });
const currency = value => currencyFormatter.format(value / 100);
let hidden = false, month = thisMonth(), view = 'inicio', db, state, filter = '', typeFilter = 'all', statusFilter = 'all';
let busy = false, expectedRevision = -1, storageMode = 'loading', storageBlocked = false, externalChanged = false, rawForRecovery, undoItem = null, editId = null;
const money=(v)=>hidden?'R$ ••••':currency(v);
const id=()=>crypto.randomUUID();
function seed(){const m=thisMonth();return {version:2,revision:0,name:'Isaque',opening:530000,reserve:150000,investments:3441000,budgets:{Alimentação:80000,Transporte:40000,Lazer:40000},entries:[
{id:id(),description:'Salário',category:'Salário',amount:780000,type:'income',status:'paid',date:seedDate(m,5)},
{id:id(),description:'Moradia',category:'Moradia',amount:280000,type:'expense',status:'paid',date:seedDate(m,6)},
{id:id(),description:'Supermercado',category:'Alimentação',amount:62000,type:'expense',status:'paid',date:seedDate(m,8)},
{id:id(),description:'Transporte do mês',category:'Transporte',amount:22000,type:'expense',status:'paid',date:seedDate(m,9)},
{id:id(),description:'Cinema e encontros',category:'Lazer',amount:18000,type:'expense',status:'paid',date:seedDate(m,11)},
{id:id(),description:'Outras despesas',category:'Outros',amount:83000,type:'expense',status:'paid',date:seedDate(m,12)},
{id:id(),description:'Cartão de crédito — exemplo',category:'Outros',amount:125000,type:'expense',status:'pending',date:m+'-22'},
{id:id(),description:'Internet',category:'Serviços',amount:12000,type:'expense',status:'pending',date:m+'-25'},
{id:id(),description:'Compromissos do mês',category:'Outros',amount:81000,type:'expense',status:'pending',date:m+'-28'}]};}
function heading(title,subtitle,add=true){return `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions"><input class="month-input" aria-label="Mês de referência" type="month" id="month" value="${month}" min="1900-01" max="2199-12">${add?'<button class="primary" data-action="new">＋ &nbsp; Lançamento</button>':''}</div></div>`;}
function cardTitle(text,i,link=''){return `<div class="card-heading"><h2 class="card-title">${icon(i)}${text}</h2>${link}</div>`;}
const go=(label,v)=>`<button class="text-link" data-view="${v}">${label} ↗</button>`;
function chart(){if(hidden)return '<div class="empty">Valores e gráfico ocultos</div>';let values=Array.from({length:5},()=>[0,0]);currentEntries().filter(e=>e.status==='paid'&&e.date<=today()).forEach(e=>values[Math.min(4,Math.floor((Number(e.date.slice(8))-1)/7))][e.type==='income'?0:1]+=e.amount);const max=Math.max(100000,...values.flat());let svg='';for(let j=0;j<4;j++){let y=15+j*45;svg+=`<line x1="45" y1="${y}" x2="565" y2="${y}" stroke="#edf1f5"/><text x="36" y="${y+3}" text-anchor="end">${hidden?'••':Math.round(max*(1-j/3)/100).toLocaleString('pt-BR')}</text>`;}values.forEach((v,i)=>{let x=65+i*103;for(let k=0;k<2;k++){let h=v[k]/max*135;svg+=`<rect x="${x+k*27}" y="${150-h}" width="20" height="${h}" rx="3" fill="${k?'#f18b79':'#1fa88f'}"/>`;}svg+=`<text x="${x+22}" y="175" text-anchor="middle">Sem ${i+1}</text>`;});return `<div class="chart"><div class="legend"><span><i></i>Receitas realizadas (R$)</span><span><i class="expense"></i>Despesas realizadas</span></div><svg class="chart-svg" viewBox="0 0 580 185" role="img" aria-label="Receitas e despesas realizadas por semana, valores em reais">${svg}</svg></div>`;}
function watch(){return `<div class="watch-row"><b>PETR4</b><svg viewBox="0 0 65 25"><path d="m1 20 9-7 10 3 10-9 10 5 10-8 10 3" stroke="#1fa88f" stroke-width="1.7" fill="none"/></svg><span class="muted">—</span></div><div class="watch-row"><b>VALE3</b><svg viewBox="0 0 65 25"><path d="m1 5 9 8 10-3 10 10 10-6 10 8 10-3" stroke="#ef826e" stroke-width="1.7" fill="none"/></svg><span class="muted">—</span></div><div class="watch-row"><b>HGLG11</b><svg viewBox="0 0 65 25"><path d="m1 20 9-8 10 4 10-6 10 3 10-8 10 2" stroke="#378aef" stroke-width="1.7" fill="none"/></svg><span class="muted">—</span></div><div class="data-note">Traçados ilustrativos · Sem cotações conectadas</div>`;}
function dashboard(){const s=sums();return heading(`${greeting()}, ${esc(state.name)}`,'Seu saldo, seus compromissos e seus objetivos em uma visão clara.')+`${periodNotice()}<div class="summary-grid"><section class="card balance-card">${cardTitle(s.available < 0 ? 'Déficit após compromissos' : 'Disponível para usar','wallet')}<div class="amount ${s.available < 0 ? 'negative' : 'green'}">${money(s.available)}</div><div class="balance-note">Saldo realizado − pendências até o mês − reserva atual</div><div class="breakdown"><div><small>Saldo em contas</small><strong>${money(s.cash)}</strong></div><div><small>A pagar até o mês</small><strong>${money(s.pending)}</strong></div><div><small>Reserva atual</small><strong>${money(state.reserve)}</strong></div></div></section><section class="card">${cardTitle('Investido agora','investimentos',go('Ver carteira','investimentos'))}<div class="amount investment-amount">${money(state.investments)}</div><span class="small muted">Posição atual informada manualmente</span><div class="investment-placeholder">${icon('investimentos')}<span>Sem histórico conectado</span></div></section><section class="card market-card">${cardTitle('Mercado','mercado',go('Explorar','mercado'))}${watch()}</section></div><div class="content-grid"><section class="card">${cardTitle('Fluxo do mês','investimentos','<span class="small muted">Por semana</span>')}${chart()}</section><section class="card">${cardTitle('Orçamento','planejamento',go('Planejar','planejamento'))}${budgets()}</section></div><div class="lower-grid"><section class="card">${cardTitle('Próximos pagamentos','planejamento','<button class="text-link" data-action="payments">Ver todos ↗</button>')}${payments()}</section><section class="card">${cardTitle('Indicadores econômicos','mercado',go('Fontes','mercado'))}${['Selic','IPCA','Dólar'].map(x=>`<div class="indicator-row"><b>${x}</b><small>A conectar &nbsp; ↗</small></div>`).join('')}<div class="data-note">Valores oficiais serão exibidos com fonte e data.</div></section><section class="card news">${cardTitle('No radar','lancamentos')}<div class="news-cover">↗</div><span class="pill">Contexto econômico</span><h3>Como os juros afetam suas finanças</h3><p>Entenda a relação entre juros, inflação e seus investimentos.</p>${go('Ler contexto','mercado')}</section></div>`;}
function ledger(){return heading('Lançamentos','Cada movimento no seu lugar. Acompanhe o que entrou e o que saiu.')+`${periodNotice()}<div class="toolbar"><input id="search" aria-label="Buscar lançamentos" placeholder="⌕  Buscar descrição ou categoria" value="${esc(filter)}"><select id="type-filter" aria-label="Filtrar tipo"><option value="all">Todos os tipos</option><option value="income">Receitas</option><option value="expense">Despesas</option></select><select id="status-filter" aria-label="Filtrar situação"><option value="all">Todas as situações</option><option value="paid">Realizados</option><option value="pending">Previstos</option></select><button class="secondary" data-action="csv">↓ CSV do mês</button></div><p class="small muted">A exportação inclui todos os lançamentos do mês, independentemente dos filtros de busca.</p><section class="card table-wrap"><table><thead><tr><th scope="col">Descrição</th><th scope="col" class="category-col">Categoria</th><th scope="col">Data</th><th scope="col">Situação</th><th scope="col">Valor</th><th scope="col">Ações</th></tr></thead><tbody id="rows"></tbody></table></section>`;}
function planning(){return heading('Planejamento','Dê um destino ao seu dinheiro antes de ele sair.',false)+`<div class="two-columns"><section class="card">${cardTitle('Orçamentos mensais','planejamento')}${budgets()}<button class="secondary" data-view="configuracoes">Ajustar limites</button></section><section class="card">${cardTitle('Compromissos do mês','planejamento')}${payments(false)}<div class="data-note">Inclui despesas previstas vencidas de meses anteriores.</div></section><section class="card">${cardTitle('Sua reserva separada','wallet')}<div class="amount green">${money(state.reserve)}</div><p class="small muted">Valor atual separado dentro do saldo em contas para seus objetivos. Esse valor é descontado do disponível uma única vez.</p><button class="secondary" data-view="configuracoes">Ajustar reserva</button></section><section class="card">${cardTitle('Como o disponível é calculado','lancamentos')}<p class="small muted">Saldo realizado até hoje ou até o fim do mês selecionado, o que vier antes. Descontamos despesas pendentes até o fim do mês, inclusive vencidas, e a reserva atual. Receitas previstas não aumentam o saldo.</p><div class="section-banner">Saldo inicial + receitas realizadas − despesas realizadas − pendências até o mês − reserva atual.</div></section></div>`;}
function market(){return heading('Mercado e contexto','Informação com origem clara. Fatos separados de interpretações.',false)+`<div class="section-banner">Integrações ainda não conectadas. Não há cotações, indicadores ou notícias ao vivo nesta versão. Os links abaixo levam às fontes oficiais.</div><div class="two-columns"><section class="card">${cardTitle('Lista de acompanhamento','mercado')}${watch()}<p class="small muted">Ações e FIIs serão acompanhados com indicação de fonte, horário e eventual atraso. Nenhuma API paga foi ativada.</p></section><section class="card source-links">${cardTitle('Fontes oficiais','mercado')}<a href="https://www.bcb.gov.br/controleinflacao/taxaselic" target="_blank" rel="noopener noreferrer">Banco Central · Taxa Selic ↗</a><a href="https://www.ibge.gov.br/explica/inflacao.php" target="_blank" rel="noopener noreferrer">IBGE · Inflação e IPCA ↗</a><a href="https://www.bcb.gov.br/estabilidadefinanceira/historicocotacoes" target="_blank" rel="noopener noreferrer">Banco Central · Câmbio ↗</a><a href="https://www.b3.com.br/pt_br/" target="_blank" rel="noopener noreferrer">B3 · Mercado brasileiro ↗</a></section><section class="card"><span class="pill">Contexto educativo · Sem evento atual</span><h2>Juros, inflação e investimentos</h2><h3 class="small">Relação econômica</h3><p class="small muted">Mudanças nos juros afetam o custo do crédito e a remuneração de produtos ligados às taxas de referência. A inflação reduz o poder de compra.</p><h3 class="small">Interpretação possível</h3><p class="small muted">Juros maiores podem pressionar empresas dependentes de crédito. O efeito sobre ações e FIIs varia com expectativas, receitas, dívidas e outros fatores.</p><h3 class="small">Cenário, sem previsão</h3><p class="small muted">Uma queda de juros pode alterar o interesse por diferentes ativos. Isso não garante valorização: parte da mudança pode já estar nos preços.</p></section><section class="card"><h2 class="card-title">Informação que cabe no projeto</h2><p class="small muted">A próxima etapa prioriza dados públicos do Banco Central e do IBGE. Cotações e manchetes dependerão de fontes com uso autorizado e limites compatíveis com custo zero.</p><p class="small muted">Cada atualização deverá mostrar a fonte, a data e se o dado está atrasado. Quando uma fonte falhar, o aplicativo manterá a informação identificada como desatualizada.</p></section></div>`;}
function download(text, type, name) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  toast('Download solicitado. Confira o arquivo na pasta de downloads.');
}

function seedDate(m, day) {
  return m + '-' + String(Math.min(day, Number(today().slice(8)))).padStart(2, '0');
}
function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
}
function currentEntries() { return monthEntries(state, month); }
function sums() { return summarize(state, month, today()); }
function periodNotice() {
  if (month === thisMonth()) return '';
  return '<div class="section-banner">O mês filtra os lançamentos e compromissos. A reserva, a posição da carteira e a situação dos registros são atuais; esta visão não é um extrato histórico fechado.</div>';
}
function toast(message) {
  const el = document.querySelector('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => el.classList.remove('show'), 5500);
}
function storageNotices() {
  const el = document.querySelector('#storage-notice');
  let message = '';
  if (storageBlocked) message = 'Não foi possível validar os dados salvos. Eles foram preservados. Exporte uma cópia para recuperação ou restaure um arquivo válido em Configurações.';
  else if (externalChanged) message = 'Há alterações em outra aba. Atualize os dados antes de continuar para evitar sobrescrever registros.';
  else if (storageMode === 'memory') message = 'Armazenamento indisponível: alterações apenas nesta sessão. Exporte seus dados antes de fechar ou recarregar.';
  el.hidden = !message;
  el.replaceChildren();
  if (message) {
    const text = document.createElement('span');
    text.textContent = message;
    el.append(text);
    const button = document.createElement('button');
    button.textContent = storageBlocked ? 'Abrir configurações' : 'Atualizar dados';
    button.dataset[storageBlocked ? 'view' : 'action'] = storageBlocked ? 'configuracoes' : 'reload';
    el.append(button);
  }
  document.querySelector('#storage-location').textContent = storageMode === 'memory' ? 'Dados apenas nesta sessão' : storageBlocked ? 'Dados salvos preservados' : 'Dados neste navegador';
}
function setBusy(value) {
  busy = value;
  document.querySelectorAll('button[type="submit"]').forEach(b => { b.disabled = value; });
  document.querySelector('#entry-form').setAttribute('aria-busy', String(value));
}
let channel;
try { channel = new BroadcastChannel('minhas-financas-changes'); } catch { /* revisão transacional continua protegendo outras abas */ }
if (channel) channel.onmessage = e => {
  if (e.data?.revision !== expectedRevision) {
    externalChanged = true;
    storageNotices();
  }
};
async function commit(candidate, message, allowRecovery = false) {
  if (busy) return false;
  if (storageBlocked && !allowRecovery) { toast('Recupere os dados em Configurações antes de alterar registros.'); return false; }
  if (externalChanged) { toast('Atualize os dados: outra aba fez alterações.'); return false; }
  setBusy(true);
  try {
    const safe = validateState(candidate);
    if (storageMode === 'memory') {
      state = { ...safe, revision: expectedRevision + 1 };
      expectedRevision = state.revision;
      document.querySelector('#save-status').textContent = 'Alterações apenas nesta sessão';
      toast('Alteração aplicada apenas nesta sessão. Exporte para guardar.');
    } else {
      const saved = await saveState(db, safe, expectedRevision);
      state = saved;
      expectedRevision = saved.revision;
      document.querySelector('#save-status').textContent = 'Alterações salvas neste navegador';
      channel?.postMessage({ revision: expectedRevision });
      toast(message);
    }
    storageBlocked = false;
    rawForRecovery = undefined;
    storageNotices();
    return true;
  } catch (error) {
    if (error instanceof StorageConflict) externalChanged = true;
    document.querySelector('#save-status').textContent = 'Alteração não salva';
    const text = error instanceof StorageConflict ? error.message : 'A alteração não foi salva. Seus dados anteriores foram mantidos. ' + error.message;
    toast(text);
    const formError = document.querySelector('#entry-error');
    if (document.querySelector('#entry-dialog').open) { formError.textContent = text; formError.hidden = false; }
    storageNotices();
    return false;
  } finally { setBusy(false); }
}

function budgets() {
  return Object.keys(state.budgets).map((category, i) => {
    const { limit, spent, percent, over } = budgetUsage(state, month, category, today());
    const percentText = hidden ? '••' : percent === null ? 'Sem limite definido' : percent + '%';
    const width = hidden ? 0 : percent === null ? (spent ? 100 : 0) : Math.min(100, percent);
    return `<div class="budget-row"><div class="budget-top"><b>${esc(category)}</b><span>${money(spent)} / ${money(limit)}</span></div><div class="progress" aria-hidden="true"><span style="width:${width}%;background:${['#18a58a','#3e91ed','#eda06e'][i]}"></span></div><div class="budget-footer"><span>${hidden ? 'Valores ocultos' : !limit ? 'Defina um limite em Configurações' : over ? 'Acima do orçamento' : 'do orçamento mensal'}</span><span>${percentText}</span></div></div>`;
  }).join('');
}
function payments(compact = true) {
  const all = commitments(state, month);
  const list = compact ? all.slice(0, 3) : all;
  if (!list.length) return '<div class="empty">Nenhum pagamento pendente até este mês.</div>';
  return list.map(e => `<div class="payment-row"><span class="payment-icon" aria-hidden="true">▤</span><div class="payment-content"><b>${esc(e.description)}</b><small class="${e.date < today() ? 'negative' : ''}">${e.date < today() ? 'Vencido' : 'Previsto'} · ${e.date.split('-').reverse().join('/')}</small></div><strong>${money(e.amount)}</strong></div>`).join('') + (compact && all.length > list.length ? `<button class="text-link payment-more" data-action="payments">Ver os ${all.length} compromissos ↗</button>` : '');
}
function investments() {
  return heading('Investimentos', 'Uma primeira visão da sua carteira, com informações inseridas por você.', false) + `<div class="section-banner">Posição atual informada manualmente, sem histórico ou rentabilidade. O filtro de mês se aplica ao saldo em contas, não à posição dos investimentos.</div><div class="metric-grid"><section class="card">${cardTitle('Posição atual','investimentos')}<div class="amount">${money(state.investments)}</div><span class="small muted">Sem cotação automática</span></section><section class="card">${cardTitle('Saldo realizado do período','wallet')}<div class="amount">${money(sums().cash)}</div><span class="small muted">Até ${sums().cutoff.split('-').reverse().join('/')}</span></section><section class="card">${cardTitle('Saldo do período + posição atual','investimentos')}<div class="amount green">${money(sums().cash + state.investments)}</div><span class="small muted">Total bruto · Não representa patrimônio histórico</span></section></div><section class="card"><h2 class="card-title">Atualizar posição da carteira</h2><p class="small muted">Alterar a posição não cria uma receita nem calcula rentabilidade.</p>${hidden ? '<p class="section-banner">Mostre os valores pelo botão no topo para editar a posição.</p>' : `<form id="investment-form" class="settings-form"><label>Posição atual (R$)<input name="value" inputmode="decimal" value="${inputMoney(state.investments)}" maxlength="24" required></label><p class="form-error" role="alert" id="investment-error" hidden></p><button class="primary" type="submit">Salvar posição</button></form>`}</section>`;
}
function inputMoney(value) { return (value / 100).toFixed(2).replace('.', ','); }
function settings() {
  const fields = [['opening','Saldo inicial em contas (aceita negativo)',state.opening],['reserve','Reserva atual separada dentro do saldo',state.reserve],...Object.entries(state.budgets).map(([c,v])=>['budget-'+c,'Limite mensal · '+c,v])];
  return heading('Seu espaço, suas escolhas','Ajuste as referências e cuide dos dados do navegador.',false) + `<div class="two-columns"><section class="card"><h2 class="card-title">Preferências e valores iniciais</h2><p class="small muted">O saldo inicial antecede todos os registros. Reserva e limites são configurações atuais, sem histórico mensal.</p>${hidden ? '<p class="section-banner">Mostre os valores pelo botão no topo para editar os ajustes.</p>' : `<form id="settings-form" class="settings-form"><label>Como você quer ser chamado?<input name="name" value="${esc(state.name)}" maxlength="40" required></label>${fields.map(([k,l,v])=>`<label>${esc(l)}<input name="${esc(k)}" inputmode="decimal" value="${inputMoney(v)}" maxlength="24" required></label>`).join('')}<p class="form-error" role="alert" id="settings-error" hidden></p><button class="primary" type="submit">Salvar ajustes</button></form>`}</section><section class="card"><h2 class="card-title">Dados e recuperação</h2><p class="small muted">Versão de demonstração. Registros neste navegador, sem sincronização entre aparelhos. O armazenamento e os arquivos JSON/CSV ainda não têm criptografia.</p><div class="settings-actions"><button class="secondary" data-action="export">↓ ${storageBlocked ? 'Exportar cópia para recuperação' : 'Exportar JSON completo'}</button><button class="secondary" data-action="import">↑ Restaurar JSON</button><button class="secondary" data-action="csv">↓ CSV do mês</button></div><p class="small muted">A restauração substitui os dados deste navegador após sua confirmação. Aceita arquivos desta versão e da versão 0.1, com validação dos registros. Exporte antes para preservar uma cópia.</p><p class="version-note">Versão 0.2 · Revisão de cálculos, armazenamento e acessibilidade<br>Sem conexão bancária, assinatura, API paga, dados de mercado ao vivo ou envio dos registros ao servidor.</p><button class="secondary danger" data-action="reset">Restaurar demonstração</button></section></div>`;
}
let scopeFilter = 'month';
function filteredEntries() {
  const base = scopeFilter === 'due' ? commitments(state, month) : currentEntries();
  const query = filter.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  return base.filter(e => (typeFilter === 'all' || e.type === typeFilter) && (statusFilter === 'all' || e.status === statusFilter) && (e.description + ' ' + e.category).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').includes(query)).sort((a,b)=>b.date.localeCompare(a.date));
}
function renderRows() {
  const rows = filteredEntries();
  document.querySelector('#rows').innerHTML = rows.length ? rows.map(e => `<tr><td>${esc(e.description)}<small>${e.type === 'income' ? 'Receita' : 'Despesa'}</small></td><td class="category-col">${esc(e.category)}</td><td>${e.date.split('-').reverse().join('/')}</td><td><button class="tag ${e.status === 'pending' ? 'pending' : ''}" data-toggle="${esc(e.id)}" aria-label="Alterar situação de ${esc(e.description)}" title="Revisar e alterar situação">${e.status === 'paid' ? 'Realizado' : 'Previsto'} ↻</button></td><td class="${e.type === 'income' ? 'positive' : ''}">${e.type === 'income' ? '+' : '−'} ${money(e.amount)}</td><td class="row-actions"><button class="text-link" data-edit="${esc(e.id)}" aria-label="Editar ${esc(e.description)}">Editar</button><button class="delete" data-delete="${esc(e.id)}" aria-label="Excluir ${esc(e.description)}">Excluir</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty">Nenhum lançamento encontrado.</td></tr>';
}
function render() {
  const route = location.hash.slice(1);
  view = Object.hasOwn(routes, route) ? route : 'inicio';
  document.title = routes[view] + ' · Minhas finanças';
  document.querySelector('#breadcrumb').textContent = routes[view];
  const first = [...state.name][0]?.toLocaleUpperCase('pt-BR') || 'M';
  document.querySelector('#profile').textContent = first;
  document.querySelector('#nav').innerHTML = Object.entries(routes).filter(([k])=>k!=='configuracoes').map(([k,v])=>`<a class="nav-item ${view===k?'active':''}" href="#${k}" ${view===k?'aria-current="page"':''}>${icon(k)}<span>${v}</span></a>`).join('');
  document.querySelector('#settings-nav').classList.toggle('active', view === 'configuracoes');
  document.querySelector('#mobile-nav').innerHTML = Object.entries(routes).filter(([k])=>k!=='configuracoes').map(([k,v])=>`<button data-view="${k}" class="${view===k?'active':''}" ${view===k?'aria-current="page"':''}>${icon(k)}<span>${k==='inicio'?'Início':v}</span></button>`).join('');
  const main = document.querySelector('#main');
  main.innerHTML = ({inicio:dashboard,lancamentos:ledger,planejamento:planning,investimentos:investments,mercado:market,configuracoes:settings})[view]();
  main.setAttribute('aria-busy', 'false');
  const monthInput = document.querySelector('#month');
  if (monthInput) monthInput.onchange = e => {
    if (!validMonth(e.target.value)) { e.target.value = month; toast('Selecione um mês entre 1900 e 2199.'); return; }
    month = e.target.value;
    render();
  };
  if (view === 'lancamentos') {
    const toolbar = document.querySelector('.toolbar');
    const scope = document.createElement('select');
    scope.id = 'scope-filter';
    scope.setAttribute('aria-label','Período dos lançamentos');
    scope.innerHTML = '<option value="month">Mês selecionado</option><option value="due">Pendências até o mês</option>';
    toolbar.insertBefore(scope, toolbar.firstChild);
    scope.value = scopeFilter;
    scope.onchange = e => { scopeFilter = e.target.value; renderRows(); };
    document.querySelector('#type-filter').value = typeFilter;
    document.querySelector('#status-filter').value = statusFilter;
    renderRows();
    document.querySelector('#search').oninput = e => { filter = e.target.value; renderRows(); };
    document.querySelector('#type-filter').onchange = e => { typeFilter = e.target.value; renderRows(); };
    document.querySelector('#status-filter').onchange = e => { statusFilter = e.target.value; renderRows(); };
  }
  document.querySelector('#investment-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const n = parseMoney(new FormData(e.target).get('value'));
    if (n === null) return formError('investment-error','Informe um valor válido, por exemplo 1.234,56.');
    if (await commit({ ...state, investments: n }, 'Posição atualizada.')) render();
  });
  document.querySelector('#settings-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const opening = parseMoney(f.get('opening'), { signed: true });
    const reserve = parseMoney(f.get('reserve'));
    const budgets = Object.fromEntries(Object.keys(state.budgets).map(c => [c,parseMoney(f.get('budget-'+c))]));
    if (opening === null || reserve === null || Object.values(budgets).includes(null)) return formError('settings-error','Confira os valores. Use, por exemplo, 1.234,56.');
    const name = String(f.get('name')).trim();
    if (!name) return formError('settings-error','Informe seu nome.');
    if (await commit({ ...state, name, opening, reserve, budgets }, 'Ajustes salvos.')) render();
  });
  storageNotices();
}
function formError(id, message) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.hidden = false;
}
function openEntry(entry = null, status = null) {
  if (storageBlocked) { toast('Recupere os dados em Configurações antes de alterar registros.'); return; }
  if (hidden && entry) { toast('Mostre os valores pelo botão no topo para editar o lançamento.'); return; }
  const form = document.querySelector('#entry-form');
  form.reset();
  editId = entry?.id || null;
  document.querySelector('#entry-title').textContent = entry ? 'Editar lançamento' : 'Novo lançamento';
  document.querySelector('#entry-error').hidden = true;
  if (entry) {
    for (const k of ['description','type','date','status','category']) form.elements.namedItem(k).value = entry[k];
    form.elements.namedItem('amount').value = inputMoney(entry.amount);
    if (status) form.elements.namedItem('status').value = status;
  } else {
    const date = today().startsWith(month) ? today() : month + '-01';
    form.elements.namedItem('date').value = date;
    if (date > today()) form.elements.namedItem('status').value = 'pending';
  }
  document.querySelector('#entry-dialog').showModal();
}
function exportJSON() {
  if (storageBlocked && rawForRecovery === undefined) return toast('Os dados salvos não puderam ser lidos. Feche outras abas e atualize esta página para tentar novamente.');
  const data = storageBlocked && rawForRecovery !== undefined ? rawForRecovery : { ...state, exportedAt: new Date().toISOString() };
  download(JSON.stringify(data,null,2),'application/json','minhas-financas-'+(storageBlocked?'recuperacao-':'')+today()+'.json');
}
function exportCSV() {
  if (storageBlocked) return toast('Exporte a cópia JSON para recuperar os dados salvos.');
  download(toCSV(currentEntries()),'text/csv;charset=utf-8','lancamentos-'+month+'.csv');
}
async function deleteEntry(entryId) {
  const entry = state.entries.find(e => e.id === entryId);
  if (!entry || !confirm(`Excluir “${entry.description}”? Você poderá desfazer a última exclusão.`)) return;
  if (await commit({ ...state, entries: state.entries.filter(e => e.id !== entryId) }, 'Lançamento excluído.')) {
    undoItem = entry;
    document.querySelector('#undo-notice').hidden = false;
    render();
  }
}
async function undoDelete() {
  if (!undoItem || state.entries.some(e => e.id === undoItem.id)) return;
  if (await commit({ ...state, entries: [...state.entries,undoItem] }, 'Lançamento restaurado.')) {
    undoItem = null;
    document.querySelector('#undo-notice').hidden = true;
    render();
  }
}
function showPayments() {
  filter = ''; typeFilter = 'expense'; statusFilter = 'pending'; scopeFilter = 'due';
  if (location.hash === '#lancamentos') render(); else location.hash = 'lancamentos';
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-view],[data-action],[data-delete],[data-toggle],[data-edit]');
  if (!b || !state) return;
  if (b.dataset.view) { location.hash = b.dataset.view; return; }
  if (busy) return;
  const action = b.dataset.action;
  if (action === 'new') openEntry();
  if (action === 'export') exportJSON();
  if (action === 'csv') exportCSV();
  if (action === 'import') document.querySelector('#backup-file').click();
  if (action === 'payments') showPayments();
  if (action === 'undo') await undoDelete();
  if (action === 'reload') {
    if (confirm('Atualizar os dados desta página? Campos não salvos serão perdidos. Se estiver apenas nesta sessão, exporte antes de continuar.')) location.reload();
  }
  if (b.dataset.delete) await deleteEntry(b.dataset.delete);
  if (b.dataset.edit || b.dataset.toggle) {
    const entry = state.entries.find(e => e.id === (b.dataset.edit || b.dataset.toggle));
    if (entry) openEntry(entry, b.dataset.toggle ? (entry.status === 'paid' ? 'pending' : 'paid') : null);
  }
  if (action === 'reset') {
    if (!confirm('Substituir os dados deste navegador pelos exemplos fictícios? Exporte uma cópia antes se quiser guardá-los.')) return;
    if (await commit(seed(), 'Demonstração restaurada.', true)) {
      undoItem = null;
      document.querySelector('#undo-notice').hidden = true;
      filter = ''; typeFilter = 'all'; statusFilter = 'all'; scopeFilter = 'month'; month = thisMonth();
      render();
    }
  }
});
document.querySelector('#backup-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || busy) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('O arquivo precisa ter até 5 MB.');
    const restored = parseBackup(await file.text());
    if (!confirm(`Restaurar ${restored.entries.length} lançamentos e os ajustes deste arquivo? Os dados atuais deste navegador serão substituídos. Exporte antes se quiser preservá-los.`)) return;
    if (await commit({ ...restored, revision: state.revision }, 'Arquivo restaurado com sucesso.', true)) {
      undoItem = null;
      document.querySelector('#undo-notice').hidden = true;
      filter = ''; typeFilter = 'all'; statusFilter = 'all'; scopeFilter = 'month';
      render();
    }
  } catch (error) { toast('Restauração cancelada: ' + error.message); }
});
document.querySelector('#close-dialog').onclick = () => { if (!busy) document.querySelector('#entry-dialog').close(); };
document.querySelector('#entry-dialog').addEventListener('cancel', e => { if (busy) e.preventDefault(); });
document.querySelector('#entry-dialog').addEventListener('click', e => {
  if (e.target !== e.currentTarget || busy) return;
  const r = e.currentTarget.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.currentTarget.close();
});
document.querySelector('#entry-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (busy) return;
  const f = new FormData(e.target);
  try {
    const amount = parseMoney(f.get('amount'));
    if (amount === null || amount <= 0) throw new Error('Informe um valor maior que zero, por exemplo 1.234,56.');
    if (!editId && state.entries.length >= MAX_ENTRIES) throw new Error('Limite de 10.000 lançamentos atingido. Exporte uma cópia antes de reorganizar os registros.');
    const entry = validateEntry({ id: editId || id(), description: String(f.get('description')).trim(), amount, type: f.get('type'), status: f.get('status'), date: f.get('date'), category: f.get('category') }, today());
    if (editId && !state.entries.some(e => e.id === editId)) throw new Error('O lançamento não existe mais. Atualize os dados.');
    const entries = editId ? state.entries.map(e => e.id === editId ? entry : e) : [...state.entries,entry];
    if (await commit({ ...state,entries }, editId ? 'Lançamento atualizado.' : 'Lançamento salvo.')) {
      month = entry.date.slice(0,7);
      filter = ''; typeFilter = 'all'; statusFilter = 'all'; scopeFilter = 'month';
      document.querySelector('#entry-dialog').close();
      render();
    }
  } catch (error) { formError('entry-error', error.message); }
});
document.querySelector('#export-footer').onclick = () => { if (state) exportJSON(); };
document.querySelector('#hide-values').onclick = () => {
  if (!state) return;
  hidden = !hidden;
  const button = document.querySelector('#hide-values');
  button.setAttribute('aria-label',hidden ? 'Mostrar valores' : 'Ocultar valores');
  button.title = hidden ? 'Mostrar valores' : 'Ocultar valores';
  button.setAttribute('aria-pressed', String(hidden));
  try { sessionStorage.setItem('finance-values-hidden', String(hidden)); } catch { /* preferência opcional */ }
  render();
};
document.querySelector('.skip-link').onclick = e => { e.preventDefault(); document.querySelector('#main').focus(); };
window.addEventListener('hashchange', () => {
  if (!state) return;
  render();
  const title = document.querySelector('main h1');
  title?.setAttribute('tabindex','-1');
  title?.focus({preventScroll:true});
  window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
});
async function bootstrap() {
  try {
    db = await openDatabase();
  } catch (error) {
    storageMode = 'memory';
    state = validateState(seed());
    expectedRevision = state.revision;
    document.querySelector('#save-status').textContent = 'Apenas nesta sessão';
    toast(error.message);
  }
  if (db) {
    try {
      let raw = await loadState(db);
      rawForRecovery = raw;
      expectedRevision = raw === undefined ? -1 : revisionOf(raw);
      if (raw === undefined) {
        try {
          state = await saveState(db, seed(), -1);
        } catch (error) {
          if (!(error instanceof StorageConflict)) throw error;
          // Duas primeiras aberturas podem concorrer: a outra aba venceu a criação.
          raw = await loadState(db);
          rawForRecovery = raw;
          expectedRevision = raw === undefined ? -1 : revisionOf(raw);
          state = validateState(raw);
        }
        expectedRevision = state.revision;
      } else state = validateState(raw);
      storageMode = 'durable';
      externalChanged = false;
      rawForRecovery = undefined;
      document.querySelector('#save-status').textContent = 'Dados carregados deste navegador';
    } catch (error) {
      // Nunca substituir um registro ilegível por exemplos automaticamente.
      storageMode = 'durable';
      storageBlocked = true;
      state = validateState({ ...seed(), opening:0, reserve:0, investments:0, entries:[], revision:Math.max(0,expectedRevision) });
      document.querySelector('#save-status').textContent = 'Recuperação necessária';
      location.hash = 'configuracoes';
      toast('Os dados anteriores foram preservados. ' + error.message);
    }
  }
  try { hidden = sessionStorage.getItem('finance-values-hidden') === 'true'; } catch { /* preferência opcional */ }
  const hideButton = document.querySelector('#hide-values');
  hideButton.setAttribute('aria-label', hidden ? 'Mostrar valores' : 'Ocultar valores');
  hideButton.title = hidden ? 'Mostrar valores' : 'Ocultar valores';
  hideButton.setAttribute('aria-pressed', String(hidden));
  render();
}
await bootstrap();
