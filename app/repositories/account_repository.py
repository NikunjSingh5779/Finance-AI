from typing import List, Optional
from sqlite3 import Connection
from app.models import AccountIn
from app.schemas.account import AccountCreate, AccountUpdate, AccountOut

class AccountRepository:
    def __init__(self, conn: Connection):
        self.conn = conn

    def list(self) -> List[AccountOut]:
        cursor = self.conn.execute("SELECT * FROM accounts ORDER BY name")
        rows = cursor.fetchall()
        return [AccountOut(**dict(row)) for row in rows]

    def get(self, account_id: int) -> Optional[AccountOut]:
        cursor = self.conn.execute("SELECT * FROM accounts WHERE id = ?", (account_id,))
        row = cursor.fetchone()
        if row:
            return AccountOut(**dict(row))
        return None

    def create(self, account: AccountCreate) -> AccountOut:
        cursor = self.conn.execute(
            """
            INSERT INTO accounts (name, balance, type)
            VALUES (?, ?, ?)
            """,
            (account.name, account.balance, account.type)
        )
        self.conn.commit()
        account_id = cursor.lastrowid
        return self.get(account_id)

    def update(self, account_id: int, account: AccountUpdate) -> Optional[AccountOut]:
        # First, check if the account exists
        existing = self.get(account_id)
        if not existing:
            return None

        # Build the update dictionary dynamically
        update_data = account.model_dump(exclude_unset=True)
        if not update_data:
            return existing

        # Build the SET clause and parameters
        set_clause = ", ".join([f"{key} = ?" for key in update_data.keys()])
        values = list(update_data.values()) + [account_id]

        self.conn.execute(
            f"UPDATE accounts SET {set_clause} WHERE id = ?",
            values
        )
        self.conn.commit()
        return self.get(account_id)

    def delete(self, account_id: int) -> bool:
        cursor = self.conn.execute(
            "DELETE FROM accounts WHERE id = ?",
            (account_id,)
        )
        self.conn.commit()
        return cursor.rowcount > 0

    def get_balance(self, account_id: int) -> float:
        """Calculate the current balance for an account."""
        # Get the initial balance from the account
        account = self.get(account_id)
        if not account:
            return 0.0

        # Calculate income and expenses for this account
        income_cursor = self.conn.execute(
            "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE account_id = ? AND type = 'income'",
            (account_id,)
        )
        income = income_cursor.fetchone()[0]

        expense_cursor = self.conn.execute(
            "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE account_id = ? AND type = 'expense'",
            (account_id,)
        )
        expense = expense_cursor.fetchone()[0]

        # Return initial balance + income - expenses
        return account.balance + income - expense