"""Actual IndexedDB/WebCrypto regressions in an ephemeral Chromium profile.
Run: python3 tests/storage.browser.py [--root DIR] [--scenario NAME]
Requires Python Playwright and Chromium; no live app or external network is used.
"""
import argparse, json
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

parser=argparse.ArgumentParser()
parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1])
parser.add_argument('--scenario',default='')
parser.add_argument('--output',type=Path)
args=parser.parse_args()
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    context=browser.new_context(locale='pt-BR',timezone_id='America/Sao_Paulo')
    def serve(route):
        name=urlparse(route.request.url).path.lstrip('/')
        if name=='__storage_test__':
            return route.fulfill(content_type='text/html',body='<html lang="pt-BR"><title>Teste isolado</title></html>')
        if name not in ['finance.mjs','legacy-finance.mjs','storage.mjs','crypto.mjs'] or route.request.method!='GET':
            return route.abort()
        route.fulfill(content_type='text/javascript',body=(args.root/name).read_bytes())
    context.route('**/*',serve)
    page=context.new_page()
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto('http://localhost:43113/__storage_test__')
    result=page.evaluate('''async selected=>{
      const S=await import('/storage.mjs'),F=await import('/finance.mjs'),C=await import('/crypto.mjs'),results=[];
      const expect=(value,message)=>{if(!value)throw new Error(message)};
      const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
      const rejects=async(fn,pattern)=>{try{await fn()}catch(e){expect(pattern.test(e.message),`Erro inesperado: ${e.message}`);return e.name}throw new Error('Operação deveria falhar')};
      const account=(id='a')=>({id,name:'Conta '+id,kind:'bank',opening:10000,openingDate:'2026-01-01',archived:false});
      const state=(name='Base')=>{const s=F.emptyState(name);s.accounts=[account()];return F.validateState(s)};
      const reset=()=>new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase('minhas-financas-demo');r.onsuccess=resolve;r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('Conexão de teste ainda aberta'))});
      const put=(db,store,key,value)=>new Promise((resolve,reject)=>{const t=db.transaction(store,'readwrite');const s=t.objectStore(store);key===undefined?s.put(value):s.put(value,key);t.oncomplete=resolve;t.onabort=()=>reject(t.error)});
      const run=async(name,test)=>{if(selected&&selected!==name)return;try{await reset();const evidence=await test();results.push({name,passed:true,...evidence})}catch(error){results.push({name,passed:false,error:error.message})}};
      await run('idempotency',async()=>{
        const db=await S.openDatabase();try{
          const initial=await S.saveSlot(db,'demo',null,state(),-1,{operationId:'initial'});
          const candidate={...initial,name:'Nome confirmado'};
          const saved=await S.saveSlot(db,'demo',initial,candidate,0,{operationId:'stable'});
          const retry=await S.saveSlot(db,'demo',initial,candidate,0,{operationId:'stable'});
          expect(equal(saved,retry),'Retry exato não retornou estado salvo');
          const rejected=await rejects(()=>S.saveSlot(db,'demo',initial,{...candidate,name:'Nunca salvo'},0,{operationId:'stable'}),/Outra aba/);
          const loaded=await S.decodeRaw(await S.loadRaw(db,'demo'));
          expect(loaded.name==='Nome confirmado'&&loaded.revision===1,'Retry alterou armazenamento');
          return {exactRetryRevision:retry.revision,changedRetry:rejected,persistedName:loaded.name};
        }finally{db.close()}
      });
      await run('concurrent-cas',async()=>{
        const a=await S.openDatabase(),b=await S.openDatabase();try{
          const base=await S.saveSlot(a,'demo',null,state(),-1);
          const attempts=await Promise.allSettled([S.saveSlot(a,'demo',base,{...base,name:'A'},0),S.saveSlot(b,'demo',base,{...base,name:'B'},0)]);
          expect(attempts.filter(r=>r.status==='fulfilled').length===1,'Mais de uma gravação ganhou');
          const loser=attempts.find(r=>r.status==='rejected');expect(loser.reason.name==='StorageConflict','Falha de concorrência incorreta');
          const loaded=await S.decodeRaw(await S.loadRaw(a,'demo'));expect(loaded.revision===1,'Revisão incorreta');
          return {winner:loaded.name,revision:loaded.revision,rejected:loser.reason.name};
        }finally{a.close();b.close()}
      });
      await run('encrypted-cas',async()=>{
        const a=await S.openDatabase(),b=await S.openDatabase();try{
          const kdf=C.newKdf(),key=await C.deriveKey('senha-segura-de-teste',kdf),initial=state();
          initial.accounts=Array.from({length:50},(_,i)=>account('a_'+i));
          const base=await S.saveSlot(a,'personal',null,initial,-1,{key,kdf});
          const make=n=>({...base,name:n,accounts:base.accounts.map(x=>({...x,opening:x.opening+(n==='A'?1:2)}))});
          const attempts=await Promise.allSettled([S.saveSlot(a,'personal',base,make('A'),0,{key,kdf}),S.saveSlot(b,'personal',base,make('B'),0,{key,kdf})]);
          expect(attempts.filter(r=>r.status==='fulfilled').length===1,'Criptografia assíncrona perdeu CAS');
          const loaded=await S.decodeRaw(await S.loadRaw(a,'personal'),key),winner=attempts.find(r=>r.status==='fulfilled').value;
          expect(equal(loaded,winner),'Estado criptografado divergiu do vencedor');
          return {winner:loaded.name,records:loaded.accounts.length,revision:loaded.revision};
        }finally{a.close();b.close()}
      });
      await run('checkpoint-and-notify',async()=>{
        const db=await S.openDatabase();try{
          const base=await S.saveSlot(db,'demo',null,state(),-1);
          const saved=await S.saveSlot(db,'demo',base,{...base,name:'Depois',accounts:[{...account(),opening:22222},account('b')]},0,{notify:()=>{throw new Error('Canal indisponível')}});
          const raw=await S.loadRaw(db,'demo'),previous=await S.decodeRaw(S.previousRaw(raw));
          expect(equal(previous,base),'Checkpoint não reconstrói estado anterior');
          expect(equal(await S.decodeRaw(raw),saved),'Falha de notificação reverteu gravação');
          return {previousName:previous.name,savedName:saved.name,checkpointRevision:previous.revision};
        }finally{db.close()}
      });
      await run('legacy-atomic-abort',async()=>{
        const db=await S.openDatabase();const original=IDBObjectStore.prototype.put;
        try{
          const legacy={private:'dados antigos preservados'};await put(db,'data','state',legacy);
          const kdf=C.newKdf(),key=await C.deriveKey('senha-segura-de-teste',kdf);
          let injected=false;
          IDBObjectStore.prototype.put=function(...args){if(!injected&&this.name==='data'&&args[1]==='head:personal'){injected=true;throw new DOMException('Espaço insuficiente simulado','QuotaExceededError')}return original.apply(this,args)};
          const rejected=await rejects(()=>S.saveSlot(db,'personal',null,state(),-1,{key,kdf,removeLegacy:true}),/Espaço insuficiente/);
          IDBObjectStore.prototype.put=original;
          expect(equal(await S.readValue(db,'state'),legacy),'Migração apagou legado antes de commit');
          const aborted=await S.loadRaw(db,'personal');expect(!aborted.head&&!aborted.records.length,'Gravação parcial após quota');
          await S.saveSlot(db,'personal',null,state(),-1,{key,kdf,removeLegacy:true});
          expect(await S.readValue(db,'state')===undefined,'Legado não removido após commit criptografado');
          expect((await S.decodeRaw(await S.loadRaw(db,'personal'),key)).accounts.length===1,'Migração criptografada ilegível');
          return {abortedWith:rejected,legacyPreservedOnAbort:true,removedOnlyAfterCommit:true};
        }finally{IDBObjectStore.prototype.put=original;db.close()}
      });
      await run('key-rotation',async()=>{
        const db=await S.openDatabase();try{
          const kdf=C.newKdf(),key=await C.deriveKey('senha-antiga-de-teste',kdf),newKdf=C.newKdf(),newKey=await C.deriveKey('senha-nova-de-teste',newKdf);
          const base=await S.saveSlot(db,'personal',null,state(),-1,{key,kdf});
          await rejects(()=>S.saveSlot(db,'personal',base,base,0,{key:newKey,kdf:newKdf}),/recriptografar/);
          expect(equal(await S.decodeRaw(await S.loadRaw(db,'personal'),key),base),'Tentativa parcial danificou cofre antigo');
          const saved=await S.saveSlot(db,'personal',base,base,0,{key:newKey,kdf:newKdf,force:true});
          const raw=await S.loadRaw(db,'personal');expect(raw.journal===null,'Checkpoint de chave antiga permaneceu');
          expect(equal(await S.decodeRaw(raw,newKey),saved),'Recriptografia deixou registro antigo');
          await rejects(()=>S.decodeRaw(raw,key),/Senha incorreta|corrompidos/);
          return {revision:saved.revision,oldKeyRejected:true,oldCheckpointDiscarded:true};
        }finally{db.close()}
      });
      await run('authenticated-record-digest',async()=>{
        const db=await S.openDatabase();try{
          const kdf=C.newKdf(),key=await C.deriveKey('senha-segura-de-teste',kdf);
          const base=await S.saveSlot(db,'personal',null,state(),-1,{key,kdf});
          const saved=await S.saveSlot(db,'personal',base,{...base,accounts:[{...account(),opening:22222}]},0,{key,kdf});
          const raw=await S.loadRaw(db,'personal');
          expect(equal(await S.decodeRaw(raw,key),saved),'Digest rejeitou a versão íntegra');
          const root=await C.unseal(raw.head.payload,key,'root');expect(/^[a-f0-9]{64}$/.test(root.stateDigest),'Digest não foi autenticado na raiz');
          const replay=structuredClone(raw),older=raw.journal.records.find(([id,record])=>record&&record.collection==='accounts')[1];
          replay.records[replay.records.findIndex(record=>record.key===older.key)]=older;
          await rejects(()=>S.decodeRaw(replay,key),/não correspondem/);
          const oldRaw=S.previousRaw(raw),oldRoot=await C.unseal(oldRaw.head.payload,key,'root');
          delete oldRoot.stateDigest;oldRaw.head.payload=await C.seal(oldRoot,key,'root');
          expect(equal(await S.decodeRaw(oldRaw,key),base),'Raiz anterior sem digest perdeu compatibilidade');
          return {partialCiphertextReplayRejected:true,encryptedRootDigest:true,oldRootsRemainReadable:true};
        }finally{db.close()}
      });
      await run('orphan-recovery',async()=>{
        const db=await S.openDatabase();try{
          const base=await S.saveSlot(db,'demo',null,state(),-1);
          await new Promise((resolve,reject)=>{const tx=db.transaction('data','readwrite');tx.objectStore('data').delete('head:demo');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});
          await rejects(async()=>S.decodeRaw(await S.loadRaw(db,'demo')),/Cabeçalho ausente/);
          await rejects(()=>S.saveSlot(db,'demo',null,state('Não sobrescrever'),-1),/Cabeçalho ausente/);
          const raw=await S.loadRaw(db,'demo');expect(raw.records.length===1&&!raw.head,'Registros órfãos foram apagados');
          const saved=await S.saveSlot(db,'demo',null,base,-1,{force:true});
          expect(equal(await S.decodeRaw(await S.loadRaw(db,'demo')),saved),'Recuperação explícita falhou');
          return {orphanRecordsPreserved:raw.records.length,recoveredRevision:saved.revision};
        }finally{db.close()}
      });
      await run('invalid-head-recovery',async()=>{
        const db=await S.openDatabase();try{
          const base=await S.saveSlot(db,'demo',null,state(),-1),raw=await S.loadRaw(db,'demo');
          raw.head.revision='corrompida';await put(db,'data','head:demo',raw.head);
          await rejects(()=>S.saveSlot(db,'demo',base,base,0),/Cabeçalho inválido/);
          const saved=await S.saveSlot(db,'demo',base,base,0,{force:true});
          expect(equal(await S.decodeRaw(await S.loadRaw(db,'demo')),saved),'Revisão inválida impediu recuperação');
          return {recoveredRevision:saved.revision};
        }finally{db.close()}
      });
      await run('upgrade-keeps-legacy',async()=>{
        const legacy={version:2,name:'Legado intacto'};
        await new Promise((resolve,reject)=>{const r=indexedDB.open('minhas-financas-demo',1);r.onupgradeneeded=()=>r.result.createObjectStore('data');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;put(db,'data','state',legacy).then(()=>{db.close();resolve()}).catch(reject)}});
        const db=await S.openDatabase();try{
          expect(equal(await S.readValue(db,'state'),legacy),'Upgrade apagou dados v2');
          expect(db.objectStoreNames.contains('records'),'Upgrade não criou armazenamento por registro');
          return {databaseVersion:db.version,legacyPreserved:true};
        }finally{db.close()}
      });
      await run('personal-legacy-deletion-policy',async()=>{
        const db=await S.openDatabase();try{
          await put(db,'data','state',{private:true});
          await rejects(()=>S.saveSlot(db,'demo',null,state(),-1,{removeLegacy:true}),/cofre pessoal/);
          expect((await S.readValue(db,'state')).private===true,'Demo removeu legado');
          return {demoCannotDeleteLegacy:true};
        }finally{db.close()}
      });
      return results;
    }''',args.scenario)
    browser.close()
    report=json.dumps({'results':result,'pageErrors':errors},ensure_ascii=False,indent=2)
    if args.output:args.output.write_text(report)
    print(report)
    if errors or not result or any(not item['passed'] for item in result):raise SystemExit(1)
