"""Application service for AI-assisted financial advice."""

import asyncio
import re
from datetime import date, datetime, timezone
from typing import Any
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from app.core.exceptions import ProviderUnavailableError
from app.providers.ai.base import AIProvider
from app.providers.ai.discovery import get_ai_providers
from app.providers.market.market_data import get_market_provider
from app.repositories.analytics_repository import AnalyticsRepository
from app.repositories.budget_repository import BudgetRepository
from app.repositories.transaction_repository import TransactionRepository
from app.services.web_research_service import get_web_researcher


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
    @staticmethod
    def _market_type(question: str) -> str | None:
        lowered = question.lower()
        if re.search(r"\b(gold|silver|crude oil|oil price|commodity|commodities)\b", lowered):
            return "commodity"
        if re.search(r"\b(bitcoin|btc|ethereum|eth|crypto|cryptocurrency|solana|sol)\b", lowered):
            return "crypto"
        stock_context = (
            "stock", "shares", "share price", "equity", "equities", "ticker",
            "closing price", "stock price", "stock market", "market cap",
            "market capitalization", "dividend", "earnings per share", "pe ratio",
            "p/e ratio", "nse", "bse", "nasdaq", "nyse", "nifty", "sensex",
        )
        if any(term in lowered for term in stock_context):
            return "stock"
        if AIService._market_symbol(question, "stock"):
            return "stock"
        return None

    def _contains_financial_topic(text: str) -> bool:
        """Recognize a broad range of personal, business, and market-finance topics."""
        lowered = " ".join(text.lower().split())
        patterns = (
            r"\b(finance|financial|money|monetary|cash flow|cashflow)\b",
            r"\b(budget|budgeting|expense|expenses|spending|income|earnings|salary|wages|paycheck|savings|saving)\b",
            r"\b(invest|investing|investment|investments|portfolio|asset allocation|wealth management|net worth|retirement|pension)\b",
            r"\b(stock|stocks|share|shares|equity|equities|bond|bonds|mutual fund|mutual funds|etf|index fund|sip|dividend|brokerage|demat)\b",
            r"\b(crypto|cryptocurrency|bitcoin|ethereum|forex|foreign exchange|currency exchange|exchange rate|commodity|commodities|gold|silver|gold price|silver price|oil price)\b",
            r"\b(bank|banking|bank account|savings account|fixed deposit|recurring deposit|\bfd\b|\brd\b|upi|payment|payments|transaction|transactions|credit card|debit card|credit score|credit history)\b",
            r"\b(loan|loans|mortgage|emi|interest|compound interest|apr|apy|principal|repayment|lending|borrowing|debt|liability|liabilities)\b",
            r"\b(tax|taxes|taxation|income tax|capital gains|gst|vat|tds|deduction|deductions|tax slab|tax return|itr|tax filing)\b",
            r"\b(insurance|premium|premiums|policyholder|claim|claims|coverage|life cover|health cover)\b",
            r"\b(accounting|bookkeeping|balance sheet|income statement|profit and loss|p&l|revenue|profit|profitability|margin|cash flow statement|financial statement|financial statements|financial ratio|valuation|ebitda|working capital|depreciation|amortization|audit|market cap|market capitalization|pe ratio|p/e ratio|price to earnings)\b",
            r"\b(ipo|initial public offering|sebi|rbi|central bank|repo rate|policy rate|interest rate|yield|treasury|securities|capital market|financial market|stock market|money market|derivative|derivatives|futures|options trading|hedging|arbitrage)\b",
            r"\b(inflation|deflation|recession|gdp|monetary policy|fiscal policy|macroeconomics|economic growth|economy|economics)\b",
            r"\b(startup funding|venture capital|private equity|merger|acquisition|m&a|corporate finance|business finance|financial model|financial modelling|financial modeling|estate planning|inheritance planning|trust fund|student loan|student loans|buy now pay later|bnpl|overdraft|remittance|remittances)\b",
            r"\b(fund|funds|hedge fund|hedge funds|options|option trading|risk management|financial risk|risk adjusted|discounted cash flow|net present value|internal rate of return|return on investment|return on equity|return on assets|weighted average cost of capital|free cash flow|price to book|book value|capm|wacc|dcf|npv|irr|roi|roe|roa|cagr|eps|fcf|gaap|ifrs|reconciliation|accounts payable|accounts receivable|working paper|financial planning|financial advisor|financial adviser|wealth planning|estate tax|inheritance tax|annuity|annuities|microfinance|remittance)\b",
        )
        return any(re.search(pattern, lowered) for pattern in patterns)

    @staticmethod
    def _is_greeting_or_finance_help(question: str) -> bool:
        lowered = re.sub(r"[^a-z ]", " ", question.lower())
        lowered = " ".join(lowered.split())
        greetings = {
            "hi", "hello", "hey", "good morning", "good afternoon",
            "good evening", "thanks", "thank you",
        }
        help_requests = {
            "help", "help me", "what can you do", "what can financeai do",
            "what can you help me with", "what topics can you answer",
        }
        return lowered in greetings or lowered in help_requests

    @staticmethod
    @staticmethod
    def _is_contextual_finance_follow_up(
        question: str,
        conversation: list[dict[str, str]] | None,
    ) -> bool:
        """Keep brief follow-ups in scope only when the prior user topic was financial."""
        if not conversation:
            return False

        previous_user = next(
            (
                str(message.get("content", "")).strip()
                for message in reversed(conversation)
                if message.get("role") == "user" and message.get("content")
            ),
            "",
        )
        if not AIService._contains_financial_topic(previous_user):
            return False

        lowered = " ".join(question.lower().split())
        if not lowered or len(lowered.split()) > 12:
            return False

        follow_up_patterns = (
            r"^(why|how|what|when|where|which|who)\??$",
            r"^(and then|and what|and how|but why|but how|what next)\??$",
            r"^(what about|how about)\b",
            r"^(tell me more|elaborate|clarify|explain more|explain it|explain that)\b",
            r"^(can you|could you|please)\s+(explain|elaborate|compare|calculate|clarify|expand)\b",
            r"^(is|are|was|were|will|would|should|can|could|does|do)\s+(it|that|this|they|those|these|one|the two)\b",
            r"^(give me|show me)\s+(an?\s+)?(example|calculation|breakdown|comparison)\b",
            r"^(explain|compare|calculate|expand on)\s+(it|that|this)\b",
            r"^(why is that|how so|what do you mean|in simple terms|pros and cons)\b",
            r"^(is it worth it|is that good|is this safe|what are the risks)\??$",
        )
        return any(re.search(pattern, lowered) for pattern in follow_up_patterns)

    def _is_finance_related(
        question: str,
        conversation: list[dict[str, str]] | None = None,
    ) -> bool:
        """Keep FinanceAI in scope while supporting natural conversational follow-ups."""
        return (
            AIService._contains_financial_topic(question)
            or AIService._is_greeting_or_finance_help(question)
            or AIService._is_contextual_finance_follow_up(question, conversation)
        )

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
            "jio platforms": "JPL.NS",
            "jio": "JPL.NS",
            "jpl": "JPL.NS",
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
            pattern = rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])"
            if re.search(pattern, lowered):
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
            explainer_prefixes = (
                "what is ", "who is ", "tell me about ", "explain ",
                "what does ", "how does ",
            )
            time_sensitive_terms = (
                "price", "quote", "today", "yesterday", "current", "latest",
                "now", "realtime", "real time", "target", "forecast",
                "outlook", "buy", "sell", "why", "reason", "news",
            )
            if (
                lowered.startswith(explainer_prefixes)
                and not any(term in lowered for term in time_sensitive_terms)
            ):
                return "market_explainer"

            analytical_terms = (
                "why", "reason", "analysis", "outlook", "forecast",
                "target", "should i", "buy", "sell", "news", "fundamental",
            )
            if not any(term in lowered for term in analytical_terms):
                fact_terms = (
                    "price", "quote", "rate", "close", "open", "high", "low",
                    "per gram", "per 10g", "change", "down", "up", "gain", "drop", "fall",
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
        if any(term in lowered for term in fresh_terms):
            return "web_research"

        # Tax rules, regulator guidance, and official policy/rate schedules
        # change over time, so retrieve current evidence rather than relying
        # on a model's training cutoff.
        regulated_finance_terms = (
            "gst", "income tax", "capital gains tax", "tax slab", "tax rate",
            "tax deadline", "tax filing", "itr", "tds", "vat", "sebi", "rbi",
            "repo rate", "policy rate", "fd rate", "interest rate", "insurance rule",
            "insurance regulation", "contribution limit", "withdrawal limit",
        )
        if any(term in lowered for term in regulated_finance_terms):
            return "web_research"

        if AIService._needs_personal_context(question):
            return "personal_finance"
        return "finance_education"

    @staticmethod
    def _needs_personal_context(question: str) -> bool:
        """Include private account data only when the user asks about their own finances."""
        lowered = question.lower()
        direct_reference = re.search(
            r"\b(my|mine|our|ours|we|i|i'm|i am)\b",
            lowered,
        )
        explicit_personal_request = any(
            phrase in lowered
            for phrase in ("for me", "my own", "based on my", "based on our")
        )
        return bool(direct_reference or explicit_personal_request)

    @staticmethod
    def _market_currency(question: str) -> str:
        """Use INR for the India-first experience unless another currency is explicit."""
        lowered = question.lower()
        if any(term in lowered for term in ("usd", "us dollar", "dollar", "dollars", "$")):
            return "USD"
        return "INR"

    async def _get_market_data(self, question: str) -> dict[str, Any] | None:
        market_type = self._market_type(question)
        if not market_type:
            return None

        provider = get_market_provider()
        today = date.today().isoformat()
        target_date = self._extract_date(question)

        # Ordinary gold-price questions mean international spot gold, not a
        # COMEX futures contract. Never silently substitute futures or an old
        # daily close when the dedicated spot feed is unavailable.
        if market_type == "commodity":
            lowered = question.lower()
            futures_request = any(
                term in lowered
                for term in ("future", "futures", "comex", "contract")
            )
            if re.search(r"\bgold\b", lowered) and not futures_request:
                if target_date not in (None, today):
                    # Historical spot data is not supplied by the current quote feed.
                    return None
                return await provider.get_spot_price(
                    "XAU",
                    currency=self._market_currency(question),
                )

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

        if target_date and target_date != today:
            return await provider.get_price_on_date(symbol, target_date)
        return await provider.get_current_price(symbol)

    @staticmethod
    def _format_market_money(value: Any, currency: str) -> str:
        symbols = {
            "INR": "₹",
            "USD": "$",
            "EUR": "€",
            "GBP": "£",
            "JPY": "¥",
            "AED": "د.إ ",
        }
        amount = float(value)
        return f"{symbols.get(currency.upper(), currency.upper() + ' ')}{amount:,.2f}"

    @staticmethod
    def _format_market_timestamp(value: Any) -> str | None:
        if not value:
            return None
        try:
            timestamp = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            if timestamp.tzinfo is None:
                timestamp = timestamp.replace(tzinfo=timezone.utc)
            try:
                local_time = timestamp.astimezone(ZoneInfo("Asia/Kolkata"))
                return local_time.strftime("%d %b %Y, %I:%M %p IST")
            except Exception:
                utc_time = timestamp.astimezone(timezone.utc)
                return utc_time.strftime("%d %b %Y, %I:%M %p UTC")
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _market_fact_response(data: dict[str, Any]) -> str:
        symbol = str(data.get("symbol") or "Market")
        currency = str(data.get("currency") or "USD").upper()
        source = str(data.get("source") or "Market data provider")
        quote_kind = str(data.get("quote_kind") or "unknown")
        clean_symbol = symbol.upper().replace(".NS", "").replace(".BO", "")
        price = data.get("price", data.get("close"))

        if price is None:
            return "I couldn't find a valid price in the market-data response."

        # Gold spot has a clear India-friendly unit. Show the equivalent
        # 24K spot value per 10 g, while keeping the international ounce quote.
        if clean_symbol == "XAU" and quote_kind == "spot":
            updated = AIService._format_market_timestamp(
                data.get("market_timestamp") or data.get("updated_at")
            )
            if currency == "INR" and data.get("price_per_10g") is not None:
                headline = (
                    "**Gold spot (24K equivalent): "
                    f"{AIService._format_market_money(data['price_per_10g'], currency)} "
                    "per 10 g**"
                )
                international = (
                    "International spot quote: "
                    f"{AIService._format_market_money(price, currency)} per troy ounce."
                )
            else:
                headline = (
                    "**Gold spot: "
                    f"{AIService._format_market_money(price, currency)} "
                    "per troy ounce**"
                )
                international = ""

            freshness = (
                f"Updated {updated} · [Gold API](https://gold-api.com)."
                if updated
                else f"Source: {source}; source timestamp unavailable."
            )
            return "\n\n".join(
                part
                for part in (
                    headline,
                    international,
                    freshness,
                    (
                        "This is an international spot reference, not a local "
                        "jeweller's retail rate. City premiums, purity, applicable "
                        "taxes and making charges can change the price you pay."
                    ),
                )
                if part
            )

        company = (
            "Jio Platforms Limited (NSE: JPL; BSE: 545004)"
            if clean_symbol == "JPL"
            else symbol
        )
        headline = (
            f"**{company}: {AIService._format_market_money(price, currency)}**"
        )

        previous_close = data.get("previous_close")
        change = data.get("change")
        change_pct = data.get("change_pct")
        movement = ""
        if (
            previous_close is not None
            and change is not None
            and change_pct is not None
        ):
            direction = "Up" if float(change) > 0 else "Down"
            if float(change) == 0:
                movement = "Unchanged from the previous close."
            else:
                movement = (
                    f"{direction} "
                    f"{AIService._format_market_money(abs(float(change)), currency)} "
                    f"({abs(float(change_pct)):.2f}%) versus the previous close of "
                    f"{AIService._format_market_money(previous_close, currency)}."
                )

        if quote_kind == "latest_daily_close":
            session_date = str(data.get("date") or data.get("market_timestamp") or "")[:10]
            timestamp_line = (
                f"Latest daily close: {session_date}. This is not a live quote."
                if session_date
                else "Latest daily close; this is not a live quote."
            )
        elif quote_kind == "historical_daily_close":
            session_date = str(data.get("date") or "")[:10]
            timestamp_line = f"Historical daily close for {session_date}."
        else:
            updated = AIService._format_market_timestamp(
                data.get("market_timestamp") or data.get("timestamp")
            )
            timestamp_line = (
                f"Latest intraday bar: {updated}."
                if updated
                else "The market-data timestamp was not supplied."
            )

        source_line = f"Source: {source}."
        if quote_kind == "latest_intraday_bar":
            source_line += (
                " Some instruments may be delayed by the data provider; "
                "check the exchange quote before trading."
            )

        return "\n\n".join(
            part for part in (headline, movement, timestamp_line, source_line) if part
        )

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
        question = question.strip()
        if not self._is_finance_related(question, conversation):
            return (
                "I'm FinanceAI, so I can help with finance-related questions only — "
                "including personal finance, banking, credit and loans, insurance, "
                "taxes, accounting, investing, financial markets, business finance, "
                "and financial economics. Please ask me something in one of those areas."
            )

        intent = self._query_intent(question)
        market_data = None
        market_evidence = ""

        if intent in {"market_fact", "market_research"}:
            market_data = await self._get_market_data(question)
            if intent == "market_fact" and market_data:
                return self._market_fact_response(market_data)
            if intent == "market_fact" and market_data is None:
                lowered = question.lower()
                futures_request = any(
                    term in lowered
                    for term in ("future", "futures", "comex", "contract")
                )
                if re.search(r"\bgold\b", lowered) and not futures_request:
                    target_date = self._extract_date(question)
                    if target_date and target_date != date.today().isoformat():
                        return (
                            "I couldn't verify a historical international gold spot price "
                            "for that date. I won't substitute a COMEX futures price because "
                            "it is a different instrument."
                        )
                    return (
                        "I couldn't retrieve a fresh international gold spot quote just now. "
                        "I won't substitute a COMEX futures contract or an older closing price. "
                        "Please try again shortly. Local 22K/24K retail rates can also differ "
                        "by city, taxes and making charges."
                    )
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
        should_search = intent in {
            "ipo_research", "market_research", "market_explainer", "web_research"
        } or (intent == "market_fact" and market_data is None)

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
            and intent != "market_explainer"
            and not web_results
            and not web_pages
            and not market_evidence
        ):
            if intent == "ipo_research":
                return (
                    "I couldn't retrieve enough matching, authoritative information to confirm the "
                    "current IPO timeline. I don't want to give you an outdated date or imply that an "
                    "issue is still upcoming when it may already have opened, closed, or listed. "
                    "The reliable records are the issuer's RHP or prospectus and the relevant NSE/BSE "
                    "listing notices. The search service is not returning usable matching pages right "
                    "now, so this is a retrieval limitation rather than proof that no IPO exists."
                )
            if intent == "market_fact":
                return (
                    "I couldn't retrieve a verified current quote for that security just now. I don't "
                    "want to give you an old or guessed price. This does not mean the company is "
                    "unlisted; it means the live-quote and search sources did not return a usable "
                    "price in this request. Check the exact ticker on NSE or BSE before trading."
                )
            return (
                "I couldn't retrieve enough matching, current sources to answer this reliably. "
                "I have kept unrelated results out rather than filling the gaps with guesses. "
                "This can happen when the public search provider is temporarily unavailable; it "
                "doesn't by itself mean the company, product, or event has no information available."
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
            source_lines = ["\n\n**Sources**"]
            for item in web_results[:5]:
                title = getattr(item, "title", "") or "Source"
                url = getattr(item, "url", "") or ""
                parsed_url = urlsplit(url)
                if parsed_url.scheme in {"http", "https"} and parsed_url.netloc:
                    label = title.replace("[", "(").replace("]", ")")
                    source_lines.append(f"- [{label}]({url})")
            if len(source_lines) > 1:
                reply += "\n".join(source_lines)

        return reply

    @staticmethod
    def _preferred_domains(question: str) -> tuple[str, ...]:
        lowered = question.lower()
        if any(term in lowered for term in ("gst", "tds", "itr", "income tax india", "indian tax")):
            return (
                "incometax.gov.in",
                "incometaxindia.gov.in",
                "gst.gov.in",
                "cbic.gov.in",
                "rbi.org.in",
                "sebi.gov.in",
            )
        if any(term in lowered for term in ("irs", "us tax", "u.s. tax", "federal reserve")):
            return (
                "irs.gov",
                "treasury.gov",
                "federalreserve.gov",
                "sec.gov",
                "finra.org",
            )
        if any(term in lowered for term in ("sebi", "nse", "bse", "rbi", "repo rate", "indian bank")):
            return (
                "sebi.gov.in",
                "rbi.org.in",
                "nseindia.com",
                "bseindia.com",
                "financialservices.gov.in",
                "reuters.com",
            )
        if any(term in lowered for term in ("insurance", "irdai", "policy premium")):
            return (
                "irdai.gov.in",
                "rbi.org.in",
                "reuters.com",
            )
        if any(term in lowered for term in ("tax", "capital gains", "deduction")):
            return (
                "incometax.gov.in",
                "irs.gov",
                "gov.uk",
                "oecd.org",
                "reuters.com",
            )
        if any(term in lowered for term in ("jio", "jpl")):
            return (
                "nseindia.com",
                "bseindia.com",
                "sebi.gov.in",
                "jio.com",
                "ril.com",
                "reuters.com",
            )
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
        current_finance_topics = (
            "gst", "income tax", "capital gains tax", "tax slab", "tax rate",
            "tax deadline", "tax filing", "itr", "tds", "vat", "sebi", "rbi",
            "repo rate", "policy rate", "fd rate", "interest rate",
            "insurance regulation", "insurance rule", "contribution limit",
            "withdrawal limit", "exchange rate",
        )

        market_price_question = (
            AIService._market_type(text) is not None
            and any(term in lowered for term in ("price", "quote"))
            and any(term in lowered for term in ("stock", "share", "equity"))
        )
        market_explainer_question = (
            AIService._query_intent(text) == "market_explainer"
        )
        if (
            query is None
            and not any(signal in lowered for signal in web_signals)
            and not any(term in lowered for term in current_finance_topics)
            and not market_price_question
            and not market_explainer_question
        ):
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

        lowered_query = query.lower()
        explanatory_move_terms = (
            "why", "reason", "analysis", "fall", "fell", "dropped",
            "drop", "decline", "declined", "slump", "sell-off", "selloff",
        )
        is_explanatory_move = any(
            term in lowered_query for term in explanatory_move_terms
        )
        market_type = AIService._market_type(query)
        symbol = AIService._market_symbol(query, market_type or "")
        if (
            not is_explanatory_move
            and not market_explainer_question
            and market_type == "stock"
            and symbol
            and any(
                term in lowered_query
                for term in ("price", "share", "stock", "close", "quote")
            )
        ):
            target_date = AIService._extract_date(query)
            if target_date:
                return f"{symbol} historical stock price {target_date}"
            return f"{symbol} stock price today latest"

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

        if market_explainer_question:
            query = (
                f"{query} company overview stock listing status "
                f"{datetime.now().strftime('%B %Y')}"
            )
        elif any(term in query.lower() for term in (
            "latest", "today", "current", "now", "right now",
            "realtime", "real time", "recent"
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
- You are a finance-domain assistant, not a general-purpose chatbot. Stay within personal finance, banking, lending, credit, insurance, tax, accounting, investing, securities, markets, fintech/payments, corporate finance, financial planning, and finance-related economics.
- For an unrelated request, politely say you can help with finance topics only; do not perform the unrelated task.
- Answer the full range of finance questions, not only questions about this app's budgets or transactions. Support definitions, how-it-works explanations, examples, comparisons, calculations, financial statement interpretation, risk/reward explanations, planning, and evidence-based research.
- Do not assume every finance question is about the user's own accounts. Use private financial context only when the question explicitly asks about the user's or their household's finances.
- For calculations, show the formula, assumptions, units, and result. Re-check arithmetic and distinguish estimates from exact figures.
- For recommendations, explain trade-offs, material risks, and uncertainty; do not promise returns or present speculative outcomes as guaranteed.
- For tax, legal, regulatory, banking-rate, insurance-rule, and other jurisdiction-dependent questions, identify the relevant country/region when known and use current authoritative sources. Ask for the jurisdiction when it materially changes the answer.
- Use supplied evidence as the source of truth.
- Never invent current prices, dates, IPO status, transactions, balances, or news.
- For market facts, prefer structured market evidence over web snippets.
- For stock moves, compare direction and date with the structured quote before accepting the premise.
- Compare IPO event dates with today; say whether the issue is open, closed, allotted or listed.
- Date earlier-session coverage separately from today's quote; label reported causes versus speculation.
- Verify IPO dates against issuer, SEBI or exchange filings. Recognize DRHP, RHP, prospectus and allotment.
- Only use web pages and search results that clearly match the named entity and requested topic.
- Never repeat, cite, or append a source that does not support the user's exact question.
- If relevant evidence is unavailable, clearly say what could not be verified; do not fill the gap with guesses.
- For market explainers, explain the company/security in plain language.
  Do not claim listing status, a current ticker, or a price without supplied evidence.
- Reply like a knowledgeable finance assistant in a natural conversation,
  not like a compressed report template.
- Answer directly first, then explain the important context and why it matters.
- Use complete sentences and short paragraphs. Use bullets for timelines,
  comparisons, or multiple distinct points, not by default.
- For explanatory questions, usually provide around 150–250 words.
  Simple factual answers can be shorter.
- Avoid forced Summary/Key points/Next step headings unless they improve clarity.
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
