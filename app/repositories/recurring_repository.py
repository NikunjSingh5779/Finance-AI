from __future__ import annotations

from datetime import date

from app.schemas.recurring import (
    RecurringItemCreate,
    RecurringItemOut,
    RecurringItemUpdate,
)
from app.schemas.transaction import TransactionOut


class RecurringRepository:
    """Persistence operations for scheduled income and expenses."""

    def __init__(self, conn):
        self.conn = conn

    @staticmethod
    def _map(row) -> RecurringItemOut:
        data = dict(row)
        data["is_active"] = bool(data["is_active"])
        return RecurringItemOut(**data)

    def list(self) -> list[RecurringItemOut]:
        rows = self.conn.execute(
            """
            SELECT *
            FROM recurring_items
            ORDER BY is_active DESC, next_due_date ASC, id DESC
            """
        ).fetchall()
        return [self._map(row) for row in rows]

    def get(self, item_id: int) -> RecurringItemOut | None:
        row = self.conn.execute(
            "SELECT * FROM recurring_items WHERE id = ?",
            (item_id,),
        ).fetchone()
        return self._map(row) if row else None

    def account_exists(self, account_id: int) -> bool:
        row = self.conn.execute(
            "SELECT id FROM accounts WHERE id = ?",
            (account_id,),
        ).fetchone()
        return row is not None

    def create(self, item: RecurringItemCreate) -> RecurringItemOut:
        due_date = date.fromisoformat(item.next_due_date)
        cursor = self.conn.execute(
            """
            INSERT INTO recurring_items (
                name, amount, type, category, frequency, next_due_date,
                schedule_day, schedule_month, account_id, is_active
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)
            RETURNING id
            """,
            (
                item.name, item.amount, item.type, item.category,
                item.frequency, item.next_due_date, due_date.day,
                due_date.month if item.frequency == "yearly" else None,
                item.account_id,
            ),
        )
        item_id = cursor.fetchone()["id"]
        self.conn.commit()
        created = self.get(item_id)
        if created is None:
            raise RuntimeError("Failed to retrieve created recurring item")
        return created

    def update(self, item_id: int, item: RecurringItemUpdate) -> RecurringItemOut | None:
        existing = self.get(item_id)
        if existing is None:
            return None
        data = item.model_dump(exclude_unset=True)
        if "next_due_date" in data and data["next_due_date"] is not None:
            due_date = date.fromisoformat(data["next_due_date"])
            data["schedule_day"] = due_date.day
            if data.get("frequency", existing.frequency) == "yearly":
                data["schedule_month"] = due_date.month
            else:
                data["schedule_month"] = None
        if not data:
            return existing
        allowed = {
            "name", "amount", "type", "category", "frequency", "next_due_date",
            "schedule_day", "schedule_month", "account_id", "is_active",
        }
        data = {key: value for key, value in data.items() if key in allowed}
        assignments = ", ".join(f"{key} = ?" for key in data)
        self.conn.execute(
            f"UPDATE recurring_items SET {assignments} WHERE id = ?",
            [*data.values(), item_id],
        )
        self.conn.commit()
        return self.get(item_id)

    def delete(self, item_id: int) -> bool:
        history = self.conn.execute(
            "SELECT 1 FROM transactions WHERE recurring_item_id = ? LIMIT 1",
            (item_id,),
        ).fetchone()
        if history:
            return False
        cursor = self.conn.execute(
            "DELETE FROM recurring_items WHERE id = ?",
            (item_id,),
        )
        self.conn.commit()
        return cursor.rowcount > 0

    def record_payment(
        self,
        item: RecurringItemOut,
        due_date: str,
        next_due_date: str,
    ) -> tuple[RecurringItemOut, TransactionOut] | None:
        # A conditional update acts as an optimistic lock against duplicate taps.
        cursor = self.conn.execute(
            """
            UPDATE recurring_items
            SET last_recorded_due_date = ?, next_due_date = ?
            WHERE id = ? AND next_due_date = ? AND is_active = TRUE
            """,
            (due_date, next_due_date, item.id, due_date),
        )
        if cursor.rowcount != 1:
            self.conn.rollback()
            return None

        try:
            inserted = self.conn.execute(
                """
                INSERT INTO transactions (
                    type, amount, description, category, date, account_id,
                    recurring_item_id
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                RETURNING id
                """,
                (
                    item.type, item.amount, item.name, item.category,
                    due_date, item.account_id, item.id,
                ),
            )
            transaction_id = inserted.fetchone()["id"]
            transaction_row = self.conn.execute(
                "SELECT * FROM transactions WHERE id = ?",
                (transaction_id,),
            ).fetchone()
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise

        updated_item = self.get(item.id)
        if updated_item is None:
            raise RuntimeError("Recurring item disappeared after payment recording")
        return updated_item, TransactionOut(**dict(transaction_row))
