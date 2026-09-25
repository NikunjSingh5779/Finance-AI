"""Web Search Module — financial news and market data via DuckDuckGo.

Provides web search capabilities for financial news aggregation, company
research, and macroeconomic data collection. Uses DuckDuckGo's search API
(free, no API key required) with automatic fallback.

Pattern adapted from ARES backend/data/sources/web_search.py and the
xai_finance_agent's DuckDuckGoTools integration.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)

DEFAULT_TIMEOUT = 15  # seconds


# ---------------------------------------------------------------------------
# Search Result Model
# ---------------------------------------------------------------------------

class SearchResult:
    """A single web search result."""

    def __init__(
        self,
        title: str,
        url: str,
        snippet: str,
        source: str = "duckduckgo",
    ) -> None:
        self.title = title
        self.url = url
        self.snippet = snippet
        self.source = source

    def to_dict(self) -> dict[str, str]:
        return {
            "title": self.title,
            "url": self.url,
            "snippet": self.snippet,
            "source": self.source,
        }


# ---------------------------------------------------------------------------
# DuckDuckGo Web Search
# ---------------------------------------------------------------------------

class DuckDuckGoSearcher:
    """Financial web search via DuckDuckGo.

    Free, no API key required. Wraps the duckduckgo_search library
    (duckduckgo-search on PyPI) with a fallback to raw HTTP requests
    if the library is not installed.
    """

    def __init__(self) -> None:
        self._client: Any = None
        self._use_library: bool | None = None  # None = not checked yet

    async def _ensure_client(self) -> Any:
        if self._client is None:
            import httpx
            self._client = httpx.AsyncClient(
                timeout=DEFAULT_TIMEOUT,
                headers={"User-Agent": USER_AGENT},
                follow_redirects=True,
            )
        return self._client

    async def search(
        self,
        query: str,
        max_results: int = 10,
        region: str = "wt-wt",
    ) -> list[SearchResult]:
        """Search the web via DuckDuckGo.

        Args:
            query: Search query (e.g., "AAPL earnings Q4 2026").
            max_results: Maximum results to return.
            region: Region code (wt-wt = worldwide, us-en = US).

        Returns:
            List of SearchResult objects.
        """
        # Try library first (duckduckgo-search package)
        results = await self._search_library(query, max_results, region)
        if results:
            logger.debug("DuckDuckGo search via library", extra={"query": query, "results": len(results)})
            return results

        # Fallback: httpx-based scraping
        results = await self._search_httpx(query, max_results)
        if results:
            logger.debug("DuckDuckGo search via httpx fallback", extra={"query": query, "results": len(results)})
            return results

        logger.warning("DuckDuckGo search returned no results", extra={"query": query})
        return []

    async def _search_library(
        self,
        query: str,
        max_results: int = 10,
        region: str = "wt-wt",
    ) -> list[SearchResult]:
        """Search using the duckduckgo_search library."""
        if self._use_library is False:
            return []

        try:
            from duckduckgo_search import DDGS

            results: list[SearchResult] = []
            with DDGS() as ddgs:
                for i, r in enumerate(ddgs.text(query, region=region, max_results=max_results)):
                    if i >= max_results:
                        break
                    results.append(
                        SearchResult(
                            title=r.get("title", ""),
                            url=r.get("href", r.get("link", "")),
                            snippet=r.get("body", r.get("snippet", "")),
                            source="duckduckgo",
                        )
                    )
            self._use_library = True
            return results

        except ImportError:
            self._use_library = False
            logger.debug("duckduckgo_search library not installed, using httpx fallback")
            return []

        except Exception as e:
            self._use_library = False
            logger.warning(f"DuckDuckGo library search failed: {e}, using httpx fallback")
            return []

    async def _search_httpx(
        self,
        query: str,
        max_results: int = 10,
    ) -> list[SearchResult]:
        """Fallback search using direct HTTP requests to DuckDuckGo's HTML API."""
        try:
            from html.parser import HTMLParser

            client = await self._ensure_client()
            url = "https://html.duckduckgo.com/html/"
            resp = await client.post(url, data={"q": query})
            resp.raise_for_status()

            class DDGParser(HTMLParser):
                def __init__(self) -> None:
                    super().__init__()
                    self.results: list[SearchResult] = []
                    self._current: dict[str, str] | None = None

                def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
                    attrs_dict = dict(attrs)
                    if tag == "a" and attrs_dict.get("class") == "result__a":
                        self._current = {"title": "", "url": attrs_dict.get("href", ""), "snippet": ""}

                def handle_data(self, data: str) -> None:
                    if self._current is not None:
                        self._current["title"] += data

                def handle_endtag(self, tag: str) -> None:
                    if tag == "a" and self._current is not None:
                        title = self._current.get("title", "").strip()
                        if title:
                            self.results.append(
                                SearchResult(
                                    title=title,
                                    url=self._current.get("url", ""),
                                    snippet=self._current.get("snippet", "").strip(),
                                    source="duckduckgo",
                                )
                            )
                        self._current = None

            parser = DDGParser()
            parser.feed(resp.text)
            return parser.results[:max_results]

        except Exception as e:
            logger.error(f"DuckDuckGo httpx fallback failed: {e}")
            return []

    # ------------------------------------------------------------------
    # Financial search helpers
    # ------------------------------------------------------------------

    async def search_financial_news(
        self,
        symbol: str,
        max_results: int = 5,
    ) -> list[dict[str, str]]:
        """Search for financial news about a specific symbol/ticker."""
        query = f"{symbol} stock market news {datetime.now().year}"
        results = await self.search(query, max_results=max_results)
        return [r.to_dict() for r in results]

    async def search_company_info(
        self,
        company_name: str,
        max_results: int = 5,
    ) -> list[dict[str, str]]:
        """Search for company fundamentals and background."""
        query = f"{company_name} company overview financials fundamentals"
        results = await self.search(query, max_results=max_results)
        return [r.to_dict() for r in results]

    async def search_macro_economic(
        self,
        topic: str,
        max_results: int = 5,
    ) -> list[dict[str, str]]:
        """Search for macroeconomic data or trends."""
        query = f"{topic} economic data {datetime.now().year}"
        results = await self.search(query, max_results=max_results)
        return [r.to_dict() for r in results]

    async def search_market_context(
        self,
        symbol: str,
        max_news: int = 5,
    ) -> dict[str, Any]:
        """Comprehensive market context for a symbol.

        Returns news, company info, and macro context in one call.
        """
        news = await self.search_financial_news(symbol, max_results=max_news)

        # Extract company name from symbol (simple heuristic)
        base = symbol.split("-")[0] if "-" in symbol else symbol.split(".")[0]
        company = await self.search_company_info(base, max_results=3)

        return {
            "symbol": symbol,
            "news": news,
            "company_context": company,
            "source": "duckduckgo",
        }

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_searcher: DuckDuckGoSearcher | None = None


def get_searcher() -> DuckDuckGoSearcher:
    """Get or create the DuckDuckGo searcher singleton."""
    global _searcher
    if _searcher is None:
        _searcher = DuckDuckGoSearcher()
    return _searcher
