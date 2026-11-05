from fastapi import APIRouter, Query

from app.core.database import get_db
from app.repositories.recurring_repository import RecurringRepository
from app.schemas.recurring import (
    RecurringItemCreate,
    RecurringItemOut,
    RecurringItemUpdate,
    RecurringPaymentRequest,
)
from app.services.recurring_service import RecurringService

router = APIRouter(prefix="/recurring", tags=["recurring payments"])


def _service(conn) -> RecurringService:
    return RecurringService(RecurringRepository(conn))


@router.get("", response_model=list[RecurringItemOut])
def list_recurring_items(
    include_archived: bool = Query(False),
):
    conn = get_db()
    try:
        return _service(conn).list_items(
            include_archived=include_archived
        )
    finally:
        conn.close()


@router.get("/{item_id}", response_model=RecurringItemOut)
def get_recurring_item(item_id: int):
    conn = get_db()
    try:
        return _service(conn).get_item(item_id)
    finally:
        conn.close()


@router.post("", status_code=201, response_model=RecurringItemOut)
def create_recurring_item(item: RecurringItemCreate):
    conn = get_db()
    try:
        return _service(conn).create_item(item)
    finally:
        conn.close()


@router.put("/{item_id}", response_model=RecurringItemOut)
def update_recurring_item(item_id: int, item: RecurringItemUpdate):
    conn = get_db()
    try:
        return _service(conn).update_item(item_id, item)
    finally:
        conn.close()


@router.delete("/{item_id}")
def delete_recurring_item(item_id: int):
    conn = get_db()
    try:
        _service(conn).delete_item(item_id)
        return {"deleted": item_id}
    finally:
        conn.close()


@router.post("/{item_id}/record", status_code=201)
def record_recurring_payment(item_id: int, payload: RecurringPaymentRequest):
    conn = get_db()
    try:
        return _service(conn).record_payment(item_id, payload.due_date)
    finally:
        conn.close()
