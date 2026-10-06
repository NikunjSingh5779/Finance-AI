"""Backward-compatible web-search facade.

The concrete external search implementation lives under app.providers.search.
"""

from app.providers.search.duckduckgo import DuckDuckGoSearcher, get_searcher

__all__ = ["DuckDuckGoSearcher", "get_searcher"]
