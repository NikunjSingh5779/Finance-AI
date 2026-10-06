"""Service for expense forecasting."""

from typing import Dict, Any, List
from app.repositories.transaction_repository import TransactionRepository
from app.core.exceptions import InsufficientDataError
from app.utils.dates import get_period_bounds
import statistics
from datetime import datetime, timedelta


class ForecastService:
    """Service for forecasting expenses."""

    def __init__(self, repository: TransactionRepository):
        """Initialize the forecast service with a repository."""
        self.repository = repository

    def predict_expense(self) -> Dict[str, Any]:
        """
        Predict next month's total expenses based on historical data.

        Returns:
            Dictionary containing prediction and historical data
        """
        conn = self.repository.conn

        # Get all expense transactions
        expense_rows = conn.execute(
            """SELECT date, amount FROM transactions
               WHERE type = 'expense'
               ORDER BY date"""
        ).fetchall()

        if not expense_rows:
            raise InsufficientDataError("No expense data available for forecasting")

        # Group expenses by month
        monthly_expenses = {}
        for row in expense_rows:
            date_str = row["date"]
            # Extract YYYY-MM from date
            month_key = date_str[:7]  # YYYY-MM format
            amount = row["amount"]

            if month_key not in monthly_expenses:
                monthly_expenses[month_key] = 0.0
            monthly_expenses[month_key] += amount

        # Convert to list of (month, amount) tuples sorted by month
        monthly_data = [(month, amount) for month, amount in monthly_expenses.items()]
        monthly_data.sort(key=lambda x: x[0])  # Sort by month

        if len(monthly_data) < 2:
            raise InsufficientDataError("Need at least 2 months of data for forecasting")

        # Extract just the amounts for calculation
        amounts = [amount for _, amount in monthly_data]

        # Simple forecasting: use average of last 3 months or all months if less
        if len(amounts) >= 3:
            recent_amounts = amounts[-3:]
            prediction = statistics.mean(recent_amounts)
            model_used = "3-month moving average"
        else:
            prediction = statistics.mean(amounts)
            model_used = "Overall average"

        # Calculate confidence based on data consistency
        if len(amounts) >= 2:
            stdev = statistics.stdev(amounts) if len(amounts) >= 2 else 0
            mean_val = statistics.mean(amounts)
            # Coefficient of variation - lower means more consistent
            cv = stdev / mean_val if mean_val != 0 else 1
            # Confidence: higher when data is more consistent
            confidence = max(0, min(100, 100 * (1 - cv)))
        else:
            confidence = 50  # Default confidence with minimal data

        # Format historical data for response
        historical = [
            {"month": month, "expense": amount}
            for month, amount in monthly_data
        ]

        # Determine next month
        last_month_str = monthly_data[-1][0]  # YYYY-MM
        last_year, last_month = map(int, last_month_str.split('-'))

        # Calculate next month
        if last_month == 12:
            next_month = 1
            next_year = last_year + 1
        else:
            next_month = last_month + 1
            next_year = last_year

        next_month_str = f"{next_year:04d}-{next_month:02d}"

        return {
            "prediction": round(prediction, 2),
            "confidence": round(confidence, 2),
            "model_used": model_used,
            "historical_data": historical,
            "next_month": next_month_str,
            "data_points": len(monthly_data),
            "note": f"Prediction for {next_month_str} based on {len(monthly_data)} months of historical data"
        }