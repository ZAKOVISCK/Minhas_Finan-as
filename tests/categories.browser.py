"""Real category controller regressions, using local synthetic demo data only.

With npm start running:
    python tests/categories.browser.py [local_base_url] [output.json]
Requires Python Playwright and Chromium. Service workers and external requests are
blocked; every test gets a new disposable browser profile.
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
OUTPUT = Path(sys.argv[2] if len(sys.argv) > 2 else '/tmp/minhas-financas-categories-browser.json')
if urlparse(BASE).hostname not in ('localhost', '127.0.0.1', '::1'):
    raise SystemExit('Use only a local disposable test server.')


class CategoryController(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def setUp(self):
        self.context = self.browser.new_context(locale='pt-BR', timezone_id='America/Sao_Paulo', viewport={'width': 1440, 'height': 1000}, service_workers='block', reduced_motion='reduce', accept_downloads=True)
        self.context.route('**/*', lambda route: route.continue_() if route.request.url.startswith(BASE + '/') else route.abort())
        self.page = self.context.new_page()
        self.page.set_default_timeout(10000)
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.goto(BASE, wait_until='networkidle')
        expect(self.page.locator('#main')).to_have_attribute('aria-busy', 'false')

        seed_fixture(self.page)

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [])

    def state(self):
        return self.page.evaluate('''async()=>{const S=await import('/storage.mjs'),db=await S.openDatabase();try{return await (async()=>{const qaRaw=await S.loadRaw(db,'personal'),qaCrypto=await import('/crypto.mjs');return S.decodeRaw(qaRaw,await qaCrypto.deriveKey("senha sintética exclusiva das fixtures QA 2026",qaRaw.head.kdf));})()}finally{db.close()}}''')

    def navigate(self, view):
        self.page.locator(f'#nav [data-view="{view}"]').click()

    def fill(self, field, value):
        self.page.locator(f'#dialog-form input[name="{field}"]').fill(value)

    def save(self):
        password = self.page.locator('#dialog-form input[name="password"]')
        if password.count() and not password.input_value(): password.fill(TEST_PASSWORD)
        self.page.locator('#dialog-submit').click()
        expect(self.page.locator('#dialog')).not_to_be_visible()

    def close(self):
        self.page.locator('#close-dialog').click()
        expect(self.page.locator('#dialog')).not_to_be_visible()

    def category_select(self):
        return self.page.locator('#dialog-form select[name="category"]')

    def category_options(self):
        return self.category_select().locator('option').evaluate_all('options=>options.map(option=>option.value)')

    def add_category(self, name):
        self.navigate('configuracoes')
        self.page.locator('#main [data-action="category"]:not([data-id])').click()
        self.fill('name', name)
        self.save()
        return next(category for category in self.state()['categories'] if category['name'] == name)

    def edit_category(self, category_id, name, archived=None):
        self.navigate('configuracoes')
        self.page.locator(f'#main [data-action="category"][data-id="{category_id}"]').click()
        self.fill('name', name)
        if archived is not None:
            self.page.locator('#dialog-form input[name="archived"]').set_checked(archived)
        self.save()

    def toggle_category(self, category_id, expected_archived):
        self.navigate('configuracoes')
        self.page.locator(f'#main [data-action="toggle-category"][data-id="{category_id}"]').click()
        label = 'Reativar' if expected_archived else 'Arquivar'
        expect(self.page.locator(f'#main [data-action="toggle-category"][data-id="{category_id}"]')).to_have_text(label)

    def new_entry(self, description, amount, category, paid=False):
        self.navigate('lancamentos')
        self.page.locator('.page-heading [data-action="entry"]').click()
        self.fill('description', description)
        self.fill('amount', amount)
        self.category_select().select_option(category)
        if paid:
            self.page.locator('#dialog-form input[name="paid"]').check()
        self.save()
        return next(entry for entry in self.state()['entries'] if entry['description'] == description)

    def test_lifecycle_preserves_history_csv_and_backup_restore(self):
        category = self.add_category('Animais de teste')
        entry = self.new_entry('Veterinário sintético', '123,45', category['name'], paid=True)
        self.navigate('planejamento')
        self.page.locator('[data-action="budget"]').click()
        self.category_select().select_option(category['name'])
        self.fill('amount', '200,00')
        self.save()
        self.page.locator('[data-action="recurrence"]').click()
        self.fill('description', 'Ração sintética')
        self.fill('amount', '30,00')
        self.category_select().select_option(category['name'])
        self.save()
        before = self.state()
        renamed = 'Cuidados com animais QA'
        self.edit_category(category['id'], renamed)
        after = self.state()
        self.assertEqual(after['payments'], before['payments'])
        for collection in ('entries', 'budgets', 'recurrences'):
            expected = [{**row, 'category': renamed} if row.get('category') == category['name'] else row for row in before[collection]]
            self.assertEqual(after[collection], expected, collection)
        self.assertEqual(next(row for row in after['categories'] if row['id'] == category['id'])['name'], renamed)
        self.toggle_category(category['id'], True)
        archived = self.state()
        self.assertEqual(archived['payments'], after['payments'])
        for collection in ('entries', 'budgets', 'recurrences'):
            self.assertEqual(archived[collection], after[collection], collection)
        self.navigate('lancamentos')
        self.page.locator('.page-heading [data-action="entry"]').click()
        self.assertNotIn(renamed, self.category_options())
        self.close()
        self.page.locator(f'[data-action="entry"][data-id="{entry["id"]}"]').click()
        expect(self.category_select()).to_have_value(renamed)
        self.assertIn(renamed, self.category_options())
        self.close()
        self.page.once('dialog', lambda dialog: dialog.accept())
        with self.page.expect_download() as download:
            self.page.locator('[data-action="csv"]').click()
        csv = Path(download.value.path()).read_text(encoding='utf-8-sig')
        self.assertIn(renamed, csv)
        self.assertNotIn(category['name'], csv)
        self.navigate('relatorios')
        expect(self.page.locator('#main')).to_contain_text(renamed)
        expect(self.page.locator('#main')).to_contain_text('123,45')
        with tempfile.TemporaryDirectory() as folder:
            with self.page.expect_download() as download:
                self.page.locator('footer [data-action="backup"]').click()
            backup = Path(folder)/'categories.json'
            download.value.save_as(backup)
            saved = decrypt_fixture_backup(self.page, backup.read_text())
            self.assertEqual(saved['categories'], archived['categories'])
            self.edit_category(category['id'], 'Nome que será desfeito')
            self.page.locator('#main [data-action="restore"]').click()
            self.page.locator('#file-input').set_input_files(str(backup))
            expect(self.page.locator('#dialog-title')).to_have_text('Restaurar backup')
            self.page.once('dialog', lambda dialog: dialog.accept())
            self.save()
            restored = self.state()
            for field, value in saved.items():
                if field != 'revision':
                    self.assertEqual(restored[field], value, field)
        self.toggle_category(category['id'], False)
        self.navigate('lancamentos')
        self.page.locator('.page-heading [data-action="entry"]').click()
        self.assertIn(renamed, self.category_options())

    def test_archived_outros_is_absent_from_new_forms_and_available_for_existing_entry(self):
        before = self.state()
        outros = next(category for category in before['categories'] if category['name'] == 'Outros')
        existing = next(entry for entry in before['entries'] if entry['category'] == 'Outros' and not entry['cardId'])
        self.toggle_category(outros['id'], True)
        self.navigate('lancamentos')
        self.page.locator('.page-heading [data-action="entry"]').click()
        self.assertNotIn('Outros', self.category_options())
        selected = self.category_select().input_value()
        self.assertTrue(selected)
        self.assertNotEqual(selected, 'Outros')
        self.fill('description', 'Novo com categoria ativa')
        self.fill('amount', '17,99')
        self.save()
        after = self.state()
        self.assertEqual(next(entry for entry in after['entries'] if entry['description'] == 'Novo com categoria ativa')['category'], selected)
        for previous in before['entries']:
            self.assertEqual(next(entry for entry in after['entries'] if entry['id'] == previous['id']), previous)
        self.page.locator(f'[data-action="entry"][data-id="{existing["id"]}"]').click()
        expect(self.category_select()).to_have_value('Outros')
        self.close()
        for action in ('budget', 'recurrence'):
            self.navigate('planejamento')
            self.page.locator(f'[data-action="{action}"]').click()
            self.assertNotIn('Outros', self.category_options(), action)
            self.close()
        self.navigate('lancamentos')
        self.page.locator('[data-action="import"]').click()
        self.assertNotIn('Outros', self.category_options())
        self.close()

    def test_existing_drafts_follow_category_rename_without_losing_other_fields(self):
        category = self.add_category('Categoria antes do rascunho')
        self.navigate('lancamentos')
        self.page.locator('.page-heading [data-action="entry"]').click()
        self.fill('description', 'Rascunho de lançamento')
        self.fill('amount', '45,67')
        self.category_select().select_option(category['name'])
        self.close()
        self.navigate('planejamento')
        self.page.locator('[data-action="budget"]').click()
        self.fill('amount', '321,09')
        self.category_select().select_option(category['name'])
        self.close()
        self.page.locator('[data-action="recurrence"]').click()
        self.fill('description', 'Rascunho de recorrência')
        self.fill('amount', '54,32')
        self.category_select().select_option(category['name'])
        self.close()
        renamed = 'Categoria depois do rascunho'
        self.edit_category(category['id'], renamed)
        self.navigate('lancamentos')
        self.page.locator('.page-heading [data-action="entry"]').click()
        expect(self.category_select()).to_have_value(renamed)
        expect(self.page.locator('input[name="description"]')).to_have_value('Rascunho de lançamento')
        expect(self.page.locator('input[name="amount"]')).to_have_value('45,67')
        self.save()
        saved = next(entry for entry in self.state()['entries'] if entry['description'] == 'Rascunho de lançamento')
        self.assertEqual(saved['category'], renamed)
        for action, amount in [('budget', '321,09'), ('recurrence', '54,32')]:
            self.navigate('planejamento')
            self.page.locator(f'[data-action="{action}"]').click()
            expect(self.category_select()).to_have_value(renamed)
            expect(self.page.locator('input[name="amount"]')).to_have_value(amount)
            if action == 'recurrence':
                expect(self.page.locator('input[name="description"]')).to_have_value('Rascunho de recorrência')
            self.save()
        final = self.state()
        self.assertTrue(any(row['category'] == renamed and row['amount'] == 32109 for row in final['budgets']))
        self.assertTrue(any(row['category'] == renamed and row['amount'] == 5432 for row in final['recurrences']))

    def test_edit_checkbox_and_duplicate_error_do_not_change_saved_financial_data(self):
        category = self.add_category('Teste de arquivamento')
        before = self.state()
        self.edit_category(category['id'], 'Teste renomeado e arquivado', archived=True)
        archived = self.state()
        for collection in ('entries', 'payments', 'budgets', 'recurrences', 'transfers', 'accounts'):
            self.assertEqual(archived[collection], before[collection])
        updated = next(row for row in archived['categories'] if row['id'] == category['id'])
        self.assertTrue(updated['archived'])
        self.page.locator(f'[data-action="category"][data-id="{category["id"]}"]').click()
        self.fill('name', 'Salário')
        self.page.locator('#dialog-submit').click()
        expect(self.page.locator('#dialog-error')).to_contain_text('Já existe uma categoria')
        expect(self.page.locator('#dialog')).to_be_visible()
        self.assertEqual(self.state(), archived)
        self.close()
        self.toggle_category(category['id'], False)
        self.assertFalse(next(row for row in self.state()['categories'] if row['id'] == category['id'])['archived'])


if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(CategoryController))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps({'baseUrl':BASE,'serviceWorkers':'blocked','fixture':'disposable synthetic demo data','tests':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skipped':len(result.skipped),'details':[{'test':str(test),'error':error} for test,error in result.failures+result.errors]},ensure_ascii=False,indent=2))
    raise SystemExit(0 if result.wasSuccessful() else 1)
