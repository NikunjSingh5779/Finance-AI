from typing import List, Optional
from app.repositories.budget_repository import BudgetRepository
from app.repositories.transaction_repository import TransactionRepository
from app.schemas.budget import BudgetCreate, BudgetUpdate, BudgetOut
from app.core.exceptions import BudgetNotFoundError
from app.utils.dates import get_period_bounds

class BudgetService:
    def __init__(self, budget_repo: BudgetRepository, transaction_repo: TransactionRepository):
        self.budget_repo = budget_repo
        self.transaction_repo = transaction_repo

    def list_budgets(self) -> List[BudgetOut]:
        return self.budget_repo.list()

    def get_budget(self, category: str) -> BudgetOut:
        budget = self.budget_repo.get(category)
        if budget is None:
            raise BudgetNotFoundError(f"Budget for category '{category}' not found")
        return budget

    def create_budget(self, budget: BudgetCreate) -> BudgetOut:
        return self.budget_repo.create(budget)

    def update_budget(self, category: str, budget: BudgetUpdate) -> BudgetOut:
        updated_budget = self.budget_repo.update(category, budget)
        if updated_budget is None:
            raise BudgetNotFoundError(f"Budget for category '{category}' not found")
        return updated_budget

    def delete_budget(self, category: str) -> bool:
        deleted = self.budget_repo.delete(category)
        if not deleted:
            raise BudgetNotFoundError(f"Budget for category '{category}' not found")
        return deleted

    def get_budget_status(self, category: str, period: str = "1m") -> dict:
        """Get budget status with spending and remaining amount for a given period."""
        budget = self.get_budget(category)

        # Get period bounds
        start_date, end_date = get_period_bounds(period)

        # Get expenses for this category in the period
        expenses = self.transaction_repo.list_by_date_range(start_date, end_date)
        category_expenses = [t for t in expenses if t.category == category and t.type == "expense"]
        spent = sum(t.amount for t in category_expenses)

        remaining = budget.limit_amt - spent
        utilization_percent = (spent / budget.limit_amt * 100) if budget.limit_amt > 0 else 0

        # Determine status
        if spent >= budget.limit_amt:
            status = "Exceeded"
        elif spent >= budget.limit_amt * 0.8:  # Warning at 80% utilization
            status = "Warning"
        else:
            status = "Healthy"

        # Projected spending based on current rate (simple extrapolation)
        # This is a simplified version - in practice, we'd want more sophisticated forecasting
        projected_spend = spent  # Placeholder
        projected_overrun = max(0, projected_spend - budget.limit_amt)

        return {
            "limit": budget.limit_amt,
            "spent": round(spent, 2),
            "remaining": round(remaining, 2),
            "utilization_percent": round(utilization_percent, 2),
            "status": status,
            "projected_spend": round(projected_spend, 2),
            "projected_overrun": round(projected_overrun, 2)
        }