"""Market Data Module — real-time stock prices and fundamentals via yfinance.

Provides stock market data access using the yfinance library (free, no API
key required). Fetches real-time prices, historical OHLCV data, company
fundamentals, and more.

Pattern adapted from the xai_finance_agent's YFinanceTools integration
and the ARES KronosPredictorAgent data pipeline.
"""

from __future__ import annotations

import asyncio
import logging
import math
import re
import time
from datetime import date, datetime, timedelta, timezone
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
        self._price_cache: dict[str, tuple[float, dict[str, Any]]] = {}

    def _cached_price(self, key: str, ttl_seconds: float) -> dict[str, Any] | None:
        cached = self._price_cache.get(key)
        if cached and time.monotonic() - cached[0] < ttl_seconds:
            return dict(cached[1])
        return None

    def _store_price(self, key: str, value: dict[str, Any]) -> dict[str, Any]:
        self._price_cache[key] = (time.monotonic(), dict(value))
        return dict(value)

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

    async def get_spot_price(
        self,
        symbol: str = "XAU",
        currency: str = "INR",
    ) -> dict[str, Any] | None:
        """Fetch a keyless precious-metal spot quote with its source timestamp.

        Gold API refreshes its live price about every 30 seconds. Cache just
        under that interval and reject timestamps older than five minutes.
        Values for metals are quoted per troy ounce.
        """
        import httpx

        symbol = symbol.upper().strip()
        currency = currency.upper().strip()
        if symbol not in {"XAU", "XAG", "XPT", "XPD"}:
            return None
        if not re.fullmatch(r"[A-Z]{3}", currency):
            return None

        cache_key = f"spot:{symbol}:{currency}"
        cached = self._cached_price(cache_key, 25.0)
        if cached:
            return cached

        url = f"https://api.gold-api.com/price/{symbol}/{currency}"
        try:
            timeout = httpx.Timeout(4.5, connect=2.0)
            async with httpx.AsyncClient(
                timeout=timeout,
                follow_redirects=True,
                headers={"User-Agent": "FinanceAI/2.2 (+market-data)"},
            ) as client:
                response = await client.get(url)
                response.raise_for_status()
                payload = response.json()

            if not isinstance(payload, dict):
                return None
            price = float(payload.get("price") or 0)
            updated_raw = payload.get("updatedAt") or payload.get("updated_at")
            response_symbol = str(payload.get("symbol") or symbol).upper()
            if (
                not math.isfinite(price)
                or price <= 0
                or not updated_raw
                or response_symbol != symbol
            ):
                return None

            updated_at = datetime.fromisoformat(
                str(updated_raw).replace("Z", "+00:00")
            )
            if updated_at.tzinfo is None:
                updated_at = updated_at.replace(tzinfo=timezone.utc)
            updated_at = updated_at.astimezone(timezone.utc)
            age_seconds = max(
                0.0,
                (datetime.now(timezone.utc) - updated_at).total_seconds(),
            )
            if age_seconds > 300:
                logger.warning(
                    "Rejecting stale %s spot price (%s seconds old)",
                    symbol,
                    int(age_seconds),
                )
                return None

            quote_currency = str(payload.get("currency") or currency).upper()
            result = {
                "symbol": symbol,
                "name": payload.get("name") or {
                    "XAU": "Gold",
                    "XAG": "Silver",
                    "XPT": "Platinum",
                    "XPD": "Palladium",
                }.get(symbol, symbol),
                "price": round(price, 4),
                "currency": quote_currency,
                "currency_symbol": payload.get("currencySymbol"),
                "exchange_rate": payload.get("exchangeRate"),
                "source": "Gold API",
                "quote_kind": "spot",
                "unit": "troy_ounce",
                "market_timestamp": updated_at.isoformat(),
                "updated_at": updated_at.isoformat(),
                "updated_at_readable": payload.get("updatedAtReadable"),
                "freshness_seconds": int(age_seconds),
            }
            if symbol == "XAU":
                result["price_per_10g"] = round(
                    price * 10 / 31.1034768,
                    2,
                )
            return self._store_price(cache_key, result)
        except (httpx.HTTPError, ValueError, TypeError, KeyError) as exc:
            logger.warning("Spot price lookup failed for %s/%s: %s", symbol, currency, exc)
            return None

    async def get_current_price(self, symbol: str) -> dict[str, Any] | None:
        """Get a timestamped recent quote, falling back to the latest daily close.

        Yahoo Finance intraday bars are not guaranteed to be exchange real-time.
        Their actual bar timestamp is preserved, and old bars are never labelled
        as current prices.
        """
        symbol = symbol.upper().strip()
        if not self.available:
            return None

        cache_key = f"quote:{symbol}"
        cached = self._cached_price(cache_key, 10.0)
        if cached:
            return cached

        try:
            result = await asyncio.wait_for(
                asyncio.to_thread(self._get_current_price_sync, symbol),
                timeout=14.0,
            )
        except asyncio.TimeoutError:
            logger.warning("Market quote lookup timed out for %s", symbol)
            return None
        except Exception as exc:
            logger.error("Failed to fetch price for %s: %s", symbol, exc)
            return None

        return self._store_price(cache_key, result) if result else None

    @staticmethod
    def _get_current_price_sync(symbol: str) -> dict[str, Any] | None:
        """Blocking yfinance work, intended to run in a worker thread."""
        import yfinance as yf

        ticker = yf.Ticker(symbol)
        intraday = None
        try:
            intraday = ticker.history(
                period="5d",
                interval="5m",
                prepost=False,
                auto_adjust=False,
                timeout=6,
            )
        except Exception as exc:
            logger.debug("Intraday quote unavailable for %s: %s", symbol, exc)

        now = datetime.now(timezone.utc)
        daily = None
        if intraday is not None and not intraday.empty:
            latest = intraday.iloc[-1]
            raw_index = intraday.index[-1]
            market_time = (
                raw_index.to_pydatetime()
                if hasattr(raw_index, "to_pydatetime")
                else raw_index
            )
            session_date = (
                raw_index.date()
                if hasattr(raw_index, "date")
                else date.fromisoformat(str(raw_index)[:10])
            )
            if market_time.tzinfo is None:
                market_time = market_time.replace(tzinfo=timezone.utc)
            market_time = market_time.astimezone(timezone.utc)
            raw_age_seconds = (now - market_time).total_seconds()
            age_seconds = max(0.0, raw_age_seconds)

            if (
                raw_age_seconds >= -120
                and age_seconds <= 20 * 60
                and math.isfinite(float(latest["Close"]))
                and float(latest["Close"]) > 0
            ):
                latest_date = session_date
                try:
                    daily = ticker.history(
                        period="5d",
                        interval="1d",
                        auto_adjust=False,
                        timeout=6,
                    )
                except Exception as exc:
                    logger.debug(
                        "Previous daily close unavailable for %s: %s",
                        symbol,
                        exc,
                    )
                    daily = None

                previous_close = None
                if daily is not None and not daily.empty:
                    for index, row in daily.iterrows():
                        daily_date = (
                            index.date()
                            if hasattr(index, "date")
                            else date.fromisoformat(str(index)[:10])
                        )
                        if daily_date < latest_date:
                            candidate = float(row["Close"])
                            if math.isfinite(candidate) and candidate > 0:
                                previous_close = candidate
                price = float(latest["Close"])
                change = (
                    price - previous_close
                    if previous_close is not None
                    else None
                )
                change_pct = (
                    change / previous_close * 100
                    if change is not None and previous_close
                    else None
                )
                return {
                    "symbol": symbol,
                    "price": round(price, 4),
                    "last_daily_close": (
                        round(previous_close, 4)
                        if previous_close is not None
                        else None
                    ),
                    "previous_close": (
                        round(previous_close, 4)
                        if previous_close is not None
                        else None
                    ),
                    "open": round(float(latest["Open"]), 4),
                    "high": round(float(latest["High"]), 4),
                    "low": round(float(latest["Low"]), 4),
                    "volume": int(latest["Volume"]),
                    "change": round(change, 4) if change is not None else None,
                    "change_pct": round(change_pct, 4) if change_pct is not None else None,
                    "currency": (
                        "INR"
                        if symbol.endswith((".NS", ".BO"))
                        else "USD"
                    ),
                    "source": "Yahoo Finance",
                    "quote_kind": "latest_intraday_bar",
                    "market_timestamp": market_time.isoformat(),
                    "timestamp": market_time.isoformat(),
                    "freshness_seconds": int(age_seconds),
                }

        # If the intraday feed is closed or stale, report a dated daily close.
        if daily is None:
            try:
                daily = ticker.history(
                    period="5d",
                    interval="1d",
                    auto_adjust=False,
                    timeout=6,
                )
            except Exception as exc:
                logger.debug(
                    "Daily-close fallback unavailable for %s: %s",
                    symbol,
                    exc,
                )
                daily = None

        if daily is None or daily.empty:
            return None

        latest = daily.iloc[-1]
        previous_close = (
            float(daily.iloc[-2]["Close"])
            if len(daily) > 1
            else None
        )
        price = float(latest["Close"])
        if not math.isfinite(price) or price <= 0:
            return None
        change = price - previous_close if previous_close is not None else None
        change_pct = (
            change / previous_close * 100
            if change is not None and previous_close
            else None
        )
        raw_index = daily.index[-1]
        market_date = (
            raw_index.date()
            if hasattr(raw_index, "date")
            else date.fromisoformat(str(raw_index)[:10])
        )
        return {
            "symbol": symbol,
            "price": round(price, 4),
            "last_daily_close": round(price, 4),
            "previous_close": (
                round(previous_close, 4)
                if previous_close is not None
                else None
            ),
            "open": round(float(latest["Open"]), 4),
            "high": round(float(latest["High"]), 4),
            "low": round(float(latest["Low"]), 4),
            "volume": int(latest["Volume"]),
            "change": round(change, 4) if change is not None else None,
            "change_pct": round(change_pct, 4) if change_pct is not None else None,
            "currency": "INR" if symbol.endswith((".NS", ".BO")) else "USD",
            "source": "Yahoo Finance",
            "quote_kind": "latest_daily_close",
            "date": market_date.isoformat(),
            "market_timestamp": market_date.isoformat(),
            "timestamp": market_date.isoformat(),
        }

    async def get_price_on_date(
        self,
        symbol: str,
        target_date: str,
    ) -> dict[str, Any] | None:
        """Get the exact daily OHLCV record for an ISO calendar date."""
        if not self.available:
            return None

        try:
            import yfinance as yf

            target = date.fromisoformat(target_date)
            start = target - timedelta(days=7)
            end = target + timedelta(days=2)
            data = yf.Ticker(symbol).history(
                start=start.isoformat(),
                end=end.isoformat(),
                interval="1d",
            )

            if data.empty:
                return None

            wanted = None
            previous_close = None
            for idx, row in data.iterrows():
                row_date = (
                    idx.date().isoformat()
                    if hasattr(idx, "date")
                    else str(idx)[:10]
                )
                if row_date < target.isoformat():
                    previous_close = float(row["Close"])
                    continue
                if row_date == target.isoformat():
                    wanted = row
                    break

            if wanted is None:
                return None

            close = float(wanted["Close"])
            change = close - previous_close if previous_close is not None else None
            change_pct = (
                change / previous_close * 100
                if change is not None and previous_close
                else None
            )

            return {
                "symbol": symbol.upper(),
                "date": target.isoformat(),
                "open": round(float(wanted["Open"]), 2),
                "high": round(float(wanted["High"]), 2),
                "low": round(float(wanted["Low"]), 2),
                "close": round(close, 2),
                "previous_close": round(previous_close, 2) if previous_close is not None else None,
                "change": round(change, 2) if change is not None else None,
                "change_pct": round(change_pct, 2) if change_pct is not None else None,
                "volume": int(wanted["Volume"]),
                "currency": "INR" if symbol.upper().endswith((".NS", ".BO")) else "USD",
                "source": "yfinance",
                "quote_kind": "historical_daily_close",
            }
        except Exception as exc:
            logger.error("Failed to fetch %s price for %s: %s", symbol, target_date, exc)
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
    returns = []
    for i in range(1, len(closes)):
        previous = closes[i - 1]
        if previous:
            returns.append((closes[i] - previous) / previous * 100)
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
