// Service worker : garde la coquille de l'application pour l'ouvrir sans réseau. Les appels à l'API ne sont jamais mis en cache ici
// (les données lues hors-ligne viennent du cache applicatif, voir src/api/client.ts).
const CACHE = 'carnet-shell-__BUILD__';
const SHELL = ['/', '/app.js', '/app.css', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // réseau d'abord (version à jour), cache en secours
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r ?? caches.match('/'))),
  );
});
