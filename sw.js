/* Service Worker — Alabama Campo (PWA do tablet, OFFLINE-FIRST)
   - shell (campo.html, index, libs, ícones): STALE-WHILE-REVALIDATE
     => abre INSTANTÂNEO do cache (não trava em rede ruim) e atualiza em 2º plano.
     (efeito: depois de publicar, a versão nova entra no PRÓXIMO open online)
   - Supabase (dados/auth): sempre rede, nunca cacheado. */
const CACHE = 'alabama-campo-v4';
const SHELL = [
  './',
  'index.html',
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

  // tudo o mais (shell + libs): stale-while-revalidate
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(e.request);
    const net = fetch(e.request).then(res => {
      if (res && res.ok) { try { cache.put(e.request, res.clone()); } catch (_) {} }
      return res;
    }).catch(() => null);
    if (cached) { e.waitUntil && e.waitUntil(net); return cached; }   // cache na hora, atualiza em 2º plano
    const res = await net;
    if (res) return res;
    if (e.request.mode === 'navigate') return (await cache.match('campo.html')) || (await cache.match('index.html')) || Response.error();
    return Response.error();
  })());
});
