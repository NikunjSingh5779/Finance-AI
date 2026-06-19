# Finance AI

[![CI](https://github.com/NikunjSingh5779/Finance-AI/actions/workflows/ci.yml/badge.svg)](https://github.com/NikunjSingh5779/Finance-AI/actions/workflows/ci.yml)
[![Python](https://img.shields.io/badge/python-3.12+-blue.svg)](https://www.python.org/downloads/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

AI-powered personal finance manager — track expenses, set budgets, and get smart financial advice via an AI advisor.

## Features

- **Transaction tracking** — income and expense entries with categories and dates
- **AI advisor** — get contextual financial advice via Claude, OpenAI, or OpenRouter with automatic fallback
- **Interactive charts** — spending breakdown by category, monthly trends (Chart.js)
- **Budget management** — per-category spending limits with progress tracking
- **CSV import** — bulk-import transactions from CSV files
- **ML prediction** — estimated monthly spending using linear regression (scikit-learn)
- **Dark / light theme** — toggleable UI preference

## Tech stack

| Layer      | Technology                                          |
|------------|-----------------------------------------------------|
| Backend    | Python 3.12 + FastAPI + SQLite3                     |
| Frontend   | Vanilla HTML / CSS / JS (no framework)              |
| AI         | Anthropic Claude, OpenAI GPT, OpenRouter (auto-fallback) |
| ML         | scikit-learn linear regression for predictions      |
| Deploy     | Docker, Railway, or any VPS                         |

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌────────────┐
│   Browser    │────▶│  FastAPI     │────▶│  SQLite    │
│  (static)    │◀────│  (main.py)   │◀────│  (finance) │
└──────────────┘     └──────┬───────┘     └────────────┘
                            │
                     ┌──────▼───────┐
                     │  AI Provider  │
                     │  (claude /    │
                     │   openai /    │
                     │   openrouter) │
                     └──────────────┘
```

## Project structure

```
├── main.py              # FastAPI application and route definitions
├── ai_provider.py       # LLM client abstraction (Claude, OpenAI, OpenRouter)
├── index.html           # Single-page frontend
├── static/
│   ├── style.css        # All CSS
│   └── script.js        # All JS
├── tests/
│   └── test_core.py     # API endpoint tests
├── requirements.txt     # Python dependencies
├── pyproject.toml       # Project metadata
├── Dockerfile           # Container image
├── .env.example         # Environment variable template
└── .github/workflows/ci.yml  # CI pipeline
```

## Quick start

```bash
git clone https://github.com/NikunjSingh5779/Finance-AI
cd Finance-AI

python -m pip install -r requirements.txt

cp .env.example .env
# Edit .env and add your LLM API key (OPENAI_API_KEY, CLAUDE_API_KEY, or OPENROUTER_API_KEY)

uvicorn main:app --reload
```

Open `http://localhost:8000` in a browser.

## API endpoints

| Method | Path                | Description                         |
|--------|---------------------|-------------------------------------|
| GET    | `/`                 | Serve frontend                      |
| GET    | `/health`           | Health check                        |
| GET    | `/transactions`     | List all transactions               |
| POST   | `/transactions`     | Add a transaction                   |
| DELETE | `/transactions/{id}`| Delete a transaction                |
| GET    | `/summary`          | Monthly income / expense / savings  |
| GET    | `/budgets`          | List budgets                        |
| POST   | `/budgets`          | Create / update budget              |
| DELETE | `/budgets/{cat}`    | Delete budget for a category        |
| POST   | `/ai/advice`        | Get AI financial advice             |
| GET    | `/predict-expense`  | Predict next month's expenses       |

## Running with Docker

```bash
docker build -t finance-ai .
docker run -p 8000:8000 --env-file .env finance-ai
```

## Testing

```bash
pip install pytest
pytest -v
```

## Security

API keys are read from `.env`. This file is in `.gitignore` and must never be committed. If you cloned a version where `.env` was accidentally committed, revoke those keys immediately. See `SECURITY.md` for details.

## License

MIT — see [LICENSE](LICENSE).
