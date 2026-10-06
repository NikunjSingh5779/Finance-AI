from fastapi import APIRouter, Query

from app.core.database import get_db
from app.schemas.transaction import TransactionCreate, TransactionOut, TransactionUpdate
from app.repositories.transaction_repository import TransactionRepository
from app.services.transaction_service import TransactionService

router = APIRouter(prefix="/transactions", tags=["transactions"])


def _service(conn) -> TransactionService:
    return TransactionService(TransactionRepository(conn))


@router.get("", response_model=list[TransactionOut])
def list_transactions(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    conn = get_db()
    try:
        return _service(conn).list_transactions(skip=skip, limit=limit)
    finally:
        conn.close()


@router.get("/{txn_id}", response_model=TransactionOut)
def get_transaction(txn_id: int):
    conn = get_db()
    try:
        return _service(conn).get_transaction(txn_id)
    finally:
        conn.close()


@router.post("", status_code=201, response_model=TransactionOut)
def add_transaction(txn: TransactionCreate):
    conn = get_db()
    try:
        return _service(conn).create_transaction(txn)
    finally:
        conn.close()


@router.put("/{txn_id}", response_model=TransactionOut)
def update_transaction(txn_id: int, txn: TransactionUpdate):
    conn = get_db()
    try:
        return _service(conn).update_transaction(txn_id, txn)
    finally:
        conn.close()


@router.delete("/{txn_id}")
def delete_transaction(txn_id: int):
    conn = get_db()
    try:
        _service(conn).delete_transaction(txn_id)
        return {"deleted": txn_id}
    finally:
        conn.close()


@router.post("/import", status_code=201)
def import_transactions(txns: list[TransactionCreate]):
    conn = get_db()
    try:
        service = _service(conn)
        created = []
        errors = []

        for index, txn in enumerate(txns):
            try:
                created.append(service.create_transaction(txn).model_dump())
            except Exception as exc:
                errors.append({
                    "index": index,
                    "error": str(exc),
                    "transaction": txn.model_dump(),
                })

        return {
            "created": created,
            "errors": errors,
            "imported": len(created),
            "failed": len(errors),
        }
    finally:
        conn.close()
