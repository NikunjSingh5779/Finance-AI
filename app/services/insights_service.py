"""Financial health, recurring-expense, and anomaly analysis services."""

from collections import defaultdict
from datetime import datetime
import statistics
from typing import Any

from app.repositories.analytics_repository import AnalyticsRepository
from app.repositories.account_repository import AccountRepository
from app.repositories.budget_repository import BudgetRepository
from app.utils.dates import get_period_bounds


class FinancialHealthService:
    """Compute explainable 0-100 financial-health metrics."""

    def __init__(
        self,
        analytics_repository: AnalyticsRepository,
        account_repository: AccountRepository,
        budget_repository: BudgetRepository,
    ):
        self.analytics = analytics_repository
        self.accounts = account_repository
        self.budgets = budget_repository

    def get_score(self) -> dict[str, Any]:
        monthly = self.analytics.monthly_series(6)
        start_date, end_date = get_period_bounds("6m")
        totals = self.analytics.summary_totals(start_date, end_date)
        income = totals["income"]
        expense = totals["expense"]
        savings_rate = (income - expense) / income * 100 if income else 0.0

        savings_component = min(30.0, max(0.0, savings_rate / 30.0 * 30.0))

        budgets = self.budgets.list()
        current_spending = self.analytics.category_totals(*self._current_period())
        if budgets:
            utilizations = [
                current_spending.get(b.category, 0.0) / b.limit_amt
                for b in budgets
                if b.limit_amt > 0
            ]
            budget_component = (
                min(25.0, max(0.0, statistics.mean(
                    max(0.0, 1.0 - max(0.0, u - 0.8) / 0.8)
                    for u in utilizations
                ) * 25.0))
                if utilizations else 15.0
            )
        else:
            budget_component = 15.0

        expense_values = [row["expense"] for row in monthly if row["expense"] > 0]
        if len(expense_values) >= 2:
            mean_expense = statistics.mean(expense_values)
            cv = statistics.stdev(expense_values) / mean_expense if mean_expense else 1.0
            consistency_component = max(0.0, min(20.0, 20.0 * (1.0 - min(cv, 1.0))))
        else:
            consistency_component = 10.0

        balances = sum(self.accounts.get_balance(a.id) for a in self.accounts.list())
        avg_monthly_expense = (
            statistics.mean(expense_values) if expense_values else 0.0
        )
        months_buffer = balances / avg_monthly_expense if avg_monthly_expense > 0 else 0.0
        buffer_component = min(25.0, max(0.0, months_buffer / 6.0 * 25.0))

        score = round(
            min(100.0, savings_component + budget_component +
                consistency_component + buffer_component)
        )

        strengths: list[str] = []
        actions: list[str] = []

        if savings_rate >= 20:
            strengths.append("Savings rate is healthy.")
        else:
            actions.append("Aim to raise your savings rate toward 20%.")

        if budgets:
            over = [
                b.category
                for b in budgets
                if current_spending.get(b.category, 0) > b.limit_amt
            ]
            if over:
                actions.append("Review over-budget categories: " + ", ".join(over[:3]) + ".")
            else:
                strengths.append("Your tracked budgets are currently within limits.")
        else:
            actions.append("Create monthly budgets for your largest spending categories.")

        if months_buffer >= 3:
            strengths.append(f"Estimated cash buffer is about {months_buffer:.1f} months.")
        else:
            actions.append("Build a larger emergency cash buffer.")

        return {
            "score": score,
            "grade": self._grade(score),
            "components": {
                "savings": round(savings_component, 1),
                "budgeting": round(budget_component, 1),
                "expense_consistency": round(consistency_component, 1),
                "cash_buffer": round(buffer_component, 1),
            },
            "metrics": {
                "savings_rate": round(savings_rate, 1),
                "cash_balance": round(balances, 2),
                "months_of_buffer": round(months_buffer, 2),
                "months_analyzed": len(monthly),
            },
            "strengths": strengths,
            "actions": actions,
            "methodology": "Rule-based score using savings rate, budget utilization, monthly expense consistency, and cash buffer.",
        }

    @staticmethod
    def _grade(score: int) -> str:
        if score >= 85:
            return "Excellent"
        if score >= 70:
            return "Good"
        if score >= 55:
            return "Fair"
        return "Needs attention"

    @staticmethod
    def _current_period() -> tuple[str, str]:
        now = datetime.now()
        return now.replace(day=1).strftime("%Y-%m-%d"), now.strftime("%Y-%m-%d")


class InsightsService:
    """Detect recurring expenses and unusually large spending."""

    def __init__(self, analytics_repository: AnalyticsRepository):
        self.analytics = analytics_repository

    def recurring_expenses(self) -> list[dict[str, Any]]:
        rows = self.analytics.recent_expenses(5000)
        groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)

        for row in rows:
            key = (
                " ".join(str(row["description"]).lower().split()),
                str(row["category"]).lower().strip(),
            )
            groups[key].append(row)

        results: list[dict[str, Any]] = []
        for (description, category), items in groups.items():
            if len(items) < 3:
                continue

            items.sort(key=lambda item: item["date"])
            dates = [datetime.strptime(item["date"], "%Y-%m-%d") for item in items]
            intervals = [
                (dates[i] - dates[i - 1]).days for i in range(1, len(dates))
            ]
            if not intervals:
                continue

            median_interval = statistics.median(intervals)
            amounts = [float(item["amount"]) for item in items]
            mean_amount = statistics.mean(amounts)
            amount_cv = (
                statistics.stdev(amounts) / mean_amount
                if len(amounts) > 1 and mean_amount
                else 0.0
            )

            is_monthly = 20 <= median_interval <= 40
            is_consistent = amount_cv <= 0.20
            if not (is_monthly and is_consistent):
                continue

            results.append({
                "description": description,
                "category": category,
                "occurrences": len(items),
                "average_amount": round(mean_amount, 2),
                "estimated_monthly_cost": round(mean_amount, 2),
                "median_interval_days": round(median_interval, 1),
                "last_date": items[-1]["date"],
            })

        return sorted(results, key=lambda item: item["estimated_monthly_cost"], reverse=True)

    def anomalies(self, z_threshold: float = 2.5) -> list[dict[str, Any]]:
        rows = self.analytics.recent_expenses(5000)
        by_category: dict[str, list[dict[str, Any]]] = defaultdict(list)

        for row in rows:
            by_category[str(row["category"]).strip()].append(row)

        anomalies: list[dict[str, Any]] = []
        for category, items in by_category.items():
            if len(items) < 4:
                continue

            amounts = [float(item["amount"]) for item in items]
            mean = statistics.mean(amounts)
            stdev = statistics.stdev(amounts)
            if stdev == 0:
                continue

            for item in items:
                amount = float(item["amount"])
                z_score = (amount - mean) / stdev
                ratio = amount / mean if mean else 0
                if z_score >= z_threshold and ratio >= 1.5:
                    anomalies.append({
                        "transaction_id": item["id"],
                        "date": item["date"],
                        "description": item["description"],
                        "category": category,
                        "amount": round(amount, 2),
                        "category_average": round(mean, 2),
                        "multiple_of_average": round(ratio, 2),
                        "z_score": round(z_score, 2),
                        "severity": "high" if ratio >= 3 else "medium",
                    })

        return sorted(anomalies, key=lambda item: item["z_score"], reverse=True)[:50]
