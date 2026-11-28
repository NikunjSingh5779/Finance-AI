# Persistent 7-day authentication

Log in once and stay signed in for at most 7 days, across refreshes and browser
restarts. The refresh token is an HttpOnly cookie; the access token exists only
in memory.

## How it works

```
Browser ──same origin──▶ Cloudflare Pages ──Function proxy──▶ Render (FastAPI) ──▶ Supabase Auth
 memory: access token     functions/[[path]].js                 owns the cookie        issues tokens
 cookie: fa_rt (HttpOnly)
```

* **Supabase Auth stays the token issuer.** No new auth system.
* **FastAPI is the cookie broker.** Login, signup, Google exchange and e-mail
  verification return only `{user, access_token, expires_in}` and set the
  `fa_rt` cookie. `POST /auth/refresh` reads the cookie and returns a new access
  token.
* **The cookie is first-party** because the browser only talks to the Pages
  origin; `functions/[[path]].js` forwards API paths to Render. (A cookie set by
  `*.onrender.com` would be third-party and dropped by Safari/ITP and Chrome.)
* **Access token** lifetime 15 minutes (Supabase JWT expiry 900 s), refreshed
  automatically a minute before it expires.

### The `fa_rt` cookie

| Attribute | Value |
|---|---|
| Value | `v1.<base64url refresh token>.<issued_at>.<HMAC-SHA256>` signed with `SESSION_COOKIE_SECRET` |
| `HttpOnly` | yes |
| `Secure` | in production |
| `SameSite` | `Lax` |
| `Path` | `/auth` (never sent with ordinary API calls) |
| `Max-Age` | 604800 (7 days) |

**The 7-day cap does not slide.** `issued_at` is the original login time.
Refresh rotation re-issues the cookie with the *same* `issued_at`, so the
session ends 7 days after login no matter how often it is used. A tampered,
future-dated or older-than-7-days cookie is rejected with `401` and cleared.

### Endpoint behaviour

| Situation | Response | Cookie |
|---|---|---|
| Valid cookie | `200` new access token | re-issued, same `issued_at` |
| Missing / tampered / expired cookie | `401` | cleared |
| Supabase rejects the token (revoked, reused, expired) | `401` | cleared |
| Supabase rate limit | `429` | kept |
| Supabase or network failure, cold start | `503` | kept |
| Origin header missing or not on the allow-list | `403` | untouched |

Only a definitive rejection clears the cookie, so an outage never signs anyone
out. `/auth/refresh`, `/auth/logout` and `/auth/logout-all` require an allowed
`Origin` (the CSRF guard for the ambient cookie).

### Frontend (`app/static/auth-session.js`)

* On every page load the app shows a splash, restores the session with one
  `POST /auth/refresh` (`credentials: "include"`), then opens the app on the
  **same URL** (route and hash are untouched).
* `401` → login screen ("session expired"). Anything else (cold start, 5xx,
  429, offline) → the splash keeps waiting ("Waking the server…") with backoff
  for up to ~90 s, then offers **Try again**. It never shows the login form for
  an outage.
* Refreshes are single-flight: concurrent requests share one refresh, and
  `navigator.locks` plus a `BroadcastChannel("financeai-auth")` make tabs adopt
  one tab's new token instead of racing on the rotating refresh token. Logout in
  one tab signs out the others.
* A `401` from the API refreshes once and retries once, then shows login (no
  loop).
* Nothing session-related is written to `localStorage`/`sessionStorage`. The only
  key is `financeai.auth.hint` (`"1"`, not a secret), used to say "session
  expired" to returning users.
* **Migration:** a browser that still holds the old `financeai.auth.session`
  value trades its refresh token for the cookie once (via the legacy body path of
  `/auth/refresh`) and the old key is deleted. If the server is unreachable the
  key is kept and migration retries.

### Real client IP

The Dockerfile runs uvicorn with `--proxy-headers --forwarded-allow-ips='*'`, and
the Pages Function sets `X-Forwarded-For` from `CF-Connecting-IP` (dropping any
client-supplied value), so the per-IP rate limit on `/auth/*` is per user instead
of one bucket shared behind Render's proxy.

## Configuration

| Where | Setting | Value |
|---|---|---|
| Render | `SESSION_COOKIE_SECRET` | random, 32+ characters. **Required** in production: the app refuses to start without it |
| Render | existing vars (`CORS_ORIGINS`, Supabase, `DATABASE_URL`, ...) | unchanged |
| Supabase → Authentication → Sessions | JWT expiry | `900` seconds |
| Supabase → Authentication → Sessions | Refresh token rotation | on; reuse interval 10 s (default) |
| Supabase → Authentication → URL configuration | Redirect URLs | the Pages and Netlify origins |
| GitHub Actions | `FINANCEAI_PROXY=1` | already set in `.github/workflows/cloudflare-pages.yml` |

Generate the secret with
`python -c "import secrets; print(secrets.token_urlsafe(48))"`.

### Deploy order

Production startup now fails closed without `SESSION_COOKIE_SECRET`, so:

1. Set `SESSION_COOKIE_SECRET` on Render **first**.
2. Deploy the backend (Render) and the frontend (Pages) back to back. The two
   are not compatible across the change: the old frontend needs `refresh_token`
   in the login response and treats a response without it as an incomplete
   sign-up, and the new frontend needs the cookie endpoints. Logins fail in the
   gap between the two deploys, so do it at a quiet time. Pages deploys are
   fast; Render's cold build is the slow side, so start Render first.
3. Confirm the Pages project name used by the workflow (`finance-ai`) is the live
   project; the CORS regex references `finance-ai-61h.pages.dev`.

### Known limitation: Netlify

The Netlify build still calls Render directly, so there the cookie is a
third-party cookie and sessions will not survive a reload. Either retire the
Netlify frontend or accept that limitation; Cloudflare Pages is the supported
deployment for persistent sessions.

## Rollback

1. Redeploy the previous commit on Render and on Pages (the repo's `main` before
   this change). The old frontend keeps the session in `localStorage`, so users
   simply sign in again once.
2. `SESSION_COOKIE_SECRET` can stay set; the old backend ignores it.
3. Stale `fa_rt` cookies are harmless (`Path=/auth`, unused by the old code) and
   expire within 7 days.

## Security notes

* The 7-day cap is enforced by our signed `issued_at`, because Supabase session
  time-boxing is a paid feature. A stolen *refresh token* (not the cookie) can
  still be used directly against Supabase until it rotates; rotation plus short
  JWTs mitigate this.
* Rotating `SESSION_COOKIE_SECRET` invalidates every cookie (everyone signs in
  again).
* With `--forwarded-allow-ips='*'`, a caller that reaches the Render host
  directly can choose its own `X-Forwarded-For`, and so its own rate-limit
  bucket. Supabase enforces its own auth limits; through the Pages proxy the value
  is always Cloudflare's view of the client.

## Verification

Automated (run in CI): `pytest` (cookie helper, endpoints, CSRF, 7-day cap,
transient failures, client IP), `node scripts/test-auth-session.mjs` (session
manager), `node scripts/test-auth-proxy.mjs` (proxy and build).

The ten scenarios from the brief:

| # | Scenario | How it is covered | Status |
|---|---|---|---|
| 1 | Login → refresh | endpoint test + browser check with a mocked API | automated |
| 2 | Route refresh (same URL) | browser check: `#budgets` preserved | automated |
| 3 | Browser restart | cookie has `Max-Age`, not a session cookie | automated (attribute); **pending on the deployed site** |
| 4 | Access expiry | session-manager timer tests; real expiry needs JWT expiry 60 s | automated (timer); **pending on the deployed site** |
| 5 | Cookie expiry (> 7 days) | endpoint test: 8-day cookie → 401 + cleared | automated; **pending on the deployed site** |
| 6 | Logout → refresh | endpoint test: cookie cleared, `sign_out` called | automated; **pending on the deployed site** |
| 7 | Two tabs | session-manager tests (lock, broadcast adopt, logout broadcast) | automated; **pending on the deployed site** |
| 8 | Revoked session (`/auth/logout-all` then refresh) | endpoint test: provider rejection → 401 + cleared | automated; **pending on the deployed site** |
| 9 | Direct protected URL | boot flow restores the session before the route opens | **pending on the deployed site** |
| 10 | Offline / Render asleep | browser check: 503 → "Waking the server", no login form; unreachable → Try again | automated; **pending on the deployed site** |

"Pending on the deployed site" means it has **not** been run against the live
Pages + Render + Supabase stack yet; record each result here after deploying.
