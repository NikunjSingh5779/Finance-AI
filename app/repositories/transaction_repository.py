from sqlite3 import Connection
from typing import List, Optional

from app.schemas.transaction import (
    TransactionCreate,
    TransactionOut,
    TransactionUpdate,
)


class TransactionRepository:
    """Persistence operations for transactions."""

    def __init__(self, conn: Connection):
        self.conn = conn

    def list(self, skip: int = 0, limit: int = 100) -> List[TransactionOut]:
        cursor = self.conn.execute(
            "SELECT * FROM transactions ORDER BY date DESC, id DESC LIMIT ? OFFSET ?",
            (limit, skip),
        )
        rows = cursor.fetchall()
        return [TransactionOut(**dict(row)) for row in rows]

    def get(self, transaction_id: int) -> Optional[TransactionOut]:
        row = self.conn.execute(
            "SELECT * FROM transactions WHERE id = ?", (transaction_id,)
        ).fetchone()
        return TransactionOut(**dict(row)) if row else None

    def create(self, transaction: TransactionCreate) -> TransactionOut:
        cursor = self.conn.execute(
            """
            INSERT INTO transactions
                (type, amount, description, category, date, account_id)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                transaction.type,
                transaction.amount,
                transaction.description,
                transaction.category,
                transaction.date,
                transaction.account_id,
            ),
        )
        self.conn.commit()
        return self.get(cursor.lastrowid)

    def update(
        self, transaction_id: int, transaction: TransactionUpdate
    ) -> Optional[TransactionOut]:
        if self.get(transaction_id) is None:
            return None

        data = transaction.model_dump(exclude_unset=True)
        if not data:
            return self.get(transaction_id)

        allowed = {"type", "amount", "description", "category", "date", "account_id"}
        data = {key: value for key, value in data.items() if key in allowed}
        if not data:
            return self.get(transaction_id)

        set_clause = ", ".join(f"{key} = ?" for key in data)
        values = list(data.values()) + [transaction_id]
        self.conn.execute(
            f"UPDATE transactions SET {set_clause} WHERE id = ?", values
        )
        self.conn.commit()
        return self.get(transaction_id)

    def delete(self, transaction_id: int) -> bool:
        cursor = self.conn.execute(
            "DELETE FROM transactions WHERE id = ?", (transaction_id,)
        )
        self.conn.commit()
        return cursor.rowcount > 0

    def list_by_account(
        self, account_id: int, skip: int = 0, limit: int = 100
    ) -> List[TransactionOut]:
        rows = self.conn.execute(
            """
            SELECT * FROM transactions
            WHERE account_id = ?
            ORDER BY date DESC, id DESC
            LIMIT ? OFFSET ?
            """,
            (account_id, limit, skip),
        ).fetchall()
        return [TransactionOut(**dict(row)) for row in rows]

    def list_by_type(
        self, transaction_type: str, skip: int = 0, limit: int = 100
    ) -> List[TransactionOut]:
        rows = self.conn.execute(
            """
            SELECT * FROM transactions
            WHERE type = ?
            ORDER BY date DESC, id DESC
            LIMIT ? OFFSET ?
            """,
            (transaction_type, limit, skip),
        ).fetchall()
        return [TransactionOut(**dict(row)) for row in rows]

    def list_by_date_range(
        self, start_date: str, end_date: str, skip: int = 0, limit: int = 100
    ) -> List[TransactionOut]:
        rows = self.conn.execute(
            """
            SELECT * FROM transactions
            WHERE date BETWEEN ? AND ?
            ORDER BY date DESC, id DESC
            LIMIT ? OFFSET ?
            """,
            (start_date, end_date, limit, skip),
        ).fetchall()
        return [TransactionOut(**dict(row)) for row in rows]

    def list_expense_rows(self, limit: int = 5000) -> list[dict]:
        rows = self.conn.execute(
            """
            SELECT id, amount, description, category, date, account_id
            FROM transactions
            WHERE type = 'expense'
            ORDER BY date ASC, id ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [dict(row) for row in rows]

    def account_exists(self, account_id: int) -> bool:
        row = self.conn.execute(
            "SELECT 1 FROM accounts WHERE id = ?", (account_id,)
        ).fetchone()
        return row is not None

    def count_by_account(self, account_id: int) -> int:
        row = self.conn.execute(
            "SELECT COUNT(*) AS count FROM transactions WHERE account_id = ?",
            (account_id,),
        ).fetchone()
        return int(row["count"])

    def expense_total_for_category(
        self, category: str, start_date: str, end_date: str
    ) -> float:
        row = self.conn.execute(
            """
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM transactions
            WHERE type = 'expense'
              AND category = ?
              AND date BETWEEN ? AND ?
            """,
            (category, start_date, end_date),
        ).fetchone()
        return float(row["total"] or 0)
