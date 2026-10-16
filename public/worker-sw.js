// Preciops worker app: keeps a worker's private page usable without a signal.
// Scope: /shifts/ only. The page shell and its scripts are cached as they load; the page's data
// (/api/public/shifts/<token>) is fetched fresh when online and the last good copy is shown offline,
// marked with an X-From-Cache header so the page can say so. Nothing is ever sent from the cache:
// clocking in and other changes need a connection.
const CACHE = 'preciops-worker-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

const isData = (u) => /^\/api\/public\/shifts\/[\w-]+$/.test(u.pathname);
const isShell = (u, req) => req.mode === 'navigate' && u.pathname.startsWith('/shifts/');
const isAsset = (u) => u.pathname.startsWith('/_next/static/') || /^\/(icon-\d+|icon-maskable-\d+)\.png$/.test(u.pathname);

async function networkFirst(req, mark) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) await cache.put(req, res.clone());
    else if (res.status === 404 || res.status === 410) await cache.delete(req); // the link was revoked or expired
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (!hit) throw err;
    if (!mark) return hit;
    const h = new Headers(hit.headers); h.set('X-From-Cache', hit.headers.get('date') || '1');
    return new Response(await hit.blob(), { status: 200, headers: h });
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = new URL(req.url); if (u.origin !== self.location.origin) return;
  if (isData(u)) return e.respondWith(networkFirst(req, true));
  if (isShell(u, req)) return e.respondWith(networkFirst(req, false));
  if (isAsset(u)) return e.respondWith(caches.open(CACHE).then(async (c) => (await c.match(req)) || fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; })));
});
