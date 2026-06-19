from fastapi import APIRouter, HTTPException
from database import get_db
from models import TransactionIn

router = APIRouter()


@router.get("/transactions")
def list_transactions():
    conn = get_db()
    rows = conn.execute("SELECT * FROM transactions ORDER BY date DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


@router.post("/transactions", status_code=201)
def add_transaction(txn: TransactionIn):
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO transactions (type,amount,desc,category,date) VALUES (?,?,?,?,?)",
        (txn.type, txn.amount, txn.desc, txn.category, txn.date),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM transactions WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close()
    return dict(row)


@router.delete("/transactions/{txn_id}")
def delete_transaction(txn_id: int):
    conn = get_db()
    affected = conn.execute("DELETE FROM transactions WHERE id=?", (txn_id,)).rowcount
    conn.commit()
    conn.close()
    if not affected:
        raise HTTPException(404, "Not found")
    return {"deleted": txn_id}
