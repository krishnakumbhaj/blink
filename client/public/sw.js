/**
 * Service worker.
 *
 * Hand-written rather than generated. A chat app is almost the worst case for
 * naive caching — `next-pwa` and friends will happily cache an API response or a
 * stale JS bundle and leave you debugging a ghost. The rules here are narrow and
 * deliberate:
 *
 *   - NEVER touch the API or the socket. Not cached, not intercepted, ever.
 *   - Hashed build assets are cache-first. Their URL changes when they change,
 *     so a cached copy can never be stale.
 *   - Page navigations are network-first, falling back to an offline page.
 *   - Everything else is left alone.
 *
 * Bump CACHE_VERSION to evict every old cache on the next activation.
 */
const CACHE_VERSION = 'v1';
const SHELL_CACHE = `blink-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `blink-assets-${CACHE_VERSION}`;

const OFFLINE_URL = '/offline.html';

// The bare minimum needed to show *something* with no network.
const PRECACHE = [OFFLINE_URL, '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      // Take over immediately rather than waiting for every tab to close. Safe
      // here because assets are content-hashed: a new worker cannot serve a page
      // the old bundles it needs.
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== ASSET_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

/** Anything we must never come between the app and the network for. */
function isOffLimits(url) {
  return (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/socket.io/') ||
    // Next's dev/HMR endpoints. Caching these turns hot reload into a séance.
    url.pathname.startsWith('/_next/webpack-hmr')
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only ever GET. A cached POST is a bug with a delayed fuse.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  /**
   * Cross-origin requests are left entirely alone — and that is most of what
   * matters here. The API, the WebSocket and every uploaded photo live on a
   * different origin, so this single check keeps the worker out of the way of
   * all of them.
   *
   * It also means we never cache someone's photos into a shared browser cache,
   * which for capability-URL images is a privacy answer as much as a technical one.
   */
  if (url.origin !== self.location.origin) return;

  if (isOffLimits(url)) return;

  // Build output is content-hashed: the URL changes whenever the bytes do, so a
  // cache hit is always correct and always fresh. Cache-first is free speed.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  // Page loads: always try the network, so a deploy is picked up immediately.
  // Only if that fails do we show the offline page.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
});

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);

  // Only cache a real success. Caching a 404 or an opaque redirect is how you
  // end up with an app that is permanently broken until the user clears storage.
  if (response.ok && response.status === 200) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }

  return response;
}

async function networkFirstNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    const offline = await caches.match(OFFLINE_URL);
    return offline ?? Response.error();
  }
}
