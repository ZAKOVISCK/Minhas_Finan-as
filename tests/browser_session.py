"""Disposable, encrypted fixtures. This module is never served by the app."""
from playwright.sync_api import expect
TEST_PASSWORD = "senha sintética exclusiva das fixtures QA 2026"

def unlock_fixture(page, password=TEST_PASSWORD):
    expect(page.locator("#access-screen")).to_be_visible()
    page.locator("#access-primary").click()
    expect(page.locator("#dialog-title")).to_have_text("Abrir cofre pessoal")
    page.locator('#dialog-form input[name="password"]').fill(password)
    page.locator("#dialog-submit").click()
    expect(page.locator("#dialog")).not_to_be_visible()
    expect(page.locator("#access-screen")).to_be_hidden()
    expect(page.locator("#main")).to_have_attribute("aria-busy", "false")

def reload_fixture(page, password=TEST_PASSWORD, wait_until="domcontentloaded"):
    route = page.url.split("#",1)[1] if "#" in page.url else "inicio"
    page.reload(wait_until=wait_until)
    unlock_fixture(page, password)
    page.evaluate("(route)=>location.hash=route",route)

def seed_fixture(page, state=None, password=TEST_PASSWORD):
    expect(page.locator("#access-primary")).to_be_enabled()
    page.evaluate("""async ({state,password})=>{
      const S=await import('/storage.mjs'),F=await import('/finance.mjs'),C=await import('/crypto.mjs'),db=await S.openDatabase();
      try{
        const raw=await S.loadRaw(db,'personal');
        if(raw.head||raw.records.length||raw.journal)throw Error('Fixture expects an empty personal slot.');
        const kdf=C.newKdf(),key=await C.deriveKey(password,kdf);
        await S.saveSlot(db,'personal',null,state||F.demo(),-1,{key,kdf});
      }finally{db.close()}
    }""", {"state":state,"password":password})
    reload_fixture(page,password)

def read_fixture(page, password=TEST_PASSWORD):
    return page.evaluate("""async password=>{
      const S=await import('/storage.mjs'),C=await import('/crypto.mjs'),db=await S.openDatabase();
      try{
        const raw=await S.loadRaw(db,'personal');
        return await S.decodeRaw(raw,await C.deriveKey(password,raw.head.kdf));
      }finally{db.close()}
    }""",password)

def decrypt_fixture_backup(page, text, password=TEST_PASSWORD):
    return page.evaluate("async ({text,password})=>(await import('/crypto.mjs')).readBackup(text,password)",{"text":text,"password":password})
