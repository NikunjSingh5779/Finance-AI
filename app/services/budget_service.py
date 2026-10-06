from datetime import datetime
from typing import List

from app.core.exceptions import BudgetNotFoundError, ValidationError
from app.repositories.budget_repository import BudgetRepository
from app.repositories.transaction_repository import TransactionRepository
from app.schemas.budget import BudgetCreate, BudgetOut, BudgetUpdate
from app.utils.dates import get_period_bounds


class BudgetService:
    """Business rules for budgets and budget utilization."""

    VALID_PERIODS = {"1m", "3m", "6m", "1y", "all"}

    def __init__(
        self,
        budget_repo: BudgetRepository,
        transaction_repo: TransactionRepository,
    ):
        self.budget_repo = budget_repo
        self.transaction_repo = transaction_repo

    def list_budgets(self) -> List[BudgetOut]:
        return self.budget_repo.list()

    def get_budget(self, category: str) -> BudgetOut:
        budget = self.budget_repo.get(category.strip())
        if budget is None:
            raise BudgetNotFoundError(category)
        return budget

    def create_budget(self, budget: BudgetCreate) -> BudgetOut:
        return self.budget_repo.create(budget)

    def update_budget(self, category: str, budget: BudgetUpdate) -> BudgetOut:
        updated = self.budget_repo.update(category.strip(), budget)
        if updated is None:
            raise BudgetNotFoundError(category)
        return updated

    def delete_budget(self, category: str) -> bool:
        deleted = self.budget_repo.delete(category.strip())
        if not deleted:
            raise BudgetNotFoundError(category)
        return deleted

    def get_budget_status(self, category: str, period: str = "1m") -> dict:
        period = period.strip().lower()
        if period not in self.VALID_PERIODS or period == "all":
            raise ValidationError("Budget status period must be one of: 1m, 3m, 6m, 1y")

        budget = self.get_budget(category)
        start_date, end_date = get_period_bounds(period)
        spent = self.transaction_repo.expense_total_for_category(
            budget.category, start_date, end_date
        )

        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        period_start = datetime.strptime(start_date, "%Y-%m-%d")
        period_end = datetime.strptime(end_date, "%Y-%m-%d")
        elapsed_end = min(today, period_end)
        days_elapsed = max(1, (elapsed_end - period_start).days + 1)
        days_in_period = max(1, (period_end - period_start).days + 1)
        daily_rate = spent / days_elapsed
        projected_spend = daily_rate * days_in_period

        utilization = (spent / budget.limit_amt) * 100
        status = (
            "Exceeded"
            if spent >= budget.limit_amt
            else "Warning"
            if spent >= budget.limit_amt * 0.8
            else "Healthy"
        )
        remaining = budget.limit_amt - spent

        return {
            "category": budget.category,
            "period": period,
            "start_date": start_date,
            "end_date": end_date,
            "limit": round(budget.limit_amt, 2),
            "spent": round(spent, 2),
            "remaining": round(remaining, 2),
            "utilization_percent": round(utilization, 2),
            "status": status,
            "projected_spend": round(projected_spend, 2),
            "projected_overrun": round(max(0.0, projected_spend - budget.limit_amt), 2),
            "is_projection": True,
        }
