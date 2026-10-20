"""Controller-level CSV/OFX import regressions against a local `npm start`.

Uses a fresh temporary browser profile, blocked service workers and synthetic
IndexedDB demo data. No remote mutations or personal financial data are used.
Run: python tests/imports.browser.py [base_url] [evidence_json]
"""
import json
from browser_session import seed_fixture, reload_fixture, TEST_PASSWORD
import os
import sys
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:3000'
OUTPUT = Path(sys.argv[2] if len(sys.argv) > 2 else '/tmp/minhas-financas-imports-browser.json')
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
results = {'base_url': BASE, 'service_workers': 'blocked', 'fixture': 'synthetic demo only', 'scenarios': [], 'javascript_errors': []}

CSV_MAPPED = 'Movimento;Pagamento;Quantia;Natureza;Código\nEnergia no banco;10/01/2025;60,00;Débito;id-a\nMercado;11/01/2025;-12,34;;id-b\n'
CSV_ANONYMOUS = 'Descrição;Data;Valor\nPadaria;13/01/2025;-5,00\nPadaria;13/01/2025;-5,00\n'
OFX_PARTIAL = '''OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST><STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20250112120000[-3:BRT]
<TRNAMT>-40.00
<FITID>id-c
<MEMO>Energia final
</STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>'''


def read_state(page):
    return page.evaluate('''async () => {
      const S = await import('/storage.mjs');
      const db = await S.openDatabase();
      try { return await (async()=>{const qaRaw=await S.loadRaw(db,'personal'),qaCrypto=await import('/crypto.mjs');return S.decodeRaw(qaRaw,await qaCrypto.deriveKey("senha sintética exclusiva das fixtures QA 2026",qaRaw.head.kdf));})(); }
      finally { db.close(); }
    }''')


def select_file(page, name, contents):
    page.locator('[data-action="import"]').click()
    expect(page.locator('#dialog-title')).to_have_text('Importar extrato')
    page.locator('#dialog-form select[name="accountId"]').select_option('bank')
    page.locator('#dialog-form select[name="category"]').select_option('Outros')
    with page.expect_file_chooser() as chooser:
        page.locator('#dialog-submit').click()
    chooser.value.set_files({'name': name, 'mimeType': 'application/x-ofx' if name.endswith('.ofx') else 'text/csv', 'buffer': contents.encode('utf-8')})
    if name.endswith('.csv'):
        expect(page.locator('#dialog-title')).to_have_text('Mapear colunas do CSV')
    else:
        expect(page.locator('#dialog-title')).to_have_text('Revisar importação')


def map_csv(page, mapping=None):
    if mapping:
        for field, index in mapping.items():
            page.locator(f'#dialog-form select[name="{field}"]').select_option(str(index))
    page.locator('#dialog-submit').click()
    expect(page.locator('#dialog-title')).to_have_text('Revisar importação')


def submit_preview(page):
    page.locator('#dialog-submit').click()
    expect(page.locator('#dialog')).not_to_be_visible()
    return read_state(page)


def record(name, state, **extra):
    results['scenarios'].append({'name': name, 'passed': True, 'entries': len(state['entries']), 'payments': len(state['payments']), **extra})


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    context = browser.new_context(locale='pt-BR', timezone_id='America/Sao_Paulo', service_workers='block', viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce')
    page = context.new_page()
    page.on('pageerror', lambda error: results['javascript_errors'].append(str(error)))
    try:
        page.goto(BASE, wait_until='networkidle')
        seed_fixture(page)
        expect(page.locator('main')).to_have_attribute('aria-busy', 'false')
        page.evaluate('''async () => {
          const F = await import('/finance.mjs');
          const S = await import('/storage.mjs');
          const db = await S.openDatabase();
          try {
            const before = await (async()=>{const qaRaw=await S.loadRaw(db,'personal'),qaCrypto=await import('/crypto.mjs');return S.decodeRaw(qaRaw,await qaCrypto.deriveKey("senha sintética exclusiva das fixtures QA 2026",qaRaw.head.kdf));})();
            const fixture = F.emptyState('Importações de teste', '2025-01-01');
            fixture.accounts.push({id:'bank',name:'Conta de teste',kind:'bank',opening:100000,openingDate:'2025-01-01',archived:false});
            fixture.entries.push({id:'bill',description:'Energia mensal',type:'expense',category:'Serviços',amount:10000,dueDate:'2025-01-05',competence:'2025-01',accountId:'bank',cardId:null});
            const qaRaw=await S.loadRaw(db,'personal'),qaC=await import('/crypto.mjs'),qaKey=await qaC.deriveKey("senha sintética exclusiva das fixtures QA 2026",qaRaw.head.kdf);
            await S.saveSlot(db, 'personal', before, F.validateState(fixture), before.revision, {force:true,key:qaKey,kdf:qaRaw.head.kdf});
          } finally { db.close(); }
        }''')
        reload_fixture(page,wait_until='networkidle')
        expect(page.locator('main')).to_have_attribute('aria-busy', 'false')
        page.evaluate("location.hash = 'lancamentos'")
        expect(page.locator('#breadcrumb')).to_have_text('Lançamentos')
        page.locator('#month').fill('2025-01')
        page.locator('#month').dispatch_event('change')
        initial = read_state(page)
        assert len(initial['entries']) == 1 and not initial['payments']

        # Unknown headers exercise actual column mapping; a positive debit uses Tipo.
        select_file(page, 'mapeamento.csv', CSV_MAPPED)
        map_csv(page, {'description': 0, 'date': 1, 'amount': 2, 'type': 3, 'id': 4})
        expect(page.locator('[data-import-type="0"]')).to_have_value('expense')
        expect(page.locator('[data-import-line="0"]')).to_be_enabled()
        page.locator('[data-reconcile-line="0"]').select_option('bill')
        state = submit_preview(page)
        bill = next(entry for entry in state['entries'] if entry['id'] == 'bill')
        assert bill['dueDate'] == '2025-01-05' and bill['competence'] == '2025-01'
        assert bill['category'] == 'Serviços'
        assert len(state['entries']) == 2 and len(state['payments']) == 2
        assert any(payment['entryId'] == 'bill' and payment['amount'] == 6000 and payment['date'] == '2025-01-10' and payment['importKey'] == 'bank|id:id-a' for payment in state['payments'])
        record('CSV mapped debit + partial reconciliation + new movement', state, commitment_due_date=bill['dueDate'])

        select_file(page, 'repetido.csv', CSV_MAPPED)
        map_csv(page, {'description': 0, 'date': 1, 'amount': 2, 'type': 3, 'id': 4})
        assert page.locator('[data-import-line]:disabled').count() == 2
        state = submit_preview(page)
        assert len(state['entries']) == 2 and len(state['payments']) == 2
        record('CSV IDs reimport without financial duplication', state)

        select_file(page, 'parcela.ofx', OFX_PARTIAL)
        expect(page.locator('[data-import-type="0"]')).to_have_value('expense')
        page.locator('[data-reconcile-line="0"]').select_option('bill')
        state = submit_preview(page)
        assert len(state['entries']) == 2 and len(state['payments']) == 3
        assert sum(payment['amount'] for payment in state['payments'] if payment['entryId'] == 'bill') == 10000
        assert {payment['importKey'] for payment in state['payments'] if payment['entryId'] == 'bill'} == {'bank|id:id-a', 'bank|id:id-c'}
        record('OFX settlement preserves both partial bank IDs', state)

        select_file(page, 'parcela-repetida.ofx', OFX_PARTIAL)
        expect(page.locator('[data-import-line="0"]')).to_be_disabled()
        state = submit_preview(page)
        assert len(state['payments']) == 3
        record('OFX reimport is financially idempotent', state)

        select_file(page, 'sem-id.csv', CSV_ANONYMOUS)
        map_csv(page)
        assert page.locator('[data-import-line]:enabled').count() == 2
        page.locator('[data-import-line="0"]').uncheck()
        state = submit_preview(page)
        assert len([entry for entry in state['entries'] if entry['description'] == 'Padaria']) == 1
        record('Anonymous equal rows remain distinct and manual exclusion is respected', state)

        select_file(page, 'sem-id-completo.csv', CSV_ANONYMOUS)
        map_csv(page)
        expect(page.locator('[data-import-line="0"]')).to_be_disabled()
        expect(page.locator('[data-import-line="1"]')).to_be_checked()
        state = submit_preview(page)
        assert len([entry for entry in state['entries'] if entry['description'] == 'Padaria']) == 2
        record('Anonymous reimport adds only the missing occurrence', state)

        select_file(page, 'sem-id-repetido.csv', CSV_ANONYMOUS)
        map_csv(page)
        assert page.locator('[data-import-line]:disabled').count() == 2
        state = submit_preview(page)
        assert len([entry for entry in state['entries'] if entry['description'] == 'Padaria']) == 2
        record('Full anonymous reimport does not collapse or duplicate multiplicity', state)

        select_file(page, 'ajuste-tipo.csv', 'Descrição;Data;Valor\nAjuste manual;14/01/2025;7,00\n')
        map_csv(page)
        expect(page.locator('[data-import-type="0"]')).to_have_value('income')
        page.locator('[data-import-type="0"]').select_option('expense')
        expect(page.locator('[data-import-type="0"]')).to_have_value('expense')
        expect(page.locator('[data-import-line="0"]')).to_be_checked()
        state = submit_preview(page)
        adjustment = next(entry for entry in state['entries'] if entry['description'] == 'Ajuste manual')
        assert adjustment['type'] == 'expense' and adjustment['amount'] == 700
        record('Type override survives preview rerender and saves selected movement', state)

        select_file(page, 'data-futura.csv', 'Descrição;Data;Valor\nVálido;15/01/2025;-1,00\nFuturo;01/01/2199;-1,00\n')
        map_csv(page)
        expect(page.locator('[data-import-line="1"]')).to_be_disabled()
        expect(page.locator('#dialog-fields')).to_contain_text('Data efetiva inválida ou futura')
        state = submit_preview(page)
        assert any(entry['description'] == 'Válido' for entry in state['entries'])
        assert not any(entry['description'] == 'Futuro' for entry in state['entries'])
        record('Future movement is excluded with a line-specific error', state)

        # Paging exercises the full batch rather than only the visible controls.
        csv_paged = 'Descrição;Data;Valor;ID\n' + '\n'.join(f'Linha {i};16/01/2025;-1,00;page-{i}' for i in range(101))
        select_file(page, 'paginado.csv', csv_paged)
        map_csv(page)
        assert page.locator('[data-import-line]').count() == 100
        page.locator('[data-import-line="0"]').uncheck()
        page.locator('[data-action="import-next"]').click()
        expect(page.locator('[data-import-line="100"]')).to_be_checked()
        page.locator('[data-action="import-prev"]').click()
        expect(page.locator('[data-import-line="0"]')).not_to_be_checked()
        page.locator('[data-action="import-next"]').click()
        state = submit_preview(page)
        paged = [entry for entry in state['entries'] if entry['description'].startswith('Linha ')]
        assert len(paged) == 100 and not any(entry['description'] == 'Linha 0' for entry in paged)
        record('101-row preview preserves exclusions and imports all selected pages', state, imported_page_rows=len(paged))

        assert not results['javascript_errors'], results['javascript_errors']
        results['passed'] = True
    except Exception as error:
        results['passed'] = False
        results['failure'] = f'{type(error).__name__}: {error}'
        results['visible_dialog'] = page.locator('#dialog').inner_text() if page.locator('#dialog').is_visible() else None
        raise
    finally:
        OUTPUT.write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')
        browser.close()
print(json.dumps({'passed': True, 'scenarios': len(results['scenarios']), 'evidence': str(OUTPUT)}, ensure_ascii=False))
