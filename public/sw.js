/* global URL */
// The production build replaces this marker with the exact public artifact list.
// An unbuilt worker must fail installation rather than promise offline support.
const PRECACHE = /*__MARKNOTE_PRECACHE__*/ null;
const CACHE_PREFIX = `marknote-shell-v2-${encodeURIComponent(self.registration.scope)}-`;
const CACHE_NAME = `${CACHE_PREFIX}${PRECACHE?.version || 'unbuilt'}`;
const scopeUrl = new URL(self.registration.scope);
const appShellUrl = new URL('index.html', scopeUrl).href;
const precacheUrls = new Map((PRECACHE?.entries || []).map((entry) => [new URL(entry.url, scopeUrl).href, entry]));

self.addEventListener('install', (event) => {
  event.waitUntil(installShell());
  // Updates remain waiting until the user saves their draft and confirms.
});

async function installShell() {
  if (!PRECACHE || PRECACHE.format !== 1 || !precacheUrls.has(appShellUrl)) {
    throw new Error('MarkNote offline artifact manifest is missing or incompatible.');
  }
  const cache = await caches.open(CACHE_NAME);
  try {
    await Promise.all([...precacheUrls].map(async ([url, entry]) => {
      const response = await fetch(url, { cache: 'reload', credentials: 'omit', redirect: 'error' });
      if (!response.ok || response.type === 'opaque') {
        throw new Error('MarkNote offline artifact could not be downloaded.');
      }
      const digest = await self.crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer());
      const actualHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
      if (actualHash !== entry.revision) {
        throw new Error('MarkNote offline artifact checksum did not match.');
      }
      await cache.put(url, response);
    }));
  } catch (error) {
    await caches.delete(CACHE_NAME);
    throw error;
  }
}

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const appWindows = windows.filter((client) => client.url.startsWith(self.registration.scope));
    // Other open tabs may still run the previous bundle. Keep its lazy chunks
    // until an activation with a single app tab can safely remove old caches.
    if (appWindows.length <= 1) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)));
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'MARKNOTE_OFFLINE_STATUS' && event.ports?.[0]) {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE_NAME);
      const entries = await Promise.all([...precacheUrls.keys()].map((url) => cache.match(url)));
      event.ports[0].postMessage({ type: 'MARKNOTE_OFFLINE_STATUS', ready: Boolean(PRECACHE && entries.length && entries.every(Boolean)), version: PRECACHE?.version || null });
    })());
    return;
  }
  if (event.data?.type === 'MARKNOTE_ACTIVATE_UPDATE' && event.source?.url?.startsWith(self.registration.scope)) {
    // Only the UI's explicit save-and-update action sends this message.
    event.waitUntil(self.skipWaiting());
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('authorization')) return;
  const url = new URL(request.url);
  if (url.origin !== scopeUrl.origin) return;

  if (request.mode === 'navigate' && (url.pathname === scopeUrl.pathname || url.href.split('?')[0] === appShellUrl)) {
    // Serve this worker's matching app shell, including on a cold offline start.
    // Navigation query strings (OAuth codes included) are never persisted.
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(appShellUrl)) || fetch(request);
    })());
    return;
  }

  if (url.search || !url.pathname.startsWith(scopeUrl.pathname)) return;
  if (precacheUrls.has(url.href)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(url.href)) || fetch(request);
    })());
    return;
  }

  // Older tabs can request a hashed lazy chunk from a preserved shell cache.
  // Never cache runtime responses, API calls, authentication, or note contents.
  if (url.pathname.startsWith(`${scopeUrl.pathname}assets/`) && ['script', 'style', 'font', 'image', 'worker', 'sharedworker'].includes(request.destination)) {
    event.respondWith((async () => {
      const keys = await caches.keys();
      for (const key of keys.filter((name) => name.startsWith(CACHE_PREFIX))) {
        const cached = await (await caches.open(key)).match(url.href);
        if (cached) return cached;
      }
      return fetch(request);
    })());
  }
});
