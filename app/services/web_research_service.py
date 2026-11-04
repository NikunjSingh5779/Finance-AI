"""Free-first web research orchestration for FinanceAI."""

from __future__ import annotations

import asyncio
import html
import logging
import re
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx

from app.providers.search.duckduckgo import DuckDuckGoSearcher, SearchResult, get_searcher

logger = logging.getLogger(__name__)

DEFAULT_FETCH_TIMEOUT = 8.0
DEFAULT_MAX_PAGE_CHARS = 5000
JINA_READER_BASE = "https://r.jina.ai/"


@dataclass(frozen=True)
class WebPage:
    title: str
    url: str
    content: str
    source: str


def _tokenize(value: str) -> set[str]:
    return {
        token.lower()
        for token in re.findall(r"[A-Za-z0-9$%.-]{3,}", value)
        if token.lower() not in {"the", "and", "for", "with", "from", "that", "this"}
    }


_RESEARCH_STOP_WORDS = {
    "the", "and", "for", "with", "from", "that", "this", "what", "when",
    "where", "who", "why", "how", "tell", "about", "latest", "today",
    "current", "now", "recent", "news", "search", "web", "online",
    "price", "date", "information", "update", "updates", "status",
    "ipo", "drhp", "sebi", "prospectus", "listing", "listed", "public",
    "issue", "filing", "share", "stock", "company", "market",
}


def _query_core_tokens(query: str) -> set[str]:
    """Keep identifying terms; remove generic search and finance vocabulary."""
    return {
        token
        for token in _tokenize(query)
        if token not in _RESEARCH_STOP_WORDS
        and not re.fullmatch(r"20\\d{2}", token)
    }


def _topic_requirements(query: str) -> tuple[set[str], ...]:
    lowered = query.lower()
    if any(term in lowered for term in ("ipo", "drhp", "prospectus", "sebi filing", "listing date")):
        return ({
            "ipo", "drhp", "prospectus", "listing", "listed", "sebi",
            "allotment", "subscription", "public", "issue",
        },)
    return ()


def _is_relevant_text(query: str, title: str, body: str, url: str = "") -> bool:
    """Reject search results that do not mention the requested entity/topic."""
    combined = f"{title} {body} {url}".strip()
    haystack = _tokenize(combined)
    query_tokens = _tokenize(query)
    core = _query_core_tokens(query)

    if core:
        matched = core.intersection(haystack)
        required_matches = max(1, (len(core) + 1) // 2)
        if len(matched) < required_matches:
            return False
    elif not query_tokens.intersection(haystack):
        return False

    for topic_group in _topic_requirements(query):
        if not topic_group.intersection(haystack):
            return False

    return True


def _score_result(result: SearchResult, query: str, preferred_domains: tuple[str, ...]) -> float:
    title_body = f"{result.title} {result.snippet}"
    haystack = f"{title_body} {result.url}".lower()
    core = _query_core_tokens(query)
    score = float(sum(4 for token in core if token in _tokenize(title_body)))
    score += float(sum(1 for token in _tokenize(query) if token in _tokenize(title_body)))

    host = (urlsplit(result.url).hostname or "").lower()
    for index, domain in enumerate(preferred_domains):
        normalized = domain.lower().lstrip(".")
        if host == normalized or host.endswith("." + normalized):
            score += max(1.0, 8.0 - index)
            break
    if result.url.startswith("https://"):
        score += 0.5
    return score


class _PageTextParser:
    """Small dependency-free HTML-to-text extractor for fast direct fetches."""

    def __init__(self) -> None:
        from html.parser import HTMLParser

        class Parser(HTMLParser):
            def __init__(self, owner: "_PageTextParser") -> None:
                super().__init__(convert_charrefs=True)
                self.owner = owner
                self.skip_depth = 0
                self.in_title = False

            def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
                tag = tag.lower()
                if tag in {"script", "style", "noscript", "svg", "template"}:
                    self.skip_depth += 1
                if tag == "title":
                    self.in_title = True
                if tag in {"p", "article", "section", "h1", "h2", "h3", "li", "pre", "blockquote"}:
                    self.owner.blocks.append("")

            def handle_endtag(self, tag: str) -> None:
                tag = tag.lower()
                if tag == "title":
                    self.in_title = False
                if tag in {"script", "style", "noscript", "svg", "template"} and self.skip_depth:
                    self.skip_depth -= 1
                if tag in {"p", "article", "section", "h1", "h2", "h3", "li", "pre", "blockquote"}:
                    self.owner.blocks.append("")

            def handle_data(self, data: str) -> None:
                if self.skip_depth:
                    return
                text = html.unescape(" ".join(data.split()))
                if not text:
                    return
                if self.in_title:
                    self.owner.title += (" " if self.owner.title else "") + text
                if not self.owner.blocks:
                    self.owner.blocks.append(text)
                else:
                    self.owner.blocks[-1] += (" " if self.owner.blocks[-1] else "") + text

        self.title = ""
        self.blocks: list[str] = []
        self.parser = Parser(self)

    def feed(self, raw_html: str) -> None:
        try:
            self.parser.feed(raw_html)
            self.parser.close()
        except Exception:
            # Keep whatever text was recovered before malformed HTML stopped parsing.
            pass

    def text(self, max_chars: int) -> str:
        cleaned = []
        for block in self.blocks:
            block = re.sub(r"\s+", " ", block).strip()
            if len(block) >= 25:
                cleaned.append(block)
        return "\n\n".join(cleaned)[:max_chars].strip()


class WebResearchService:
    """Search public web pages and fetch a small evidence set without paid APIs."""

    def __init__(self, searcher: DuckDuckGoSearcher | None = None) -> None:
        self.searcher = searcher or get_searcher()

    async def search_and_fetch(
        self,
        query: str,
        *,
        max_results: int = 6,
        fetch_count: int = 3,
        timelimit: str | None = None,
        preferred_domains: tuple[str, ...] = (),
    ) -> tuple[list[SearchResult], list[WebPage]]:
        results = await self.searcher.search(
            query,
            max_results=max_results,
            timelimit=timelimit,
        )
        relevant = [
            result
            for result in results
            if _is_relevant_text(
                query,
                result.title,
                result.snippet,
                result.url,
            )
        ]
        ranked = sorted(
            relevant,
            key=lambda item: _score_result(item, query, preferred_domains),
            reverse=True,
        )
        selected = ranked[:fetch_count]
        pages = await asyncio.gather(
            *(self.fetch(result.url, result.title) for result in selected),
            return_exceptions=True,
        )

        fetched: list[WebPage] = []
        rejected_urls: set[str] = set()
        for result, page in zip(selected, pages):
            if isinstance(page, WebPage) and page.content:
                if _is_relevant_text(
                    query,
                    page.title,
                    page.content,
                    page.url,
                ):
                    fetched.append(page)
                else:
                    rejected_urls.add(result.url)

        # If a page was successfully fetched but its contents do not match
        # the query, remove its search snippet and source link as well.
        filtered_results = [
            result for result in ranked
            if result.url not in rejected_urls
        ]
        return filtered_results[:max_results], fetched

    async def fetch(self, url: str, title: str = "") -> WebPage | None:
        if not url.startswith(("http://", "https://")):
            return None

        direct = await self._fetch_direct(url, title)
        if direct and len(direct.content) >= 500:
            return direct

        jina = await self._fetch_jina(url, title)
        return jina or direct

    async def _fetch_direct(self, url: str, title: str) -> WebPage | None:
        try:
            timeout = httpx.Timeout(DEFAULT_FETCH_TIMEOUT, connect=4.0)
            async with httpx.AsyncClient(
                timeout=timeout,
                follow_redirects=True,
                headers={
                    "User-Agent": "FinanceAI/2.1 (+web-research; public-page-fetch)",
                    "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
                },
            ) as client:
                response = await client.get(url)
                response.raise_for_status()
                content_type = response.headers.get("content-type", "").lower()
                if not any(kind in content_type for kind in ("text/html", "application/xhtml", "text/plain")):
                    return None
                raw = response.text[:250_000]

            if "html" in content_type or "<html" in raw.lower():
                parser = _PageTextParser()
                parser.feed(raw)
                body = parser.text(DEFAULT_MAX_PAGE_CHARS)
                page_title = parser.title.strip() or title
            else:
                body = re.sub(r"\s+", " ", html.unescape(raw)).strip()[:DEFAULT_MAX_PAGE_CHARS]
                page_title = title

            if not body:
                return None
            return WebPage(page_title, url, body, "direct")
        except Exception as exc:
            logger.debug("Direct web fetch failed for %s: %s", url, exc)
            return None

    async def _fetch_jina(self, url: str, title: str) -> WebPage | None:
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(12.0, connect=5.0),
                follow_redirects=True,
                headers={
                    "Accept": "text/plain",
                    "User-Agent": "FinanceAI/2.1",
                },
            ) as client:
                response = await client.get(JINA_READER_BASE + url)
                response.raise_for_status()
                body = response.text[:DEFAULT_MAX_PAGE_CHARS].strip()
            if not body:
                return None
            return WebPage(title, url, body, "jina-reader")
        except Exception as exc:
            logger.debug("Jina Reader fetch failed for %s: %s", url, exc)
            return None

    @staticmethod
    def format_evidence(results: list[SearchResult], pages: list[WebPage], max_chars: int = 9000) -> str:
        parts: list[str] = []
        for index, page in enumerate(pages, start=1):
            parts.append(
                f"[PAGE {index}] {page.title or 'Source'}\n"
                f"URL: {page.url}\n"
                f"CONTENT:\n{page.content}"
            )
        if not parts:
            for index, result in enumerate(results[:3], start=1):
                parts.append(
                    f"[SEARCH RESULT {index}] {result.title}\n"
                    f"URL: {result.url}\n"
                    f"SNIPPET: {result.snippet}"
                )
        return "\n\n".join(parts)[:max_chars]


def get_web_researcher() -> WebResearchService:
    return WebResearchService()
