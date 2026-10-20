"""View/accessibility regression checks against `npm start` (local data only).

Requires Python Playwright and /usr/bin/chromium. Optional URL and artifact directory
are positional arguments. Service workers are blocked here so the current source
is exercised; offline delivery has separate coverage.
"""
import json
import re
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
BASE=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:3000'
OUT=Path(sys.argv[2] if len(sys.argv)>2 else '/tmp/minhas-financas-view-tests')
OUT.mkdir(parents=True,exist_ok=True)
ROUTES={'inicio':'Visão geral','lancamentos':'Lançamentos','contas':'Contas e cartões','planejamento':'Planejamento','investimentos':'Investimentos','mercado':'Mercado e notícias','relatorios':'Relatórios','configuracoes':'Configurações'}
results={'layouts':[],'errors':[]}
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 context=browser.new_context(locale='pt-BR',timezone_id='America/Sao_Paulo',service_workers='block',reduced_motion='reduce')
 page=context.new_page();page.on('pageerror',lambda e:results['errors'].append(str(e)))
 page.goto(BASE,wait_until='networkidle');page.locator('main[aria-busy=false]').wait_for()
 for width,height in [(1440,1000),(390,844),(320,568),(844,390),(768,1024)]:
  page.set_viewport_size({'width':width,'height':height})
  for route,label in ROUTES.items():
   page.evaluate('(r)=>location.hash=r',route)
   page.wait_for_function('(label)=>document.querySelector("#breadcrumb").textContent===label',arg=label)
   data=page.evaluate('''() => ({width:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth,scrollPadding:getComputedStyle(document.documentElement).scrollPaddingBottom})''')
   data.update({'height':height,'route':route});results['layouts'].append(data)
   assert data['document']<=width+1 and data['body']<=width+1,data
   if route=='lancamentos' and width<=650:
    row=page.locator('.ledger-table tbody tr').first
    for control in [row.locator('.ledger-value'),*row.locator('[data-action]').all()]:
     rect=control.bounding_box()
     assert rect and rect['x']>=0 and rect['x']+rect['width']<=width+1,(route,width,rect)
    assert page.locator('.ledger-wrap').evaluate('e=>e.scrollWidth<=e.clientWidth+1')
    snapshot=page.locator('.ledger-table').aria_snapshot()
    assert 'columnheader "Valor"' in snapshot and 'button "Editar' in snapshot
    if width==390:
     page.screenshot(path=str(OUT/'lancamentos-390.png'),full_page=True)
   if route=='configuracoes':assert page.locator('#month').count()==0
   if width==320 and route in ['inicio','contas','configuracoes']:
    page.screenshot(path=str(OUT/f'{route}-320.png'),full_page=True)
  if width in [768,844]:
   snapshot=page.locator('#nav').aria_snapshot()
   for label in ROUTES.values():assert label in snapshot,(width,label,snapshot)
 page.set_viewport_size({'width':390,'height':844})
 page.evaluate("location.hash='inicio'")
 page.locator('.chart-values summary').click()
 chart=page.locator('.chart-values table')
 assert chart.is_visible()
 assert chart.get_by_role('rowheader',name='Semana 1').count()==1
 assert len(chart.get_by_role('row').all())==6
 results['weekly_table']=chart.aria_snapshot()
 page.locator('#hide-values').click()
 for route,label in ROUTES.items():
  page.evaluate('(r)=>location.hash=r',route)
  page.wait_for_function('(label)=>document.querySelector("#breadcrumb").textContent===label',arg=label)
  text=page.locator('main').inner_text()
  for amount in ['34.410,00','8.450,00','1.250,00','6.000,00']:
   assert amount not in text,(route,'hidden amount',amount)
  assert page.locator('main progress').count()==0,route
 # Large values and a long description are a local view-only stress fixture.
 page.locator('#hide-values').click()
 page.evaluate('''async()=>{const F=await import('/finance.mjs');const V=await import('/views.mjs');const state=F.demo();state.accounts[0].opening=F.MAX_CENTS/10;state.entries[0].description='DescriçãoSemEspacos'.repeat(5);document.querySelector('main').innerHTML=V.renderView({state,month:F.localDate().slice(0,7),view:'lancamentos',slot:'demo',hidden:false,search:'',typeFilter:'all',statusFilter:'all',scope:'month',page:1})}''')
 for width in [320,390]:
  page.set_viewport_size({'width':width,'height':844})
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
  assert page.locator('.ledger-wrap').evaluate('e=>e.scrollWidth<=e.clientWidth+1')
 results['javascript_errors']=results.pop('errors')
 assert not results['javascript_errors'],results['javascript_errors']
 browser.close()
(OUT/'views-resultados.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(json.dumps({'layouts':len(results['layouts']),'weekly_table':'passed','hidden_values':'passed','tablet_nav_names':'passed','javascript_errors':results['javascript_errors'],'artifacts':str(OUT)},ensure_ascii=False))
