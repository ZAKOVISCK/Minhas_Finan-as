import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
const origin = 'https://financas.test';
const current = 'mf-core-1.4.0';
const previous = 'mf-core-1.1.2';

function harness({ shared, clients = [], failPath = '' } = {}) {
  const stores = shared || new Map();
  const requests = [];
  let skipped = 0, claimed = 0;
  const keyOf = value => new URL(typeof value === 'string' ? value : value.url, origin).href;
  class MemoryCache {
    entries = new Map();
    async put(key, response) { this.entries.set(keyOf(key), response.clone()); }
    async match(key) { return this.entries.get(keyOf(key))?.clone(); }
    async keys() { return [...this.entries.keys()].map(key => new Request(key)); }
    async delete(key) { return this.entries.delete(keyOf(key)); }
    async addAll(list) {
      const staged = [];
      for (const request of list) {
        requests.push(request);
        const pathname = new URL(request.url).pathname;
        if (pathname === failPath) throw new Error('Missing asset: ' + pathname);
        staged.push([request, new Response('new:' + pathname)]);
      }
      for (const [request, response] of staged) await this.put(request, response);
    }
  }
  const caches = {
    async open(name) { if (!stores.has(name)) stores.set(name, new MemoryCache()); return stores.get(name); },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  const handlers = new Map();
  const context = {
    URL, Request, Response, caches,
    fetch() { throw new Error('Unexpected runtime network request'); },
    self: {
      location: { origin },
      addEventListener(name, callback) { handlers.set(name, callback); },
      async skipWaiting() { skipped++; },
      clients: {
        async matchAll() { return clients.map(id => ({ id })); },
        async claim() { claimed++; },
      },
    },
  };
  vm.runInNewContext(source, context, { filename: 'sw.js' });
  async function dispatch(type, values = {}) {
    const pending = [];
    let response;
    handlers.get(type)({
      ...values,
      waitUntil(promise) { pending.push(promise); },
      respondWith(promise) { response = promise; },
    });
    await Promise.all(pending);
    return response;
  }
  const get = (pathname, options = {}) => dispatch('fetch', {
    request: { url: new URL(pathname, origin).href, method: 'GET', mode: 'cors', ...options.request },
    clientId: options.clientId || '', resultingClientId: options.resultingClientId || '',
  });
  return { caches, stores, requests, dispatch, get, get skipped() { return skipped; }, get claimed() { return claimed; } };
}

async function seedOld(h) {
  const cache = await h.caches.open(previous);
  for (const pathname of ['/', '/index.html', '/app.js', '/crypto.mjs', '/styles.css']) {
    await cache.put(pathname, new Response('old:' + pathname));
  }
}

test('installation refreshes the complete precache without activating a waiting update', async () => {
  const h = harness();
  await h.dispatch('install');
  assert.equal(h.skipped, 0);
  assert.equal(h.claimed, 0);
  assert.ok(h.requests.some(request => request.url.endsWith('/index.html')));
  assert.ok(h.requests.some(request => request.url.endsWith('/crypto.mjs')));
  assert.ok(h.requests.some(request => request.url.endsWith('/form-utils.mjs')));
  assert.ok(h.requests.every(request => request.cache === 'reload'));
  await h.dispatch('message', { data: { type: 'UNRELATED' } });
  assert.equal(h.skipped, 0);
  await h.dispatch('message', { data: { type: 'ACTIVATE' } });
  assert.equal(h.skipped, 1);
});

test('a missing release asset rejects installation and preserves the old working release', async () => {
  const h = harness({ failPath: '/storage.mjs' });
  await seedOld(h);
  await assert.rejects(h.dispatch('install'), /Missing asset/);
  assert.equal(await (await (await h.caches.open(previous)).match('/app.js')).text(), 'old:/app.js');
  assert.equal(await (await h.caches.open(current)).match('/index.html'), undefined);
  assert.equal(h.skipped, 0);
});

test('online and offline navigation use the installed document and matching modules', async () => {
  const h = harness();
  await h.dispatch('install');
  await h.dispatch('activate');
  assert.equal(await (await h.get('/?source=pwa', { request: { mode: 'navigate' }, resultingClientId: 'first-tab' })).text(), 'new:/index.html');
  assert.equal(await (await h.get('/app.js', { clientId: 'first-tab' })).text(), 'new:/app.js');
  assert.equal(await (await h.get('/crypto.mjs', { clientId: 'first-tab' })).text(), 'new:/crypto.mjs');
  assert.equal(h.claimed, 1);
});

test('activation preserves old open tabs while a reloaded tab moves to the new release', async () => {
  const h = harness({ clients: ['other-tab', 'updating-tab'] });
  await seedOld(h);
  await h.caches.open('mf-core-0.9.0');
  await h.caches.open('another-application');
  await h.dispatch('install');
  await h.dispatch('activate');
  assert.equal(await (await h.get('/app.js', { clientId: 'other-tab' })).text(), 'old:/app.js');
  assert.equal(await (await h.get('/', { request: { mode: 'navigate' }, clientId: 'updating-tab', resultingClientId: 'reloaded-tab' })).text(), 'new:/index.html');
  assert.equal(await (await h.get('/app.js', { clientId: 'reloaded-tab' })).text(), 'new:/app.js');
  assert.equal(await (await h.get('/crypto.mjs', { clientId: 'other-tab' })).text(), 'old:/crypto.mjs');
  assert.ok(h.stores.has(previous));
  assert.ok(h.stores.has('another-application'));
  assert.ok(!h.stores.has('mf-core-0.9.0'));
  const restarted = harness({ shared: h.stores });
  assert.equal(await (await restarted.get('/app.js', { clientId: 'other-tab' })).text(), 'old:/app.js');
});

test('API, cross-origin and write requests bypass the application precache', async () => {
  const h = harness();
  assert.equal(await h.get('/api/data?feed=macro'), undefined);
  assert.equal(await h.get('https://other.test/app.js'), undefined);
  assert.equal(await h.get('/app.js', { request: { method: 'POST' } }), undefined);
});

test('an evicted asset fails explicitly rather than mixing in a different network release', async () => {
  const h = harness();
  await h.dispatch('install');
  await (await h.caches.open(current)).delete('/app.js');
  const response = await h.get('/app.js');
  assert.equal(response.status, 503);
  assert.match(await response.text(), /conexão/);
});

test('the document and package identify the installed release', async () => {
  const html = await readFile(new URL('../lib/shell.html', import.meta.url), 'utf8');
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(current, 'mf-core-' + pkg.version);
  assert.ok(source.includes("const VERSION = '" + current + "'"));
  assert.ok(html.includes('name="application-version" content="' + pkg.version + '"'));
});
