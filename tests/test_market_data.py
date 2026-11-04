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
    assert calls == [("AAPL", calls[0][1])]
    assert calls[0][1] != main_thread
