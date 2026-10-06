from typing import Any

from pydantic import BaseModel, Field

from app.schemas.transaction import TransactionCreate, TransactionUpdate, TransactionOut
from app.schemas.account import AccountCreate, AccountUpdate, AccountOut


class TransactionIn(TransactionCreate):
    """Backward-compatible alias for legacy imports."""


class AccountIn(AccountCreate):
    """Backward-compatible alias for legacy imports."""


class BudgetIn(BaseModel):
    category: str = Field(min_length=1, max_length=50)
    limit_amt: float = Field(gt=0)


class AIQuery(BaseModel):
    question: str = Field(min_length=3, max_length=500)
    transactions: list[dict[str, Any]] = Field(default_factory=list)
    summary: dict[str, Any] = Field(default_factory=dict)
    budgets: list[dict[str, Any]] = Field(default_factory=list)


__all__ = [
    "TransactionIn",
    "TransactionCreate",
    "TransactionUpdate",
    "TransactionOut",
    "AccountIn",
    "AccountCreate",
    "AccountUpdate",
    "AccountOut",
    "BudgetIn",
    "AIQuery",
]
