// Same-origin API proxy for Cloudflare Pages.
//
// The frontend (Cloudflare Pages) and the API (Render) are different sites, so
// a cookie set by Render would be a third-party cookie that Safari/ITP and
// Chrome's third-party cookie blocking drop. Serving the API under the Pages
// origin makes the session cookie first-party.
//
// Only the prefixes below are forwarded. scripts/build-pages.mjs emits a
// matching _routes.json so static assets never invoke this function; keep the
// two lists in sync (scripts/test-auth-proxy.mjs checks that they are).
const API_ORIGIN = "https://finance-ai-u9bo.onrender.com";

const PROXIED_PREFIXES = [
  "/auth", "/api", "/transactions", "/budgets", "/accounts", "/goals",
  "/ai", "/summary", "/recurring", "/predict-expense", "/health",
];

function isProxied(pathname) {
  return PROXIED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/"),
  );
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // Anything else is a static asset (or a client route): leave it alone.
  if (!isProxied(url.pathname)) {
    return context.next();
  }

  const headers = new Headers(request.headers);
  headers.delete("host");
  // Never trust a client-supplied forwarding chain: the API rate-limits per
  // client address, so only the address Cloudflare itself saw is passed on.
  headers.delete("x-forwarded-for");
  const clientIp = request.headers.get("cf-connecting-ip");
  if (clientIp) {
    headers.set("x-forwarded-for", clientIp);
  }

  const init = { method: request.method, headers, redirect: "manual" };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  let upstream;
  try {
    upstream = await fetch(API_ORIGIN + url.pathname + url.search, init);
  } catch (_error) {
    return new Response(
      JSON.stringify({ detail: "The API is unreachable. Please retry shortly." }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }

  // Passing the headers through keeps every Set-Cookie; the body is streamed,
  // so AI server-sent events are not buffered.
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}
