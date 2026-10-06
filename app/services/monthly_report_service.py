from datetime import date, timedelta
from typing import Any

from app.repositories.analytics_repository import AnalyticsRepository
from app.repositories.budget_repository import BudgetRepository
from app.services.insights_service import InsightsService


class MonthlyReportService:
    """Generate a deterministic monthly financial report."""

    def __init__(
        self,
        analytics: AnalyticsRepository,
        budgets: BudgetRepository,
    ):
        self.analytics = analytics
        self.budgets = budgets

    def generate(self, month: str | None = None) -> dict[str, Any]:
        selected = month or date.today().strftime("%Y-%m")
        try:
            year, month_number = map(int, selected.split("-"))
            first = date(year, month_number, 1)
        except (ValueError, TypeError):
            raise ValueError("month must be YYYY-MM") from None

        if first > date.today().replace(day=1):
            raise ValueError("month cannot be in the future")

        if month_number == 12:
            next_month = date(year + 1, 1, 1)
        else:
            next_month = date(year, month_number + 1, 1)

        start_date = first.isoformat()
        end_date = (next_month - timedelta(days=1)).isoformat()

        totals = self.analytics.summary_totals(start_date, end_date)
        categories = self.analytics.category_totals(start_date, end_date)
        top_categories = [
            {"category": category, "amount": round(amount, 2)}
            for category, amount in sorted(
                categories.items(), key=lambda item: item[1], reverse=True
            )[:5]
        ]

        income = totals["income"]
        expense = totals["expense"]
        net = income - expense
        savings_rate = net / income * 100 if income else 0.0

        previous_year = year
        previous_month = month_number - 1
        if previous_month == 0:
            previous_year -= 1
            previous_month = 12
        previous_start = date(previous_year, previous_month, 1)
        previous_end = first - timedelta(days=1)
        previous = self.analytics.summary_totals(
            previous_start.isoformat(), previous_end.isoformat()
        )

        budget_status = []
        for budget in self.budgets.list():
            spent = categories.get(budget.category, 0.0)
            budget_status.append({
                "category": budget.category,
                "limit": round(budget.limit_amt, 2),
                "spent": round(spent, 2),
                "utilization_percent": round(
                    spent / budget.limit_amt * 100, 2
                ),
                "status": (
                    "exceeded"
                    if spent > budget.limit_amt
                    else "warning"
                    if spent >= budget.limit_amt * 0.8
                    else "healthy"
                ),
            })

        recurring = InsightsService(self.analytics).recurring_expenses()[:5]

        return {
            "month": selected,
            "start_date": start_date,
            "end_date": end_date,
            "income": round(income, 2),
            "expense": round(expense, 2),
            "net_cash_flow": round(net, 2),
            "savings_rate": round(savings_rate, 1),
            "previous_month": {
                "income": round(previous["income"], 2),
                "expense": round(previous["expense"], 2),
                "net_cash_flow": round(previous["income"] - previous["expense"], 2),
            },
            "top_categories": top_categories,
            "budgets": budget_status,
            "recurring_expenses": recurring,
            "is_estimate": False,
        }
