import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.controllers.account_controller import router as account_router
from app.controllers.ai_controller import router as ai_router
from app.controllers.analysis_controller import router as analysis_router
from app.controllers.budget_controller import router as budget_router
from app.controllers.general_controller import router as general_router
from app.controllers.insights_controller import router as insights_router
from app.controllers.market_controller import router as market_router
from app.controllers.transaction_controller import router as transaction_router
from app.core.database import init_db
from app.core.exceptions import (
    AccountDeletionError,
    FinanceAIError,
    NotFoundError,
    InsufficientDataError,
    ProviderError,
    RateLimitError,
    ValidationError,
)

load_dotenv()
logger = logging.getLogger(__name__)

app = FastAPI(
    title="FinanceAI Personal Finance API",
    version="2.0.0",
    description="Personal finance tracking, analytics, forecasting and AI insights.",
)

static_dir = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(NotFoundError)
async def not_found_handler(request: Request, exc: NotFoundError):
    return JSONResponse(
        status_code=404,
        content={"detail": exc.message, "errors": exc.details},
    )


@app.exception_handler(AccountDeletionError)
async def account_deletion_handler(
    request: Request, exc: AccountDeletionError
):
    return JSONResponse(
        status_code=409,
        content={"detail": exc.message, "errors": exc.details},
    )


@app.exception_handler(InsufficientDataError)
async def insufficient_data_handler(
    request: Request, exc: InsufficientDataError
):
    return JSONResponse(
        status_code=422,
        content={"detail": exc.message, "errors": exc.details},
    )


@app.exception_handler(ProviderError)
async def provider_error_handler(request: Request, exc: ProviderError):
    return JSONResponse(
        status_code=503,
        content={"detail": exc.message, "errors": exc.details},
    )


@app.exception_handler(RateLimitError)
async def rate_limit_handler(request: Request, exc: RateLimitError):
    return JSONResponse(
        status_code=429,
        content={"detail": exc.message, "errors": exc.details},
    )


@app.exception_handler(ValidationError)
async def validation_error_handler(request: Request, exc: ValidationError):
    return JSONResponse(
        status_code=422,
        content={"detail": exc.message, "errors": exc.details},
    )


@app.exception_handler(FinanceAIError)
async def finance_error_handler(request: Request, exc: FinanceAIError):
    return JSONResponse(
        status_code=400,
        content={"detail": exc.message, "errors": exc.details},
    )


app.include_router(transaction_router)
app.include_router(account_router)
app.include_router(budget_router)
app.include_router(analysis_router)
app.include_router(general_router)
app.include_router(market_router)
app.include_router(ai_router)
app.include_router(insights_router)

init_db()

SUPPORTED_AI_KEYS = (
    "OMNIROUTE_API_KEY",
    "OPENCODE_ZEN_API_KEY",
    "OPENROUTER_API_KEY",
)
if not any(os.getenv(key) for key in SUPPORTED_AI_KEYS):
    logger.warning(
        "No supported AI provider credentials found; AI features are disabled."
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "8000")),
    )
