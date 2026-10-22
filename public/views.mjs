import {
  categoryList,
  categoryNames,
  SCALE,
  localDate,
  endOfMonth,
  summary,
  balances,
  budgetUsage,
  monthlyPlan,
  outstanding,
  portfolio,
  positions,
} from "./finance.mjs";
import { marketState, stale } from "./market.mjs";
export const routes = {
  inicio: "Visão geral",
  lancamentos: "Lançamentos",
  contas: "Contas e cartões",
  planejamento: "Planejamento",
  investimentos: "Investimentos",
  mercado: "Mercado e notícias",
  relatorios: "Relatórios",
  configuracoes: "Configurações",
};
export const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const paths = {
  inicio: '<path d="m3 10 9-7 9 7v10H3zM9 20v-7h6v7"/>',
  lancamentos:
    '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  contas:
    '<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 10h18M6 15h4"/>',
  planejamento:
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M8 15h2M14 15h2"/>',
  investimentos: '<path d="M4 20V12h4v8M10 20V7h4v13M16 20V3h4v17"/>',
  mercado: '<path d="m3 17 6-6 4 3 8-10M15 4h6v6"/>',
  relatorios: '<path d="M4 20h16M6 16V9M12 16V4M18 16v-6"/>',
  configuracoes:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
};
export const icon = (n) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[n] || paths.contas}</svg>`;
const fmt = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
export const currency = (n) => fmt.format(n / 100);
export const number = (n) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 6 }).format(n);
const dt = (s) => (s ? esc(s.split("-").reverse().join("/")) : "—");
const button = (label, action, extra = "", cls = "secondary") =>
  `<button type="button" class="${cls}" data-action="${action}" ${extra}>${label}</button>`;
const go = (label, view) =>
  `<button type="button" class="text-link" data-view="${view}">${label} ↗</button>`;
const pill = (label, cls = "") => `<span class="pill ${cls}">${label}</span>`;
const empty = (message, action) =>
  `<div class="empty">${message}${action ? "<div>" + action + "</div>" : ""}</div>`;
const section = (title, content, action = "", cls = "") =>
  `<section class="card ${cls}"><div class="card-heading"><h2>${title}</h2>${action}</div>${content}</section>`;
export const HISTORY_LISTS = Object.freeze({
  transfers: { size: 10, label: "transferências", empty: "Nenhuma transferência registrada." },
  trades: { size: 30, label: "operações", empty: "Nenhuma operação." },
  dividends: { size: 30, label: "proventos", empty: "Nenhum rendimento registrado." },
});
export function historyPage(state, collection, requested = 1) {
  const spec = HISTORY_LISTS[collection];
  if (!spec) throw new Error("Histórico inválido.");
  const records = state[collection].slice().sort((a, b) => b.date.localeCompare(a.date));
  const pages = Math.max(1, Math.ceil(records.length / spec.size));
  const page = Math.max(1, Math.min(Number.isSafeInteger(requested) ? requested : 1, pages));
  return { page, pages, total: records.length, rows: records.slice((page - 1) * spec.size, page * spec.size) };
}
function historyList(c, collection, row) {
  const spec = HISTORY_LISTS[collection];
  const { page, pages, total, rows } = historyPage(c.state, collection, c.historyPages?.[collection]);
  const control = (label, target, disabled, name) => button(label, "history-page",
    `id="history-${collection}-${name}" data-history="${collection}" data-page="${target}" aria-controls="history-${collection}-rows" ${disabled ? "disabled" : ""}`);
  return `<div class="history-list" id="history-${collection}"><p class="small muted">Histórico completo · ${total} registro(s). Os saldos consideram todos os registros.</p><div id="history-${collection}-rows" class="history-rows" tabindex="-1" role="group" aria-label="Registros de ${spec.label}">${rows.map(row).join("") || empty(spec.empty)}</div><nav class="pagination history-pagination" aria-label="Paginação de ${spec.label}"><span id="history-${collection}-status" role="status" aria-live="polite" aria-atomic="true" tabindex="-1">Página ${page} de ${pages} · ${total ? (page - 1) * spec.size + 1 : 0}–${Math.min(page * spec.size, total)} de ${total}</span><div class="history-controls">${control("Primeira", 1, page === 1, "first")}${control("← Anterior", page - 1, page === 1, "previous")}${control("Próxima →", page + 1, page === pages, "next")}${control("Última", pages, page === pages, "last")}</div></nav></div>`;
}
export function renderView(c) {
  const { state: s, month: m, view, hidden, slot } = c;
  const money = (n) => (hidden ? "R$ ••••" : currency(n));
  const sum = summary(s, m),
    port = portfolio(s, sum.cutoff),
    b = balances(s, sum.cutoff);
  const title = view === "inicio" ? `Olá, ${esc(s.name)}.` : routes[view];
  const heading = `<div class="page-heading"><div><div class="eyebrow">SEU ESPAÇO PESSOAL</div><h1>${title}</h1><p>${{ inicio: "Seu dinheiro, com mais clareza e menos ruído.", lancamentos: "Previsões e pagamentos, com cada data em seu lugar.", contas: "De onde o dinheiro vem. Para onde ele vai.", planejamento: "Transforme intenção em um plano possível.", investimentos: "Sua carteira e seus movimentos, sem perder o contexto.", mercado: "Informação com fonte, data e espaço para pensar.", relatorios: "Veja os padrões por trás dos seus números.", configuracoes: "Cuide dos seus dados e das suas preferências." }[view]}</p></div><div class="heading-actions">${view === "configuracoes" ? "" : `<label class="sr-only" for="month">Mês de referência</label><input id="month" class="month-input" type="month" value="${m}" min="1900-01" max="2199-12">`}${button("＋ Lançamento", "entry", "", "primary")}</div></div>`;
  const period =
    m !== localDate().slice(0, 7)
      ? '<div class="section-banner">Saldos e fluxo de caixa consideram o fechamento do mês, limitado a hoje. A situação dos lançamentos e das faturas é atual; metas e dados públicos também mostram a situação atual. A posição usa apenas preços com data até o período selecionado.</div>'
      : "";
  if (view === "inicio") {
    const flow = s.payments.filter((p) => p.date.startsWith(m)),
      entryMap = new Map(s.entries.map((e) => [e.id, e]));
    const weeks = Array.from({ length: 5 }, () => [0, 0]);
    for (const p of flow)
      weeks[Math.min(4, Math.floor((Number(p.date.slice(8)) - 1) / 7))][
        entryMap.get(p.entryId).type === "income" ? 0 : 1
      ] += p.amount;
    return (
      heading +
      period +
      `<div class="summary-grid"><section class="card balance-card"><div class="card-heading"><h2>Disponível para usar</h2>${pill(sum.available < 0 ? "Atenção ao saldo" : "Após compromissos", sum.available < 0 ? "warn" : "")}</div><div class="amount ${sum.available < 0 ? "negative" : "green"}">${money(sum.available)}</div><p class="balance-note">Saldo em contas − pendências − reserva − metas</p><div class="breakdown"><div><small>Em contas</small><strong>${money(sum.cash)}</strong></div><div><small>A pagar</small><strong>${money(sum.pending)}</strong></div><div><small>Reserva e metas</small><strong>${money(sum.reserve + sum.earmarks)}</strong></div></div>${sum.earmarks + sum.reserve > Math.max(0, sum.cash) ? '<p class="small negative">A reserva e as metas excedem o saldo disponível em contas.</p>' : ""}</section>${section("Investimentos", `<div class="amount investment-amount">${money(port.known)}</div><p class="muted small">${port.missing ? "Total parcial · " + port.missing + " ativo(s) sem preço" : "Posições cadastradas com preço informado"} · Caixa na corretora: ${money(sum.brokerCash)}</p>${port.snapshot ? `<div class="subtle-box">Referência global separada: <b>${money(port.snapshot.amount)}</b><small>${esc(port.snapshot.source)} · ${dt(port.snapshot.date)}. Não soma às posições.</small></div>` : '<div class="subtle-box">Cadastre seus ativos e suas operações para acompanhar a carteira.</div>'}`, go("Ver carteira", "investimentos"))}${section("No radar", publicIndicators(money, true), go("Explorar", "mercado"), "market-card")}</div><div class="content-grid">${section("Fluxo de caixa do mês", hidden ? empty("Gráfico oculto") : flowChart(weeks), pill("Pagamentos efetivos"))}${section("Orçamento por competência", budgetsView(s, m, money, hidden), go("Planejar", "planejamento"))}</div><div class="lower-grid">${section("Próximos pagamentos", paymentsView(s, sum.due, money, 5, false, sum.cutoff), go("Ver todos", "lancamentos"))}${section("Seus objetivos", goalsView(s, money, hidden), go("Planejar", "planejamento"))}${section("Acontece na economia", newsCards(true), go("Ler notícias", "mercado"), "news")}</div>`
    );
  }
  if (view === "lancamentos")
    return (
      heading +
      period +
      `<div class="toolbar"><input id="search" aria-label="Buscar lançamentos" placeholder="Buscar descrição ou categoria" value="${esc(c.search)}"><select id="type-filter" aria-label="Filtrar tipo">${options(
        [
          ["all", "Todos os tipos"],
          ["income", "Receitas"],
          ["expense", "Despesas"],
        ],
        c.typeFilter,
      )}</select><select id="status-filter" aria-label="Filtrar situação">${options(
        [
          ["all", "Todas as situações"],
          ["pending", "Com saldo pendente"],
          ["paid", "Quitados"],
        ],
        c.statusFilter,
      )}</select><select id="scope-filter" aria-label="Período dos lançamentos">${options(
        [
          ["month", "Competência do mês"],
          ["due", "Pendências até o mês"],
          ["all", "Todos os períodos"],
        ],
        c.scope,
      )}</select></div><div class="toolbar compact">${button("↓ Extrato CSV", "csv")}${button("↑ Importar CSV / OFX", "import")}${button("⇄ Transferência", "transfer")}</div><div id="ledger-results">${ledgerRows(c, money)}</div>`
    );
  if (view === "contas") {
    return (
      heading +
      period +
      `<div class="section-heading"><h2>Suas contas</h2><div>${button("⇄ Transferir", "transfer")}${button("＋ Conta", "account", "", "primary")}</div></div><div class="account-grid">${s.accounts.map((a) => section(`${icon("contas")} ${esc(a.name)}`, `${pill({ bank: "Conta bancária", cash: "Dinheiro", investment: "Caixa de investimentos" }[a.kind])}<div class="amount small-amount">${money(b.get(a.id))}</div><p class="small muted">Abertura: ${money(a.opening)} · ${dt(a.openingDate)}${a.archived ? " · Arquivada" : ""}</p>`, button("Editar", "account", `data-id="${a.id}"`))).join("") || empty("Adicione uma conta para começar.")}</div><div class="section-heading"><h2>Cartões e faturas</h2>${button("＋ Cartão", "card", "", "primary")}</div><div class="two-columns">${
        s.cards
          .map((card) => {
            const entries = s.entries.filter((e) => e.cardId === card.id),
              bill = entries.filter((e) => e.statementMonth === m),
              total = bill.reduce((n, e) => n + e.amount, 0),
              pending = bill.reduce((n, e) => n + outstanding(s, e), 0),
              used = entries.reduce((n, e) => n + outstanding(s, e), 0);
            return section(
              esc(card.name),
              `<div class="card-visual"><span>FATURA · ${m}</span><div class="amount">${money(pending)}</div><small>Compras: ${money(total)} · Pago: ${money(total - pending)}</small></div><p class="small muted">Fecha dia ${card.closingDay} · Vence dia ${card.dueDay}<br>Limite: ${money(card.limit)} · Comprometido: ${money(used)}</p>${used > card.limit ? '<p class="negative small">Compras excedem o limite informado.</p>' : ""}<div class="toolbar compact">${button("＋ Compra", "purchase", `data-id="${card.id}"`)}${pending ? button("Pagar fatura", "statement", `data-id="${card.id}"`, "primary") : pill("Sem valor pendente")}</div><details><summary>Compras desta fatura (${bill.length})</summary>${paymentsView(s, bill, money, 30, true)}</details>`,
              button("Editar", "card", `data-id="${card.id}"`),
            );
          })
          .join("") ||
        empty(
          "Cadastre o cartão para organizar compras, parcelas e pagamentos.",
        )
      }</div>${section(
        "Histórico de transferências",
        historyList(c, "transfers",
            (t) =>
              `<div class="list-row"><div><b>${esc(s.accounts.find((a) => a.id === t.fromId)?.name)} → ${esc(s.accounts.find((a) => a.id === t.toId)?.name)}</b><small>${dt(t.date)} · Sem efeito sobre receitas e despesas</small></div><b>${money(t.amount)}</b>${button("Excluir", "delete-transfer", `data-id="${esc(t.id)}" aria-label="Excluir ${t.fromId ? "transferência" : "operação"} de ${dt(t.date)}"`, "text-link danger")}</div>`,
          ),
      )}`
    );
  }
  if (view === "planejamento")
    return (
      heading +
      period +
      `<div class="two-columns">${section("Orçamentos mensais", budgetsView(s, m, money, hidden) + '<p class="small muted">Compras e compromissos usam o mês de competência. O pagamento da fatura não conta novamente. Alterações valem a partir do mês escolhido até o próximo ajuste.</p>', button("Ajustar", "budget"))}${section("Reserva do mês", `<div class="amount green">${money(sum.reserve)}</div><p class="small muted">Reserva separada dentro das contas. As metas abaixo são adicionais; não inclua o mesmo dinheiro nos dois lugares.</p>${pill("Referência: " + m)}`, button("Ajustar", "reserve"))}${section("Metas e objetivos", goalsView(s, money, hidden) + '<p class="small muted">Valores separados reduzem o disponível uma vez. Metas representam a situação atual, sem reconstituir uma divisão histórica.</p>', button("＋ Meta", "goal"))}${section("Recorrências", s.recurrences.map((r) => `<div class="list-row"><div><b>${esc(r.description)}</b><small>Dia ${r.day} · ${money(r.amount)} · ${r.active ? "Ativa" : "Pausada"}</small></div>${button(r.active ? "Pausar" : "Ativar", "toggle-recurrence", `data-id="${r.id}"`, "text-link")}</div>`).join("") + `<p class="small muted">Gere previsões para o mês selecionado. Dias 29–31 são ajustados ao último dia do mês. A mesma recorrência não é gerada duas vezes.</p><div class="toolbar compact">${button("＋ Recorrência", "recurrence")}${button("Gerar para " + m, "generate", "", "primary")}</div>`)}${section("Compromissos até o mês", paymentsView(s, sum.due, money, 20, false, sum.cutoff))}${section("Como ler seu disponível", `<p>Saldo realizado <b>${money(sum.cash)}</b></p><p>− Pendências <b>${money(sum.pending)}</b></p><p>− Reserva <b>${money(sum.reserve)}</b></p><p>− Metas <b>${money(sum.earmarks)}</b></p><div class="total-line">Disponível <strong>${money(sum.available)}</strong></div><p class="small muted">Receitas previstas não aumentam o saldo. O caixa da corretora fica separado das contas do dia a dia.</p>`)}</div>`
    );
  if (view === "investimentos")
    return (
      heading +
      period +
      `<div class="toolbar compact">${button("＋ Ativo", "asset", "", "primary")}${button("＋ Operação", "trade")}${button("＋ Rendimento", "dividend")}${button("Atualizar preço", "price")}${button("Importar preços CSV", "prices-import")}${button("Posição global", "snapshot")}</div><div class="stats-grid">${stat("Posições com preço", money(port.known), port.missing ? `${port.missing} ativo(s) sem preço · total parcial` : "Último preço manual por ativo")}${stat("Custo das posições", money(port.cost), "Inclui custos de compra")}${stat("Caixa na corretora", money(sum.brokerCash), "Disponível nas contas de investimento")}</div><p class="table-hint">Deslize a tabela para ver todos os dados e ações da carteira.</p><section class="card table-wrap" role="region" aria-label="Composição da carteira; tabela com rolagem horizontal" tabindex="0"><table><caption class="sr-only">Composição da carteira</caption><thead><tr><th scope="col">Ativo</th><th scope="col">Quantidade</th><th scope="col">Preço e data</th><th scope="col">Custo</th><th scope="col">Posição</th><th scope="col">Resultado não realizado</th><th scope="col">Ações</th></tr></thead><tbody>${port.list.map((p) => `<tr><td><b>${esc(p.asset.symbol)}</b><small>${esc(p.asset.name)} · ${esc({ stock: "Ação", fii: "FII", fixed: "Renda fixa", fund: "Fundo", other: "Outro" }[p.asset.kind])}</small></td><td>${hidden ? "••••" : number(p.quantity / SCALE)}</td><td>${p.asset.manualPrice == null || p.asset.priceDate > sum.cutoff ? "Sem cotação no período" : money(p.asset.manualPrice)}<small>${p.asset.manualPrice != null && p.asset.priceDate <= sum.cutoff ? `${dt(p.asset.priceDate)} · ${esc(p.asset.source)}` : "Informe um preço com data até " + dt(sum.cutoff)}</small></td><td>${money(p.cost)}</td><td>${p.value == null ? "Indisponível" : money(p.value)}</td><td class="${p.value != null && p.value - p.cost < 0 ? "negative" : "green"}">${p.value == null ? "—" : money(p.value - p.cost)}</td><td>${button("Editar", "asset", `data-id="${p.asset.id}"`, "text-link")}${button("Remover", "delete-asset", `data-id="${p.asset.id}"`, "text-link danger")}</td></tr>`).join("") || '<tr><td colspan="7">Cadastre um ativo e registre as compras para começar.</td></tr>'}</tbody></table></section><p class="small muted">Preços são manuais, com fonte e data. Ativos sem preço não entram no total conhecido. Aportes e retiradas são transferências; não são rentabilidade. O resultado exibido é absoluto, sem cálculo de IR ou recomendação.</p><div class="two-columns">${section(
        "Operações",
        historyList(c, "trades",
            (t) =>
              `<div class="list-row"><div><b>${esc(s.assets.find((a) => a.id === t.assetId)?.symbol)} · ${{ buy: "Compra", sell: "Venda", split: "Desdobramento / grupamento" }[t.side]}</b><small>${dt(t.date)} · ${hidden ? "••••" : number(t.quantity / SCALE)} ${t.side === "split" ? "vezes" : "unidades"} · Custos: ${money(t.fees)}</small></div>${button("Excluir", "delete-trade", `data-id="${esc(t.id)}" aria-label="Excluir ${t.fromId ? "transferência" : "operação"} de ${dt(t.date)}"`, "text-link danger")}</div>`,
          ),
      )}${section(
        "Proventos e rendimentos",
        historyList(c, "dividends",
            (d) =>
              `<div class="list-row"><div><b>${esc(s.assets.find((a) => a.id === d.assetId)?.symbol)} · ${money(d.amount)}</b><small>${dt(d.date)} · ${d.status === "received" ? "Recebido no caixa" : "Anunciado, não entra no saldo"}</small></div>${d.status === "announced" ? button("Receber", "receive-dividend", `data-id="${esc(d.id)}" aria-label="Receber provento de ${dt(d.date)}"`, "text-link") : ""}${button("Excluir", "delete-dividend", `data-id="${esc(d.id)}" aria-label="Excluir provento de ${dt(d.date)}"`, "text-link danger")}</div>`,
          ),
      )}${section("Renda fixa: estimativa bruta", `<p class="small muted">Simulação de juros compostos com taxa anual constante e dias corridos. Não considera IR, IOF, dias úteis, risco de crédito ou oscilação de taxas. Não é uma cotação de resgate.</p>${button("Simular valor", "simulate")}`)}${section("Referência global informada", port.snapshot ? `<div class="amount small-amount">${money(port.snapshot.amount)}</div><p class="small muted">${dt(port.snapshot.date)} · ${esc(port.snapshot.source)}. Referência separada, sem somar novamente aos ativos. Se veio da versão antiga, confira a data antes de usar.</p>` : empty("Opcional: registre um total informado pela corretora sem composição."))}</div>`
    );
  if (view === "mercado")
    return (
      heading +
      `<div class="section-banner split"><span>Atualizações sob demanda. Dados oficiais podem ter atraso. O controle financeiro funciona sem estas fontes.</span>${button(marketState.loading ? "Atualizando…" : "↻ Atualizar fontes", "refresh-market", marketState.loading ? "disabled" : "", "primary")}</div><div class="stats-grid indicators-grid">${publicIndicators(money)}</div>${Object.values(marketState.errors).length ? '<div class="notice warn">Algumas fontes não responderam: ' + Object.values(marketState.errors).map(esc).join(" · ") + ". A última cópia, quando disponível, permanece identificada.</div>" : ""}<div class="two-columns">${section(
        "Lista de acompanhamento",
        s.watchlist
          .map((w) => {
            const asset = s.assets.find((a) => a.symbol === w.symbol);
            return `<div class="list-row"><div><b>${esc(w.symbol)}</b><small>${esc(w.kind === "index" ? "Índice" : w.kind === "fii" ? "FII" : w.kind === "stock" ? "Ação" : "Referência")}${asset?.manualPrice ? " · Manual · " + dt(asset.priceDate) : " · Sem fonte de preço conectada"}</small></div><b>${asset?.manualPrice ? money(asset.manualPrice) : "—"}</b>${button("Remover", "delete-watch", `data-id="${w.id}"`, "text-link danger")}</div>`;
          })
          .join("") +
          `<p class="small muted">FIIs, índices e demais ativos podem usar valores manuais ou importados. Cotações completas em tempo real dependem de licenças e não fazem parte do custo zero.</p>`,
        button("＋ Código", "watch"),
      )}${section("Amostras públicas de cotações", marketState.samples ? marketState.samples.items.map((q) => `<div class="list-row"><div><b>${esc(q.symbol)}</b><small>${esc(q.reference || "Horário não informado")} · brapi</small></div><b>${hidden ? "R$ ••••" : currency(Math.round(q.price * 100))}</b><span class="${q.change < 0 ? "negative" : "green"}">${hidden ? "••••" : q.change == null ? "—" : number(q.change) + "%"}</span></div>`).join("") + dataStamp(marketState.samples) : empty("Quatro códigos liberados pelo provedor para testes: PETR4, VALE3, ITUB4 e MGLU3.") + `<p class="small muted">Amostras de integração, sem garantia de tempo real. Não atualizam sua carteira automaticamente. Nenhum token ou plano pago é utilizado.</p>`, button("Carregar amostras", "samples"))}</div><div class="section-heading"><h2>Publicações oficiais</h2>${pill("Brasil e exterior")}</div><div class="news-grid">${newsCards()}</div>${section("Como interpretar os acontecimentos", `<div class="impact-grid"><div>${pill("Fatos confirmados")}<p>As manchetes acima reproduzem o título publicado pela fonte. Abra o comunicado para conferir o conteúdo, a data e eventuais revisões. O app não transforma manchetes em recomendações.</p></div><div>${pill("Interpretação educativa", "blue")}<p>Juros podem alterar o custo do crédito e o desconto dos fluxos futuros. Inflação afeta o poder de compra; câmbio pode afetar empresas importadoras e exportadoras. O efeito depende da exposição de cada ativo.</p></div><div>${pill("Cenários possíveis", "warn")}<p>Uma mudança já esperada pode estar nos preços. Há cenários de alta, estabilidade ou queda. O aplicativo não calcula probabilidades nem garante um resultado de mercado.</p></div></div>`)}`
    );
  if (view === "relatorios") {
    const paid = s.payments.filter((p) => p.date.startsWith(m)),
      entryMap = new Map(s.entries.map((entry) => [entry.id, entry])),
      byCategory = new Map(
        categoryNames(s, { includeArchived: true }).map((k) => [k, 0]),
      );
    for (const p of paid) {
      const e = entryMap.get(p.entryId);
      if (e.type === "expense")
        byCategory.set(
          e.category,
          (byCategory.get(e.category) || 0) + p.amount,
        );
    }
    return (
      heading +
      period +
      `<div class="toolbar compact">${button("↓ Lançamentos CSV", "csv")}${button("↓ Pagamentos CSV", "payments-csv")}${button("Imprimir / salvar PDF", "print")}</div><div class="stats-grid">${stat("Receitas recebidas", money(sum.income), "No mês selecionado")}${stat("Despesas pagas", money(sum.expense), "Inclui liquidação de compras no cartão")}${stat("Saldo do fluxo", money(sum.income - sum.expense), "Transferências e operações da carteira ficam separadas")}</div><div class="two-columns">${section(
        "Despesas pagas por categoria",
        [...byCategory]
          .filter(([_, v]) => v > 0)
          .map(
            ([cat, v]) =>
              `<div class="budget-row"><div><b>${esc(cat)}</b><strong>${money(v)}</strong></div>${hidden ? "" : `<progress max="${Math.max(1, sum.expense)}" value="${v}" aria-label="${esc(cat)}"></progress>`}</div>`,
          )
          .join("") || empty("Nenhum pagamento de despesa no mês."),
      )}${section("Conferência das contas", s.accounts.map((a) => `<div class="list-row"><div><b>${esc(a.name)}</b><small>Saldo até ${dt(sum.cutoff)}</small></div><strong>${money(b.get(a.id))}</strong></div>`).join("") || empty("Sem contas."))}${section(
        "Rendimentos da carteira",
        positions(s, sum.cutoff)
          .map(
            (p) =>
              `<div class="list-row"><div><b>${esc(p.asset.symbol)}</b><small>Lucro / prejuízo realizado: ${money(p.realized)} · Proventos recebidos: ${money(p.dividends)}</small></div></div>`,
          )
          .join("") || empty("Sem posições."),
      )}${section("Critérios do relatório", '<p class="small muted">O fluxo usa datas efetivas de recebimento e pagamento. O orçamento usa competência. Compras de ativos afetam o caixa da conta e o custo da carteira, sem se tornarem despesas de consumo. Estes relatórios não substituem informes de corretora nem apuração fiscal.</p>')}</div>`
    );
  }
  return (
    heading +
    `<nav class="mobile-extra" aria-label="Mais áreas do app">${go("Investimentos", "investimentos")}${go("Mercado e notícias", "mercado")}${go("Relatórios", "relatorios")}</nav><div class="two-columns">${section("Seu espaço", `<div class="profile-card"><div class="avatar">${esc(s.name[0])}</div><div><b>${esc(s.name)}</b><small>Cofre pessoal protegido</small></div></div><p class="small muted">Entre com sua senha para acessar o cofre neste navegador. Ao sair ou recarregar, a entrada será solicitada novamente. Seus registros financeiros não são enviados ao servidor.</p><div class="toolbar compact">${button("Editar nome", "name")}${slot === "personal" ? button("Trocar senha", "change-password") : ""}${slot === "personal" ? button("Sair e bloquear", "lock") : c.hasPersonal ? button("Desbloquear cofre anterior", "personal", 'id="access-primary"') : ""}</div>`)}${section("Aparência", `<p class="small muted">Escolha o tema mais confortável. Sua preferência fica salva neste navegador e também vale para a tela de entrada.</p><label class="theme-control settings-theme"><span>Tema do aplicativo</span><select data-theme-selector aria-label="Tema do aplicativo">${options([["light", "Claro"], ["dark", "Escuro"]], c.theme || "light")}</select></label><p id="theme-status" data-theme-status class="small muted" role="status"></p>`)}${c.hasLocal ? section("Dados da versão sem login", `<p class="small muted">Os registros anteriores continuam preservados em uma cópia local sem senha. Você pode exportá-los ou substituir o conteúdo deste cofre por uma cópia criptografada. Faça um backup do cofre antes de importar.</p><div class="toolbar compact">${button("Exportar dados anteriores", "local-export")}${button("Importar dados anteriores", "local-import")}</div>`) : ""}${section("Categorias", categoriesView(s), button("＋ Categoria", "category"))}${section("Backup e recuperação", `<p class="small muted">${slot === "personal" ? "O backup padrão é criptografado com a senha do cofre." : "O backup deste espaço é um JSON sem senha. Guarde-o em local protegido."} Guarde o arquivo fora do navegador. Limpar os dados do site remove também o cofre.</p><div class="toolbar compact">${button("↓ Fazer backup", "backup", "", "primary")}${button("↑ Restaurar arquivo", "restore")}${button("Testar restauração", "verify-backup")}${button("Recuperar versão anterior", "checkpoint")}</div><p class="small muted">Backup solicitado: ${esc(c.backupAt || "Nenhum neste dispositivo")}<br>Arquivo verificado: ${esc(c.verifiedAt || "Ainda não testado")}<br>O app não consegue confirmar que o download foi guardado.</p>`)}${section("Armazenamento e instalação", `<p class="small muted">${c.memory ? "Armazenamento indisponível: alterações bloqueadas. Os registros existentes foram preservados." : `Dados guardados neste navegador. Persistência: ${c.storageStats?.persistent ? "concedida" : "não concedida pelo navegador"}.`}</p><p class="small muted">Uso estimado da origem: ${c.storageStats?.usage != null ? number(c.storageStats.usage / 1024 / 1024) + " MiB" : "indisponível"} · Quota: ${c.storageStats?.quota != null ? number(c.storageStats.quota / 1024 / 1024) + " MiB" : "indisponível"}</p><div class="toolbar compact">${button("Solicitar persistência", "persist")}${button("Instalar app", "install")}${button("Verificar atualização", "check-update")}</div><p class="small muted">Depois do primeiro acesso conectado, o núcleo funciona offline. Em navegadores sem botão de instalação, use o menu do navegador e “Adicionar à tela inicial”. Dados públicos precisam de conexão.</p>`)}${section("Conferência e segurança", `<p class="small muted">O cofre usa AES-GCM e PBKDF2, com bloqueio após 10 minutos de inatividade ou 2 minutos em segundo plano. A senha permanece apenas na memória durante o acesso. Cópias da versão sem login são preservadas separadamente para recuperação.</p><p class="small muted">A senha não pode ser recuperada pelo aplicativo. Use uma senha longa e guarde o backup. Exportações CSV e impressões contêm dados legíveis. Ocultar valores protege a visualização, sem criptografar exportações.</p>${s.migrationNotes.length ? '<div class="notice warn"><b>Conferências da migração</b><ul>' + s.migrationNotes.map((n) => "<li>" + esc(n) + "</li>").join("") + "</ul></div>" : ""}${c.legacy ? '<div class="notice warn">Há dados da versão anterior preservados neste navegador. Migre para o cofre ou exporte uma cópia antes de removê-los.</div><div class="toolbar compact">' + button("Migrar dados antigos", "migrate") + button("Exportar dados antigos", "legacy-export") + button("Remover cópia antiga", "legacy-delete") + "</div>" : ""}`)}${section("Custo e fontes", '<p>Sem assinatura obrigatória, sem APIs pagas e sem sincronização financeira em nuvem.</p><p class="small muted">Fontes públicas: Banco Central, IBGE e Federal Reserve. Amostras opcionais: brapi. Há cache e intervalo mínimo entre consultas. Se uma fonte bloquear ou atingir limites, a atualização é interrompida e o controle financeiro continua disponível. Serviços gratuitos podem mudar limites e condições.</p><p class="small muted">Não há conexão bancária, ordem de investimento, credencial de banco ou chave de API no navegador.</p>')}${c.retiredDemo ? section("Registros antigos de testes", '<div id="retired-demo-review"><p>Há registros alterados no antigo espaço de testes. Eles ficam separados dos dados atuais. Guarde uma cópia antes de remover.</p><div class="toolbar compact">' + button("Guardar cópia para revisão", "retired-demo-export") + button("Remover espaço de testes", "retired-demo-discard", "", "text-link danger") + "</div></div>") : ""}${section("Manutenção", `<div class="toolbar compact">${button("Recarregar dados salvos", "reload")}</div><p class="small muted">Versão 1.4.0 · Entrada por senha, temas claro e escuro e compatibilidade com os cofres anteriores. Registros financeiros ficam neste navegador.</p>`)}</div>`
  );
}
function categoriesView(state) {
  const counts = new Map();
  for (const collection of ["entries", "budgets", "recurrences"])
    for (const row of state[collection])
      counts.set(row.category, (counts.get(row.category) || 0) + 1);
  return (
    '<p class="small muted">Adicione e renomeie suas categorias. Ao renomear, lançamentos, orçamentos e recorrências mantêm o vínculo. Arquivar retira a categoria de novos cadastros e preserva o histórico; recorrências já criadas continuam até serem pausadas.</p>' +
    categoryList(state)
      .map((category) => {
        const total = counts.get(category.name) || 0;
        const label = category.archived ? "Arquivada" : "Ativa",
          toggle = category.archived ? "Reativar" : "Arquivar";
        return `<div class="list-row"><div class="grow"><b>${esc(category.name)}</b><small>${label} · ${total} referência(s) no histórico e planejamento</small></div><div class="row-actions">${button("Editar", "category", `data-id="${esc(category.id)}" aria-label="Editar categoria ${esc(category.name)}"`, "text-link")}${button(toggle, "toggle-category", `data-id="${esc(category.id)}" aria-label="${toggle} categoria ${esc(category.name)}"`, "text-link")}</div></div>`;
      })
      .join("")
  );
}
export function options(rows, selected) {
  return rows
    .map(
      ([value, label]) =>
        `<option value="${esc(value)}"${String(value) === String(selected) ? " selected" : ""}>${esc(label)}</option>`,
    )
    .join("");
}
function stat(title, value, note) {
  return `<section class="card"><span class="small muted">${title}</span><div class="amount small-amount">${value}</div><small class="muted">${note}</small></section>`;
}
function flowChart(weeks) {
  const max = Math.max(10000, ...weeks.flat());
  let svg = "";
  for (let j = 0; j < 4; j++) {
    const y = 15 + j * 45;
    svg += `<line x1="55" y1="${y}" x2="565" y2="${y}" stroke="#e2e8ef"/><text x="46" y="${y + 4}" text-anchor="end">${number(Math.round((max * (1 - j / 3)) / 100))}</text>`;
  }
  weeks.forEach((v, i) => {
    for (let k = 0; k < 2; k++) {
      const h = (v[k] / max) * 135;
      svg += `<rect x="${75 + i * 100 + k * 25}" y="${150 - h}" width="19" height="${h}" rx="4" fill="${k ? "#b34e38" : "#087c66"}"/>`;
    }
    svg += `<text x="${97 + i * 100}" y="178" text-anchor="middle">Sem ${i + 1}</text>`;
  });
  const rows = weeks
    .map(
      (v, i) =>
        `<tr><th scope="row">Semana ${i + 1}</th><td>${currency(v[0])}</td><td>${currency(v[1])}</td></tr>`,
    )
    .join("");
  return `<div class="legend"><span><i></i>Receitas (R$)</span><span><i class="expense"></i>Despesas (R$)</span></div><svg class="chart-svg" viewBox="0 0 580 190" role="img" aria-label="Receitas e despesas pagas por semana. Consulte os valores na tabela abaixo.">${svg}</svg><details class="chart-values"><summary>Ver valores por semana</summary><div class="table-wrap"><table><caption class="sr-only">Receitas e despesas pagas por semana, em reais</caption><thead><tr><th scope="col">Período</th><th scope="col">Receitas</th><th scope="col">Despesas</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}
function budgetsView(s, m, money, hidden) {
  const cats = categoryNames(s, { includeArchived: true }).filter(
    (c) => monthlyPlan(s.budgets, m, c) > 0 || budgetUsage(s, m, c).spent > 0,
  );
  return (
    cats
      .map((cat) => {
        const v = budgetUsage(s, m, cat),
          over = v.amount > 0 && v.spent > v.amount,
          percent = v.amount ? Math.round((v.spent / v.amount) * 100) : null;
        const status = hidden
          ? "Valores ocultos"
          : !v.amount
            ? "Sem limite definido"
            : over
              ? `Acima do limite em ${money(v.spent - v.amount)}`
              : `Restam ${money(v.amount - v.spent)}`;
        const progress =
          hidden || !v.amount
            ? ""
            : `<progress max="${v.amount}" value="${Math.min(v.amount, v.spent)}" aria-label="Orçamento de ${esc(cat)}" aria-valuetext="${esc(currency(v.spent))} de ${esc(currency(v.amount))}; ${percent}% utilizado${over ? "; acima do limite" : ""}"></progress>`;
        return `<div class="budget-row${!hidden && over ? " budget-over" : ""}"><div><b>${esc(cat)}</b><strong>${money(v.spent)} <span class="muted">/ ${v.amount ? money(v.amount) : "Sem limite"}</span></strong></div>${progress}<div class="budget-status"><span>${!hidden && over ? "⚠ " : ""}${status}</span>${hidden || percent == null ? "" : `<span>${percent}% utilizado</span>`}</div></div>`;
      })
      .join("") ||
    empty("Defina um limite por categoria para acompanhar seu mês.")
  );
}
function goalsView(s, money, hidden) {
  return (
    s.goals
      .map(
        (g) =>
          `<div class="budget-row"><div><button class="text-link" data-action="goal" data-id="${g.id}">${esc(g.name)}</button><b>${money(g.allocated)}</b></div><small class="muted">Meta: ${money(g.target)} · ${dt(g.dueDate)}</small>${hidden ? "" : `<progress max="${Math.max(g.target, g.allocated)}" value="${g.allocated}" aria-label="Meta ${esc(g.name)}" aria-valuetext="${esc(currency(g.allocated))} de ${esc(currency(g.target))}"></progress>`}</div>`,
      )
      .join("") || empty("Crie uma meta e separe um valor dentro do seu saldo.")
  );
}
function paymentsView(
  s,
  entries,
  money,
  max = 10,
  all = false,
  asOf = localDate(),
) {
  return (
    entries
      .slice()
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, max)
      .map((e) => {
        const left = outstanding(s, e, asOf),
          current = outstanding(s, e);
        return `<div class="list-row"><div class="list-icon">${e.cardId ? "▤" : "↗"}</div><div class="grow"><b>${esc(e.description)}</b><small>${dt(e.dueDate)} · ${left > current ? (current ? "Parcialmente pago após o período" : "Quitado após o período") : e.dueDate < asOf && left ? "Vencido" : left ? "Previsto" : "Quitado"}</small></div><strong>${money(all ? e.amount : left)}</strong>${current ? button("Pagar", "payment", `data-id="${e.id}"`, "text-link") : ""}</div>`;
      })
      .join("") || empty("Nenhum compromisso pendente.")
  );
}
function pendingAmounts(state) {
  const pending = new Map(
    state.entries.map((entry) => [entry.id, entry.amount]),
  );
  for (const payment of state.payments)
    if (pending.has(payment.entryId))
      pending.set(
        payment.entryId,
        pending.get(payment.entryId) - payment.amount,
      );
  return pending;
}
function filterEntries(c, pending) {
  const normalize = (value) =>
      String(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase(),
    query = normalize(c.search || "");
  return c.state.entries
    .filter(
      (e) =>
        (c.scope === "all" ||
          (c.scope === "due"
            ? e.dueDate <= endOfMonth(c.month) && pending.get(e.id) > 0
            : e.competence === c.month)) &&
        (c.typeFilter === "all" || e.type === c.typeFilter) &&
        (c.statusFilter === "all" ||
          (c.statusFilter === "pending"
            ? pending.get(e.id) > 0
            : pending.get(e.id) === 0)) &&
        normalize(e.description + " " + e.category).includes(query),
    )
    .sort(
      (a, b) => b.dueDate.localeCompare(a.dueDate) || a.id.localeCompare(b.id),
    );
}
export function filteredEntries(c) {
  return filterEntries(c, pendingAmounts(c.state));
}
export function ledgerRows(c, money) {
  const pending = pendingAmounts(c.state),
    entries = filterEntries(c, pending),
    page = Math.min(c.page, Math.max(1, Math.ceil(entries.length / 50))),
    rows = entries.slice((page - 1) * 50, page * 50);
  const expense = entries
      .filter((e) => e.type === "expense")
      .reduce((n, e) => n + e.amount, 0),
    income = entries
      .filter((e) => e.type === "income")
      .reduce((n, e) => n + e.amount, 0);
  const action = (label, name, e, cls = "text-link") =>
    button(
      label,
      name,
      `data-id="${esc(e.id)}" aria-label="${esc(label + " " + e.description)}"`,
      cls,
    );
  return `<div class="filter-totals"><span id="ledger-count">${entries.length} registro(s) nos filtros</span><span>Receitas: <b>${money(income)}</b></span><span>Despesas: <b>${money(expense)}</b></span></div><section class="card table-wrap ledger-wrap"><table class="ledger-table" role="table"><caption class="sr-only">Lançamentos nos filtros selecionados</caption><thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Descrição</th><th scope="col" role="columnheader">Vencimento</th><th scope="col" role="columnheader">Situação</th><th scope="col" role="columnheader">Valor</th><th scope="col" role="columnheader">Ações</th></tr></thead><tbody role="rowgroup">${
    rows
      .map((e) => {
        const left = pending.get(e.id);
        return `<tr role="row"><td role="cell"><b>${esc(e.description)}</b><small>${esc(e.category)} · Competência ${esc(e.competence)}${e.cardId ? " · Cartão" : ""}${e.assumedDate ? " · Data migrada: conferir" : ""}</small></td><td role="cell"><span class="mobile-cell-label" aria-hidden="true">Vencimento</span>${dt(e.dueDate)}</td><td role="cell"><span class="mobile-cell-label" aria-hidden="true">Situação</span>${pill(left === 0 ? "Quitado" : left < e.amount ? "Parcial" : "Previsto", left && e.dueDate < localDate() ? "warn" : "")} ${left ? "<small>Pendente " + money(left) + "</small>" : ""}</td><td role="cell" class="ledger-value ${e.type === "income" ? "green" : "negative"}"><span class="sr-only">${e.type === "income" ? "Receita" : "Despesa"}: </span>${e.type === "income" ? "+" : "−"} ${money(e.amount)}</td><td role="cell"><div class="row-actions">${left ? action(e.type === "income" ? "Receber" : "Pagar", "payment", e) : ""}${action("Detalhes", "entry-detail", e)}${action("Editar", "entry", e)}${action("Excluir", "delete-entry", e, "text-link danger")}</div></td></tr>`;
      })
      .join("") ||
    '<tr role="row"><td role="cell" colspan="5" class="ledger-empty">Nenhum lançamento com estes filtros.</td></tr>'
  }</tbody></table></section><nav class="pagination" aria-label="Paginação dos lançamentos">${button("← Anterior", "prev-page", page === 1 ? "disabled" : "")}<span>Página ${page} de ${Math.max(1, Math.ceil(entries.length / 50))} · Até 50 por página</span>${button("Próxima →", "next-page", page * 50 >= entries.length ? "disabled" : "")}</nav>`;
}
function dataStamp(data) {
  return `<p class="data-note">Consultado: ${esc(data?.fetchedAt ? new Date(data.fetchedAt).toLocaleString("pt-BR") : "—")}${stale(data) ? " · Cópia desatualizada" : ""}</p>`;
}
function publicIndicators(money, compact = false) {
  const items = marketState.macro?.items || [];
  const selected = compact
    ? items.filter((x) => ["selic", "ipca", "ptax"].includes(x.id))
    : items;
  return (
    (selected.length
      ? selected
      : [
          { name: "Selic meta" },
          { name: "IPCA mensal" },
          { name: "Dólar PTAX" },
        ]
    )
      .map(
        (x) =>
          `<${compact ? "div" : "section"} class="${compact ? "indicator-row" : "card indicator"}"><div><b>${esc(x.name)}</b>${!compact && x.value != null ? "<small>" + esc(x.source) + (x._stale ? " · Cópia anterior" : "") + "</small>" : ""}</div><strong>${x.value == null ? "—" : number(x.value) + " " + esc(x.unit)}</strong>${!compact ? `<small>Referência: ${esc(x.reference || "A consultar") + (x._stale ? " · Cópia anterior" : "")}${x.note ? "<br>" + esc(x.note) : ""}</small>` : ""}</${compact ? "div" : "section"}>`,
      )
      .join("") +
    (compact
      ? '<div class="data-note">BCB / IBGE · ' +
        (stale(marketState.macro)
          ? "A atualizar"
          : "Última consulta disponível") +
        "</div>"
      : '<div class="indicator-meta">' +
        dataStamp(marketState.macro) +
        "<small>IPCA em 12 meses calculado pela composição das últimas 12 variações mensais. Meta Selic é diferente da taxa efetiva e do CDI.</small></div>")
  );
}
function officialNewsURL(value) {
  try {
    const url = new URL(String(value)),
      hosts = ["ibge.gov.br", "federalreserve.gov"];
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      !hosts.some(
        (host) => url.hostname === host || url.hostname.endsWith("." + host),
      )
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
function newsCards(compact = false) {
  const items = [
    ...(marketState.brazil?.items || []),
    ...(marketState.global?.items || []),
  ];
  if (!items.length)
    return empty(
      "Carregue as publicações do IBGE e os comunicados de política monetária do Federal Reserve.",
      compact ? "" : button("Atualizar notícias", "refresh-market"),
    );
  return items
    .slice(0, compact ? 1 : 12)
    .map((n) => {
      const url = officialNewsURL(n.url);
      return `<article class="${compact ? "news-compact" : "card news-item"}">${pill(esc(n.kind), "blue")}<h3>${esc(n.title)}</h3><small class="muted">${esc(n.source)} · ${esc(n.publishedAt || "Data não informada")} · ${n.language === "en" ? "Original em inglês" : "Português"}</small>${url ? `<p><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Ler na fonte <span class="sr-only">(abre em nova aba)</span>↗</a></p>` : '<p class="small muted">Link da publicação indisponível.</p>'}<small class="muted">${stale(n.source === "Federal Reserve" ? marketState.global : marketState.brazil) ? "Cópia desatualizada · " : ""}Título da publicação; interpretação do app separada abaixo.</small></article>`;
    })
    .join("");
}
