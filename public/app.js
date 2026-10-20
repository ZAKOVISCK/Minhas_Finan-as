import * as F from "./finance.mjs";
import {
  openDatabase,
  readValue,
  loadRaw,
  decodeRaw,
  previousRaw,
  saveSlot,
  storageInfo,
  requestPersistence,
  StorageConflict,
} from "./storage.mjs";
import {
  newKdf,
  deriveKey,
  seal,
  unseal,
  backupWithKey,
  readBackup,
  MAX_ENCRYPTED_BYTES,
} from "./crypto.mjs";
import {
  routes,
  esc,
  currency,
  icon,
  options,
  renderView,
  ledgerRows,
} from "./views.mjs";
import {
  parseCSV,
  suggestMapping,
  previewCSV,
  previewOFX,
  planImport,
  applyImport,
  IMPORT_LIMIT,
} from "./imports.mjs";
import { restorePublicCache, updateMarket } from "./market.mjs";
import {
  field,
  select,
  amountField,
  dateField,
  validateFormData,
} from "./form-utils.mjs";
const $ = (s) => document.querySelector(s),
  today = () => F.localDate(),
  currentMonth = () => today().slice(0, 7);
let state = F.demo(),
  slot = "demo",
  db = null,
  key = null,
  kdf = null,
  personalHead = null,
  legacy = null,
  busy = false,
  processing = false,
  memory = false,
  blocked = false,
  external = false,
  hidden = false,
  month = currentMonth(),
  view = "inicio",
  search = "",
  typeFilter = "all",
  statusFilter = "all",
  scope = "month",
  page = 1,
  historyPages = { transfers: 1, trades: 1, dividends: 1 },
  stats = null,
  undo = null,
  lastActivity = Date.now(),
  hiddenAt = 0,
  pendingLock = false,
  sealedDrafts = null,
  transitioning = false,
  privacyMasked = false;
let dialogKind = "",
  dialogId = "",
  drafts = new Map(),
  importSession = null,
  fileAction = "",
  installPrompt = null,
  swRegistration = null,
  waitingWorker = null,
  updateRequested = false,
  dialogReturnFocus = null;
const notifyChannel = (() => {
  try {
    return new BroadcastChannel("minhas-financas-v3");
  } catch {
    return null;
  }
})();
notifyChannel?.addEventListener("message", (e) => {
  const revision = e.data?.revision;
  if (
    !memory &&
    !transitioning &&
    e.data?.slot === slot &&
    Number.isSafeInteger(revision) &&
    revision >= 0 &&
    revision < Number.MAX_SAFE_INTEGER - 1 &&
    revision > state.revision
  ) {
    external = true;
    renderNotice();
  }
});
const isRoute = (route) => Object.hasOwn(routes, route);
function focusSelector(element) {
  if (!(element instanceof HTMLElement)) return null;
  if (element.id) return `#${CSS.escape(element.id)}`;
  if (element.dataset.action) {
    return `[data-action="${CSS.escape(element.dataset.action)}"]${element.dataset.id ? `[data-id="${CSS.escape(element.dataset.id)}"]` : ""}`;
  }
  if (element.dataset.view)
    return `[data-view="${CSS.escape(element.dataset.view)}"]`;
  if (element.name && element.closest("form")?.id) {
    return `#${CSS.escape(element.closest("form").id)} [name="${CSS.escape(element.name)}"]`;
  }
  return null;
}
function rememberFocus() {
  const element = document.activeElement;
  return {
    selector: focusSelector(element),
    inMain: !!element?.closest?.("#main"),
    start: element instanceof HTMLInputElement ? element.selectionStart : null,
    end: element instanceof HTMLInputElement ? element.selectionEnd : null,
  };
}
function ensureFocusVisible(element = document.activeElement) {
  if (
    !(element instanceof HTMLElement) ||
    element === document.body ||
    element.closest("#mobile-nav")
  )
    return;
  const rect = element.getBoundingClientRect();
  const nav = $("#mobile-nav").getBoundingClientRect();
  const bottom = nav.height ? nav.top - 12 : innerHeight - 12;
  if (rect.bottom > bottom || rect.top < 8) {
    if (element.closest("dialog"))
      element.scrollIntoView({ block: "nearest", behavior: "instant" });
    else
      window.scrollBy({
        top: rect.bottom > bottom ? rect.bottom - bottom : rect.top - 12,
        behavior: "instant",
      });
  }
}
function restoreFocus(previous, fallback = false) {
  if ($("#dialog").open || privacyMasked) return;
  let element = previous?.selector
    ? document.querySelector(previous.selector)
    : null;
  if (!element || !element.getClientRects().length || element.disabled) {
    element = fallback ? $("#main h1") || $("#main") : null;
  }
  if (!element) return;
  if (element.matches("h1")) element.tabIndex = -1;
  element.focus({ preventScroll: true });
  if (
    previous?.start != null &&
    element instanceof HTMLInputElement &&
    ["text", "search"].includes(element.type)
  ) {
    element.setSelectionRange(previous.start, previous.end);
  }
  ensureFocusVisible(element);
}
const money = (n) => (hidden ? "R$ ••••" : currency(n));
function stamp(k) {
  try {
    return localStorage.getItem("mf-" + slot + "-" + k);
  } catch {
    return null;
  }
}
function saveStamp(k) {
  try {
    localStorage.setItem(
      "mf-" + slot + "-" + k,
      new Date().toLocaleString("pt-BR"),
    );
  } catch {
    /* preferência facultativa */
  }
}
function context() {
  return {
    state,
    slot,
    month,
    view,
    hidden,
    search,
    typeFilter,
    statusFilter,
    scope,
    page,
    historyPages,
    memory,
    legacy,
    storageStats: stats,
    backupAt: stamp("backup"),
    verifiedAt: stamp("verified"),
  };
}
function toast(message) {
  if (privacyMasked) return;
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("#toast").classList.remove("show"), 6000);
}
function renderNotice() {
  if (privacyMasked) return;
  const messages = [];
  if (blocked)
    messages.push(
      "Os dados salvos não puderam ser validados. Eles foram preservados. Exporte os dados brutos ou restaure uma cópia válida.",
    );
  if (external)
    messages.push(
      "Outra aba alterou este espaço. Recarregue os dados antes de continuar.",
    );
  if (memory)
    messages.push(
      "Armazenamento indisponível: alterações apenas nesta sessão. Exporte antes de sair.",
    );
  if (legacy)
    messages.push(
      "Há dados da versão anterior preservados. Confira a migração em Configurações.",
    );
  $("#storage-notice").innerHTML =
    messages.map(esc).join(" ") +
    (external ? '<button data-action="reload">Recarregar</button>' : "") +
    (blocked
      ? '<button data-action="raw-export">Exportar dados brutos</button>'
      : "");
  $("#storage-notice").hidden = !messages.length;
  $("#demo-banner").hidden = slot !== "demo";
  $("#mode-label").textContent =
    slot === "demo" ? "Demonstração" : "Cofre pessoal aberto";
  $("#mode-label").classList.toggle("personal", slot === "personal");
  $("#lock-button").hidden = slot !== "personal";
  $("#storage-location").textContent = memory
    ? "Somente nesta sessão"
    : slot === "personal"
      ? "Cofre criptografado neste navegador"
      : "Demonstração neste navegador";
  $("#undo-notice").hidden = !undo;
  $("#update-notice").hidden = !waitingWorker;
}
function render() {
  if (!state || privacyMasked) return;
  const previousFocus = rememberFocus();
  view = isRoute(view) ? view : "inicio";
  document.title = routes[view] + " · Minhas finanças";
  $("#breadcrumb").textContent = routes[view];
  $("#main").innerHTML = renderView(context());
  $("#main").setAttribute("aria-busy", "false");
  $("#profile").textContent = state.name[0].toUpperCase();
  for (const n of document.querySelectorAll("[data-view]"))
    n.classList.toggle("active", n.dataset.view === view);
  for (const n of document.querySelectorAll(
    "#nav [data-view], #mobile-nav [data-view]",
  )) {
    if (n.dataset.view === view) n.setAttribute("aria-current", "page");
    else n.removeAttribute("aria-current");
  }
  renderNotice();
  restoreFocus(previousFocus, previousFocus.inMain);
}
function renderLedger() {
  if (view !== "lancamentos" || !$("#ledger-results")) return;
  const previousFocus = rememberFocus();
  $("#ledger-results").innerHTML = ledgerRows(context(), money);
  const count = $("#ledger-count");
  if (count) {
    count.setAttribute("role", "status");
    count.setAttribute("aria-live", "polite");
  }
  restoreFocus(previousFocus, previousFocus.inMain);
}
function navigate(next) {
  if (busy || processing || transitioning) {
    toast("Aguarde a operação terminar.");
    return;
  }
  if (!isRoute(next)) return;
  if ($("#dialog").open) stashDialog();
  view = next;
  location.hash = next;
  render();
  const heading = $("#main h1") || $("#main");
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "instant" });
}
function assertWritable() {
  if (transitioning || privacyMasked)
    throw new Error("Aguarde a troca de espaço terminar.");
  if (blocked)
    throw new Error("Recupere os dados antes de alterar este espaço.");
  if (external)
    throw new Error("Recarregue os dados: outra aba gravou alterações.");
  if (hidden) throw new Error("Mostre os valores para editar.");
}
async function commit(
  candidate,
  message,
  {
    operationId = F.uid(),
    removeLegacy = false,
    force = false,
    nextKey = key,
    nextKdf = kdf,
    recovery = false,
  } = {},
) {
  if (busy) return false;
  try {
    if (!recovery) assertWritable();
    if (external) throw new StorageConflict();
    busy = true;
    setBusy(true);
    const safe = F.validateState(candidate);
    let saved;
    if (memory) {
      saved = { ...safe, revision: state.revision + 1 };
    } else {
      const missingHeadRecovery =
        recovery && force && (await loadRaw(db, slot)).head == null;
      saved = await saveSlot(
        db,
        slot,
        state,
        safe,
        missingHeadRecovery ? -1 : state.revision,
        {
          key: nextKey,
          kdf: nextKdf,
          operationId,
          force,
          removeLegacy,
          discardCheckpoint: nextKey !== key,
          notify: (m) => notifyChannel?.postMessage(m),
        },
      );
    }
    state = saved;
    key = nextKey;
    kdf = nextKdf;
    blocked = false;
    if (removeLegacy) legacy = null;
    $("#save-status").textContent = memory
      ? "Alterações apenas nesta sessão"
      : "Salvo às " + new Date().toLocaleTimeString("pt-BR");
    toast(
      memory ? "Alterado nesta sessão. Faça um backup para guardar." : message,
    );
    return true;
  } catch (e) {
    if (e instanceof StorageConflict) external = true;
    toast(e.message || "Não foi possível concluir a gravação.");
    if ($("#dialog").open) showError(e);
    renderNotice();
    return false;
  } finally {
    busy = false;
    setBusy(false);
    if (pendingLock && !processing && !transitioning) {
      pendingLock = false;
      await lockVault();
    }
  }
}
function setBusy(value) {
  for (const b of document.querySelectorAll('button[type="submit"]'))
    b.disabled = value;
  $("#dialog-form").setAttribute("aria-busy", String(value));
}
function cloned() {
  return structuredClone(state);
}
function draftKey(kind = dialogKind, id = dialogId) {
  return `${slot}:${kind}:${id}`;
}
function captureForm() {
  const f = $("#dialog-form"),
    data = {};
  for (const el of f.elements) {
    if (el.name && el.type !== "password" && el.type !== "file")
      data[el.name] = el.type === "checkbox" ? el.checked : el.value;
  }
  return data;
}
function stashDialog() {
  if (!$("#dialog").open) return;
  const noDraft = [
    "unlock",
    "create",
    "change-password",
    "restore",
    "verify-backup",
    "mode",
    "detail",
  ].includes(dialogKind);
  if (!noDraft) drafts.set(draftKey(), captureForm());
  if (["restore", "verify-backup"].includes(dialogKind)) {
    importSession = null;
    fileAction = "";
    $("#file-input").value = "";
  }
  closeDialog(false);
}
function closeDialog(discard = true) {
  const previousFocus = dialogReturnFocus;
  dialogReturnFocus = null;
  if (discard) drafts.delete(draftKey());
  $("#dialog").close();
  $("#dialog-fields").replaceChildren();
  $("#dialog-title").textContent = "";
  $("#dialog-error").textContent = "";
  $("#dialog-error").hidden = true;
  delete $("#dialog-form").dataset.operation;
  delete $("#dialog-form").dataset.record;
  dialogKind = "";
  dialogId = "";
  if (previousFocus)
    requestAnimationFrame(() => restoreFocus(previousFocus, true));
}
const accountSelect = (label = "Conta", value = "", name = "accountId") =>
  select(
    label,
    name,
    state.accounts
      .filter((a) => !a.archived || a.id === value)
      .map((a) => [a.id, a.name]),
    value,
  );
function categorySelect(value) {
  const names = F.categoryNames(state, { selected: value || "" });
  return select(
    "Categoria",
    "category",
    names.map((name) => [name, name]),
    value || (names.includes("Outros") ? "Outros" : names[0]),
  );
}
const assetSelect = (value = "") =>
  select(
    "Ativo",
    "assetId",
    state.assets.map((a) => [a.id, a.symbol + " · " + a.name]),
    value,
  );
const help = (text) => `<p class="small muted">${text}</p>`;
function updateCategoryDrafts(previous) {
  const names = new Map(
    F.categoryList(state).map((category) => [category.id, category.name]),
  );
  const renamed = new Map(
    previous
      .filter((category) => names.has(category.id))
      .map((category) => [category.name, names.get(category.id)]),
  );
  for (const [name, draft] of drafts) {
    if (name.startsWith(slot + ":") && renamed.has(draft.category))
      drafts.set(name, { ...draft, category: renamed.get(draft.category) });
  }
}
function openDialog(kind, id = "", override = {}) {
  const previousFocus = rememberFocus();
  if ($("#dialog").open) stashDialog();
  if (
    ![
      "mode",
      "unlock",
      "create",
      "restore",
      "verify-backup",
      "import-map",
      "import-preview",
    ].includes(kind)
  ) {
    try {
      assertWritable();
    } catch (e) {
      toast(e.message);
      return;
    }
  }
  if (
    [
      "entry",
      "transfer",
      "card",
      "recurrence",
      "trade",
      "dividend",
      "purchase",
      "payment",
      "statement",
      "import",
    ].includes(kind) &&
    !state.accounts.some((a) => !a.archived)
  ) {
    toast("Adicione uma conta antes de registrar movimentos.");
    openDialog("account");
    return;
  }
  if (["trade", "dividend", "price"].includes(kind) && !state.assets.length) {
    toast("Cadastre um ativo primeiro.");
    openDialog("asset");
    return;
  }
  $("#dialog-submit").hidden = false;
  dialogKind = kind;
  dialogId = id;
  const draft = drafts.get(draftKey()) || {},
    d = { ...draft, ...override };
  let title = "",
    html = "",
    submit = "Salvar",
    wide = false;
  const row = (collection) => state[collection].find((x) => x.id === id);
  if (kind === "mode") {
    title = "Escolha seu espaço";
    submit = "Continuar";
    html =
      help(
        "A demonstração usa dados fictícios. Seu espaço pessoal começa vazio e pode ser protegido neste dispositivo, sem login no ChatGPT.",
      ) +
      select(
        "Espaço",
        "target",
        [
          ["demo", "Explorar demonstração"],
          ["personal", "Usar meus dados pessoais"],
        ],
        slot,
      ) +
      help(
        "O cofre é local: use backup para levar os dados para outro navegador.",
      );
  } else if (kind === "create") {
    title = "Criar meu cofre pessoal";
    submit = "Criar cofre vazio";
    html =
      field(
        "Como quer ser chamado?",
        "name",
        "text",
        "Isaque",
        'maxlength="40" required autocomplete="given-name"',
      ) +
      field(
        "Senha local (mínimo 12 caracteres)",
        "password",
        "password",
        "",
        'minlength="12" maxlength="256" required autocomplete="new-password"',
      ) +
      field(
        "Repita a senha",
        "confirmation",
        "password",
        "",
        'minlength="12" maxlength="256" required autocomplete="new-password"',
      ) +
      help(
        "A senha não é enviada ao servidor e não pode ser recuperada pelo app. Guarde uma cópia segura. O cofre começa sem exemplos e sem contas.",
      );
  } else if (kind === "unlock") {
    const recovering = d.checkpoint === "true";
    title = recovering
      ? "Recuperar a cópia anterior do cofre"
      : "Abrir cofre pessoal";
    submit = recovering ? "Validar e recuperar cópia anterior" : "Desbloquear";
    html =
      field(
        "Senha deste cofre",
        "password",
        "password",
        "",
        'minlength="12" maxlength="256" required autocomplete="current-password"',
      ) +
      help(
        "Esta senha é local, separada do ChatGPT. O site e a demonstração continuam acessíveis sem login.",
      ) +
      `<input type="hidden" name="checkpoint" value="${recovering ? "true" : "false"}">` +
      '<button type="button" class="text-link" data-action="personal-raw-export">Exportar cofre para recuperação</button>' +
      (personalHead?.hasCheckpoint && !recovering
        ? '<button type="button" class="text-link" data-action="unlock-checkpoint">Usar a cópia automática anterior</button>'
        : "") +
      (recovering
        ? help(
            "Primeiro exporte o cofre para preservá-lo. A senha será validada antes de pedir confirmação para substituir os dados pela cópia anterior.",
          )
        : "");
  } else if (kind === "entry") {
    const e = row("entries");
    title = e ? "Editar compromisso" : "Novo lançamento";
    html =
      field(
        "Descrição",
        "description",
        "text",
        e?.description || "",
        'required maxlength="100"',
      ) +
      '<div class="form-grid">' +
      select(
        "Tipo",
        "type",
        [
          ["expense", "Despesa"],
          ["income", "Receita"],
        ],
        e?.type || "expense",
      ) +
      amountField("Valor total (R$)", "amount", e?.amount || "") +
      dateField("Vencimento", "dueDate", e?.dueDate || today()) +
      field(
        "Mês de competência",
        "competence",
        "month",
        e?.competence || month,
        'min="1900-01" max="2199-12" required',
      ) +
      categorySelect(e?.category) +
      accountSelect("Conta prevista", e?.accountId) +
      "</div>" +
      help(
        "Competência organiza o orçamento. O vencimento organiza os compromissos. Pagamentos e recebimentos são registrados separadamente, inclusive parciais.",
      ) +
      (e
        ? help(
            "Os pagamentos já registrados permanecem. Para corrigir uma liquidação, abra os detalhes do lançamento.",
          )
        : `<label class="check"><input type="checkbox" name="paid"> Já foi pago / recebido</label>` +
          dateField("Data efetiva, se realizado", "paymentDate", today()));
  } else if (kind === "payment") {
    const e = row("entries");
    if (!e) return;
    title =
      e.type === "income" ? "Registrar recebimento" : "Registrar pagamento";
    html =
      help(
        esc(e.description) +
          " · Saldo pendente: " +
          money(F.outstanding(state, e)),
      ) +
      amountField("Valor a liquidar (R$)", "amount", F.outstanding(state, e)) +
      dateField("Data efetiva", "date") +
      accountSelect("Conta utilizada", e.accountId) +
      help(
        "O vencimento original é preservado. O caixa muda na data efetiva desta liquidação.",
      );
  } else if (kind === "category") {
    const category = F.categoryList(state).find((item) => item.id === id);
    title = category ? "Editar categoria" : "Nova categoria";
    html =
      field(
        "Nome da categoria",
        "name",
        "text",
        category?.name || "",
        'required maxlength="60"',
      ) +
      (category
        ? `<label class="check"><input type="checkbox" name="archived" ${category.archived ? "checked" : ""}> Arquivar para novos registros</label>`
        : "") +
      help(
        "Renomear atualiza os lançamentos, orçamentos e recorrências existentes. Arquivar conserva o histórico e permite reativar a categoria depois.",
      );
  } else if (kind === "account") {
    const a = row("accounts");
    title = a ? "Editar conta" : "Nova conta";
    html =
      field(
        "Nome da conta",
        "name",
        "text",
        a?.name || "",
        'required maxlength="60"',
      ) +
      select(
        "Tipo",
        "kind",
        [
          ["bank", "Conta bancária"],
          ["cash", "Dinheiro"],
          ["investment", "Caixa de investimentos"],
        ],
        a?.kind || "bank",
      ) +
      amountField(
        "Saldo inicial de referência (R$)",
        "opening",
        a?.opening ?? 0,
      ) +
      dateField(
        "Data do saldo inicial",
        "openingDate",
        a?.openingDate || today(),
      ) +
      (a
        ? `<label class="check"><input type="checkbox" name="archived" ${a.archived ? "checked" : ""}> Arquivar para novos movimentos</label>`
        : "") +
      help(
        "Informe o saldo antes dos movimentos registrados a partir desta data. Corrigir a abertura altera os saldos históricos desta conta.",
      );
  } else if (kind === "transfer") {
    title = "Transferir entre contas";
    html =
      accountSelect("De qual conta?", "", "fromId") +
      accountSelect("Para qual conta?", "", "toId") +
      amountField("Valor (R$)", "amount") +
      dateField("Data efetiva", "date") +
      help(
        "Uma única operação atualiza as duas contas. Transferências não entram como receita ou despesa. Para aportar, transfira da conta bancária para o caixa de investimentos.",
      );
  } else if (kind === "card") {
    const c = row("cards");
    title = c ? "Editar cartão" : "Novo cartão";
    html =
      field(
        "Nome do cartão",
        "name",
        "text",
        c?.name || "",
        'required maxlength="60"',
      ) +
      amountField("Limite informado (R$)", "limit", c?.limit ?? 0) +
      '<div class="form-grid">' +
      field(
        "Dia de fechamento",
        "closingDay",
        "number",
        c?.closingDay || 15,
        'min="1" max="31" required',
      ) +
      field(
        "Dia de vencimento",
        "dueDay",
        "number",
        c?.dueDay || 22,
        'min="1" max="31" required',
      ) +
      "</div>" +
      accountSelect("Conta padrão para pagar", c?.accountId) +
      help(
        "Dias que não existem no mês são ajustados ao último dia. Alterar o cartão não muda as faturas de compras já registradas.",
      );
  } else if (kind === "purchase") {
    const card = row("cards");
    if (!card) return;
    title = "Compra no " + card.name;
    const after = Number(today().slice(8)) > card.closingDay;
    const shift = (card.dueDay <= card.closingDay ? 1 : 0) + (after ? 1 : 0);
    html =
      field("Descrição", "description", "text", "", 'required maxlength="80"') +
      amountField("Valor total da compra (R$)", "amount") +
      dateField("Data da compra", "date") +
      categorySelect() +
      field(
        "Número de parcelas",
        "installments",
        "number",
        "1",
        'min="1" max="60" required',
      ) +
      field(
        "Primeira fatura (confira no cartão)",
        "firstStatement",
        "month",
        F.addMonths(today(), shift).slice(0, 7),
        'required min="1900-01" max="2199-12"',
      ) +
      help(
        "O valor é dividido em centavos exatos. O orçamento distribui as parcelas entre competências a partir da compra. A data da primeira fatura é explícita; confira feriados e a regra do seu cartão.",
      );
  } else if (kind === "statement") {
    const card = row("cards"),
      left = state.entries
        .filter((e) => e.cardId === id && e.statementMonth === month)
        .reduce((n, e) => n + F.outstanding(state, e), 0);
    title = "Pagar fatura · " + card.name;
    html =
      help("Fatura " + month + " · Pendente: " + money(left)) +
      amountField("Valor a pagar (R$)", "amount", left) +
      dateField("Data efetiva", "date") +
      accountSelect("Conta utilizada", card.accountId) +
      help(
        "O pagamento liquida as compras desta fatura, sem criar outra despesa. Juros e encargos devem ser cadastrados como lançamentos separados.",
      );
  } else if (kind === "budget") {
    title = "Orçamento por competência";
    html =
      field(
        "Mês a partir do qual vale",
        "month",
        "month",
        month,
        'required min="1900-01" max="2199-12"',
      ) +
      categorySelect() +
      amountField("Limite mensal (R$)", "amount") +
      help(
        "O limite fica registrado no mês escolhido. Meses anteriores mantêm seus limites. Um novo ajuste posterior substitui este valor apenas a partir daquele mês.",
      );
  } else if (kind === "reserve") {
    title = "Reserva do mês";
    html =
      field(
        "Mês a partir do qual vale",
        "month",
        "month",
        month,
        'required min="1900-01" max="2199-12"',
      ) +
      amountField(
        "Valor separado (R$)",
        "amount",
        F.monthlyPlan(state.reserves, month),
      ) +
      help(
        "Não inclua aqui os valores que já separou em metas, para não descontar o mesmo dinheiro duas vezes.",
      );
  } else if (kind === "goal") {
    const g = row("goals");
    title = g ? "Editar objetivo" : "Novo objetivo";
    html =
      field(
        "Objetivo",
        "name",
        "text",
        g?.name || "",
        'required maxlength="60"',
      ) +
      amountField("Valor da meta (R$)", "target", g?.target || "") +
      amountField(
        "Valor já separado dentro das contas (R$)",
        "allocated",
        g?.allocated ?? 0,
      ) +
      dateField(
        "Data desejada",
        "dueDate",
        g?.dueDate || F.addMonths(today(), 6),
      ) +
      (g
        ? '<button type="button" class="text-link danger" data-action="delete-goal" data-id="' +
          g.id +
          '">Excluir meta</button>'
        : "") +
      help(
        "A separação é virtual: não cria um depósito, uma conta ou um investimento.",
      );
  } else if (kind === "recurrence") {
    title = "Nova recorrência mensal";
    html =
      field(
        "Descrição",
        "description",
        "text",
        "",
        'maxlength="100" required',
      ) +
      select(
        "Tipo",
        "type",
        [
          ["expense", "Despesa"],
          ["income", "Receita"],
        ],
        "expense",
      ) +
      amountField("Valor por mês (R$)", "amount") +
      categorySelect() +
      accountSelect() +
      field(
        "Dia de vencimento",
        "day",
        "number",
        "10",
        'min="1" max="31" required',
      ) +
      field(
        "Primeiro mês",
        "start",
        "month",
        month,
        'required min="1900-01" max="2199-12"',
      ) +
      field(
        "Último mês (opcional)",
        "end",
        "month",
        "",
        'min="1900-01" max="2199-12"',
      );
  } else if (kind === "asset") {
    const a = row("assets");
    title = a ? "Editar ativo" : "Novo ativo";
    html =
      field(
        "Código / identificação",
        "symbol",
        "text",
        a?.symbol || "",
        'required maxlength="20"',
      ) +
      field("Nome", "name", "text", a?.name || "", 'required maxlength="80"') +
      select(
        "Classe",
        "kind",
        [
          ["stock", "Ação"],
          ["fii", "Fundo imobiliário"],
          ["fixed", "Renda fixa"],
          ["fund", "Fundo"],
          ["other", "Outro"],
        ],
        a?.kind || "stock",
      ) +
      help(
        "Cadastre o ativo primeiro. Depois registre compras, vendas, custos, eventos e rendimentos. Para renda fixa, use a identificação do título; preços e valores de resgate podem ser informados manualmente.",
      );
  } else if (kind === "trade") {
    title = "Operação da carteira";
    html =
      assetSelect() +
      select(
        "Operação",
        "side",
        [
          ["buy", "Compra / aplicação"],
          ["sell", "Venda / resgate"],
          ["split", "Desdobramento / grupamento"],
        ],
        "buy",
      ) +
      field(
        "Quantidade (ou fator do evento)",
        "quantity",
        "text",
        "",
        'required inputmode="decimal"',
      ) +
      amountField("Preço unitário (R$; evento: 0)", "price") +
      amountField("Custos e taxas (R$)", "fees", 0) +
      dateField("Data efetiva", "date") +
      accountSelect("Conta de liquidação") +
      help(
        "Quantidade aceita até 6 casas decimais. Para evento, use o fator (2 duplica; 0,5 reduz à metade). Custos de evento devem ser zero. Resgates parciais reduzem o custo médio proporcionalmente. Não inclui IR automático.",
      );
  } else if (kind === "dividend") {
    title = "Rendimento / provento";
    html =
      assetSelect() +
      amountField("Valor líquido informado (R$)", "amount") +
      dateField("Data prevista / efetiva", "date") +
      select(
        "Situação",
        "status",
        [
          ["announced", "Anunciado / previsto"],
          ["received", "Já recebido"],
        ],
        "announced",
      ) +
      accountSelect("Conta de recebimento") +
      help(
        "Somente rendimentos recebidos entram no caixa. O valor informado deve refletir o que você espera receber ou recebeu.",
      );
  } else if (kind === "price") {
    title = "Atualizar preço manual";
    html =
      assetSelect(id) +
      amountField("Preço unitário (R$)", "price") +
      dateField("Data da cotação", "date") +
      field(
        "Fonte consultada",
        "source",
        "text",
        "Manual",
        'required maxlength="160"',
      ) +
      help(
        "Um preço manual é uma referência informada por você, sem garantia de tempo real. Para preços de renda fixa, confirme a unidade usada no cadastro.",
      );
  } else if (kind === "snapshot") {
    title = "Referência global da carteira";
    html =
      amountField("Valor total informado (R$)", "amount") +
      dateField("Data de referência", "date") +
      field(
        "Fonte",
        "source",
        "text",
        "Informe da corretora",
        'required maxlength="160"',
      ) +
      help(
        "O total fica como referência separada, sem somar novamente às posições por ativo.",
      );
  } else if (kind === "watch") {
    title = "Adicionar acompanhamento";
    html =
      field("Código", "symbol", "text", "", 'required maxlength="20"') +
      select(
        "Classe",
        "kind",
        [
          ["stock", "Ação"],
          ["fii", "FII"],
          ["index", "Índice"],
          ["currency", "Moeda"],
          ["other", "Outro"],
        ],
        "stock",
      );
  } else if (kind === "name") {
    title = "Como quer ser chamado?";
    html = field("Nome", "name", "text", state.name, 'required maxlength="40"');
  } else if (kind === "change-password") {
    title = "Trocar senha do cofre";
    submit = "Criptografar com nova senha";
    html =
      field(
        "Senha atual",
        "current",
        "password",
        "",
        'required minlength="12" maxlength="256" autocomplete="current-password"',
      ) +
      field(
        "Nova senha",
        "password",
        "password",
        "",
        'required minlength="12" maxlength="256" autocomplete="new-password"',
      ) +
      field(
        "Repita a nova senha",
        "confirmation",
        "password",
        "",
        'required minlength="12" maxlength="256" autocomplete="new-password"',
      ) +
      help(
        "A troca recriptografa os dados locais. Backups antigos continuam exigindo a senha com que foram criados. A cópia automática anterior é renovada na próxima gravação.",
      );
  } else if (kind === "restore" || kind === "verify-backup") {
    title =
      kind === "restore" ? "Restaurar backup" : "Testar arquivo de backup";
    submit = kind === "restore" ? "Conferir e restaurar" : "Verificar arquivo";
    html =
      help(esc(importSession?.name || "Arquivo selecionado")) +
      field(
        "Senha do arquivo (se criptografado)",
        "password",
        "password",
        "",
        'maxlength="256" autocomplete="current-password"',
      ) +
      help(
        kind === "restore"
          ? "O arquivo será validado antes da substituição. Você verá os totais e confirmará a operação. O estado atual fica disponível na cópia automática anterior."
          : "O arquivo será descriptografado e validado sem substituir seus dados. A verificação confirma que este arquivo pode ser lido com a senha informada.",
      );
  } else if (kind === "import") {
    title = "Importar extrato";
    submit = "Selecionar arquivo";
    html =
      accountSelect("Conta à qual o extrato pertence") +
      categorySelect() +
      select(
        "Codificação do arquivo",
        "encoding",
        [
          ["utf-8", "UTF-8"],
          ["windows-1252", "Windows / ANSI"],
        ],
        "utf-8",
      ) +
      help(
        "CSV ou OFX até 5 MiB / 10.000 linhas. A prévia permite excluir linhas e conciliar com compromissos. Não importe pagamentos de cartão como despesas novas se as compras já estão cadastradas.",
      );
  } else if (kind === "import-map") {
    title = "Mapear colunas do CSV";
    submit = "Gerar prévia";
    const parsed = importSession.parsed,
      mapping = suggestMapping(parsed.headers);
    html =
      help(
        "Valores positivos são receitas e negativos são despesas, salvo quando uma coluna de tipo informa receita ou despesa. Se o banco exporta despesas positivas, use a coluna Tipo ou confira e ajuste cada linha na prévia.",
      ) +
      ["description", "date", "amount", "type", "id"]
        .map((k) =>
          select(
            {
              description: "Descrição",
              date: "Data efetiva",
              amount: "Valor com sinal",
              type: "Tipo (opcional)",
              id: "Identificador (opcional)",
            }[k],
            k,
            [[-1, "Não usar"], ...parsed.headers.map((h, i) => [i, h])],
            mapping[k],
          ),
        )
        .join("");
  } else if (kind === "import-preview") {
    title = "Revisar importação";
    submit = "Importar selecionados";
    wide = true;
    html = renderImportPreview();
  } else if (kind === "simulate") {
    title = "Simular renda fixa";
    submit = "Calcular estimativa";
    html =
      amountField("Valor inicial (R$)", "principal") +
      field(
        "Taxa bruta anual fixa (%)",
        "rate",
        "number",
        "",
        'min="0" max="100" step="0.01" required',
      ) +
      field(
        "Prazo em dias corridos",
        "days",
        "number",
        "365",
        'min="1" max="36500" required',
      ) +
      help(
        "Estimativa: principal × (1 + taxa anual)^(dias / 365). Não representa retorno líquido, CDI ou resgate garantido.",
      ) +
      '<output id="simulation-output" class="simulation-output"></output>';
  } else return;
  $("#dialog-title").textContent = title;
  $("#dialog-fields").innerHTML = html;
  $("#dialog-submit").textContent = submit;
  $("#dialog").classList.toggle("wide-dialog", wide);
  $("#dialog-error").hidden = true;
  const form = $("#dialog-form");
  form.dataset.operation = F.uid();
  form.dataset.record = id || F.uid();
  for (const [name, value] of Object.entries(d)) {
    const el = form.elements.namedItem(name);
    if (el) {
      if (
        name === "category" &&
        el instanceof HTMLSelectElement &&
        ![...el.options].some((option) => option.value === value) &&
        F.categoryList(state).some((category) => category.name === value)
      ) {
        el.add(new Option(value + " (arquivada)", value));
      }
      if (el.type === "checkbox") el.checked = !!value;
      else el.value = value;
    }
  }
  dialogReturnFocus = previousFocus;
  $("#dialog").showModal();
  if (kind === "entry" && row("entries")?.cardId) {
    const type = form.elements.namedItem("type");
    type.disabled = true;
    const preservedType = document.createElement("input");
    preservedType.type = "hidden";
    preservedType.name = "type";
    preservedType.value = "expense";
    $("#dialog-fields").append(preservedType);
  }
  const focus = form.querySelector(
    'input:not([type="checkbox"]),select,button',
  );
  focus?.focus();
}
function showError(e) {
  if (!$("#dialog").open) {
    toast(e.message || String(e));
    return;
  }
  const error = $("#dialog-error");
  let field = e.field ? $("#dialog-form").elements.namedItem(e.field) : null;
  if (!(field instanceof HTMLElement)) field = $("#dialog-form :invalid");
  const label = field?.closest("label")?.childNodes[0]?.textContent?.trim();
  error.textContent = (label ? label + ": " : "") + (e.message || String(e));
  error.hidden = false;
  if (field) {
    field.setAttribute("aria-invalid", "true");
    const descriptions = new Set(
      (field.getAttribute("aria-describedby") || "")
        .split(/\s+/)
        .filter(Boolean),
    );
    descriptions.add(error.id);
    field.setAttribute("aria-describedby", [...descriptions].join(" "));
    field.focus();
  } else error.focus();
}
function readForm() {
  const f = $("#dialog-form");
  return Object.fromEntries(new FormData(f).entries());
}
function valueMoney(v, signed = false) {
  const n = F.parseMoney(v, { signed });
  if (n == null) {
    const error = new Error(
      "Informe um valor em reais com até duas casas decimais.",
    );
    const field = [...$("#dialog-form").elements].find(
      (el) => el.inputMode === "decimal" && el.value === String(v),
    );
    error.field = field?.name;
    throw error;
  }
  return n;
}
async function switchDemo() {
  if (transitioning) return;
  transitioning = true;
  const leavingPersonal = slot === "personal";
  const previousKey = key;
  if ($("#dialog").open) stashDialog();
  const personalDrafts = leavingPersonal
    ? [...drafts].filter(([name]) => name.startsWith("personal:"))
    : [];
  for (const [name] of personalDrafts) drafts.delete(name);
  // Clear plaintext UI and session references synchronously, before encryption
  // or database reads can suspend the transition.
  slot = "demo";
  state = F.demo();
  key = null;
  kdf = null;
  undo = null;
  external = false;
  blocked = false;
  pendingLock = false;
  privacyMasked = false;
  clearSpaceControls();
  render();
  let draftWarning = false;
  try {
    if (leavingPersonal) {
      sealedDrafts = null;
      if (personalDrafts.length && previousKey) {
        try {
          sealedDrafts = await seal(personalDrafts, previousKey, "drafts");
        } catch {
          draftWarning = true;
        }
      }
    }
    if (db && !memory) {
      const raw = await loadRaw(db, "demo");
      try {
        const loaded = await decodeRaw(raw);
        if (loaded) state = loaded;
        else {
          try {
            state = await saveSlot(db, "demo", null, state, -1);
          } catch (error) {
            if (!(error instanceof StorageConflict)) throw error;
            state = await decodeRaw(await loadRaw(db, "demo"));
          }
        }
      } catch {
        blocked = true;
        state.revision = safeRevision(raw.head?.revision);
      }
    }
  } catch {
    // The personal vault is already locked even if demo storage is unavailable.
    memory = true;
  } finally {
    try {
      sessionStorage.setItem("mf-space", "demo");
    } catch {
      /* optional preference */
    }
    transitioning = false;
    render();
    if (draftWarning)
      toast(
        "Cofre bloqueado. Os registros salvos foram preservados; não foi possível conservar o rascunho desta sessão.",
      );
  }
  return !draftWarning;
}
function safeRevision(revision) {
  return Number.isSafeInteger(revision) &&
    revision >= 0 &&
    revision < Number.MAX_SAFE_INTEGER - 1
    ? revision
    : 0;
}
function personalStatus(raw) {
  if (!raw.head && !raw.records.length && !raw.journal) return null;
  return {
    ...(raw.head && typeof raw.head === "object" ? raw.head : {}),
    hasCheckpoint: !!raw.journal?.head,
    recovery: !raw.head,
  };
}
function clearSpaceControls() {
  search = "";
  typeFilter = statusFilter = "all";
  scope = "month";
  page = 1;
  historyPages = { transfers: 1, trades: 1, dividends: 1 };
  month = currentMonth();
  view = "inicio";
  importSession = null;
  fileAction = "";
  $("#file-input").value = "";
  $("#toast").textContent = "";
  $("#toast").classList.remove("show");
  history.replaceState(null, "", "#inicio");
}
function maskPersonalInterface() {
  if (slot !== "personal" || privacyMasked) return;
  if ($("#dialog").open) stashDialog();
  privacyMasked = true;
  $("#main").replaceChildren();
  const message = document.createElement("p");
  message.className = "empty";
  message.textContent = "Bloqueando o cofre…";
  $("#main").append(message);
  $("#profile").textContent = "•";
  $("#mode-label").textContent = "Bloqueando cofre…";
  $("#breadcrumb").textContent = "Cofre bloqueado";
  $("#storage-notice").replaceChildren();
  $("#storage-notice").hidden = true;
  $("#undo-notice").hidden = true;
  $("#toast").textContent = "";
  $("#file-input").value = "";
}
async function lockVault() {
  if (slot !== "personal" || transitioning) return;
  if (busy || processing) {
    pendingLock = true;
    maskPersonalInterface();
    return;
  }
  const draftsPreserved = await switchDemo();
  if (draftsPreserved)
    toast("Cofre bloqueado. A demonstração continua aberta.");
}
async function unlock(password, checkpoint = false) {
  const raw = await loadRaw(db, "personal");
  const selected = checkpoint ? previousRaw(raw) : raw;
  if (!selected.head?.encrypted)
    throw new Error(
      "O cofre salvo não pôde ser validado. Use Exportar cofre para recuperação; os registros existentes foram preservados.",
    );
  const nextKey = await deriveKey(password, selected.head.kdf);
  let loaded = await decodeRaw(selected, nextKey);
  if (document.hidden)
    throw new Error("Volte para esta aba para desbloquear o cofre.");
  if (checkpoint) {
    if (
      !confirm(
        `Recuperar ${loaded.accounts.length} conta(s) e ${loaded.entries.length} lançamento(s) da cópia anterior? Isto substitui o estado atual do cofre. Exporte a cópia bruta antes se precisar preservar o estado atual.`,
      )
    )
      return false;
    loaded = await saveSlot(
      db,
      "personal",
      null,
      loaded,
      raw.head == null ? -1 : safeRevision(raw.head.revision),
      {
        key: nextKey,
        kdf: selected.head.kdf,
        force: true,
        notify: (message) => notifyChannel?.postMessage(message),
      },
    );
  }
  const latestRaw = await loadRaw(db, "personal");
  if (latestRaw.head?.revision !== loaded.revision) throw new StorageConflict();
  const latestHead = personalStatus(latestRaw);
  const restoredDrafts = [];
  if (sealedDrafts) {
    try {
      restoredDrafts.push(...(await unseal(sealedDrafts, nextKey, "drafts")));
    } catch {
      /* An old-key draft must never prevent recovery of saved records. */
    }
    sealedDrafts = null;
  }
  clearSpaceControls();
  state = loaded;
  key = nextKey;
  kdf = selected.head.kdf;
  personalHead = latestHead;
  slot = "personal";
  external = false;
  blocked = false;
  undo = null;
  privacyMasked = false;
  for (const [name, value] of restoredDrafts) drafts.set(name, value);
  lastActivity = Date.now();
  try {
    sessionStorage.setItem("mf-space", "personal");
  } catch {
    /* optional preference */
  }
  render();
  return true;
}
async function submitForm(event) {
  event.preventDefault();
  if (busy || processing || transitioning || privacyMasked) return;
  processing = true;
  const f = $("#dialog-form"),
    d = readForm(),
    kind = dialogKind,
    id = dialogId,
    operationId = f.dataset.operation,
    recordId = f.dataset.record;
  $("#dialog-error").hidden = true;
  try {
    validateFormData(kind, d, state, { id, today: today(), month });
    if (kind === "mode") {
      closeDialog();
      if (d.target === "demo") {
        await switchDemo();
        return;
      }
      if (slot === "personal") {
        toast("Seu cofre já está aberto.");
        return;
      }
      if (!db || memory)
        throw new Error(
          "O cofre pessoal precisa do armazenamento do navegador. Use a demonstração e exporte seus testes.",
        );
      personalHead = personalStatus(await loadRaw(db, "personal"));
      openDialog(personalHead ? "unlock" : "create");
      return;
    }
    if (kind === "create") {
      if (d.password !== d.confirmation)
        throw new Error("As senhas não coincidem.");
      setBusy(true);
      const newK = newKdf(),
        newKey = await deriveKey(d.password, newK);
      const fresh = F.emptyState(d.name);
      const saved = await saveSlot(db, "personal", null, fresh, -1, {
        key: newKey,
        kdf: newK,
        operationId,
      });
      clearSpaceControls();
      state = saved;
      slot = "personal";
      key = newKey;
      kdf = newK;
      personalHead = { kdf };
      undo = null;
      external = false;
      blocked = false;
      lastActivity = Date.now();
      closeDialog();
      render();
      toast("Seu cofre foi criado vazio. Adicione sua primeira conta.");
      openDialog("account");
      return;
    }
    if (kind === "unlock") {
      setBusy(true);
      if (!(await unlock(d.password, d.checkpoint === "true"))) return;
      closeDialog();
      render();
      toast("Cofre aberto neste dispositivo.");
      return;
    }
    if (kind === "restore" || kind === "verify-backup") {
      setBusy(true);
      const restored = await readBackup(importSession.text, d.password);
      if (privacyMasked) return;
      if (
        kind === "restore" &&
        slot === "demo" &&
        JSON.parse(importSession.text.replace(/^\uFEFF/, "")).format ===
          "minhas-financas-encrypted"
      )
        throw new Error(
          "Abra seu cofre pessoal antes de restaurar um backup criptografado. A demonstração não tem senha.",
        );
      if (kind === "verify-backup") {
        saveStamp("verified");
        closeDialog();
        render();
        toast(
          "Backup válido: " +
            restored.accounts.length +
            " conta(s) e " +
            restored.entries.length +
            " lançamento(s). Nenhum dado foi substituído.",
        );
        return;
      }
      if (hidden) throw new Error("Mostre os valores antes de restaurar.");
      if (
        !confirm(
          `Restaurar ${restored.accounts.length} conta(s), ${restored.entries.length} lançamento(s) e ${restored.payments.length} pagamento(s)? Isto substitui o espaço ${slot === "personal" ? "pessoal" : "de demonstração"} atual. A cópia anterior será preservada.`,
        )
      )
        return;
      if (
        await commit(
          { ...restored, revision: state.revision },
          "Backup restaurado.",
          { operationId, recovery: true, force: blocked },
        )
      ) {
        closeDialog();
        importSession = null;
        external = false;
        render();
      }
      return;
    }
    if (kind === "import") {
      const encoding = d.encoding;
      importSession = {
        accountId: d.accountId,
        category: d.category,
        encoding,
      };
      closeDialog();
      chooseFile("statement", ".csv,.ofx,text/csv,application/x-ofx");
      return;
    }
    if (kind === "import-map") {
      const map = Object.fromEntries(
        Object.entries(d).map(([k, v]) => [k, Number(v)]),
      );
      importSession.rows = previewCSV(importSession.parsed, map);
      closeDialog();
      openDialog("import-preview");
      return;
    }
    if (kind === "import-preview") {
      assertWritable();
      syncImportControls();
      const next = applyImport(
        state,
        importSession.rows,
        importSession.accountId,
        importSession.category,
      );
      if (
        await commit(next, "Extrato importado e conciliado.", { operationId })
      ) {
        closeDialog();
        importSession = null;
        render();
      }
      return;
    }
    if (kind === "simulate") {
      const principal = valueMoney(d.principal),
        rate = Number(d.rate),
        days = Number(d.days),
        result = principal * Math.pow(1 + rate / 100, days / 365);
      if (!Number.isFinite(result) || result > F.MAX_CENTS)
        throw new Error("Resultado acima do limite permitido.");
      $("#simulation-output").textContent =
        "Estimativa bruta: " +
        currency(Math.round(result)) +
        " · Ganho estimado: " +
        currency(Math.round(result) - principal);
      return;
    }
    assertWritable();
    let next = cloned();
    if (kind === "category") {
      next = id
        ? F.updateCategory(next, id, { name: d.name, archived: !!d.archived })
        : F.addCategory(next, d.name, recordId);
    } else if (kind === "entry") {
      const old = next.entries.find((e) => e.id === id);
      const entry = {
        ...old,
        id: recordId,
        description: d.description,
        type: d.type,
        amount: valueMoney(d.amount),
        dueDate: d.dueDate,
        competence: d.competence,
        category: d.category,
        accountId: d.accountId,
        cardId: old?.cardId || null,
        origin: old?.origin || "Manual",
        assumedDate: false,
      };
      if (old)
        next.entries = next.entries.map((e) => (e.id === id ? entry : e));
      else next.entries.push(entry);
      if (!old && d.paid)
        next.payments.push({
          id: "pay_" + recordId,
          entryId: recordId,
          amount: entry.amount,
          date: d.paymentDate,
          accountId: entry.accountId,
        });
    } else if (kind === "payment")
      next = F.settle(
        next,
        id,
        valueMoney(d.amount),
        d.date,
        d.accountId,
        recordId,
      );
    else if (kind === "account") {
      const a = {
        id: recordId,
        name: d.name,
        kind: d.kind,
        opening: valueMoney(d.opening, true),
        openingDate: d.openingDate,
        archived: !!d.archived,
      };
      next.accounts = id
        ? next.accounts.map((x) => (x.id === id ? a : x))
        : [...next.accounts, a];
    } else if (kind === "transfer")
      next.transfers.push({
        id: recordId,
        fromId: d.fromId,
        toId: d.toId,
        amount: valueMoney(d.amount),
        date: d.date,
      });
    else if (kind === "card") {
      const card = {
        id: recordId,
        name: d.name,
        limit: valueMoney(d.limit),
        closingDay: Number(d.closingDay),
        dueDay: Number(d.dueDay),
        accountId: d.accountId,
      };
      next.cards = id
        ? next.cards.map((c) => (c.id === id ? card : c))
        : [...next.cards, card];
    } else if (kind === "purchase") {
      if (d.date > today())
        throw new Error("Uma compra realizada não pode ter data futura.");
      next = F.purchase(next, {
        cardId: id,
        description: d.description,
        category: d.category,
        amount: valueMoney(d.amount),
        date: d.date,
        installments: Number(d.installments),
        firstStatement: d.firstStatement,
      });
    } else if (kind === "statement")
      next = F.payStatement(
        next,
        id,
        month,
        valueMoney(d.amount),
        d.date,
        d.accountId,
      );
    else if (kind === "budget") {
      const existing = next.budgets.find(
          (b) => b.month === d.month && b.category === d.category,
        ),
        row = {
          id: existing?.id || recordId,
          month: d.month,
          category: d.category,
          amount: valueMoney(d.amount),
        };
      next.budgets = existing
        ? next.budgets.map((b) => (b.id === existing.id ? row : b))
        : [...next.budgets, row];
    } else if (kind === "reserve") {
      const existing = next.reserves.find((r) => r.month === d.month),
        row = {
          id: existing?.id || recordId,
          month: d.month,
          amount: valueMoney(d.amount),
        };
      next.reserves = existing
        ? next.reserves.map((r) => (r.id === existing.id ? row : r))
        : [...next.reserves, row];
    } else if (kind === "goal") {
      const goal = {
        id: recordId,
        name: d.name,
        target: valueMoney(d.target),
        allocated: valueMoney(d.allocated),
        dueDate: d.dueDate,
      };
      next.goals = id
        ? next.goals.map((g) => (g.id === id ? goal : g))
        : [...next.goals, goal];
    } else if (kind === "recurrence") {
      if (d.end && d.end < d.start)
        throw new Error("O último mês deve ser posterior ao primeiro.");
      next.recurrences.push({
        id: recordId,
        description: d.description,
        type: d.type,
        category: d.category,
        amount: valueMoney(d.amount),
        accountId: d.accountId,
        day: Number(d.day),
        start: d.start,
        end: d.end,
        active: true,
      });
    } else if (kind === "asset") {
      const old = next.assets.find((a) => a.id === id),
        asset = {
          ...old,
          id: recordId,
          symbol: d.symbol,
          name: d.name,
          kind: d.kind,
          manualPrice: old?.manualPrice ?? null,
          priceDate: old?.priceDate || "",
          source: old?.source || "Manual",
        };
      if (
        next.assets.some(
          (a) =>
            a.id !== id && a.symbol.toUpperCase() === d.symbol.toUpperCase(),
        )
      )
        throw new Error("Este código já está cadastrado.");
      next.assets = id
        ? next.assets.map((a) => (a.id === id ? asset : a))
        : [...next.assets, asset];
    } else if (kind === "trade") {
      const quantity = F.units(d.quantity);
      if (!quantity)
        throw new Error("Quantidade inválida. Use até 6 casas decimais.");
      const price = valueMoney(d.price),
        fees = valueMoney(d.fees);
      if (d.side === "split" && (price !== 0 || fees !== 0))
        throw new Error("Evento usa preço e custos iguais a zero.");
      next.trades.push({
        id: recordId,
        assetId: d.assetId,
        accountId: d.accountId,
        side: d.side,
        quantity,
        price,
        fees,
        date: d.date,
      });
    } else if (kind === "dividend")
      next.dividends.push({
        id: recordId,
        assetId: d.assetId,
        accountId: d.accountId,
        amount: valueMoney(d.amount),
        date: d.date,
        status: d.status,
      });
    else if (kind === "price") {
      if (d.date > today()) throw new Error("Cotação futura não é válida.");
      const amount = valueMoney(d.price);
      next.prices.push({
        id: recordId,
        assetId: d.assetId,
        amount,
        date: d.date,
        source: d.source,
      });
      next.assets = next.assets.map((a) =>
        a.id === d.assetId
          ? { ...a, manualPrice: amount, priceDate: d.date, source: d.source }
          : a,
      );
    } else if (kind === "snapshot") {
      if (d.date > today()) throw new Error("Posição futura não é válida.");
      next.snapshots.push({
        id: recordId,
        amount: valueMoney(d.amount),
        date: d.date,
        source: d.source,
      });
    } else if (kind === "watch") {
      if (
        next.watchlist.some(
          (w) => w.symbol.toUpperCase() === d.symbol.toUpperCase(),
        )
      )
        throw new Error("Código já está na lista.");
      next.watchlist.push({ id: recordId, symbol: d.symbol, kind: d.kind });
    } else if (kind === "name") next.name = d.name;
    else if (kind === "change-password") {
      if (d.password !== d.confirmation)
        throw new Error("As novas senhas não coincidem.");
      const raw = await loadRaw(db, "personal");
      const oldKey = await deriveKey(d.current, raw.head.kdf);
      await decodeRaw(raw, oldKey);
      const newK = newKdf(),
        newKey = await deriveKey(d.password, newK);
      if (
        await commit(
          next,
          "Senha alterada. Backups antigos mantêm a senha antiga.",
          { operationId, force: true, nextKey: newKey, nextKdf: newK },
        )
      ) {
        sealedDrafts = null;
        closeDialog();
        render();
      }
      return;
    }
    const previousCategories =
      kind === "category" ? F.categoryList(state) : null;
    if (await commit(next, "Alteração salva.", { operationId })) {
      if (previousCategories) updateCategoryDrafts(previousCategories);
      closeDialog();
      render();
    }
  } catch (e) {
    showError(e);
  } finally {
    processing = false;
    setBusy(false);
    if (pendingLock) {
      pendingLock = false;
      await lockVault();
    }
  }
}
function renderImportPreview() {
  const planned = planImport(
      state,
      importSession.rows,
      importSession.accountId,
    ),
    p = importSession.page || 1,
    start = (p - 1) * 100;
  const paidByEntry = new Map();
  for (const payment of state.payments)
    paidByEntry.set(
      payment.entryId,
      (paidByEntry.get(payment.entryId) || 0) + payment.amount,
    );
  return (
    help(
      "Confira tipo, descrição, valor e data. Conciliar registra o pagamento de um compromisso existente, preservando vencimento e competência. Transferências e pagamentos de fatura precisam ser excluídos ou conciliados para evitar duplicação. A prévia mostra até 100 linhas por página. Sem identificador bancário, a comparação é por conteúdo e quantidade: linhas iguais podem ser movimentos distintos. Desmarque apenas as que não devem entrar. Linhas já identificadas como duplicadas ou inválidas não são importadas.",
    ) +
    `<div class="notice">${planned.length} linha(s) · ${planned.filter((r) => r.duplicate).length} duplicada(s) · ${planned.filter((r) => r.error).length} inválida(s)</div><div class="table-wrap import-table"><table><thead><tr><th>Usar</th><th>Movimento</th><th>Tipo</th><th>Valor</th><th>Conciliar com</th></tr></thead><tbody>${planned
      .slice(start, start + 100)
      .map((r, offset) => {
        const i = start + offset;
        const candidates = r.error
          ? []
          : state.entries.filter(
              (e) =>
                e.type === r.type &&
                e.amount - (paidByEntry.get(e.id) || 0) >= r.amount,
            );
        return `<tr><td><input type="checkbox" data-import-line="${i}" aria-label="Importar linha ${r.line}" ${r.error || r.duplicate || r.exclude ? "" : "checked"} ${r.error || r.duplicate ? "disabled" : ""}></td><td>${r.error ? '<span class="negative">Linha ' + r.line + ": " + esc(r.error) + "</span>" : `<b>${esc(r.description)}</b><small>${esc(r.date)}${r.duplicate ? " · Duplicada" : ""}</small>`}</td><td>${
          r.error
            ? "—"
            : `<select data-import-type="${i}" aria-label="Tipo da linha ${r.line}">${options(
                [
                  ["income", "Receita"],
                  ["expense", "Despesa"],
                ],
                r.type,
              )}</select>`
        }</td><td>${r.error ? "—" : money(r.amount)}</td><td>${r.error || r.duplicate ? "—" : `<select data-reconcile-line="${i}" aria-label="Conciliar linha ${r.line}">${options([["", "Criar novo lançamento"], ...candidates.map((e) => [e.id, e.description + " · " + e.dueDate])], r.reconcileId || "")}</select>`}</td></tr>`;
      })
      .join(
        "",
      )}</tbody></table></div><div class="pagination"><button type="button" class="secondary" data-action="import-prev" ${p === 1 ? "disabled" : ""}>← Anterior</button><span>Página ${p} de ${Math.max(1, Math.ceil(planned.length / 100))}</span><button type="button" class="secondary" data-action="import-next" ${p * 100 >= planned.length ? "disabled" : ""}>Próxima →</button></div>`
  );
}
function syncImportControls() {
  for (const input of document.querySelectorAll("[data-import-line]"))
    importSession.rows[Number(input.dataset.importLine)].exclude =
      !input.checked;
  for (const select of document.querySelectorAll("[data-reconcile-line]"))
    importSession.rows[Number(select.dataset.reconcileLine)].reconcileId =
      select.value;
}
function chooseFile(action, accept) {
  fileAction = action;
  $("#file-input").accept = accept;
  $("#file-input").value = "";
  $("#file-input").click();
}
async function handleFile() {
  const file = $("#file-input").files[0];
  if (!file) return;
  if (busy || processing || transitioning || privacyMasked) {
    $("#file-input").value = "";
    toast("Aguarde a operação terminar antes de selecionar um arquivo.");
    return;
  }
  processing = true;
  setBusy(true);
  try {
    if (
      file.size >
      (["restore", "verify-backup"].includes(fileAction)
        ? MAX_ENCRYPTED_BYTES
        : IMPORT_LIMIT)
    )
      throw new Error("Arquivo acima do limite permitido.");
    if (fileAction === "restore" || fileAction === "verify-backup") {
      importSession = { text: await file.text(), name: file.name };
      if (privacyMasked) return;
      openDialog(fileAction);
      return;
    }
    const text = new TextDecoder(importSession?.encoding || "utf-8", {
      fatal: true,
    }).decode(await file.arrayBuffer());
    if (privacyMasked) return;
    if (fileAction === "prices") {
      const parsed = parseCSV(text),
        headers = parsed.headers.map((h) => h.toLowerCase().trim()),
        si = headers.findIndex((h) =>
          ["ativo", "codigo", "symbol"].includes(h),
        ),
        pi = headers.findIndex((h) => ["preco", "preço", "price"].includes(h)),
        di = headers.findIndex((h) => ["data", "date"].includes(h));
      if (si < 0 || pi < 0 || di < 0)
        throw new Error("Use colunas: ativo;preco;data (AAAA-MM-DD).");
      let next = cloned(),
        count = 0;
      for (const row of parsed.rows) {
        const a = next.assets.find(
          (a) => a.symbol === String(row[si]).toUpperCase(),
        );
        if (!a) throw new Error("Ativo não cadastrado: " + row[si]);
        if (!F.validDate(row[di]) || row[di] > today())
          throw new Error("Data de preço inválida.");
        a.manualPrice = valueMoney(row[pi]);
        a.priceDate = row[di];
        a.source = "CSV informado pelo usuário";
        next.prices.push({
          id: F.uid(),
          assetId: a.id,
          amount: a.manualPrice,
          date: a.priceDate,
          source: a.source,
        });
        count++;
      }
      if (confirm(`Atualizar ${count} preço(s) com os valores do arquivo?`)) {
        await commit(next, "Preços atualizados.");
        render();
      }
      return;
    }
    importSession.name = file.name;
    if (/\.ofx$/i.test(file.name) || /<OFX>/i.test(text)) {
      importSession.rows = previewOFX(text);
      openDialog("import-preview");
    } else {
      importSession.parsed = parseCSV(text);
      openDialog("import-map");
    }
  } catch (e) {
    toast(e.message);
  } finally {
    $("#file-input").value = "";
    processing = false;
    setBusy(false);
    if (pendingLock) {
      pendingLock = false;
      await lockVault();
    }
  }
}
function download(content, type, name) {
  const url = URL.createObjectURL(new Blob([content], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function backup() {
  if (blocked)
    throw new Error(
      "Use Exportar dados brutos para preservar o registro com erro.",
    );
  const content =
    slot === "personal"
      ? await backupWithKey(state, key, kdf)
      : F.serializeBackup(state);
  download(
    content,
    "application/json",
    `minhas-financas-${slot}-${today()}.${slot === "personal" ? "mfbackup" : "json"}`,
  );
  saveStamp("backup");
  render();
  toast(
    "Download solicitado. Guarde o arquivo fora do navegador e teste a restauração.",
  );
}
async function deletion(collection, id, message, related = false) {
  assertWritable();
  if (!confirm(message)) return;
  const before = cloned(),
    next = cloned();
  next[collection] = next[collection].filter((x) => x.id !== id);
  if (collection === "assets")
    next.prices = next.prices.filter((p) => p.assetId !== id);
  if (related) next.payments = next.payments.filter((p) => p.entryId !== id);
  if (await commit(next, "Registro excluído.")) {
    undo = { state: before, revision: state.revision };
    if ($("#dialog").open) closeDialog();
    render();
  }
}
function detailEntry(id) {
  const e = state.entries.find((e) => e.id === id);
  if (!e) return;
  dialogReturnFocus = rememberFocus();
  dialogKind = "detail";
  dialogId = id;
  $("#dialog-title").textContent = e.description;
  $("#dialog-fields").innerHTML =
    help(
      "Vencimento: " +
        esc(e.dueDate) +
        " · Competência: " +
        e.competence +
        " · Valor: " +
        money(e.amount),
    ) +
    (state.payments
      .filter((p) => p.entryId === id)
      .map(
        (p) =>
          `<div class="list-row"><div><b>${money(p.amount)}</b><small>${p.date} · ${esc(state.accounts.find((a) => a.id === p.accountId)?.name)}</small></div><button class="text-link danger" type="button" data-action="delete-payment" data-id="${p.id}">Excluir pagamento</button></div>`,
      )
      .join("") || help("Nenhum pagamento.")) +
    help("Saldo pendente: " + money(F.outstanding(state, e)));
  $("#dialog-submit").hidden = true;
  $("#dialog").classList.remove("wide-dialog");
  $("#dialog-error").hidden = true;
  $("#dialog").showModal();
}
async function action(name, id, element) {
  if (name === "lock") {
    await lockVault();
    return;
  }
  if (busy || processing || transitioning || privacyMasked) {
    toast("Aguarde a operação terminar.");
    return;
  }
  processing = true;
  setBusy(true);
  try {
    if (
      [
        "entry",
        "category",
        "account",
        "transfer",
        "card",
        "purchase",
        "payment",
        "statement",
        "budget",
        "reserve",
        "goal",
        "recurrence",
        "asset",
        "trade",
        "dividend",
        "price",
        "snapshot",
        "watch",
        "name",
        "mode",
        "change-password",
        "simulate",
        "import",
      ].includes(name)
    ) {
      openDialog(name, id);
      return;
    }
    if (name === "personal") {
      openDialog("mode", "", { target: "personal" });
      return;
    }
    if (name === "unlock-checkpoint") {
      openDialog("unlock", "", { checkpoint: "true" });
      return;
    }
    if (name === "personal-raw-export") {
      if (!db) throw new Error("O armazenamento não está disponível.");
      const raw = await loadRaw(db, "personal");
      download(
        JSON.stringify({
          format: "minhas-financas-raw-recovery",
          version: 1,
          slot: "personal",
          raw,
        }),
        "application/json",
        "minhas-financas-cofre-recuperacao.json",
      );
      toast(
        "Cópia bruta do cofre solicitada. Guarde-a antes de tentar a recuperação.",
      );
      return;
    }
    if (name === "entry-detail") {
      detailEntry(id);
      return;
    }
    if (name === "delete-entry") {
      await deletion(
        "entries",
        id,
        "Excluir este compromisso e todos os seus pagamentos? O saldo será recalculado.",
        true,
      );
      return;
    }
    const deleteMap = {
      "delete-payment": "payments",
      "delete-transfer": "transfers",
      "delete-goal": "goals",
      "delete-trade": "trades",
      "delete-dividend": "dividends",
      "delete-watch": "watchlist",
      "delete-asset": "assets",
    };
    if (Object.hasOwn(deleteMap, name)) {
      if (
        name === "delete-asset" &&
        (state.trades.some((t) => t.assetId === id) ||
          state.dividends.some((t) => t.assetId === id))
      )
        throw new Error(
          "Remova ou corrija as operações e rendimentos deste ativo antes de excluí-lo.",
        );
      await deletion(
        deleteMap[name],
        id,
        "Excluir este registro? Saldos e posições serão recalculados.",
      );
      return;
    }
    if (name === "undo") {
      if (!undo || undo.revision !== state.revision)
        throw new Error(
          "A exclusão já foi seguida por outra alteração. Use a cópia anterior em Configurações.",
        );
      if (
        await commit(
          { ...undo.state, revision: state.revision },
          "Exclusão desfeita.",
        )
      ) {
        undo = null;
        render();
      }
      return;
    }
    if (name === "import-prev" || name === "import-next") {
      syncImportControls();
      importSession.page = Math.max(
        1,
        (importSession.page || 1) + (name === "import-next" ? 1 : -1),
      );
      openDialog("import-preview");
      return;
    }
    if (name === "history-page") {
      const collection = element.dataset.history;
      const target = Number(element.dataset.page);
      if (!["transfers", "trades", "dividends"].includes(collection) || !Number.isSafeInteger(target) || target < 1) return;
      historyPages[collection] = target;
      const focusId = element.id;
      render();
      const control = document.getElementById(focusId);
      const focus = control && !control.disabled ? control : document.getElementById(`history-${collection}-status`);
      focus?.focus({ preventScroll: true });
      ensureFocusVisible(focus);
      return;
    }
    if (name === "prev-page" || name === "next-page") {
      page = Math.max(1, page + (name === "next-page" ? 1 : -1));
      renderLedger();
      return;
    }
    if (name === "toggle-category") {
      assertWritable();
      const category = F.categoryList(state).find((item) => item.id === id);
      if (!category) throw new Error("Categoria não encontrada.");
      const next = F.updateCategory(state, id, {
        archived: !category.archived,
      });
      await commit(
        next,
        category.archived
          ? "Categoria reativada."
          : "Categoria arquivada. O histórico foi preservado.",
      );
      render();
      return;
    }
    if (name === "toggle-recurrence") {
      const next = cloned();
      next.recurrences = next.recurrences.map((r) =>
        r.id === id ? { ...r, active: !r.active } : r,
      );
      await commit(next, "Recorrência atualizada.");
      render();
      return;
    }
    if (name === "generate") {
      const next = F.generateRecurrences(state, month),
        count = next.entries.length - state.entries.length;
      if (!count) {
        toast("Não há novas previsões para gerar neste mês.");
        return;
      }
      await commit(next, count + " previsão(ões) criada(s).");
      render();
      return;
    }
    if (name === "receive-dividend") {
      const next = cloned(),
        d = next.dividends.find((d) => d.id === id);
      if (d.date > today())
        throw new Error(
          "A data prevista é futura. Registre um rendimento com a data efetiva.",
        );
      d.status = "received";
      await commit(next, "Recebimento registrado no caixa.");
      render();
      return;
    }
    if (name === "backup") {
      await backup();
      return;
    }
    if (name === "restore" || name === "verify-backup") {
      chooseFile(name, ".json,.mfbackup,application/json");
      return;
    }
    if (name === "csv" || name === "payments-csv") {
      if (
        !confirm(
          "O CSV contém dados legíveis, mesmo quando os valores estão ocultos. Exportar?",
        )
      )
        return;
      let csv = F.ledgerCSV(state, month);
      if (name === "payments-csv") {
        const rows = [
          ["Descrição", "Data efetiva", "Tipo", "Valor (R$)", "Conta"],
          ...state.payments
            .filter((p) => p.date.startsWith(month))
            .map((p) => {
              const e = state.entries.find((e) => e.id === p.entryId);
              return [
                e.description,
                p.date,
                e.type,
                (p.amount / 100).toFixed(2).replace(".", ","),
                state.accounts.find((a) => a.id === p.accountId)?.name,
              ];
            }),
        ];
        csv =
          "\uFEFF" + rows.map((r) => r.map(F.csvCell).join(";")).join("\r\n");
      }
      download(csv, "text/csv;charset=utf-8", `financas-${name}-${month}.csv`);
      toast("CSV solicitado.");
      return;
    }
    if (name === "prices-import") {
      if (!state.assets.length)
        throw new Error("Cadastre os ativos antes de importar preços.");
      importSession = { encoding: "utf-8" };
      chooseFile("prices", ".csv,text/csv");
      return;
    }
    if (name === "persist") {
      const granted = await requestPersistence();
      stats = await storageInfo();
      render();
      toast(
        granted
          ? "Persistência concedida pelo navegador. Mantenha seus backups."
          : "O navegador não concedeu persistência. Os dados continuam locais; mantenha backups.",
      );
      return;
    }
    if (name === "checkpoint") {
      if (!db) throw new Error("Nenhuma cópia persistente disponível.");
      const raw = await loadRaw(db, slot),
        previous = await decodeRaw(previousRaw(raw), key);
      if (
        confirm(
          `Recuperar a versão anterior com ${previous.entries.length} lançamento(s)? A versão atual se tornará a nova cópia anterior.`,
        )
      ) {
        await commit(
          { ...previous, revision: state.revision },
          "Versão anterior recuperada.",
          { recovery: true, force: blocked },
        );
        render();
      }
      return;
    }
    if (name === "reload") {
      if (busy) return;
      if (!db || memory)
        throw new Error(
          "Não há cópia persistente disponível nesta sessão. Exporte seus dados antes de sair.",
        );
      if (
        drafts.size &&
        !confirm(
          "Recarregar os registros salvos? Os rascunhos desta sessão continuam disponíveis.",
        )
      )
        return;
      const raw = await loadRaw(db, slot);
      const loaded = await decodeRaw(raw, key);
      if (!loaded) throw new Error("Nenhum registro salvo para este espaço.");
      state = loaded;
      external = false;
      blocked = false;
      undo = null;
      render();
      toast("Dados recarregados.");
      return;
    }
    if (name === "reset-demo") {
      if (!confirm("Reiniciar somente os dados fictícios da demonstração?"))
        return;
      await commit(
        { ...F.demo(), revision: state.revision },
        "Demonstração reiniciada.",
      );
      undo = null;
      render();
      return;
    }
    if (name === "migrate") {
      if (slot !== "personal") {
        toast(
          "Crie ou abra o cofre pessoal primeiro. Depois use Migrar dados antigos em Configurações.",
        );
        openDialog("mode", "", { target: "personal" });
        return;
      }
      const migrated = F.migrate(legacy);
      if (
        !confirm(
          `Migrar ${migrated.entries.length} lançamento(s) antigos para o cofre? Isto substitui o conteúdo pessoal atual. A cópia antiga sem senha será removida após a gravação criptografada. Confira se há exemplos entre os registros.`,
        )
      )
        return;
      await commit(
        { ...migrated, revision: state.revision },
        "Dados antigos migrados. Confira as notas em Configurações.",
        { removeLegacy: true },
      );
      render();
      return;
    }
    if (name === "legacy-export") {
      download(
        JSON.stringify(legacy),
        "application/json",
        "financas-versao-anterior.json",
      );
      toast("Cópia antiga solicitada. Ela não é criptografada.");
      return;
    }
    if (name === "legacy-delete") {
      if (
        !confirm(
          "Remover a cópia antiga sem senha? Faça o backup ou a migração antes.",
        )
      )
        return;
      await new Promise((resolve, reject) => {
        const tx = db.transaction("data", "readwrite");
        tx.objectStore("data").delete("state");
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
      });
      legacy = null;
      render();
      return;
    }
    if (name === "raw-export") {
      const raw = await loadRaw(db, slot);
      download(
        JSON.stringify({ slot, raw, legacy }),
        "application/json",
        "financas-recuperacao-bruta.json",
      );
      toast(
        "Cópia bruta para recuperação solicitada. Dados antigos podem estar sem senha.",
      );
      return;
    }
    if (name === "refresh-market" || name === "samples") {
      await updateMarket(() => {
        if (["inicio", "mercado"].includes(view) && !$("#dialog").open)
          render();
      }, name === "samples");
      return;
    }
    if (name === "print") {
      if (hidden)
        throw new Error("Mostre os valores antes de gerar o relatório.");
      if (view !== "relatorios") {
        view = "relatorios";
        history.replaceState(null, "", "#relatorios");
        render();
      }
      window.print();
      return;
    }
    if (name === "install") {
      if (installPrompt) {
        await installPrompt.prompt();
        installPrompt = null;
      } else
        toast(
          "Use o menu do navegador: Instalar app ou Adicionar à tela inicial. A disponibilidade depende do navegador.",
        );
      return;
    }
    if (name === "check-update") {
      await swRegistration?.update();
      toast(
        swRegistration
          ? "Verificação solicitada. Uma atualização disponível aparecerá no aviso."
          : "O recurso offline ainda não está disponível neste navegador.",
      );
      return;
    }
    if (name === "apply-update") {
      if (busy) {
        toast("Aguarde a gravação terminar.");
        return;
      }
      if (drafts.size || $("#dialog").open) {
        toast(
          "Conclua ou guarde seus rascunhos antes de recarregar a atualização.",
        );
        return;
      }
      if (memory && state.revision > 0)
        throw new Error("Faça um backup da sessão antes de atualizar.");
      updateRequested = true;
      waitingWorker?.postMessage({ type: "ACTIVATE" });
      return;
    }
  } catch (e) {
    toast(e.message || "Não foi possível concluir.");
  } finally {
    processing = false;
    setBusy(false);
    if (pendingLock) {
      pendingLock = false;
      await lockVault();
    }
  }
}
$("#dialog-form").addEventListener("submit", submitForm);
$("#dialog").addEventListener("cancel", (e) => {
  e.preventDefault();
  if (busy || processing) return;
  stashDialog();
  toast("Diálogo fechado. Rascunhos de edição ficam nesta sessão.");
});
$("#close-dialog").addEventListener("click", () => {
  if (busy || processing) {
    toast("Aguarde a operação terminar.");
    return;
  }
  stashDialog();
  $("#dialog-submit").hidden = false;
});
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-action],[data-view]");
  if (!b || b.disabled) return;
  if (b.dataset.view) {
    navigate(b.dataset.view);
    return;
  }
  await action(b.dataset.action, b.dataset.id || "", b);
});
document.addEventListener("input", (e) => {
  if (e.target.hasAttribute("aria-invalid")) {
    e.target.removeAttribute("aria-invalid");
    const descriptions = (e.target.getAttribute("aria-describedby") || "")
      .split(/\s+/)
      .filter((id) => id && id !== "dialog-error");
    if (descriptions.length)
      e.target.setAttribute("aria-describedby", descriptions.join(" "));
    else e.target.removeAttribute("aria-describedby");
  }
  if (processing || transitioning || privacyMasked) return;
  if (e.target.id === "search") {
    search = e.target.value;
    page = 1;
    renderLedger();
  }
  lastActivity = Date.now();
});
document.addEventListener("change", (e) => {
  if (busy || processing || transitioning || privacyMasked) return;
  const el = e.target;
  if (el.id === "month") {
    if (F.validMonth(el.value)) {
      month = el.value;
      page = 1;
      render();
    }
    return;
  }
  const map = {
    "type-filter": (v) => (typeFilter = v),
    "status-filter": (v) => (statusFilter = v),
    "scope-filter": (v) => (scope = v),
  };
  if (Object.hasOwn(map, el.id)) {
    map[el.id](el.value);
    page = 1;
    renderLedger();
  }
  if (el.dataset.importType) {
    syncImportControls();
    importSession.rows[Number(el.dataset.importType)].type = el.value;
    openDialog("import-preview");
  }
});
$("#hide-values").addEventListener("click", () => {
  if (busy || processing || transitioning || privacyMasked) return;
  if ($("#dialog").open) stashDialog();
  hidden = !hidden;
  $("#hide-values").setAttribute("aria-pressed", String(hidden));
  $("#hide-values").setAttribute(
    "aria-label",
    hidden ? "Mostrar valores" : "Ocultar valores",
  );
  $("#hide-values").textContent = hidden ? "◌" : "◉";
  render();
});
$("#file-input").addEventListener("change", handleFile);
window.addEventListener("hashchange", () => {
  if (busy || processing || transitioning || privacyMasked) {
    location.hash = view;
    return;
  }
  const v = location.hash.slice(1);
  if (!isRoute(v)) {
    history.replaceState(null, "", "#inicio");
    if (view !== "inicio") navigate("inicio");
    return;
  }
  if (v !== view) {
    if ($("#dialog").open) stashDialog();
    view = v;
    render();
    const heading = $("#main h1") || $("#main");
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
});
window.addEventListener("beforeunload", (e) => {
  if (
    busy ||
    processing ||
    transitioning ||
    drafts.size ||
    (memory && state.revision > 0) ||
    ($("#dialog").open && !["mode", "unlock", "create"].includes(dialogKind))
  ) {
    e.preventDefault();
    e.returnValue = "";
  }
});
for (const event of ["pointerdown", "keydown"])
  document.addEventListener(event, () => (lastActivity = Date.now()), {
    passive: true,
  });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (slot === "personal" && hiddenAt && Date.now() - hiddenAt >= 120000)
    lockVault();
});
setInterval(() => {
  if (
    slot === "personal" &&
    (Date.now() - lastActivity >= 600000 ||
      (document.hidden && hiddenAt && Date.now() - hiddenAt >= 120000))
  )
    lockVault();
}, 15000);
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
});
async function setupOffline() {
  if (!("serviceWorker" in navigator)) return;
  try {
    swRegistration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    if (swRegistration.waiting) {
      waitingWorker = swRegistration.waiting;
      renderNotice();
    }
    swRegistration.addEventListener("updatefound", () => {
      const worker = swRegistration.installing;
      worker?.addEventListener("statechange", () => {
        if (
          worker.state === "installed" &&
          navigator.serviceWorker.controller
        ) {
          waitingWorker = worker;
          renderNotice();
        }
      });
    });
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading || !updateRequested) return;
      reloading = true;
      location.reload();
    });
  } catch {
    toast(
      "O navegador não habilitou o modo offline. O uso conectado continua disponível.",
    );
  }
}
async function bootstrap() {
  for (const [v, label] of Object.entries(routes)) {
    $("#nav").insertAdjacentHTML(
      "beforeend",
      `<button class="nav-item" data-view="${v}">${icon(v)}<span>${label}</span></button>`,
    );
  }
  $("#mobile-nav").innerHTML = [
    ["inicio", "Início"],
    ["lancamentos", "Registros"],
    ["contas", "Contas"],
    ["planejamento", "Plano"],
    ["configuracoes", "Mais"],
  ]
    .map(
      ([v, label]) =>
        `<button data-view="${v}" aria-label="${label}">${icon(v)}<span>${label}</span></button>`,
    )
    .join("");
  view = isRoute(location.hash.slice(1)) ? location.hash.slice(1) : "inicio";
  try {
    db = await openDatabase();
    legacy = await readValue(db, "state");
    personalHead = personalStatus(await loadRaw(db, "personal"));
    const raw = await loadRaw(db, "demo");
    try {
      const loaded = await decodeRaw(raw);
      if (loaded) state = loaded;
      else {
        state = await saveSlot(db, "demo", null, F.demo(), -1);
      }
    } catch (e) {
      if (e instanceof StorageConflict)
        state = await decodeRaw(await loadRaw(db, "demo"));
      else {
        blocked = true;
        state.revision = safeRevision(raw.head?.revision);
      }
    }
    stats = await storageInfo().catch(() => null);
  } catch (e) {
    memory = true;
    toast(e.message + " Os exemplos estão disponíveis nesta sessão.");
  }
  restorePublicCache();
  render();
  document.addEventListener("focusin", () =>
    requestAnimationFrame(() => ensureFocusVisible()),
  );
  const resizeNav = () => {
    const height = $("#mobile-nav").getBoundingClientRect().height;
    document.documentElement.style.setProperty(
      "--mobile-nav-height",
      height + "px",
    );
  };
  if (typeof ResizeObserver !== "undefined")
    new ResizeObserver(resizeNav).observe($("#mobile-nav"));
  window.addEventListener("resize", resizeNav);
  resizeNav();
  $("#save-status").textContent = memory
    ? "Sessão temporária"
    : "Pronto · dados locais";
  await setupOffline();
}
await bootstrap();
