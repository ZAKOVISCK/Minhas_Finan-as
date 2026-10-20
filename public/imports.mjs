import {
  parseMoney,
  validDate,
  localDate,
  uid,
  validateState,
  outstanding,
  MAX_CENTS,
} from "./finance.mjs";

export const IMPORT_LIMIT = 5 * 1024 * 1024;
const normalize = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
function checkText(text) {
  if (typeof text !== "string")
    throw new Error("O extrato precisa conter texto.");
  if (new TextEncoder().encode(text).length > IMPORT_LIMIT)
    throw new Error("Extratos: limite de 5 MiB.");
  return text.replace(/^\uFEFF/, "");
}
function detectDelimiter(text) {
  const counts = { ";": 0, ",": 0, "\t": 0 };
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted) {
      if (text[i] === "\n" || text[i] === "\r") break;
      if (Object.hasOwn(counts, text[i])) counts[text[i]]++;
    }
  }
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
}
export function parseCSV(text, delimiter) {
  text = checkText(text);
  delimiter ||= detectDelimiter(text);
  if (![";", ",", "\t"].includes(delimiter))
    throw new Error("Separador CSV inválido.");
  const rows = [];
  let row = [],
    cell = "",
    quoted = false,
    closed = false;
  const pushRow = () => {
    row.push(cell);
    if (row.some((value) => value.trim())) rows.push(row);
    if (rows.length > 10001)
      throw new Error("Importe até 10.000 linhas por vez.");
    row = [];
    cell = "";
    closed = false;
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
        closed = true;
      } else cell += char;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
      closed = false;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      pushRow();
    } else if (closed) {
      if (!/\s/.test(char))
        throw new Error("CSV com texto após o fechamento de aspas.");
    } else if (char === '"') {
      if (cell) throw new Error("CSV com aspas em campo não delimitado.");
      quoted = true;
    } else cell += char;
  }
  if (quoted) throw new Error("CSV com aspas não fechadas.");
  pushRow();
  if (rows.length < 2) throw new Error("CSV sem registros.");
  return {
    headers: rows[0].map((value) => value.trim()),
    rows: rows.slice(1),
    delimiter,
  };
}
const aliases = {
  description: ["descricao", "description", "historico", "memo", "lancamento"],
  date: ["data", "date", "data de pagamento", "vencimento"],
  amount: ["valor", "valor (r$)", "amount", "valor r$"],
  type: ["tipo", "type"],
  category: ["categoria", "category"],
  id: ["id", "fitid", "identificador"],
};
export function suggestMapping(headers) {
  return Object.fromEntries(
    Object.entries(aliases).map(([key, values]) => [
      key,
      headers.findIndex((header) => values.includes(normalize(header))),
    ]),
  );
}
function bankDate(value) {
  const text = String(value ?? "").trim();
  if (validDate(text)) return text;
  const match = text.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (match && validDate(`${match[3]}-${match[2]}-${match[1]}`))
    return `${match[3]}-${match[2]}-${match[1]}`;
  throw new Error("Data inválida: " + text.slice(0, 30));
}
function bankAmount(value) {
  return parseMoney(
    String(value ?? "")
      .trim()
      .replace(/^\+/, ""),
    { signed: true },
  );
}
function externalId(value) {
  const id = String(value ?? "").trim();
  if (id.length > 255)
    throw new Error("Identificador bancário acima de 255 caracteres.");
  return id;
}
export function previewCSV(parsed, mapping = suggestMapping(parsed.headers)) {
  const required = ["description", "date", "amount"];
  if (
    required.some(
      (key) =>
        !Number.isInteger(mapping[key]) ||
        mapping[key] < 0 ||
        mapping[key] >= parsed.headers.length,
    )
  )
    throw new Error("Mapeie descrição, data e valor.");
  if (new Set(required.map((key) => mapping[key])).size !== required.length)
    throw new Error("Use colunas diferentes para descrição, data e valor.");
  return parsed.rows.map((row, index) => {
    try {
      const amount = bankAmount(row[mapping.amount]);
      if (amount == null || !amount) throw new Error("Valor inválido.");
      const description = String(row[mapping.description] ?? "")
        .trim()
        .slice(0, 100);
      if (!description) throw new Error("Descrição vazia.");
      const hint = normalize(row[mapping.type]);
      return {
        line: index + 2,
        description,
        date: bankDate(row[mapping.date]),
        amount: Math.abs(amount),
        type: /receita|income|credito|credit/.test(hint)
          ? "income"
          : /despesa|expense|debito|debit/.test(hint)
            ? "expense"
            : amount < 0
              ? "expense"
              : "income",
        externalId: mapping.id >= 0 ? externalId(row[mapping.id]) : "",
        category:
          mapping.category >= 0
            ? String(row[mapping.category] ?? "")
            : "Outros",
      };
    } catch (error) {
      return { line: index + 2, error: error.message };
    }
  });
}
function unescapeXML(text) {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (match, entity) => {
      const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
      if (entity[0] !== "#") return named[entity.toLowerCase()];
      const point =
        entity[1].toLowerCase() === "x"
          ? parseInt(entity.slice(2), 16)
          : Number(entity.slice(1));
      return point > 0 &&
        point <= 0x10ffff &&
        !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point)
        : match;
    },
  );
}
export function previewOFX(text) {
  text = checkText(text);
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error("OFX com entidades externas não é permitido.");
  const blocks = [...text.matchAll(/<STMTTRN\s*>([\s\S]*?)<\/STMTTRN\s*>/gi)];
  if (!blocks.length || blocks.length > 10000)
    throw new Error("OFX sem transações ou acima do limite.");
  return blocks.map(([, block], index) => {
    const get = (tag) =>
      unescapeXML(
        block.match(new RegExp("<" + tag + "\\s*>([^<]*)", "i"))?.[1] || "",
      ).trim();
    try {
      const amount = bankAmount(get("TRNAMT"));
      if (amount == null || !amount) throw new Error("Valor inválido.");
      const date = get("DTPOSTED").slice(0, 8);
      return {
        line: index + 1,
        description: (get("MEMO") || get("NAME") || "Movimento OFX").slice(
          0,
          100,
        ),
        date: bankDate(
          `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
        ),
        amount: Math.abs(amount),
        type: amount < 0 ? "expense" : "income",
        externalId: externalId(get("FITID")),
        category: "Outros",
      };
    } catch (error) {
      return { line: index + 1, error: error.message };
    }
  });
}
export function importKey(row, accountId) {
  return (
    accountId +
    "|" +
    (row.externalId
      ? "id:" + row.externalId
      : [row.date, row.type, row.amount, normalize(row.description)].join("|"))
  );
}
const signature = (row, accountId) =>
  JSON.stringify([
    accountId,
    row.date,
    row.type,
    row.amount,
    normalize(row.description),
  ]);
function rowError(row, account, asOf) {
  if (!row || !["income", "expense"].includes(row.type))
    return "Tipo de movimento inválido.";
  if (
    typeof row.description !== "string" ||
    !row.description.trim() ||
    row.description.trim().length > 100
  )
    return "Descrição inválida.";
  if (
    !Number.isSafeInteger(row.amount) ||
    row.amount <= 0 ||
    row.amount > MAX_CENTS
  )
    return "Valor inválido.";
  if (!validDate(row.date) || row.date > asOf)
    return "Data efetiva inválida ou futura.";
  if (row.date < account.openingDate)
    return "Movimento anterior à abertura da conta.";
  if (
    row.externalId &&
    (typeof row.externalId !== "string" || row.externalId.length > 255)
  )
    return "Identificador bancário inválido.";
  return "";
}
export function planImport(state, rows, accountId, asOf = localDate()) {
  const account = state.accounts.find((account) => account.id === accountId);
  if (!account)
    throw new Error("Escolha uma conta válida para importar o extrato.");
  const entryMap = new Map(state.entries.map((entry) => [entry.id, entry]));
  const keys = new Set(
    [...state.entries, ...state.payments]
      .map((record) => record.importKey)
      .filter(Boolean),
  );
  const paid = new Map(),
    keyedPayments = new Map(),
    legacyKeys = new Map(),
    manual = new Map();
  for (const entry of state.entries) {
    if (entry.importKey)
      legacyKeys.set(
        entry.importKey,
        (legacyKeys.get(entry.importKey) || 0) + 1,
      );
  }
  for (const payment of state.payments) {
    const entry = entryMap.get(payment.entryId);
    if (!entry) continue;
    const key = signature(
      { ...payment, type: entry.type, description: entry.description },
      payment.accountId,
    );
    if (!paid.has(key)) paid.set(key, new Set());
    paid.get(key).add(payment.id);
    if (payment.importKey) {
      if (!keyedPayments.has(payment.importKey))
        keyedPayments.set(payment.importKey, new Set());
      keyedPayments.get(payment.importKey).add(payment.id);
    }
    if (!payment.importKey && !entry.importKey)
      manual.set(key, (manual.get(key) || 0) + 1);
  }
  const occurrences = new Map(),
    identified = new Set();
  return rows.map((row) => {
    if (row.error) return { ...row };
    const error = rowError(row, account, asOf);
    if (error) return { ...row, error };
    const key = importKey(row, accountId),
      match = signature(row, accountId);
    const group = (row.externalId ? "identified:" : "anonymous:") + match;
    const knownId = !!row.externalId && (keys.has(key) || identified.has(key));
    const occurrence = (occurrences.get(group) || 0) + (knownId ? 0 : 1);
    if (!knownId) occurrences.set(group, occurrence);
    const matchingPayments = new Set([
      ...(paid.get(match) || []),
      ...(keyedPayments.get(key) || []),
    ]);
    const existingCount = row.externalId
      ? manual.get(match) || 0
      : Math.max(matchingPayments.size, legacyKeys.get(key) || 0);
    const matchedPayment = !knownId && occurrence <= existingCount;
    if (row.externalId && (!row.exclude || knownId || matchedPayment))
      identified.add(key);
    return {
      ...row,
      key,
      duplicate: knownId || matchedPayment,
      duplicateReason: knownId
        ? "identificador"
        : matchedPayment
          ? "pagamento existente"
          : "",
      repeatedInFile: !row.externalId && occurrence > 1,
    };
  });
}
function addReconciliation(state, entryId, row, accountId) {
  const entry = state.entries.find((entry) => entry.id === entryId);
  if (
    !entry ||
    entry.type !== row.type ||
    outstanding(state, entry) < row.amount
  )
    throw new Error(
      "Escolha um compromisso do mesmo tipo com saldo suficiente.",
    );
  state.payments.push({
    id: uid(),
    entryId,
    accountId,
    amount: row.amount,
    date: row.date,
    importKey: row.key || importKey(row, accountId),
  });
}
export function applyImport(state, rows, accountId, category = "Outros") {
  const planned = planImport(state, rows, accountId);
  if (planned.some((row) => row.error && !row.exclude))
    throw new Error("Exclua as linhas inválidas antes de importar.");
  const next = structuredClone(state);
  for (const row of planned) {
    if (row.error || row.duplicate || row.exclude) continue;
    if (row.reconcileId) {
      addReconciliation(next, row.reconcileId, row, accountId);
      continue;
    }
    const id = uid();
    next.entries.push({
      id,
      description: row.description,
      type: row.type,
      category,
      amount: row.amount,
      dueDate: row.date,
      competence: row.date.slice(0, 7),
      accountId,
      cardId: null,
      origin: "Extrato importado",
      importKey: row.key,
    });
    next.payments.push({
      id: uid(),
      entryId: id,
      accountId,
      amount: row.amount,
      date: row.date,
      importKey: row.key,
    });
  }
  return validateState(next);
}
export function reconcile(state, entryId, row, accountId) {
  const [planned] = planImport(state, [row], accountId);
  if (planned.error) throw new Error(planned.error);
  if (planned.duplicate)
    throw new Error("Movimento já importado ou pagamento já registrado.");
  const next = structuredClone(state);
  addReconciliation(next, entryId, planned, accountId);
  return validateState(next);
}
