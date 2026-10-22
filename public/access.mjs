import { demo, emptyState, validateState } from "./finance.mjs";
import { loadRaw, decodeRaw, previousRaw, saveSlot, removeDemoSlot, StorageConflict } from "./storage.mjs";
import { newKdf, deriveKey } from "./crypto.mjs";

/** Create a local password-protected account without altering any older slot.
 * A selected 1.3 snapshot is copied once, retaining every financial identifier.
 */
export async function createPersonalVault(db, { name, password, includeLocal = false, operationId }) {
  const existing = await loadRaw(db, "personal");
  if (existing.head || existing.records.length || existing.journal) throw new StorageConflict();
  if (typeof password !== "string" || password.length < 12 || password.length > 256)
    throw new Error("Use uma senha de 12 a 256 caracteres.");
  const local = includeLocal ? await decodeRaw(await loadRaw(db, "local")) : null;
  const fresh = local ? validateState({ ...local, name }) : emptyState(name);
  const kdf = newKdf(), key = await deriveKey(password, kdf);
  const state = await saveSlot(db, "personal", null, fresh, -1, { key, kdf, operationId });
  return { state, key, kdf, copiedLocal: !!local };
}

/** A separate open workspace. Existing encrypted vaults are never rewritten. */
export async function openLocalSpace(db) {
  const current = await decodeRaw(await loadRaw(db, "local"));
  if (current) return current;
  try { return await saveSlot(db, "local", null, emptyState(), -1); }
  catch (error) {
    if (!(error instanceof StorageConflict)) throw error;
    const saved = await decodeRaw(await loadRaw(db, "local"));
    if (!saved) throw error;
    return saved;
  }
}

function canonical(value) {
  if(Array.isArray(value))return value.map(canonical).sort((a,b)=>
    JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if(value && typeof value==="object")return Object.fromEntries(
    Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
/** Recognize only an untouched, built-in fixture. Names, amounts, IDs and
 * checkpoints changed by a person are preserved for explicit review.
 */
export function isBuiltInDemo(state) {
  try {
    const actual=validateState(state),expected=demo(actual.createdAt);
    actual.revision=expected.revision=0;
    return JSON.stringify(canonical(actual))===JSON.stringify(canonical(expected));
  } catch {return false;}
}
export async function retireBuiltInDemo(db) {
  const raw=await loadRaw(db,"demo");
  if(!raw.head && !raw.records.length && !raw.journal)return{status:"none",raw:null};
  try {
    if(!isBuiltInDemo(await decodeRaw(raw)))return{status:"review",raw};
    if(raw.journal && !isBuiltInDemo(await decodeRaw(previousRaw(raw))))return{status:"review",raw};
  } catch {return{status:"review",raw};}
  try {await removeDemoSlot(db,raw);return{status:"removed",raw:null};}
  catch(error) {
    if(!(error instanceof StorageConflict))throw error;
    const latest=await loadRaw(db,"demo");
    return !latest.head && !latest.records.length && !latest.journal
      ? {status:"removed",raw:null} : {status:"review",raw:latest};
  }
}
