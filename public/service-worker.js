// Discount Discovery Zone - Service Worker v6.0
//   v6: wipe every cache left from the Vercel host, and never store HTML.
const CACHE_VERSION = 'ddz-v6.0-vercel-cutover';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `dynamic-${CACHE_VERSION}`;
const IMAGE_CACHE = `images-${CACHE_VERSION}`;
const API_CACHE = `api-${CACHE_VERSION}`;

// Core app shell files to pre-cache
const STATIC_ASSETS = [
  '/offline',
  '/icons/icon-192x192.png',
];

// Cache size limits
const DYNAMIC_CACHE_LIMIT = 50;
const IMAGE_CACHE_LIMIT = 100;
const API_CACHE_LIMIT = 30;

// Trim cache to limit
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    await cache.delete(keys[0]);
    return trimCache(cacheName, maxItems);
  }
}

// Install: pre-cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing v2.0...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Pre-caching app shell');
        return cache.addAll(STATIC_ASSETS).catch((err) => {
          console.warn('[SW] Some assets failed to cache:', err);
          // Don't fail install if some assets fail
          return Promise.resolve();
        });
      })
      .then(() => self.skipWaiting())
  );
});

// Activate: hard-wipe ALL caches (one-time favicon/branding reset)
// We deliberately delete every cache the SW knows about — not just the
// non-current ones — to guarantee that any previously cached multimey
// favicon/PWA icon is purged from every device on the next visit.
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating v6.0 (hard cache wipe)...');
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => {
        console.log('[SW] Deleting cache:', key);
        return caches.delete(key);
      }));
      // Notify every controlled tab so it can drop in-memory image refs
      // and reload to pick up the fresh icons.
      const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      clientsList.forEach((client) => {
        client.postMessage({ type: 'DDZ_CACHE_RESET', reason: 'vercel-cutover' });
      });
      await self.clients.claim();
    })()
  );
});

// Allow the page to ask us to wipe caches at any time.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'DDZ_CLEAR_ALL_CACHES') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
    );
  }
});

// Fetch: smart caching strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip chrome-extension, ws, and other non-http
  if (!url.protocol.startsWith('http')) return;

  // Skip API routes that modify data
  if (url.pathname.startsWith('/api/payment')) return;
  if (url.pathname.startsWith('/api/notifications')) return;

  // Skip admin routes
  if (url.pathname.startsWith('/admin')) return;

  // Strategy: Images - Cache First (long-lived)
  if (
    request.destination === 'image' ||
    url.pathname.match(/\.(png|jpg|jpeg|gif|webp|svg|ico)$/) ||
    url.hostname.includes('supabase.co') && url.pathname.includes('/storage/')
  ) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then((cache) => {
        return cache.match(request).then((cached) => {
          if (cached) return cached;
          return fetch(request).then((response) => {
            if (response.ok) {
              cache.put(request, response.clone());
              trimCache(IMAGE_CACHE, IMAGE_CACHE_LIMIT);
            }
            return response;
          }).catch(() => {
            // Return a placeholder for failed images
            return new Response(
              '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect fill="#f3f4f6" width="200" height="200"/><text fill="#9ca3af" font-family="sans-serif" font-size="14" text-anchor="middle" x="100" y="105">Image unavailable</text></svg>',
              { headers: { 'Content-Type': 'image/svg+xml' } }
            );
          });
        });
      })
    );
    return;
  }

  // Strategy: API routes - network-only.  Prices, stock, orders, and
  // auth tokens change constantly; stale responses here cause real bugs
  // (customers seeing an old cart, out-of-stock items, other people's
  // order tracking results, etc.).
  if (url.pathname.startsWith('/api/')) {
    return; // let the browser handle it directly, no SW caching
  }

  // Strategy: Static assets (JS, CSS, fonts) - Cache First
  if (
    url.pathname.startsWith('/_next/static') ||
    (url.pathname.match(/\.(js|css|woff|woff2|ttf|eot)$/) && url.pathname !== '/service-worker.js') ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com' ||
    url.hostname === 'cdn.jsdelivr.net'
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        return cached || fetch(request).then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, responseClone));
          }
          return response;
        }).catch(() => cached);
      })
    );
    return;
  }

  // Strategy: Pages — network-only with an offline fallback.
  // We deliberately DO NOT cache HTML responses because they embed the
  // current cart, session hints, and freshly-rendered product prices.
  // Serving a cached HTML can show yesterday's data to today's customer.
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request).catch(() => caches.match('/offline'))
    );
    return;
  }

  // Default: Network First
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(DYNAMIC_CACHE).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  console.log('[SW] Sync event:', event.tag);
});

// Push notifications
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.body || 'New update from Discount Discovery Zone',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/',
      dateOfArrival: Date.now(),
    },
    actions: [
      { action: 'open', title: 'Open' },
      { action: 'close', title: 'Dismiss' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(
      data.title || 'Discount Discovery Zone',
      options
    )
  );
});

// Notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'close') return;

  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        return clients.openWindow(url);
      })
  );
});

// Periodic background sync (for updates)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'update-content') {
    event.waitUntil(
      caches.open(STATIC_CACHE).then((cache) => {
        return cache.addAll(STATIC_ASSETS).catch(() => { });
      })
    );
  }
});
