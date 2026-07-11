/* CuraNova service worker — offline app shell + safe passthrough for Supabase */
const CACHE = 'curanova-v10';
const CORE = ['./', './index.html', './scoring.js', './interventions.js', './migrations.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './logo-tile.png'];
// Pinned + SRI-verified in index.html. Fetch CORS (not no-cors) so the cached copy
// is a readable response the browser can validate against the integrity hash —
// a cached opaque response would fail SRI and block the library.
const EXTRA = ['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.2/dist/umd/supabase.js'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(CORE).catch(() => {});
    await Promise.all(EXTRA.map(u => fetch(u, { mode: 'cors' }).then(r => c.put(u, r)).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never cache Supabase REST / auth / realtime — the app handles offline via its own queue.
  if (url.hostname.endsWith('supabase.co')) return;

  // App navigations: network-first, fall back to cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const net = await fetch(req);
        const c = await caches.open(CACHE);
        c.put('./index.html', net.clone());
        return net;
      } catch (_) {
        return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Other GETs (assets, fonts, cdn lib): stale-while-revalidate.
  e.respondWith((async () => {
    const cached = await caches.match(req);
    const fetching = fetch(req).then(r => {
      if (r && (r.ok || r.type === 'opaque')) {
        caches.open(CACHE).then(c => c.put(req, r.clone()));
      }
      return r;
    }).catch(() => cached);
    return cached || fetching;
  })());
});
