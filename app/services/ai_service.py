"""Application service for AI-assisted financial advice."""

import asyncio
from typing import Any

from app.core.exceptions import ProviderUnavailableError
from app.providers.ai.base import AIProvider
from app.providers.ai.discovery import get_ai_provider
from app.repositories.analytics_repository import AnalyticsRepository
from app.repositories.budget_repository import BudgetRepository
from app.repositories.transaction_repository import TransactionRepository


class AIService:
    """Build trusted financial context and delegate generation to a provider."""

    def __init__(self, provider: AIProvider | None = None):
        self.provider = provider or get_ai_provider()

    @property
    def available(self) -> bool:
        return self.provider is not None and self.provider.is_available()

    def build_context(
        self,
        analytics: AnalyticsRepository,
        transactions: TransactionRepository,
        budgets: BudgetRepository,
    ) -> dict[str, Any]:
        current_start, current_end = self._current_period()
        summary = {
            **analytics.summary_totals(current_start, current_end),
            "category_totals": analytics.category_totals(current_start, current_end),
        }
        income = summary["income"]
        expense = summary["expense"]
        summary["balance"] = income - expense
        summary["savings_rate"] = (
            ((income - expense) / income) * 100 if income else 0.0
        )

        recent = [
            item.model_dump()
            for item in transactions.list(skip=0, limit=20)
        ]
        return {
            "summary": summary,
            "recent_transactions": recent,
            "budgets": [budget.model_dump() for budget in budgets.list()],
        }

    async def get_financial_advice(
        self,
        question: str,
        financial_context: dict[str, Any],
        conversation: list[dict[str, str]] | None = None,
    ) -> str:
        if not self.available:
            raise ProviderUnavailableError("ai", "No configured provider is available")

        prompt = self._build_prompt(question, financial_context, conversation)
        try:
            return await asyncio.to_thread(self.provider.generate_response, prompt)
        except Exception as exc:
            raise ProviderUnavailableError("ai", str(exc)) from exc

    def _build_prompt(
        self,
        question: str,
        context: dict[str, Any],
        conversation: list[dict[str, str]] | None,
    ) -> str:
        summary = context.get("summary", {})
        recent = context.get("recent_transactions", [])[:10]
        budgets = context.get("budgets", [])

        recent_text = "
".join(
            f"- {item.get('date')}: {item.get('description')} | "
            f"{item.get('category')} | {item.get('type')} | ₹{item.get('amount')}"
            for item in recent
        ) or "- No recent transactions"

        budget_text = "
".join(
            f"- {item.get('category')}: ₹{item.get('limit_amt')}/month"
            for item in budgets
        ) or "- No budgets configured"

        history_text = ""
        for message in (conversation or [])[-8:]:
            role = "Assistant" if message.get("role") == "assistant" else "User"
            history_text += f"{role}: {message.get('content', '')}
"

        return f"""You are FinanceAI, a practical personal-finance assistant for an Indian user.
Use only the supplied financial facts. Clearly label estimates and do not promise investment returns.
Do not invent transactions, account balances, prices, market facts, or personal information.
Prefer actionable budgeting and cash-flow advice. Use INR (₹).

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
{history_text or '- None'}

USER QUESTION
{question}

Answer concisely with practical next steps. When the question is investment-related, explain risks and avoid guarantees.
"""

    @staticmethod
    def _current_period() -> tuple[str, str]:
        from datetime import datetime

        now = datetime.now()
        return now.replace(day=1).strftime("%Y-%m-%d"), now.strftime("%Y-%m-%d")
