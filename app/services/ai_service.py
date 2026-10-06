"""AI service for handling AI-related operations."""

from typing import Dict, Any, Optional
from app.core.exceptions import ProviderUnavailableError, InsufficientDataError
from app.providers.ai.discovery import get_ai_provider
from app.providers.ai.base import AIProvider
import logging

logger = logging.getLogger(__name__)


class AIService:
    """Service for AI operations."""

    def __init__(self):
        """Initialize the AI service."""
        self.provider: Optional[AIProvider] = None
        self._initialize_provider()

    def _initialize_provider(self) -> None:
        """Initialize the AI provider."""
        try:
            self.provider = get_ai_provider()
        except Exception as e:
            logger.warning(f"Failed to initialize AI provider: {e}")
            self.provider = None

    def is_available(self) -> bool:
        """Check if AI service is available."""
        return self.provider is not None

    async def get_financial_advice(
        self,
        question: str,
        financial_context: Dict[str, Any]
    ) -> str:
        """
        Get financial advice from the AI provider.

        Args:
            question: The user's question
            financial_context: Financial context from the database

        Returns:
            AI-generated advice

        Raises:
            ProviderUnavailableError: If no AI provider is available
        """
        if not self.is_available():
            raise ProviderUnavailableError("No AI provider available")

        try:
            # Build the prompt with financial context
            prompt = self._build_prompt(question, financial_context)
            response = self.provider.generate_response(prompt)
            return response
        except Exception as e:
            logger.error(f"Error generating AI response: {e}")
            raise ProviderUnavailableError(f"AI provider error: {str(e)}")

    def _build_prompt(self, question: str, financial_context: Dict[str, Any]) -> str:
        """
        Build a prompt for the AI provider with financial context.

        Args:
            question: The user's question
            financial_context: Financial context from the database

        Returns:
            Formatted prompt string
        """
        context_parts = []

        # Add financial summary if available
        if financial_context.get("summary"):
            summary = financial_context["summary"]
            context_parts.append(
                f"Financial Summary: "
                f"Income: {summary.get('income', 0)}, "
                f"Expenses: {summary.get('expense', 0)}, "
                f"Balance: {summary.get('balance', 0)}, "
                f"Savings Rate: {summary.get('savings_rate', 0)}%"
            )

        # Add recent transactions if available
        if financial_context.get("recent_transactions"):
            transactions = financial_context["recent_transactions"][:5]  # Limit to 5
            txn_descriptions = [
                f"- {txn.get('description', '')}: {txn.get('amount', 0)} ({txn.get('type', '')})"
                for txn in transactions
            ]
            context_parts.append("Recent Transactions:\n" + "\n".join(txn_descriptions))

        # Add budgets if available
        if financial_context.get("budgets"):
            budgets = financial_context["budgets"]
            budget_descriptions = [
                f"- {budget.get('category', '')}: {budget.get('limit_amt', 0)}"
                for budget in budgets
            ]
            context_parts.append("Budgets:\n" + "\n".join(budget_descriptions))

        context = "\n".join(context_parts) if context_parts else "No financial context available."

        prompt = f"""You are a helpful personal finance assistant.
{context}

User Question: {question}

Please provide practical, actionable financial advice based on the user's question and their financial context.
Consider the Indian financial context (INR, common expenses, etc.).
Be helpful, non-judgmental, and focused on the user's financial goals.
"""
        return prompt