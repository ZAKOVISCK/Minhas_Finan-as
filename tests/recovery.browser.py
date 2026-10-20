"""Focused recovery UI integration on the running local app (service workers blocked).
Run the app with npm start, then: python3 tests/recovery.browser.py
Only disposable browser IndexedDB is changed; no remote requests or deployment.
"""
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ORIGIN=(sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:3000').rstrip('/')
if urlparse(ORIGIN).hostname not in ('localhost','127.0.0.1','::1'):
    raise SystemExit('Use somente o servidor local de teste.')
OUT=Path(sys.argv[2] if len(sys.argv)>2 else '/tmp/minhas-financas-recovery-browser.json')
OUT.parent.mkdir(parents=True,exist_ok=True)
PASSWORD='senha-sintetica-de-recuperacao'
results=[]
page_errors=[]
blocked_requests=[]


def ready(page):
    page.goto(ORIGIN+'/',wait_until='networkidle')
    page.locator('main[aria-busy="false"]').wait_for()


def raw(page,slot):
    return page.evaluate('''async slot=>{
      const S=await import('/storage.mjs'),db=await S.openDatabase();
      try{return JSON.parse(JSON.stringify(await S.loadRaw(db,slot)))}finally{db.close()}
    }''',slot)


def personal_dialog(page):
    page.locator('#access-primary').click()
    page.locator('#dialog-form [name="password"]').wait_for()
    assert page.locator('#dialog-title').inner_text()=='Abrir cofre pessoal'
    assert page.locator('#dialog-form [name="confirmation"]').count()==0


def fixture(page,kind):
    return page.evaluate('''async ({kind,password})=>{
      const S=await import('/storage.mjs'),F=await import('/finance.mjs'),C=await import('/crypto.mjs');
      const db=await S.openDatabase();
      try{
        const kdf=C.newKdf(),key=await C.deriveKey(password,kdf),base=F.emptyState('Anterior segura');
        base.accounts=[{id:'recovery_account',name:'Conta recuperável',kind:'bank',opening:10000,openingDate:'2026-01-01',archived:false}];
        const initial=await S.saveSlot(db,'personal',null,base,-1,{key,kdf});
        if(kind==='checkpoint')await S.saveSlot(db,'personal',initial,{...initial,name:'Atual corrompida',accounts:[{...initial.accounts[0],opening:22222}]},0,{key,kdf});
        const before=await S.loadRaw(db,'personal');
        await new Promise((resolve,reject)=>{
          const tx=db.transaction('data','readwrite'),store=tx.objectStore('data');
          if(kind==='orphan')store.delete('head:personal');
          else {before.head.revision='revisao-corrompida';store.put(before.head,'head:personal')}
          tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
        });
        return {base:initial,raw:JSON.parse(JSON.stringify(await S.loadRaw(db,'personal')))};
      }finally{db.close()}
    }''',{'kind':kind,'password':PASSWORD})


with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
    def run(name,test):
        context=browser.new_context(locale='pt-BR',timezone_id='America/Sao_Paulo',service_workers='block',accept_downloads=True)
        def route_request(route):
            if route.request.url.startswith(ORIGIN+'/'):return route.continue_()
            blocked_requests.append(route.request.url)
            return route.abort()
        context.route('**/*',route_request)
        page=context.new_page()
        page.on('pageerror',lambda error:page_errors.append(str(error)))
        try:
            ready(page)
            results.append({'name':name,'passed':True,**test(page)})
        except Exception as error:
            results.append({'name':name,'passed':False,'error':str(error)})
        finally:
            context.close()
        OUT.write_text(json.dumps({'results':results,'pageErrors':page_errors,'blockedRequests':blocked_requests},ensure_ascii=False,indent=2))

    def orphan_personal(page):
        seeded=fixture(page,'orphan')
        ready(page)
        personal_dialog(page)
        assert page.locator('[data-action="personal-raw-export"]').is_visible()
        assert page.locator('[data-action="unlock-checkpoint"]').count()==0
        with page.expect_download() as dl:
            page.locator('[data-action="personal-raw-export"]').click()
        exported=json.loads(Path(dl.value.path()).read_text())
        assert exported['slot']=='personal' and exported['raw']==seeded['raw']
        page.locator('#dialog-form [name="password"]').fill(PASSWORD)
        page.locator('#dialog-submit').click()
        page.locator('#dialog-error:not([hidden])').wait_for()
        error=page.locator('#dialog-error').inner_text()
        assert 'preservados' in error
        assert raw(page,'personal')==seeded['raw']
        return {'offeredUnlockInsteadOfCreate':True,'rawDownloadPreservesRecords':len(exported['raw']['records']),
                'headStillAbsent':'head' not in exported['raw'],'normalUnlockDoesNotOverwrite':True,'visibleError':error}
    run('personal-orphan-unlock-and-export',orphan_personal)

    def checkpoint_recovery(page):
        seeded=fixture(page,'checkpoint')
        ready(page)
        personal_dialog(page)
        page.locator('[data-action="unlock-checkpoint"]').click()
        assert page.locator('#dialog-title').inner_text()=='Recuperar a cópia anterior do cofre'
        assert page.locator('#dialog-form [name="checkpoint"]').input_value()=='true'
        confirmations=[]
        def confirmation(dialog):
            confirmations.append({'type':dialog.type,'message':dialog.message})
            dialog.accept()
        page.on('dialog',confirmation)
        page.locator('#dialog-form [name="password"]').fill('senha-incorreta-sintetica')
        page.locator('#dialog-submit').click()
        page.locator('#dialog-error:not([hidden])').wait_for()
        wrong_error=page.locator('#dialog-error').inner_text()
        assert raw(page,'personal')==seeded['raw']
        assert not confirmations
        page.locator('#dialog-form [name="password"]').fill(PASSWORD)
        page.locator('#dialog-submit').click()
        page.locator('#mode-label.personal').wait_for()
        page.locator('#dialog').wait_for(state='hidden')
        assert len(confirmations)==1 and confirmations[0]['type']=='confirm'
        decoded=page.evaluate('''async password=>{
          const S=await import('/storage.mjs'),C=await import('/crypto.mjs'),db=await S.openDatabase();
          try{const raw=await S.loadRaw(db,'personal');const key=await C.deriveKey(password,raw.head.kdf);return await S.decodeRaw(raw,key)}finally{db.close()}
        }''',PASSWORD)
        assert decoded['name']==seeded['base']['name']
        assert decoded['accounts']==seeded['base']['accounts']
        page.locator('#profile').click()
        page.locator('#main [data-action="name"]').click()
        page.locator('#dialog-form [name="name"]').fill('Recuperado e editável')
        page.locator('#dialog-submit').click()
        page.locator('#dialog').wait_for(state='hidden')
        edited=page.evaluate('''async password=>{
          const S=await import('/storage.mjs'),C=await import('/crypto.mjs'),db=await S.openDatabase();
          try{const raw=await S.loadRaw(db,'personal');const key=await C.deriveKey(password,raw.head.kdf);return await S.decodeRaw(raw,key)}finally{db.close()}
        }''',PASSWORD)
        assert edited['name']=='Recuperado e editável' and edited['revision']==decoded['revision']+1
        return {'wrongPasswordPreservesExactRaw':True,'wrongPasswordConfirmationCount':0,'wrongPasswordError':wrong_error,
                'correctPasswordConfirmationCount':len(confirmations),'recoveredAccounts':len(decoded['accounts']),
                'recoveredOpening':decoded['accounts'][0]['opening'],'recoveredRevision':decoded['revision'],
                'subsequentEditSaved':True,'revisionAfterEdit':edited['revision']}
    run('personal-checkpoint-password-confirmation-and-edit',checkpoint_recovery)

    def demo_orphan(page):
        seeded=page.evaluate('''async()=>{
          const S=await import('/storage.mjs'),F=await import('/finance.mjs'),db=await S.openDatabase();
          try{
            await S.saveSlot(db,'demo',null,F.demo(),-1);
            await new Promise((resolve,reject)=>{const tx=db.transaction('data','readwrite');tx.objectStore('data').delete('head:demo');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});
            return JSON.parse(JSON.stringify(await S.loadRaw(db,'demo')));
          }finally{db.close()}
        }''')
        ready(page)
        page.locator('#access-review:not([hidden])').wait_for()
        assert raw(page,'demo')==seeded
        with page.expect_download() as dl:
            page.locator('#access-review [data-action="retired-demo-export"]').click()
        exported=json.loads(Path(dl.value.path()).read_text())
        assert exported['raw']==seeded
        assert page.locator('#main').inner_text()==''
        assert page.locator('#access-screen').is_visible()
        assert raw(page,'demo')==seeded
        return {'orphanRecordsPreserved':len(seeded['records']),'rawDownloadPreservesRecords':True,'financialDashboardClosed':True}
    run('retired-demo-orphan-preserved-with-export',demo_orphan)

    def demo_checkpoint_only(page):
        seeded=page.evaluate('''async()=>{
          const S=await import('/storage.mjs'),F=await import('/finance.mjs'),db=await S.openDatabase();
          try{
            const current=await S.saveSlot(db,'demo',null,F.demo(),-1);
            await S.saveSlot(db,'demo',current,F.emptyState('Atual vazio'),current.revision);
            await new Promise((resolve,reject)=>{const tx=db.transaction('data','readwrite');tx.objectStore('data').delete('head:demo');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});
            const before=JSON.parse(JSON.stringify(await S.loadRaw(db,'demo')));
            let rejected=false;
            try{await S.saveSlot(db,'demo',null,F.demo(),-1)}catch(error){rejected=/Cabeçalho ausente/.test(error.message)}
            return{before,after:JSON.parse(JSON.stringify(await S.loadRaw(db,'demo'))),rejected};
          }finally{db.close()}
        }''')
        assert not seeded['before']['records'] and seeded['before']['journal']['head']
        assert seeded['rejected'] and seeded['before']==seeded['after']
        ready(page)
        page.locator('#access-review:not([hidden])').wait_for()
        assert raw(page,'demo')==seeded['before']
        with page.expect_download() as dl:
            page.locator('#access-review [data-action="retired-demo-export"]').click()
        exported=json.loads(Path(dl.value.path()).read_text())
        assert exported['raw']==seeded['before']
        recovered=page.evaluate('''async raw=>{const S=await import('/storage.mjs');return S.decodeRaw(S.previousRaw(raw))}''',exported['raw'])
        assert recovered['accounts'] and recovered['name']!='Atual vazio'
        before_personal=raw(page,'personal')
        page.once('dialog',lambda dialog:dialog.accept())
        page.locator('#access-review [data-action="retired-demo-discard"]').click()
        page.locator('#access-review').wait_for(state='hidden')
        cleared=raw(page,'demo')
        assert not cleared.get('head') and not cleared['records'] and not cleared.get('journal')
        assert raw(page,'personal')==before_personal
        return {'creationRejectedWithoutOverwrite':True,'checkpointExportAndDecodePassed':True,'explicitDiscardOnlyTouchesDemo':True}
    run('retired-demo-checkpoint-export-and-explicit-discard',demo_checkpoint_only)
    browser.close()

report={'results':results,'pageErrors':page_errors,'blockedRequests':blocked_requests}
OUT.write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False,indent=2))
if page_errors or any(not result['passed'] for result in results):raise SystemExit(1)
