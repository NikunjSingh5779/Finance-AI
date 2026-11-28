// Tests for the in-memory session manager (app/static/auth-session.js).
//
//   node scripts/test-auth-session.mjs
import assert from "node:assert/strict";
import { createAuthSession, NetworkError } from "../app/static/auth-session.js";

const LEGACY_KEY = "financeai.auth.session";
const HINT_KEY = "financeai.auth.hint";
const LEGACY_REFRESH = "legacy-refresh-token-0123456789";
const USER = { id: "11111111-1111-1111-1111-111111111111", email: "a@b.co" };

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log("ok   - " + name);
  } catch (error) {
    console.error("FAIL - " + name);
    console.error(error);
    process.exitCode = 1;
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

// ---- fakes ------------------------------------------------------------------

function makeWorld() {
  const world = {
    time: 1_000_000,
    timers: [],
    nextTimerId: 1,
    channels: [],
    lockChains: new Map(),
    store: new Map(),
  };
  world.storage = {
    getItem: (key) => (world.store.has(key) ? world.store.get(key) : null),
    setItem: (key, value) => { world.store.set(key, String(value)); },
    removeItem: (key) => { world.store.delete(key); },
  };
  world.locks = {
    request(name, callback) {
      const previous = world.lockChains.get(name) || Promise.resolve();
      const run = previous.then(() => callback());
      world.lockChains.set(name, run.catch(() => {}));
      return run;
    },
  };
  world.now = () => world.time;
  world.setTimer = (fn, ms) => {
    const id = world.nextTimerId++;
    world.timers.push({ id, fn, at: world.time + ms });
    return id;
  };
  world.clearTimer = (id) => {
    world.timers = world.timers.filter((timer) => timer.id !== id);
  };
  world.advance = async (ms) => {
    const target = world.time + ms;
    for (;;) {
      const due = world.timers
        .filter((timer) => timer.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      world.timers = world.timers.filter((timer) => timer.id !== due.id);
      world.time = Math.max(world.time, due.at);
      due.fn();
      await flush();
    }
    world.time = target;
  };
  world.BroadcastChannel = class FakeBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
      world.channels.push(this);
    }
    postMessage(data) {
      for (const other of world.channels) {
        if (other !== this && other.name === this.name) {
          const copy = structuredClone(data);
          // Best-case ordering: the message lands before the lock is released.
          // (If it arrives later, the second tab simply performs a sequential,
          // safe refresh with the already-rotated cookie.)
          queueMicrotask(() => other.onmessage?.({ data: copy }));
        }
      }
    }
    close() {
      world.channels = world.channels.filter((channel) => channel !== this);
    }
  };
  return world;
}

function reply(status, body = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function sessionBody(token = "access-1", expiresIn = 900) {
  return { user: USER, access_token: token, expires_in: expiresIn };
}

/** A tab = one auth manager with its own scripted fetch. */
function makeTab(world, script = []) {
  const tab = { calls: [], events: [], script: [...script] };
  tab.fetchFn = async (url, init = {}) => {
    tab.calls.push({ url, init });
    const next = tab.script.shift();
    if (next === undefined) throw new Error("unexpected fetch to " + url);
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(url, init) : next;
  };
  tab.auth = createAuthSession({
    apiBase: "https://api.example",
    fetchFn: (...args) => tab.fetchFn(...args),
    storage: world.storage,
    locks: world.locks,
    BroadcastChannelImpl: world.BroadcastChannel,
    now: world.now,
    setTimer: world.setTimer,
    clearTimer: world.clearTimer,
  });
  tab.auth.subscribe((event) => tab.events.push(event));
  return tab;
}

function assertNoTokensPersisted(world) {
  for (const [key, value] of world.store) {
    assert.ok(
      key === HINT_KEY || key === LEGACY_KEY,
      "unexpected storage key " + key,
    );
    assert.ok(!/access-\d|"refresh_token":"[^"]{20,}"/.test(value) || key === LEGACY_KEY);
  }
}

// ---- restoreSession ---------------------------------------------------------

await test("restoreSession posts once to /auth/refresh with credentials and keeps the token in memory only", async () => {
  const world = makeWorld();
  const tab = makeTab(world, [reply(200, sessionBody("access-1"))]);

  const session = await tab.auth.restoreSession();

  assert.equal(tab.calls.length, 1);
  assert.equal(tab.calls[0].url, "https://api.example/auth/refresh");
  assert.equal(tab.calls[0].init.method, "POST");
  assert.equal(tab.calls[0].init.credentials, "include");
  assert.equal(session.access_token, "access-1");
  assert.deepEqual(session.user, USER);
  assert.equal(tab.auth.getAccessToken(), "access-1");
  assert.deepEqual(tab.auth.getUser(), USER);
  assert.equal([...world.store.keys()].some((key) => key !== HINT_KEY), false);
  assert.equal(world.storage.getItem(HINT_KEY), "1");
});

await test("a 401 means signed out: restoreSession returns null and clears state", async () => {
  const world = makeWorld();
  const tab = makeTab(world, [reply(200, sessionBody("access-1")), reply(401, { detail: "expired" })]);
  await tab.auth.restoreSession();

  const result = await tab.auth.refreshSession({ staleToken: "access-1" });

  assert.equal(result, null);
  assert.equal(tab.auth.getAccessToken(), null);
  assert.equal(world.storage.getItem(HINT_KEY), null);
});

for (const [label, outcome] of [
  ["500", reply(500)],
  ["502", reply(502)],
  ["503", reply(503)],
  ["429", reply(429)],
  ["403 (origin refused)", reply(403)],
  ["404 (proxy not deployed)", reply(404)],
  ["network failure", new TypeError("Failed to fetch")],
  ["a body that is not a session", reply(200, { nothing: true })],
]) {
  await test(`${label} throws NetworkError and never signs the user out`, async () => {
    const world = makeWorld();
    const tab = makeTab(world, [reply(200, sessionBody("access-1")), outcome]);
    await tab.auth.restoreSession();

    await assert.rejects(
      () => tab.auth.refreshSession({ staleToken: "access-1" }),
      (error) => error instanceof NetworkError,
    );

    assert.equal(tab.auth.getAccessToken(), "access-1", "token must be kept");
    assert.equal(world.storage.getItem(HINT_KEY), "1");
    assert.equal(tab.events.some((event) => event.type === "signed-out"), false);
  });
}

await test("two concurrent restoreSession calls issue one fetch", async () => {
  const world = makeWorld();
  const tab = makeTab(world, [reply(200, sessionBody("access-1"))]);

  const [first, second] = await Promise.all([tab.auth.restoreSession(), tab.auth.restoreSession()]);

  assert.equal(tab.calls.length, 1);
  assert.equal(first.access_token, "access-1");
  assert.equal(second.access_token, "access-1");
});

await test("a custom fetch function can be passed to restoreSession", async () => {
  const world = makeWorld();
  const tab = makeTab(world, []);
  const seen = [];

  const session = await tab.auth.restoreSession(async (url) => {
    seen.push(url);
    return reply(200, sessionBody("access-9"));
  });

  assert.deepEqual(seen, ["https://api.example/auth/refresh"]);
  assert.equal(session.access_token, "access-9");
});

// ---- tabs -------------------------------------------------------------------

await test("a second tab adopts the first tab's broadcast instead of refreshing again", async () => {
  const world = makeWorld();
  const tabA = makeTab(world, [reply(200, sessionBody("access-A"))]);
  const tabB = makeTab(world, []); // any fetch from B would throw

  await tabA.auth.restoreSession();
  await flush();

  assert.equal(tabB.auth.getAccessToken(), "access-A");
  assert.deepEqual(tabB.events.map((event) => [event.type, event.source]), [["session", "remote"]]);
  const adopted = await tabB.auth.refreshSession({ staleToken: null });
  assert.equal(adopted.access_token, "access-A");
  assert.equal(tabB.calls.length, 0);
});

await test("refresh calls queued behind the lock reuse the winner's result", async () => {
  const world = makeWorld();
  const tabA = makeTab(world, [reply(200, sessionBody("access-A"))]);
  const tabB = makeTab(world, []);

  const [a, b] = await Promise.all([tabA.auth.restoreSession(), tabB.auth.restoreSession()]);
  await flush();

  assert.equal(a.access_token, "access-A");
  assert.equal(b.access_token, "access-A");
  assert.equal(tabA.calls.length + tabB.calls.length, 1, "exactly one network refresh");
});

await test("a logout broadcast signs the other tab out", async () => {
  const world = makeWorld();
  const tabA = makeTab(world, [reply(200, sessionBody("access-A"))]);
  const tabB = makeTab(world, []);
  await tabA.auth.restoreSession();
  await flush();

  tabA.auth.clearSession();
  await flush();

  assert.equal(tabB.auth.getAccessToken(), null);
  const signedOut = tabB.events.find((event) => event.type === "signed-out");
  assert.deepEqual([signedOut.reason, signedOut.source], ["logout", "remote"]);
  assert.equal(world.storage.getItem(HINT_KEY), null);
});

await test("a stale session broadcast does not overwrite a newer token", async () => {
  const world = makeWorld();
  const tabA = makeTab(world, [reply(200, sessionBody("access-new", 900))]);
  const tabB = makeTab(world, []);
  await tabA.auth.restoreSession();
  await flush();

  // Deliver an older session (expires earlier than the one tab B holds) to tab B.
  const tabBChannel = world.channels[1];
  tabBChannel.onmessage({
    data: { type: "session", access_token: "access-old", expires_at: world.now() - 5000, user: USER },
  });
  await flush();

  assert.equal(tabB.auth.getAccessToken(), "access-new");
});

// ---- legacy migration -------------------------------------------------------

function seedLegacy(world, refreshToken = LEGACY_REFRESH) {
  world.storage.setItem(
    LEGACY_KEY,
    JSON.stringify({ access_token: "old-access", refresh_token: refreshToken, user: USER }),
  );
}

await test("a legacy localStorage session is migrated once, then removed", async () => {
  const world = makeWorld();
  seedLegacy(world);
  const tab = makeTab(world, [reply(200, sessionBody("access-M"))]);

  const migrated = await tab.auth.migrateLegacySession();
  const again = await tab.auth.migrateLegacySession();

  assert.equal(migrated.access_token, "access-M");
  assert.equal(again, null);
  assert.equal(tab.calls.length, 1);
  assert.equal(tab.calls[0].url, "https://api.example/auth/refresh");
  assert.equal(tab.calls[0].init.credentials, "include");
  assert.deepEqual(JSON.parse(tab.calls[0].init.body), { refresh_token: LEGACY_REFRESH });
  assert.equal(world.storage.getItem(LEGACY_KEY), null);
  assert.equal(tab.auth.getAccessToken(), "access-M");
  assertNoTokensPersisted(world);
});

await test("a legacy session the server rejects is removed and yields null", async () => {
  const world = makeWorld();
  seedLegacy(world);
  const tab = makeTab(world, [reply(401, { detail: "Refresh token expired" })]);

  const migrated = await tab.auth.migrateLegacySession();

  assert.equal(migrated, null);
  assert.equal(world.storage.getItem(LEGACY_KEY), null);
});

await test("a transient failure keeps the legacy session so migration can be retried", async () => {
  const world = makeWorld();
  seedLegacy(world);
  const tab = makeTab(world, [new TypeError("Failed to fetch"), reply(503), reply(200, sessionBody("access-M"))]);

  await assert.rejects(() => tab.auth.migrateLegacySession(), (e) => e instanceof NetworkError);
  assert.notEqual(world.storage.getItem(LEGACY_KEY), null);
  await assert.rejects(() => tab.auth.migrateLegacySession(), (e) => e instanceof NetworkError);
  assert.notEqual(world.storage.getItem(LEGACY_KEY), null);

  const migrated = await tab.auth.migrateLegacySession();
  assert.equal(migrated.access_token, "access-M");
  assert.equal(world.storage.getItem(LEGACY_KEY), null);
});

await test("a malformed legacy value is discarded without any request", async () => {
  const world = makeWorld();
  world.storage.setItem(LEGACY_KEY, "{not json");
  const tab = makeTab(world, []);

  assert.equal(await tab.auth.migrateLegacySession(), null);
  assert.equal(tab.calls.length, 0);
  assert.equal(world.storage.getItem(LEGACY_KEY), null);
});

await test("two tabs migrating at once spend the legacy token only once", async () => {
  const world = makeWorld();
  seedLegacy(world);
  const tabA = makeTab(world, [reply(200, sessionBody("access-M"))]);
  const tabB = makeTab(world, []);

  const [a, b] = await Promise.all([tabA.auth.migrateLegacySession(), tabB.auth.migrateLegacySession()]);

  assert.equal(tabA.calls.length + tabB.calls.length, 1);
  assert.equal([a, b].filter(Boolean).length, 1);
});

await test("no legacy value means no request", async () => {
  const world = makeWorld();
  const tab = makeTab(world, []);

  assert.equal(await tab.auth.migrateLegacySession(), null);
  assert.equal(tab.calls.length, 0);
});

// ---- fetchWithAuth ----------------------------------------------------------

await test("fetchWithAuth sends the bearer token and returns a normal response untouched", async () => {
  const world = makeWorld();
  const tab = makeTab(world, [reply(200, sessionBody("access-1")), reply(200, { ok: 1 })]);
  await tab.auth.restoreSession();

  const response = await tab.auth.fetchWithAuth("https://api.example/goals", { headers: { Accept: "application/json" } });

  assert.equal(response.status, 200);
  assert.equal(tab.calls[1].init.headers.Authorization, "Bearer access-1");
  assert.equal(tab.calls[1].init.headers.Accept, "application/json");
  assert.equal(tab.calls.length, 2);
});

await test("a 401 refreshes once and retries once with the new token", async () => {
  const world = makeWorld();
  const tab = makeTab(world, [
    reply(200, sessionBody("access-1")),
    reply(401),
    reply(200, sessionBody("access-2")),
    reply(200, { ok: 1 }),
  ]);
  await tab.auth.restoreSession();

  const response = await tab.auth.fetchWithAuth("https://api.example/goals");

  assert.equal(response.status, 200);
  assert.deepEqual(
    tab.calls.map((call) => call.url),
    [
      "https://api.example/auth/refresh",
      "https://api.example/goals",
      "https://api.example/auth/refresh",
      "https://api.example/goals",
    ],
  );
  assert.equal(tab.calls[3].init.headers.Authorization, "Bearer access-2");
});

await test("a second 401 after a successful refresh is returned, not retried again", async () => {
  const world = makeWorld();
  const tab = makeTab(world, [
    reply(200, sessionBody("access-1")),
    reply(401),
    reply(200, sessionBody("access-2")),
    reply(401),
  ]);
  await tab.auth.restoreSession();

  const response = await tab.auth.fetchWithAuth("https://api.example/goals");

  assert.equal(response.status, 401);
  assert.equal(tab.calls.length, 4, "no third request and no second refresh");
});

await test("a 401 whose refresh is also rejected signs out and returns the 401", async () => {
  const world = makeWorld();
  const tab = makeTab(world, [reply(200, sessionBody("access-1")), reply(401), reply(401)]);
  await tab.auth.restoreSession();

  const response = await tab.auth.fetchWithAuth("https://api.example/goals");

  assert.equal(response.status, 401);
  assert.equal(tab.calls.length, 3);
  assert.equal(tab.auth.getAccessToken(), null);
  const signedOut = tab.events.find((event) => event.type === "signed-out");
  assert.deepEqual([signedOut.reason, signedOut.source], ["expired", "local"]);
});

await test("a 401 during an outage surfaces NetworkError instead of signing out", async () => {
  const world = makeWorld();
  const tab = makeTab(world, [reply(200, sessionBody("access-1")), reply(401), reply(503)]);
  await tab.auth.restoreSession();

  await assert.rejects(
    () => tab.auth.fetchWithAuth("https://api.example/goals"),
    (error) => error instanceof NetworkError,
  );
  assert.equal(tab.auth.getAccessToken(), "access-1");
  assert.equal(tab.events.some((event) => event.type === "signed-out"), false);
});

await test("canRefresh:false returns the 401 without refreshing", async () => {
  const world = makeWorld();
  const tab = makeTab(world, [reply(200, sessionBody("access-1")), reply(401)]);
  await tab.auth.restoreSession();

  const response = await tab.auth.fetchWithAuth("https://api.example/auth/password/update", {}, { canRefresh: false });

  assert.equal(response.status, 401);
  assert.equal(tab.calls.length, 2);
});

await test("concurrent 401s share one refresh (single-flight)", async () => {
  const world = makeWorld();
  const tab = makeTab(world, [
    reply(200, sessionBody("access-1")),
    reply(401),
    reply(401),
    reply(200, sessionBody("access-2")),
    reply(200, { a: 1 }),
    reply(200, { b: 1 }),
  ]);
  await tab.auth.restoreSession();

  const [first, second] = await Promise.all([
    tab.auth.fetchWithAuth("https://api.example/a"),
    tab.auth.fetchWithAuth("https://api.example/b"),
  ]);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(tab.calls.filter((call) => call.url.endsWith("/auth/refresh")).length, 2, "restore + one shared refresh");
});

// ---- proactive refresh ------------------------------------------------------

await test("the access token is refreshed proactively a minute before it expires", async () => {
  const world = makeWorld();
  const tab = makeTab(world, [reply(200, sessionBody("access-1", 900)), reply(200, sessionBody("access-2", 900))]);
  await tab.auth.restoreSession();

  await world.advance(839_000);
  assert.equal(tab.calls.length, 1, "not yet");
  await world.advance(2_000);

  assert.equal(tab.calls.length, 2);
  assert.equal(tab.auth.getAccessToken(), "access-2");
});

await test("short-lived tokens are refreshed at half their life, not in a tight loop", async () => {
  const world = makeWorld();
  const tab = makeTab(world, [reply(200, sessionBody("access-1", 60)), reply(200, sessionBody("access-2", 60))]);
  await tab.auth.restoreSession();

  await world.advance(29_000);
  assert.equal(tab.calls.length, 1);
  await world.advance(2_000);

  assert.equal(tab.calls.length, 2);
});

await test("a proactive refresh that hits an outage retries later and keeps the user signed in", async () => {
  const world = makeWorld();
  const tab = makeTab(world, [
    reply(200, sessionBody("access-1", 900)),
    reply(503),
    reply(200, sessionBody("access-2", 900)),
  ]);
  await tab.auth.restoreSession();

  await world.advance(841_000);
  assert.equal(tab.auth.getAccessToken(), "access-1");
  assert.equal(tab.events.some((event) => event.type === "signed-out"), false);
  await world.advance(16_000);

  assert.equal(tab.auth.getAccessToken(), "access-2");
});

await test("a proactive refresh that is rejected signs the user out as expired", async () => {
  const world = makeWorld();
  const tab = makeTab(world, [reply(200, sessionBody("access-1", 900)), reply(401)]);
  await tab.auth.restoreSession();

  await world.advance(841_000);

  assert.equal(tab.auth.getAccessToken(), null);
  const signedOut = tab.events.find((event) => event.type === "signed-out");
  assert.deepEqual([signedOut.reason, signedOut.source], ["expired", "local"]);
});

await test("a tab that adopted another tab's token does not refresh on its own old timer", async () => {
  const world = makeWorld();
  const tabA = makeTab(world, [reply(200, sessionBody("access-A", 900)), reply(200, sessionBody("access-A2", 900))]);
  const tabB = makeTab(world, []);
  await tabA.auth.restoreSession();
  await flush();

  await world.advance(841_000);

  assert.equal(tabA.calls.length, 2, "tab A refreshed");
  assert.equal(tabB.calls.length, 0, "tab B adopted the new token instead");
  assert.equal(tabB.auth.getAccessToken(), "access-A2");
});

// ---- setSession / clearSession ---------------------------------------------

await test("setSession after login keeps the token in memory, schedules a refresh and tells other tabs", async () => {
  const world = makeWorld();
  const tabA = makeTab(world, [reply(200, sessionBody("access-L2", 900))]);
  const tabB = makeTab(world, []);

  tabA.auth.setSession(sessionBody("access-L", 900));
  await flush();

  assert.equal(tabA.auth.getAccessToken(), "access-L");
  assert.equal(tabB.auth.getAccessToken(), "access-L");
  assert.equal(world.storage.getItem(HINT_KEY), "1");
  assertNoTokensPersisted(world);
  await world.advance(841_000);
  assert.equal(tabA.auth.getAccessToken(), "access-L2");
});

await test("clearSession wipes memory, the hint and cancels the refresh timer", async () => {
  const world = makeWorld();
  const tab = makeTab(world, [reply(200, sessionBody("access-1", 900))]);
  await tab.auth.restoreSession();

  tab.auth.clearSession();
  await world.advance(900_000);

  assert.equal(tab.auth.getAccessToken(), null);
  assert.equal(tab.auth.getUser(), null);
  assert.equal(world.storage.getItem(HINT_KEY), null);
  assert.equal(tab.calls.length, 1, "timer must not fire after sign-out");
});

// ---- signOut ----------------------------------------------------------------

await test("signOut posts /auth/logout with credentials and the bearer token, then clears everything", async () => {
  const world = makeWorld();
  const tabA = makeTab(world, [reply(200, sessionBody("access-1")), reply(200, { success: true })]);
  const tabB = makeTab(world, []);
  await tabA.auth.restoreSession();
  await flush();

  const done = await tabA.auth.signOut();
  await flush();

  assert.equal(done, true);
  assert.equal(tabA.calls[1].url, "https://api.example/auth/logout");
  assert.equal(tabA.calls[1].init.method, "POST");
  assert.equal(tabA.calls[1].init.credentials, "include");
  assert.equal(tabA.calls[1].init.headers.Authorization, "Bearer access-1");
  assert.equal(tabA.auth.getAccessToken(), null);
  assert.equal(world.storage.getItem(HINT_KEY), null);
  assert.equal(tabB.auth.getAccessToken(), null, "other tabs are signed out too");
});

for (const [label, outcome] of [
  ["a 503", reply(503)],
  ["a 403 (origin refused)", reply(403)],
  ["a network failure", new TypeError("Failed to fetch")],
]) {
  await test(`signOut reports failure and keeps the session when the server gives ${label}`, async () => {
    const world = makeWorld();
    const tab = makeTab(world, [reply(200, sessionBody("access-1")), outcome]);
    await tab.auth.restoreSession();

    const done = await tab.auth.signOut();

    assert.equal(done, false, "the HttpOnly cookie is still alive, so this is not a logout");
    assert.equal(tab.auth.getAccessToken(), "access-1");
    assert.equal(tab.events.some((event) => event.type === "signed-out"), false);
  });
}

await test("signOut works without an access token (cookie-only session)", async () => {
  const world = makeWorld();
  const tab = makeTab(world, [reply(200, { success: true })]);

  const done = await tab.auth.signOut();

  assert.equal(done, true);
  assert.equal("Authorization" in tab.calls[0].init.headers, false);
});

// ---- cold-start retry -------------------------------------------------------

function sleeper(world) {
  const slept = [];
  return {
    slept,
    sleep: async (ms) => { slept.push(ms); world.time += ms; },
  };
}

await test("withColdStartRetry keeps trying through NetworkErrors and then succeeds", async () => {
  const world = makeWorld();
  const { sleep, slept } = sleeper(world);
  const tab = makeTab(world, []);
  let attempts = 0;
  const waiting = [];

  const result = await tab.auth.withColdStartRetry(
    async () => {
      attempts += 1;
      if (attempts < 4) throw new NetworkError("asleep");
      return "ready";
    },
    { sleep, onWaiting: (info) => waiting.push(info.attempt) },
  );

  assert.equal(result, "ready");
  assert.equal(attempts, 4);
  assert.deepEqual(waiting, [1, 2, 3]);
  assert.deepEqual(slept, [1000, 2000, 4000]);
});

await test("withColdStartRetry gives up with the NetworkError after about 90 seconds", async () => {
  const world = makeWorld();
  const { sleep } = sleeper(world);
  const tab = makeTab(world, []);
  const start = world.time;
  let attempts = 0;

  await assert.rejects(
    () => tab.auth.withColdStartRetry(async () => { attempts += 1; throw new NetworkError("down"); }, { sleep }),
    (error) => error instanceof NetworkError,
  );

  const waited = world.time - start;
  assert.ok(waited >= 60_000 && waited <= 90_000, "waited " + waited + "ms");
  assert.ok(attempts > 5);
});

await test("withColdStartRetry does not retry other errors", async () => {
  const world = makeWorld();
  const { sleep, slept } = sleeper(world);
  const tab = makeTab(world, []);
  let attempts = 0;

  await assert.rejects(
    () => tab.auth.withColdStartRetry(async () => { attempts += 1; throw new Error("bad config"); }, { sleep }),
    /bad config/,
  );

  assert.equal(attempts, 1);
  assert.deepEqual(slept, []);
});

console.log(`\n${passed} auth session tests passed`);
