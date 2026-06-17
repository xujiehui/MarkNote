self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('marknote-v2').then((cache) => cache.addAll(['./', './index.html', './manifest.webmanifest', './marknote.svg'])),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).catch(() => caches.match('./index.html'))),
  );
});
