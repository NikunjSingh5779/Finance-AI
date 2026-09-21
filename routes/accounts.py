from fastapi import APIRouter, HTTPException
from database import get_db
from models import AccountIn

router = APIRouter()


@router.get("/accounts")
def list_accounts():
    conn = get_db()
    try:
        rows = conn.execute("SELECT * FROM accounts ORDER BY name").fetchall()
        result = []
        for r in rows:
            a = dict(r)
            inc = conn.execute(
                "SELECT COALESCE(SUM(amount),0) FROM transactions WHERE account_id=? AND type='income'",
                (a['id'],)
            ).fetchone()[0]
            exp = conn.execute(
                "SELECT COALESCE(SUM(amount),0) FROM transactions WHERE account_id=? AND type='expense'",
                (a['id'],)
            ).fetchone()[0]
            a['balance'] = round(a['balance'] + inc - exp, 2)
            result.append(a)
        return result
    finally:
        conn.close()


@router.post("/accounts", status_code=201)
def add_account(a: AccountIn):
    conn = get_db()
    try:
        cur = conn.execute(
            "INSERT INTO accounts (name,balance,type) VALUES (?,?,?)",
            (a.name, a.balance, a.type),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM accounts WHERE id=?", (cur.lastrowid,)).fetchone()
        return dict(row)
    finally:
        conn.close()


@router.put("/accounts/{account_id}")
def update_account(account_id: int, a: AccountIn):
    conn = get_db()
    try:
        cur = conn.execute(
            "UPDATE accounts SET name=?, balance=?, type=? WHERE id=?",
            (a.name, a.balance, a.type, account_id),
        )
        conn.commit()
        if not cur.rowcount:
            raise HTTPException(404, "Not found")
        row = conn.execute("SELECT * FROM accounts WHERE id=?", (account_id,)).fetchone()
        return dict(row)
    finally:
        conn.close()


@router.delete("/accounts/{account_id}")
def delete_account(account_id: int):
    conn = get_db()
    try:
        affected = conn.execute("DELETE FROM accounts WHERE id=?", (account_id,)).rowcount
        conn.commit()
        if not affected:
            raise HTTPException(404, "Not found")
        return {"deleted": account_id}
    finally:
        conn.close()
