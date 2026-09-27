// Dinner Count service worker: the 4 PM push, and an offline app shell.
const SHELL = 'dc-shell-v3';
const FILES = ['/app/', '/app/app.css', '/app/app.js', '/shared/tokens.css', '/app/icons/icon.svg', '/app/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// App shell: network first (fresh code), cache when offline. The API is never cached here.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Bypass the HTTP cache so a deploy reaches phones on the next open, not an hour later.
  e.respondWith(fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }).then((res) => {
    if (res.ok && (FILES.includes(url.pathname) || url.pathname.startsWith('/assets/dish-'))) {
      const copy = res.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy));
    }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('/app/'))));
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Home for dinner?', {
    body: d.body || 'Home, Save me a plate, or Out. One tap.',
    tag: d.tag || 'dinner-question', renotify: true,
    icon: '/app/icons/icon-192.png', badge: '/app/icons/badge-96.png',
    data: { url: d.url || '/app/#/today' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/app/#/today', location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    const w = wins.find((c) => c.url.includes('/app/'));
    if (w) { w.navigate(url).catch(() => {}); return w.focus(); }
    return self.clients.openWindow(url);
  }));
});
