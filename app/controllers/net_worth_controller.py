from fastapi import APIRouter

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
