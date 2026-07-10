/* App-shell service worker. Caches the static UI so the PWA opens instantly and
   offline; task DATA always goes to the network (never cached). */
const CACHE = 'taskmgr-shell-v10';
const SHELL = [
  './', './index.html', './styles.css',
  './config.js', './auth.js', './api.js', './app.js',
  './manifest.json', './icon.svg'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }));
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  const url = new URL(e.request.url);
  // Never touch API calls or Google auth — always straight to network.
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  // Network-first so a bad/stale cache can never white-screen the app; fall
  // back to cache only when offline. Keeps the cache fresh for offline use.
  e.respondWith(
    fetch(e.request).then(function (resp) {
      if (resp && resp.ok) {
        const copy = resp.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      }
      return resp;
    }).catch(function () {
      return caches.match(e.request).then(function (hit) {
        return hit || caches.match('./index.html');
      });
    })
  );
});
