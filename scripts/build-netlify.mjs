import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const source = path.join(root, "app", "static");
const output = path.join(root, "netlify-dist");

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
fs.cpSync(source, output, { recursive: true });

const indexPath = path.join(output, "index.html");
const appPath = path.join(output, "app.js");

let index = fs.readFileSync(indexPath, "utf8");
index = index
  .replaceAll('href="/static/style.css"', 'href="/style.css"')
  .replaceAll('href="/static/insights.css"', 'href="/insights.css"')
  .replaceAll('src="/static/app.js"', 'src="/app.js"');

let app = fs.readFileSync(appPath, "utf8");
const apiUrl = process.env.FINANCEAI_API_URL || "";
app = app.replace(
  'const API = window.FINANCEAI_API_URL || "";',
  `const API = ${JSON.stringify(apiUrl)};`
);

fs.writeFileSync(indexPath, index, "utf8");
fs.writeFileSync(appPath, app, "utf8");

console.log("FinanceAI Netlify static site prepared.");
console.log(
  apiUrl
    ? "Frontend API URL configured for: " + apiUrl
    : "No FINANCEAI_API_URL supplied; frontend API remains same-origin."
);
