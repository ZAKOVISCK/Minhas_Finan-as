"""Regressões locais de segurança do cofre, com dados sintéticos e perfil novo.

Requer Playwright e Chromium. Execute com o servidor local ativo:
    python tests/security-vault.py --base-url http://127.0.0.1:3000

Não acessa o aplicativo publicado nem usa senhas ou dados reais. O service worker
fica bloqueado para testar os arquivos atuais, sem interferência de cache antigo.
"""
import argparse
import os
import unittest
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright
from browser_session import seed_fixture,unlock_fixture

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--base-url", default="http://127.0.0.1:3000")
args, remaining = parser.parse_known_args()
BASE = args.base_url.rstrip("/")
if urlparse(BASE).hostname not in ("localhost", "127.0.0.1", "::1"):
    parser.error("Estes testes são exclusivos do servidor local.")

PASSWORD = "senha sintética apenas para teste"
PRIVATE_NAME = "PRIVADO-AUDITORIA-QX7"
PRIVATE_ACCOUNT = "CONTA-PRIVADA-QX7"
PRIVATE_ENTRY = "COMPROMISSO-PRIVADO-QX7"
PRIVATE_DRAFT = "RASCUNHO-PRIVADO-QX7"
PRIVATE_FILE = "ARQUIVO-PRIVADO-QX7.json"
PRIVATE_IMPORT = "CONTEUDO-IMPORTADO-PRIVADO-QX7"


class VaultSecurity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(
            executable_path=os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"),
            headless=True,
            args=["--no-sandbox"],
        )

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def setUp(self):
        self.context = self.browser.new_context(
            locale="pt-BR", timezone_id="America/Sao_Paulo",
            viewport={"width": 1440, "height": 1000}, service_workers="block",
        )
        # A request to a non-local destination is unnecessary for these scenarios.
        self.context.route("**/*", lambda r: r.continue_() if r.request.url.startswith(BASE + "/") else r.abort())
        self.page = self.context.new_page()
        self.page.set_default_timeout(10000)
        self.errors = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))

    def tearDown(self):
        self.context.close()

    def start(self):
        self.page.goto(BASE, wait_until="networkidle")
        expect(self.page.locator("#main")).to_have_attribute("aria-busy", "false")

    def submit(self):
        self.page.locator("#dialog-submit").click()

    def navigate(self, view):
        self.page.locator(f'#nav [data-view="{view}"]').click()

    def create_personal_records(self):
        self.start()
        empty=self.page.evaluate("async()=> (await import('/finance.mjs')).emptyState()")
        empty['name']=PRIVATE_NAME
        seed_fixture(self.page,empty,PASSWORD)
        self.navigate('contas');self.page.locator('[data-action="account"]').click()
        self.page.locator('#dialog input[name="name"]').fill(PRIVATE_ACCOUNT)
        self.page.locator('#dialog input[name="opening"]').fill("1000,00")
        self.submit()
        expect(self.page.locator("#dialog")).not_to_be_visible()
        expect(self.page.locator("#mode-label")).to_have_text("Cofre pessoal aberto")
        self.navigate("lancamentos")
        self.page.locator('#main .page-heading [data-action="entry"]').click()
        self.page.locator('#dialog input[name="description"]').fill(PRIVATE_ENTRY)
        self.page.locator('#dialog input[name="amount"]').fill("12,34")
        self.submit()
        expect(self.page.locator("#dialog")).not_to_be_visible()
        expect(self.page.locator("#ledger-count")).to_have_text("1 registro(s) nos filtros")
        expect(self.page.locator("#ledger-results")).to_contain_text(PRIVATE_ENTRY)

    def stash_private_draft(self):
        self.page.locator('#main .page-heading [data-action="entry"]').click()
        self.page.locator('#dialog input[name="description"]').fill(PRIVATE_DRAFT)
        self.page.locator('#dialog input[name="amount"]').fill("22,33")
        self.page.locator("#close-dialog").click()
        expect(self.page.locator("#dialog")).not_to_be_visible()

    def select_private_backup(self):
        self.navigate("configuracoes")
        self.page.locator('#main [data-action="restore"]').click()
        self.page.locator("#file-input").set_input_files({
            "name": PRIVATE_FILE,
            "mimeType": "application/json",
            "buffer": ('{"private":"' + PRIVATE_IMPORT + '"}').encode(),
        })
        expect(self.page.locator("#dialog-title")).to_have_text("Restaurar backup")
        self.page.locator("#close-dialog").click()
        self.navigate("lancamentos")
        self.page.locator("#search").fill(PRIVATE_ENTRY)

    def unlock(self):
        expect(self.page.locator('#access-screen')).to_be_visible()
        self.page.locator('#access-primary').click()
        expect(self.page.locator("#dialog-title")).to_have_text("Abrir cofre pessoal")
        self.page.locator('#dialog input[name="password"]').fill(PASSWORD)
        self.submit()
        expect(self.page.locator("#dialog")).not_to_be_visible()
        expect(self.page.locator("#mode-label")).to_have_text("Cofre pessoal aberto")

    def assert_private_dom_cleared(self):
        visible = self.page.locator("body").inner_text()
        values = self.page.locator("input,textarea,select").evaluate_all("els => els.map(el => el.value).join('\\n')")
        for marker in (PRIVATE_NAME, PRIVATE_ACCOUNT, PRIVATE_ENTRY, PRIVATE_DRAFT, PRIVATE_IMPORT, PRIVATE_FILE, PASSWORD):
            self.assertNotIn(marker, visible)
            self.assertNotIn(marker, values)
        self.assertEqual(self.page.locator("#file-input").evaluate("el => el.files.length"), 0)
        expect(self.page.locator("#dialog")).not_to_be_visible()
        expect(self.page.locator("#lock-button")).to_be_hidden()
        self.assertTrue(self.page.evaluate("['key','kdf','state','password'].every(name => !Object.hasOwn(window, name))"))

    def test_delayed_encryption_clears_private_dom_and_restores_draft(self):
        self.create_personal_records()
        self.stash_private_draft()
        self.select_private_backup()
        self.page.evaluate("""() => {
            const original = crypto.subtle.encrypt.bind(crypto.subtle);
            crypto.subtle.encrypt = async (params, ...rest) => {
                if (new TextDecoder().decode(params.additionalData) === 'minhas-financas/v3/drafts') {
                    window.__vaultTestEncryptStarted = true;
                    await new Promise(resolve => window.__vaultTestRelease = resolve);
                }
                return original(params, ...rest);
            };
        }""")
        self.page.locator("#lock-button").click()
        self.page.wait_for_function("() => window.__vaultTestEncryptStarted === true")
        # Assert before the held encryption completes, not after the transition.
        expect(self.page.locator("#mode-label")).to_have_text("Cofre bloqueado")
        self.assert_private_dom_cleared()
        self.page.evaluate("window.__vaultTestRelease()")
        self.page.wait_for_function("() => document.querySelector('#toast').textContent.includes('Cofre bloqueado')")
        expect(self.page.locator("#main")).to_have_attribute("aria-busy", "false")
        self.unlock()
        self.navigate("lancamentos")
        expect(self.page.locator("#ledger-results")).to_contain_text(PRIVATE_ENTRY)
        self.page.locator('#main .page-heading [data-action="entry"]').click()
        expect(self.page.locator('#dialog input[name="description"]')).to_have_value(PRIVATE_DRAFT)
        expect(self.page.locator('#dialog input[name="amount"]')).to_have_value("22,33")
        self.assertEqual(self.errors, [])

    def test_encryption_failure_still_locks_and_preserves_saved_records(self):
        self.create_personal_records()
        self.stash_private_draft()
        self.select_private_backup()
        self.page.evaluate("""() => {
            crypto.subtle.encrypt = () => Promise.reject(new Error('Falha sintética de criptografia'));
        }""")
        self.page.locator("#lock-button").click()
        expect(self.page.locator("#access-screen")).to_be_visible()
        self.assert_private_dom_cleared()
        self.page.evaluate("delete crypto.subtle.encrypt")
        expect(self.page.locator("#main")).to_have_attribute("aria-busy", "false")
        self.unlock()
        self.navigate("lancamentos")
        expect(self.page.locator("#ledger-results")).to_contain_text(PRIVATE_ENTRY)
        expect(self.page.locator("#ledger-count")).to_have_text("1 registro(s) nos filtros")
        self.assertEqual(self.errors, [])

    def test_personal_storage_is_encrypted_and_inherited_route_is_rejected(self):
        self.create_personal_records()
        raw = self.page.evaluate("""async () => {
            const {openDatabase, loadRaw} = await import('/storage.mjs');
            const db = await openDatabase();
            try { return JSON.stringify(await loadRaw(db, 'personal')); }
            finally { db.close(); }
        }""")
        for marker in (PRIVATE_NAME, PRIVATE_ACCOUNT, PRIVATE_ENTRY, PASSWORD):
            self.assertNotIn(marker, raw)
        for route in ("__proto__", "constructor", "toString"):
            self.page.evaluate("route => location.hash = route", route)
            expect(self.page.locator("#breadcrumb")).to_have_text("Visão geral")
            expect(self.page.locator("#main h1")).to_contain_text(PRIVATE_NAME)
        self.assertEqual(self.errors, [])

    def test_storage_unavailable_refuses_unsaved_financial_edits(self):
        self.context.add_init_script("Object.defineProperty(window, 'indexedDB', {value: undefined})")
        self.start()
        expect(self.page.locator("#main")).to_have_attribute("aria-busy", "false")
        expect(self.page.locator("#access-screen")).to_be_visible()
        expect(self.page.locator("#access-status")).to_contain_text("preservados")
        expect(self.page.locator("#access-primary")).to_be_disabled()
        expect(self.page.locator('.page-heading [data-action="entry"]')).to_have_count(0)
        expect(self.page.locator("#main")).to_have_attribute("aria-busy", "false")
        self.page.evaluate("""async () => {
            const channel = new BroadcastChannel('minhas-financas-v3');
            channel.postMessage({slot: 'personal', revision: 999999});
            await new Promise(resolve => setTimeout(resolve, 100));
            channel.close();
        }""")
        self.assertNotIn("Outra aba", self.page.locator("#access-status").inner_text())
        expect(self.page.locator("#dialog")).not_to_be_visible()
        self.assertEqual(self.errors, [])


if __name__ == "__main__":
    unittest.main(argv=[__file__, *remaining], verbosity=2)
