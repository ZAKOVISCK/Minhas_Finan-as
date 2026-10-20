const VERSION = 'mf-core-1.1.0';
const META_CACHE = 'mf-worker-meta';
const META_ROOT = new URL('/__mf_worker__/', self.location.origin).href;
const FILES = [
  '/', '/index.html', '/styles.css', '/app.js', '/finance.mjs', '/legacy-finance.mjs',
  '/storage.mjs', '/crypto.mjs', '/views.mjs', '/imports.mjs', '/market.mjs', '/form-utils.mjs',
  '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png',
];

async function readMeta(key) {
  const response = await (await caches.open(META_CACHE)).match(META_ROOT + key);
  return response ? response.text() : null;
}
async function writeMeta(key, value) {
  await (await caches.open(META_CACHE)).put(META_ROOT + key, new Response(value));
}
const clientKey = id => 'client/' + encodeURIComponent(id);

self.addEventListener('install', event => {
  // addAll is atomic. A missing asset must leave the previous worker in charge.
  // Bypass the HTTP cache so a newly installed release cannot reuse old modules.
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(FILES.map(path => new Request(new URL(path, self.location.origin), { cache: 'reload' })))));
});

self.addEventListener('message', event => {
  // Installation alone never replaces a release while a form is being edited.
  if (event.data?.type === 'ACTIVATE') event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => event.waitUntil((async () => {
  const names = await caches.keys();
  const previous = await readMeta('active') || names
    .filter(name => name.startsWith('mf-core-') && name !== VERSION)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).at(-1);
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const retained = new Set([VERSION]);
  // Other open tabs keep their matching HTML/modules until they navigate again.
  // Persist the association because a browser can stop and restart this worker.
  for (const client of clients) {
    const version = await readMeta(clientKey(client.id)) || previous || VERSION;
    retained.add(version);
    await writeMeta(clientKey(client.id), version);
  }
  await writeMeta('active', VERSION);
  for (const name of names) {
    if (name.startsWith('mf-core-') && !retained.has(name)) await caches.delete(name);
  }
  const meta = await caches.open(META_CACHE);
  const liveKeys = new Set(clients.map(client => META_ROOT + clientKey(client.id)));
  for (const request of await meta.keys()) {
    if (request.url.startsWith(META_ROOT + 'client/') && !liveKeys.has(request.url)) await meta.delete(request);
  }
  await self.clients.claim();
})()));

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !FILES.includes(url.pathname)) return;
  event.respondWith((async () => {
    const navigating = event.request.mode === 'navigate';
    const version = navigating ? VERSION : (event.clientId && await readMeta(clientKey(event.clientId))) || VERSION;
    const cache = await caches.open(version);
    // HTML and code always come from the same installed release, online or offline.
    // A missing/evicted precache must not fall back to a different network version.
    const response = await cache.match(navigating ? '/index.html' : url.pathname);
    if (!response) return new Response('O aplicativo offline precisa ser reinstalado com conexão. Recarregue após verificar a atualização.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    const clientId = event.resultingClientId || event.clientId;
    if (navigating && clientId) await writeMeta(clientKey(clientId), VERSION);
    return response;
  })());
});
