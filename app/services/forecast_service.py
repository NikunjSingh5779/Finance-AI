"""Expense forecasting service."""

import statistics
from datetime import datetime
from typing import Any

from app.core.exceptions import InsufficientDataError
from app.repositories.transaction_repository import TransactionRepository


class ForecastService:
    """Forecast next month's total expenses from monthly historical totals."""

    def __init__(self, repository: TransactionRepository):
        self.repository = repository

    def predict_expense(self) -> dict[str, Any]:
        rows = self.repository.list_expense_rows()
        if not rows:
            raise InsufficientDataError("No expense data available for forecasting")

        monthly_expenses: dict[str, float] = {}
        for row in rows:
            month = str(row["date"])[:7]
            monthly_expenses[month] = monthly_expenses.get(month, 0.0) + float(row["amount"])

        monthly_data = sorted(monthly_expenses.items())
        if len(monthly_data) < 2:
            raise InsufficientDataError(
                "Need at least 2 months of expense data for forecasting"
            )

        amounts = [amount for _, amount in monthly_data]
        sample = amounts[-3:] if len(amounts) >= 3 else amounts
        prediction = statistics.mean(sample)
        model_used = "3-month moving average" if len(amounts) >= 3 else "historical average"

        mean_value = statistics.mean(amounts)
        cv = (
            statistics.stdev(amounts) / mean_value
            if len(amounts) >= 2 and mean_value > 0
            else 1.0
        )
        confidence = max(0.0, min(100.0, 100.0 * (1.0 - min(cv, 1.0))))

        last_year, last_month = map(int, monthly_data[-1][0].split("-"))
        if last_month == 12:
            next_year, next_month = last_year + 1, 1
        else:
            next_year, next_month = last_year, last_month + 1
        next_month_str = f"{next_year:04d}-{next_month:02d}"

        return {
            "prediction": round(prediction, 2),
            "confidence": round(confidence, 2),
            "model_used": model_used,
            "historical_data": [
                {"month": month, "expense": round(amount, 2)}
                for month, amount in monthly_data
            ],
            "next_month": next_month_str,
            "data_points": len(monthly_data),
            "is_estimate": True,
            "note": (
                f"Estimated {next_month_str} expenses from {len(monthly_data)} "
                "historical calendar months."
            ),
        }
