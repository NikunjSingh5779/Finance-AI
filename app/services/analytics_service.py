from typing import Dict, Any, List
from app.repositories.transaction_repository import TransactionRepository
from app.utils.dates import get_period_bounds, get_previous_period_bounds
from app.core.exceptions import InsufficientDataError

class AnalyticsService:
    def __init__(self, repository: TransactionRepository):
        self.repository = repository

    def get_summary(self, period: str = "all") -> Dict[str, Any]:
        """Get financial summary for a given period."""
        if period == "all":
            return self._get_all_time_summary()
        else:
            return self._get_period_summary(period)

    def _get_all_time_summary(self) -> Dict[str, Any]:
        """Get all-time financial summary."""
        conn = self.repository.conn
        try:
            rows = conn.execute(
                "SELECT type, SUM(amount) as total FROM transactions GROUP BY type"
            ).fetchall()

            monthly_rows = conn.execute(
                "SELECT substr(date,1,7) as month, type, SUM(amount) as total FROM transactions GROUP BY month, type"
            ).fetchall()

            category_rows = conn.execute(
                "SELECT category, SUM(amount) as total FROM transactions WHERE type='expense' GROUP BY category"
            ).fetchall()

            income = expense = 0.0
            for r in rows:
                if r["type"] == "income":
                    income = r["total"]
                else:
                    expense = r["total"]

            monthly = {}
            for r in monthly_rows:
                m = r["month"]
                if m not in monthly:
                    monthly[m] = {"income": 0, "expense": 0}
                monthly[m][r["type"]] = r["total"]

            category_totals = {r["category"]: r["total"] for r in category_rows}

            return {
                "income": round(income, 2),
                "expense": round(expense, 2),
                "balance": round(income - expense, 2),
                "savings_rate": round((income - expense) / income * 100, 1) if income else 0,
                "monthly": monthly,
                "category_totals": category_totals
            }
        finally:
            conn.close()

    def _get_period_summary(self, period: str) -> Dict[str, Any]:
        """Get financial summary for a specific period."""
        start_date, end_date = get_period_bounds(period)
        prev_start_date, prev_end_date = get_previous_period_bounds(period)

        conn = self.repository.conn
        try:
            # Get current period data
            current_rows = conn.execute(
                """
                SELECT type, SUM(amount) as total
                FROM transactions
                WHERE date BETWEEN ? AND ?
                GROUP BY type
                """,
                (start_date, end_date)
            ).fetchall()

            # Get previous period data for comparison
            prev_rows = conn.execute(
                """
                SELECT type, SUM(amount) as total
                FROM transactions
                WHERE date BETWEEN ? AND ?
                GROUP BY type
                """,
                (prev_start_date, prev_end_date)
            ).fetchall()

            # Get category breakdown for current period
            category_rows = conn.execute(
                """
                SELECT category, SUM(amount) as total
                FROM transactions
                WHERE type='expense' AND date BETWEEN ? AND ?
                GROUP BY category
                """,
                (start_date, end_date)
            ).fetchall()

            # Get account totals for current period
            account_rows = conn.execute(
                """
                SELECT a.id, a.name, a.type,
                       COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0) as income,
                       COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) as expense
                FROM accounts a
                LEFT JOIN transactions t ON a.id = t.account_id
                WHERE t.date BETWEEN ? AND ? OR t.id IS NULL
                GROUP BY a.id, a.name, a.type
                """,
                (start_date, end_date)
            ).fetchall()

            # Calculate current period totals
            current_income = current_expense = 0.0
            for r in current_rows:
                if r["type"] == "income":
                    current_income = r["total"]
                else:
                    current_expense = r["total"]

            # Calculate previous period totals
            prev_income = prev_expense = 0.0
            for r in prev_rows:
                if r["type"] == "income":
                    prev_income = r["total"]
                else:
                    prev_expense = r["total"]

            # Calculate changes
            income_change = ((current_income - prev_income) / prev_income * 100) if prev_income != 0 else 0
            expense_change = ((current_expense - prev_expense) / prev_expense * 100) if prev_expense != 0 else 0
            balance_change = ((current_income - current_expense) - (prev_income - prev_expense)) / abs(prev_income - prev_expense) * 100 if (prev_income - prev_expense) != 0 else 0

            # Build monthly series for the current period
            monthly = {}
            monthly_rows = conn.execute(
                """
                SELECT substr(date,1,7) as month, type, SUM(amount) as total
                FROM transactions
                WHERE date BETWEEN ? AND ?
                GROUP BY month, type
                """,
                (start_date, end_date)
            ).fetchall()

            for r in monthly_rows:
                m = r["month"]
                if m not in monthly:
                    monthly[m] = {"income": 0, "expense": 0}
                monthly[m][r["type"]] = r["total"]

            # Build category totals
            category_totals = {r["category"]: r["total"] for r in category_rows}

            # Build account totals
            account_totals = {}
            for r in account_rows:
                account_totals[r["name"]] = {
                    "id": r["id"],
                    "type": r["type"],
                    "income": round(r["income"], 2),
                    "expense": round(r["expense"], 2),
                    "balance": round(r["income"] - r["expense"], 2)
                }

            return {
                "income": round(current_income, 2),
                "expense": round(current_expense, 2),
                "balance": round(current_income - current_expense, 2),
                "savings_rate": round((current_income - current_expense) / current_income * 100, 1) if current_income else 0,
                "income_change": round(income_change, 2),
                "expense_change": round(expense_change, 2),
                "balance_change": round(balance_change, 2),
                "monthly": monthly,
                "category_totals": {k: round(v, 2) for k, v in category_totals.items()},
                "account_totals": account_totals
            }
        finally:
            conn.close()

    def get_monthly_series(self, months: int = 12) -> List[Dict[str, Any]]:
        """Get monthly income/expense series for the last N months."""
        conn = self.repository.conn
        try:
            rows = conn.execute(
                """
                SELECT substr(date,1,7) as month,
                       SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as income,
                       SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as expense
                FROM transactions
                GROUP BY substr(date,1,7)
                ORDER BY month DESC
                LIMIT ?
                """,
                (months,)
            ).fetchall()

            return [
                {
                    "month": r["month"],
                    "income": round(r["income"], 2),
                    "expense": round(r["expense"], 2),
                    "balance": round(r["income"] - r["expense"], 2)
                }
                for r in rows
            ]
        finally:
            conn.close()