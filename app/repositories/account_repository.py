from sqlite3 import Connection
from typing import List, Optional

from app.schemas.account import AccountCreate, AccountOut, AccountUpdate


class AccountRepository:
    """Persistence operations for financial accounts."""

    def __init__(self, conn: Connection):
        self.conn = conn

    def list(self) -> List[AccountOut]:
        rows = self.conn.execute(
            "SELECT * FROM accounts ORDER BY name"
        ).fetchall()
        return [AccountOut(**dict(row)) for row in rows]

    def get(self, account_id: int) -> Optional[AccountOut]:
        row = self.conn.execute(
            "SELECT * FROM accounts WHERE id = ?", (account_id,)
        ).fetchone()
        return AccountOut(**dict(row)) if row else None

    def create(self, account: AccountCreate) -> AccountOut:
        cursor = self.conn.execute(
            """
            INSERT INTO accounts (name, balance, type)
            VALUES (?, ?, ?)
            """,
            (account.name, account.balance, account.type),
        )
        self.conn.commit()
        return self.get(cursor.lastrowid)

    def update(self, account_id: int, account: AccountUpdate) -> Optional[AccountOut]:
        if self.get(account_id) is None:
            return None

        data = account.model_dump(exclude_unset=True)
        if not data:
            return self.get(account_id)

        allowed = {"name", "balance", "type"}
        data = {key: value for key, value in data.items() if key in allowed}
        if not data:
            return self.get(account_id)

        set_clause = ", ".join(f"{key} = ?" for key in data)
        values = list(data.values()) + [account_id]
        self.conn.execute(
            f"UPDATE accounts SET {set_clause} WHERE id = ?", values
        )
        self.conn.commit()
        return self.get(account_id)

    def delete(self, account_id: int) -> bool:
        cursor = self.conn.execute(
            "DELETE FROM accounts WHERE id = ?", (account_id,)
        )
        self.conn.commit()
        return cursor.rowcount > 0

    def get_balance(self, account_id: int) -> float:
        account = self.get(account_id)
        if account is None:
            return 0.0

        row = self.conn.execute(
            """
            SELECT
                COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
                COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
            FROM transactions
            WHERE account_id = ?
            """,
            (account_id,),
        ).fetchone()
        return round(
            float(account.balance) + float(row["income"]) - float(row["expense"]), 2
        )

    def count_transactions(self, account_id: int) -> int:
        row = self.conn.execute(
            "SELECT COUNT(*) AS count FROM transactions WHERE account_id = ?",
            (account_id,),
        ).fetchone()
        return int(row["count"])
