import logging
import os
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from database import init_db
from routes.accounts import router as accounts_router
from routes.analysis import router as analysis_router
from routes.budgets import router as budgets_router
from routes.general import router as general_router
from routes.market import router as market_router
from routes.transactions import router as transactions_router

load_dotenv()

logger = logging.getLogger(__name__)

app = FastAPI(title="Finance Management API")

app.mount("/static", StaticFiles(directory="static"), name="static")

origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(transactions_router)
app.include_router(budgets_router)
app.include_router(analysis_router)
app.include_router(general_router)
app.include_router(accounts_router)
app.include_router(market_router)

init_db()

supported_keys = [
    "OPENCODE_API_KEY",
    "CLAUDE_API_KEY",
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
]
active_providers = [k for k in supported_keys if os.getenv(k)]
if not active_providers:
    print(
        "WARNING: No LLM API key configured "
        "(set OPENROUTER_API_KEY, OPENCODE_API_KEY, OPENAI_API_KEY, or CLAUDE_API_KEY). "
        "AI advisor endpoints will not function."
    )
