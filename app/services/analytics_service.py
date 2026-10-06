from typing import Any

from app.core.exceptions import ValidationError
from app.repositories.analytics_repository import AnalyticsRepository
from app.utils.dates import get_period_bounds, get_previous_period_bounds


class AnalyticsService:
    """Business logic for financial summaries and trend analytics."""

    VALID_PERIODS = {"1m", "3m", "6m", "1y", "all"}

    def __init__(self, repository: AnalyticsRepository):
        self.repository = repository

    def get_summary(self, period: str = "all") -> dict[str, Any]:
        period = period.strip().lower()
        if period not in self.VALID_PERIODS:
            raise ValidationError(
                f"Unsupported summary period '{period}'. "
                f"Use one of: {', '.join(sorted(self.VALID_PERIODS))}."
            )

        if period == "all":
            return self._build_summary(None, None, include_comparison=False)

        start_date, end_date = get_period_bounds(period)
        return self._build_summary(start_date, end_date, include_comparison=True, period=period)

    def _build_summary(
        self,
        start_date: str | None,
        end_date: str | None,
        include_comparison: bool,
        period: str | None = None,
    ) -> dict[str, Any]:
        totals = self.repository.summary_totals(start_date, end_date)
        income = totals["income"]
        expense = totals["expense"]
        balance = income - expense
        savings_rate = ((balance / income) * 100) if income else 0.0

        monthly_rows = self.repository.monthly_series(120)
        if start_date and end_date:
            monthly = {
                row["month"]: {
                    "income": round(row["income"], 2),
                    "expense": round(row["expense"], 2),
                }
                for row in monthly_rows
                if start_date[:7] <= row["month"] <= end_date[:7]
            }
        else:
            monthly = {
                row["month"]: {
                    "income": round(row["income"], 2),
                    "expense": round(row["expense"], 2),
                }
                for row in monthly_rows
            }

        category_totals = self.repository.category_totals(start_date, end_date)
        account_totals = self.repository.account_flows(
            start_date or "2000-01-01",
            end_date or "2999-12-31",
        )
        accounts = {
            row["name"]: {
                "id": row["id"],
                "type": row["type"],
                "income": round(float(row["income"]), 2),
                "expense": round(float(row["expense"]), 2),
                "balance": round(float(row["income"]) - float(row["expense"]), 2),
            }
            for row in account_totals
        }

        result: dict[str, Any] = {
            "period": period or "all",
            "start_date": start_date,
            "end_date": end_date,
            "income": round(income, 2),
            "expense": round(expense, 2),
            "balance": round(balance, 2),
            "savings_rate": round(savings_rate, 1),
            "monthly": monthly,
            "category_totals": {k: round(v, 2) for k, v in category_totals.items()},
            "account_totals": accounts,
        }

        if include_comparison and period:
            prev_start, prev_end = get_previous_period_bounds(period)
            previous = self.repository.summary_totals(prev_start, prev_end)
            prev_income = previous["income"]
            prev_expense = previous["expense"]
            prev_balance = prev_income - prev_expense

            result["income_change"] = self._percent_change(income, prev_income)
            result["expense_change"] = self._percent_change(expense, prev_expense)
            result["balance_change"] = self._percent_change(balance, prev_balance)

        return result

    @staticmethod
    def _percent_change(current: float, previous: float) -> float:
        if previous == 0:
            return 0.0
        return round(((current - previous) / abs(previous)) * 100, 2)

    def get_monthly_series(self, months: int = 12) -> list[dict[str, Any]]:
        months = max(1, min(int(months), 120))
        rows = self.repository.monthly_series(months)
        return [
            {
                "month": row["month"],
                "income": round(row["income"], 2),
                "expense": round(row["expense"], 2),
                "balance": round(row["income"] - row["expense"], 2),
            }
            for row in reversed(rows)
        ]
