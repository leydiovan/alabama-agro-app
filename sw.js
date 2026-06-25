/* Service Worker — Alabama Campo (PWA do tablet)
   - app shell (campo.html) em network-first: sempre pega a versão nova quando online,
     cai pro cache quando offline.
   - libs/ícone/manifest em cache-first.
   - chamadas ao Supabase (dados/auth) NÃO são cacheadas (vão sempre pela rede). */
const CACHE = 'alabama-campo-v1';
const SHELL = [
  'campo.html',
  'manifest.webmanifest',
  'icon.svg',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.allSettled(SHELL.map(u => c.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.hostname.endsWith('supabase.co')) return;   // dados/auth -> sempre rede

  const isShell = e.request.mode === 'navigate' || url.pathname.endsWith('campo.html');
  if (isShell) {
    // network-first: pega a versão nova quando online; offline cai no cache
    e.respondWith(
      fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => { try { c.put('campo.html', copy); } catch (_) {} });
        return res;
      }).catch(() => caches.match(e.request).then(h => h || caches.match('campo.html')))
    );
    return;
  }

  // demais (lib, ícone, manifest): cache-first
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => { try { c.put(e.request, copy); } catch (_) {} });
      return res;
    }).catch(() => undefined))
  );
});
