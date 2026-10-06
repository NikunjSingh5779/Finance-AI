from fastapi import APIRouter

from app.core.database import get_db
from app.repositories.budget_repository import BudgetRepository
from app.repositories.transaction_repository import TransactionRepository
from app.schemas.budget import BudgetCreate, BudgetOut, BudgetUpdate
from app.services.budget_service import BudgetService

router = APIRouter(prefix="/budgets", tags=["budgets"])


def _service(conn) -> BudgetService:
    return BudgetService(BudgetRepository(conn), TransactionRepository(conn))


@router.get("", response_model=list[BudgetOut])
def list_budgets():
    conn = get_db()
    try:
        return _service(conn).list_budgets()
    finally:
        conn.close()


@router.get("/{category}", response_model=BudgetOut)
def get_budget(category: str):
    conn = get_db()
    try:
        return _service(conn).get_budget(category)
    finally:
        conn.close()


@router.get("/{category}/status")
def get_budget_status(category: str, period: str = "1m"):
    conn = get_db()
    try:
        return _service(conn).get_budget_status(category, period)
    finally:
        conn.close()


@router.post("", status_code=201, response_model=BudgetOut)
def set_budget(budget: BudgetCreate):
    conn = get_db()
    try:
        return _service(conn).create_budget(budget)
    finally:
        conn.close()


@router.put("/{category}", response_model=BudgetOut)
def update_budget(category: str, budget: BudgetUpdate):
    conn = get_db()
    try:
        return _service(conn).update_budget(category, budget)
    finally:
        conn.close()


@router.delete("/{category}")
def delete_budget(category: str):
    conn = get_db()
    try:
        _service(conn).delete_budget(category)
        return {"deleted": category}
    finally:
        conn.close()
