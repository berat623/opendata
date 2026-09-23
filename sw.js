const CACHE = 'etp-cache-v15';
const ASSETS = [
  './',
  './index.html',
  './admin.html',
  './ogrenci.html',
  './logo.png',
  './manifest.webmanifest',
  './duyurular.json',
  './dosyalar.json',
  './dersprogrami.json',
  './takvim.json',
  './ayarlar.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // 1. JSON veri dosyaları: Network-first, hata durumunda cache (daima taze veri)
  if (url.origin === location.origin && url.pathname.endsWith('.json')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' }).then(res => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // 2. HTML sayfaları: Network-first (anında taze sürüm)
  if (url.origin === location.origin && (url.pathname.endsWith('.html') || url.pathname.endsWith('/') || url.pathname === '')) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // 3. Statik varlıklar (resimler, fontlar vb.): Cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.ok && e.request.url.startsWith('http')) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
