from fastapi import APIRouter, Query

from app.core.database import get_db
from app.repositories.account_repository import AccountRepository
from app.services.net_worth_service import NetWorthService

router = APIRouter(prefix="/api/net-worth", tags=["net-worth"])


@router.get("")
def get_net_worth():
    conn = get_db()
    try:
        return NetWorthService(AccountRepository(conn)).snapshot()
    finally:
        conn.close()


@router.get("/history")
def get_net_worth_history(months: int = Query(12, ge=1, le=60)):
    conn = get_db()
    try:
        return {
            "months": months,
            "history": NetWorthService(AccountRepository(conn)).history(months),
        }
    finally:
        conn.close()
