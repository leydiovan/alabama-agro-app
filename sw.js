/* Service Worker — Alabama Campo (PWA do tablet)
   - app shell (campo.html) em network-first: sempre pega a versão nova quando online,
     cai pro cache quando offline.
   - libs/ícone/manifest em cache-first.
   - chamadas ao Supabase (dados/auth) NÃO são cacheadas (vão sempre pela rede). */
const CACHE = 'alabama-campo-v3';
const SHELL = [
  'campo.html',
  'manifest.webmanifest',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
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

  // lib estável do CDN: cache-first (raramente muda)
  if (url.hostname.endsWith('jsdelivr.net')) {
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => { try { c.put(e.request, copy); } catch (_) {} });
        return res;
      }))
    );
    return;
  }

  // campo.html, manifest, ícones: NETWORK-FIRST (sempre a versão nova online;
  // offline cai no cache; navegação sem cache cai no shell). Nunca "prende" o manifest.
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => { try { c.put(e.request, copy); } catch (_) {} });
      return res;
    }).catch(() => caches.match(e.request).then(h => h || (e.request.mode === 'navigate' ? caches.match('campo.html') : undefined)))
  );
});
