# FinanceAI

AI-assisted personal finance management built with FastAPI, SQLite, vanilla JavaScript, and optional free/local AI providers.

[![CI](https://github.com/NikunjSingh5779/Finance-AI/actions/workflows/ci.yml/badge.svg)](https://github.com/NikunjSingh5779/Finance-AI/actions/workflows/ci.yml)
[![Python](https://img.shields.io/badge/python-3.12+-blue.svg)](https://www.python.org/downloads/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## Features

- Income and expense tracking with categories, dates, descriptions, and accounts.
- Checking, savings, credit, cash, and investment accounts with computed current balances.
- Budget create/update/delete, utilization status, and pacing projections.
- Cash-flow summaries, category analysis, savings rate, and period comparisons.
- Next-month total-expense forecasting from monthly history.
- Financial Health Score with explainable components.
- Recurring-expense detection and unusual-spending detection.
- Server-side AI financial context with provider fallback.
- Market prices, history, fundamentals, news, and optional experimental forecasting.
- CSV transaction import.
- Responsive dark/light dashboard.

## Architecture

~~~text
Browser
  |
FastAPI Controllers
  |
Services
 / Repositories  Providers
   |            |
 SQLite       AI / Market / Search
~~~

Controllers handle HTTP only. Services contain business rules. Repositories own SQLite persistence. Providers own external integrations. AI financial context is rebuilt from the server-side database.

## Project structure

~~~text
app/
  controllers/
  core/
  models/
  providers/
    ai/
    market/
    search/
  repositories/
  schemas/
  services/
  static/
  utils/
  main.py
tests/
~~~

## Quick start

~~~bash
git clone https://github.com/NikunjSingh5779/Finance-AI
cd Finance-AI
python -m pip install -r requirements.txt
cp .env.example .env
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
~~~

Open http://127.0.0.1:8000

Swagger: http://127.0.0.1:8000/docs

## AI providers

AI is optional. The current implementation supports:

- OmniRoute
- OpenCode Zen
- OpenRouter

Example configuration:

~~~text
OMNIROUTE_API_KEY=...
OMNIROUTE_BASE_URL=http://127.0.0.1:20128
OMNIROUTE_MODEL=auto

OPENCODE_ZEN_API_KEY=...
OPENCODE_BASE_URL=https://opencode.ai/zen/v1
OPENCODE_MODEL=mimo-v2.5-free

OPENROUTER_API_KEY=...
OPENROUTER_MODEL=openrouter/free
~~~

Claude/OpenAI-specific credentials are not part of the current provider implementation.

## Important API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | /health | Health check |
| GET/POST | /accounts | Account list/create |
| GET/PUT/DELETE | /accounts/{id} | Account lifecycle |
| GET/POST | /transactions | Transaction list/create |
| GET/PUT/DELETE | /transactions/{id} | Transaction lifecycle |
| POST | /transactions/import | Bulk import |
| GET/POST | /budgets | Budget list/create/upsert |
| GET/PUT/DELETE | /budgets/{category} | Budget lifecycle |
| GET | /budgets/{category}/status | Budget pacing |
| GET | /summary?period=1m | Financial summary |
| GET | /predict-expense | Next-month expense estimate |
| POST | /ai/advice | AI financial advice |
| GET | /ai/providers | Provider status |
| GET | /api/insights/dashboard | Health + recurring + anomaly overview |
| GET | /api/insights/health | Financial Health Score |
| GET | /api/insights/recurring | Recurring expenses |
| GET | /api/insights/anomalies | Unusual spending |
| GET/POST | /goals | Financial goal list/create |
| GET/PUT/DELETE | /goals/{id} | Financial goal lifecycle |
| GET | /api/net-worth | Current assets, liabilities, and net worth |
| GET | /api/reports/monthly | Deterministic monthly report |
| GET | /api/market/{symbol} | Market data |
| GET | /api/market/{symbol}/history | OHLCV history |
| GET | /api/market/{symbol}/predict | Experimental forecast |

## Planning and wealth

The Planning & Wealth page combines three capabilities:

- **Financial goals** — create targets, track saved amounts, set target dates, and calculate the monthly amount required to reach the target.
- **Net worth** — derives assets and liabilities from current account balances. Credit accounts are treated as liabilities.
- **Monthly report** — summarizes a selected month, compares it with the previous month, highlights major spending categories, and shows budget/recurring signals.

## Financial insights

The Financial Insights page provides a transparent 0–100 score based on savings, budgeting, expense consistency, and estimated cash buffer. It also identifies likely recurring monthly expenses and unusually large expenses relative to a category's history.

These signals are analytical estimates, not investment advice or guaranteed predictions.

## Data and safety

- SQLite uses foreign keys, WAL mode, busy timeout, and indexes for transaction queries.
- Existing databases are migrated in place; initialization does not intentionally reset user data.
- Invalid and non-finite financial inputs are rejected.
- Accounts with linked transactions cannot be deleted accidentally.
- AI calls are rate-limited per client IP.
- The active frontend runtime renders user-controlled strings through DOM APIs rather than raw HTML templating.

## Testing

~~~bash
pytest -q
flake8 .
~~~

## Docker

~~~bash
docker build -t financeai .
docker run --rm -p 8000:8000 --env-file .env financeai
~~~

## Limitations

Expense forecasting and market forecasting are estimates based on historical data. Market predictions are experimental and must not be treated as guaranteed outcomes.

## License

MIT — see LICENSE.
