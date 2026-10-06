from typing import List, Optional
from sqlite3 import Connection
from app.schemas.budget import BudgetCreate, BudgetUpdate, BudgetOut

class BudgetRepository:
    def __init__(self, conn: Connection):
        self.conn = conn

    def list(self) -> List[BudgetOut]:
        cursor = self.conn.execute("SELECT * FROM budgets ORDER BY category")
        rows = cursor.fetchall()
        return [BudgetOut(**dict(row)) for row in rows]

    def get(self, category: str) -> Optional[BudgetOut]:
        cursor = self.conn.execute("SELECT * FROM budgets WHERE category = ?", (category,))
        row = cursor.fetchone()
        if row:
            return BudgetOut(**dict(row))
        return None

    def create(self, budget: BudgetCreate) -> BudgetOut:
        cursor = self.conn.execute(
            """
            INSERT INTO budgets (category, limit_amt)
            VALUES (?, ?)
            """,
            (budget.category, budget.limit_amt)
        )
        self.conn.commit()
        budget_id = cursor.lastrowid
        return self.get_by_id(budget_id)

    def get_by_id(self, budget_id: int) -> Optional[BudgetOut]:
        cursor = self.conn.execute("SELECT * FROM budgets WHERE id = ?", (budget_id,))
        row = cursor.fetchone()
        if row:
            return BudgetOut(**dict(row))
        return None

    def update(self, category: str, budget: BudgetUpdate) -> Optional[BudgetOut]:
        # First, check if the budget exists
        existing = self.get(category)
        if not existing:
            return None

        # Build the update dictionary dynamically
        update_data = budget.model_dump(exclude_unset=True)
        if not update_data:
            return existing

        # Build the SET clause and parameters
        set_clause = ", ".join([f"{key} = ?" for key in update_data.keys()])
        values = list(update_data.values()) + [category]

        self.conn.execute(
            f"UPDATE budgets SET {set_clause} WHERE category = ?",
            values
        )
        self.conn.commit()
        return self.get(category)

    def delete(self, category: str) -> bool:
        cursor = self.conn.execute(
            "DELETE FROM budgets WHERE category = ?",
            (category,)
        )
        self.conn.commit()
        return cursor.rowcount > 0