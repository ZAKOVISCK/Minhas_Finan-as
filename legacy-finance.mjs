// Regras financeiras independentes da interface e do armazenamento.
export const CATEGORIES = ['Alimentação', 'Transporte', 'Lazer', 'Moradia', 'Serviços', 'Salário', 'Outros'];
export const BUDGET_CATEGORIES = CATEGORIES.slice(0, 3);
export const MAX_CENTS = 999_999_999_999;
export const MAX_ENTRIES = 10_000;

export function localDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function validMonth(value) {
  return typeof value === 'string' && /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(value);
}

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !validMonth(value.slice(0, 7))) return false;
  const [year, month, day] = value.split('-').map(Number);
  return day >= 1 && day <= new Date(year, month, 0).getDate();
}

export function endOfMonth(month) {
  if (!validMonth(month)) throw new Error('Selecione um mês válido.');
  const [year, m] = month.split('-').map(Number);
  return `${month}-${new Date(year, m, 0).getDate()}`;
}

export function parseMoney(value, { signed = false } = {}) {
  let text = String(value ?? '').trim().replace(/^R\$\s*/, '').trim();
  let sign = 1;
  if (text.startsWith('-')) {
    if (!signed) return null;
    sign = -1;
    text = text.slice(1);
  }
  // Vírgula decimal permite agrupamento brasileiro; ponto sem vírgula é decimal.
  if (text.includes(',')) {
    if (!/^(\d+|\d{1,3}(\.\d{3})+),\d{1,2}$/.test(text)) return null;
    text = text.replaceAll('.', '').replace(',', '.');
  } else if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    return null;
  }
  const [reais, cents = ''] = text.split('.');
  const result = (Number(reais) * 100 + Number(cents.padEnd(2, '0'))) * sign;
  return Number.isSafeInteger(result) && Math.abs(result) <= MAX_CENTS ? result : null;
}

export function revisionOf(value) {
  return Number.isSafeInteger(value?.revision) && value.revision >= 0 && value.revision < Number.MAX_SAFE_INTEGER - 1 ? value.revision : 0;
}

export function validateState(raw) {
  const fail = (message) => { throw new Error(message); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![1, 2].includes(raw.version)) fail('Formato de dados não reconhecido.');
  const amount = (value, label, signed = false) => {
    if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_CENTS || (!signed && value < 0)) fail(`Valor inválido: ${label}.`);
    return value;
  };
  if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.trim().length > 40) fail('Nome inválido.');
  if (!Array.isArray(raw.entries) || raw.entries.length > MAX_ENTRIES) fail('Lista de lançamentos inválida ou acima de 10.000 registros.');
  if (raw.version === 2 && (!Number.isSafeInteger(raw.revision) || raw.revision < 0 || raw.revision >= Number.MAX_SAFE_INTEGER - 1)) fail('Revisão dos dados inválida.');
  if (!raw.budgets || typeof raw.budgets !== 'object') fail('Orçamentos inválidos.');
  const budgets = Object.fromEntries(BUDGET_CATEGORIES.map(c => [c, amount(raw.budgets[c], `orçamento de ${c}`)]));
  const ids = new Set();
  const entries = raw.entries.map(e => {
    if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(e.id) || ids.has(e.id)) fail('Identificador de lançamento inválido ou duplicado.');
    ids.add(e.id);
    if (typeof e.description !== 'string' || !e.description.trim() || e.description.trim().length > 100) fail('Descrição de lançamento inválida.');
    if (!CATEGORIES.includes(e.category) || !['income', 'expense'].includes(e.type) || !['paid', 'pending'].includes(e.status) || !validDate(e.date)) fail('Categoria, data, tipo ou situação de lançamento inválidos.');
    if (amount(e.amount, 'lançamento') === 0) fail('O lançamento precisa ter um valor maior que zero.');
    return { id: e.id, description: e.description.trim(), category: e.category, amount: e.amount, type: e.type, status: e.status, date: e.date };
  });
  const state = { version: 2, revision: revisionOf(raw), name: raw.name.trim(), opening: amount(raw.opening, 'saldo inicial', true), reserve: amount(raw.reserve, 'reserva'), investments: amount(raw.investments, 'investimentos'), budgets, entries };
  const exposure = entries.reduce((sum, e) => sum + e.amount, Math.abs(state.opening) + state.reserve + state.investments);
  if (!Number.isSafeInteger(exposure)) fail('O total ultrapassa o limite de precisão dos cálculos.');
  return state;
}

export function validateEntry(entry, asOf = localDate()) {
  if (!validDate(entry.date)) throw new Error('Informe uma data válida.');
  if (entry.status === 'paid' && entry.date > asOf) throw new Error('Uma data futura deve ficar como prevista. Para realizar, informe a data efetiva.');
  if (!entry.description?.trim()) throw new Error('Informe a descrição.');
  return entry;
}

export function monthEntries(state, month) {
  return state.entries.filter(e => e.date.startsWith(month));
}

export function commitments(state, month) {
  const end = endOfMonth(month);
  return state.entries.filter(e => e.type === 'expense' && e.status === 'pending' && e.date <= end).sort((a, b) => a.date.localeCompare(b.date));
}

export function summarize(state, month, asOf = localDate()) {
  const end = endOfMonth(month);
  const cutoff = end < asOf ? end : asOf;
  const paid = state.entries.filter(e => e.status === 'paid' && e.date <= cutoff);
  const cash = state.opening + paid.reduce((sum, e) => sum + (e.type === 'income' ? e.amount : -e.amount), 0);
  const selected = paid.filter(e => e.date.startsWith(month));
  const income = selected.filter(e => e.type === 'income').reduce((sum, e) => sum + e.amount, 0);
  const expense = selected.filter(e => e.type === 'expense').reduce((sum, e) => sum + e.amount, 0);
  const due = commitments(state, month);
  const pending = due.reduce((sum, e) => sum + e.amount, 0);
  const overdue = due.filter(e => e.date < asOf).reduce((sum, e) => sum + e.amount, 0);
  return { cash, income, expense, pending, overdue, available: cash - pending - state.reserve, cutoff };
}

export function budgetUsage(state, month, category, asOf = localDate()) {
  const limit = state.budgets[category];
  const spent = monthEntries(state, month).filter(e => e.type === 'expense' && e.status === 'paid' && e.date <= asOf && e.category === category).reduce((sum, e) => sum + e.amount, 0);
  return { limit, spent, percent: limit ? Math.round(spent / limit * 100) : null, over: spent > limit };
}

export function csvCell(value) {
  let text = String(value);
  if (/^[\s\u0000-\u001f]*[=+@\-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function toCSV(entries) {
  const rows = [['Descrição', 'Categoria', 'Data', 'Tipo', 'Situação', 'Valor (R$)'], ...entries.map(e => [e.description, e.category, e.date, e.type === 'income' ? 'Receita' : 'Despesa', e.status === 'paid' ? 'Realizado' : 'Previsto', (e.amount / 100).toFixed(2).replace('.', ',')])];
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(';')).join('\r\n');
}

export function parseBackup(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > 5 * 1024 * 1024) throw new Error('O arquivo precisa ter até 5 MB.');
  let raw;
  try { raw = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('O arquivo não contém um JSON válido.'); }
  return validateState(raw);
}
