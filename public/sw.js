// Service worker: maakt de app installeerbaar en laat hem offline starten.
// Alleen eigen bestanden worden gecachet; API-verkeer (mempool, Bitvavo) gaat altijd rechtstreeks.
const CACHE = 'wallet-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => {
  // Ook de gebouwde bestanden (assets/…) uit index.html meenemen, zodat de app direct offline start.
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL);
    const html = await (await fetch('./index.html', { cache: 'no-store' })).text();
    const assets = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+)"/g)].map((m) => './' + m[1]);
    await c.addAll(assets);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Pagina: eerst netwerk (altijd de nieuwste versie), offline uit de cache.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copy)); return r; })
      .catch(() => caches.match('./index.html', { ignoreVary: true })));
    return;
  }
  // Bestanden met hash in de naam: eerst cache.
  e.respondWith(caches.match(req, { ignoreVary: true }).then((hit) => hit || fetch(req).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return r;
  })));
});
