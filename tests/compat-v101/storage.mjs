import {COLLECTIONS,validateState} from './finance.mjs';
import {seal,unseal} from './crypto.mjs';
export class StorageConflict extends Error {constructor(){super('Outra aba alterou os dados. Recarregue antes de continuar.');this.name='StorageConflict';}}
export function openDatabase(factory=globalThis.indexedDB){return new Promise((resolve,reject)=>{if(!factory)return reject(new Error('Armazenamento indisponível.'));let done=false,request;const finish=(error,db)=>{if(done){db?.close();return;}done=true;clearTimeout(timer);error?reject(error):resolve(db);};const timer=setTimeout(()=>finish(new Error('Feche outras abas antigas e recarregue para atualizar o armazenamento.')),5000);try{request=factory.open('minhas-financas-demo',2);}catch(e){finish(e);return;}request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('data'))db.createObjectStore('data');if(!db.objectStoreNames.contains('records')){const store=db.createObjectStore('records',{keyPath:'key'});store.createIndex('slot','slot');}};request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();finish(null,request.result);};request.onerror=()=>finish(request.error);request.onblocked=()=>finish(new Error('Outra aba está impedindo a atualização. Feche-a e recarregue.'));});}
export function readValue(db,key){return new Promise((resolve,reject)=>{let value;const tx=db.transaction('data','readonly');const r=tx.objectStore('data').get(key);r.onsuccess=()=>value=r.result;tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(tx.error||new Error('Falha na leitura.'));tx.onerror=()=>{};});}
export async function loadRaw(db,slot){return new Promise((resolve,reject)=>{let head,records=[],journal;const tx=db.transaction(['data','records'],'readonly'),data=tx.objectStore('data');const h=data.get('head:'+slot),r=tx.objectStore('records').index('slot').getAll(slot),j=data.get('checkpoint:'+slot);h.onsuccess=()=>head=h.result;r.onsuccess=()=>records=r.result;j.onsuccess=()=>journal=j.result;tx.oncomplete=()=>resolve({head,records,journal});tx.onabort=()=>reject(tx.error||new Error('Falha ao ler dados.'));tx.onerror=()=>{};});}
const recordKey=(c,id)=>`${c}:${id}`;
export async function decodeRaw(raw,key){if(!raw.head)return null;const h=raw.head;if(h.version!==3||!Number.isSafeInteger(h.revision)||h.revision<0)throw new Error('Cabeçalho inválido.');if(h.encrypted&&!key)throw new Error('Desbloqueie o cofre.');const root=h.encrypted?await unseal(h.payload,key,'root'):h.payload;if(root.revision!==h.revision)throw new Error('Revisão inconsistente.');const s={...root,...Object.fromEntries(COLLECTIONS.map(c=>[c,[]]))};const expected=new Set(root.recordKeys);if(expected.size!==raw.records.length)throw new Error('Registros ausentes ou duplicados. Recupere uma cópia.');for(let i=0;i<raw.records.length;i+=100){await Promise.all(raw.records.slice(i,i+100).map(async r=>{const rk=recordKey(r.collection,r.id);if(!COLLECTIONS.includes(r.collection)||!expected.delete(rk))throw new Error('Registro inesperado.');const value=h.encrypted?await unseal(r.payload,key,rk):r.payload;if(value.id!==r.id)throw new Error('Registro inconsistente.');s[r.collection].push(value);}));}if(expected.size)throw new Error('Dados incompletos.');const order=new Map(root.recordKeys.map((k,i)=>[k,i]));for(const c of COLLECTIONS)s[c].sort((a,b)=>order.get(recordKey(c,a.id))-order.get(recordKey(c,b.id)));delete s.recordKeys;return validateState(s);}
export function previousRaw(raw){if(!raw.journal?.head)throw new Error('Nenhuma cópia anterior disponível.');const records=new Map(raw.records.map(r=>[r.key,r]));for(const [key,value]of raw.journal.records){if(value)records.set(key,value);else records.delete(key);}return {head:raw.journal.head,records:[...records.values()],journal:null};}
export function diffRecords(before,next,slot){const previous=new Map();if(before)for(const c of COLLECTIONS)for(const x of before[c])previous.set(recordKey(c,x.id),x);const changes=[];for(const c of COLLECTIONS)for(const x of next[c]){const rk=recordKey(c,x.id);if(JSON.stringify(previous.get(rk))!==JSON.stringify(x))changes.push({key:slot+':'+rk,slot,collection:c,id:x.id,value:x});previous.delete(rk);}for(const rk of previous.keys())changes.push({key:slot+':'+rk,remove:true});return changes;}
export async function saveSlot(db,slot,before,candidate,expectedRevision,{key=null,kdf=null,operationId=crypto.randomUUID(),force=false,removeLegacy=false,discardCheckpoint=false,notify=null}={}){
 const next=validateState({...candidate,revision:expectedRevision+1}),encrypted=slot==='personal';if(encrypted&&(!key||!kdf))throw new Error('O cofre precisa estar desbloqueado.');const changes=diffRecords(force?null:before,next,slot);if(force&&before){const keep=new Set(changes.map(c=>c.key));for(const c of COLLECTIONS)for(const x of before[c]){const k=slot+':'+recordKey(c,x.id);if(!keep.has(k))changes.push({key:k,remove:true});}}
 for(let i=0;i<changes.length;i+=100)await Promise.all(changes.slice(i,i+100).map(async c=>{if(!c.remove){c.payload=encrypted?await seal(c.value,key,recordKey(c.collection,c.id)):c.value;delete c.value;}}));
 const root={...next,recordKeys:COLLECTIONS.flatMap(c=>next[c].map(x=>recordKey(c,x.id)))};for(const c of COLLECTIONS)delete root[c];const head={version:3,revision:next.revision,encrypted,kdf:encrypted?kdf:null,operationId,updatedAt:new Date().toISOString(),payload:encrypted?await seal(root,key,'root'):root};
 const result=await new Promise((resolve,reject)=>{
  let saved=head,failure;
  const tx=db.transaction(['data','records'],'readwrite'),data=tx.objectStore('data'),store=tx.objectStore('records');
  const request=data.get('head:'+slot);
  request.onsuccess=()=>{
   const current=request.result;
   if(current?.operationId===operationId){saved=current;return;}
   if((current?.revision??-1)!==expectedRevision){failure=new StorageConflict();tx.abort();return;}
   const journal={head:current||null,records:[]};
   const apply=oldRecords=>{
    const old=new Map(oldRecords.map(r=>[r.key,r]));
    const writes=new Map(changes.map(r=>[r.key,r]));
    if(force)for(const r of oldRecords)if(!writes.has(r.key))writes.set(r.key,{key:r.key,remove:true});
    for(const change of writes.values()){
     journal.records.push([change.key,old.get(change.key)||null]);
     if(change.remove)store.delete(change.key);else store.put(change);
    }
    data.put(head,'head:'+slot);
    data.put(discardCheckpoint?null:journal,'checkpoint:'+slot);
    if(removeLegacy)data.delete('state');
   };
   // Leitura dentro da mesma transação: nenhuma aba pode intercalar alterações.
   if(force){const read=store.index('slot').getAll(slot);read.onsuccess=()=>apply(read.result);}else if(!changes.length)apply([]);else{const old=[];let remaining=changes.length;for(const change of changes){const read=store.get(change.key);read.onsuccess=()=>{if(read.result)old.push(read.result);if(--remaining===0)apply(old);};}}
  };
  tx.oncomplete=()=>resolve(saved);
  tx.onabort=()=>reject(failure||tx.error||new Error('A gravação não foi concluída.'));
  tx.onerror=()=>{};
 });
 // Avisos entre abas são posteriores à confirmação da transação e não invalidam a gravação.
 try{notify?.({slot,revision:result.revision});}catch{/* a revisão transacional protege a próxima escrita */}
 if(result.revision!==next.revision)throw new StorageConflict();return next;
}
export async function storageInfo(){const estimate=await navigator.storage?.estimate?.();return{...estimate,persistent:await navigator.storage?.persisted?.()??false};}
export async function requestPersistence(){return await navigator.storage?.persist?.()??false;}
