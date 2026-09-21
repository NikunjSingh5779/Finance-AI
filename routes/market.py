"""Market Routes — stock data, financial news, and price prediction endpoints.

Provides three tiers of financial market functionality:
1. Real-time market data via yfinance (free, no API key)
2. Financial news via DuckDuckGo web search (free, no API key)
3. ML-powered price prediction via Kronos (optional) with trend fallback

All endpoints gracefully degrade when dependencies are not installed.

Pattern adapted from ARES agents/kronos_predictor.py and the
xai_finance_agent's YFinanceTools + DuckDuckGoTools integration.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, HTTPException, Query

from market_data import get_market_provider, ohlcv_to_features
from market_predictor import predict_prices
from web_search import get_searcher

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/market")


# ---------------------------------------------------------------------------
# Async helper
# ---------------------------------------------------------------------------

async def _run_async(coro):
    """Run an async coroutine, handling event loop state."""
    return await coro


# ---------------------------------------------------------------------------
# Market Data Endpoints
# ---------------------------------------------------------------------------


@router.get("/search")
async def search_ticker(
    q: str = Query(..., min_length=1, max_length=100, description="Company name or ticker to search"),
):
    """Search for ticker symbols matching a query."""
    provider = get_market_provider()
    if not provider.available:
        raise HTTPException(
            503,
            "Market data unavailable (yfinance not installed. Run: pip install yfinance)",
        )

    results = await provider.search_ticker(q)
    if not results:
        return {"query": q, "results": [], "message": "No matches found"}

    return {"query": q, "results": results}


@router.get("/{symbol}")
async def get_market_data(symbol: str):
    """Get current real-time price data for a symbol.

    Args:
        symbol: Ticker symbol (e.g., AAPL, MSFT, BTC-USD).
    """
    provider = get_market_provider()

    if not provider.available:
        raise HTTPException(
            503,
            "Market data unavailable (yfinance not installed. Run: pip install yfinance)",
        )

    price_data = await provider.get_current_price(symbol.upper())
    if price_data is None:
        raise HTTPException(404, f"No market data found for {symbol.upper()}")

    return price_data


@router.get("/{symbol}/history")
async def get_market_history(
    symbol: str,
    period: str = Query("1mo", description="Period: 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, max"),
    interval: str = Query("1d", description="Interval: 1m, 2m, 5m, 15m, 30m, 60m, 1d, 5d, 1wk, 1mo"),
):
    """Get historical OHLCV data for a symbol.

    Args:
        symbol: Ticker symbol (e.g., AAPL).
        period: Time period (1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, max).
        interval: Candle interval (1m, 2m, 5m, 15m, 30m, 60m, 1d, 5d, 1wk, 1mo).
    """
    provider = get_market_provider()

    if not provider.available:
        raise HTTPException(
            503,
            "Market data unavailable (yfinance not installed. Run: pip install yfinance)",
        )

    history = await provider.get_history(symbol.upper(), period=period, interval=interval)
    if history is None:
        raise HTTPException(404, f"No historical data for {symbol.upper()}")

    features = ohlcv_to_features(history)

    return {
        "symbol": symbol.upper(),
        "period": period,
        "interval": interval,
        "data_points": len(history),
        "records": history,
        "features": features,
    }


@router.get("/{symbol}/info")
async def get_company_info(symbol: str):
    """Get company fundamentals and info for a symbol.

    Args:
        symbol: Ticker symbol (e.g., AAPL, MSFT).
    """
    provider = get_market_provider()

    if not provider.available:
        raise HTTPException(
            503,
            "Market data unavailable (yfinance not installed. Run: pip install yfinance)",
        )

    info = await provider.get_company_info(symbol.upper())
    if info is None:
        raise HTTPException(404, f"No company info found for {symbol.upper()}")

    return info


@router.get("/{symbol}/news")
async def get_market_news(
    symbol: str,
    max_results: int = Query(5, ge=1, le=20, description="Number of news results"),
):
    """Get recent financial news about a symbol via web search.

    Uses DuckDuckGo web search (free, no API key required).

    Args:
        symbol: Ticker symbol (e.g., AAPL, TSLA).
        max_results: Maximum news results.
    """
    try:
        searcher = get_searcher()
        results = await searcher.search_financial_news(symbol, max_results=max_results)
        return {
            "symbol": symbol.upper(),
            "news": results,
            "count": len(results),
        }
    except Exception as e:
        logger.error(f"News search failed for {symbol}: {e}")
        return {
            "symbol": symbol.upper(),
            "news": [],
            "count": 0,
            "error": f"News search unavailable: {e}",
        }


@router.get("/{symbol}/predict")
async def get_market_prediction(
    symbol: str,
    period: str = Query("3mo", description="Historical period for training data: 1mo, 3mo, 6mo, 1y"),
    pred_len: int = Query(10, ge=5, le=60, description="Days to predict forward"),
):
    """Predict future price movements for a symbol.

    Two-tier prediction:
    1. Kronos ML model (if installed) — Transformer-based forecasting
    2. Linear regression fallback — trend extrapolation

    Args:
        symbol: Ticker symbol (e.g., AAPL, BTC-USD).
        period: Historical data period for training.
        pred_len: Number of periods to predict forward.
    """
    provider = get_market_provider()

    if not provider.available:
        return {
            "symbol": symbol.upper(),
            "prediction": None,
            "error": "Market data unavailable (yfinance not installed. Run: pip install yfinance)",
            "note": "Price prediction requires yfinance for historical data.",
        }

    # Fetch historical data
    history = await provider.get_history(symbol.upper(), period=period)

    if not history or len(history) < 20:
        return {
            "symbol": symbol.upper(),
            "prediction": None,
            "error": f"Insufficient historical data ({len(history) if history else 0} records, need 20+)",
        }

    # Run prediction pipeline (Kronos -> fallback)
    result = await predict_prices(symbol.upper(), history, pred_len=pred_len)

    return {
        "symbol": symbol.upper(),
        "prediction": result,
        "model_upgrade_note": (
            "Install Kronos for ML-powered predictions: pip install torch huggingface_hub safetensors einops"
            if result.get("model_used") == "linear_regression_fallback"
            else None
        ),
    }


@router.get("/{symbol}/overview")
async def get_market_overview(symbol: str):
    """Comprehensive market overview: price, news, and context in one call.

    Combines current price, company info, recent news, and price features
    into a single response for AI advisor context.

    Args:
        symbol: Ticker symbol (e.g., AAPL).
    """
    provider = get_market_provider()

    if not provider.available:
        # Return whatever we can without yfinance
        try:
            searcher = get_searcher()
            news = await searcher.search_financial_news(symbol, max_results=3)
        except Exception:
            news = []

        return {
            "symbol": symbol.upper(),
            "price": None,
            "info": None,
            "features": None,
            "news": news,
            "note": "Install yfinance for full market data: pip install yfinance",
        }

    # Fetch all data concurrently
    searcher = get_searcher()
    price_task = asyncio.create_task(provider.get_current_price(symbol.upper()))
    info_task = asyncio.create_task(provider.get_company_info(symbol.upper()))
    history_task = asyncio.create_task(provider.get_history(symbol.upper(), period="1mo"))
    news_task = asyncio.create_task(searcher.search_financial_news(symbol, max_results=3))

    price, info, history, news = await asyncio.gather(
        price_task, info_task, history_task, news_task,
        return_exceptions=True,
    )

    # Handle individual failures
    if isinstance(price, Exception):
        logger.warning(f"Price fetch failed: {price}")
        price = None
    if isinstance(info, Exception):
        logger.warning(f"Info fetch failed: {info}")
        info = None
    if isinstance(history, Exception):
        logger.warning(f"History fetch failed: {history}")
        history = None
    if isinstance(news, Exception):
        logger.warning(f"News fetch failed: {news}")
        news = []

    features = ohlcv_to_features(history) if history and not isinstance(history, Exception) else None

    return {
        "symbol": symbol.upper(),
        "price": price,
        "info": info,
        "features": features,
        "news": news,
    }
