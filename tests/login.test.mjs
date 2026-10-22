import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createPersonalVault, openLocalSpace } from '../public/access.mjs';
import * as S from '../public/storage.mjs';
import * as F from '../public/finance.mjs';
import * as C from '../public/crypto.mjs';

const password = 'senha sintética exclusiva para validar login 2026';
const raw = async (db, slot) => JSON.stringify(await S.loadRaw(db, slot));

test('login: novo acesso nasce vazio e criptografado, sem gravar espaço sem senha', async () => {
  const db = await S.openDatabase(new IDBFactory());
  try {
    const result = await createPersonalVault(db, { name: 'Pessoa QA', password });
    for (const collection of F.COLLECTIONS) assert.equal(result.state[collection].length, 0);
    const stored = await S.loadRaw(db, 'personal');
    assert.equal(stored.head.encrypted, true);
    assert.doesNotMatch(JSON.stringify(stored), /Pessoa QA|senha sintética/);
    assert.equal((await S.loadRaw(db, 'local')).head, undefined);
    assert.equal((await S.decodeRaw(stored, result.key)).name, 'Pessoa QA');
  } finally { db.close(); }
});

test('login: copiar dados 1.3 preserva IDs, cálculos e bytes da origem e checkpoint', async () => {
  const db = await S.openDatabase(new IDBFactory());
  try {
    const initial = await openLocalSpace(db);
    const snapshot = await S.saveSlot(db, 'local', initial, F.demo('2026-10-20'), initial.revision);
    const original = await raw(db, 'local');
    const result = await createPersonalVault(db, { name: 'Titular QA', password, includeLocal: true });
    assert.equal(result.copiedLocal, true);
    for (const collection of F.COLLECTIONS) assert.deepEqual(result.state[collection], snapshot[collection]);
    assert.deepEqual([...F.balances(result.state, '2026-10-31')], [...F.balances(snapshot, '2026-10-31')]);
    assert.equal(await raw(db, 'local'), original);
    const stored = await S.loadRaw(db, 'personal');
    assert.equal(stored.records.length, (await S.loadRaw(db, 'local')).records.length);
    assert.deepEqual(await S.decodeRaw(stored, result.key), result.state);
    await assert.rejects(S.decodeRaw(stored), /Desbloqueie/);
    const before = await raw(db, 'personal');
    const wrong = await C.deriveKey('outra senha sintética incorreta', stored.head.kdf);
    await assert.rejects(S.decodeRaw(stored, wrong));
    assert.equal(await raw(db, 'personal'), before);
  } finally { db.close(); }
});

test('login: novo cadastro nunca substitui um cofre existente ou seu checkpoint', async () => {
  const db = await S.openDatabase(new IDBFactory());
  try {
    const result = await createPersonalVault(db, { name: 'Existente', password });
    await S.saveSlot(db, 'personal', result.state, { ...result.state, name: 'Com histórico' }, result.state.revision, result);
    const before = await raw(db, 'personal');
    await assert.rejects(createPersonalVault(db, { name: 'Substituto', password, includeLocal: true }), S.StorageConflict);
    assert.equal(await raw(db, 'personal'), before);
  } finally { db.close(); }
});

test('login: erro na origem ou senha curta preserva registros e não cria cofre parcial', async () => {
  const db = await S.openDatabase(new IDBFactory());
  try {
    await openLocalSpace(db);
    await new Promise((resolve, reject) => {
      const tx = db.transaction('data', 'readwrite');
      tx.objectStore('data').put({ invalid: true }, 'head:local');
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
    });
    const before = await raw(db, 'local');
    await assert.rejects(createPersonalVault(db, { name: 'QA', password, includeLocal: true }));
    await assert.rejects(createPersonalVault(db, { name: 'QA', password: 'curta' }), /12 a 256/);
    assert.equal(await raw(db, 'local'), before);
    assert.equal((await S.loadRaw(db, 'personal')).head, undefined);
  } finally { db.close(); }
});

test('login: cadastros concorrentes criam um único cofre sem duplicação financeira', async () => {
  const factory = new IDBFactory(), a = await S.openDatabase(factory), b = await S.openDatabase(factory);
  try {
    const initial = await openLocalSpace(a);
    await S.saveSlot(a, 'local', initial, F.demo('2026-10-20'), initial.revision);
    const results = await Promise.allSettled([a, b].map(db => createPersonalVault(db, { name: 'QA', password, includeLocal: true })));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.ok(results.find(result => result.status === 'rejected').reason instanceof S.StorageConflict);
    const success = results.find(result => result.status === 'fulfilled').value;
    assert.deepEqual(await S.decodeRaw(await S.loadRaw(a, 'personal'), success.key), success.state);
    assert.equal(new Set(success.state.entries.map(entry => entry.id)).size, success.state.entries.length);
  } finally { a.close(); b.close(); }
});
