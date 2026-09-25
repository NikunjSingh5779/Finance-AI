from fastapi import APIRouter, HTTPException
from sqlalchemy import text

from database import db_connection
from models import TransactionIn, TransactionUpdate

router = APIRouter()


@router.get("/transactions")
def list_transactions():
    with db_connection() as conn:
        rows = conn.execute(text("SELECT * FROM transactions ORDER BY date DESC")).mappings().all()
        return [dict(row) for row in rows]


@router.post("/transactions", status_code=201)
def add_transaction(txn: TransactionIn):
    with db_connection() as conn:
        if txn.account_id is not None and not conn.execute(
            text("SELECT 1 FROM accounts WHERE id=:account_id"), {"account_id": txn.account_id}
        ).first():
            raise HTTPException(404, "Account not found")
        row = conn.execute(text("""
            INSERT INTO transactions (type, amount, description, category, date, account_id)
            VALUES (:type, :amount, :description, :category, :date, :account_id)
            RETURNING *
        """), txn.model_dump()).mappings().one()
        return dict(row)


@router.put("/transactions/{txn_id}")
def update_transaction(txn_id: int, txn: TransactionUpdate):
    with db_connection() as conn:
        if not conn.execute(text("SELECT 1 FROM transactions WHERE id=:id"), {"id": txn_id}).first():
            raise HTTPException(404, "Not found")
        fields = {k: v for k, v in txn.model_dump(exclude_unset=True).items() if v is not None}
        if not fields:
            raise HTTPException(400, "No fields to update")
        if "account_id" in fields and not conn.execute(
            text("SELECT 1 FROM accounts WHERE id=:account_id"), {"account_id": fields["account_id"]}
        ).first():
            raise HTTPException(404, "Account not found")
        allowed_fields = {"type", "amount", "description", "category", "date", "account_id"}
        fields = {key: value for key, value in fields.items() if key in allowed_fields}
        assignments = ", ".join(f"{key}=:{key}" for key in fields)
        fields["id"] = txn_id
        row = conn.execute(
            text(f"UPDATE transactions SET {assignments} WHERE id=:id RETURNING *"), fields
        ).mappings().one()
        return dict(row)


@router.post("/transactions/import", status_code=201)
def import_transactions(txns: list[TransactionIn]):
    with db_connection() as conn:
        for txn in txns:
            if txn.account_id is not None and not conn.execute(
                text("SELECT 1 FROM accounts WHERE id=:account_id"), {"account_id": txn.account_id}
            ).first():
                raise HTTPException(404, "Account not found")
            conn.execute(text("""
                INSERT INTO transactions (type, amount, description, category, date, account_id)
                VALUES (:type, :amount, :description, :category, :date, :account_id)
            """), txn.model_dump())
        return {"imported": len(txns)}


@router.delete("/transactions/{txn_id}")
def delete_transaction(txn_id: int):
    with db_connection() as conn:
        result = conn.execute(text("DELETE FROM transactions WHERE id=:id"), {"id": txn_id})
        if result.rowcount == 0:
            raise HTTPException(404, "Not found")
        return {"deleted": txn_id}
