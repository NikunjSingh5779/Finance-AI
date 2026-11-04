import asyncio

from app.providers.search.duckduckgo import SearchResult
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


def test_explanatory_stock_move_query_keeps_its_news_intent():
    query = AIService._extract_web_search_query(
        "Why did Google stock fall today?"
    )
    assert query is not None
    assert "why" in query.lower()
    assert "fall" in query.lower()
    assert "historical stock price" not in query.lower()


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


def test_query_intent_routes_common_questions():
    assert AIService._query_intent("what is the current google stock price and change") == "market_fact"
    assert AIService._query_intent("why did google stock fall today") == "market_research"
    assert AIService._query_intent("when is the Jio IPO") == "ipo_research"
    assert AIService._query_intent("how much did I spend on food") == "personal_finance"


def test_ipo_research_builds_company_specific_retry_queries():
    variants = AIService._research_query_variants(
        "When is the Jio IPO? DRHP SEBI 2026",
        "ipo_research",
    )
    assert len(variants) >= 1
    assert any("Jio Platforms Limited" in query for query in variants)
    assert any("listing date" in query.lower() for query in variants)


def test_explanatory_market_move_search_uses_one_week_window():
    assert AIService._research_timelimit(
        "Why did Google stock fall today?",
        "market_research",
    ) == "w"
    assert AIService._research_timelimit(
        "What is Google's stock price today?",
        "market_fact",
    ) == "d"
    assert AIService._research_timelimit(
        "How much did I spend on food?",
        "personal_finance",
    ) is None


def test_ipo_research_retries_a_broader_company_query(monkeypatch):
    class FakeResearcher:
        def __init__(self):
            self.queries = []

        async def search_and_fetch(self, query, **kwargs):
            self.queries.append(query)
            if len(self.queries) == 1:
                return [], []
            return [
                SearchResult(
                    "Jio Platforms Limited IPO dates",
                    "https://www.jio.com/about/investor-relations/ipo/",
                    "Jio Platforms Limited RHP and IPO timeline.",
                )
            ], []

    class FakeProvider:
        def generate_response(self, prompt):
            assert "Jio Platforms Limited IPO dates" in prompt
            return "The relevant filing confirms the IPO schedule."

    researcher = FakeResearcher()
    monkeypatch.setattr(
        "app.services.ai_service.get_web_researcher",
        lambda: researcher,
    )

    reply = asyncio.run(
        AIService(provider=FakeProvider()).get_financial_advice(
            "When is the Jio IPO?",
            financial_context={},
            conversation=[],
        )
    )

    assert len(researcher.queries) == 2
    assert "Jio Platforms Limited" in researcher.queries[1]
    assert "Sources" in reply


def test_market_fact_response_is_deterministic():
    reply = AIService._market_fact_response(
        {
            "symbol": "GOOGL",
            "price": 280.03,
            "previous_close": 284.50,
            "change": -4.47,
            "change_pct": -1.57,
            "currency": "USD",
            "date": "2026-11-04",
            "source": "test",
            "quote_kind": "latest_available_quote",
        }
    )
    assert "GOOGL is 280.03 USD" in reply
    assert "down 4.47 (1.57%)" in reply
    assert "Change: -4.47 USD (-1.57%)." in reply
