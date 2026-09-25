from fastapi import APIRouter, HTTPException
from sqlalchemy import text

from database import db_connection
from models import BudgetIn

router = APIRouter()


@router.get("/budgets")
def list_budgets():
    with db_connection() as conn:
        rows = conn.execute(text("SELECT * FROM budgets ORDER BY category")).mappings().all()
        return [dict(row) for row in rows]


@router.post("/budgets", status_code=201)
def set_budget(budget: BudgetIn):
    with db_connection() as conn:
        if conn.dialect.name == "postgresql":
            statement = text("""
                INSERT INTO budgets (category, limit_amt) VALUES (:category, :limit_amt)
                ON CONFLICT(category) DO UPDATE SET limit_amt=EXCLUDED.limit_amt
                RETURNING *
            """)
        else:
            statement = text("""
                INSERT INTO budgets (category, limit_amt) VALUES (:category, :limit_amt)
                ON CONFLICT(category) DO UPDATE SET limit_amt=excluded.limit_amt
                RETURNING *
            """)
        row = conn.execute(statement, budget.model_dump()).mappings().one()
        return dict(row)


@router.delete("/budgets/{category}")
def delete_budget(category: str):
    with db_connection() as conn:
        result = conn.execute(text("DELETE FROM budgets WHERE category=:category"), {"category": category})
        if result.rowcount == 0:
            raise HTTPException(404, "Not found")
        return {"deleted": category}
