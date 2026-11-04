import csv
from io import StringIO

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

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
    limit: int = Query(100, ge=1, le=5000),
):
    conn = get_db()
    try:
        return _service(conn).list_transactions(skip=skip, limit=limit)
    finally:
        conn.close()


@router.get("/count")
def count_transactions():
    conn = get_db()
    try:
        return {"count": TransactionRepository(conn).count()}
    finally:
        conn.close()


@router.get("/export.csv")
def export_transactions(
    transaction_type: str | None = Query(default=None, pattern="^(income|expense)$"),
):
    conn = get_db()
    try:
        repository = TransactionRepository(conn)
        rows = repository.list_by_type(
            transaction_type,
            skip=0,
            limit=100000,
        ) if transaction_type else repository.list(skip=0, limit=100000)

        buffer = StringIO()
        writer = csv.writer(buffer)
        writer.writerow([
            "id",
            "type",
            "amount",
            "description",
            "category",
            "date",
            "created",
            "account_id",
        ])
        for txn in rows:
            writer.writerow([
                txn.id,
                txn.type,
                txn.amount,
                txn.description,
                txn.category,
                txn.date,
                txn.created,
                txn.account_id,
            ])

        buffer.seek(0)
        return StreamingResponse(
            iter([buffer.getvalue()]),
            media_type="text/csv",
            headers={
                "Content-Disposition": 'attachment; filename="financeai-transactions.csv"'
            },
        )
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


@router.delete("/all")
def delete_all_transactions():
    conn = get_db()
    try:
        deleted = _service(conn).delete_all_transactions()
        return {"deleted": deleted}
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
    max_import_rows = 5000
    import_batch_size = 100
    if len(txns) > max_import_rows:
        raise HTTPException(
            status_code=413,
            detail=f"Import is limited to {max_import_rows:,} rows per request.",
        )

    conn = get_db()
    try:
        service = _service(conn)
        repository = service.repository
        created = []
        errors = []
        duplicates = []

        for batch_start in range(0, len(txns), import_batch_size):
            batch = txns[batch_start : batch_start + import_batch_size]
            duplicate_start = len(duplicates)
            error_start = len(errors)

            existing_fingerprints = repository.find_existing_import_fingerprints(batch)
            account_ids = [
                transaction.account_id
                for transaction in batch
                if transaction.account_id is not None
            ]
            valid_account_ids = repository.existing_account_ids(account_ids)

            accepted = []
            seen_in_batch = set()
            for offset, txn in enumerate(batch):
                index = batch_start + offset
                fingerprint = repository.import_fingerprint(txn)

                if fingerprint in existing_fingerprints or fingerprint in seen_in_batch:
                    duplicates.append({
                        "index": index,
                        "description": txn.description,
                        "date": txn.date,
                    })
                    continue

                if txn.account_id is not None and txn.account_id not in valid_account_ids:
                    errors.append({
                        "index": index,
                        "error": f"Account with id {txn.account_id} does not exist",
                        "transaction": txn.model_dump(),
                    })
                    continue

                seen_in_batch.add(fingerprint)
                accepted.append(txn)

            if not accepted:
                continue

            try:
                created_rows = repository.create_many_for_import(accepted)
                created.extend(transaction.model_dump() for transaction in created_rows)
            except Exception:
                # A database constraint/trigger can still reject a whole
                # statement. Fall back to the legacy row-by-row path for this
                # chunk so valid rows are retained and precise errors returned.
                conn.rollback()
                del duplicates[duplicate_start:]
                del errors[error_start:]

                for offset, txn in enumerate(batch):
                    index = batch_start + offset
                    try:
                        if repository.is_import_duplicate(txn):
                            duplicates.append({
                                "index": index,
                                "description": txn.description,
                                "date": txn.date,
                            })
                            continue
                        created.append(service.create_transaction(txn).model_dump())
                    except Exception as exc:
                        conn.rollback()
                        errors.append({
                            "index": index,
                            "error": str(exc),
                            "transaction": txn.model_dump(),
                        })

        return {
            "created": created,
            "errors": errors,
            "duplicates": duplicates,
            "imported": len(created),
            "duplicate_count": len(duplicates),
            "failed": len(errors),
        }
    finally:
        conn.close()
