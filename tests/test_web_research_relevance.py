import asyncio

from app.providers.search.duckduckgo import SearchResult
from app.services.web_research_service import (
    WebPage,
    WebResearchService,
    _is_relevant_text,
    _query_core_tokens,
)


def test_jio_ipo_filter_rejects_unrelated_windows_and_xbox_results():
    assert not _is_relevant_text(
        "Jio IPO DRHP SEBI 2026",
        "Use an eSIM to get a cellular data connection on your Windows PC",
        "Windows cellular settings, Xbox controller support and Wi-Fi setup.",
        "https://support.microsoft.com/windows/cellular-settings",
    )


def test_jio_ipo_filter_accepts_matching_company_and_topic():
    assert _is_relevant_text(
        "Jio IPO DRHP SEBI 2026",
        "Reliance Jio IPO: company files draft prospectus",
        "The Jio public issue and listing plan are discussed in the filing.",
        "https://www.example-finance-news.com/jio-ipo",
    )


def test_ipo_relevance_accepts_company_rhp_terminology():
    assert _is_relevant_text(
        "When is Jio IPO?",
        "Jio Platforms Limited — RHP",
        "Jio Platforms Limited.",
        "https://www.jio.com/about/investor-relations/ipo/",
    )


def test_ipo_relevance_rejects_a_different_issuer():
    assert not _is_relevant_text(
        "When is Jio IPO?",
        "Example Industries initial public offer",
        "The prospectus and listing dates for Example Industries.",
        "https://www.example.com/example-ipo",
    )


def test_query_core_tokens_ignore_year_and_ipo_vocabulary():
    assert _query_core_tokens("When is Jio IPO 2026?") == {"jio"}


def test_general_research_requires_the_named_entity():
    assert not _is_relevant_text(
        "latest RBI repo rate November 2026",
        "Xbox wireless controller update and repair",
        "Microsoft support information for Xbox controller firmware.",
        "https://support.xbox.com/controller/update",
    )
    assert _is_relevant_text(
        "latest RBI repo rate November 2026",
        "RBI repo rate decision and policy announcement",
        "The Reserve Bank of India repo rate decision.",
        "https://www.example-finance-news.com/rbi-repo-rate",
    )


def test_search_and_fetch_only_returns_relevant_results():
    class FakeSearcher:
        async def search(self, query, max_results=10, region="wt-wt", timelimit=None):
            return [
                SearchResult(
                    "Windows cellular settings",
                    "https://support.microsoft.com/windows/cellular-settings",
                    "Use an eSIM and adjust cellular settings in Windows.",
                ),
                SearchResult(
                    "Reliance Jio IPO filing",
                    "https://www.example-finance-news.com/jio-ipo",
                    "Reliance Jio IPO and draft prospectus filing details.",
                ),
            ]

    async def run():
        service = WebResearchService(searcher=FakeSearcher())

        async def no_page(url, title=""):
            return None

        service.fetch = no_page
        return await service.search_and_fetch(
            "Jio IPO DRHP SEBI 2026",
            max_results=5,
            fetch_count=2,
        )

    results, pages = asyncio.run(run())

    assert len(results) == 1
    assert "jio-ipo" in results[0].url
    assert pages == []


def test_fetched_page_with_unrelated_content_is_not_cited():
    class FakeSearcher:
        async def search(self, query, max_results=10, region="wt-wt", timelimit=None):
            return [
                SearchResult(
                    "Reliance Jio IPO filing",
                    "https://www.example-finance-news.com/jio-ipo",
                    "Reliance Jio IPO and draft prospectus filing details.",
                )
            ]

    async def run():
        service = WebResearchService(searcher=FakeSearcher())

        async def wrong_page(url, title=""):
            return WebPage(
                "Windows cellular settings",
                url,
                "Windows support guide about cellular settings and Xbox devices.",
                "test",
            )

        service.fetch = wrong_page
        return await service.search_and_fetch(
            "Jio IPO DRHP SEBI 2026",
            max_results=5,
            fetch_count=1,
        )

    results, pages = asyncio.run(run())

    assert results == []
    assert pages == []


def test_search_and_fetch_uses_rss_when_duckduckgo_results_are_unrelated():
    class FakeSearcher:
        async def search(self, query, max_results=10, region="wt-wt", timelimit=None):
            return [
                SearchResult(
                    "Graphics cards and AI accelerators",
                    "https://www.example.com/gpu-news",
                    "A product update about GPUs and accelerators.",
                )
            ]

        async def _search_google_news_rss(self, query, max_results=10):
            return [
                SearchResult(
                    "Anthropic prices its initial public offering",
                    "https://www.anthropic.com/news/anthropic-prices-initial-public-offering",
                    "Anthropic PBC priced its initial public offering. "
                    "The shares are expected to trade on Nasdaq under ticker ANT.",
                    source="google_news",
                )
            ]

        async def _search_bing_news_rss(self, query, max_results=10):
            return []

    async def run():
        service = WebResearchService(searcher=FakeSearcher())

        async def no_page(url, title=""):
            return None

        service.fetch = no_page
        return await service.search_and_fetch(
            "Anthropic IPO official announcement SEC S-1 prospectus listing date",
            max_results=8,
            fetch_count=2,
        )

    results, pages = asyncio.run(run())

    assert len(results) == 1
    assert "anthropic.com" in results[0].url
    assert results[0].source == "google_news"
    assert pages == []
