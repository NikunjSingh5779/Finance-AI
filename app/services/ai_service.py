"""Application service for AI-assisted financial advice."""

import asyncio
from datetime import datetime
from typing import Any
import re
from datetime import date

from app.providers.market.market_data import get_market_provider
from app.services.web_research_service import get_web_researcher

from app.core.exceptions import ProviderUnavailableError
from app.providers.ai.base import AIProvider
from app.providers.ai.discovery import get_ai_provider, get_ai_providers
from app.repositories.analytics_repository import AnalyticsRepository
from app.repositories.budget_repository import BudgetRepository
from app.repositories.transaction_repository import TransactionRepository


class AIService:
    """Build trusted financial context and delegate generation to a provider."""

    def __init__(self, provider: AIProvider | None = None):
        # An injected provider is used for tests/custom integrations. Otherwise,
        # discover all reachable providers so runtime failures can fall through
        # to the next configured provider.
        self.provider = provider

    def _provider_candidates(self) -> list[AIProvider]:
        if self.provider is not None:
            return [self.provider]
        return get_ai_providers()
    
    @staticmethod
    def _market_type(question: str) -> str | None:
        lowered = question.lower()
        if any(term in lowered for term in ("stock", "share", "equity", "ticker", "closing price", "share price")):
            return "stock"
        if any(term in lowered for term in ("bitcoin", "btc", "ethereum", "eth", "crypto", "solana", "sol")):
            return "crypto"
        if any(term in lowered for term in ("gold", "silver", "crude oil", "oil price", "commodity")):
            return "commodity"
        return None

    @staticmethod
    def _extract_date(question: str) -> str | None:
        text = question.strip().lower()
        patterns = (
            r"(?P<d>\d{1,2})[-/](?P<m>\d{1,2})[-/](?P<y>20\d{2})",
            r"(?P<d>\d{1,2})\s*(?:st|nd|rd|th)?\s*(?P<mon>jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*(?P<y>20\d{2})",
            r"(?P<d>\d{1,2})\s*(?P<mon>jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*(?P<y>20\d{2})",
        )
        months = {
            "jan": 1, "january": 1, "feb": 2, "february": 2,
            "mar": 3, "march": 3, "apr": 4, "april": 4, "may": 5,
            "jun": 6, "june": 6, "jul": 7, "july": 7, "aug": 8,
            "august": 8, "sep": 9, "sept": 9, "september": 9,
            "oct": 10, "october": 10, "nov": 11, "november": 11,
            "dec": 12, "december": 12,
        }
        for pattern in patterns:
            match = re.search(pattern, text)
            if not match:
                continue
            try:
                day = int(match.group("d"))
                year = int(match.group("y"))
                month = int(match.group("m")) if match.groupdict().get("m") else months[match.group("mon")]
                return date(year, month, day).isoformat()
            except (KeyError, TypeError, ValueError):
                return None

        if any(term in text for term in ("today", "right now", "now", "current")):
            return date.today().isoformat()
        return None

    @staticmethod
    def _market_symbol(question: str, market_type: str) -> str | None:
        lowered = question.lower()
        aliases = {
            "nvidia": "NVDA",
            "nvda": "NVDA",
            "apple": "AAPL",
            "aapl": "AAPL",
            "microsoft": "MSFT",
            "msft": "MSFT",
            "tesla": "TSLA",
            "tsla": "TSLA",
            "amazon": "AMZN",
            "amzn": "AMZN",
            "google": "GOOGL",
            "alphabet": "GOOGL",
            "meta": "META",
            "reliance": "RELIANCE.NS",
            "tcs": "TCS.NS",
            "infosys": "INFY.NS",
            "bitcoin": "BTC-USD",
            "btc": "BTC-USD",
            "ethereum": "ETH-USD",
            "eth": "ETH-USD",
            "solana": "SOL-USD",
            "sol": "SOL-USD",
            "gold": "GC=F",
            "silver": "SI=F",
            "crude oil": "CL=F",
            "oil": "CL=F",
        }
        for alias, symbol in sorted(aliases.items(), key=lambda item: len(item[0]), reverse=True):
            if alias in lowered:
                return symbol
        return None

    async def _get_market_evidence(self, question: str) -> str:
        market_type = self._market_type(question)
        if not market_type:
            return ""
        symbol = self._market_symbol(question, market_type)
        if not symbol:
            try:
                from app.services.market_service import MarketService
                matches = await MarketService().search_ticker(question)
                symbol = matches[0].get("symbol") if matches else None
            except Exception:
                symbol = None
        if not symbol:
            return ""
        
        provider = get_market_provider()
        target_date = self._extract_date(question)
        data = None
        if target_date:
            data = await provider.get_price_on_date(symbol, target_date)
        if data is None and target_date in (None, date.today().isoformat()):
            data = await provider.get_current_price(symbol)

        if not data:
            return ""
        return (
            "STRUCTURED MARKET EVIDENCE\n"
            f"Symbol: {data.get('symbol')}\n"
            f"Date: {data.get('date') or data.get('timestamp')}\n"
            f"Open: {data.get('open')}\n"
            f"High: {data.get('high')}\n"
            f"Low: {data.get('low')}\n"
            f"Close/price: {data.get('close', data.get('price'))}\n"
            f"Volume: {data.get('volume')}\n"
            f"Currency: {data.get('currency')}\n"
            f"Source: {data.get('source')}\n"
        )

    @property
    def available(self) -> bool:
        return self.provider is not None and self.provider.is_available()

    def build_context(
        self,
        analytics: AnalyticsRepository,
        transactions: TransactionRepository,
        budgets: BudgetRepository,
    ) -> dict[str, Any]:
        """Build financial context from server-side data."""
        start_date, end_date = self._current_period()
        totals = analytics.summary_totals(start_date, end_date)
        category_totals = analytics.category_totals(start_date, end_date)

        income = totals["income"]
        expense = totals["expense"]
        balance = income - expense
        savings_rate = (balance / income * 100) if income else 0.0

        return {
            "summary": {
                "income": income,
                "expense": expense,
                "balance": balance,
                "savings_rate": savings_rate,
                "category_totals": category_totals,
            },
            "recent_transactions": [
                transaction.model_dump()
                for transaction in transactions.list(skip=0, limit=20)
            ],
            "budgets": [
                budget.model_dump()
                for budget in budgets.list()
            ],
            "period": {
                "start_date": start_date,
                "end_date": end_date,
            },
        }

    async def get_financial_advice(
        self,
        question: str,
        financial_context: dict[str, Any],
        conversation: list[dict[str, str]] | None = None,
    ) -> str:
        providers = self._provider_candidates()
        if not providers:
            raise ProviderUnavailableError(
                "ai",
                "No configured provider is available",
            )

        market_evidence = await self._get_market_evidence(question)

        web_results: list[Any] = []
        web_pages: list[Any] = []
        search_query = self._extract_web_search_query(question)

        if search_query:
            try:
                preferred_domains = self._preferred_domains(question)
                researcher = get_web_researcher()
                web_results, web_pages = await researcher.search_and_fetch(
                    search_query,
                    max_results=6,
                    fetch_count=3,
                    timelimit="d" if self._is_fresh_query(question) else None,
                    preferred_domains=preferred_domains,
                )
            except Exception:
                web_results, web_pages = [], []

        prompt = self._build_prompt(
            question,
            financial_context,
            conversation,
            web_results=web_results,
            web_pages=web_pages,
            market_evidence=market_evidence,
        )

        response = None
        failures: list[str] = []

        for provider in providers:
            provider_name = provider.__class__.__name__
            try:
                candidate = await asyncio.to_thread(
                    provider.generate_response,
                    prompt,
                )
                if isinstance(candidate, str) and candidate.strip():
                    response = candidate.strip()
                    break
                failures.append(f"{provider_name}: empty response")
            except Exception as exc:
                # A configured provider can still reject a request at runtime
                # (for example, a free-tier policy). Continue to the next one.
                failures.append(f"{provider_name}: {exc}")
                continue

        if response is None:
            raise ProviderUnavailableError(
                "ai",
                "All configured AI providers failed: " + " | ".join(failures),
            )

        reply = response

        if web_results:
            source_lines = ["\n\nSources (fresh web search):"]
            for index, item in enumerate(web_results[:5], start=1):
                title = getattr(item, "title", "") or "Source"
                url = getattr(item, "url", "") or ""
                if url:
                    source_lines.append(f"{index}. {title} — {url}")
            reply += "\n".join(source_lines)

        return reply

    @staticmethod
    def _preferred_domains(question: str) -> tuple[str, ...]:
        lowered = question.lower()
        if any(term in lowered for term in ("stock", "share", "equity", "ticker", "closing price", "share price")):
            return (
                "finance.yahoo.com",
                "nasdaq.com",
                "investing.com",
                "reuters.com",
                "sec.gov",
            )
        if any(term in lowered for term in ("gold", "silver", "commodity", "oil")):
            return (
                "lbma.org.uk",
                "cmegroup.com",
                "reuters.com",
                "kitco.com",
            )
        if any(term in lowered for term in ("news", "latest", "today", "recent")):
            return (
                "reuters.com",
                "apnews.com",
                "bbc.com",
                "cnbc.com",
            )
        return ()

    @staticmethod
    def _is_fresh_query(question: str) -> bool:
        lowered = question.lower()
        return any(
            term in lowered
            for term in (
                "latest",
                "today",
                "current",
                "now",
                "right now",
                "realtime",
                "real time",
            )
        )

    @staticmethod
    def _extract_web_search_query(question: str) -> str | None:
        """Return a web-search query only when the user explicitly asks for one."""
        text = question.strip()
        lowered = text.lower()

        prefixes = (
            "search the web for ",
            "search the web ",
            "web search for ",
            "web search ",
            "search online for ",
            "search online ",
            "look up ",
            "find online ",
            "search for ",
            "search ",
        )

        for prefix in prefixes:
            if lowered.startswith(prefix):
                query = text[len(prefix):].strip()
                if not query:
                    return None

                freshness_terms = (
                    "latest",
                    "today",
                    "current",
                    "now",
                    "right now",
                    "realtime",
                    "real time",
                )
                if any(term in query.lower() for term in freshness_terms):
                    query = f"{query} {datetime.now().strftime('%B %Y')} latest"
                return query

        return None

    def _build_prompt(
        self,
        question: str,
        context: dict[str, Any],
        conversation: list[dict[str, str]] | None,
        web_results: list[Any] | None = None,
        web_pages: list[Any] | None = None,
        market_evidence: str = "",
    ) -> str:
        summary = context.get("summary", {})
        recent = context.get("recent_transactions", [])[:10]
        budgets = context.get("budgets", [])[:20]

        recent_text = "\n".join(
            f"- {item.get('date')}: {item.get('description')} | "
            f"{item.get('category')} | {item.get('type')} | "
            f"₹{item.get('amount')}"
            for item in recent
        ) or "- No recent transactions"

        budget_text = "\n".join(
            f"- {item.get('category')}: ₹{item.get('limit_amt')}/month"
            for item in budgets
        ) or "- No budgets configured"

        history_text = "\n".join(
            f"{'Assistant' if message.get('role') == 'assistant' else 'User'}: "
            f"{message.get('content', '')}"
            for message in (conversation or [])[-8:]
        ) or "- None"

        from app.services.web_research_service import WebResearchService
        web_text = WebResearchService.format_evidence(
            web_results or [],
            web_pages or [],
            max_chars=9000,
        ) or "- No web results"

        return f"""You are FinanceAI, a practical personal-finance assistant for an Indian user.
Use only the supplied financial facts. Clearly label estimates and do not promise investment returns.
Do not invent transactions, account balances, prices, market facts, or personal information.
Prefer actionable budgeting and cash-flow advice. Use INR (₹).
Keep every answer compact: maximum 120 words unless a critical warning or calculation genuinely requires more.
Use this format whenever practical:
**Summary:** 1-2 sentences.
**Key points:** up to 3 short bullets.
**Next step:** 1 actionable sentence.
Skip any section that is not useful. Include only crucial details; do not repeat the user's question or restate all available numbers.

CURRENT PERIOD FINANCIAL SUMMARY
Income: ₹{summary.get('income', 0):.2f}
Expenses: ₹{summary.get('expense', 0):.2f}
Net cash flow: ₹{summary.get('balance', 0):.2f}
Savings rate: {summary.get('savings_rate', 0):.1f}%

RECENT TRANSACTIONS
{recent_text}

BUDGETS
{budget_text}

CONVERSATION HISTORY
{history_text}

STRUCTURED MARKET EVIDENCE
Use this evidence first for exact market prices and dates. If it is present and conflicts with a generic web result, prefer the structured market source and clearly identify its source.
{market_evidence or "- No structured market evidence"}

WEB SEARCH / PAGE EVIDENCE
These sources were gathered because the question explicitly requested web information or clearly requires current information.
Use the fetched page content when available. Ignore irrelevant pages and do not invent facts.
{web_text}

USER QUESTION
{question}

Keep the response concise and decision-useful. Follow the compact format above. When the question is investment-related, include the key risk in the summary or key points and avoid guarantees.
"""

    @staticmethod
    def _current_period() -> tuple[str, str]:
        now = datetime.now()
        return (
            now.replace(day=1).strftime("%Y-%m-%d"),
            now.strftime("%Y-%m-%d"),
        )
