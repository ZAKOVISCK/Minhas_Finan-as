import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, validateState, outstanding, balances } from '../finance.mjs';
import { parseCSV, suggestMapping, previewCSV, previewOFX, importKey, planImport, applyImport, reconcile } from '../imports.mjs';

function fixture() {
  const state = emptyState('Teste', '2025-01-01');
  state.accounts.push({ id: 'bank', name: 'Conta', kind: 'bank', opening: 100000, openingDate: '2025-01-01', archived: false });
  return validateState(state);
}
const movement = (overrides = {}) => ({ line: 2, description: 'Conta de luz', date: '2025-01-10', type: 'expense', amount: 10000, externalId: '', ...overrides });
function commitment(state, overrides = {}) {
  state.entries.push({ id: 'bill', description: 'Conta de luz', type: 'expense', category: 'Serviços', amount: 10000, dueDate: '2025-01-10', competence: '2025-01', accountId: 'bank', cardId: null, ...overrides });
  return validateState(state);
}

test('CSV preserves quoted delimiters, escaped quotes, multiline content and BOM', () => {
  const csv = '\uFEFFDescrição;Data;Valor\r\n"Compra; \"\"especial\"\"\nloja";10/01/2025;-1.234,56\r\n';
  const parsed = parseCSV(csv);
  assert.equal(parsed.delimiter, ';');
  assert.deepEqual(previewCSV(parsed)[0], movement({ description: 'Compra; "especial"\nloja', amount: 123456, category: 'Outros' }));
});

test('CSV delimiter detection ignores punctuation inside quoted headers', () => {
  const parsed = parseCSV('"Descrição; interna",Data,Valor\nCompra,2025-01-10,-12.34');
  assert.equal(parsed.delimiter, ',');
  const rows = previewCSV(parsed, { description: 0, date: 1, amount: 2 });
  assert.equal(rows[0].amount, 1234);
});

test('CSV rejects unclosed/invalid quotes, wrong mapping and empty descriptions', () => {
  assert.throws(() => parseCSV('Descrição;Data;Valor\n"Compra;2025-01-10;-10'), /aspas/);
  assert.throws(() => parseCSV('Descrição;Data;Valor\n"Compra"erro;2025-01-10;-10'), /aspas/);
  const parsed = parseCSV('Descrição;Data;Valor\n ;2025-01-10;-10');
  assert.throws(() => previewCSV(parsed, {}), /Mapeie/);
  assert.throws(() => previewCSV(parsed, { description: 0, date: 0, amount: 2 }), /diferentes/);
  assert.match(previewCSV(parsed)[0].error, /Descrição/);
});

test('CSV parses Brazilian amounts, explicit positive signs and type hints', () => {
  const parsed = parseCSV('Descrição;Data;Valor;Tipo;FITID\nCompra;10/01/2025;1.234,56;Débito; A \nSalário;2025-01-11;+20.50;Receita;B');
  assert.equal(suggestMapping(parsed.headers).id, 4);
  const [expense, income] = previewCSV(parsed);
  assert.equal(expense.type, 'expense');
  assert.equal(expense.amount, 123456);
  assert.equal(expense.externalId, 'A');
  assert.equal(income.type, 'income');
  assert.equal(income.amount, 2050);
});

test('OFX handles both SGML and pretty-printed XML without double decoding', () => {
  const xml = '<OFX><STMTTRN><DTPOSTED>20250110120000[-3:BRT]</DTPOSTED><TRNAMT>\n-123.45\n</TRNAMT><FITID>bank-1</FITID><MEMO>Energia &amp;lt; &#231; &#xE3;</MEMO></STMTTRN></OFX>';
  const row = previewOFX(xml)[0];
  assert.equal(row.date, '2025-01-10');
  assert.equal(row.amount, 12345);
  assert.equal(row.description, 'Energia &lt; ç ã');
  assert.equal(previewOFX('<OFX><STMTTRN><DTPOSTED>20250110\n<TRNAMT>+25.00\n<FITID>2\n<NAME>Recebido\n</STMTTRN></OFX>')[0].type, 'income');
  assert.throws(() => previewOFX('<!DOCTYPE OFX><OFX/>'), /entidades/);
});

test('bank IDs are not silently truncated into duplicate transactions', () => {
  const prefix = 'x'.repeat(120);
  const csv = parseCSV(`Descrição;Data;Valor;ID\nA;2025-01-10;-1;${prefix}1\nA;2025-01-10;-1;${prefix}2`);
  const rows = previewCSV(csv);
  assert.notEqual(importKey(rows[0], 'bank'), importKey(rows[1], 'bank'));
  assert.equal(applyImport(fixture(), rows, 'bank').entries.length, 2);
});

test('a matching unpaid commitment remains available for reconciliation', () => {
  const state = commitment(fixture());
  const [planned] = planImport(state, [movement()], 'bank');
  assert.equal(planned.duplicate, false);
  const next = applyImport(state, [movement({ reconcileId: 'bill' })], 'bank');
  assert.equal(next.entries.length, 1);
  assert.equal(outstanding(next, next.entries[0]), 0);
  assert.equal(balances(next, '2025-01-31').get('bank'), 90000);
  assert.equal(state.payments.length, 0);
});

test('deduplication uses effective payment date/amount instead of due date', () => {
  let state = commitment(fixture(), { dueDate: '2025-01-05' });
  state.payments.push({ id: 'manual', entryId: 'bill', accountId: 'bank', date: '2025-01-10', amount: 4000 });
  state = validateState(state);
  assert.equal(planImport(state, [movement({ amount: 4000 })], 'bank')[0].duplicate, true);
  assert.equal(planImport(state, [movement({ amount: 4000, date: '2025-01-05' })], 'bank')[0].duplicate, false);
});

test('distinct bank IDs allow genuinely identical movements; reimport is idempotent', () => {
  const rows = [movement({ externalId: 'first' }), movement({ externalId: 'second' })];
  const first = applyImport(fixture(), rows, 'bank');
  assert.equal(first.entries.length, 2);
  assert.equal(applyImport(first, rows, 'bank').entries.length, 2);
  assert.equal(planImport(fixture(), [rows[0], rows[0]], 'bank')[1].duplicateReason, 'identificador');
});

test('identical anonymous rows retain multiplicity and reimport only adds missing count', () => {
  const rows = [movement(), movement()];
  assert.equal(planImport(fixture(), rows, 'bank')[1].repeatedInFile, true);
  const first = applyImport(fixture(), rows, 'bank');
  assert.equal(first.entries.length, 2);
  assert.equal(applyImport(first, rows, 'bank').entries.length, 2);
  assert.equal(applyImport(first, [...rows, movement()], 'bank').entries.length, 3);
  const excluded = applyImport(fixture(), [movement({ exclude: true }), movement()], 'bank');
  assert.equal(excluded.entries.length, 1);
  assert.equal(applyImport(excluded, rows, 'bank').entries.length, 2);
});

test('partial reconciliations preserve every bank ID across normalized saves', () => {
  let state = commitment(fixture());
  state = reconcile(state, 'bill', movement({ amount: 3000, externalId: 'a' }), 'bank');
  state = reconcile(state, 'bill', movement({ amount: 2000, externalId: 'b' }), 'bank');
  assert.equal(outstanding(state, state.entries[0]), 5000);
  assert.equal(state.entries[0].dueDate, '2025-01-10');
  assert.equal(state.payments[0].importKey, 'bank|id:a');
  assert.equal(state.payments[1].importKey, 'bank|id:b');
  assert.throws(() => reconcile(state, 'bill', movement({ amount: 3000, externalId: 'a' }), 'bank'), /já importado/);
});

test('anonymous reconciliations deduplicate bank descriptions that differ from the commitment', () => {
  const state = commitment(fixture(), { description: 'Energia mensal', amount: 20000 });
  const rows = [movement({ amount: 3000, reconcileId: 'bill' }), movement({ amount: 3000, reconcileId: 'bill' })];
  const next = applyImport(state, rows, 'bank');
  assert.equal(next.payments.length, 2);
  assert.equal(applyImport(next, rows, 'bank').payments.length, 2);
  assert.equal(applyImport(next, [...rows, movement({ amount: 3000, reconcileId: 'bill' })], 'bank').payments.length, 3);
});

test('known bank IDs do not consume the signature of an unrelated manual payment', () => {
  let state = applyImport(fixture(), [movement({ externalId: 'already-imported' })], 'bank');
  state = commitment(state);
  state.payments.push({ id: 'manual', entryId: 'bill', accountId: 'bank', amount: 10000, date: '2025-01-10' });
  state = validateState(state);
  const planned = planImport(state, [movement({ externalId: 'already-imported' }), movement({ externalId: 'manual-bank-id' }), movement({ externalId: 'new-bank-id' })], 'bank');
  assert.deepEqual(planned.map(row => row.duplicate), [true, true, false]);
});

test('a mixed addition/reconciliation batch preserves commitments and deduplicates atomically', () => {
  const state = commitment(fixture(), { dueDate: '2025-01-05', competence: '2025-01' });
  const rows = [movement({ amount: 6000, externalId: 'partial', reconcileId: 'bill' }), movement({ description: 'Mercado', externalId: 'purchase' })];
  const next = applyImport(state, rows, 'bank');
  assert.equal(next.entries.length, 2);
  assert.equal(next.entries[0].dueDate, '2025-01-05');
  assert.equal(next.payments.length, 2);
  assert.equal(applyImport(next, rows, 'bank').payments.length, 2);
  assert.throws(() => applyImport(state, [...rows, movement({ amount: 6000, externalId: 'too-much', reconcileId: 'bill' })], 'bank'), /saldo suficiente/);
  assert.equal(state.payments.length, 0);
});

test('invalid/future/preopening movements are line errors and cannot partially import', () => {
  const state = fixture();
  const rows = [movement(), movement({ date: '2199-01-01' }), movement({ date: '2024-12-31' })];
  const planned = planImport(state, rows, 'bank');
  assert.match(planned[1].error, /futura/);
  assert.match(planned[2].error, /abertura/);
  assert.throws(() => applyImport(state, rows, 'bank'), /linhas inválidas/);
  assert.equal(applyImport(state, rows.map((row, i) => ({ ...row, exclude: i > 0 })), 'bank').entries.length, 1);
  assert.equal(state.entries.length, 0);
});

test('deduplication stays scoped to the actual statement account and retains old entry keys', () => {
  const state = applyImport(fixture(), [movement({ externalId: 'legacy' })], 'bank');
  delete state.payments[0].importKey;
  assert.equal(planImport(state, [movement({ externalId: 'legacy' })], 'bank')[0].duplicate, true);
  state.accounts.push({ id: 'other', name: 'Outra', kind: 'bank', opening: 0, openingDate: '2025-01-01', archived: false });
  assert.equal(planImport(state, [movement({ externalId: 'legacy' })], 'other')[0].duplicate, false);
});
