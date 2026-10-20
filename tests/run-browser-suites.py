"""Run existing Chromium suites; do not add their overlapping counts to compat."""
import argparse,json,os,subprocess,sys
from pathlib import Path
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);args=p.parse_args();args.output.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw: executable=pw.chromium.executable_path
env=dict(os.environ,CHROMIUM_PATH=executable,APP_TEST_RESULTS=str(args.output/'controller.json'))
commands=[
 ('controller',['tests/app.browser.py']),
 ('categories',['tests/categories.browser.py','http://127.0.0.1:3000',str(args.output/'categories.json')]),
 ('vault',['tests/security-vault.py','--base-url','http://127.0.0.1:3000']),
 ('storage',['tests/storage.browser.py','--output',str(args.output/'storage.json')]),
 ('imports',['tests/imports.browser.py','http://127.0.0.1:3000',str(args.output/'imports.json')]),
 ('recovery',['tests/recovery.browser.py','http://127.0.0.1:3000',str(args.output/'recovery.json')]),
 ('views',['tests/browser_views.py','http://127.0.0.1:3000',str(args.output/'views')]),
]
results=[]
for name,command in commands:
 try:
  r=subprocess.run([sys.executable,*command],capture_output=True,text=True,timeout=240,env=env)
  (args.output/(name+'.log')).write_text(r.stdout+r.stderr)
  results.append({'suite':name,'status':'passed' if r.returncode==0 else 'failed','exitCode':r.returncode})
 except subprocess.TimeoutExpired as error:
  results.append({'suite':name,'status':'inconclusive','reason':'timeout','timeoutSeconds':240})
 print(json.dumps(results[-1]),flush=True)
 if results[-1]['status']!='passed' and 'r' in locals():print((r.stdout+r.stderr)[-4000:],flush=True)
report={'suites':results,'countsOverlapWithCompatibility':True,'aggregateScenarioCount':None}
(args.output/'suite-results.json').write_text(json.dumps(report,indent=2))
raise SystemExit(0 if all(x['status']=='passed' for x in results) else 1)
