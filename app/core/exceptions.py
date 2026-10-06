"""Application-level exceptions for the FinanceAI application."""

from typing import Optional


class FinanceAIError(Exception):
    """Base exception for FinanceAI."""

    def __init__(self, message: str, details: Optional[dict] = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}


class NotFoundError(FinanceAIError):
    """Resource was not found."""


class AccountNotFoundError(NotFoundError):
    def __init__(self, account_id: int):
        super().__init__(
            f"Account with id {account_id} not found",
            {"account_id": account_id},
        )


class TransactionNotFoundError(NotFoundError):
    def __init__(self, transaction_id: int):
        super().__init__(
            f"Transaction with id {transaction_id} not found",
            {"transaction_id": transaction_id},
        )


class BudgetNotFoundError(NotFoundError):
    def __init__(self, category: str):
        super().__init__(
            f"Budget for category '{category}' not found",
            {"category": category},
        )


class ValidationError(FinanceAIError):
    """Application input or business validation failed."""


class InvalidAccountTypeError(ValidationError):
    def __init__(self, account_type: str, valid_types: list[str]):
        super().__init__(
            f"Invalid account type '{account_type}'. "
            f"Valid types: {', '.join(valid_types)}",
            {"account_type": account_type, "valid_types": valid_types},
        )


class InvalidTransactionError(ValidationError):
    def __init__(self, message: str, details: Optional[dict] = None):
        super().__init__(f"Invalid transaction: {message}", details)


class DuplicateTransactionError(ValidationError):
    def __init__(self, description: str, amount: float, date: str):
        super().__init__(
            f"Duplicate transaction detected: {description} (₹{amount} on {date})",
            {"description": description, "amount": amount, "date": date},
        )


class AccountDeletionError(ValidationError):
    def __init__(self, account_id: int, transaction_count: int):
        super().__init__(
            f"Cannot delete account {account_id}: {transaction_count} "
            "linked transactions exist. Delete or reassign transactions first.",
            {"account_id": account_id, "transaction_count": transaction_count},
        )


class ProviderError(FinanceAIError):
    """External provider error."""


class ProviderUnavailableError(ProviderError):
    def __init__(self, provider: str, reason: Optional[str] = None):
        message = f"AI provider '{provider}' is unavailable"
        if reason:
            message += f": {reason}"
        super().__init__(
            message,
            {"provider": provider, "reason": reason},
        )


class PredictionUnavailableError(ProviderError):
    def __init__(self, reason: str):
        super().__init__(
            f"Prediction unavailable: {reason}",
            {"reason": reason},
        )


class ImportValidationError(ValidationError):
    def __init__(self, errors: list):
        super().__init__(
            f"CSV import validation failed: {len(errors)} errors",
            {"errors": errors},
        )


class RateLimitError(FinanceAIError):
    def __init__(self, retry_after: Optional[int] = None):
        message = "Rate limit exceeded"
        if retry_after:
            message += f". Retry after {retry_after} seconds"
        super().__init__(message, {"retry_after": retry_after})


class InsufficientDataError(FinanceAIError):
    def __init__(
        self,
        message: str = "Insufficient data for calculation",
        details: Optional[dict] = None,
    ):
        super().__init__(message, details)


class GoalNotFoundError(NotFoundError):
    def __init__(self, goal_id: int):
        super().__init__(
            f"Goal with id {goal_id} not found",
            {"goal_id": goal_id},
        )
