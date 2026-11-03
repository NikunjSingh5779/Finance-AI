import asyncio

from app.services.ai_service import AIService


def test_web_query_normalizes_compact_date_and_stock_symbol():
    query = AIService._extract_web_search_query(
        "web search price of nvidia share on 20oct2026"
    )
    assert query == "NVDA historical stock price 2026-10-20"


def test_general_fresh_question_triggers_web_search():
    query = AIService._extract_web_search_query(
        "what is the latest RBI repo rate?"
    )
    assert query is not None
    assert "RBI repo rate" in query


def test_ipo_question_triggers_official_research():
    query = AIService._extract_web_search_query("tell me about the Jio IPO")
    assert query is not None
    assert "Jio IPO" in query
    assert "DRHP SEBI" in query


def test_non_web_personal_question_does_not_search():
    assert AIService._extract_web_search_query(
        "How much did I spend on food this month?"
    ) is None


def test_date_parser_accepts_common_formats():
    assert AIService._extract_date("price on 20/10/2026") == "2026-10-20"
    assert AIService._extract_date("price on 20 Oct 2026") == "2026-10-20"
    assert AIService._extract_date("price on 20oct2026") is None


def test_market_evidence_includes_price_change(monkeypatch):
    class FakeMarketProvider:
        async def get_current_price(self, symbol):
            assert symbol == "GOOGL"
            return {
                "symbol": symbol,
                "timestamp": "2026-11-04T09:00:00+00:00",
                "price": 280.03,
                "previous_close": 284.50,
                "change": -4.47,
                "change_pct": -1.57,
                "currency": "USD",
                "source": "test",
                "quote_kind": "latest_available_quote",
            }

        async def get_price_on_date(self, symbol, target_date):
            return None

    monkeypatch.setattr(
        "app.services.ai_service.get_market_provider",
        lambda: FakeMarketProvider(),
    )

    evidence = asyncio.run(
        AIService()._get_market_evidence("how much is google stock down today")
    )

    assert "Symbol: GOOGL" in evidence
    assert "Previous close: 284.5" in evidence
    assert "Change: -4.47" in evidence
    assert "Change %: -1.57" in evidence
