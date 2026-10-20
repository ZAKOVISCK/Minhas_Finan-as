import { demo, validateState } from "./finance.mjs";
import { loadRaw, decodeRaw, previousRaw, removeDemoSlot, StorageConflict } from "./storage.mjs";

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
