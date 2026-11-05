# FinanceAI

A PWA-first, AI-assisted personal finance workspace built with FastAPI, vanilla JavaScript, Supabase Auth and Supabase PostgreSQL.

[![CI](https://github.com/NikunjSingh5779/Finance-AI/actions/workflows/ci.yml/badge.svg)](https://github.com/NikunjSingh5779/Finance-AI/actions/workflows/ci.yml)
[![Python](https://img.shields.io/badge/python-3.12+-blue.svg)](https://www.python.org/downloads/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## Product delivery

FinanceAI is delivered exclusively as a **Progressive Web App (PWA)**. There is no native Android/iOS application, APK, AAB, Expo project, or EAS build pipeline in this repository.

- Desktop: open FinanceAI in a browser.
- Android: open the website in Chrome and choose **Install app** or **Add to Home screen**.
- iPhone/iPad: open the website in Safari, tap **Share**, then **Add to Home Screen**.
- Updates: production releases are deployed to Cloudflare Pages; installed PWAs receive the updated app shell without an APK rebuild.

Production PWA: https://finance-ai-61h.pages.dev

## Features

- Income and expense tracking with categories, dates, descriptions, and accounts.
- Checking, savings, credit, cash, and investment accounts with computed current balances.
- Budget create/update/delete, utilization status, and pacing projections.
- Cash-flow summaries, category analysis, savings rate, and period comparisons.
- Next-month expense forecasting and explainable Financial Health Score.
- Recurring bills and income schedules with explicit, duplicate-safe payment recording.
- Per-user AI conversation history: opening the assistant starts a fresh chat; saved conversations can be searched and reopened.
- AI financial advice, general research, and travel planning through server-side providers.
- Market prices, history, fundamentals, and news.
- CSV transaction import/export.
- Responsive dark/light interface with installable PWA support and a privacy-safe offline shell.

## Architecture

```text
Browser / Installed PWA
        |
Cloudflare Pages (static PWA)
        |
FastAPI API on Render
        |
Supabase Auth + PostgreSQL (RLS)
        |
AI / Market / Search providers
```

The PWA contains no provider credentials. Authentication, finance data access, AI context, and database operations remain server-side.

## Project structure

```text
app/
  controllers/
  core/
  models/
  providers/
  repositories/
  schemas/
  services/
  static/             # PWA UI, manifest, service worker and icons
  main.py
scripts/
  build-netlify.mjs   # static build used by Cloudflare Pages
  financeai.ps1
  run.ps1
  setup.ps1
supabase/migrations/
tests/
```

## Local development

Requirements: Python 3.12+ and Node.js 22+ (Node is used for PWA syntax/build checks).

PowerShell:

```powershell
.\scripts\setup.ps1
.\scripts\run.ps1
```

Or start the API directly:

```bash
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Open http://127.0.0.1:8000. API documentation is available at http://127.0.0.1:8000/docs.

## PWA build

```bash
node scripts/build-netlify.mjs
```

The build writes the static site to `netlify-dist/`. The Cloudflare Pages workflow builds this directory and deploys it to the `finance-ai` Pages project. It injects the public `FINANCEAI_API_URL` value at build time.

## Authentication and data isolation

- Supabase Auth handles email/password verification and Google OAuth for the web.
- Passwords require at least 8 characters, one number, and one special character.
- PWA sessions persist across browser restarts and refresh access tokens safely.
- Each authenticated user's finance data and AI conversations are isolated by PostgreSQL row-level security.
- The service worker caches only public static assets; it does not cache auth responses or financial API data.

See [docs/MULTIUSER_DEPLOYMENT.md](docs/MULTIUSER_DEPLOYMENT.md) and [docs/FINANCEAI_V3.md](docs/FINANCEAI_V3.md).

## AI providers

AI is optional. The current implementation supports OmniRoute, OpenCode Zen, and OpenRouter-compatible providers. Configure provider credentials only on the backend (for example, in Render environment variables). Never put AI provider keys or database credentials in PWA build variables.

## Testing

```bash
pytest -q
flake8 app tests
node --check app/static/app.js
node --check app/static/pwa.js
node --check app/static/sw.js
node scripts/build-netlify.mjs
```

## Docker

```bash
docker build -t financeai .
docker run --rm -p 8000:8000 --env-file .env financeai
```

## Security

- Production should use `AUTH_REQUIRED=true` and Supabase PostgreSQL.
- Do not run a public multi-user deployment with SQLite as the shared database.
- Keep secrets in Render/Supabase secret settings, never in static PWA assets.
- Service-worker caching is allowlisted to public app-shell files only.

## License

MIT — see [LICENSE](LICENSE).
