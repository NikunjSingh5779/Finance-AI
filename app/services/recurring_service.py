import calendar
from datetime import date, timedelta

from fastapi import HTTPException

from app.repositories.recurring_repository import RecurringRepository
from app.schemas.recurring import (
    RecurringItemCreate,
    RecurringItemOut,
    RecurringItemUpdate,
)


def advance_due_date(
    due_date: str,
    frequency: str,
    schedule_day: int | None = None,
    schedule_month: int | None = None,
) -> str:
    """Advance a schedule without drifting from its original day."""
    current = date.fromisoformat(due_date)
    anchor_day = schedule_day or current.day

    if frequency == "weekly":
        return (current + timedelta(days=7)).isoformat()
    if frequency == "monthly":
        year = current.year + (1 if current.month == 12 else 0)
        month = 1 if current.month == 12 else current.month + 1
        day = min(anchor_day, calendar.monthrange(year, month)[1])
        return date(year, month, day).isoformat()
    if frequency == "yearly":
        month = schedule_month or current.month
        year = current.year + 1
        day = min(anchor_day, calendar.monthrange(year, month)[1])
        return date(year, month, day).isoformat()
    raise ValueError("Unsupported recurring frequency")


class RecurringService:
    """Business rules for recurring income and expense schedules."""

    def __init__(self, repository: RecurringRepository):
        self.repository = repository

    def list_items(
        self,
        include_archived: bool = False,
    ) -> list[RecurringItemOut]:
        return self.repository.list(include_archived=include_archived)

    def get_item(self, item_id: int) -> RecurringItemOut:
        item = self.repository.get(item_id)
        if item is None:
            raise HTTPException(status_code=404, detail="Recurring item not found")
        return item

    def create_item(self, item: RecurringItemCreate) -> RecurringItemOut:
        if item.account_id is not None and not self.repository.account_exists(item.account_id):
            raise HTTPException(status_code=422, detail="Selected account does not exist")
        return self.repository.create(item)

    def update_item(self, item_id: int, item: RecurringItemUpdate) -> RecurringItemOut:
        self.get_item(item_id)
        data = item.model_dump(exclude_unset=True)
        account_id = data.get("account_id")
        if account_id is not None and not self.repository.account_exists(account_id):
            raise HTTPException(status_code=422, detail="Selected account does not exist")
        if data.get("is_archived") is True:
            data["is_active"] = False
            item = RecurringItemUpdate(**data)
        updated = self.repository.update(item_id, item)
        if updated is None:
            raise HTTPException(status_code=404, detail="Recurring item not found")
        return updated

    def delete_item(self, item_id: int) -> None:
        if self.repository.get(item_id) is None:
            raise HTTPException(status_code=404, detail="Recurring item not found")
        if not self.repository.delete(item_id):
            raise HTTPException(
                status_code=409,
                detail="This schedule has payment history. Pause it instead of deleting it.",
            )

    def record_payment(self, item_id: int, due_date: str) -> dict:
        item = self.get_item(item_id)
        if item.is_archived:
            raise HTTPException(
                status_code=409,
                detail="Archived schedules cannot be marked paid.",
            )
        if not item.is_active:
            raise HTTPException(
                status_code=409,
                detail="Paused schedules cannot be marked paid.",
            )
        if due_date != item.next_due_date:
            raise HTTPException(
                status_code=409,
                detail="This due date is no longer current. Refresh the recurring schedule.",
            )
        next_due = advance_due_date(
            due_date, item.frequency, item.schedule_day, item.schedule_month
        )
        try:
            result = self.repository.record_payment(item, due_date, next_due)
        except Exception as exc:
            message = str(exc).lower()
            if "unique" in message or "duplicate" in message:
                raise HTTPException(
                    status_code=409,
                    detail="This recurring payment has already been recorded.",
                ) from exc
            raise
        if result is None:
            raise HTTPException(
                status_code=409,
                detail="This recurring payment was already recorded or the schedule changed.",
            )
        updated_item, transaction = result
        return {"item": updated_item, "transaction": transaction}
