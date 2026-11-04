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
from app.providers.ai.discovery import get_ai_providers
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
        if any(
            term in lowered
            for term in ("gold", "silver", "crude oil", "oil price", "commodity")
        ):
            return "commodity"
        if any(
            term in lowered
            for term in ("bitcoin", "btc", "ethereum", "eth", "crypto", "solana", "sol")
        ):
            return "crypto"
        if any(
            term in lowered
            for term in (
                "stock",
                "share",
                "equity",
                "ticker",
                "closing price",
                "share price",
                "stock price",
                "price",
                "up",
                "down",
                "increase",
                "decrease",
                "change",
                "gain",
                "drop",
                "fall",
                "fell",
                "moved",
                "return",
            )
        ):
            return "stock"
        return None

    @staticmethod
    def _extract_date(question: str) -> str | None:
        text = question.strip().lower()
        patterns = (
            r"(?P<d>\d{1,2})[-/](?P<m>\d{1,2})[-/](?P<y>20\d{2})",
            r"(?P<d>\d{1,2})\s*(?:st|nd|rd|th)?\s+"
            r"(?P<mon>jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|"
            r"jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|"
            r"nov(?:ember)?|dec(?:ember)?)\s*(?P<y>20\d{2})",
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

    @staticmethod
    def _query_intent(question: str) -> str:
        lowered = question.lower()
        ipo_terms = (
            "ipo", "drhp", "prospectus", "sebi filing",
            "listing date", "ipo date", "public issue",
        )
        if any(term in lowered for term in ipo_terms):
            return "ipo_research"

        market_type = AIService._market_type(question)
        if market_type:
            analytical_terms = (
                "why", "reason", "analysis", "outlook", "forecast",
                "target", "should i", "buy", "sell", "news", "fundamental",
            )
            if not any(term in lowered for term in analytical_terms):
                fact_terms = (
                    "price", "quote", "close", "open", "high", "low",
                    "change", "down", "up", "gain", "drop", "fall",
                    "today", "yesterday", "current", "now", "realtime",
                )
                if any(term in lowered for term in fact_terms):
                    return "market_fact"
            return "market_research"

        if lowered.startswith((
            "search ", "search the web", "web search", "look up ",
            "find online ", "browse ", "fetch ",
        )):
            return "web_research"

        fresh_terms = (
            "latest", "today", "current", "now", "recent",
            "breaking", "news", "what happened",
        )
        return "web_research" if any(term in lowered for term in fresh_terms) else "personal_finance"

    @staticmethod
    def _needs_personal_context(question: str) -> bool:
        lowered = question.lower()
        personal_terms = (
            "my", "me", "i ", "i'm", "i am", "budget", "transaction",
            "expense", "spending", "saving", "income", "salary", "account",
            "net worth", "cash flow", "financial health", "goal", "debt",
        )
        return any(term in lowered for term in personal_terms)

    async def _get_market_data(self, question: str) -> dict[str, Any] | None:
        market_type = self._market_type(question)
        if not market_type:
            return None

        symbol = self._market_symbol(question, market_type)
        if not symbol:
            try:
                from app.services.market_service import MarketService
                matches = await MarketService().search_ticker(question)
                symbol = matches[0].get("symbol") if matches else None
            except Exception:
                symbol = None

        if not symbol:
            return None

        provider = get_market_provider()
        today = date.today().isoformat()
        target_date = self._extract_date(question)

        if target_date and target_date != today:
            return await provider.get_price_on_date(symbol, target_date)
        return await provider.get_current_price(symbol)

    @staticmethod
    def _market_fact_response(data: dict[str, Any]) -> str:
        symbol = str(data.get("symbol") or "Market")
        price = data.get("price", data.get("close"))
        currency = str(data.get("currency") or "USD")
        date_value = str(data.get("date") or data.get("timestamp") or "")[:10]
        previous_close = data.get("previous_close")
        change = data.get("change")
        change_pct = data.get("change_pct")

        if change is None or change_pct is None:
            movement = "No prior-session comparison was available."
        elif float(change) > 0:
            movement = f"up {abs(float(change)):.2f} ({abs(float(change_pct)):.2f}%)"
        elif float(change) < 0:
            movement = f"down {abs(float(change)):.2f} ({abs(float(change_pct)):.2f}%)"
        else:
            movement = "flat (0.00%)"

        lines = [
            "**Summary:** "
            f"{symbol} is {price} {currency} as of "
            f"{date_value or 'the latest available quote'}, {movement} "
            "versus the previous close.",
            "**Key points:**",
        ]
        if previous_close is not None:
            lines.append(f"- Previous close: {previous_close} {currency}.")
        if change is not None and change_pct is not None:
            lines.append(f"- Change: {change:+.2f} {currency} ({change_pct:+.2f}%).")
        lines.append(
            f"- Source: {data.get('source', 'market data')}; "
            f"quote type: {data.get('quote_kind', 'available quote')}."
        )
        lines.append(
            "**Next step:** Ask for the reason for the move or a historical "
            "comparison if you want deeper analysis."
        )
        return "\n".join(lines)

    async def _get_market_evidence(self, question: str) -> str:
        data = await self._get_market_data(question)
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
            f"Previous close: {data.get('previous_close')}\n"
            f"Change: {data.get('change')}\n"
            f"Change %: {data.get('change_pct')}\n"
            f"Volume: {data.get('volume')}\n"
            f"Currency: {data.get('currency')}\n"
            f"Quote kind: {data.get('quote_kind')}\n"
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
        intent = self._query_intent(question)
        market_data = None
        market_evidence = ""

        if intent in {"market_fact", "market_research"}:
            market_data = await self._get_market_data(question)
            if intent == "market_fact" and market_data:
                return self._market_fact_response(market_data)
            if market_data:
                market_evidence = (
                    "STRUCTURED MARKET EVIDENCE\n"
                    f"Symbol: {market_data.get('symbol')}\n"
                    f"Date: {market_data.get('date') or market_data.get('timestamp')}\n"
                    f"Open: {market_data.get('open')}\n"
                    f"High: {market_data.get('high')}\n"
                    f"Low: {market_data.get('low')}\n"
                    f"Close/price: {market_data.get('close', market_data.get('price'))}\n"
                    f"Previous close: {market_data.get('previous_close')}\n"
                    f"Change: {market_data.get('change')}\n"
                    f"Change %: {market_data.get('change_pct')}\n"
                    f"Volume: {market_data.get('volume')}\n"
                    f"Currency: {market_data.get('currency')}\n"
                    f"Quote kind: {market_data.get('quote_kind')}\n"
                    f"Source: {market_data.get('source')}\n"
                )

        web_results: list[Any] = []
        web_pages: list[Any] = []
        search_query = self._extract_web_search_query(question)
        should_search = intent in {"ipo_research", "market_research", "web_research"}

        if search_query and should_search:
            preferred_domains = self._preferred_domains(question)
            researcher = get_web_researcher()
            candidate_queries = (
                search_query,
                *self._research_query_variants(search_query, intent),
            )
            for candidate_query in candidate_queries:
                try:
                    candidate_results, candidate_pages = await researcher.search_and_fetch(
                        candidate_query,
                        max_results=8 if intent == "ipo_research" else 6,
                        fetch_count=3 if intent == "ipo_research" else 2,
                        timelimit=self._research_timelimit(question, intent),
                        preferred_domains=preferred_domains,
                    )
                except Exception:
                    continue

                if candidate_results or candidate_pages:
                    web_results, web_pages = candidate_results, candidate_pages
                    break

        # Do not ask the model to guess when a current-information query
        # produced no evidence that passed entity/topic relevance checks.
        if (
            should_search
            and not web_results
            and not web_pages
            and not market_evidence
        ):
            return (
                "I couldn't verify this from sufficiently relevant sources. "
                "I have not included unrelated search results. Try adding the "
                "company, product, or date you want me to check."
            )

        providers = self._provider_candidates()
        if not providers:
            raise ProviderUnavailableError(
                "ai",
                "No configured provider is available",
            )

        prompt = self._build_prompt(
            question,
            financial_context,
            conversation,
            web_results=web_results,
            web_pages=web_pages,
            market_evidence=market_evidence,
            intent=intent,
            include_financial_context=self._needs_personal_context(question),
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
            source_lines = ["\\n\\n**Sources**"]
            for item in web_results[:5]:
                title = getattr(item, "title", "") or "Source"
                url = getattr(item, "url", "") or ""
                parsed_url = urlsplit(url)
                if parsed_url.scheme in {"http", "https"} and parsed_url.netloc:
                    label = title.replace("[", "(").replace("]", ")")
                    source_lines.append(f"- [{label}]({url})")
            if len(source_lines) > 1:
                reply += "\\n".join(source_lines)

        return reply

    @staticmethod
    def _preferred_domains(question: str) -> tuple[str, ...]:
        lowered = question.lower()
        if any(
            term in lowered
            for term in ("ipo", "drhp", "prospectus", "sebi filing", "listing date", "ipo date")
        ):
            return (
                "jio.com",
                "ril.com",
                "sebi.gov.in",
                "nseindia.com",
                "bseindia.com",
                "relianceindustries.com",
                "reuters.com",
            )
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
    def _research_query_variants(query: str, intent: str) -> tuple[str, ...]:
        """Return a small set of targeted retries for IPO queries that lack evidence."""
        if intent != "ipo_research":
            return ()

        lowered = query.lower()
        year_match = re.search(r"\b20\d{2}\b", query)
        year = year_match.group(0) if year_match else str(datetime.now().year)
        if re.search(r"\b(jio|jpl)\b", lowered):
            issuer = "Jio Platforms Limited"
        else:
            issuer = re.sub(r"(?i)\b(?:when|is|the|ipo|drhp|rhp|sebi)\b", " ", query)
            issuer = re.sub(r"\s+", " ", issuer).strip(" ?.,")
            if not issuer:
                return ()

        candidates = (
            f"{issuer} IPO opening date closing date allotment listing date {year}",
            f"{issuer} RHP prospectus public issue timeline {year}",
        )
        original = " ".join(query.lower().split())
        return tuple(
            candidate
            for candidate in candidates
            if " ".join(candidate.lower().split()) != original
        )

    @staticmethod
    def _research_timelimit(question: str, intent: str) -> str | None:
        """Use a week for explanatory market moves, but keep factual lookups daily."""
        if not AIService._is_fresh_query(question):
            return None
        lowered = question.lower()
        explanatory_move = intent == "market_research" and any(
            term in lowered
            for term in (
                "why", "reason", "fall", "fell", "drop", "dropped",
                "decline", "declined", "slump", "sell-off", "selloff",
            )
        )
        return "w" if explanatory_move else "d"

    @staticmethod
    def _extract_web_search_query(question: str) -> str | None:
        """Build a focused web query for explicit or clearly current questions."""
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
            "browse for ",
            "browse ",
            "fetch ",
        )

        query = None
        for prefix in prefixes:
            if lowered.startswith(prefix):
                query = text[len(prefix):].strip()
                break

        web_signals = (
            "latest",
            "today",
            "current",
            "now",
            "right now",
            "realtime",
            "real time",
            "recent",
            "news",
            "what happened",
            "who won",
            "price today",
            "as of today",
            "ipo",
            "drhp",
            "prospectus",
            "sebi filing",
            "listing date",
            "ipo date",
        )

        if query is None and not any(signal in lowered for signal in web_signals):
            return None

        query = query or text

        if any(
            term in query.lower()
            for term in ("ipo", "drhp", "prospectus", "sebi filing", "listing date", "ipo date")
        ):
            lowered_query = query.lower()
            if "sebi" not in lowered_query:
                query = f"{query} DRHP SEBI"
            if str(datetime.now().year) not in query:
                query = f"{query} {datetime.now().year}"

        query = re.sub(
            r"(?i)\b(\d{1,2})\s*"
            r"(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|"
            r"jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|"
            r"nov(?:ember)?|dec(?:ember)?)\s*(20\d{2})\b",
            lambda match: f"{match.group(1)} {match.group(2)} {match.group(3)}",
            query,
        )
        query = re.sub(
            r"\b(\d{1,2})(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)(20\d{2})\b",
            lambda match: f"{match.group(1)} {match.group(2)} {match.group(3)}",
            query,
            flags=re.IGNORECASE,
        )

        market_type = AIService._market_type(query)
        symbol = AIService._market_symbol(query, market_type or "")
        if market_type == "stock" and symbol and any(
            term in query.lower() for term in ("price", "share", "stock", "close", "quote")
        ):
            target_date = AIService._extract_date(query)
            suffix = f" {target_date}" if target_date else ""
            return f"{symbol} historical stock price{suffix}".strip()

        if market_type == "commodity" and symbol and any(
            term in query.lower() for term in ("price", "gold", "silver", "oil")
        ):
            target_date = AIService._extract_date(query)
            suffix = f" {target_date}" if target_date else " today"
            commodity = {
                "GC=F": "gold",
                "SI=F": "silver",
                "CL=F": "crude oil",
            }.get(symbol, "commodity")
            return f"{commodity} price {suffix}".strip()

        if market_type == "crypto" and symbol and any(
            term in query.lower() for term in ("price", "quote", "value")
        ):
            target_date = AIService._extract_date(query)
            suffix = f" {target_date}" if target_date else " today"
            return f"{symbol} price{suffix}"

        if any(term in query.lower() for term in (
            "latest", "today", "current", "now", "right now", "realtime", "real time", "recent"
        )):
            query = f"{query} {datetime.now().strftime('%B %Y')}"

        return query

    def _build_prompt(
        self,
        question: str,
        context: dict[str, Any],
        conversation: list[dict[str, str]] | None,
        web_results: list[Any] | None = None,
        web_pages: list[Any] | None = None,
        market_evidence: str = "",
        intent: str = "personal_finance",
        include_financial_context: bool = True,
    ) -> str:
        summary = context.get("summary", {})
        recent = context.get("recent_transactions", [])[:8]
        budgets = context.get("budgets", [])[:10]

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
            for message in (conversation or [])[-4:]
        ) or "- None"

        from app.services.web_research_service import WebResearchService
        web_text = WebResearchService.format_evidence(
            web_results or [],
            web_pages or [],
            max_chars=6000,
        ) or "- No web results"

        personal_section = (
            f"""CURRENT PERIOD FINANCIAL SUMMARY
Income: ₹{summary.get('income', 0):.2f}
Expenses: ₹{summary.get('expense', 0):.2f}
Net cash flow: ₹{summary.get('balance', 0):.2f}
Savings rate: {summary.get('savings_rate', 0):.1f}%

RECENT TRANSACTIONS
{recent_text}

BUDGETS
{budget_text}

"""
            if include_financial_context
            else ""
        )

        return f"""You are FinanceAI.
Today is {date.today().isoformat()}.
Query intent: {intent}.

Rules:
- Use supplied evidence as the source of truth.
- Never invent current prices, dates, IPO status, transactions, balances, or news.
- For market facts, prefer structured market evidence over web snippets.
- For stock-move explanations, check the quote's direction, change, and date before accepting the user's premise. If the quote shows a rise or a flat session, say so clearly; do not invent a reason for a fall that did not occur in that session.
- When a recent article describes a move on an earlier trading date, name that date and keep it separate from today's quote. Distinguish reported drivers from speculation.
- For IPO/listing questions, prefer official issuer, SEBI, NSE and BSE filings over commentary. Treat IPO, initial public offer/offering, DRHP, RHP, red herring prospectus, allotment and listing as related IPO terminology.
- Only use web pages and search results that clearly match the named entity and requested topic.
- Never repeat, cite, or append a source that does not support the user's exact question.
- If relevant evidence is unavailable, clearly say it could not be verified; do not fill the gap with guesses.
- Keep the answer under 120 words unless the user explicitly asks for detail.
- Use **Summary:**, **Key points:**, and **Next step:** when useful.
- Do not repeat the user's question.

{personal_section}CONVERSATION HISTORY
{history_text}

STRUCTURED MARKET EVIDENCE
{market_evidence or "- None"}

WEB SEARCH / PAGE EVIDENCE
{web_text}

USER QUESTION
{question}
"""

    @staticmethod
    def _current_period() -> tuple[str, str]:
        now = datetime.now()
        return (
            now.replace(day=1).strftime("%Y-%m-%d"),
            now.strftime("%Y-%m-%d"),
        )
