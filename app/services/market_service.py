"""Application service for market data, news, and predictions."""

import asyncio
from typing import Any

from app.providers.market.market_data import MarketDataProvider
from app.providers.market.market_predictor import predict_prices
from app.utils.web_search import get_searcher


class MarketService:
    """Orchestrate external market providers without leaking them into controllers."""

    def __init__(
        self,
        market_provider: MarketDataProvider | None = None,
        searcher: Any | None = None,
    ):
        self.market = market_provider
        self.searcher = searcher

    def _market_provider(self) -> MarketDataProvider:
        if self.market is None:
            from app.providers.market.market_data import get_market_provider

            self.market = get_market_provider()
        return self.market

    def _searcher(self):
        if self.searcher is None:
            self.searcher = get_searcher()
        return self.searcher

    async def search_ticker(self, query: str) -> list[dict[str, Any]]:
        provider = self._market_provider()
        if not provider.available:
            raise RuntimeError("Market data provider is unavailable")
        return await provider.search_ticker(query)

    async def current_price(self, symbol: str) -> dict[str, Any]:
        provider = self._market_provider()
        if not provider.available:
            raise RuntimeError("Market data provider is unavailable")
        result = await provider.get_current_price(symbol.upper())
        if result is None:
            raise LookupError(f"No market data found for {symbol.upper()}")
        return result

    async def history(
        self,
        symbol: str,
        period: str = "1mo",
        interval: str = "1d",
    ) -> dict[str, Any]:
        provider = self._market_provider()
        if not provider.available:
            raise RuntimeError("Market data provider is unavailable")
        records = await provider.get_history(
            symbol.upper(), period=period, interval=interval
        )
        if records is None:
            raise LookupError(f"No historical data for {symbol.upper()}")

        from app.providers.market.market_data import ohlcv_to_features

        return {
            "symbol": symbol.upper(),
            "period": period,
            "interval": interval,
            "data_points": len(records),
            "records": records,
            "features": ohlcv_to_features(records),
        }

    async def company_info(self, symbol: str) -> dict[str, Any]:
        provider = self._market_provider()
        if not provider.available:
            raise RuntimeError("Market data provider is unavailable")
        result = await provider.get_company_info(symbol.upper())
        if result is None:
            raise LookupError(f"No company info found for {symbol.upper()}")
        return result

    async def news(self, symbol: str, max_results: int = 5) -> dict[str, Any]:
        results = await self._searcher().search_financial_news(
            symbol, max_results=max_results
        )
        return {"symbol": symbol.upper(), "news": results, "count": len(results)}

    async def prediction(
        self,
        symbol: str,
        period: str = "3mo",
        pred_len: int = 10,
    ) -> dict[str, Any]:
        provider = self._market_provider()
        if not provider.available:
            raise RuntimeError("Market data provider is unavailable")

        history = await provider.get_history(symbol.upper(), period=period)
        if not history or len(history) < 20:
            raise LookupError(
                f"Insufficient historical data ({len(history) if history else 0} records, need 20+)"
            )

        prediction = await predict_prices(
            symbol.upper(), history, pred_len=pred_len
        )
        return {
            "symbol": symbol.upper(),
            "prediction": prediction,
            "is_estimate": True,
            "warning": "Market forecasts are estimates, not guarantees or investment advice.",
        }

    async def overview(self, symbol: str) -> dict[str, Any]:
        provider = self._market_provider()
        searcher = self._searcher()

        if not provider.available:
            try:
                news = await searcher.search_financial_news(symbol, max_results=3)
            except Exception:
                news = []
            return {
                "symbol": symbol.upper(),
                "price": None,
                "info": None,
                "features": None,
                "news": news,
                "note": "Install yfinance for full market data.",
            }

        price_task = asyncio.create_task(provider.get_current_price(symbol.upper()))
        info_task = asyncio.create_task(provider.get_company_info(symbol.upper()))
        history_task = asyncio.create_task(provider.get_history(symbol.upper(), period="1mo"))
        news_task = asyncio.create_task(
            searcher.search_financial_news(symbol, max_results=3)
        )

        price, info, history, news = await asyncio.gather(
            price_task, info_task, history_task, news_task,
            return_exceptions=True,
        )

        from app.providers.market.market_data import ohlcv_to_features

        if isinstance(price, Exception):
            price = None
        if isinstance(info, Exception):
            info = None
        if isinstance(history, Exception):
            history = None
        if isinstance(news, Exception):
            news = []

        return {
            "symbol": symbol.upper(),
            "price": price,
            "info": info,
            "features": ohlcv_to_features(history) if history else None,
            "news": news,
        }
