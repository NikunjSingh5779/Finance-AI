"""Web Search Module — financial news and market data via DuckDuckGo.

Provides web search capabilities for financial news aggregation, company
research, and macroeconomic data collection. Uses DuckDuckGo's search API
(free, no API key required) with automatic fallback.

Pattern adapted from ARES backend/data/sources/web_search.py and the
xai_finance_agent's DuckDuckGoTools integration.
"""

from __future__ import annotations

import asyncio
import html
import logging
import re
from datetime import datetime
from typing import Any
from urllib.parse import parse_qs, urlsplit
from xml.etree import ElementTree

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
        timelimit: str | None = None,
    ) -> list[SearchResult]:
        """Search the web via DuckDuckGo.

        Args:
            query: Search query (e.g., "AAPL earnings Q4 2026").
            max_results: Maximum results to return.
            region: Region code (wt-wt = worldwide, us-en = US).

        Returns:
            List of SearchResult objects.
        """
        # Keep total search latency bounded on hosted backends. DDGS can stall
        # on challenged endpoints, so move on quickly to independent feeds.
        try:
            results = await asyncio.wait_for(
                self._search_library(query, max_results, region, timelimit),
                timeout=5.5,
            )
        except asyncio.TimeoutError:
            logger.warning("DDGS search timed out; trying HTTP fallback")
            results = []
        if results:
            logger.debug("DuckDuckGo search via library", extra={"query": query, "results": len(results)})
            return results

        try:
            results = await asyncio.wait_for(
                self._search_httpx(query, max_results),
                timeout=5.0,
            )
        except asyncio.TimeoutError:
            logger.warning("DuckDuckGo HTTP fallback timed out")
            results = []
        if results:
            logger.debug("DuckDuckGo search via httpx fallback", extra={"query": query, "results": len(results)})
            return results

        # Public RSS feeds do not require API keys. Run both independently so
        # one provider outage does not delay or suppress the other.
        google_results, bing_results = await asyncio.gather(
            self._search_google_news_rss(query, max_results),
            self._search_bing_news_rss(query, max_results),
            return_exceptions=True,
        )
        combined: list[SearchResult] = []
        seen: set[str] = set()
        for batch in (google_results, bing_results):
            if isinstance(batch, Exception):
                logger.warning("RSS search fallback failed: %s", batch)
                continue
            for item in batch:
                key = item.url.strip().lower()
                if key and key not in seen:
                    seen.add(key)
                    combined.append(item)
                if len(combined) >= max_results:
                    break
            if len(combined) >= max_results:
                break

        if combined:
            logger.info(
                "News RSS fallback returned results",
                extra={"query": query, "results": len(combined)},
            )
            return combined

        logger.warning(
            "DuckDuckGo, Google News and Bing News returned no results",
            extra={"query": query},
        )
        return []

    async def _search_library(
        self,
        query: str,
        max_results: int = 10,
        region: str = "wt-wt",
        timelimit: str | None = None,
    ) -> list[SearchResult]:
        """Search using the maintained ddgs library."""
        if self._use_library is False:
            return []

        try:
            from ddgs import DDGS

            def run_search() -> list[dict[str, Any]]:
                searcher = DDGS(timeout=6)
                return list(
                    searcher.text(
                        query,
                        region=region,
                        timelimit=timelimit,
                        max_results=max_results,
                    )
                )

            raw_results = await asyncio.to_thread(run_search)
            results: list[SearchResult] = []
            for i, r in enumerate(raw_results):
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
            logger.debug("ddgs library not installed, using httpx fallback")
            return []

        except Exception as e:
            logger.warning(f"DDGS search failed: {e}, using httpx fallback")
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
            resp = await client.post(url, data={"q": query}, timeout=5.0)
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

    async def _search_google_news_rss(
        self,
        query: str,
        max_results: int = 10,
    ) -> list[SearchResult]:
        """Search Google News' public RSS endpoint when DuckDuckGo is unavailable."""
        try:
            client = await self._ensure_client()
            response = await client.get(
                "https://news.google.com/rss/search",
                params={
                    "q": query,
                    "hl": "en-IN",
                    "gl": "IN",
                    "ceid": "IN:en",
                },
                timeout=8.0,
            )
            response.raise_for_status()
            root = ElementTree.fromstring(response.content)
            results: list[SearchResult] = []

            for item in root.findall(".//item")[:max_results]:
                title = (item.findtext("title") or "").strip()
                url = (item.findtext("link") or "").strip()
                description = item.findtext("description") or ""
                snippet = html.unescape(re.sub(r"<[^>]+>", " ", description))
                snippet = re.sub(r"\s+", " ", snippet).strip()
                source_node = item.find("source")
                publisher = (
                    (source_node.text or "").strip()
                    if source_node is not None
                    else ""
                )
                published = (item.findtext("pubDate") or "").strip()
                if publisher:
                    snippet = f"{publisher}. {snippet}".strip()
                if published:
                    snippet = f"{snippet} Published: {published}".strip()

                if title and url:
                    results.append(
                        SearchResult(
                            title=title,
                            url=url,
                            snippet=snippet,
                            source="google_news",
                        )
                    )

            return results
        except Exception as exc:
            logger.warning("Google News RSS search failed: %s", exc)
            return []

    async def _search_bing_news_rss(
        self,
        query: str,
        max_results: int = 10,
    ) -> list[SearchResult]:
        """Search Bing News' public RSS view when keyless search providers fail."""
        try:
            client = await self._ensure_client()
            response = await client.get(
                "https://www.bing.com/news/search",
                params={"q": query, "format": "RSS", "setmkt": "en-IN"},
                timeout=5.5,
            )
            response.raise_for_status()
            root = ElementTree.fromstring(response.content)
            results: list[SearchResult] = []

            for item in root.findall(".//item")[:max_results]:
                title = (item.findtext("title") or "").strip()
                raw_url = (item.findtext("link") or "").strip()
                description = item.findtext("description") or ""
                snippet = html.unescape(re.sub(r"<[^>]+>", " ", description))
                snippet = re.sub(r"\s+", " ", snippet).strip()
                published = (item.findtext("pubDate") or "").strip()
                publisher = ""
                for node in item.iter():
                    if node.tag.rsplit("}", 1)[-1].lower() == "source":
                        publisher = (node.text or "").strip()
                        if publisher:
                            break
                if publisher:
                    snippet = f"{publisher}. {snippet}".strip()
                if published:
                    snippet = f"{snippet} Published: {published}".strip()

                parsed = urlsplit(raw_url)
                if (
                    parsed.hostname
                    and parsed.hostname.endswith("bing.com")
                    and parsed.path.endswith("/apiclick.aspx")
                ):
                    target = parse_qs(parsed.query).get("url", [""])[0].strip()
                    if target.startswith(("https://", "http://")):
                        raw_url = target

                if title and raw_url.startswith(("https://", "http://")):
                    results.append(
                        SearchResult(
                            title=title,
                            url=raw_url,
                            snippet=snippet,
                            source="bing_news",
                        )
                    )

            return results
        except Exception as exc:
            logger.warning("Bing News RSS search failed: %s", exc)
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
        query = f"{company_name} company overview financials fundamentals {datetime.now().year}"
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
