import asyncio
import threading
from datetime import datetime, timedelta, timezone

from app.providers.market.market_data import MarketDataProvider


def test_gold_spot_fetch_uses_source_timestamp_and_caches(monkeypatch):
    import httpx

    calls = []
    payload = {
        "symbol": "XAU",
        "name": "Gold",
        "price": 200000.0,
        "currency": "INR",
        "currencySymbol": "₹",
        "exchangeRate": 83.0,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "updatedAtReadable": "a few seconds ago",
    }

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return payload

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            self.options = kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return None

        async def get(self, url):
            calls.append(url)
            return FakeResponse()

    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)
    provider = MarketDataProvider()

    async def fetch_twice():
        first = await provider.get_spot_price("XAU", "INR")
        second = await provider.get_spot_price("XAU", "INR")
        return first, second

    first, second = asyncio.run(fetch_twice())

    assert first is not None
    assert first["quote_kind"] == "spot"
    assert first["source"] == "Gold API"
    assert first["market_timestamp"] == payload["updatedAt"]
    assert first["price_per_10g"] == round(200000 * 10 / 31.1034768, 2)
    assert second == first
    assert calls == ["https://api.gold-api.com/price/XAU/INR"]


def test_gold_spot_rejects_stale_source_data(monkeypatch):
    import httpx

    payload = {
        "symbol": "XAU",
        "price": 200000.0,
        "currency": "INR",
        "updatedAt": (
            datetime.now(timezone.utc) - timedelta(minutes=10)
        ).isoformat(),
    }

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return payload

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return None

        async def get(self, url):
            return FakeResponse()

    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)
    result = asyncio.run(MarketDataProvider().get_spot_price("XAU", "INR"))

    assert result is None


def test_current_quote_runs_in_worker_thread_and_uses_short_cache(monkeypatch):
    provider = MarketDataProvider()
    provider._available = True
    main_thread = threading.get_ident()
    calls = []

    def fetch(symbol):
        calls.append((symbol, threading.get_ident()))
        return {
            "symbol": symbol,
            "price": 100.0,
            "source": "test",
            "quote_kind": "latest_intraday_bar",
        }

    monkeypatch.setattr(provider, "_get_current_price_sync", fetch)

    async def fetch_twice():
        first = await provider.get_current_price("AAPL")
        second = await provider.get_current_price("AAPL")
        return first, second

    first, second = asyncio.run(fetch_twice())

    assert first == second
    assert len(calls) == 1
    assert calls[0][0] == "AAPL"
    assert calls[0][1] != main_thread


def test_intraday_change_uses_official_daily_close_not_previous_extended_hours_bar(
    monkeypatch,
):
    import pandas as pd
    import yfinance as yf

    now = datetime.now(timezone.utc)
    today = now.date()
    previous_day = today - timedelta(days=1)
    intraday_index = pd.to_datetime(
        [
            datetime.combine(
                previous_day,
                datetime.min.time(),
                tzinfo=timezone.utc,
            ).replace(hour=21),
            now - timedelta(minutes=5),
        ],
        utc=True,
    )
    intraday = pd.DataFrame(
        {
            "Open": [104.0, 100.0],
            "High": [106.0, 102.0],
            "Low": [103.0, 99.0],
            "Close": [105.0, 101.0],
            "Volume": [1000, 2000],
        },
        index=intraday_index,
    )
    daily_index = pd.to_datetime(
        [
            datetime.combine(
                previous_day,
                datetime.min.time(),
                tzinfo=timezone.utc,
            ),
            datetime.combine(
                today,
                datetime.min.time(),
                tzinfo=timezone.utc,
            ),
        ],
        utc=True,
    )
    daily = pd.DataFrame(
        {
            "Open": [98.0, 100.0],
            "High": [100.0, 102.0],
            "Low": [97.0, 99.0],
            "Close": [99.0, 101.0],
            "Volume": [10000, 20000],
        },
        index=daily_index,
    )

    history_calls = []

    class FakeTicker:
        def history(self, period, interval, **kwargs):
            history_calls.append((interval, kwargs))
            return intraday if interval == "5m" else daily

    monkeypatch.setattr(yf, "Ticker", lambda symbol: FakeTicker())
    result = MarketDataProvider._get_current_price_sync("AAPL")

    assert result is not None
    assert result["quote_kind"] == "latest_intraday_bar"
    assert result["price"] == 101.0
    assert result["previous_close"] == 99.0
    assert result["change"] == 2.0
    assert round(result["change_pct"], 2) == 2.02
    intraday_options = next(kwargs for interval, kwargs in history_calls if interval == "5m")
    assert intraday_options["prepost"] is False



def test_gold_spot_failure_does_not_fall_back_to_comex_futures(monkeypatch):
    from app.services.ai_service import AIService

    class FakeMarketProvider:
        def __init__(self):
            self.spot_calls = []
            self.quote_calls = []

        async def get_spot_price(self, symbol, currency="INR"):
            self.spot_calls.append((symbol, currency))
            return None

        async def get_current_price(self, symbol):
            self.quote_calls.append(symbol)
            return {"symbol": symbol, "price": 123.0}

        async def get_price_on_date(self, symbol, target_date):
            return None

    provider = FakeMarketProvider()
    monkeypatch.setattr(
        "app.services.ai_service.get_market_provider",
        lambda: provider,
    )

    result = asyncio.run(AIService()._get_market_data("what is the gold price"))

    assert result is None
    assert provider.spot_calls == [("XAU", "INR")]
    assert provider.quote_calls == []
