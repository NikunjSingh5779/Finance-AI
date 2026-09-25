from fastapi import APIRouter, HTTPException
from sqlalchemy import text

from database import db_connection
from models import AccountIn

router = APIRouter()


@router.get("/accounts")
def list_accounts():
    with db_connection() as conn:
        rows = conn.execute(text("""
            SELECT a.*, a.balance + COALESCE(SUM(
                CASE WHEN t.type='income' THEN t.amount ELSE -t.amount END
            ), 0) AS calculated_balance
            FROM accounts a
            LEFT JOIN transactions t ON t.account_id=a.id
            GROUP BY a.id, a.name, a.balance, a.type
            ORDER BY a.name
        """)).mappings().all()
        return [
            {**{key: value for key, value in row.items() if key != "calculated_balance"},
             "balance": round(row["calculated_balance"], 2)}
            for row in rows
        ]


@router.post("/accounts", status_code=201)
def add_account(account: AccountIn):
    with db_connection() as conn:
        row = conn.execute(text("""
            INSERT INTO accounts (name, balance, type)
            VALUES (:name, :balance, :type)
            RETURNING *
        """), account.model_dump()).mappings().one()
        return dict(row)


@router.put("/accounts/{account_id}")
def update_account(account_id: int, account: AccountIn):
    with db_connection() as conn:
        row = conn.execute(text("""
            UPDATE accounts SET name=:name, balance=:balance, type=:type
            WHERE id=:id RETURNING *
        """), {**account.model_dump(), "id": account_id}).mappings().first()
        if not row:
            raise HTTPException(404, "Not found")
        return dict(row)


@router.delete("/accounts/{account_id}")
def delete_account(account_id: int):
    with db_connection() as conn:
        if not conn.execute(text("SELECT id FROM accounts WHERE id=:id"), {"id": account_id}).first():
            raise HTTPException(404, "Not found")
        conn.execute(text("UPDATE transactions SET account_id=NULL WHERE account_id=:id"), {"id": account_id})
        result = conn.execute(text("DELETE FROM accounts WHERE id=:id"), {"id": account_id})
        if result.rowcount == 0:
            raise HTTPException(404, "Not found")
        return {"deleted": account_id}
