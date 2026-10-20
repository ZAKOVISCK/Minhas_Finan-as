import test from 'node:test';
import assert from 'node:assert/strict';

let moduleId = 0;
async function fresh(t) {
  const originalFetch = globalThis.fetch;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  } });
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete globalThis.localStorage;
  });
  return { ...(await import(`../market.mjs?test=${++moduleId}`)), values };
}
const macro = overrides => ({ id: 'selic', name: 'Selic meta', value: 13.75, unit: '% a.a.', source: 'BCB', reference: '2025-01-01', url: 'https://www.bcb.gov.br/controleinflacao/taxaselic', ...overrides });
function envelope(items, overrides = {}) {
  return { items, errors: [], fetchedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(), ...overrides };
}
const news = (feed, overrides = {}) => ({ title: 'Comunicado oficial', source: feed === 'global' ? 'Federal Reserve' : 'IBGE', url: feed === 'global' ? 'https://www.federalreserve.gov/newsevents/' : 'https://agenciadenoticias.ibge.gov.br/noticias', ...overrides });
function installSuccessfulFetch(overrides = {}) {
  globalThis.fetch = async url => {
    const feed = new URL(url, 'https://example.test').searchParams.get('feed');
    const data = overrides[feed] ?? envelope(feed === 'macro' ? [macro()] : feed === 'samples' ? [{ symbol: 'PETR4', price: 30, change: null }] : [news(feed)]);
    return new Response(JSON.stringify(data), { status: 200 });
  };
}

test('invalid, expired and excessive cache lifetimes cannot stay fresh forever', async t => {
  const { stale } = await fresh(t);
  assert.equal(stale({ expiresAt: 'not-a-date' }), true);
  assert.equal(stale(envelope([macro()], { expiresAt: 'not-a-date' })), true);
  assert.equal(stale(envelope([macro()], { fetchedAt: new Date(Date.now() - 2 * 86400000).toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() })), true);
  assert.equal(stale(envelope([macro()])), false);
});

test('cache restoration validates content and rejects invalid timestamps and unsafe URLs', async t => {
  const { restorePublicCache, marketState, values } = await fresh(t);
  values.set('mf-public-v1:macro', JSON.stringify(envelope([macro()], { expiresAt: 'invalid' })));
  values.set('mf-public-v1:brazil', JSON.stringify(envelope([news('brazil', { url: 'javascript:alert(1)' })])));
  values.set('mf-public-v1:global', JSON.stringify(envelope([news('global', { url: 'https://federalreserve.gov.attacker.test/fake' })])));
  restorePublicCache();
  assert.equal(marketState.macro, null);
  assert.equal(marketState.brazil, null);
  assert.equal(marketState.global, null);
  assert.equal(values.has('mf-public-v1:brazil'), false);
});

test('cache restoration keeps only validated official data', async t => {
  const { restorePublicCache, marketState, values } = await fresh(t);
  values.set('mf-public-v1:macro', JSON.stringify(envelope([macro(), macro({ id: 'invalid', value: null })])));
  values.set('mf-public-v1:brazil', JSON.stringify(envelope([news('brazil'), news('brazil', { url: 'https://user:password@ibge.gov.br/path' })])));
  restorePublicCache();
  assert.equal(marketState.macro.items.length, 1);
  assert.equal(marketState.brazil.items.length, 1);
  assert.match(marketState.errors.macro, /inválidos/);
});

test('independent feeds load concurrently and always clear loading', async t => {
  const { updateMarket, marketState } = await fresh(t);
  const pending = [];
  globalThis.fetch = url => new Promise(resolve => pending.push({ url, resolve }));
  const update = updateMarket();
  assert.equal(pending.length, 3);
  assert.equal(marketState.loading, true);
  for (const request of pending) {
    const feed = new URL(request.url, 'https://example.test').searchParams.get('feed');
    request.resolve(new Response(JSON.stringify(envelope(feed === 'macro' ? [macro()] : [news(feed)])), { status: 200 }));
  }
  await update;
  assert.equal(marketState.loading, false);
  assert.equal(marketState.macro.items[0].value, 13.75);
});

test('partial macro responses retain previous missing indicators with explicit stale metadata', async t => {
  const { updateMarket, marketState } = await fresh(t);
  marketState.macro = envelope([macro({ id: 'ipca', name: 'IPCA', value: 0.5 })], { fetchedAt: '2025-01-01T00:00:00Z', expiresAt: '2025-01-01T01:00:00Z' });
  installSuccessfulFetch({ macro: envelope([macro()], { errors: ['IPCA temporariamente indisponível'] }) });
  await updateMarket();
  assert.equal(marketState.macro.items.length, 2);
  assert.equal(marketState.macro.items[1]._stale, true);
  assert.equal(marketState.macro.items[1]._fetchedAt, '2025-01-01T00:00:00Z');
  assert.match(marketState.errors.macro, /IPCA/);
});

test('HTML/server/network failures preserve previous values, mark stale and use clear errors', async t => {
  const { updateMarket, marketState, stale } = await fresh(t);
  marketState.macro = envelope([macro()], { fetchedAt: '2025-01-01T00:00:00Z', expiresAt: '2025-01-01T01:00:00Z' });
  globalThis.fetch = async url => {
    if (url.includes('macro')) return new Response('<html>Unavailable</html>', { status: 503 });
    if (url.includes('brazil')) throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify({ error: 'Backend de fontes não fornecido.' }), { status: 503 });
  };
  await updateMarket();
  assert.equal(marketState.macro.items[0].value, 13.75);
  assert.equal(stale(marketState.macro), true);
  assert.match(marketState.errors.macro, /HTTP 503/);
  assert.match(marketState.errors.brazil, /conexão/);
  assert.match(marketState.errors.global, /Backend/);
  assert.equal(marketState.loading, false);
});

test('rate-limited and failed feeds respect retry backoff', async t => {
  const { updateMarket } = await fresh(t);
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ error: 'Limite de consulta.' }), { status: 429, headers: { 'Retry-After': '120' } }); };
  await updateMarket();
  await updateMarket();
  assert.equal(calls, 3);
});

test('retry backoff expires and renews after a later network failure', async t => {
  const { updateMarket } = await fresh(t);
  let clock = Date.now(), calls = 0;
  t.mock.method(Date, 'now', () => clock);
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ error: 'Limite.' }), { status: 429, headers: { 'Retry-After': '120' } }); };
  await updateMarket();
  clock += 120001;
  globalThis.fetch = async () => { calls++; throw new TypeError('Network failure'); };
  await updateMarket();
  await updateMarket();
  assert.equal(calls, 6);
});

test('fresh cache avoids unnecessary fetches and samples require explicit opt-in', async t => {
  const { updateMarket, marketState } = await fresh(t);
  const calls = [];
  installSuccessfulFetch();
  const implementation = globalThis.fetch;
  globalThis.fetch = async url => { calls.push(url); return implementation(url); };
  await updateMarket();
  assert.equal(marketState.samples, null);
  assert.equal(calls.length, 3);
  await updateMarket(undefined, true);
  assert.equal(calls.length, 4);
  assert.match(calls[3], /feed=samples/);
});

test('malformed source values never become NaN/Infinity or executable news links', async t => {
  const { updateMarket, marketState } = await fresh(t);
  installSuccessfulFetch({
    macro: envelope([macro({ value: '13,75' })]),
    brazil: envelope([news('brazil', { url: 'data:text/html,bad' })]),
    global: envelope([news('global', { url: 'https://federalreserve.gov:8443/path' })]),
    samples: envelope([{ symbol: 'X', price: 1e300, change: null }]),
  });
  await updateMarket(undefined, true);
  for (const feed of ['macro', 'brazil', 'global', 'samples']) {
    assert.equal(marketState[feed], null);
    assert.ok(marketState.errors[feed]);
  }
});

test('storage rejection does not discard successfully loaded public data', async t => {
  const { updateMarket, marketState } = await fresh(t);
  localStorage.setItem = () => { throw new Error('Quota'); };
  installSuccessfulFetch();
  await updateMarket();
  assert.equal(marketState.macro.items.length, 1);
  assert.equal(marketState.loading, false);
});
