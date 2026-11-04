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
    assert AIService._query_intent("what is Jio stock") == "market_explainer"
    assert AIService._query_intent("what is Jio stock price") == "market_fact"
    assert AIService._market_symbol("what is Jio stock price", "stock") == "JPL.NS"
    assert AIService._extract_web_search_query("what is Jio stock price") == "JPL.NS stock price today latest"
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


def test_market_fact_response_uses_a_full_conversational_answer():
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
    assert "GOOGL is quoted at 280.03 USD" in reply
    assert "It is down 4.47 (1.57%) from the previous close." in reply
    assert "The previous close was 284.5 USD." in reply
    assert "change of -4.47 USD (-1.57%)" in reply
    assert "**Summary:**" not in reply

    jio_reply = AIService._market_fact_response(
        {
            "symbol": "JPL.NS",
            "price": 1418.0,
            "previous_close": 1437.0,
            "change": -19.0,
            "change_pct": -1.32,
            "currency": "INR",
            "date": "2026-11-04",
            "source": "test",
            "quote_kind": "latest_available_quote",
        }
    )
    assert "Jio Platforms Limited" in jio_reply
    assert "NSE: JPL; BSE: 545004" in jio_reply
    assert "1418.0 INR" in jio_reply


def test_market_explainer_reaches_the_model_without_search(monkeypatch):
    class FakeProvider:
        def __init__(self):
            self.prompt = ""

        def generate_response(self, prompt):
            self.prompt = prompt
            return "Jio Platforms is the digital-services company behind Jio."

    async def no_market_data(question):
        return None

    provider = FakeProvider()
    service = AIService(provider=provider)
    monkeypatch.setattr(service, "_get_market_data", no_market_data)

    reply = asyncio.run(
        service.get_financial_advice(
            "What is Jio stock?",
            financial_context={},
            conversation=[],
        )
    )

    assert "Jio Platforms" in reply
    assert "natural conversation" in provider.prompt
    assert "Do not claim it is listed or unlisted" in provider.prompt


def test_market_price_search_query_is_current_not_historical():
    assert AIService._extract_web_search_query(
        "What is Jio stock price?"
    ) == "JPL.NS stock price today latest"


def test_market_explainer_question_is_not_forced_into_web_research():
    assert AIService._extract_web_search_query("What is Jio stock?") is None

def test_duckduckgo_search_uses_google_news_rss_when_ddg_is_unavailable(monkeypatch):
    from app.providers.search.duckduckgo import DuckDuckGoSearcher, SearchResult

    searcher = DuckDuckGoSearcher()
    calls = []

    async def no_results(*args, **kwargs):
        return []

    async def rss_results(query, max_results=10):
        calls.append((query, max_results))
        return [
            SearchResult(
                "Jio Platforms IPO listing details",
                "https://example.com/jio-listing",
                "Jio Platforms listed on October 28, 2026.",
                source="google_news",
            )
        ]

    monkeypatch.setattr(searcher, "_search_library", no_results)
    monkeypatch.setattr(searcher, "_search_httpx", no_results)
    monkeypatch.setattr(searcher, "_search_google_news_rss", rss_results)

    results = asyncio.run(searcher.search("Jio Platforms IPO listing", max_results=5))

    assert len(results) == 1
    assert results[0].source == "google_news"
    assert calls == [("Jio Platforms IPO listing", 5)]


def test_google_news_rss_parser_extracts_publisher_and_date():
    from app.providers.search.duckduckgo import DuckDuckGoSearcher

    payload = b"""<?xml version="1.0" encoding="UTF-8"?>
    <rss><channel><item>
      <title>Jio Platforms IPO listing date announced</title>
      <link>https://example.com/jio-listing</link>
      <description>&lt;b&gt;Jio Platforms&lt;/b&gt; will list on October 28.</description>
      <source url="https://example.com">Example Finance</source>
      <pubDate>Wed, 28 Oct 2026 10:00:00 GMT</pubDate>
    </item></channel></rss>"""

    class FakeResponse:
        content = payload

        def raise_for_status(self):
            return None

    class FakeClient:
        async def get(self, url, *, params, timeout):
            assert url == "https://news.google.com/rss/search"
            assert params["gl"] == "IN"
            assert timeout == 8.0
            return FakeResponse()

    searcher = DuckDuckGoSearcher()
    searcher._client = FakeClient()
    results = asyncio.run(
        searcher._search_google_news_rss("Jio Platforms IPO", max_results=3)
    )

    assert len(results) == 1
    assert results[0].title == "Jio Platforms IPO listing date announced"
    assert "Example Finance" in results[0].snippet
    assert "October 28" in results[0].snippet
    assert "Wed, 28 Oct 2026" in results[0].snippet
    assert results[0].source == "google_news"
