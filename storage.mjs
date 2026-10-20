import { COLLECTIONS, validateState } from "./finance.mjs";
import { seal, unseal, validateKdf } from "./crypto.mjs";
export class StorageConflict extends Error {
  constructor() {
    super("Outra aba alterou os dados. Recarregue antes de continuar.");
    this.name = "StorageConflict";
  }
}
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const validRevision = (value) =>
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value < Number.MAX_SAFE_INTEGER - 1;
function checkSlot(slot) {
  if (!["demo", "personal"].includes(slot))
    throw new Error("Espaço de armazenamento inválido.");
}
function checkHead(head, slot) {
  if (
    !object(head) ||
    head.version !== 3 ||
    !validRevision(head.revision) ||
    typeof head.encrypted !== "boolean"
  )
    throw new Error("Cabeçalho inválido.");
  if (slot && head.encrypted !== (slot === "personal"))
    throw new Error("Proteção do espaço inconsistente.");
}
const sameKdf = (a, b) =>
  a?.algorithm === b?.algorithm &&
  a?.hash === b?.hash &&
  a?.iterations === b?.iterations &&
  a?.salt === b?.salt;
const canonical = (value) =>
  JSON.stringify(value, (_key, item) =>
    object(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
async function stateDigest(state) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical(state)),
  );
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
export function openDatabase(factory = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    if (!factory) return reject(new Error("Armazenamento indisponível."));
    let done = false,
      request;
    const finish = (error, db) => {
      if (done) {
        db?.close();
        return;
      }
      done = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(db);
    };
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            "Feche outras abas antigas e recarregue para atualizar o armazenamento.",
          ),
        ),
      5000,
    );
    try {
      request = factory.open("minhas-financas-demo", 2);
    } catch (e) {
      finish(e);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("data")) db.createObjectStore("data");
      if (!db.objectStoreNames.contains("records")) {
        const store = db.createObjectStore("records", { keyPath: "key" });
        store.createIndex("slot", "slot");
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      finish(null, request.result);
    };
    request.onerror = () => finish(request.error);
    request.onblocked = () =>
      finish(
        new Error(
          "Outra aba está impedindo a atualização. Feche-a e recarregue.",
        ),
      );
  });
}
export function readValue(db, key) {
  return new Promise((resolve, reject) => {
    let value;
    const tx = db.transaction("data", "readonly");
    const r = tx.objectStore("data").get(key);
    r.onsuccess = () => (value = r.result);
    tx.oncomplete = () => resolve(value);
    tx.onabort = () => reject(tx.error || new Error("Falha na leitura."));
    tx.onerror = () => {};
  });
}
export async function loadRaw(db, slot) {
  checkSlot(slot);
  return new Promise((resolve, reject) => {
    let head,
      records = [],
      journal;
    const tx = db.transaction(["data", "records"], "readonly"),
      data = tx.objectStore("data");
    const h = data.get("head:" + slot),
      r = tx.objectStore("records").index("slot").getAll(slot),
      j = data.get("checkpoint:" + slot);
    h.onsuccess = () => (head = h.result);
    r.onsuccess = () => (records = r.result);
    j.onsuccess = () => (journal = j.result);
    tx.oncomplete = () => resolve({ slot, head, records, journal });
    tx.onabort = () => reject(tx.error || new Error("Falha ao ler dados."));
    tx.onerror = () => {};
  });
}
const recordKey = (c, id) => `${c}:${id}`;
export async function decodeRaw(raw, key) {
  if (!object(raw) || !Array.isArray(raw.records))
    throw new Error("Formato de armazenamento inválido.");
  if (raw.slot !== undefined) checkSlot(raw.slot);
  if (raw.head == null) {
    if (raw.records.length || raw.journal != null)
      throw new Error(
        "Cabeçalho ausente. Os registros e a cópia anterior foram preservados.",
      );
    return null;
  }
  const h = raw.head;
  checkHead(h, raw.slot);
  if (h.encrypted) validateKdf(h.kdf);
  if (h.encrypted && !key) throw new Error("Desbloqueie o cofre.");
  const root = h.encrypted ? await unseal(h.payload, key, "root") : h.payload;
  if (
    !object(root) ||
    root.revision !== h.revision ||
    !Array.isArray(root.recordKeys)
  )
    throw new Error("Revisão ou índice de registros inconsistente.");
  const s = { ...root, ...Object.fromEntries(COLLECTIONS.map((c) => [c, []])) },
    expected = new Set(root.recordKeys);
  if (
    expected.size !== root.recordKeys.length ||
    expected.size !== raw.records.length
  )
    throw new Error("Registros ausentes ou duplicados. Recupere uma cópia.");
  for (let i = 0; i < raw.records.length; i += 100)
    await Promise.all(
      raw.records.slice(i, i + 100).map(async (r) => {
        if (
          !object(r) ||
          !COLLECTIONS.includes(r.collection) ||
          typeof r.id !== "string"
        )
          throw new Error("Registro inválido.");
        const rk = recordKey(r.collection, r.id);
        if (
          !expected.delete(rk) ||
          (raw.slot && (r.slot !== raw.slot || r.key !== raw.slot + ":" + rk))
        )
          throw new Error("Registro inesperado ou de outro espaço.");
        const value = h.encrypted
          ? await unseal(r.payload, key, rk)
          : r.payload;
        if (!object(value) || value.id !== r.id)
          throw new Error("Registro inconsistente.");
        s[r.collection].push(value);
      }),
    );
  if (expected.size) throw new Error("Dados incompletos.");
  const order = new Map(root.recordKeys.map((k, i) => [k, i]));
  for (const c of COLLECTIONS)
    s[c].sort(
      (a, b) => order.get(recordKey(c, a.id)) - order.get(recordKey(c, b.id)),
    );
  delete s.recordKeys;
  delete s.stateDigest;
  // Hash the stored fields before normalization: future optional defaults must not invalidate old copies.
  if (
    root.stateDigest !== undefined &&
    (!/^[a-f0-9]{64}$/.test(root.stateDigest) ||
      (await stateDigest(s)) !== root.stateDigest)
  )
    throw new Error(
      "Os registros não correspondem à versão salva. Recupere uma cópia íntegra.",
    );
  return validateState(s);
}
export function previousRaw(raw) {
  if (
    !object(raw) ||
    !Array.isArray(raw.records) ||
    !object(raw.journal) ||
    !raw.journal.head
  )
    throw new Error("Nenhuma cópia anterior disponível.");
  checkHead(raw.journal.head, raw.slot);
  // A valid checkpoint remains useful when only the current header was damaged.
  if (
    (validRevision(raw.head?.revision) &&
      raw.journal.head.revision !== raw.head.revision - 1) ||
    !Array.isArray(raw.journal.records)
  )
    throw new Error("Cópia anterior inconsistente.");
  const records = new Map(raw.records.map((r) => [r.key, r])),
    restored = new Set();
  for (const item of raw.journal.records) {
    if (
      !Array.isArray(item) ||
      item.length !== 2 ||
      typeof item[0] !== "string" ||
      restored.has(item[0])
    )
      throw new Error("Cópia anterior inconsistente.");
    const [key, value] = item;
    if (
      (raw.slot && !key.startsWith(raw.slot + ":")) ||
      (value !== null && (!object(value) || value.key !== key))
    )
      throw new Error("Cópia anterior de outro espaço.");
    restored.add(key);
    if (value === null) records.delete(key);
    else records.set(key, value);
  }
  return {
    slot: raw.slot,
    head: raw.journal.head,
    records: [...records.values()],
    journal: null,
  };
}
export function diffRecords(before, next, slot) {
  const previous = new Map();
  if (before)
    for (const c of COLLECTIONS)
      for (const x of before[c]) previous.set(recordKey(c, x.id), x);
  const changes = [];
  for (const c of COLLECTIONS)
    for (const x of next[c]) {
      const rk = recordKey(c, x.id);
      if (JSON.stringify(previous.get(rk)) !== JSON.stringify(x))
        changes.push({
          key: slot + ":" + rk,
          slot,
          collection: c,
          id: x.id,
          value: x,
        });
      previous.delete(rk);
    }
  for (const rk of previous.keys())
    changes.push({ key: slot + ":" + rk, remove: true });
  return changes;
}
export async function saveSlot(
  db,
  slot,
  before,
  candidate,
  expectedRevision,
  {
    key = null,
    kdf = null,
    operationId = crypto.randomUUID(),
    force = false,
    removeLegacy = false,
    discardCheckpoint = false,
    notify = null,
  } = {},
) {
  checkSlot(slot);
  if (
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < -1 ||
    expectedRevision >= Number.MAX_SAFE_INTEGER - 2
  )
    throw new Error("Revisão esperada inválida.");
  if (
    typeof operationId !== "string" ||
    !operationId ||
    operationId.length > 100
  )
    throw new Error("Identificador de operação inválido.");
  const next = validateState({ ...candidate, revision: expectedRevision + 1 }),
    encrypted = slot === "personal";
  if (encrypted && (!key || !kdf))
    throw new Error("O cofre precisa estar desbloqueado.");
  if (encrypted) kdf = validateKdf(kdf);
  if (removeLegacy && !encrypted)
    throw new Error(
      "Migre os dados antigos para o cofre pessoal antes de removê-los.",
    );
  const changes = diffRecords(
    force || expectedRevision === -1 ? null : before,
    next,
    slot,
  );
  for (let i = 0; i < changes.length; i += 100)
    await Promise.all(
      changes.slice(i, i + 100).map(async (c) => {
        if (!c.remove) {
          c.payload = encrypted
            ? await seal(c.value, key, recordKey(c.collection, c.id))
            : c.value;
          delete c.value;
        }
      }),
    );
  const root = {
    ...next,
    recordKeys: COLLECTIONS.flatMap((c) =>
      next[c].map((x) => recordKey(c, x.id)),
    ),
    stateDigest: await stateDigest(next),
  };
  for (const c of COLLECTIONS) delete root[c];
  const head = {
    version: 3,
    revision: next.revision,
    encrypted,
    kdf: encrypted ? structuredClone(kdf) : null,
    operationId,
    updatedAt: new Date().toISOString(),
    payload: encrypted ? await seal(root, key, "root") : root,
  };
  let replay = false;
  await new Promise((resolve, reject) => {
    let failure;
    const tx = db.transaction(["data", "records"], "readwrite"),
      data = tx.objectStore("data"),
      store = tx.objectStore("records");
    const abort = (error) => {
      failure = error;
      tx.abort();
    };
    const safely = (callback) => (event) => {
      try {
        callback(event);
      } catch (error) {
        abort(error);
      }
    };
    const request = data.get("head:" + slot);
    request.onsuccess = safely(() => {
      const current = request.result;
      if (current?.operationId === operationId) {
        replay = true;
        return;
      }
      // Corrupt revisions require explicit recovery; a normal edit never replaces them.
      const actualRevision =
        current == null
          ? -1
          : validRevision(current.revision)
            ? current.revision
            : 0;
      if (actualRevision !== expectedRevision) {
        abort(new StorageConflict());
        return;
      }
      if (current != null && !force) checkHead(current, slot);
      const rotatedKey =
        encrypted && current != null && !sameKdf(current.kdf, kdf);
      if (rotatedKey && !force)
        throw new Error(
          "A troca da senha exige recriptografar todos os registros.",
        );
      const journal = { head: current || null, records: [] };
      const apply = (oldRecords) => {
        const old = new Map(oldRecords.map((r) => [r.key, r]));
        const writes = new Map(changes.map((r) => [r.key, r]));
        if (force)
          for (const r of oldRecords)
            if (!writes.has(r.key))
              writes.set(r.key, { key: r.key, remove: true });
        for (const change of writes.values()) {
          journal.records.push([change.key, old.get(change.key) || null]);
          if (change.remove) store.delete(change.key);
          else store.put(change);
        }
        data.put(head, "head:" + slot);
        data.put(
          discardCheckpoint || rotatedKey ? null : journal,
          "checkpoint:" + slot,
        );
        if (removeLegacy) data.delete("state");
      };
      // Leitura dentro da mesma transação: nenhuma aba pode intercalar alterações.
      if (force || current == null) {
        const read = store.index("slot").getAll(slot);
        read.onsuccess = safely(() => {
          if (!force && read.result.length)
            throw new Error(
              "Cabeçalho ausente. Exporte os registros preservados antes de recuperar.",
            );
          if (!force && current == null) {
            const checkpoint = data.get("checkpoint:" + slot);
            checkpoint.onsuccess = safely(() => {
              if (checkpoint.result != null)
                throw new Error(
                  "Cabeçalho ausente. Exporte a cópia anterior preservada antes de recuperar.",
                );
              apply(read.result);
            });
          } else apply(read.result);
        });
      } else if (!changes.length) apply([]);
      else {
        const old = [];
        let remaining = changes.length;
        for (const change of changes) {
          const read = store.get(change.key);
          read.onsuccess = safely(() => {
            if (read.result) old.push(read.result);
            if (--remaining === 0) apply(old);
          });
        }
      }
    });
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(failure || tx.error || new Error("A gravação não foi concluída."));
    tx.onerror = () => {};
  });
  let saved = next;
  if (replay) {
    // Retry may confirm a stored result, but must never announce a different unsaved candidate.
    saved = await decodeRaw(await loadRaw(db, slot), key);
    if (!saved || JSON.stringify(saved) !== JSON.stringify(next))
      throw new StorageConflict();
  }
  // Avisos entre abas são posteriores à confirmação da transação e não invalidam a gravação.
  try {
    notify?.({ slot, revision: saved.revision });
  } catch {
    /* a revisão transacional protege a próxima escrita */
  }
  return saved;
}
export async function storageInfo() {
  const storage = globalThis.navigator?.storage;
  const estimate = await storage?.estimate?.();
  return { ...estimate, persistent: (await storage?.persisted?.()) ?? false };
}
export async function requestPersistence() {
  return (await globalThis.navigator?.storage?.persist?.()) ?? false;
}
