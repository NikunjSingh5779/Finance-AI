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

    @staticmethod
    def _contains_financial_topic(text: str) -> bool:
        """Recognize a broad range of personal, business, and market-finance topics."""
        lowered = " ".join(text.lower().split())
        finance_term_groups = (
            (
                "finance", "financial", "money", "monetary", "cash flow", "cashflow",
                "budget", "budgeting", "expense", "expenses", "spending", "income",
                "earnings", "salary", "wages", "paycheck", "savings", "saving",
                "saving money", "save money",
            ),
            (
                "invest", "investing", "investment", "investments", "portfolio",
                "asset allocation", "wealth management", "net worth", "retirement",
                "pension", "mutual fund", "mutual funds", "fund", "funds", "hedge fund",
                "hedge funds", "index fund", "sip", "dividend", "brokerage",
                "financial planning", "wealth planning", "financial advisor",
                "financial adviser", "estate planning", "inheritance planning",
                "trust fund", "annuity", "annuities",
            ),
            (
                "stock", "stocks", "share", "shares", "equity", "equities", "bond",
                "bonds", "etf", "ticker", "ipo", "initial public offering", "sebi",
                "rbi", "nse", "bse", "nasdaq", "nyse", "nifty", "sensex",
                "capital market", "financial market", "stock market", "money market",
                "market cap", "market capitalization", "market index", "stock index",
                "s&p 500", "dow jones", "ftse", "dax", "hang seng", "securities",
                "derivative", "derivatives", "futures", "options", "option trading",
                "hedging", "arbitrage", "option", "call option", "put option",
                "forward contract", "swap contract", "interest rate swap",
                "credit default swap", "derivative contract", "settlement", "clearing",
                "margin trading",
                "leverage", "short selling", "short position", "long position",
                "liquidity", "market maker", "order book", "yield", "treasury",
            ),
            (
                "crypto", "cryptocurrency", "bitcoin", "ethereum", "forex",
                "foreign exchange", "currency exchange", "exchange rate", "currency",
                "commodity", "commodities", "gold", "silver", "oil price",
            ),
            (
                "bank", "banking", "bank account", "savings account", "current account",
                "checking account", "fixed deposit", "recurring deposit", "term deposit",
                "fd", "rd", "upi", "payment", "payments", "payment gateway",
                "payment processor", "transaction", "transactions", "credit card",
                "debit card", "credit score", "credit history", "overdraft",
                "money market account", "open banking", "fintech", "remittance",
                "remittances",
            ),
            (
                "loan", "loans", "student loan", "student loans", "mortgage", "emi",
                "interest", "compound interest", "apr", "apy", "principal",
                "repayment", "lending", "borrowing", "debt", "liability", "liabilities",
                "buy now pay later", "bnpl",
            ),
            (
                "tax", "taxes", "taxation", "income tax", "capital gains", "gst", "vat",
                "tds", "deduction", "deductions", "tax slab", "tax return", "itr",
                "tax filing", "estate tax", "inheritance tax",
            ),
            (
                "insurance", "premium", "premiums", "policyholder", "claim", "claims",
                "coverage", "life cover", "health cover", "irdai",
            ),
            (
                "accounting", "bookkeeping", "balance sheet", "income statement",
                "profit and loss", "p&l", "revenue", "profit", "profitability", "margin",
                "cash flow statement", "financial statement", "financial statements",
                "financial ratio", "valuation", "ebitda", "working capital",
                "depreciation", "amortization", "audit", "reconciliation",
                "accounts payable", "accounts receivable", "working paper",
            ),
            (
                "pe ratio", "p/e ratio", "price to earnings", "price to book",
                "book value", "capm", "wacc", "dcf", "npv", "irr", "roi", "roe",
                "roa", "cagr", "eps", "fcf", "gaap", "ifrs", "discounted cash flow",
                "net present value", "internal rate of return", "return on investment",
                "return on equity", "return on assets",
                "weighted average cost of capital", "free cash flow",
            ),
            (
                "risk management", "financial risk", "risk adjusted", "venture capital",
                "private equity", "merger", "acquisition", "m&a", "corporate finance",
                "business finance", "financial model", "financial modelling",
                "financial modeling", "microfinance", "actuarial", "actuary",
                "startup funding",
            ),
            (
                "ira", "401k", "401(k)", "403b", "403(b)", "529 plan", "529", "hsa",
                "fsa", "retirement account", "certificate of deposit",
                "treasury bill", "t bill", "commercial paper", "cds",
            ),
            (
                "aml", "kyc", "anti money laundering", "money laundering",
                "financial crime", "fraud prevention",
            ),
            (
                "inflation", "deflation", "recession", "gdp", "monetary policy",
                "fiscal policy", "macroeconomics", "economic growth", "economy",
                "economics", "central bank", "repo rate", "policy rate",
            ),
        )
        return any(
            re.search(
                r"(?<![a-z0-9])(?:"
                + "|".join(re.escape(term) for term in group)
                + r")(?![a-z0-9])",
                lowered,
            )
            for group in finance_term_groups
        )

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
            "what finance topics can you help me with",
        }
        return lowered in greetings or lowered in help_requests

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

    @staticmethod
    def _is_finance_related(
        question: str,
        conversation: list[dict[str, str]] | None = None,
    ) -> bool:
        """Classify finance topics without restricting the assistant to finance."""
        return (
            AIService._contains_financial_topic(question)
            or AIService._is_greeting_or_finance_help(question)
            or AIService._is_contextual_finance_follow_up(question, conversation)
        )

    @staticmethod
    def _is_travel_planning_query(question: str) -> bool:
        """Identify travel requests that benefit from current transport and destination research."""
        lowered = " ".join(question.lower().split())
        travel_terms = (
            "travel", "trip", "itinerary", "tour", "tourism", "tourist",
            "train", "railway", "irctc", "flight", "airline", "bus route",
            "road trip", "hotel", "hostel", "destination", "vacation",
            "holiday", "how to reach", "how do i get to", "route to",
            "train ticket", "travel from",
        )
        return any(
            re.search(r"(?<![a-z0-9])" + re.escape(term) + r"(?![a-z0-9])", lowered)
            for term in travel_terms
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
    def _is_current_price_request(question: str) -> bool:
        """Detect a request for the live/traded price, not an IPO issue price band."""
        lowered = question.lower()
        if re.search(r"\b(issue price|offer price|price band)\b", lowered) and not re.search(
            r"\b(share price|stock price|trading at)\b",
            lowered,
        ):
            return False
        has_price = bool(re.search(
            r"\b(price|quote|trading at|share price|stock price)\b",
            lowered,
        ))
        has_freshness = bool(re.search(
            r"\b(now|today|current|latest|right now|live)\b",
            lowered,
        ))
        return has_price and has_freshness

    @staticmethod
    def _query_intent(
        question: str,
        conversation: list[dict[str, str]] | None = None,
    ) -> str:
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

        if AIService._is_travel_planning_query(question):
            return "general_research"

        if AIService._needs_personal_context(question):
            return "personal_finance"

        if not AIService._is_finance_related(question, conversation):
            return "general_knowledge"

        return "finance_education"

    @staticmethod
    def _needs_personal_context(question: str) -> bool:
        """Attach account data only for clear personal-finance or transaction questions."""
        lowered = question.lower()
        owned_financial_data = (
            "finance", "finances", "money", "cash", "budget", "expense",
            "expenses", "spending", "income", "salary", "savings", "balance",
            "account", "accounts", "transaction", "transactions", "net worth",
            "cash flow", "financial health", "goal", "goals", "debt", "loan",
            "credit card", "insurance policy", "tax return", "portfolio",
            "investment account",
        )
        ownership_reference = re.search(
            r"\b(my|mine|our|ours)\b",
            lowered,
        )
        owned_data_reference = ownership_reference and re.search(
            r"\b(?:"
            + "|".join(re.escape(term) for term in owned_financial_data)
            + r")\b",
            lowered[ownership_reference.start():],
        )
        personal_money_movement = re.search(
            r"\b(i|we)\b.{0,45}\b(spent|spend|spending|paid|received|earned|"
            r"deposited|withdrew|transferred)\b",
            lowered,
        )
        direct_question = any(
            phrase in lowered
            for phrase in ("for my own finances", "based on my finances", "based on our finances")
        )
        return bool(owned_data_reference or personal_money_movement or direct_question)

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
        intent = self._query_intent(question, conversation)
        market_data = None
        market_evidence = ""

        include_current_quote = (
            intent == "ipo_research"
            and self._is_current_price_request(question)
        )
        if intent in {"market_fact", "market_research"} or include_current_quote:
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
            "ipo_research", "market_research", "market_explainer",
            "web_research", "general_research",
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

        # Do not ask the model to guess when current-information research has no evidence.
        if (
            should_search
            and intent not in {"market_explainer", "general_research"}
            and not web_results
            and not web_pages
        ):
            if intent == "ipo_research":
                if market_data:
                    quote = self._market_fact_response(market_data)
                    return (
                        quote
                        + "\n\nI couldn't verify the IPO timeline or issue-price details "
                        "from matching prospectus or exchange records in this request. "
                        "The quote above is the traded share price, not the IPO issue price."
                    )
                previous_fallback = next(
                    (
                        str(message.get("content", "")).strip()
                        for message in reversed(conversation or [])
                        if message.get("role") == "assistant" and message.get("content")
                    ),
                    "",
                )
                if "couldn't retrieve enough matching" in previous_fallback.lower():
                    return (
                        "I still can't retrieve the official Jio IPO documents from the "
                        "search providers. I won't guess the dates or issue price. "
                        "Please retry shortly, or check the issuer's RHP and NSE/BSE notices."
                    )
                return (
                    "I couldn't retrieve enough matching, authoritative information to confirm the "
                    "IPO timeline or issue price right now. I won't guess whether the issue is open "
                    "or listed. The best records are the issuer's RHP/prospectus and the official "
                    "NSE/BSE listing notices. This is a search-provider limitation, not evidence "
                    "that the IPO does not exist."
                )
            if not market_evidence:
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
            include_financial_context=(
                self._needs_personal_context(question)
                and intent not in {"general_knowledge", "general_research"}
            ),
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
        if AIService._is_travel_planning_query(question):
            if any(term in lowered for term in ("train", "railway", "irctc")):
                railway_domains = (
                    "irctc.co.in",
                    "indianrail.gov.in",
                    "indianrailways.gov.in",
                )
                if any(term in lowered for term in ("himachal", "shimla", "manali", "dharamshala")):
                    return railway_domains + (
                        "himachaltourism.gov.in",
                        "himachal.nic.in",
                        "incredibleindia.gov.in",
                    )
                return railway_domains
            return (
                "himachaltourism.gov.in",
                "himachal.nic.in",
                "incredibleindia.gov.in",
            )
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
        if AIService._is_current_price_request(query):
            candidates += (
                f"{issuer} current NSE BSE share price JPL exchange quote {year}",
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

        ipo_research_text = query or text
        ipo_terms = (
            "ipo", "drhp", "rhp", "prospectus", "sebi filing",
            "listing date", "ipo date", "public issue",
        )
        if any(term in ipo_research_text.lower() for term in ipo_terms):
            issuer_text = ipo_research_text.lower()
            if re.search(r"\b(jio|jpl)\b", issuer_text):
                year = re.search(r"\b20\d{2}\b", ipo_research_text)
                year_text = year.group(0) if year else str(datetime.now().year)
                ipo_query = (
                    "Jio Platforms Limited IPO RHP SEBI listing status issue price "
                    + year_text
                )
                return ipo_query

        travel_question = AIService._is_travel_planning_query(text)
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
            and not travel_question
        ):
            return None

        query = query or text
        if travel_question and query == text:
            travel_suffix = "travel routes transport options fares journey duration"
            if re.search(r"\btrain\b|\brailway\b|\birctc\b", lowered):
                travel_suffix += " Indian Railways train timetable IRCTC"
            query = f"{query} {travel_suffix} {datetime.now().year}"

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
        period = context.get("period") or {}
        period_start = str(period.get("start_date") or "")
        period_end = str(period.get("end_date") or "")
        period_label = (
            f"{period_start} to {period_end}"
            if period_start and period_end
            else "the current reporting period"
        )

        recent_text = "\n".join(
            f"- {item.get('date')}: {item.get('description')} | "
            f"{item.get('category')} | {item.get('type')} | "
            f"₹{item.get('amount')}"
            for item in recent
        ) or "- No recent transactions"

        budget_limits: dict[str, float] = {}
        for item in budgets:
            category = str(item.get("category") or "").strip()
            if not category:
                continue
            try:
                budget_limits[category.casefold()] = float(item.get("limit_amt") or 0)
            except (TypeError, ValueError):
                continue

        category_totals = summary.get("category_totals") or {}
        category_lines: list[str] = []
        if isinstance(category_totals, dict):
            sorted_categories = sorted(
                category_totals.items(),
                key=lambda item: float(item[1] or 0),
                reverse=True,
            )
            for category, raw_spend in sorted_categories[:10]:
                try:
                    spent = float(raw_spend or 0)
                except (TypeError, ValueError):
                    continue
                limit = budget_limits.get(str(category).strip().casefold())
                if limit is not None and limit > 0:
                    usage = f"{spent / limit * 100:.1f}%"
                    budget_value = f"₹{limit:.2f}"
                else:
                    usage = "not available (no positive budget limit)"
                    budget_value = "not set"
                category_lines.append(
                    f"- {category}: ₹{spent:.2f} spent; "
                    f"monthly budget {budget_value}; budget used {usage}"
                )
        category_spending_text = "\n".join(category_lines) or (
            "- No category spending totals available"
        )

        budget_text = "\n".join(
            f"- {item.get('category')}: ₹{item.get('limit_amt')}/month"
            for item in budgets
        ) or "- No budgets configured"

        history_messages = (conversation or [])[-4:]
        if intent in {"general_knowledge", "general_research"}:
            # A prior assistant reply can repeat private figures without finance
            # keywords, so discard the recent history if any turn is financial.
            financial_history = any(
                self._contains_financial_topic(str(message.get("content", "")))
                or self._needs_personal_context(str(message.get("content", "")))
                for message in history_messages
            )
            if financial_history:
                history_messages = []
        history_text = "\n".join(
            f"{'Assistant' if message.get('role') == 'assistant' else 'User'}: "
            f"{message.get('content', '')}"
            for message in history_messages
        ) or "- None"

        from app.services.web_research_service import WebResearchService
        web_text = WebResearchService.format_evidence(
            web_results or [],
            web_pages or [],
            max_chars=6000,
        ) or "- No web results"

        personal_section = (
            f"""CURRENT PERIOD FINANCIAL SUMMARY
Reporting period: {period_label}
Income: ₹{summary.get('income', 0):.2f}
Expenses: ₹{summary.get('expense', 0):.2f}
Net cash flow: ₹{summary.get('balance', 0):.2f}
Savings rate: {summary.get('savings_rate', 0):.1f}%

CATEGORY SPENDING TOTALS
These are authoritative, aggregated expense totals for the reporting period.
Use these figures for the spending table; do not estimate category totals from
the shorter recent-transactions sample.
{category_spending_text}

RECENT TRANSACTIONS (examples only)
{recent_text}

BUDGETS
{budget_text}

"""
            if include_financial_context
            else ""
        )

        lowered_question = question.lower()
        overview_terms = (
            "financial health",
            "spending analysis",
            "spending breakdown",
            "budget overview",
            "financial overview",
            "financial summary",
            "analyze my finances",
            "analyse my finances",
            "how am i doing financially",
            "overall financial",
        )
        is_personal_overview = include_financial_context and any(
            term in lowered_question for term in overview_terms
        )

        if is_personal_overview:
            response_format = f"""PERSONAL FINANCIAL OVERVIEW RESPONSE FORMAT
The user is asking for an assessment or analysis of their own finances. Match
this clean, structured Markdown layout every time:
1. Begin with one brief sentence giving the overall assessment.
2. Add the heading "## Financial Overview".
3. Show these metrics as a compact bullet list, using bold labels:
   - **Monthly Income**
   - **Period Expenses**
   - **Net Cash Flow**
   - **Savings Rate**
   Use the supplied values exactly and format INR amounts clearly.
4. Add the heading "## Recent Spending ({period_label})".
5. Add a Markdown table with exactly these columns:
   | Category | Amount | Monthly Budget | % of Budget Used |
   Populate it from CATEGORY SPENDING TOTALS. Use the supplied spend, budget,
   and usage values. Use an em dash when no positive budget exists. Do not
   invent categories, amounts, limits, percentages, or missing transactions.
6. Add "## What This Means" with two or three concise, evidence-based bullets
   explaining the user's cash flow, savings rate, and largest spending areas.
7. Add "## Recommended Actions" with up to three practical actions when useful.
   Do not pad the report with generic advice or repeat the metric list.
Use Markdown headings, bold text, bullets, and a real pipe-delimited Markdown
table. Do not return the report as plain paragraphs or as a code block.
"""
        elif include_financial_context:
            response_format = """PERSONAL FINANCE RESPONSE FORMAT
Use Markdown formatting rather than a wall of prose. Answer the precise
question first. Present relevant account figures as concise bullets with bold
labels, show calculations when useful, and use a Markdown table for a genuine
category or period comparison. Only include personal figures supplied in the
financial context; do not add unrelated overview sections to a narrow question.
"""
        elif intent in {"general_knowledge", "general_research"}:
            response_format = """GENERAL ASSISTANT RESPONSE FORMAT
Answer the question directly and helpfully, even when it is unrelated to
personal finance. Use concise headings, steps, bullets, or a comparison table
when they make the answer easier to act on. For travel planning, organize the
answer around route options, journey time, trip length, transport, stay, food,
local travel, and a realistic budget breakdown. For a fixed budget, estimate
how many days it can reasonably cover and show transport, accommodation, food,
local travel, activities, and contingency separately. State assumptions about
traveller count and trip style. Clearly distinguish sourced live schedules and
fares from approximate planning estimates.
"""
        else:
            response_format = """FINANCE EDUCATION / RESEARCH RESPONSE FORMAT
Use readable Markdown structure. Answer directly first, then use short
headings, bullets, numbered steps, or a comparison table where they materially
improve clarity. Keep explanations complete but avoid a single long paragraph.
For current or regulated facts, clearly label dates, jurisdiction, uncertainty,
and supporting sources. Do not force a personal-finance summary into a general
finance answer.
"""

        return f"""You are FinanceAI, a helpful general-purpose assistant with strong personal-finance expertise.
Today is {date.today().isoformat()}.
Query intent: {intent}.

Rules:
- Help with general knowledge and practical topics such as travel, technology,
  education, everyday planning, writing, and personal finance.
- Never refuse a request solely because it is outside finance.
- Use private financial context only when the user explicitly asks about their
  own or their household's finances. Do not expose account, budget, or
  transaction data in unrelated answers.
- For travel planning, give practical route options and a transparent budget
  breakdown. When the destination or travel dates are unclear, state reasonable
  assumptions and give a useful starter itinerary instead of refusing.
- Do not invent train schedules, seat availability, fares, opening hours,
  current prices, rules, or other time-sensitive facts. Use supplied sources
  for current details; label estimates and say what still needs verification.
- Answer the full range of finance questions, not only questions about this
  app's budgets or transactions. Support definitions, explanations, examples,
  comparisons, calculations, statement interpretation, risk analysis, planning,
  and evidence-based research.
- Do not assume every finance question is about the user's own accounts.
  Use private financial context only when the question explicitly asks about
  the user's or their household's finances.
- For financial calculations, show the formula, assumptions, units, and result.
  Re-check arithmetic and distinguish estimates from exact figures.
- For financial recommendations, explain trade-offs, material risks, and uncertainty.
  Never promise returns or present speculative outcomes as guaranteed.
- For tax, legal, regulatory, banking-rate, insurance-rule, and other
  jurisdiction-dependent questions, identify the relevant country/region
  when known and use current authoritative sources. Ask for the jurisdiction
  when it materially changes the answer.
- Use supplied evidence as the source of truth.
- Never invent current prices, dates, IPO status, transactions, balances, or news.
- For market facts, prefer structured market evidence over web snippets.
- For stock moves, compare direction and date with the structured quote before accepting the premise.
- Compare IPO event dates with today; say whether the issue is open, closed, allotted or listed.
- Date earlier-session coverage separately from today's quote; label reported causes versus speculation.
- Verify IPO dates against issuer, SEBI or exchange filings. Recognize DRHP, RHP, prospectus and allotment.
- When an IPO question also asks for a current price, report the live/last-traded exchange quote separately from the IPO issue price or price band. Never treat one as the other; state the quote timestamp and whether it is live, delayed, or a dated close.
- Only use web pages and search results that clearly match the named entity and requested topic.
- Never repeat, cite, or append a source that does not support the user's exact question.
- If relevant evidence is unavailable, clearly say what could not be verified; do not fill the gap with guesses.
- For market explainers, explain the company/security in plain language.
  Do not claim listing status, a current ticker, or a price without supplied evidence.
- Answer directly first and explain the important context and why it matters.
- Keep the tone natural and conversational; write in a natural conversation style.
- Use complete sentences. Keep paragraphs concise and avoid repeating the question.
- For explanatory questions, provide enough detail to answer fully; simple facts
  can be brief and complex topics can be longer.
- Do not claim that an answer is complete when evidence is missing.

{response_format}
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
