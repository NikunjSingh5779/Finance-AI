// FinanceAI session manager.
//
// The Supabase refresh token lives in an HttpOnly cookie that only the API can
// read, so JavaScript never sees it. This module keeps the short-lived access
// token in memory, restores it from the cookie on every page load, refreshes
// it before it expires, and keeps several tabs in step.
//
// It is an ES module so it can be unit-tested in Node
// (scripts/test-auth-session.mjs); in the browser it exposes one global,
// `window.FinanceAuth`, for the classic app.js script.

const REFRESH_LOCK_NAME = "financeai-auth-refresh";
const CHANNEL_NAME = "financeai-auth";
const LEGACY_SESSION_KEY = "financeai.auth.session";
// Non-secret marker that this browser had a session, so a failed restore can
// say "session expired" to returning users and stay quiet for new visitors.
const SIGN_IN_HINT_KEY = "financeai.auth.hint";

const DEFAULT_EXPIRES_IN_SECONDS = 900;
const REFRESH_AHEAD_MS = 60_000;
// A token another tab just obtained is reused instead of refreshing again,
// unless it is about to expire.
const ADOPT_MARGIN_MS = 5_000;
const OUTAGE_RETRY_MS = 15_000;
const COLD_START_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 10_000];
const COLD_START_MAX_WAIT_MS = 90_000;
// Statuses that mean "this credential is no longer valid". Everything else
// that is not a success (5xx, 429, 403 from a misrouted proxy, ...) is an
// outage, and an outage must never sign the user out.
const REJECTED_STATUSES = new Set([400, 401, 422]);

export class NetworkError extends Error {
  constructor(message = "FinanceAI could not be reached.", status = 0) {
    super(message);
    this.name = "NetworkError";
    this.status = status;
  }
}

function safeLocalStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch (_) {
    return null;
  }
}

export function createAuthSession(options = {}) {
  const {
    fetchFn = (...args) => globalThis.fetch(...args),
    storage = safeLocalStorage(),
    locks = globalThis.navigator?.locks,
    BroadcastChannelImpl = globalThis.BroadcastChannel,
    now = () => Date.now(),
    setTimer = (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimer = (id) => globalThis.clearTimeout(id),
  } = options;
  let apiBase = options.apiBase || "";

  let accessToken = null;
  let user = null;
  let expiresAt = 0;
  let refreshTimer = null;
  let inflight = null;
  const listeners = new Set();

  // ---- small helpers --------------------------------------------------------

  function storeGet(key) {
    try {
      return storage ? storage.getItem(key) : null;
    } catch (_) {
      return null;
    }
  }

  function storeSet(key, value) {
    try {
      storage?.setItem(key, value);
    } catch (_) {
      // Storage can be unavailable (private mode); the hint is optional.
    }
  }

  function storeRemove(key) {
    try {
      storage?.removeItem(key);
    } catch (_) {
      // See storeSet.
    }
  }

  function emit(event) {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (_) {
        // One broken listener must not stop the others.
      }
    }
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function configure(next = {}) {
    if (typeof next.apiBase === "string") apiBase = next.apiBase.replace(/\/+$/, "");
  }

  const channel = typeof BroadcastChannelImpl === "function"
    ? new BroadcastChannelImpl(CHANNEL_NAME)
    : null;

  function broadcast(message) {
    try {
      channel?.postMessage(message);
    } catch (_) {
      // Tabs still converge on their own refresh; syncing is an optimisation.
    }
  }

  function withRefreshLock(fn) {
    // Web Locks serialise refreshes across tabs and PWA windows. Without
    // them, the per-tab single-flight below still applies.
    if (locks && typeof locks.request === "function") {
      return locks.request(REFRESH_LOCK_NAME, () => fn());
    }
    return Promise.resolve().then(() => fn());
  }

  function currentSession() {
    return {
      user,
      access_token: accessToken,
      expires_in: Math.max(0, Math.round((expiresAt - now()) / 1000)),
    };
  }

  // ---- state ----------------------------------------------------------------

  function cancelTimer() {
    if (refreshTimer !== null) {
      clearTimer(refreshTimer);
      refreshTimer = null;
    }
  }

  function scheduleProactiveRefresh() {
    cancelTimer();
    if (!accessToken) return;
    const scheduledFor = accessToken;
    const lifetime = Math.max(0, expiresAt - now());
    // A minute early for normal tokens; at half-life for very short ones so
    // a 60 s token does not refresh in a tight loop.
    const delay = Math.max(lifetime - REFRESH_AHEAD_MS, lifetime * 0.5);
    refreshTimer = setTimer(() => runProactiveRefresh(scheduledFor), delay);
  }

  async function runProactiveRefresh(scheduledFor) {
    refreshTimer = null;
    try {
      // The result needs no handling: success reschedules itself, and a
      // rejection has already cleared the state and announced the expiry.
      await refreshSession({ staleToken: scheduledFor });
    } catch (error) {
      if (error instanceof NetworkError && accessToken === scheduledFor) {
        // Keep the user signed in through an outage and try again shortly.
        refreshTimer = setTimer(() => runProactiveRefresh(scheduledFor), OUTAGE_RETRY_MS);
      }
    }
  }

  function adopt(body, { announce = true } = {}) {
    const seconds = Number(body.expires_in);
    accessToken = body.access_token;
    user = body.user ?? user;
    expiresAt = now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_EXPIRES_IN_SECONDS) * 1000;
    storeSet(SIGN_IN_HINT_KEY, "1");
    scheduleProactiveRefresh();
    broadcast({ type: "session", access_token: accessToken, expires_at: expiresAt, user });
    if (announce) emit({ type: "session", source: "local" });
  }

  function forgetSession() {
    const hadSession = Boolean(accessToken || user);
    accessToken = null;
    user = null;
    expiresAt = 0;
    cancelTimer();
    storeRemove(SIGN_IN_HINT_KEY);
    return hadSession;
  }

  /** Store a session returned by login, signup, Google or e-mail verification. */
  function setSession(body) {
    if (!body || typeof body.access_token !== "string" || !body.access_token) {
      throw new TypeError("A session needs an access token.");
    }
    adopt(body);
    return currentSession();
  }

  /** Sign out of this browser: forget the token and tell the other tabs. */
  function clearSession() {
    forgetSession();
    broadcast({ type: "logout" });
    emit({ type: "signed-out", reason: "logout", source: "local" });
  }

  if (channel) {
    channel.onmessage = (event) => {
      const message = event?.data;
      if (!message || typeof message !== "object") return;
      if (message.type === "session") {
        if (typeof message.access_token !== "string" || !message.access_token) return;
        const messageExpiry = Number(message.expires_at);
        if (!Number.isFinite(messageExpiry)) return;
        if (!accessToken || messageExpiry > expiresAt) {
          accessToken = message.access_token;
          user = message.user ?? user;
          expiresAt = messageExpiry;
          scheduleProactiveRefresh();
          emit({ type: "session", source: "remote" });
        }
      } else if (message.type === "logout") {
        if (forgetSession()) emit({ type: "signed-out", reason: "logout", source: "remote" });
      }
    };
  }

  // ---- network --------------------------------------------------------------

  async function post(path, init, fetchImpl) {
    try {
      return await fetchImpl(apiBase + path, { method: "POST", credentials: "include", ...init });
    } catch (error) {
      throw new NetworkError(error instanceof Error ? error.message : "FinanceAI could not be reached.");
    }
  }

  async function readSession(response) {
    let body;
    try {
      body = await response.json();
    } catch (_) {
      throw new NetworkError("FinanceAI returned an unreadable response.", 502);
    }
    if (!body || typeof body.access_token !== "string" || !body.access_token) {
      throw new NetworkError("FinanceAI returned an incomplete session.", 502);
    }
    return body;
  }

  async function performRefresh({ staleToken, fetchImpl, announceExpiry }) {
    // Another tab may have refreshed while this call waited for the lock.
    if (accessToken && accessToken !== staleToken && expiresAt - now() > ADOPT_MARGIN_MS) {
      return currentSession();
    }

    const response = await post(
      "/auth/refresh",
      { headers: { Accept: "application/json" } },
      fetchImpl,
    );
    if (response.status === 401) {
      // The only answer that means "signed out". Other tabs find out when
      // their own refresh gets the same answer.
      forgetSession();
      if (announceExpiry) emit({ type: "signed-out", reason: "expired", source: "local" });
      return null;
    }
    if (!response.ok) {
      throw new NetworkError("FinanceAI is temporarily unavailable.", response.status);
    }
    adopt(await readSession(response));
    return currentSession();
  }

  /**
   * Obtain a fresh access token from the session cookie.
   *
   * Resolves to the session, or `null` only when the server says the session
   * is over (401). Throws NetworkError for everything else, so an outage or a
   * cold-starting server never looks like a logout.
   */
  function refreshSession({ staleToken = accessToken, fetchFn: fetchImpl = fetchFn, announceExpiry = true } = {}) {
    if (inflight) return inflight;
    const run = withRefreshLock(() => performRefresh({ staleToken, fetchImpl, announceExpiry }))
      .finally(() => {
        if (inflight === run) inflight = null;
      });
    inflight = run;
    return run;
  }

  /** Page-load restore: one refresh using the cookie, without announcing expiry. */
  function restoreSession(fetchImpl = fetchFn) {
    return refreshSession({ staleToken: null, fetchFn: fetchImpl, announceExpiry: false });
  }

  /**
   * One-time upgrade for browsers that still hold the old localStorage
   * session: trade its refresh token for the cookie, then delete it.
   *
   * The stored value is removed once the server has answered definitively. A
   * transient failure keeps it so a cold-starting server cannot cost the user
   * their session.
   */
  function migrateLegacySession(fetchImpl = fetchFn) {
    return withRefreshLock(async () => {
      const raw = storeGet(LEGACY_SESSION_KEY);
      if (!raw) return null;

      let refreshToken = "";
      try {
        const parsed = JSON.parse(raw);
        refreshToken = typeof parsed?.refresh_token === "string" ? parsed.refresh_token.trim() : "";
      } catch (_) {
        // Falls through: unusable values are discarded below.
      }
      if (refreshToken.length < 20) {
        storeRemove(LEGACY_SESSION_KEY);
        return null;
      }

      const response = await post(
        "/auth/refresh",
        {
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken }),
        },
        fetchImpl,
      );
      if (!response.ok && !REJECTED_STATUSES.has(response.status)) {
        throw new NetworkError("FinanceAI is temporarily unavailable.", response.status);
      }
      storeRemove(LEGACY_SESSION_KEY);
      if (!response.ok) return null;
      adopt(await readSession(response));
      return currentSession();
    });
  }

  /**
   * fetch() with the bearer token attached. A 401 triggers one shared
   * refresh and one retry; a second 401 is returned as-is, so there is no
   * refresh loop. A refresh that fails with an outage throws NetworkError.
   */
  async function fetchWithAuth(url, init = {}, { canRefresh = true } = {}) {
    const send = (token) => fetchFn(url, {
      ...init,
      headers: { ...(init.headers || {}), ...(token ? { Authorization: "Bearer " + token } : {}) },
    });

    const token = accessToken;
    const response = await send(token);
    if (response.status !== 401 || !canRefresh) return response;

    const session = await refreshSession({ staleToken: token });
    if (!session) return response;
    return send(session.access_token);
  }

  /**
   * Sign out of this browser for real. The refresh cookie is HttpOnly, so only
   * the server's Set-Cookie can delete it: the local state is cleared only
   * after the server confirms. Resolves false when it could not be reached,
   * because clearing memory alone would be undone by the next page load.
   */
  async function signOut(fetchImpl = fetchFn) {
    let response;
    try {
      response = await fetchImpl(apiBase + "/auth/logout", {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          ...(accessToken ? { Authorization: "Bearer " + accessToken } : {}),
        },
      });
    } catch (_) {
      return false;
    }
    if (!response.ok) return false;
    clearSession();
    return true;
  }

  /**
   * Run `fn` and, while it fails with NetworkError (server asleep, offline),
   * keep retrying with backoff for about 90 seconds. Other errors propagate.
   */
  async function withColdStartRetry(fn, {
    sleep = (ms) => new Promise((resolve) => setTimer(resolve, ms)),
    onWaiting,
    maxWaitMs = COLD_START_MAX_WAIT_MS,
  } = {}) {
    const startedAt = now();
    let attempt = 0;
    for (;;) {
      try {
        return await fn();
      } catch (error) {
        if (!(error instanceof NetworkError)) throw error;
        const delay = COLD_START_DELAYS_MS[Math.min(attempt, COLD_START_DELAYS_MS.length - 1)];
        if (now() - startedAt + delay > maxWaitMs) throw error;
        attempt += 1;
        if (onWaiting) onWaiting({ attempt, elapsedMs: now() - startedAt });
        await sleep(delay);
      }
    }
  }

  return {
    NetworkError,
    configure,
    subscribe,
    getAccessToken: () => accessToken,
    getUser: () => user,
    hasSignInHint: () => storeGet(SIGN_IN_HINT_KEY) === "1",
    setSession,
    clearSession,
    signOut,
    restoreSession,
    refreshSession,
    migrateLegacySession,
    withRefreshLock,
    fetchWithAuth,
    withColdStartRetry,
  };
}

if (typeof window !== "undefined") {
  window.FinanceAuth = createAuthSession();
}
