from fastapi import APIRouter

from app.core.database import get_db
from app.schemas.account import AccountCreate, AccountOut, AccountUpdate
from app.repositories.account_repository import AccountRepository
from app.services.account_service import AccountService

router = APIRouter(prefix="/accounts", tags=["accounts"])


def _service(conn) -> AccountService:
    return AccountService(AccountRepository(conn))


@router.get("", response_model=list[AccountOut])
def list_accounts():
    conn = get_db()
    try:
        return _service(conn).list_accounts()
    finally:
        conn.close()


@router.get("/{account_id}", response_model=AccountOut)
def get_account(account_id: int):
    conn = get_db()
    try:
        return _service(conn).get_account(account_id)
    finally:
        conn.close()


@router.post("", status_code=201, response_model=AccountOut)
def add_account(account: AccountCreate):
    conn = get_db()
    try:
        return _service(conn).create_account(account)
    finally:
        conn.close()


@router.put("/{account_id}", response_model=AccountOut)
def update_account(account_id: int, account: AccountUpdate):
    conn = get_db()
    try:
        return _service(conn).update_account(account_id, account)
    finally:
        conn.close()


@router.delete("/{account_id}")
def delete_account(account_id: int):
    conn = get_db()
    try:
        _service(conn).delete_account(account_id)
        return {"deleted": account_id}
    finally:
        conn.close()
