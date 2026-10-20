import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarketService } from '../lib/market-server.mjs';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const xml = data => new Response(data, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
const observations = Array.from({ length: 13 }, (_, index) => {
  const date = new Date(Date.UTC(2025, 8 + index, 1));
  return { data: `01/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`, valor: '0.5' };
});
const ibge = overrides => ({ items: [{ titulo: 'IPCA: preços & resultados', link: 'https://agenciadenoticias.ibge.gov.br/agencia-noticias/noticia.html', data_publicacao: '19/10/2026 09:30:00', ...overrides }] });
const rssItem = (title = 'Minutes &amp; statement', link = 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20261019a.htm', date = 'Mon, 19 Oct 2026 14:00:00 EDT') => `<item><title>${title}</title><link>${link}</link><pubDate>${date}</pubDate></item>`;
const rss = items => `<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>Press releases</title>${items}</channel></rss>`;
const quote = overrides => ({ symbol: 'PETR4', regularMarketPrice: 30.25, regularMarketChangePercent: -0.5, regularMarketTime: '2026-10-19T20:00:00Z', ...overrides });
function fixtures(url) {
  if (url.includes('sgs.432')) return json([{ data: '19/10/2026', valor: '13.75' }]);
  if (url.includes('sgs.433')) return json([...observations].reverse());
  if (url.includes('olinda.bcb.gov.br')) return json({ value: [
    { cotacaoVenda: 5.1, dataHoraCotacao: '2026-10-16 13:05:45.12345' },
    { cotacaoVenda: 5.05, dataHoraCotacao: '2026-10-19 13:05:45.12345' },
  ] });
  if (url.includes('servicodados.ibge.gov.br')) return json(ibge());
  if (url.includes('federalreserve.gov')) return xml(rss(rssItem()));
  if (url.includes('brapi.dev')) return json({ results: [quote(), quote({ symbol: 'VALE3', regularMarketPrice: 60 })] });
  throw new Error('Unexpected destination: ' + url);
}

test('macro uses actual official formats and computes a compounded consecutive 12-month IPCA', async () => {
  const calls = [];
  const service = createMarketService({ now: () => NOW, fetchImpl: async (url, options) => { calls.push({ url, options }); return fixtures(url); } });
  const result = await service.getFeed('macro');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.items.map(item => item.id), ['selic', 'ipca', 'ipca12', 'ptax']);
  assert.equal(result.body.items[0].value, 13.75);
  assert.equal(result.body.items[1].reference, '2026-09');
  assert.ok(Math.abs(result.body.items[2].value - ((1.005 ** 12) - 1) * 100) < 1e-10);
  assert.equal(result.body.items[3].value, 5.05);
  assert.match(result.body.items[3].note, /não é dólar em tempo real/);
  assert.deepEqual(result.body.errors, []);
  assert.equal(Date.parse(result.body.expiresAt) - NOW, 7200000);
  assert.equal(calls.length, 3);
  for (const call of calls) { assert.match(call.url, /^https:\/\/(?:api|olinda)\.bcb\.gov\.br\//); assert.equal(call.options.redirect, 'error'); assert.ok(call.options.signal instanceof AbortSignal); }
  const ptax = new URL(calls.find(call => call.url.includes('olinda')).url);
  assert.equal(ptax.searchParams.get('@dataInicial'), "'10-10-2026'");
  assert.equal(ptax.searchParams.get('@dataFinalCotacao'), "'10-20-2026'");
  assert.ok(!ptax.href.includes('+'));
  const selic = new URL(calls.find(call => call.url.includes('sgs.432')).url);
  assert.equal(selic.searchParams.get('dataFinal'), '20/10/2026');
  const ipca = new URL(calls.find(call => call.url.includes('sgs.433')).url);
  assert.equal(ipca.searchParams.get('dataFinal'), '30/09/2026');
});

test('incomplete IPCA history keeps the monthly indicator and never fabricates a yearly rate', async () => {
  const service = createMarketService({ now: () => NOW, fetchImpl: async url => url.includes('sgs.433') ? json(observations.filter((_, i) => i !== 8)) : fixtures(url) });
  const result = await service.getFeed('macro');
  assert.equal(result.status, 200);
  assert.equal(result.body.items.some(item => item.id === 'ipca12'), false);
  assert.equal(result.body.items.some(item => item.id === 'ipca'), true);
  assert.match(result.body.errors.join(), /12 meses consecutivos/);
});

test('independent macro sources retain valid indicators with explicit partial errors', async () => {
  const service = createMarketService({ now: () => NOW, fetchImpl: async url => url.includes('sgs.432') ? json({ wrong: true }) : fixtures(url) });
  const result = await service.getFeed('macro');
  assert.equal(result.status, 200);
  assert.equal(result.body.items.some(item => item.id === 'selic'), false);
  assert.equal(result.body.items.length, 3);
  assert.match(result.body.errors.join(), /Selic/);
  assert.equal(Date.parse(result.body.expiresAt) - NOW, 300000);
});

test('future, stale and non-finite source observations cannot become published rates', async () => {
  const service = createMarketService({ now: () => NOW, fetchImpl: async url => {
    if (url.includes('sgs.432')) return json([{ data: '01/01/2025', valor: '10' }]);
    if (url.includes('sgs.433')) return json([{ data: '01/11/2026', valor: '0.5' }]);
    return json({ value: [{ cotacaoVenda: 'Infinity', dataHoraCotacao: '2026-10-19 13:00:00' }] });
  } });
  const result = await service.getFeed('macro');
  assert.equal(result.status, 503);
  assert.match(result.body.error, /Selic.*desatualizada/);
  assert.match(result.body.error, /IPCA/);
  assert.match(result.body.error, /PTAX/);
  assert.equal(result.body.items, undefined);
  assert.equal(result.retryAfter, 300);
});

test('IBGE news validates dates and official links, removes duplicates and preserves attribution', async () => {
  const first = ibge({ link: 'http://agenciadenoticias.ibge.gov.br/agencia-noticias/noticia.html' }).items[0];
  const service = createMarketService({ now: () => NOW, fetchImpl: async () => json({ items: [first, first,
    { ...first, link: 'javascript:alert(1)' }, { ...first, link: 'https://ibge.gov.br.attacker.test/' },
    { ...first, link: 'https://ibge.gov.br/invalid', data_publicacao: '31/02/2026 10:00:00' },
    { ...first, link: 'https://ibge.gov.br/future', data_publicacao: '01/01/2027 10:00:00' },
  ] }) });
  const result = await service.getFeed('brazil');
  assert.equal(result.status, 200);
  assert.equal(result.body.items.length, 1);
  assert.equal(result.body.items[0].publishedAt, '2026-10-19T12:30:00.000Z');
  assert.equal(result.body.items[0].language, 'pt-BR');
  assert.equal(result.body.items[0].source, 'Agência IBGE Notícias');
  assert.match(result.body.items[0].url, /^https:\/\//);
});

test('Federal Reserve RSS handles entities and CDATA while accepting official links only', async () => {
  const body = rss(rssItem('<![CDATA[Minutes <em>of</em> meeting]]>') + rssItem('Rate &#x26; statement', 'https://www.federalreserve.gov/newsevents/statement.htm') + rssItem('Unsafe', 'https://federalreserve.gov.attacker.test/'));
  const service = createMarketService({ now: () => NOW, fetchImpl: async () => xml(body) });
  const result = await service.getFeed('global');
  assert.equal(result.status, 200);
  assert.equal(result.body.items.length, 2);
  assert.equal(result.body.items[0].title, 'Minutes of meeting');
  assert.equal(result.body.items[1].title, 'Rate & statement');
  assert.equal(result.body.items[0].publishedAt, '2026-10-19T18:00:00.000Z');
  assert.equal(result.body.items[0].language, 'en');
  const bad = createMarketService({ now: () => NOW, fetchImpl: async () => xml('<!DOCTYPE rss [<!ENTITY leak SYSTEM "file:///etc/passwd">]>' + body) });
  assert.equal((await bad.getFeed('global')).status, 503);
});

test('samples are opt-in, limited to fixed demo tickers and never manufacture missing quotations', async () => {
  const calls = [];
  const service = createMarketService({ now: () => NOW, fetchImpl: async url => { calls.push(url); return json({ results: [quote(), quote({ symbol: 'VALE3', regularMarketPrice: -1 }), quote({ symbol: 'ANYTHING' }), quote({ regularMarketTime: '2027-01-01T12:00:00Z' })] }); } });
  assert.equal(calls.length, 0);
  const result = await service.getFeed('samples');
  assert.equal(calls[0], 'https://brapi.dev/api/quote/PETR4,VALE3');
  assert.deepEqual(result.body.items, [{ symbol: 'PETR4', price: 30.25, change: -0.5, reference: '2026-10-19T20:00:00.000Z' }]);
});

test('public cache coalesces concurrent requests, expires and cannot be mutated by a caller', async () => {
  let clock = NOW, calls = 0, release;
  const gate = new Promise(resolve => release = resolve);
  const service = createMarketService({ now: () => clock, fetchImpl: async url => { calls++; await gate; return fixtures(url); } });
  const one = service.getFeed('brazil'), two = service.getFeed('brazil');
  assert.equal(calls, 1);
  release();
  const [a, b] = await Promise.all([one, two]);
  a.body.items[0].title = 'Changed by caller';
  assert.notEqual(b.body.items[0].title, a.body.items[0].title);
  assert.notEqual((await service.getFeed('brazil')).body.items[0].title, a.body.items[0].title);
  assert.equal(calls, 1);
  clock += 3600001;
  assert.equal((await service.getFeed('brazil')).status, 200);
  assert.equal(calls, 2);
});

test('429 Retry-After is bounded and prevents repeated outbound requests until the retry time', async () => {
  let clock = NOW, calls = 0;
  const service = createMarketService({ now: () => clock, fetchImpl: async () => { calls++; return json({ ignored: true }, 429, { 'Retry-After': '120' }); } });
  const first = await service.getFeed('global');
  assert.equal(first.status, 503);
  assert.equal(first.retryAfter, 120);
  assert.match(first.body.error, /limite de consultas/);
  await service.getFeed('global');
  assert.equal(calls, 1);
  clock += 120001;
  await service.getFeed('global');
  assert.equal(calls, 2);
});

test('failed refresh retains explicitly stale data for at most 24 hours', async () => {
  let clock = NOW, failed = false;
  const service = createMarketService({ now: () => clock, fetchImpl: async url => { if (failed) throw new TypeError('arbitrary private implementation details'); return fixtures(url); } });
  const first = await service.getFeed('brazil');
  clock += 3600001;
  failed = true;
  const stale = await service.getFeed('brazil');
  assert.equal(stale.status, 200);
  assert.deepEqual(stale.body.items, first.body.items);
  assert.equal(stale.body.fetchedAt, first.body.fetchedAt);
  assert.ok(Date.parse(stale.body.expiresAt) < clock);
  assert.match(stale.body.errors.join(), /desatualizados/);
  assert.doesNotMatch(JSON.stringify(stale), /arbitrary private/);
  clock += 24 * 3600000;
  const expired = await service.getFeed('brazil');
  assert.equal(expired.status, 503);
  assert.equal(expired.body.items, undefined);
});

test('oversized, invalid UTF-8, wrong MIME and malformed JSON responses fail explicitly', async () => {
  const cases = [
    () => new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': '1048577' } }),
    () => new Response(new Uint8Array([0xff, 0xfe]), { headers: { 'Content-Type': 'application/json' } }),
    () => new Response('<html>error</html>', { headers: { 'Content-Type': 'text/html' } }),
    () => new Response('{malformed', { headers: { 'Content-Type': 'application/json' } }),
    () => new Response('x'.repeat(1048577), { headers: { 'Content-Type': 'application/json' } }),
  ];
  for (const response of cases) {
    const service = createMarketService({ now: () => NOW, fetchImpl: async () => response() });
    const result = await service.getFeed('brazil');
    assert.equal(result.status, 503);
    assert.equal(result.body.items, undefined);
  }
});

test('upstream deadlines cover an unresponsive fetch without weakening TLS or redirect checks', async () => {
  let signal;
  const service = createMarketService({ now: () => NOW, timeoutMs: 10, fetchImpl: async (url, options) => { signal = options.signal; return new Promise(() => {}); } });
  const result = await service.getFeed('global');
  assert.equal(result.status, 503);
  assert.match(result.body.error, /tempo/);
  assert.equal(signal.aborted, true);
});

test('upstream deadlines also cover a stalled response body', async () => {
  let canceled = false;
  const service = createMarketService({ now: () => NOW, timeoutMs: 10, fetchImpl: async () => new Response(new ReadableStream({ cancel() { canceled = true; } }), { headers: { 'Content-Type': 'application/json' } }) });
  assert.equal((await service.getFeed('brazil')).status, 503);
  assert.equal(canceled, true);
});

test('invalid feed names and URL-like strings never cause an outbound request', async () => {
  let calls = 0;
  const service = createMarketService({ fetchImpl: async () => { calls++; throw new Error('must not fetch'); } });
  for (const feed of ['__proto__', 'constructor', 'toString', 'https://127.0.0.1/', '', null, 'MACRO']) assert.equal((await service.getFeed(feed)).status, 400);
  assert.equal(calls, 0);
});
