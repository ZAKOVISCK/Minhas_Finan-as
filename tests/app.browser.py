"""End-to-end regressions of the actual local controller, with synthetic data.

Run with npm start active: python tests/app.browser.py [local_base_url]
Requires Python Playwright and Chromium; never contacts a deployed application.
"""
import json
from browser_session import seed_fixture, reload_fixture, read_fixture, decrypt_fixture_backup, TEST_PASSWORD
import os
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:3000').rstrip('/')
if urlparse(BASE).hostname not in ['localhost', '127.0.0.1', '::1']:
    raise SystemExit('Use only a local test server.')


class ControllerFlows(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def setUp(self):
        self.context = self.browser.new_context(locale='pt-BR', timezone_id='America/Sao_Paulo', viewport={'width': 1440, 'height': 1000}, service_workers='block', reduced_motion='reduce')
        self.context.route('**/*', lambda route: route.continue_() if route.request.url.startswith(BASE + '/') else route.abort())
        self.page = self.context.new_page()
        self.page.set_default_timeout(10000)
        self.errors = []
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        self.page.goto(BASE, wait_until='networkidle')
        try:
            expect(self.page.locator('#main')).to_have_attribute('aria-busy', 'false')
        except AssertionError as error:
            details={'pageErrors':self.errors,'notice':self.page.locator('#storage-notice').text_content(),'main':self.page.locator('#main').inner_text()}
            self.context.close()
            self.fail(str(error)+'\nStartup diagnostics: '+json.dumps(details,ensure_ascii=False))

        seed_fixture(self.page)

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [])

    def state(self):
        return self.page.evaluate('''async()=>{const S=await import('/storage.mjs');const db=await S.openDatabase();try{return await (async()=>{const qaRaw=await S.loadRaw(db,'personal'),qaCrypto=await import('/crypto.mjs');return S.decodeRaw(qaRaw,await qaCrypto.deriveKey("senha sintética exclusiva das fixtures QA 2026",qaRaw.head.kdf));})()}finally{db.close()}}''')

    def navigate(self, route):
        self.page.locator(f'#nav [data-view="{route}"]').click()

    def fill(self, name, value):
        self.page.locator(f'#dialog-form input[name="{name}"]').fill(value)

    def save(self):
        password = self.page.locator('#dialog-form input[name="password"]')
        if password.count() and not password.input_value(): password.fill(TEST_PASSWORD)
        self.page.locator('#dialog-submit').click()
        expect(self.page.locator('#dialog')).not_to_be_visible()

    def add_entry(self, description='Teste de cadastro', paid=False):
        self.navigate('lancamentos')
        self.page.locator('.page-heading [data-action="entry"]').click()
        self.fill('description', description)
        self.fill('amount', '1.234,56')
        if paid:
            self.page.locator('#dialog-form input[name="paid"]').check()
        self.save()
        return next(e for e in self.state()['entries'] if e['description'] == description)

    def test_paid_entry_edit_delete_undo_and_focus(self):
        original = self.state()
        entry = self.add_entry(paid=True)
        saved = self.state()
        self.assertEqual(len(saved['entries']), len(original['entries']) + 1)
        payments = [p for p in saved['payments'] if p['entryId'] == entry['id']]
        self.assertEqual(sum(p['amount'] for p in payments), 123456)
        self.page.locator(f'[data-action="entry"][data-id="{entry["id"]}"]').click()
        self.fill('amount', '2.000,00')
        self.save()
        self.page.wait_for_function('(id)=>document.activeElement.dataset.id===id', arg=entry['id'])
        edited = self.state()
        self.assertEqual(next(e for e in edited['entries'] if e['id'] == entry['id'])['amount'], 200000)
        self.assertEqual([p for p in edited['payments'] if p['entryId'] == entry['id']], payments)
        self.page.once('dialog', lambda dialog: dialog.accept())
        self.page.locator(f'[data-action="delete-entry"][data-id="{entry["id"]}"]').click()
        expect(self.page.locator('#undo-notice')).to_be_visible()
        self.assertFalse(any(p['entryId'] == entry['id'] for p in self.state()['payments']))
        self.page.locator('[data-action="undo"]').click()
        expect(self.page.locator('#undo-notice')).not_to_be_visible()
        self.assertEqual([p for p in self.state()['payments'] if p['entryId'] == entry['id']], payments)

    def test_transfer_updates_two_accounts_without_new_income_or_expense(self):
        before = self.state()
        self.navigate('contas')
        self.page.locator('[data-action="transfer"]').click()
        self.page.locator('select[name="fromId"]').select_option('bank')
        self.page.locator('select[name="toId"]').select_option('broker')
        self.fill('amount', '10,00')
        self.save()
        after = self.state()
        self.assertEqual(after['entries'], before['entries'])
        self.assertEqual(after['payments'], before['payments'])
        self.assertEqual(len(after['transfers']), len(before['transfers']) + 1)
        self.assertEqual(after['transfers'][-1]['amount'], 1000)
        deltas = self.page.evaluate('''async before=>{const F=await import('/finance.mjs'),S=await import('/storage.mjs');const db=await S.openDatabase();try{const after=await (async()=>{const qaRaw=await S.loadRaw(db,'personal'),qaCrypto=await import('/crypto.mjs');return S.decodeRaw(qaRaw,await qaCrypto.deriveKey("senha sintética exclusiva das fixtures QA 2026",qaRaw.head.kdf));})(),a=F.balances(before),b=F.balances(after);return {bank:b.get('bank')-a.get('bank'),broker:b.get('broker')-a.get('broker')}}finally{db.close()}}''', before)
        self.assertEqual(deltas, {'bank': -1000, 'broker': 1000})

    def test_card_purchase_and_statement_payment_do_not_duplicate_expense(self):
        self.navigate('contas')
        self.page.locator('[data-action="card"]:not([data-id])').click()
        self.fill('name', 'Cartão de teste')
        self.fill('limit', '3000,00')
        self.fill('closingDay', '15')
        self.fill('dueDay', '22')
        self.save()
        card = next(c for c in self.state()['cards'] if c['name'] == 'Cartão de teste')
        initial = self.state()
        self.page.locator(f'[data-action="purchase"][data-id="{card["id"]}"]').click()
        self.fill('description', 'Compra de teste parcelada')
        self.fill('amount', '100,01')
        self.fill('installments', '3')
        month = self.page.evaluate('new Date().toLocaleDateString("sv-SE").slice(0,7)')
        self.fill('firstStatement', month)
        self.save()
        purchased = self.state()
        installments = [e for e in purchased['entries'] if e['cardId'] == card['id']]
        self.assertEqual(sorted(e['amount'] for e in installments), [3333, 3334, 3334])
        self.assertEqual(purchased['payments'], initial['payments'])
        self.page.locator(f'[data-action="statement"][data-id="{card["id"]}"]').click()
        due = next(e for e in installments if e['statementMonth'] == month)
        self.assertEqual(self.page.locator('input[name="amount"]').input_value(), f'{due["amount"]/100:.2f}'.replace('.', ','))
        self.save()
        settled = self.state()
        self.assertEqual(settled['entries'], purchased['entries'])
        self.assertEqual(sum(p['amount'] for p in settled['payments'] if p['entryId'] == due['id']), due['amount'])
        self.navigate('lancamentos')
        self.page.locator(f'[data-action="entry"][data-id="{due["id"]}"]').click()
        self.assertTrue(self.page.locator('select[name="type"]').is_disabled())
        self.assertEqual(self.page.locator('input[type="hidden"][name="type"]').input_value(), 'expense')

    def test_backup_restore_and_encrypted_bom_boundary(self):
        original = self.state()
        with tempfile.TemporaryDirectory() as folder:
            with self.page.expect_download() as info:
                self.page.locator('footer [data-action="backup"]').click()
            path = Path(folder)/'backup.json'
            info.value.save_as(path)
            self.add_entry('Só existe após o backup')
            self.navigate('configuracoes')
            self.page.locator('#main [data-action="restore"]').click()
            self.page.locator('#file-input').set_input_files(str(path))
            expect(self.page.locator('#dialog-title')).to_have_text('Restaurar backup')
            self.page.once('dialog', lambda dialog: dialog.accept())
            self.save()
            restored = self.state()
            for key in original:
                if key != 'revision': self.assertEqual(restored[key], original[key], key)
            encrypted = self.page.evaluate('''async()=>{const S=await import('/storage.mjs'),C=await import('/crypto.mjs');const db=await S.openDatabase();try{return await C.encryptedBackup(await (async()=>{const qaRaw=await S.loadRaw(db,'personal'),qaCrypto=await import('/crypto.mjs');return S.decodeRaw(qaRaw,await qaCrypto.deriveKey("senha sintética exclusiva das fixtures QA 2026",qaRaw.head.kdf));})(),'senha-apenas-para-teste')}finally{db.close()}}''')
            self.page.locator('#main [data-action="restore"]').click()
            self.page.locator('#file-input').set_input_files({'name':'copia.mfbackup','mimeType':'application/json','buffer':('\ufeff'+encrypted).encode()})
            expect(self.page.locator('#dialog-title')).to_have_text('Restaurar backup')
            self.fill('password', 'senha-apenas-para-teste')
            self.page.once('dialog', lambda dialog: dialog.accept())
            self.save()
            after_encrypted_restore = self.state()
            for field, value in restored.items():
                if field != 'revision': self.assertEqual(after_encrypted_restore[field], value, field)
            self.assertEqual(after_encrypted_restore['payments'], restored['payments'])

    def test_draft_survives_month_and_privacy_changes(self):
        before = self.state()
        self.navigate('lancamentos')
        self.page.locator('.page-heading [data-action="entry"]').click()
        self.fill('description', 'Rascunho que deve continuar')
        self.fill('amount', '1,234')
        self.page.locator('#dialog-submit').click()
        expect(self.page.locator('#dialog-error')).to_contain_text('Valor')
        amount = self.page.locator('input[name="amount"]')
        expect(amount).to_be_focused()
        expect(amount).to_have_attribute('aria-invalid', 'true')
        expect(amount).to_have_attribute('aria-describedby', 'dialog-error')
        self.assertEqual(self.state(), before)
        self.fill('amount', '89,10')
        expect(amount).not_to_have_attribute('aria-invalid', 'true')
        self.page.locator('#close-dialog').click()
        month = self.page.locator('#month')
        month.fill('2026-08')
        month.press('Tab')
        self.page.locator('#hide-values').click()
        self.page.locator('#hide-values').click()
        self.page.locator('.page-heading [data-action="entry"]').click()
        expect(self.page.locator('input[name="description"]')).to_have_value('Rascunho que deve continuar')
        expect(self.page.locator('input[name="amount"]')).to_have_value('89,10')
        self.assertNotEqual(self.page.locator('input[name="dueDate"]').input_value(), '')


if __name__ == '__main__':
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(ControllerFlows)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    output = Path(os.environ.get('APP_TEST_RESULTS', '/tmp/minhas-financas-app-browser.json'))
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps({'tests':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skipped':len(result.skipped),'details':[{'test':str(t),'error':e} for t,e in result.failures+result.errors]},ensure_ascii=False,indent=2))
    raise SystemExit(0 if result.wasSuccessful() else 1)
