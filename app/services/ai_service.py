"""Application service for AI-assisted financial advice."""

import asyncio
from datetime import datetime
from typing import Any

from app.providers.search.duckduckgo import get_searcher

from app.core.exceptions import ProviderUnavailableError
from app.providers.ai.base import AIProvider
from app.providers.ai.discovery import get_ai_provider
from app.repositories.analytics_repository import AnalyticsRepository
from app.repositories.budget_repository import BudgetRepository
from app.repositories.transaction_repository import TransactionRepository


class AIService:
    """Build trusted financial context and delegate generation to a provider."""

    def __init__(self, provider: AIProvider | None = None):
        self.provider = provider if provider is not None else get_ai_provider()

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
        if not self.available:
            raise ProviderUnavailableError(
                "ai",
                "No configured provider is available",
            )

        web_results: list[Any] = []
        search_query = self._extract_web_search_query(question)

        if search_query:
            try:
                # Fresh web lookup happens before generation. For time-sensitive
                # queries, add today's date/year so search results bias toward
                # current information.
                searcher = get_searcher()
                web_results = await searcher.search(
                    search_query,
                    max_results=5,
                    timelimit="d" if self._is_fresh_query(question) else None,
                )
            except Exception:
                web_results = []

        prompt = self._build_prompt(
            question,
            financial_context,
            conversation,
            web_results=web_results,
        )

        try:
            response = await asyncio.to_thread(
                self.provider.generate_response,
                prompt,
            )
        except Exception as exc:
            raise ProviderUnavailableError("ai", str(exc)) from exc

        if not isinstance(response, str) or not response.strip():
            raise ProviderUnavailableError(
                "ai",
                "Provider returned an empty response",
            )

        reply = response.strip()

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

        web_text = "\n".join(
            f"{index}. {getattr(item, 'title', '')} | {getattr(item, 'url', '')}\n"
            f"   {getattr(item, 'snippet', '')}"
            for index, item in enumerate((web_results or [])[:5], start=1)
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

WEB SEARCH RESULTS
These results are available only when the user explicitly requested a web search.
Prefer these fresh results for time-sensitive claims. Do not invent information not supported by them.
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
