const CACHE = 'etp-cache-v1';
const ASSETS = ['./', './index.html', './logo.png', './manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Kendi sitemiz: önce önbellek (çevrimdışı açılış), arka planda güncelle
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const network = fetch(e.request).then(res => {
          if (res && res.ok) { const clone = res.clone(); caches.open(CACHE).then(c => c.put(e.request, clone)); }
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Dış kaynaklar (GitHub verisi, fontlar): önce ağ, olmazsa önbellek (son veriler çevrimdışı görünür)
  e.respondWith(
    fetch(e.request).then(res => {
      if (res && res.ok) { const clone = res.clone(); caches.open(CACHE).then(c => c.put(e.request, clone)); }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
