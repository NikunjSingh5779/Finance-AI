from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
from dotenv import load_dotenv

from database import init_db
from routes.transactions import router as transactions_router
from routes.budgets import router as budgets_router
from routes.analysis import router as analysis_router
from routes.general import router as general_router
from routes.accounts import router as accounts_router

load_dotenv()

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

init_db()

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
if not OPENROUTER_API_KEY:
    print("WARNING: OPENROUTER_API_KEY not set - AI advisor will be unavailable")
