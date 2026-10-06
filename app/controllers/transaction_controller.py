from fastapi import APIRouter, HTTPException
from app.core.database import get_db
from app.repositories.transaction_repository import TransactionRepository
from app.services.transaction_service import TransactionService
from app.schemas.transaction import TransactionCreate, TransactionUpdate, TransactionOut

router = APIRouter()


@router.get("/transactions", response_model=list[TransactionOut])
def list_transactions(skip: int = 0, limit: int = 100):
    conn = get_db()
    try:
        repo = TransactionRepository(conn)
        service = TransactionService(repo)
        return service.list_transactions(skip=skip, limit=limit)
    finally:
        conn.close()


@router.post("/transactions", status_code=201, response_model=TransactionOut)
def add_transaction(txn: TransactionCreate):
    conn = get_db()
    try:
        repo = TransactionRepository(conn)
        service = TransactionService(repo)
        return service.create_transaction(txn)
    finally:
        conn.close()


@router.put("/transactions/{txn_id}", response_model=TransactionOut)
def update_transaction(txn_id: int, txn: TransactionUpdate):
    conn = get_db()
    try:
        repo = TransactionRepository(conn)
        service = TransactionService(repo)
        return service.update_transaction(txn_id, txn)
    finally:
        conn.close()


@router.post("/transactions/import", status_code=201)
def import_transactions(txns: list[TransactionCreate]):
    conn = get_db()
    try:
        repo = TransactionRepository(conn)
        service = TransactionService(repo)
        created = []
        errors = []
        for idx, txn in enumerate(txns):
            try:
                created_txn = service.create_transaction(txn)
                created.append(created_txn)
            except Exception as e:
                errors.append({"index": idx, "error": str(e), "transaction": txn})
        return {"created": created, "errors": errors}
    finally:
        conn.close()