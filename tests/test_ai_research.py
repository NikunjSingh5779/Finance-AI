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


def test_market_fact_response_uses_a_clean_quote_layout():
    reply = AIService._market_fact_response(
        {
            "symbol": "GOOGL",
            "price": 280.03,
            "previous_close": 284.50,
            "change": -4.47,
            "change_pct": -1.57,
            "currency": "USD",
            "source": "Yahoo Finance",
            "quote_kind": "latest_intraday_bar",
            "market_timestamp": "2026-11-04T09:00:00+00:00",
        }
    )
    assert "**GOOGL: $280.03**" in reply
    assert "Down $4.47 (1.57%) versus the previous close of $284.50." in reply
    assert "04 Nov 2026, 02:30 PM IST" in reply
    assert reply.count("$4.47") == 1
    assert "That is a change" not in reply
    assert "Previous close was" not in reply

    jio_reply = AIService._market_fact_response(
        {
            "symbol": "JPL.NS",
            "price": 1418.0,
            "previous_close": 1437.0,
            "change": -19.0,
            "change_pct": -1.32,
            "currency": "INR",
            "source": "Yahoo Finance",
            "quote_kind": "latest_intraday_bar",
            "market_timestamp": "2026-11-04T09:00:00+00:00",
        }
    )
    assert "Jio Platforms Limited (NSE: JPL; BSE: 545004)" in jio_reply
    assert "**Jio Platforms Limited (NSE: JPL; BSE: 545004): ₹1,418.00**" in jio_reply


def test_gold_spot_response_is_india_friendly_and_not_repetitive():
    reply = AIService._market_fact_response(
        {
            "symbol": "XAU",
            "price": 200000.0,
            "price_per_10g": 64301.54,
            "currency": "INR",
            "source": "Gold API",
            "quote_kind": "spot",
            "market_timestamp": "2026-11-04T17:30:00+00:00",
        }
    )

    assert "**Gold spot (24K equivalent): ₹64,301.54 per 10 g**" in reply
    assert "₹200,000.00 per troy ounce" in reply
    assert "04 Nov 2026, 11:00 PM IST" in reply
    assert "not a local jeweller's retail rate" in reply
    assert "previous close" not in reply.lower()
    assert "GC=F" not in reply


def test_gold_currency_defaults_to_inr_but_respects_explicit_usd():
    assert AIService._market_currency("gold price") == "INR"
    assert AIService._market_currency("gold price in India") == "INR"
    assert AIService._market_currency("gold price in USD") == "USD"
    assert AIService._market_currency("gold price in dollars") == "USD"


def test_gold_questions_use_spot_feed_and_futures_questions_use_yahoo(monkeypatch):
    class FakeMarketProvider:
        def __init__(self):
            self.spot_calls = []
            self.quote_calls = []

        async def get_spot_price(self, symbol, currency="INR"):
            self.spot_calls.append((symbol, currency))
            return {"symbol": symbol, "currency": currency, "quote_kind": "spot"}

        async def get_current_price(self, symbol):
            self.quote_calls.append(symbol)
            return {"symbol": symbol, "quote_kind": "latest_intraday_bar"}

        async def get_price_on_date(self, symbol, target_date):
            return None

    provider = FakeMarketProvider()
    monkeypatch.setattr(
        "app.services.ai_service.get_market_provider",
        lambda: provider,
    )

    gold = asyncio.run(AIService()._get_market_data("what is the gold price"))
    futures = asyncio.run(AIService()._get_market_data("what is gold futures price"))

    assert gold["quote_kind"] == "spot"
    assert provider.spot_calls == [("XAU", "INR")]
    assert futures["symbol"] == "GC=F"
    assert provider.quote_calls == ["GC=F"]


def test_market_explainer_reaches_the_model_without_search(monkeypatch):
    class FakeProvider:
        def __init__(self):
            self.prompt = ""

        def generate_response(self, prompt):
            self.prompt = prompt
            return "Jio Platforms is the digital-services company behind Jio."

    class EmptyResearcher:
        async def search_and_fetch(self, query, **kwargs):
            assert "Jio" in query
            assert "listing status" in query
            return [], []

    provider = FakeProvider()
    service = AIService(provider=provider)

    async def unexpected_market_lookup(question):
        raise AssertionError("A general company explainer must not request a live quote.")

    monkeypatch.setattr(service, "_get_market_data", unexpected_market_lookup)
    monkeypatch.setattr(
        "app.services.ai_service.get_web_researcher",
        lambda: EmptyResearcher(),
    )

    reply = asyncio.run(
        service.get_financial_advice(
            "What is Jio stock?",
            financial_context={},
            conversation=[],
        )
    )

    assert "Jio Platforms" in reply
    assert "natural conversation" in provider.prompt
    assert "Do not claim listing status, a current ticker, or a price" in provider.prompt


def test_market_price_search_query_is_current_not_historical():
    assert AIService._extract_web_search_query(
        "What is Jio stock price?"
    ) == "JPL.NS stock price today latest"


def test_market_explainer_question_searches_company_listing_context():
    query = AIService._extract_web_search_query("What is Jio stock?")
    assert query is not None
    assert "Jio" in query
    assert "listing status" in query
    assert "historical stock price" not in query


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


def test_failed_gold_spot_quote_returns_clear_unavailable_message(monkeypatch):
    class FakeMarketProvider:
        async def get_spot_price(self, symbol, currency="INR"):
            assert symbol == "XAU"
            assert currency == "INR"
            return None

        async def get_current_price(self, symbol):
            raise AssertionError("Gold spot must not fall back to a futures ticker.")

        async def get_price_on_date(self, symbol, target_date):
            return None

    class UnexpectedAIProvider:
        def generate_response(self, prompt):
            raise AssertionError("A missing gold quote should not be guessed by the LLM.")

    monkeypatch.setattr(
        "app.services.ai_service.get_market_provider",
        lambda: FakeMarketProvider(),
    )

    reply = asyncio.run(
        AIService(provider=UnexpectedAIProvider()).get_financial_advice(
            "What is the gold price?",
            financial_context={},
            conversation=[],
        )
    )

    assert "couldn't retrieve a fresh international gold spot quote" in reply
    assert "won't substitute a COMEX futures contract" in reply
