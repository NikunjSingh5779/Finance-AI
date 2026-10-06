from fastapi import APIRouter, HTTPException
from app.core.database import get_db
from app.repositories.budget_repository import BudgetRepository
from app.repositories.transaction_repository import TransactionRepository
from app.services.budget_service import BudgetService
from app.schemas.budget import BudgetCreate, BudgetUpdate, BudgetOut

router = APIRouter()


@router.get("/budgets", response_model=list[BudgetOut])
def list_budgets():
    conn = get_db()
    try:
        budget_repo = BudgetRepository(conn)
        transaction_repo = TransactionRepository(conn)
        service = BudgetService(budget_repo, transaction_repo)
        return service.list_budgets()
    finally:
        conn.close()


@router.post("/budgets", status_code=201, response_model=BudgetOut)
def set_budget(budget: BudgetCreate):
    conn = get_db()
    try:
        budget_repo = BudgetRepository(conn)
        transaction_repo = TransactionRepository(conn)
        service = BudgetService(budget_repo, transaction_repo)
        return service.create_budget(budget)
    finally:
        conn.close()


@router.get("/budgets/{category}/status")
def get_budget_status(category: str, period: str = "1m"):
    conn = get_db()
    try:
        budget_repo = BudgetRepository(conn)
        transaction_repo = TransactionRepository(conn)
        service = BudgetService(budget_repo, transaction_repo)
        return service.get_budget_status(category, period)
    finally:
        conn.close()


@router.delete("/budgets/{category}")
def delete_budget(category: str):
    conn = get_db()
    try:
        budget_repo = BudgetRepository(conn)
        transaction_repo = TransactionRepository(conn)
        service = BudgetService(budget_repo, transaction_repo)
        deleted = service.delete_budget(category)
        if not deleted:
            raise HTTPException(status_code=404, detail="Budget not found")
        return {"deleted": category}
    finally:
        conn.close()