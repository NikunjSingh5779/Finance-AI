/* FinanceAI PWA service worker.
 * Only the public application shell and versioned static assets are cached.
 * Auth, API responses and personal financial data are deliberately excluded.
 */
const CACHE_PREFIX = "financeai-shell-";
const CACHE_NAME = CACHE_PREFIX + "v1";
const SHELL_URLS = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/pwa.css",
  "/pwa.js",
  "/style.css",
  "/insights.css",
  "/app.js",
  "/favicon.svg",
  "/icons/icon.svg",
  "/icons/icon-maskable.svg"
];
const STATIC_PATHS = new Set(SHELL_URLS);

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(SHELL_URLS.map(async path => {
      try {
        const response = await fetch(path, {cache: "reload"});
        if (response.ok && response.type === "basic") {
          await cache.put(path, response);
        }
      } catch (_) {
        // A missing optional asset must not prevent installation.
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
  if (url.origin !== self.location.origin) return;

  // Never cache or intercept auth, finance API, or other dynamic endpoints.
  if (
    url.pathname.startsWith("/auth/") ||
    url.pathname.startsWith("/api/") ||
    /^\/(transactions|budgets|accounts|goals|summary|ai|health)(\/|$)/.test(url.pathname)
  ) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch (_) {
        return (await caches.match("/")) ||
          (await caches.match("/offline.html")) ||
          new Response("You're offline. Reconnect to use FinanceAI.", {
            status: 503,
            headers: {"Content-Type": "text/plain; charset=utf-8"}
          });
      }
    })());
    return;
  }

  // Stale-while-revalidate only for the explicit static shell allowlist.
  if (!STATIC_PATHS.has(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    const network = fetch(request).then(response => {
      if (response.ok && response.type === "basic") {
        cache.put(request, response.clone());
      }
      return response;
    }).catch(() => null);
    return cached || await network || new Response("", {status: 504});
  })());
});
