from sqlite3 import Connection
from typing import List, Optional

from app.schemas.budget import BudgetCreate, BudgetOut, BudgetUpdate


class BudgetRepository:
    """Persistence operations for budgets."""

    def __init__(self, conn: Connection):
        self.conn = conn

    def list(self) -> List[BudgetOut]:
        rows = self.conn.execute(
            "SELECT * FROM budgets ORDER BY category"
        ).fetchall()
        return [BudgetOut(**dict(row)) for row in rows]

    def get(self, category: str) -> Optional[BudgetOut]:
        row = self.conn.execute(
            "SELECT * FROM budgets WHERE category = ?", (category,)
        ).fetchone()
        return BudgetOut(**dict(row)) if row else None

    def create(self, budget: BudgetCreate) -> BudgetOut:
        self.conn.execute(
            """
            INSERT INTO budgets (category, limit_amt)
            VALUES (?, ?)
            ON CONFLICT(category) DO UPDATE SET limit_amt = excluded.limit_amt
            """,
            (budget.category, budget.limit_amt),
        )
        self.conn.commit()
        return self.get(budget.category)

    def get_by_id(self, budget_id: int) -> Optional[BudgetOut]:
        row = self.conn.execute(
            "SELECT * FROM budgets WHERE id = ?", (budget_id,)
        ).fetchone()
        return BudgetOut(**dict(row)) if row else None

    def update(self, category: str, budget: BudgetUpdate) -> Optional[BudgetOut]:
        existing = self.get(category)
        if existing is None:
            return None

        update_data = budget.model_dump(exclude_unset=True)
        if not update_data:
            return existing

        if "limit_amt" not in update_data:
            return existing

        self.conn.execute(
            "UPDATE budgets SET limit_amt = ? WHERE category = ?",
            (update_data["limit_amt"], category),
        )
        self.conn.commit()
        return self.get(category)

    def delete(self, category: str) -> bool:
        cursor = self.conn.execute(
            "DELETE FROM budgets WHERE category = ?", (category,)
        )
        self.conn.commit()
        return cursor.rowcount > 0
