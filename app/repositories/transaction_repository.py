from typing import List, Optional
from sqlite3 import Connection
from app.models import TransactionIn, TransactionUpdate
from app.schemas.transaction import TransactionCreate, TransactionUpdate as SchemaTransactionUpdate, TransactionOut as SchemaTransactionOut

class TransactionRepository:
    def __init__(self, conn: Connection):
        self.conn = conn

    def list(self, skip: int = 0, limit: int = 100) -> List[SchemaTransactionOut]:
        cursor = self.conn.execute(
            "SELECT * FROM transactions ORDER BY date DESC LIMIT ? OFFSET ?",
            (limit, skip)
        )
        rows = cursor.fetchall()
        return [SchemaTransactionOut(**dict(row)) for row in rows]

    def get(self, transaction_id: int) -> Optional[SchemaTransactionOut]:
        cursor = self.conn.execute(
            "SELECT * FROM transactions WHERE id = ?",
            (transaction_id,)
        )
        row = cursor.fetchone()
        if row:
            return SchemaTransactionOut(**dict(row))
        return None

    def create(self, transaction: TransactionCreate) -> SchemaTransactionOut:
        cursor = self.conn.execute(
            """
            INSERT INTO transactions (type, amount, description, category, date, account_id)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (transaction.type, transaction.amount, transaction.description,
             transaction.category, transaction.date, transaction.account_id)
        )
        self.conn.commit()
        transaction_id = cursor.lastrowid
        return self.get(transaction_id)

    def update(self, transaction_id: int, transaction: SchemaTransactionUpdate) -> Optional[SchemaTransactionOut]:
        # First, check if the transaction exists
        existing = self.get(transaction_id)
        if not existing:
            return None

        # Build the update dictionary dynamically
        update_data = transaction.model_dump(exclude_unset=True)
        if not update_data:
            return existing

        # Build the SET clause and parameters
        set_clause = ", ".join([f"{key} = ?" for key in update_data.keys()])
        values = list(update_data.values()) + [transaction_id]

        self.conn.execute(
            f"UPDATE transactions SET {set_clause} WHERE id = ?",
            values
        )
        self.conn.commit()
        return self.get(transaction_id)

    def delete(self, transaction_id: int) -> bool:
        cursor = self.conn.execute(
            "DELETE FROM transactions WHERE id = ?",
            (transaction_id,)
        )
        self.conn.commit()
        return cursor.rowcount > 0

    def list_by_account(self, account_id: int, skip: int = 0, limit: int = 100) -> List[SchemaTransactionOut]:
        cursor = self.conn.execute(
            """
            SELECT * FROM transactions
            WHERE account_id = ?
            ORDER BY date DESC
            LIMIT ? OFFSET ?
            """,
            (account_id, limit, skip)
        )
        rows = cursor.fetchall()
        return [SchemaTransactionOut(**dict(row)) for row in rows]

    def list_by_type(self, transaction_type: str, skip: int = 0, limit: int = 100) -> List[SchemaTransactionOut]:
        cursor = self.conn.execute(
            """
            SELECT * FROM transactions
            WHERE type = ?
            ORDER BY date DESC
            LIMIT ? OFFSET ?
            """,
            (transaction_type, limit, skip)
        )
        rows = cursor.fetchall()
        return [SchemaTransactionOut(**dict(row)) for row in rows]

    def list_by_date_range(self, start_date: str, end_date: str, skip: int = 0, limit: int = 100) -> List[SchemaTransactionOut]:
        cursor = self.conn.execute(
            """
            SELECT * FROM transactions
            WHERE date BETWEEN ? AND ?
            ORDER BY date DESC
            LIMIT ? OFFSET ?
            """,
            (start_date, end_date, limit, skip)
        )
        rows = cursor.fetchall()
        return [SchemaTransactionOut(**dict(row)) for row in rows]