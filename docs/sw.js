// Offline support for the hosted app: own files are fetched fresh when online and served
// from the cache when offline; fonts are cached the first time they load.
const CACHE = 'f2l-coach-1792899635412';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('f2l-coach-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const keep = res => { if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; };
  if (new URL(req.url).origin !== self.location.origin) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(keep)));
    return;
  }
  e.respondWith(fetch(req).then(keep).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html'))));
});
