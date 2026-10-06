"""HTTP controller for market-data functionality."""

import logging

from fastapi import APIRouter, HTTPException, Query

from app.services.market_service import MarketService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/market", tags=["market"])


def _service() -> MarketService:
    return MarketService()


def _provider_error(exc: Exception) -> HTTPException:
    return HTTPException(status_code=503, detail=str(exc))


@router.get("/search")
async def search_ticker(
    q: str = Query(..., min_length=1, max_length=100),
):
    try:
        results = await _service().search_ticker(q)
        return {"query": q, "results": results}
    except RuntimeError as exc:
        raise _provider_error(exc) from exc
    except Exception as exc:
        logger.exception("Ticker search failed")
        raise HTTPException(503, "Market search is temporarily unavailable") from exc


@router.get("/{symbol}")
async def get_market_data(symbol: str):
    try:
        return await _service().current_price(symbol)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except RuntimeError as exc:
        raise _provider_error(exc) from exc


@router.get("/{symbol}/history")
async def get_market_history(
    symbol: str,
    period: str = Query("1mo"),
    interval: str = Query("1d"),
):
    try:
        return await _service().history(symbol, period=period, interval=interval)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except RuntimeError as exc:
        raise _provider_error(exc) from exc


@router.get("/{symbol}/info")
async def get_company_info(symbol: str):
    try:
        return await _service().company_info(symbol)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except RuntimeError as exc:
        raise _provider_error(exc) from exc


@router.get("/{symbol}/news")
async def get_market_news(
    symbol: str,
    max_results: int = Query(5, ge=1, le=20),
):
    try:
        return await _service().news(symbol, max_results=max_results)
    except Exception as exc:
        logger.exception("Market news failed")
        return {
            "symbol": symbol.upper(),
            "news": [],
            "count": 0,
            "error": "News search is temporarily unavailable",
        }


@router.get("/{symbol}/predict")
async def get_market_prediction(
    symbol: str,
    period: str = Query("3mo"),
    pred_len: int = Query(10, ge=5, le=60),
):
    try:
        return await _service().prediction(
            symbol, period=period, pred_len=pred_len
        )
    except LookupError as exc:
        raise HTTPException(422, str(exc)) from exc
    except RuntimeError as exc:
        raise _provider_error(exc) from exc


@router.get("/{symbol}/overview")
async def get_market_overview(symbol: str):
    return await _service().overview(symbol)
