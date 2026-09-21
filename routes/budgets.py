from fastapi import APIRouter, HTTPException
from database import get_db
from models import BudgetIn

router = APIRouter()


@router.get("/budgets")
def list_budgets():
    conn = get_db()
    try:
        rows = conn.execute("SELECT * FROM budgets ORDER BY category").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@router.post("/budgets", status_code=201)
def set_budget(b: BudgetIn):
    conn = get_db()
    try:
        conn.execute(
            """INSERT INTO budgets (category, limit_amt) VALUES (?,?)
               ON CONFLICT(category) DO UPDATE SET limit_amt=excluded.limit_amt""",
            (b.category, b.limit_amt),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM budgets WHERE category=?", (b.category,)).fetchone()
        return dict(row)
    finally:
        conn.close()


@router.delete("/budgets/{category}")
def delete_budget(category: str):
    conn = get_db()
    try:
        affected = conn.execute("DELETE FROM budgets WHERE category=?", (category,)).rowcount
        conn.commit()
        if not affected:
            raise HTTPException(404, "Not found")
        return {"deleted": category}
    finally:
        conn.close()
