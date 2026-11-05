/* FinanceAI PWA service worker.
 * Cache only the public application shell and allowlisted static assets.
 * Authentication, financial API responses and personal data are never cached.
 */
const CACHE_PREFIX = "financeai-shell-";
const CACHE_NAME = CACHE_PREFIX + "v6";
const SHELL_URLS = [
  "/",
  "/static/offline.html",
  "/static/manifest.webmanifest",
  "/static/pwa.css",
  "/static/pwa.js",
  "/static/style.css",
  "/static/insights.css",
  "/static/app.js",
  "/static/favicon.svg",
  "/static/icons/icon.svg",
  "/static/icons/icon-maskable.svg",
  "/static/icons/icon-192.png",
  "/static/icons/icon-512.png",
  "/static/icons/apple-touch-icon.png"
];
const STATIC_PATHS = new Set(SHELL_URLS.filter(path => path !== "/"));

const NEVER_CACHE_PREFIXES = [
  "/auth", "/api", "/transactions", "/budgets", "/accounts", "/goals",
  "/summary", "/ai", "/health", "/market", "/analysis", "/insights",
  "/net-worth", "/reports"
];

function isNeverCachePath(pathname) {
  return NEVER_CACHE_PREFIXES.some(prefix =>
    pathname === prefix || pathname.startsWith(prefix + "/")
  );
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(SHELL_URLS.map(async path => {
      try {
        const response = await fetch(path, {cache: "reload"});
        if (response.ok && response.type === "basic") {
          await cache.put(path, response.clone());
        }
      } catch (_) {
        // A missing optional asset must not prevent the app from installing.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isNeverCachePath(url.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch (_) {
        return (await caches.match("/")) ||
          (await caches.match("/static/offline.html")) ||
          new Response("You're offline. Reconnect to use FinanceAI.", {
            status: 503,
            headers: {"Content-Type": "text/plain; charset=utf-8"}
          });
      }
    })());
    return;
  }

  // Match versioned CSS/JS URLs against the same explicitly allowed asset.
  if (!STATIC_PATHS.has(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cacheKey = url.pathname;
    const cached = await cache.match(cacheKey);
    try {
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        await cache.put(cacheKey, response.clone());
      }
      return response;
    } catch (_) {
      return cached || new Response("", {status: 504});
    }
  })());
});
