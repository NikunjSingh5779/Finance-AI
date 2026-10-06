from sqlite3 import Connection
from typing import Any


class AnalyticsRepository:
    """Persistence boundary for analytical transaction queries."""

    def __init__(self, conn: Connection):
        self.conn = conn

    def summary_totals(self, start_date: str | None = None, end_date: str | None = None) -> dict[str, float]:
        if start_date and end_date:
            rows = self.conn.execute(
                """
                SELECT type, COALESCE(SUM(amount), 0) AS total
                FROM transactions
                WHERE date BETWEEN ? AND ?
                GROUP BY type
                """,
                (start_date, end_date),
            ).fetchall()
        else:
            rows = self.conn.execute(
                """
                SELECT type, COALESCE(SUM(amount), 0) AS total
                FROM transactions
                GROUP BY type
                """
            ).fetchall()

        totals = {"income": 0.0, "expense": 0.0}
        for row in rows:
            if row["type"] in totals:
                totals[row["type"]] = float(row["total"] or 0)
        return totals

    def category_totals(self, start_date: str | None = None, end_date: str | None = None) -> dict[str, float]:
        params: tuple[Any, ...] = ()
        where = "WHERE type = 'expense'"
        if start_date and end_date:
            where += " AND date BETWEEN ? AND ?"
            params = (start_date, end_date)

        rows = self.conn.execute(
            f"""
            SELECT category, COALESCE(SUM(amount), 0) AS total
            FROM transactions
            {where}
            GROUP BY category
            ORDER BY total DESC
            """,
            params,
        ).fetchall()
        return {str(row["category"]): float(row["total"] or 0) for row in rows}

    def monthly_series(self, months: int = 12) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            """
            SELECT substr(date, 1, 7) AS month,
                   COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
                   COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
            FROM transactions
            GROUP BY substr(date, 1, 7)
            ORDER BY month DESC
            LIMIT ?
            """,
            (months,),
        ).fetchall()
        return [
            {
                "month": row["month"],
                "income": float(row["income"] or 0),
                "expense": float(row["expense"] or 0),
            }
            for row in rows
        ]

    def expenses_between(self, start_date: str, end_date: str) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            """
            SELECT id, amount, description, category, date, account_id
            FROM transactions
            WHERE type = 'expense' AND date BETWEEN ? AND ?
            ORDER BY date ASC, id ASC
            """,
            (start_date, end_date),
        ).fetchall()
        return [dict(row) for row in rows]

    def recent_expenses(self, limit: int = 5000) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            """
            SELECT id, amount, description, category, date, account_id
            FROM transactions
            WHERE type = 'expense'
            ORDER BY date DESC, id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [dict(row) for row in rows]

    def account_flows(self, start_date: str, end_date: str) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            """
            SELECT a.id, a.name, a.type,
                   COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0) AS income,
                   COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) AS expense
            FROM accounts a
            LEFT JOIN transactions t
              ON a.id = t.account_id
             AND t.date BETWEEN ? AND ?
            GROUP BY a.id, a.name, a.type
            ORDER BY a.name
            """,
            (start_date, end_date),
        ).fetchall()
        return [dict(row) for row in rows]
