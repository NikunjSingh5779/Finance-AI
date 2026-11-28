import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const source = path.join(root, "app", "static");
const output = path.join(root, "pages-dist");

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
fs.cpSync(source, output, { recursive: true });

const indexPath = path.join(output, "index.html");
const appPath = path.join(output, "app.js");

let index = fs.readFileSync(indexPath, "utf8");
index = index
  .replace(/href="\/static\/([^"]+)"/g, 'href="/$1"')
  .replace(/src="\/static\/([^"]+)"/g, 'src="/$1"');

let app = fs.readFileSync(appPath, "utf8");
// With FINANCEAI_PROXY=1 the browser talks only to the site's own origin and
// functions/[[path]].js forwards API calls to Render. That keeps the session
// cookie first-party, so the API base must be empty.
const proxyMode = process.env.FINANCEAI_PROXY === "1";
const apiUrl = proxyMode ? "" : process.env.FINANCEAI_API_URL || "";
app = app.replace(
  'const API = window.FINANCEAI_API_URL || "";',
  `const API = ${JSON.stringify(apiUrl)};`
);

fs.writeFileSync(indexPath, index, "utf8");
fs.writeFileSync(appPath, app, "utf8");

// The FastAPI app serves assets from /static; Cloudflare Pages flattens
// app/static into the site root. Rewrite the service worker's allowlist too.
const serviceWorkerPath = path.join(output, "sw.js");
let serviceWorker = fs.readFileSync(serviceWorkerPath, "utf8");
serviceWorker = serviceWorker.replaceAll('"/static/', '"/');
fs.writeFileSync(serviceWorkerPath, serviceWorker, "utf8");

// Cloudflare Pages reads security headers from a static _headers file, so
// emit the rules into the build output.
const headersPath = path.join(output, "_headers");
fs.writeFileSync(
  headersPath,
  [
    "/*",
    "  X-Content-Type-Options: nosniff",
    "  Referrer-Policy: strict-origin-when-cross-origin",
    "  X-Frame-Options: SAMEORIGIN",
    "  Permissions-Policy: camera=(), microphone=()",
    "",
    "/sw.js",
    "  Cache-Control: no-cache",
    "",
  ].join("\n"),
  "utf8"
);

// Cloudflare Pages: only API paths invoke functions/[[path]].js, so static
// assets are served directly (and do not count against Functions quotas).
// Keep in sync with PROXIED_PREFIXES in functions/[[path]].js.
const proxiedPrefixes = [
  "/auth", "/api", "/transactions", "/budgets", "/accounts", "/goals",
  "/ai", "/summary", "/recurring", "/predict-expense", "/health",
];
fs.writeFileSync(
  path.join(output, "_routes.json"),
  JSON.stringify(
    {
      version: 1,
      include: proxiedPrefixes.flatMap((prefix) => [prefix, prefix + "/*"]),
      exclude: [],
    },
    null,
    2
  ) + "\n",
  "utf8"
);

console.log("FinanceAI static site prepared.");
console.log(
  proxyMode
    ? "Proxy mode: frontend calls the site's own origin; Pages Functions forward API requests."
    : apiUrl
      ? "Frontend API URL configured for: " + apiUrl
      : "No FINANCEAI_API_URL supplied; frontend API remains same-origin."
);
