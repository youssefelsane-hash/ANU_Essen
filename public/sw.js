/*
 * Merchant PWA service worker (scope: /merchant).
 * - App shell: pages network-first with cached fallback, hashed static assets cache-first.
 * - API calls are never cached here: order data lives in IndexedDB and syncs via the outbox/cursor.
 */
const VERSION = 'v1';
const STATIC_CACHE = `merchant-static-${VERSION}`;
const PAGE_CACHE = `merchant-pages-${VERSION}`;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('merchant-') && !k.endsWith(VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/_next/static/') || /\.(?:png|svg|ico|webmanifest|woff2?)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(req));
  } else if (req.mode === 'navigate' && url.pathname.startsWith('/merchant')) {
    event.respondWith(networkFirst(req));
  }
});

async function cacheFirst(req) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(req).then(
      (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function networkFirst(req) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const res = await fetchWithTimeout(req, 6000);
    // Never cache a redirect to the login page as the app shell.
    if (res.ok && !res.redirected) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = (await cache.match(req, { ignoreSearch: true })) || (await cache.match('/merchant'));
    if (hit) return hit;
    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body dir="rtl" style="font-family:system-ui;padding:24px"><h2>مفيش نت</h2><p>افتح صفحة الطلبات مرة واحدة وانت متصل، وبعدها هتشتغل حتى لو النت قطع.</p></body>',
      { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  }
}
