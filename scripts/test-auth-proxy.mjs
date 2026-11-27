// Tests for the Cloudflare Pages same-origin proxy (functions/[[path]].js) and
// the build-time pieces that make it work (_routes.json, API base "").
//
//   node scripts/test-auth-proxy.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UPSTREAM = "https://finance-ai-u9bo.onrender.com";

// Load the Pages Function as an ES module regardless of package "type".
const source = fs.readFileSync(path.join(repo, "functions", "[[path]].js"), "utf8");
const { onRequest } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);

let passed = 0;
async function test(name, fn) {
  const realFetch = globalThis.fetch;
  try {
    await fn();
    passed += 1;
    console.log("ok   - " + name);
  } catch (error) {
    console.error("FAIL - " + name);
    console.error(error);
    process.exitCode = 1;
  } finally {
    globalThis.fetch = realFetch;
  }
}

function makeContext(url, init = {}) {
  const state = { nextCalled: false };
  const request = new Request(url, init);
  return {
    state,
    context: {
      request,
      next: async () => {
        state.nextCalled = true;
        return new Response("static asset", { status: 200 });
      },
    },
  };
}

function stubFetch(responder) {
  const calls = [];
  globalThis.fetch = async (target, init = {}) => {
    calls.push({ target: String(target), init });
    return responder(String(target), init);
  };
  return calls;
}

const ALLOW_LISTED = [
  "/auth", "/api", "/transactions", "/budgets", "/accounts", "/goals",
  "/ai", "/summary", "/recurring", "/predict-expense", "/health",
];

await test("allow-listed request is proxied with method, body, cookies and origin", async () => {
  const calls = stubFetch(() => new Response('{"ok":true}', { status: 200 }));
  const { context, state } = makeContext("https://app.pages.dev/auth/refresh?x=1", {
    method: "POST",
    headers: {
      cookie: "fa_rt=abc",
      origin: "https://app.pages.dev",
      "content-type": "application/json",
    },
    body: '{"hello":"world"}',
  });

  const response = await onRequest(context);

  assert.equal(response.status, 200);
  assert.equal(state.nextCalled, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].target, UPSTREAM + "/auth/refresh?x=1");
  assert.equal(calls[0].init.method, "POST");
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get("cookie"), "fa_rt=abc");
  assert.equal(headers.get("origin"), "https://app.pages.dev");
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.has("host"), false);
  assert.equal(await new Response(calls[0].init.body).text(), '{"hello":"world"}');
});

await test("every real backend prefix is proxied, root and nested", async () => {
  for (const prefix of ALLOW_LISTED) {
    for (const suffix of ["", "/child"]) {
      const calls = stubFetch(() => new Response("x"));
      const { context, state } = makeContext("https://app.pages.dev" + prefix + suffix);
      await onRequest(context);
      assert.equal(calls.length, 1, prefix + suffix + " should be proxied");
      assert.equal(state.nextCalled, false);
    }
  }
});

await test("non-allow-listed paths fall through to static assets and never hit the API", async () => {
  const calls = stubFetch(() => new Response("should not be called"));
  for (const p of ["/", "/app.js", "/index.html", "/ai-page.js", "/authx", "/accounts-old", "/static/app.js", "/icons/icon-192.png"]) {
    const { context, state } = makeContext("https://app.pages.dev" + p);
    const response = await onRequest(context);
    assert.equal(state.nextCalled, true, p + " should fall through");
    assert.equal(await response.text(), "static asset");
  }
  assert.equal(calls.length, 0);
});

await test("Set-Cookie headers and status codes pass through unchanged", async () => {
  stubFetch(() => {
    const headers = new Headers({ "content-type": "application/json" });
    headers.append("set-cookie", "fa_rt=new; Path=/auth; HttpOnly; Max-Age=604800");
    headers.append("set-cookie", "other=1; Path=/");
    return new Response('{"detail":"no"}', { status: 401, headers });
  });
  const { context } = makeContext("https://app.pages.dev/auth/refresh", { method: "POST" });

  const response = await onRequest(context);

  assert.equal(response.status, 401);
  assert.deepEqual(response.headers.getSetCookie(), [
    "fa_rt=new; Path=/auth; HttpOnly; Max-Age=604800",
    "other=1; Path=/",
  ]);
  assert.equal(await response.text(), '{"detail":"no"}');
});

await test("response bodies stream through without buffering (AI SSE)", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const encoder = new TextEncoder();
  stubFetch(() => new Response(new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode("data: one\n\n"));
      await gate; // the second chunk only exists after the client read the first
      controller.enqueue(encoder.encode("data: two\n\n"));
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream" } }));
  const { context } = makeContext("https://app.pages.dev/ai/advice", { method: "POST", body: "{}" });

  const response = await onRequest(context);
  const reader = response.body.getReader();
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("first chunk was buffered")), 2000));
  const first = await Promise.race([reader.read(), timeout]);
  assert.equal(new TextDecoder().decode(first.value), "data: one\n\n");
  release();
  const second = await reader.read();
  assert.equal(new TextDecoder().decode(second.value), "data: two\n\n");
});

await test("X-Forwarded-For comes from CF-Connecting-IP and ignores client-supplied values", async () => {
  const calls = stubFetch(() => new Response("x"));
  const { context } = makeContext("https://app.pages.dev/auth/login", {
    method: "POST",
    headers: { "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    body: "{}",
  });

  await onRequest(context);

  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get("x-forwarded-for"), "203.0.113.9");
});

await test("a spoofed X-Forwarded-For is dropped when CF-Connecting-IP is absent", async () => {
  const calls = stubFetch(() => new Response("x"));
  const { context } = makeContext("https://app.pages.dev/health", {
    headers: { "x-forwarded-for": "1.2.3.4" },
  });

  await onRequest(context);

  assert.equal(new Headers(calls[0].init.headers).has("x-forwarded-for"), false);
});

await test("GET requests send no body and redirects are not followed", async () => {
  const calls = stubFetch(() => new Response(null, { status: 302, headers: { location: "/elsewhere" } }));
  const { context } = makeContext("https://app.pages.dev/transactions?limit=5");

  const response = await onRequest(context);

  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(response.status, 302);
});

await test("an unreachable API becomes a 502 JSON error", async () => {
  globalThis.fetch = async () => { throw new TypeError("connection refused"); };
  const { context } = makeContext("https://app.pages.dev/auth/refresh", { method: "POST" });

  const response = await onRequest(context);

  assert.equal(response.status, 502);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.ok((await response.json()).detail);
});

// ---- build script -----------------------------------------------------------

function buildInTempCopy(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "financeai-build-"));
  fs.mkdirSync(path.join(dir, "scripts"));
  fs.cpSync(path.join(repo, "app", "static"), path.join(dir, "app", "static"), { recursive: true });
  fs.copyFileSync(
    path.join(repo, "scripts", "build-netlify.mjs"),
    path.join(dir, "scripts", "build-netlify.mjs"),
  );
  const result = spawnSync(process.execPath, ["scripts/build-netlify.mjs"], {
    cwd: dir,
    env: { PATH: process.env.PATH, ...env },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return path.join(dir, "netlify-dist");
}

await test("FINANCEAI_PROXY=1 makes the frontend API base same-origin", async () => {
  const dist = buildInTempCopy({
    FINANCEAI_PROXY: "1",
    FINANCEAI_API_URL: UPSTREAM,
  });

  const app = fs.readFileSync(path.join(dist, "app.js"), "utf8");
  assert.ok(app.includes('const API = "";'), "API base should be empty in proxy mode");
  assert.ok(!app.includes(UPSTREAM), "the Render URL must not be baked into app.js");
});

await test("without FINANCEAI_PROXY the Render URL is still injected", async () => {
  const dist = buildInTempCopy({ FINANCEAI_API_URL: UPSTREAM });

  const app = fs.readFileSync(path.join(dist, "app.js"), "utf8");
  assert.ok(app.includes(`const API = ${JSON.stringify(UPSTREAM)};`));
});

await test("_routes.json sends only the allow-listed prefixes to the function", async () => {
  const dist = buildInTempCopy({ FINANCEAI_PROXY: "1" });

  const routes = JSON.parse(fs.readFileSync(path.join(dist, "_routes.json"), "utf8"));
  assert.equal(routes.version, 1);
  assert.ok(!routes.include.includes("/*"), "static assets must not invoke the function");
  for (const prefix of ALLOW_LISTED) {
    assert.ok(routes.include.includes(prefix), prefix + " missing from _routes.json");
    assert.ok(routes.include.includes(prefix + "/*"), prefix + "/* missing from _routes.json");
  }
  assert.equal(routes.include.length, ALLOW_LISTED.length * 2);
  assert.ok(routes.include.length <= 100, "Pages allows at most 100 route rules");
});

console.log(`\n${passed} auth proxy tests passed`);
