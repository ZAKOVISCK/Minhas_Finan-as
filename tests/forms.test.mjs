import test from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../public/finance.mjs';
import { field, select, amountField, dateField, FormValidationError, validateFormData } from '../public/form-utils.mjs';

const TODAY = '2026-10-20';
function fixture() {
  const state = F.emptyState('Formulários', '2026-09-01');
  state.accounts = [
    { id: 'checking', name: 'Conta', kind: 'bank', opening: 100000, openingDate: '2026-09-01', archived: false },
    { id: 'broker', name: 'Corretora', kind: 'investment', opening: 0, openingDate: '2026-09-02', archived: false },
  ];
  state.cards = [{ id: 'cardA', name: 'Cartão', limit: 100000, closingDay: 15, dueDay: 25, accountId: 'checking' }];
  state.entries = [
    { id: 'bill', description: 'Conta parcial', type: 'expense', category: 'Outros', amount: 10000, dueDate: '2026-10-01', competence: '2026-10', accountId: 'checking', cardId: null },
    { id: 'card-bill', description: 'Compra no cartão', type: 'expense', category: 'Outros', amount: 7000, dueDate: '2026-10-25', competence: '2026-10', accountId: 'checking', cardId: 'cardA', statementMonth: '2026-10' },
  ];
  state.payments = [{ id: 'partial', entryId: 'bill', accountId: 'checking', amount: 2500, date: '2026-09-03' }];
  state.assets = [{ id: 'assetA', symbol: 'AAA3', name: 'Ação', kind: 'stock', manualPrice: null }];
  state.trades = [{ id: 'buyA', assetId: 'assetA', accountId: 'checking', side: 'buy', quantity: 2 * F.SCALE, price: 1000, fees: 0, date: '2026-09-02', sequence: 0 }];
  return F.validateState(state, TODAY);
}
const entry = (overrides = {}) => ({ description: 'Cadastro', type: 'expense', amount: '100,00', dueDate: '2026-10-30', competence: '2026-10', category: 'Outros', accountId: 'checking', ...overrides });
const trade = (overrides = {}) => ({ assetId: 'assetA', accountId: 'checking', side: 'buy', quantity: '1', price: '10,00', fees: '0,00', date: TODAY, ...overrides });
function valid(kind, data, options = {}, state = fixture()) {
  assert.doesNotThrow(() => validateFormData(kind, data, state, { today: TODAY, ...options }));
}
function invalid(kind, data, expectedField, options = {}, state = fixture()) {
  assert.throws(() => validateFormData(kind, data, state, { today: TODAY, ...options }), error => {
    assert.ok(error instanceof FormValidationError);
    assert.equal(error.field, expectedField);
    assert.ok(error.message.length > 10);
    return true;
  });
}

test('labelled inputs and selects escape dynamic text and preserve their signatures', () => {
  const html = field('<Nome>', 'name"', 'text', '<script>" &', 'maxlength="60" required');
  assert.match(html, /&lt;Nome&gt;/);
  assert.match(html, /name="name&quot;"/);
  assert.match(html, /value="&lt;script&gt;&quot; &amp;"/);
  assert.match(html, /maxlength="60" required/);
  const choice = select('Opção <', 'kind', [['<id>', '<nome>']], '<id>');
  assert.match(choice, /Opção &lt;/);
  assert.match(choice, /value="&lt;id&gt;" selected/);
  assert.match(choice, /&lt;nome&gt;/);
});

test('amount/date helpers render cents and keep incomplete drafts unchanged', () => {
  assert.match(amountField('Valor', 'amount', 123456), /value="1234,56"/);
  assert.match(amountField('Valor', 'amount', '12,'), /value="12,"/);
  assert.match(amountField('Valor', 'amount', 0), /value="0,00"/);
  assert.match(dateField('Data', 'date', '2026-10-20'), /type="date" value="2026-10-20"/);
  assert.match(dateField('Data', 'date'), new RegExp(`value="${F.localDate()}"`));
});

test('monetary validation identifies its named control and distinguishes positive from zero', () => {
  invalid('entry', entry({ amount: '0,00' }), 'amount');
  invalid('entry', entry({ amount: '1,234' }), 'amount');
  valid('budget', { month: '2026-10', category: 'Outros', amount: '0,00' });
  valid('reserve', { month: '2026-10', amount: '0,00' });
  invalid('goal', { name: 'Meta', target: '100,00', allocated: '-1,00', dueDate: TODAY }, 'allocated');
  valid('account', { name: 'Saldo devedor', kind: 'bank', opening: '-100,01', openingDate: TODAY });
});

test('entry edits preserve payment constraints and card expense type', () => {
  valid('entry', entry({ amount: '25,00' }), { id: 'bill' });
  invalid('entry', entry({ amount: '24,99' }), 'amount', { id: 'bill' });
  invalid('entry', entry({ type: 'income' }), 'type', { id: 'card-bill' });
  valid('entry', entry({ dueDate: '2027-10-20', competence: '2027-10' }));
});

test('realized entry dates link future and pre-opening errors to paymentDate', () => {
  invalid('entry', entry({ paid: 'on', paymentDate: '2026-10-21' }), 'paymentDate');
  invalid('entry', entry({ paid: 'on', paymentDate: '2026-08-31' }), 'paymentDate');
  valid('entry', entry({ paid: 'on', paymentDate: '2026-09-01' }));
  invalid('entry', entry({ competence: '2026-13' }), 'competence');
  invalid('entry', entry({ dueDate: '2026-02-30' }), 'dueDate');
});

test('partial payments allow the remaining amount and point excess to amount', () => {
  valid('payment', { amount: '75,00', date: TODAY, accountId: 'checking' }, { id: 'bill' });
  invalid('payment', { amount: '75,01', date: TODAY, accountId: 'checking' }, 'amount', { id: 'bill' });
  invalid('payment', { amount: '10,00', date: '2026-09-01', accountId: 'broker' }, 'date', { id: 'bill' });
  invalid('payment', { amount: '10,00', date: TODAY, accountId: 'missing' }, 'accountId', { id: 'bill' });
});

test('account opening edits cannot invalidate earlier real movements', () => {
  valid('account', { name: 'Conta', kind: 'bank', opening: '0,00', openingDate: '2026-09-01' }, { id: 'checking' });
  invalid('account', { name: 'Conta', kind: 'bank', opening: '0,00', openingDate: '2026-09-03' }, 'openingDate', { id: 'checking' });
});

test('transfer validation identifies destination and requires a date valid for both accounts', () => {
  const data = { fromId: 'checking', toId: 'broker', amount: '10,00', date: TODAY };
  valid('transfer', data);
  invalid('transfer', { ...data, toId: 'checking' }, 'toId');
  invalid('transfer', { ...data, date: '2026-09-01' }, 'date');
  invalid('transfer', { ...data, date: '2026-10-21' }, 'date');
});

test('card days and purchases retain existing cent/date rules', () => {
  const card = { name: 'Cartão', limit: '0,00', closingDay: '31', dueDay: '31', accountId: 'checking' };
  valid('card', card);
  invalid('card', { ...card, closingDay: '0' }, 'closingDay');
  invalid('card', { ...card, dueDay: '2.5' }, 'dueDay');
  const purchase = { description: 'Compra', amount: '100,01', date: TODAY, category: 'Outros', installments: '3', firstStatement: '2026-10' };
  valid('purchase', purchase, { id: 'cardA' });
  invalid('purchase', { ...purchase, amount: '0,02' }, 'installments', { id: 'cardA' });
  invalid('purchase', { ...purchase, date: '2026-10-21' }, 'date', { id: 'cardA' });
  invalid('purchase', { ...purchase, firstStatement: '2199-12' }, 'firstStatement', { id: 'cardA' });
});

test('statement validation uses the selected statement month without duplicating purchases', () => {
  const data = { amount: '70,00', date: TODAY, accountId: 'checking' };
  valid('statement', data, { id: 'cardA', month: '2026-10' });
  invalid('statement', { ...data, amount: '70,01' }, 'amount', { id: 'cardA', month: '2026-10' });
  invalid('statement', { ...data, amount: '1,00' }, 'amount', { id: 'cardA', month: '2026-11' });
});

test('goals allow surplus allocation as the domain does and recurrence intervals include equal months', () => {
  valid('goal', { name: 'Meta atingida', target: '10,00', allocated: '12,00', dueDate: TODAY });
  const data = { description: 'Mensalidade', type: 'expense', category: 'Outros', accountId: 'checking', amount: '15,00', day: '31', start: '2026-10', end: '2026-10' };
  valid('recurrence', data);
  invalid('recurrence', { ...data, end: '2026-09' }, 'end');
  invalid('recurrence', { ...data, day: '32' }, 'day');
});

test('assets reject duplicate normalized codes and allow editing their own code', () => {
  const data = { symbol: 'aaa3', name: 'Ação', kind: 'stock' };
  invalid('asset', data, 'symbol');
  valid('asset', data, { id: 'assetA' });
  invalid('asset', { ...data, symbol: '   ' }, 'symbol', { id: 'assetA' });
});

test('trade fields distinguish quantity, zero price and event costs', () => {
  valid('trade', trade());
  invalid('trade', trade({ quantity: '0,0000001' }), 'quantity');
  invalid('trade', trade({ price: '0,00' }), 'price');
  valid('trade', trade({ side: 'split', quantity: '2', price: '0,00' }));
  invalid('trade', trade({ side: 'split', price: '1,00' }), 'price');
  invalid('trade', trade({ side: 'split', price: '0,00', fees: '1,00' }), 'fees');
  invalid('trade', trade({ date: '2026-08-31' }), 'date');
  invalid('trade', trade({ side: 'sell', quantity: '2,000001' }), 'quantity');
  valid('trade', trade({ side: 'sell', quantity: '2' }));
});

test('split events do not silently discard a fraction below the supported precision', () => {
  const state = fixture();
  state.trades[0].quantity = 1;
  invalid('trade', trade({ side: 'split', quantity: '0,5', price: '0,00' }), 'quantity', {}, state);
});

test('announced dividends can be future; received dividends and quotes cannot', () => {
  const data = { assetId: 'assetA', accountId: 'checking', amount: '10,00', date: '2026-11-01', status: 'announced' };
  valid('dividend', data);
  invalid('dividend', { ...data, status: 'received' }, 'date');
  valid('dividend', { ...data, status: 'received', date: TODAY });
  invalid('price', { assetId: 'assetA', price: '10,00', date: '2026-11-01', source: 'Manual' }, 'date');
  valid('snapshot', { amount: '0,00', date: TODAY, source: '' });
});

test('custom and archived categories remain valid historical choices', () => {
  const state = F.addCategory(fixture(), 'Pets', 'pets');
  valid('entry', entry({ category: 'Pets' }), {}, state);
  state.categories.find(row => row.id === 'pets').archived = true;
  valid('entry', entry({ category: 'Pets' }), {}, state);
  invalid('entry', entry({ category: 'Inexistente' }), 'category', {}, state);
  invalid('category', { name: 'pets' }, 'name', {}, state);
  valid('category', { name: 'PETS' }, { id: 'pets' }, state);
});

test('validation preserves input and financial state on success and failure', () => {
  const state = fixture(), before = structuredClone(state), data = Object.freeze(entry());
  valid('entry', data, {}, state);
  invalid('entry', { ...data, amount: '1,234' }, 'amount', {}, state);
  assert.deepEqual(state, before);
  assert.deepEqual(data, entry());
  valid('restore', { amount: 'invalid-for-an-entry' }, {}, state);
});

test('password confirmation identifies the confirmation control without echoing secrets', () => {
  const data = Object.freeze({ name: 'Meu cofre', password: 'senha apenas para testes', confirmation: 'outra senha de teste', current: 'senha atual de teste' });
  invalid('create', data, 'confirmation');
  invalid('change-password', data, 'confirmation');
  valid('create', { ...data, confirmation: data.password });
  valid('change-password', { ...data, confirmation: data.password });
  invalid('create', { ...data, password: 'curta' }, 'password');
  invalid('change-password', { ...data, current: '' }, 'current');
  try { validateFormData('create', data, fixture(), { today: TODAY }); }
  catch (error) {
    assert.ok(!error.message.includes(data.password));
    assert.ok(!error.message.includes(data.confirmation));
  }
  assert.equal(data.confirmation, 'outra senha de teste');
});

test('simulation errors identify rate or time while import selection checks account/category', () => {
  valid('simulate', { principal: '100,00', rate: '10', days: '365' });
  invalid('simulate', { principal: '100,00', rate: '-1', days: '365' }, 'rate');
  invalid('simulate', { principal: '100,00', rate: '10', days: '0' }, 'days');
  valid('import', { accountId: 'checking', category: 'Outros', encoding: 'utf-8' });
  invalid('import', { accountId: 'missing', category: 'Outros', encoding: 'utf-8' }, 'accountId');
});
