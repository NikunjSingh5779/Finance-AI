# Finance AI

[![CI](https://github.com/NikunjSingh5779/Finance-AI/actions/workflows/ci.yml/badge.svg)](https://github.com/NikunjSingh5779/Finance-AI/actions/workflows/ci.yml)
[![Python](https://img.shields.io/badge/python-3.12+-blue.svg)](https://www.python.org/downloads/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

AI-powered personal finance manager — track expenses, set budgets, analyze cashflow, fetch real-time market data, and get smart financial advice via multi-provider AI.

## Features

- **Transaction tracking** — income and expense entries with descriptions, categories, accounts, and dates; edit or delete any transaction
- **Accounts management** — add, edit, delete accounts (checking, savings, credit, cash, investment) with real-time balance tracking
- **CSV import** — bulk-import transactions from CSV files
- **AI advisor** — get contextual financial advice via OpenCode, Anthropic Claude, OpenAI GPT, or OpenRouter with automated fallbacks
- **Enhanced AI advisor** — enriched financial advice with live web search and market context
- **Market data & prediction** — real-time stock/crypto data via yfinance, technical analysis, and price prediction with linear regression or Kronos foundation model
- **Interactive charts** — cashflow area chart, category donut breakdown, and trend sparklines (Chart.js)
- **Budget management** — per-category spending limits with progress tracking and alert states
- **ML expense prediction** — estimated next month expenses using linear regression (scikit-learn)
- **Dark / light theme** — toggleable UI preference

## Tech Stack

| Layer      | Technology                                          |
|------------|-----------------------------------------------------|
| Backend    | Python 3.12+ + FastAPI + SQLite3                    |
| Frontend   | Vanilla HTML / CSS / JS (Chart.js)                  |
| AI Models  | Claude, OpenAI GPT, OpenRouter            |
| Market Data| yfinance + Kronos ML predictor + DuckDuckGo search  |
| ML         | scikit-learn linear regression for predictions      |
| Deploy     | Docker or any VPS                                   |

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌────────────┐
│   Browser    │────▶│  FastAPI     │────▶│  SQLite    │
│  (static)    │◀────│  (main.py)   │◀────│ (DB_PATH)  │
└──────────────┘     └──────┬───────┘     └────────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
       ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
       │ AI Provider  │ │ Market Data  │ │  Web Search  │
       │ (OpenCode /  │ │  (yfinance / │ │(DuckDuckGo / │
       │Claude/OpenAI/│ │    Kronos)   │ │  Financial)  │
       │ OpenRouter)  │ └──────────────┘ └──────────────┘
       └──────────────┘
```

## Project Structure

```
├── main.py              # FastAPI application entrypoint & middleware
├── database.py          # SQLite schema, connection management, migrations
├── models.py            # Pydantic schemas and validators
├── ai_provider.py       # Multi-provider LLM client (OpenCode, Claude, OpenAI, OpenRouter)
├── market_data.py       # Real-time stock prices & historical OHLCV via yfinance
├── market_predictor.py  # Kronos foundation model & linear regression predictor
├── web_search.py        # Web search & financial news provider
├── rate_limiter.py      # In-memory IP rate limiter
├── index.html           # Single-page application frontend
├── routes/              # Modular API routers
│   ├── accounts.py      # Account CRUD routes
│   ├── analysis.py      # Summary, expense prediction, AI advice routes
│   ├── budgets.py       # Budget CRUD & progress routes
│   ├── general.py       # Root page & healthcheck
│   ├── market.py        # Market data & price prediction routes
│   └── transactions.py  # Transaction CRUD & CSV import routes
├── static/
│   ├── style.css        # Responsive styling (dark & light modes)
│   └── script.js        # Dynamic frontend logic & Chart.js integration
├── tests/
│   └── test_core.py     # Complete test suite for all endpoints
├── requirements.txt     # Python dependencies
├── pyproject.toml       # Project metadata & pytest configuration
├── Dockerfile           # Multi-stage production container
├── .dockerignore        # Docker build ignore rules
├── .gitignore           # Git ignore rules
└── .env.example         # Environment variable template
```

## Quick Start

```bash
git clone https://github.com/NikunjSingh5779/Finance-AI
cd Finance-AI

python -m pip install -r requirements.txt

cp .env.example .env
# Edit .env and configure at least one API key (OPENROUTER_API_KEY, OPENCODE_ZEN_API_KEY, etc.)

uvicorn main:app --reload
```

Open `http://localhost:8000` in your browser.

## API Endpoints

| Method | Path                     | Description                                   |
|--------|--------------------------|-----------------------------------------------|
| GET    | `/`                      | Serve frontend                                |
| GET    | `/health`                | Health check                                  |
| GET    | `/transactions`          | List all transactions (ordered by date)       |
| POST   | `/transactions`          | Add a transaction                             |
| PUT    | `/transactions/{id}`     | Edit a transaction                            |
| DELETE | `/transactions/{id}`     | Delete a transaction                          |
| POST   | `/transactions/import`   | Bulk-import transactions from CSV             |
| GET    | `/summary`               | Monthly income, expense, balance, savings rate|
| GET    | `/budgets`               | List budgets                                  |
| POST   | `/budgets`               | Create / update budget                        |
| DELETE | `/budgets/{cat}`         | Delete budget for a category                  |
| GET    | `/accounts`              | List all accounts with calculated balances    |
| POST   | `/accounts`              | Add an account                                |
| PUT    | `/accounts/{id}`         | Edit an account                               |
| DELETE | `/accounts/{id}`         | Delete an account                             |
| POST   | `/ai/advice`             | Get AI financial advice                       |
| POST   | `/ai/advice-enhanced`    | Enriched AI advice with live web search news  |
| GET    | `/predict-expense`       | Predict next month's expenses via regression  |
| GET    | `/api/market/search`    | Search stock/asset ticker symbols             |
| GET    | `/api/market/{symbol}`   | Get real-time stock price and changes         |
| GET    | `/api/market/{sym}/history` | Get OHLCV historical candle data           |
| GET    | `/api/market/{sym}/news` | Get financial news from web search            |
| GET    | `/api/market/{sym}/predict` | Forecast prices using ML/Kronos/fallback   |
| GET    | `/api/market/{sym}/overview`| Combined price, info, and news overview   |

## Running with Docker

```bash
docker build -t finance-ai .
docker run -p 8000:8000 --env-file .env finance-ai
```

## Testing

```bash
pytest -v
```

## Security

API keys are read from `.env`. This file is in `.gitignore` and must never be committed to source control. If you have previously committed keys, revoke them immediately.

## License

MIT — see [LICENSE](LICENSE).
