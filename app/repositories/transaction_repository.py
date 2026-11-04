from __future__ import annotations

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
        rows = self.conn.execute(
            """
            SELECT *
            FROM transactions
            ORDER BY date DESC, id DESC
            LIMIT ? OFFSET ?
            """,
            (limit, skip),
        ).fetchall()
        return [TransactionOut(**dict(row)) for row in rows]

    def count(self) -> int:
        row = self.conn.execute(
            "SELECT COUNT(*) AS count FROM transactions"
        ).fetchone()
        return int(row["count"] or 0)

    def is_import_duplicate(self, transaction: TransactionCreate) -> bool:
        """Match exact import fingerprints to prevent accidental re-imports."""
        row = self.conn.execute(
            """
            SELECT id
            FROM transactions
            WHERE type = ?
              AND amount = ?
              AND description = ?
              AND category = ?
              AND date = ?
            LIMIT 1
            """,
            (
                transaction.type,
                transaction.amount,
                transaction.description,
                transaction.category,
                transaction.date,
            ),
        ).fetchone()
        return row is not None

    @staticmethod
    def import_fingerprint(transaction: TransactionCreate) -> tuple:
        """Return the five-field fingerprint used by CSV imports."""
        return (
            transaction.type,
            float(transaction.amount),
            transaction.description,
            transaction.category,
            transaction.date,
        )

    def find_existing_import_fingerprints(
        self,
        transactions: list[TransactionCreate],
    ) -> set[tuple]:
        """Find existing import duplicates with batched tuple lookups."""
        existing: set[tuple] = set()
        query_batch_size = 100

        for start in range(0, len(transactions), query_batch_size):
            batch = transactions[start : start + query_batch_size]
            if not batch:
                continue
            row_placeholders = ", ".join(["(?, ?, ?, ?, ?)"] * len(batch))
            params = tuple(
                value
                for transaction in batch
                for value in self.import_fingerprint(transaction)
            )
            rows = self.conn.execute(
                """
                SELECT type, amount, description, category, date
                FROM transactions
                WHERE (type, amount, description, category, date)
                IN ("""
                + row_placeholders
                + ")",
                params,
            ).fetchall()
            existing.update(
                (
                    row["type"],
                    float(row["amount"]),
                    row["description"],
                    row["category"],
                    row["date"],
                )
                for row in rows
            )

        return existing

    def existing_account_ids(self, account_ids: list[int]) -> set[int]:
        """Resolve valid account IDs once per import batch, respecting RLS."""
        unique_ids = sorted(
            {int(account_id) for account_id in account_ids if account_id is not None}
        )
        existing: set[int] = set()

        for start in range(0, len(unique_ids), 500):
            batch = unique_ids[start : start + 500]
            placeholders = ", ".join(["?"] * len(batch))
            rows = self.conn.execute(
                f"SELECT id FROM accounts WHERE id IN ({placeholders})",
                tuple(batch),
            ).fetchall()
            existing.update(int(row["id"]) for row in rows)

        return existing

    def create_many_for_import(
        self,
        transactions: list[TransactionCreate],
    ) -> list[TransactionOut]:
        """Insert an import chunk in one statement and one commit."""
        if not transactions:
            return []

        values_sql = ", ".join(["(?, ?, ?, ?, ?, ?)"] * len(transactions))
        params = tuple(
            value
            for transaction in transactions
            for value in (
                transaction.type,
                transaction.amount,
                transaction.description,
                transaction.category,
                transaction.date,
                transaction.account_id,
            )
        )
        rows = self.conn.execute(
            """
            INSERT INTO transactions
                (type, amount, description, category, date, account_id)
            VALUES """
            + values_sql
            + """
            RETURNING id, type, amount, description, category, date, created, account_id
            """,
            params,
        ).fetchall()
        created = [TransactionOut(**dict(row)) for row in rows]
        self.conn.commit()
        return created

    def get(self, transaction_id: int) -> Optional[TransactionOut]:
        row = self.conn.execute(
            "SELECT * FROM transactions WHERE id = ?",
            (transaction_id,),
        ).fetchone()
        return TransactionOut(**dict(row)) if row else None

    def create(self, transaction: TransactionCreate) -> TransactionOut:
        cursor = self.conn.execute(
            """
            INSERT INTO transactions
                (type, amount, description, category, date, account_id)
            VALUES (?, ?, ?, ?, ?, ?)
            RETURNING id
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
        transaction_id = cursor.fetchone()["id"]
        self.conn.commit()
        created = self.get(transaction_id)
        if created is None:
            raise RuntimeError("Failed to retrieve created transaction")
        return created

    def update(
        self,
        transaction_id: int,
        transaction: TransactionUpdate,
    ) -> Optional[TransactionOut]:
        if self.get(transaction_id) is None:
            return None

        data = transaction.model_dump(exclude_unset=True)
        if not data:
            return self.get(transaction_id)

        allowed = {
            "type",
            "amount",
            "description",
            "category",
            "date",
            "account_id",
        }
        data = {key: value for key, value in data.items() if key in allowed}
        if not data:
            return self.get(transaction_id)

        assignments = ", ".join(f"{key} = ?" for key in data)
        values = [*data.values(), transaction_id]
        self.conn.execute(
            f"UPDATE transactions SET {assignments} WHERE id = ?",
            values,
        )
        self.conn.commit()
        return self.get(transaction_id)

    def delete(self, transaction_id: int) -> bool:
        cursor = self.conn.execute(
            "DELETE FROM transactions WHERE id = ?",
            (transaction_id,),
        )
        self.conn.commit()
        return cursor.rowcount > 0

    def delete_all(self) -> int:
        cursor = self.conn.execute("DELETE FROM transactions")
        self.conn.commit()
        return cursor.rowcount

    def list_by_account(
        self,
        account_id: int,
        skip: int = 0,
        limit: int = 100,
    ) -> List[TransactionOut]:
        rows = self.conn.execute(
            """
            SELECT *
            FROM transactions
            WHERE account_id = ?
            ORDER BY date DESC, id DESC
            LIMIT ? OFFSET ?
            """,
            (account_id, limit, skip),
        ).fetchall()
        return [TransactionOut(**dict(row)) for row in rows]

    def list_by_type(
        self,
        transaction_type: str,
        skip: int = 0,
        limit: int = 100,
    ) -> List[TransactionOut]:
        rows = self.conn.execute(
            """
            SELECT *
            FROM transactions
            WHERE type = ?
            ORDER BY date DESC, id DESC
            LIMIT ? OFFSET ?
            """,
            (transaction_type, limit, skip),
        ).fetchall()
        return [TransactionOut(**dict(row)) for row in rows]

    def list_by_date_range(
        self,
        start_date: str,
        end_date: str,
        skip: int = 0,
        limit: int = 500,
    ) -> List[TransactionOut]:
        rows = self.conn.execute(
            """
            SELECT *
            FROM transactions
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

    def monthly_expense_totals(self) -> list[dict]:
        rows = self.conn.execute(
            """
            SELECT
                substr(date, 1, 7) AS month,
                COALESCE(SUM(amount), 0) AS expense
            FROM transactions
            WHERE type = 'expense'
            GROUP BY substr(date, 1, 7)
            ORDER BY month ASC
            """
        ).fetchall()
        return [dict(row) for row in rows]

    def expense_total_for_category(
        self,
        category: str,
        start_date: str,
        end_date: str,
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

    def account_exists(self, account_id: int) -> bool:
        row = self.conn.execute(
            "SELECT 1 FROM accounts WHERE id = ?",
            (account_id,),
        ).fetchone()
        return row is not None

    def count_by_account(self, account_id: int) -> int:
        row = self.conn.execute(
            """
            SELECT COUNT(*) AS count
            FROM transactions
            WHERE account_id = ?
            """,
            (account_id,),
        ).fetchone()
        return int(row["count"])
