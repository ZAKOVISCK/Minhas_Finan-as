"""Compatibility checks of the local app in real Playwright browser engines.

Start the app separately, then run:
  python tests/compat.browser.py --browser chromium
  PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright python tests/compat.browser.py --browser all

Requires Python Playwright and the selected browser engine. Chromium can use the
system executable, or --executable can select a binary for one engine. Firefox
and WebKit normally require `python -m playwright install firefox webkit` first.
WebKit here is Linux WebKit, not Safari on an iPhone. Viewport changes do not
simulate an actual mobile keyboard, screen reader, or physical device.

Only disposable profiles and synthetic data are used. External browser requests
are blocked; public-market responses are deliberately unavailable for these core
tests. Missing engines are reported as blocked and produce a nonzero exit code.
"""

import argparse
import json
import os
import re
import shutil
import tempfile
import traceback
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright


ROUTES = {
    "inicio": "Visão geral",
    "lancamentos": "Lançamentos",
    "contas": "Contas e cartões",
    "planejamento": "Planejamento",
    "investimentos": "Investimentos",
    "mercado": "Mercado e notícias",
    "relatorios": "Relatórios",
    "configuracoes": "Configurações",
}
PASSWORD = "senha sintética de compatibilidade 2026"
PRIVATE_NAME = "Pessoa-Privada-Compat-7Q"
PRIVATE_ACCOUNT = "Conta-Privada-Compat-7Q"
PRIVATE_ENTRY = "Entrada-Privada-Compat-7Q"


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", choices=["chromium", "firefox", "webkit", "all"], default="chromium")
    parser.add_argument("--base-url", default="http://127.0.0.1:3000")
    parser.add_argument("--executable", help="Browser binary; only valid with a single --browser.")
    parser.add_argument("--headed", action="store_true", help="Use a graphical display, such as a local Xvfb display in CI.")
    parser.add_argument("--output", type=Path, default=Path("/tmp/minhas-financas-compat"))
    parser.add_argument("--timeout-ms", type=int, default=15000)
    args = parser.parse_args()
    args.base_url = args.base_url.rstrip("/")
    origin = urlparse(args.base_url)
    if (origin.scheme not in ("http", "https") or origin.hostname not in ("localhost", "127.0.0.1", "::1")
            or origin.username or origin.password or origin.path or origin.query or origin.fragment):
        parser.error("Use a local origin only, without credentials, path, query or fragment.")
    if args.executable and args.browser == "all":
        parser.error("--executable requires one browser engine.")
    if args.timeout_ms < 1000 or args.timeout_ms > 120000:
        parser.error("--timeout-ms must be between 1000 and 120000.")
    args.output.mkdir(parents=True, exist_ok=True)
    return args


class Checks:
    def __init__(self, browser, args, engine):
        self.browser, self.args, self.engine = browser, args, engine
        self.errors = []
        self.blocked_requests = []
        self.context = browser.new_context(
            locale="pt-BR", timezone_id="America/Sao_Paulo",
            viewport={"width": 1440, "height": 1000}, reduced_motion="reduce",
            service_workers="block", accept_downloads=True,
        )
        self.context.route("**/*", self.route)
        self.page = self.context.new_page()
        self.page.set_default_timeout(args.timeout_ms)
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.goto(args.base_url + "/", wait_until="domcontentloaded")
        expect(self.page.locator("#main")).to_have_attribute("aria-busy", "false")

    def route(self, route):
        url = route.request.url
        if not url.startswith(self.args.base_url + "/"):
            self.blocked_requests.append(url)
            return route.abort()
        if urlparse(url).path.startswith("/api/"):
            return route.fulfill(status=503, content_type="application/json", body='{"error":"Fonte indisponível na fixture de compatibilidade."}')
        return route.continue_()

    def close(self):
        self.context.close()

    def state(self, slot="demo"):
        return self.page.evaluate("""async slot => {
          const S=await import('/storage.mjs'),db=await S.openDatabase();
          try {return await S.decodeRaw(await S.loadRaw(db,slot))}
          finally {db.close()}
        }""", slot)

    def raw_personal(self):
        return self.page.evaluate("""async () => {
          const S=await import('/storage.mjs'),db=await S.openDatabase();
          try {return JSON.stringify(await S.loadRaw(db,'personal'))}
          finally {db.close()}
        }""")

    def navigate(self, route):
        self.page.evaluate("route => {location.hash=route}", route)
        expect(self.page.locator("#breadcrumb")).to_have_text(ROUTES[route])

    def fill(self, name, value):
        self.page.locator(f'#dialog-form input[name="{name}"]').fill(value)

    def submit(self):
        self.page.locator("#dialog-submit").click()

    def save(self):
        self.submit()
        expect(self.page.locator("#dialog")).not_to_be_visible()

    def choose_personal(self):
        self.page.locator('#demo-banner [data-action="personal"]').click()
        self.page.locator('#dialog-form select[name="target"]').select_option("personal")
        self.submit()

    def demo_form_and_focus(self):
        before = self.state()
        self.navigate("lancamentos")
        self.page.locator('.page-heading [data-action="entry"]').click()
        self.fill("description", "Movimento sintético de compatibilidade")
        self.fill("amount", "1,234")
        self.submit()
        amount = self.page.locator('#dialog-form input[name="amount"]')
        expect(self.page.locator("#dialog-error")).to_be_visible()
        expect(amount).to_be_focused()
        expect(amount).to_have_attribute("aria-invalid", "true")
        expect(amount).to_have_attribute("aria-describedby", re.compile(r"\bdialog-error\b"))
        assert self.state() == before, "Invalid money mutated the saved state."
        error_tree = self.page.locator("#dialog").aria_snapshot()
        assert "alert" in error_tree and "Valor" in error_tree
        self.fill("amount", "1.234,56")
        expect(amount).not_to_have_attribute("aria-invalid", "true")
        self.save()
        after = self.state()
        entry = next(item for item in after["entries"] if item["description"] == "Movimento sintético de compatibilidade")
        assert entry["amount"] == 123456
        assert len(after["entries"]) == len(before["entries"]) + 1
        self.page.locator(f'[data-action="entry"][data-id="{entry["id"]}"]').click()
        self.fill("amount", "1.250,00")
        self.save()
        expect(self.page.locator(f'[data-action="entry"][data-id="{entry["id"]}"]')).to_be_focused()
        self.page.reload(wait_until="domcontentloaded")
        expect(self.page.locator("#main")).to_have_attribute("aria-busy", "false")
        persisted = next(item for item in self.state()["entries"] if item["id"] == entry["id"])
        assert persisted["amount"] == 125000
        return {"invalidMoneyDoesNotSave": True, "fieldErrorAndFocus": True,
                "centavosSavedExactly": True, "focusReturnsAfterEdit": True, "reloadPreservesRecord": True}

    def vault_and_encrypted_backup(self):
        self.choose_personal()
        expect(self.page.locator("#dialog-title")).to_have_text("Criar meu cofre pessoal")
        self.fill("name", PRIVATE_NAME)
        self.fill("password", PASSWORD)
        self.fill("confirmation", PASSWORD)
        self.submit()
        expect(self.page.locator("#dialog-title")).to_have_text("Nova conta")
        self.fill("name", PRIVATE_ACCOUNT)
        self.fill("opening", "1000,00")
        self.save()
        expect(self.page.locator("#mode-label")).to_have_text("Cofre pessoal aberto")
        self.navigate("lancamentos")
        self.page.locator('.page-heading [data-action="entry"]').click()
        self.fill("description", PRIVATE_ENTRY)
        self.fill("amount", "12,34")
        self.save()
        raw = self.raw_personal()
        assert all(marker not in raw for marker in (PRIVATE_NAME, PRIVATE_ACCOUNT, PRIVATE_ENTRY, PASSWORD))
        with tempfile.TemporaryDirectory(prefix="mf-compat-") as folder:
            with self.page.expect_download() as download:
                self.page.locator('footer [data-action="backup"]').click()
            path = Path(folder) / "encrypted.mfbackup"
            download.value.save_as(path)
            text = path.read_text()
            envelope = json.loads(text)
            assert envelope["format"] == "minhas-financas-encrypted" and envelope["version"] == 1
            assert all(marker not in text for marker in (PRIVATE_NAME, PRIVATE_ACCOUNT, PRIVATE_ENTRY, PASSWORD))
            decoded = self.page.evaluate("""async ({text,password}) => {
              const C=await import('/crypto.mjs'); return C.readBackup(text,password)
            }""", {"text": text, "password": PASSWORD})
            assert decoded["name"] == PRIVATE_NAME and len(decoded["entries"]) == 1
            assert decoded["entries"][0]["description"] == PRIVATE_ENTRY and decoded["entries"][0]["amount"] == 1234
        self.page.locator("#lock-button").click()
        expect(self.page.locator("#mode-label")).to_have_text("Demonstração")
        expect(self.page.locator("#lock-button")).to_be_hidden()
        visible = self.page.locator("body").inner_text()
        fields = self.page.locator("input,textarea,select").evaluate_all("els => els.map(el=>el.value).join('\\n')")
        assert all(marker not in visible and marker not in fields for marker in (PRIVATE_NAME, PRIVATE_ACCOUNT, PRIVATE_ENTRY, PASSWORD))
        self.choose_personal()
        expect(self.page.locator("#dialog-title")).to_have_text("Abrir cofre pessoal")
        self.fill("password", "senha incorreta de compatibilidade")
        self.submit()
        expect(self.page.locator("#dialog-error")).to_be_visible()
        assert self.raw_personal() == raw, "Wrong password changed the encrypted vault."
        self.fill("password", PASSWORD)
        self.save()
        expect(self.page.locator("#mode-label")).to_have_text("Cofre pessoal aberto")
        self.navigate("lancamentos")
        expect(self.page.locator("#ledger-results")).to_contain_text(PRIVATE_ENTRY)
        return {"webCryptoAndIndexedDB": True, "personalStartsEmpty": True,
                "encryptedBackupDownloadedAndRead": True, "savedRecordsContainNoPlaintextMarkers": True,
                "lockRemovesPrivateUI": True, "wrongPasswordPreservesExactRaw": True, "unlockRestoresRecord": True}

    def legacy_vault_upgrade(self):
        # Synthetic v1.0.1 payloads: no catalog, no digest, payments without importKey.
        before = self.page.evaluate("""async password => {
          const F=await import('/finance.mjs'),C=await import('/crypto.mjs'),S=await import('/storage.mjs');
          const state=F.demo(),kdf=C.newKdf(),key=await C.deriveKey(password,kdf);
          delete state.categories;
          for(const payment of state.payments)delete payment.importKey;
          const root={...state,revision:0,recordKeys:[]},records=[];
          for(const collection of F.COLLECTIONS){
            for(const item of state[collection]){
              const rk=collection+':'+item.id;root.recordKeys.push(rk);
              records.push({key:'personal:'+rk,slot:'personal',collection,id:item.id,payload:await C.seal(item,key,rk)});
            }
            delete root[collection];
          }
          const head={version:3,revision:0,encrypted:true,kdf,operationId:'legacy-synthetic',payload:await C.seal(root,key,'root')};
          const db=await S.openDatabase();try{
            await new Promise((resolve,reject)=>{const tx=db.transaction(['data','records'],'readwrite');tx.objectStore('data').put(head,'head:personal');for(const r of records)tx.objectStore('records').put(r);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});
          }finally{db.close()}
          return {ids:state.entries.map(x=>x.id),opening:state.accounts.map(x=>x.opening),amounts:state.entries.map(x=>x.amount)};
        }""", PASSWORD)
        self.choose_personal()
        expect(self.page.locator('#dialog-title')).to_have_text('Abrir cofre pessoal')
        self.fill('password',PASSWORD)
        self.save()
        self.navigate('configuracoes')
        self.page.locator('[data-action="name"]').click()
        self.fill('name','Cofre sintético migrado')
        self.save()
        self.page.reload(wait_until='domcontentloaded')
        expect(self.page.locator('#main')).to_have_attribute('aria-busy','false')
        self.choose_personal()
        self.fill('password',PASSWORD)
        self.save()
        after=self.page.evaluate("""async password=>{
          const S=await import('/storage.mjs'),C=await import('/crypto.mjs'),db=await S.openDatabase();
          try{const raw=await S.loadRaw(db,'personal'),key=await C.deriveKey(password,raw.head.kdf);return await S.decodeRaw(raw,key)}finally{db.close()}
        }""",PASSWORD)
        assert after['name']=='Cofre sintético migrado'
        assert [x['id'] for x in after['entries']]==before['ids']
        assert [x['amount'] for x in after['entries']]==before['amounts']
        assert [x['opening'] for x in after['accounts']]==before['opening']
        assert after['categories']
        return {'legacyVaultOpened':True,'firstWriteAndReloadPassed':True,'financialIDsAndValuesPreserved':True}

    def installed_offline_core(self):
        context=self.browser.new_context(locale='pt-BR',timezone_id='America/Sao_Paulo',service_workers='allow',viewport={'width':390,'height':844})
        page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
        try:
            page.goto(self.args.base_url+'/',wait_until='domcontentloaded')
            expect(page.locator('#main')).to_have_attribute('aria-busy','false')
            page.evaluate("""async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}))}""")
            page.reload(wait_until='domcontentloaded')
            expect(page.locator('#main')).to_have_attribute('aria-busy','false')
            assert page.locator('meta[name="application-version"]').get_attribute('content')=='1.1.0'
            context.set_offline(True)
            page.reload(wait_until='domcontentloaded')
            expect(page.locator('#main')).to_have_attribute('aria-busy','false')
            for route,label in ROUTES.items():
                page.evaluate('(route)=>location.hash=route',route)
                expect(page.locator('#breadcrumb')).to_have_text(label)
            page.evaluate("location.hash='lancamentos'")
            page.locator('.page-heading [data-action="entry"]').click()
            page.locator('input[name="description"]').fill('Registro sintético offline')
            page.locator('input[name="amount"]').fill('12,34')
            page.locator('#dialog-submit').click()
            expect(page.locator('#dialog')).not_to_be_visible()
            page.reload(wait_until='domcontentloaded')
            expect(page.locator('#main')).to_have_attribute('aria-busy','false')
            expect(page.locator('#ledger-results')).to_contain_text('Registro sintético offline')
            assert not errors,errors
            context.set_offline(False)
            return {'serviceWorkerInstalled':True,'offlineReloadAndEightRoutesPassed':True,'offlineRecordPersisted':True,'viewport':{'width':390,'height':844}}
        finally:
            context.close()

    def responsive_and_accessible_names(self):
        layouts = []
        for width, height in [(320, 568), (390, 844), (844, 390), (768, 1024)]:
            self.page.set_viewport_size({"width": width, "height": height})
            for route in ROUTES:
                self.navigate(route)
                dimensions = self.page.evaluate("""() => ({viewport:innerWidth,document:document.documentElement.scrollWidth,
                  body:document.body.scrollWidth,scrollPadding:getComputedStyle(document.documentElement).scrollPaddingBottom})""")
                assert dimensions["document"] <= width + 1 and dimensions["body"] <= width + 1, dimensions
                layouts.append({"width": width, "height": height, "route": route, **dimensions})
                if route == "configuracoes":
                    assert self.page.locator("#month").count() == 0
                if width <= 390:
                    navigation = self.page.locator("#mobile-nav").aria_snapshot()
                    for label in ("Início", "Registros", "Contas", "Plano", "Mais"):
                        assert label in navigation, navigation
                else:
                    navigation = self.page.locator("#nav").aria_snapshot()
                    for label in ROUTES.values():
                        assert label in navigation, navigation
        self.page.set_viewport_size({"width": 390, "height": 844})
        self.navigate("inicio")
        self.page.locator(".chart-values summary").click()
        table = self.page.locator(".chart-values table")
        expect(table).to_be_visible()
        tree = table.aria_snapshot()
        assert "Semana 1" in tree and "Receitas" in tree and "Despesas" in tree
        self.page.locator("#hide-values").click()
        for route in ROUTES:
            self.navigate(route)
            assert not re.search(r"R\$\s*-?\s*\d", self.page.locator("#main").inner_text()), route
            assert self.page.locator("#main progress").count() == 0
        (self.args.output / f"{self.engine}-layouts.json").write_text(json.dumps(layouts, ensure_ascii=False, indent=2))
        (self.args.output / f"{self.engine}-weekly-table.txt").write_text(tree)
        return {"routeViewportCombinations": len(layouts), "noHorizontalPageOverflow": True,
                "navigationHasAccessibleNames": True, "weeklyTableHasRealValues": True,
                "hiddenValuesProtectedOnEveryRoute": True, "physicalDeviceTested": False}


def main():
    args = arguments()
    expect.set_options(timeout=args.timeout_ms)
    engines = ["chromium", "firefox", "webkit"] if args.browser == "all" else [args.browser]
    report = {
        "startedAtUtc": datetime.now(timezone.utc).isoformat(), "baseUrl": args.base_url,
        "fixture": "Synthetic data, temporary profiles, service workers blocked, market unavailable.",
        "engines": [], "physicalDeviceTested": False, "humanScreenReaderTested": False,
    }
    with sync_playwright() as pw:
        for engine in engines:
            record = {"engine": engine, "status": "passed", "scenarios": [], "headless": not args.headed}
            launch = {"headless": not args.headed, "timeout": args.timeout_ms}
            executable = args.executable or os.environ.get({"chromium": "CHROMIUM_PATH", "firefox": "FIREFOX_PATH", "webkit": "WEBKIT_PATH"}[engine])
            if not executable and engine == "chromium":
                executable = shutil.which("chromium")
            if executable:
                launch["executable_path"] = executable
            record["executable"] = executable or "Playwright-managed engine"
            if engine == "chromium":
                launch["args"] = ["--no-sandbox"]
            try:
                browser = getattr(pw, engine).launch(**launch)
            except Exception as error:
                record.update({"status": "blocked", "error": str(error), "scenariosExecuted": 0})
                report["engines"].append(record)
                print(f"{engine}: blocked; engine could not start.", flush=True)
                continue
            record["browserVersion"] = browser.version
            try:
                for scenario in ("demo_form_and_focus", "vault_and_encrypted_backup", "legacy_vault_upgrade", "installed_offline_core", "responsive_and_accessible_names"):
                    checks = None
                    outcome = {"name": scenario, "passed": False}
                    try:
                        checks = Checks(browser, args, engine)
                        outcome.update(getattr(checks, scenario)())
                        assert not checks.errors, checks.errors
                        assert not checks.blocked_requests, checks.blocked_requests
                        outcome.update({"passed": True, "pageErrors": checks.errors, "externalRequests": checks.blocked_requests})
                    except Exception as error:
                        record["status"] = "failed"
                        outcome.update({"error": str(error), "traceback": traceback.format_exc()})
                        if checks:
                            outcome["pageErrors"] = checks.errors
                            outcome["externalRequests"] = checks.blocked_requests
                    finally:
                        if checks:
                            checks.close()
                    record["scenarios"].append(outcome)
                    print(f'{engine}: {scenario}: {"passed" if outcome["passed"] else "FAILED"}', flush=True)
            finally:
                browser.close()
            record["scenariosExecuted"] = len(record["scenarios"])
            report["engines"].append(record)
    report["completedAtUtc"] = datetime.now(timezone.utc).isoformat()
    report["passed"] = all(record["status"] == "passed" for record in report["engines"])
    output = args.output / "compat-results.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({"passed": report["passed"], "engines": [{"engine": r["engine"], "status": r["status"], "scenarios": r.get("scenariosExecuted", 0)} for r in report["engines"]], "report": str(output)}, ensure_ascii=False))
    raise SystemExit(0 if report["passed"] else 1)


if __name__ == "__main__":
    main()
