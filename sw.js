const CACHE = 'etp-cache-v21';
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
  './ayarlar.json',
  './ukey.json'
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

  // 1. JSON veri dosyaları: Stale-While-Revalidate (Mobilde 0ms anında açılış + arka planda tazeleme)
  if (url.origin === location.origin && url.pathname.endsWith('.json')) {
    if (url.search.includes('t=')) {
      // Manuel yenileme isteği (Verileri Yenile butonu): doğrudan ağdan çek
      e.respondWith(
        fetch(e.request).then(res => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(url.pathname, clone));
          }
          return res;
        }).catch(() => caches.match(url.pathname))
      );
      return;
    }
    e.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          const networkFetch = fetch(e.request).then(res => {
            if (res && res.ok) cache.put(e.request, res.clone());
            return res;
          }).catch(() => cached);
          return cached || networkFetch;
        })
      )
    );
    return;
  }

  // 2. HTML sayfaları: Network-first
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
