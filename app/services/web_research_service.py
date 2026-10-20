"""Free-first web research orchestration for FinanceAI."""

from __future__ import annotations

import asyncio
import html
import logging
import re
from dataclasses import dataclass
from typing import Any

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


def _score_result(result: SearchResult, query: str, preferred_domains: tuple[str, ...]) -> float:
    tokens = _tokenize(query)
    haystack = f"{result.title} {result.snippet} {result.url}".lower()
    score = float(sum(2 for token in tokens if token in haystack))
    for index, domain in enumerate(preferred_domains):
        if domain.lower() in haystack:
            score += max(1.0, 8.0 - index)
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
        ranked = sorted(
            results,
            key=lambda item: _score_result(item, query, preferred_domains),
            reverse=True,
        )
        selected = ranked[:fetch_count]
        pages = await asyncio.gather(
            *(self.fetch(result.url, result.title) for result in selected),
            return_exceptions=True,
        )
        fetched: list[WebPage] = []
        for page in pages:
            if isinstance(page, WebPage) and page.content:
                fetched.append(page)
        return ranked[:max_results], fetched

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
