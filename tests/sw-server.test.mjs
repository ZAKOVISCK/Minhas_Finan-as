import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAppServer } from '../server.mjs';

async function serve(t, options) {
  const server = createAppServer(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return 'http://127.0.0.1:' + server.address().port;
}

test('the local server serves browser modules and scoped service workers with correct headers', async t => {
  const base = await serve(t);
  const html = await fetch(base + '/');
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-type'), /text\/html/);
  assert.match(html.headers.get('content-security-policy'), /object-src 'none'/);
  assert.doesNotMatch(html.headers.get('content-security-policy'), /unsafe-inline|unsafe-eval/);
  assert.match(await html.text(), /application-version/);
  const cryptoModule = await fetch(base + '/crypto.mjs');
  assert.match(cryptoModule.headers.get('content-type'), /javascript/);
  const forms = await fetch(base + '/form-utils.mjs');
  assert.equal(forms.status, 200);
  assert.match(forms.headers.get('content-type'), /javascript/);
  const worker = await fetch(base + '/sw.js');
  assert.equal(worker.headers.get('service-worker-allowed'), '/');
  assert.match(worker.headers.get('cache-control'), /no-cache/);
  const etag = worker.headers.get('etag');
  assert.equal((await fetch(base + '/sw.js', { headers: { 'If-None-Match': etag } })).status, 304);
});

test('private project files and paths outside the public allowlist are never served', async t => {
  const base = await serve(t);
  for (const path of ['/.git/config', '/.env', '/package.json', '/README.md', '/market-server.mjs', '/tests/sw.test.mjs', '/%2e%2e%2f.git/config', '/app.js%00']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
  assert.equal((await fetch(base + '/%ZZ')).status, 400);
  const post = await fetch(base + '/', { method: 'POST', body: 'not saved' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
});

test('public market API returns the backend result without exposing financial storage', async t => {
  const calls = [];
  const body = { items: [{ id: 'selic', value: 10 }], fetchedAt: '2026-01-01T00:00:00Z' };
  const base = await serve(t, { marketService: { getFeed: async feed => { calls.push(feed); return { status: 200, body }; } } });
  const response = await fetch(base + '/api/data?feed=macro');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.deepEqual(await response.json(), body);
  assert.deepEqual(calls, ['macro']);
  assert.deepEqual(await (await fetch(base + '/api/health')).json(), { ok: true });
  for (const path of ['/api/data', '/api/data?feed=macro&feed=brazil', '/api/data?feed=macro&url=https://attacker.test', '/api/unknown']) assert.ok([400, 404].includes((await fetch(base + path)).status));
  assert.equal((await fetch(base + '/api/data?feed=macro', { headers: { Origin: 'https://attacker.test' } })).status, 403);
  assert.equal((await fetch(base + '/api/data?feed=macro', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.deepEqual(calls, ['macro']);
});

test('unavailable public sources return a retry interval and an honest API error', async t => {
  const base = await serve(t, { marketService: { getFeed: async () => ({ status: 503, retryAfter: 300, body: { error: 'Fonte temporariamente indisponível.' } }) } });
  const response = await fetch(base + '/api/data?feed=macro');
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), '300');
  assert.deepEqual(await response.json(), { error: 'Fonte temporariamente indisponível.' });
});
