/* Service worker: makes the app work with no signal after the first visit.
 * Strategy: serve from cache immediately, refresh the cache in the background
 * (so updated code or data shows up on the next launch). Bump CACHE to force a clean slate. */
const CACHE = 'momir-v3';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'format.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    try { await cache.add('creatures.json'); } catch (e) { /* cached on first successful fetch instead */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then(res => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    });
    if (cached) { network.catch(() => {}); return cached; }
    return network;
  })());
});
