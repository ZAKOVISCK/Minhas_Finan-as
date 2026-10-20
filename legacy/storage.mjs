import { revisionOf, validateState } from './finance.mjs';

export class StorageConflict extends Error {
  constructor() { super('Os dados mudaram em outra aba. Atualize os dados antes de continuar.'); this.name = 'StorageConflict'; }
}

export function openDatabase(factory = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    if (!factory) return reject(new Error('Armazenamento indisponível.'));
    let request;
    let finished = false;
    const finish = (error, db) => {
      if (finished) { db?.close(); return; }
      finished = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(db);
    };
    const timer = setTimeout(() => finish(new Error('O armazenamento não respondeu. Feche outras abas e tente novamente.')), 5000);
    try { request = factory.open('minhas-financas-demo', 1); } catch (error) { finish(error); return; }
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('data')) request.result.createObjectStore('data'); };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      finish(null, db);
    };
    request.onerror = () => finish(request.error || new Error('Falha ao abrir o armazenamento.'));
    request.onblocked = () => finish(new Error('O armazenamento está bloqueado por outra aba. Feche-a e recarregue.'));
  });
}

export function loadState(db) {
  return new Promise((resolve, reject) => {
    let transaction;
    let value;
    try {
      transaction = db.transaction('data', 'readonly');
      const request = transaction.objectStore('data').get('state');
      request.onsuccess = () => { value = request.result; };
    } catch (error) { reject(error); return; }
    transaction.oncomplete = () => resolve(value);
    transaction.onabort = () => reject(transaction.error || new Error('Falha ao carregar dados.'));
    transaction.onerror = () => { /* onabort encerra a promessa. */ };
  });
}

// A comparação e a gravação acontecem na mesma transação, inclusive entre abas.
export function saveState(db, candidate, expectedRevision) {
  const safe = validateState(candidate);
  return new Promise((resolve, reject) => {
    let transaction;
    let saved;
    let failure;
    try {
      transaction = db.transaction('data', 'readwrite');
      const store = transaction.objectStore('data');
      const request = store.get('state');
      request.onsuccess = () => {
        const actual = request.result === undefined ? -1 : revisionOf(request.result);
        if (actual !== expectedRevision) {
          failure = new StorageConflict();
          transaction.abort();
          return;
        }
        saved = { ...safe, revision: expectedRevision + 1 };
        store.put(saved, 'state');
      };
    } catch (error) { reject(error); return; }
    transaction.oncomplete = () => resolve(saved);
    transaction.onabort = () => reject(failure || transaction.error || new Error('Não foi possível gravar os dados.'));
    transaction.onerror = () => { /* Nunca anunciar sucesso antes de oncomplete. */ };
  });
}
