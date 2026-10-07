import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const source = path.join(root, "app", "static");
const output = path.join(root, "netlify-dist");

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
fs.cpSync(source, output, { recursive: true });

const indexPath = path.join(output, "index.html");
let index = fs.readFileSync(indexPath, "utf8");
index = index
  .replaceAll('href="/static/style.css"', 'href="/style.css"')
  .replaceAll('href="/static/insights.css"', 'href="/insights.css"')
  .replaceAll('src="/static/app.js"', 'src="/app.js"');

fs.writeFileSync(indexPath, index, "utf8");

console.log("FinanceAI Netlify static site prepared.");
console.log("Backend/API note: set a production API URL in the frontend before public use.");
