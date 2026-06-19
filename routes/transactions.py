from fastapi import APIRouter, HTTPException, Request
from database import get_db
from models import TransactionIn, TransactionUpdate

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
        "INSERT INTO transactions (type,amount,desc,category,date,account_id) VALUES (?,?,?,?,?,?)",
        (txn.type, txn.amount, txn.desc, txn.category, txn.date, txn.account_id),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM transactions WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close()
    return dict(row)


@router.put("/transactions/{txn_id}")
def update_transaction(txn_id: int, txn: TransactionUpdate):
    conn = get_db()
    existing = conn.execute("SELECT * FROM transactions WHERE id=?", (txn_id,)).fetchone()
    if not existing:
        conn.close()
        raise HTTPException(404, "Not found")
    fields = {k: v for k, v in txn.model_dump(exclude_unset=True).items() if v is not None}
    if not fields:
        conn.close()
        raise HTTPException(400, "No fields to update")
    sets = ", ".join(f"{k}=?" for k in fields)
    vals = list(fields.values()) + [txn_id]
    conn.execute(f"UPDATE transactions SET {sets} WHERE id=?", vals)
    conn.commit()
    row = conn.execute("SELECT * FROM transactions WHERE id=?", (txn_id,)).fetchone()
    conn.close()
    return dict(row)


@router.post("/transactions/import", status_code=201)
def import_transactions(txns: list[TransactionIn]):
    conn = get_db()
    count = 0
    for txn in txns:
        conn.execute(
            "INSERT INTO transactions (type,amount,desc,category,date,account_id) VALUES (?,?,?,?,?,?)",
            (txn.type, txn.amount, txn.desc, txn.category, txn.date, txn.account_id),
        )
        count += 1
    conn.commit()
    conn.close()
    return {"imported": count}


@router.delete("/transactions/{txn_id}")
def delete_transaction(txn_id: int):
    conn = get_db()
    affected = conn.execute("DELETE FROM transactions WHERE id=?", (txn_id,)).rowcount
    conn.commit()
    conn.close()
    if not affected:
        raise HTTPException(404, "Not found")
    return {"deleted": txn_id}
