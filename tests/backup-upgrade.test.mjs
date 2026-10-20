import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, validateState, serializeBackup, parseBackup, MAX_BACKUP_BYTES } from '../public/finance.mjs';

test('a schema 3 backup at the former 32 MiB boundary remains readable after adding the category catalog', () => {
  const oldLimit = 32 * 1024 * 1024;
  const state = emptyState('Limite', '2026-10-20');
  delete state.categories;
  state.accounts.push({ id: 'bank', name: 'Conta', kind: 'bank', opening: 0, openingDate: '2026-10-20', archived: false });
  const control = '\u0001';
  state.entries = Array.from({ length: 3213 }, (_, index) => ({
    id: 'entry-' + index, description: control.repeat(100), type: 'expense', category: 'Outros',
    amount: 1, dueDate: '2026-10-20', competence: '2026-10', accountId: 'bank', cardId: null,
    statementMonth: null, origin: control.repeat(400), importKey: control.repeat(400),
    recurrenceKey: String(index).padEnd(400, control), groupId: control.repeat(400), assumedDate: false,
  }));
  const bytes = value => Buffer.byteLength(JSON.stringify(value));
  let size = bytes(state);
  // Each removed control character removes exactly six serialized JSON bytes.
  // Calibrate the last records so the fixture stays inside the old supported cap.
  for (const row of state.entries.slice(-2).reverse()) {
    for (const field of ['origin', 'importKey', 'groupId', 'description', 'recurrenceKey']) {
      if (size <= oldLimit - 100) break;
      const remove = Math.min(row[field].length - 10, Math.ceil((size - oldLimit + 100) / 6));
      row[field] = row[field].slice(0, -remove);
      size = bytes(state);
    }
  }
  assert.ok(size <= oldLimit && size >= oldLimit - 110, 'fixture must exercise the old boundary');
  const upgraded = validateState(state, '2026-10-20');
  assert.ok(bytes(upgraded) > oldLimit, 'the added catalog must cross the old boundary');
  assert.ok(bytes(upgraded) < MAX_BACKUP_BYTES);
  assert.deepEqual(upgraded.entries, state.entries);
  assert.deepEqual(upgraded.accounts, state.accounts);
  const restored = parseBackup(serializeBackup(upgraded));
  assert.deepEqual(restored, upgraded);
});
