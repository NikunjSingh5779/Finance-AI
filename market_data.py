"""Market Data Module — real-time stock prices and fundamentals via yfinance.

Provides stock market data access using the yfinance library (free, no API
key required). Fetches real-time prices, historical OHLCV data, company
fundamentals, and more.

Pattern adapted from the xai_finance_agent's YFinanceTools integration
and the ARES KronosPredictorAgent data pipeline.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Market Data Provider
# ---------------------------------------------------------------------------

class MarketDataProvider:
    """Real-time and historical market data via yfinance.

    All methods gracefully fall back if yfinance is not installed.

    Usage:
        provider = MarketDataProvider()
        price = await provider.get_current_price("AAPL")
        history = await provider.get_history("AAPL", period="1mo")
    """

    def __init__(self) -> None:
        self._available: bool | None = None  # None = not checked yet

    @property
    def available(self) -> bool:
        """Whether yfinance is installed."""
        if self._available is None:
            try:
                import yfinance  # noqa: F401
                self._available = True
            except ImportError:
                self._available = False
        return self._available

    async def get_current_price(self, symbol: str) -> dict[str, Any] | None:
        """Get current price data for a symbol.

        Returns price, change, volume, and basic info.
        """
        if not self.available:
            return None

        try:
            import yfinance as yf

            ticker = yf.Ticker(symbol)
            data = ticker.history(period="5d")

            if data.empty:
                logger.warning(f"No price data for {symbol}")
                return None

            latest = data.iloc[-1]
            prev_close = data.iloc[-2]["Close"] if len(data) > 1 else latest["Close"]

            return {
                "symbol": symbol.upper(),
                "price": round(float(latest["Close"]), 2),
                "open": round(float(latest["Open"]), 2),
                "high": round(float(latest["High"]), 2),
                "low": round(float(latest["Low"]), 2),
                "volume": int(latest["Volume"]),
                "change": round(float(latest["Close"] - prev_close), 2),
                "change_pct": round(float((latest["Close"] - prev_close) / prev_close * 100), 2),
                "currency": "USD",
                "source": "yfinance",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

        except Exception as e:
            logger.error(f"Failed to fetch price for {symbol}: {e}")
            return None

    async def get_history(
        self,
        symbol: str,
        period: str = "1mo",
        interval: str = "1d",
    ) -> list[dict[str, Any]] | None:
        """Get historical OHLCV data.

        Args:
            symbol: Ticker symbol (e.g., AAPL, BTC-USD).
            period: Valid periods: 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, max.
            interval: Valid intervals: 1m, 2m, 5m, 15m, 30m, 60m, 1d, 5d, 1wk, 1mo.

        Returns:
            List of OHLCV dicts, or None if unavailable.
        """
        if not self.available:
            return None

        try:
            import yfinance as yf

            ticker = yf.Ticker(symbol)
            data = ticker.history(period=period, interval=interval)

            if data.empty:
                logger.warning(f"No historical data for {symbol} ({period})")
                return None

            records = []
            for idx, row in data.iterrows():
                records.append({
                    "date": idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx),
                    "open": round(float(row["Open"]), 2),
                    "high": round(float(row["High"]), 2),
                    "low": round(float(row["Low"]), 2),
                    "close": round(float(row["Close"]), 2),
                    "volume": int(row["Volume"]),
                })

            return records

        except Exception as e:
            logger.error(f"Failed to fetch history for {symbol}: {e}")
            return None

    async def get_company_info(self, symbol: str) -> dict[str, Any] | None:
        """Get company fundamentals and info."""
        if not self.available:
            return None

        try:
            import yfinance as yf

            ticker = yf.Ticker(symbol)
            info = ticker.info  # type: ignore[attr-defined]

            if not info:
                return None

            return {
                "symbol": symbol.upper(),
                "name": info.get("longName", info.get("shortName", "")),
                "sector": info.get("sector", ""),
                "industry": info.get("industry", ""),
                "market_cap": info.get("marketCap"),
                "pe_ratio": info.get("trailingPE"),
                "forward_pe": info.get("forwardPE"),
                "dividend_yield": info.get("dividendYield"),
                "beta": info.get("beta"),
                "52w_high": info.get("fiftyTwoWeekHigh"),
                "52w_low": info.get("fiftyTwoWeekLow"),
                "avg_volume": info.get("averageVolume"),
                "source": "yfinance",
            }

        except Exception as e:
            logger.error(f"Failed to fetch company info for {symbol}: {e}")
            return None

    async def search_ticker(self, query: str) -> list[dict[str, Any]]:
        """Search for ticker symbols matching a query."""
        if not self.available:
            return []

        try:
            import yfinance as yf

            results = yf.Search(query)
            quotes = getattr(results, "quotes", []) or []
            return [
                {
                    "symbol": q.get("symbol", ""),
                    "name": q.get("shortname", q.get("longname", "")),
                    "exchange": q.get("exchange", ""),
                    "type": q.get("quoteType", ""),
                }
                for q in quotes[:10]
                if q.get("symbol")
            ]

        except Exception as e:
            logger.error(f"Ticker search failed for '{query}': {e}")
            return []


# ---------------------------------------------------------------------------
# OHLCV helper (for ML prediction pipelines)
# ---------------------------------------------------------------------------

def ohlcv_to_features(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Convert OHLCV records to feature dicts for ML prediction.

    Computes simple technical indicators from price history.
    """
    if not records or len(records) < 2:
        return {"error": "Insufficient data"}

    closes = [r["close"] for r in records]
    highs = [r["high"] for r in records]
    lows = [r["low"] for r in records]
    volumes = [r.get("volume", 0) for r in records]

    # Moving averages
    sma_5 = sum(closes[-5:]) / min(5, len(closes)) if len(closes) >= 5 else None
    sma_10 = sum(closes[-10:]) / min(10, len(closes)) if len(closes) >= 10 else None
    sma_20 = sum(closes[-20:]) / min(20, len(closes)) if len(closes) >= 20 else None

    # Volatility (standard deviation of returns)
    returns = [(closes[i] - closes[i - 1]) / closes[i - 1] * 100 for i in range(1, len(closes))]
    volatility = (sum(r ** 2 for r in returns) / len(returns)) ** 0.5 if returns else 0

    # Volume trend
    avg_volume = sum(volumes) / len(volumes) if volumes else 0
    recent_volume = sum(volumes[-5:]) / min(5, len(volumes)) if len(volumes) >= 5 else avg_volume
    volume_ratio = recent_volume / avg_volume if avg_volume > 0 else 1.0

    return {
        "current_price": closes[-1],
        "price_change_1d": closes[-1] - closes[-2] if len(closes) >= 2 else 0,
        "price_change_pct_1d": (
            (closes[-1] - closes[-2]) / closes[-2] * 100
            if len(closes) >= 2 and closes[-2] > 0
            else 0
        ),
        "high_52w": max(highs) if highs else None,
        "low_52w": min(lows) if lows else None,
        "sma_5": round(sma_5, 2) if sma_5 else None,
        "sma_10": round(sma_10, 2) if sma_10 else None,
        "sma_20": round(sma_20, 2) if sma_20 else None,
        "volatility_pct": round(float(volatility), 2),
        "volume_ratio": round(float(volume_ratio), 2),
        "data_points": len(records),
    }


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_market_provider: MarketDataProvider | None = None


def get_market_provider() -> MarketDataProvider:
    """Get or create the market data provider singleton."""
    global _market_provider
    if _market_provider is None:
        _market_provider = MarketDataProvider()
    return _market_provider
