import * as F from "./finance.mjs";
import { esc, options } from "./views.mjs";

/** An actionable validation error for one named form control. */
export class FormValidationError extends Error {
  /** @param {string} message @param {string} field */
  constructor(message, field) {
    super(message);
    this.name = "FormValidationError";
    this.field = field;
  }
}

/**
 * Render a labelled input. `attrs` is trusted markup supplied by the controller;
 * dynamic labels, names, types and values are escaped here.
 * @param {string} label @param {string} name @param {string} [type]
 * @param {string | number} [value] @param {string} [attrs]
 */
export function field(label, name, type = "text", value = "", attrs = "") {
  return `<label>${esc(label)}<input name="${esc(name)}" type="${esc(type)}" value="${esc(value)}" ${attrs}></label>`;
}

/** @param {string} label @param {string} name @param {Array} rows @param {unknown} value */
export function select(label, name, rows, value) {
  return `<label>${esc(label)}<select name="${esc(name)}">${options(rows, value)}</select></label>`;
}

/** A numeric value is expressed in integer cents; text keeps a draft unchanged. */
export function amountField(label, name, value = "") {
  return field(
    label,
    name,
    "text",
    typeof value === "number"
      ? (value / 100).toFixed(2).replace(".", ",")
      : value,
    'inputmode="decimal" maxlength="24" required',
  );
}

export function dateField(label, name, value = F.localDate()) {
  return field(
    label,
    name,
    "date",
    value,
    'min="1900-01-01" max="2199-12-31" required',
  );
}

const fail = (name, message) => {
  throw new FormValidationError(message, name);
};

/**
 * Identify the relevant control before a mutation reaches the domain model.
 * This function never modifies form data or state. It does not replace
 * validateState(): backups, imports and writes still pass that domain boundary.
 * Unlock, restore and import mapping retain their dedicated controller paths.
 *
 * @param {string} kind
 * @param {Record<string, unknown>} data
 * @param {ReturnType<typeof F.emptyState>} state A previously validated state.
 * @param {{id?: string, today?: string, month?: string}} [context]
 * @returns {void}
 */
export function validateFormData(
  kind,
  data,
  state,
  { id = "", today = F.localDate(), month = "" } = {},
) {
  const value = (name) => (typeof data[name] === "string" ? data[name] : "");
  const text = (name, max = 100) => {
    const result = value(name).trim();
    if (!result || result.length > max)
      fail(name, `Informe um texto com até ${max} caracteres.`);
    return result;
  };
  const choice = (name, values) => {
    const result = value(name);
    if (!values.includes(result)) fail(name, "Selecione uma opção válida.");
    return result;
  };
  const money = (name, { positive = false, signed = false } = {}) => {
    const result = F.parseMoney(value(name), { signed });
    if (result == null)
      fail(name, "Informe um valor em reais com até duas casas decimais.");
    if (positive && result <= 0) fail(name, "O valor deve ser maior que zero.");
    return result;
  };
  const date = (name, { realized = false, accounts = [] } = {}) => {
    const result = value(name);
    if (!F.validDate(result))
      fail(name, "Informe uma data válida entre 1900 e 2199.");
    if (realized && result > today)
      fail(name, "Uma movimentação realizada não pode ter data futura.");
    if (realized && accounts.some((account) => result < account.openingDate))
      fail(name, "A data não pode ser anterior à abertura da conta utilizada.");
    return result;
  };
  const calendarMonth = (name) => {
    const result = value(name);
    if (!F.validMonth(result))
      fail(name, "Selecione um mês válido entre 1900 e 2199.");
    return result;
  };
  const integer = (name, min, max) => {
    const raw = value(name),
      result = Number(raw);
    if (
      !raw.trim() ||
      !Number.isSafeInteger(result) ||
      result < min ||
      result > max
    )
      fail(name, `Informe um número inteiro de ${min} a ${max}.`);
    return result;
  };
  const account = (name = "accountId") => {
    const result = state.accounts.find((row) => row.id === value(name));
    if (!result) fail(name, "Selecione uma conta existente.");
    return result;
  };
  const asset = () => {
    const result = state.assets.find((row) => row.id === value("assetId"));
    if (!result) fail("assetId", "Selecione um ativo existente.");
    return result;
  };
  const category = () => {
    if (
      !F.categoryNames(state, { includeArchived: true }).includes(
        value("category"),
      )
    )
      fail("category", "Selecione uma categoria existente.");
  };

  if (kind === "create" || kind === "change-password") {
    if (kind === "create") text("name", 40);
    else if (value("current").length < 12 || value("current").length > 256)
      fail("current", "Informe a senha atual com 12 a 256 caracteres.");
    const password = value("password");
    if (password.length < 12 || password.length > 256)
      fail("password", "Use uma senha com 12 a 256 caracteres.");
    if (password !== value("confirmation"))
      fail(
        "confirmation",
        "As senhas não coincidem. Repita a senha informada.",
      );
  } else if (kind === "entry") {
    text("description");
    const type = choice("type", ["income", "expense"]);
    const amount = money("amount", { positive: true });
    date("dueDate");
    calendarMonth("competence");
    category();
    const selectedAccount = account(),
      old = state.entries.find((row) => row.id === id);
    if (old?.cardId && type !== "expense")
      fail("type", "Uma compra de cartão deve permanecer como despesa.");
    if (
      old &&
      state.payments
        .filter((row) => row.entryId === id)
        .reduce((sum, row) => sum + row.amount, 0) > amount
    )
      fail(
        "amount",
        "O valor não pode ser menor que os pagamentos já registrados.",
      );
    if (!old && data.paid)
      date("paymentDate", { realized: true, accounts: [selectedAccount] });
  } else if (kind === "payment") {
    const amount = money("amount", { positive: true });
    const entry = state.entries.find((row) => row.id === id);
    if (!entry)
      fail(
        "amount",
        "O lançamento não está mais disponível. Feche e abra o formulário novamente.",
      );
    if (amount > F.outstanding(state, entry))
      fail("amount", "O valor é maior que o saldo pendente.");
    date("date", { realized: true, accounts: [account()] });
  } else if (kind === "account") {
    text("name", 60);
    choice("kind", ["bank", "cash", "investment"]);
    money("opening", { signed: true });
    const opening = date("openingDate");
    if (id) {
      const dates = [
        ...state.payments
          .filter((row) => row.accountId === id)
          .map((row) => row.date),
        ...state.transfers
          .filter((row) => row.fromId === id || row.toId === id)
          .map((row) => row.date),
        ...state.trades
          .filter((row) => row.accountId === id)
          .map((row) => row.date),
        ...state.dividends
          .filter((row) => row.accountId === id && row.status === "received")
          .map((row) => row.date),
      ];
      if (dates.some((when) => when < opening))
        fail(
          "openingDate",
          "A abertura não pode ficar depois de uma movimentação já registrada nesta conta.",
        );
    }
  } else if (kind === "transfer") {
    const from = account("fromId"),
      to = account("toId");
    if (from.id === to.id)
      fail(
        "toId",
        "Escolha uma conta de destino diferente da conta de origem.",
      );
    money("amount", { positive: true });
    date("date", { realized: true, accounts: [from, to] });
  } else if (kind === "card") {
    text("name", 60);
    money("limit");
    integer("closingDay", 1, 31);
    integer("dueDay", 1, 31);
    account();
  } else if (kind === "purchase") {
    text("description");
    const amount = money("amount", { positive: true });
    date("date", { realized: true });
    category();
    const installments = integer("installments", 1, 60);
    if (installments > amount)
      fail("installments", "Cada parcela deve ter pelo menos um centavo.");
    const first = calendarMonth("firstStatement");
    try {
      F.addMonths(first, installments - 1);
    } catch {
      fail("firstStatement", "A última parcela deve ficar entre 1900 e 2199.");
    }
  } else if (kind === "statement") {
    const amount = money("amount", { positive: true });
    date("date", { realized: true, accounts: [account()] });
    if (month && F.validMonth(month)) {
      const left = state.entries
        .filter((row) => row.cardId === id && row.statementMonth === month)
        .reduce((sum, row) => sum + F.outstanding(state, row), 0);
      if (amount > left)
        fail("amount", "O valor é maior que o saldo pendente desta fatura.");
    }
  } else if (kind === "budget" || kind === "reserve") {
    calendarMonth("month");
    if (kind === "budget") category();
    money("amount");
  } else if (kind === "goal") {
    text("name", 60);
    money("target", { positive: true });
    money("allocated");
    date("dueDate");
  } else if (kind === "recurrence") {
    text("description");
    choice("type", ["income", "expense"]);
    money("amount", { positive: true });
    category();
    account();
    integer("day", 1, 31);
    const first = calendarMonth("start");
    if (value("end") && calendarMonth("end") < first)
      fail("end", "O último mês deve ser posterior ou igual ao primeiro.");
  } else if (kind === "asset") {
    const symbol = text("symbol", 20).toUpperCase();
    text("name", 80);
    choice("kind", ["stock", "fii", "fixed", "fund", "other"]);
    if (
      state.assets.some(
        (row) => row.id !== id && row.symbol.toUpperCase() === symbol,
      )
    )
      fail("symbol", "Este código já está cadastrado.");
  } else if (kind === "trade") {
    const selectedAsset = asset(),
      side = choice("side", ["buy", "sell", "split"]);
    const quantity = F.units(value("quantity"));
    if (quantity == null)
      fail(
        "quantity",
        "Informe uma quantidade positiva com até seis casas decimais.",
      );
    const price = money("price", { positive: side !== "split" }),
      fees = money("fees");
    if (side === "split" && price !== 0)
      fail("price", "Um desdobramento ou grupamento exige preço igual a zero.");
    if (side === "split" && fees !== 0)
      fail(
        "fees",
        "Um desdobramento ou grupamento exige custos iguais a zero.",
      );
    const when = date("date", { realized: true, accounts: [account()] });
    try {
      F.multiply(quantity, price);
    } catch {
      fail("price", "O valor da operação excede o limite permitido.");
    }
    if (side !== "buy") {
      const current = F.positions(state, when).find(
        (row) => row.asset.id === selectedAsset.id,
      );
      if (!current || current.quantity <= 0)
        fail(
          "quantity",
          "Não há posição disponível nesta data para a operação.",
        );
      if (side === "sell" && quantity > current.quantity)
        fail("quantity", "A venda é superior à posição disponível nesta data.");
      if (
        side === "split" &&
        (BigInt(current.quantity) * BigInt(quantity)) % BigInt(F.SCALE)
      )
        fail(
          "quantity",
          "O evento produziria uma quantidade com mais de seis casas decimais.",
        );
    }
  } else if (kind === "dividend") {
    asset();
    money("amount", { positive: true });
    const received = choice("status", ["announced", "received"]) === "received";
    date("date", { realized: received, accounts: [account()] });
  } else if (kind === "price") {
    asset();
    money("price", { positive: true });
    date("date", { realized: true });
    text("source", 160);
  } else if (kind === "snapshot") {
    money("amount");
    date("date", { realized: true });
    if (value("source")) text("source", 400);
  } else if (kind === "watch") {
    const symbol = text("symbol", 20).toUpperCase();
    choice("kind", ["stock", "fii", "index", "currency", "other"]);
    if (state.watchlist.some((row) => row.symbol.toUpperCase() === symbol))
      fail("symbol", "Este código já está na lista.");
  } else if (kind === "name") text("name", 40);
  else if (kind === "category") {
    const name = text("name", 60),
      key = name.normalize("NFKC").toLocaleLowerCase("pt-BR");
    if (
      F.categoryList(state).some(
        (row) =>
          row.id !== id &&
          row.name.normalize("NFKC").toLocaleLowerCase("pt-BR") === key,
      )
    )
      fail("name", "Já existe uma categoria com este nome.");
  } else if (kind === "import") {
    account();
    category();
    choice("encoding", ["utf-8", "windows-1252"]);
  } else if (kind === "simulate") {
    const principal = money("principal");
    const rate = Number(value("rate"));
    if (
      !value("rate").trim() ||
      !Number.isFinite(rate) ||
      rate < 0 ||
      rate > 100
    )
      fail("rate", "Informe uma taxa anual entre zero e 100%.");
    const days = integer("days", 1, 36500);
    if (principal * (1 + rate / 100) ** (days / 365) > F.MAX_CENTS)
      fail(
        "days",
        "O resultado ultrapassa o limite permitido. Reduza o prazo ou a taxa.",
      );
  }
}
