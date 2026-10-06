from fastapi import APIRouter, HTTPException
from app.core.database import get_db
from app.repositories.account_repository import AccountRepository
from app.services.account_service import AccountService
from app.schemas.account import AccountCreate, AccountUpdate, AccountOut

router = APIRouter()


@router.get("/accounts", response_model=list[AccountOut])
def list_accounts():
    conn = get_db()
    try:
        repo = AccountRepository(conn)
        service = AccountService(repo)
        accounts = service.list_accounts()

        # Enhance accounts with current balance
        result = []
        for account in accounts:
            account_dict = account.model_dump()
            account_dict['balance'] = service.get_account_balance(account.id)
            result.append(AccountOut(**account_dict))
        return result
    finally:
        conn.close()


@router.post("/accounts", status_code=201, response_model=AccountOut)
def add_account(account: AccountCreate):
    conn = get_db()
    try:
        repo = AccountRepository(conn)
        service = AccountService(repo)
        return service.create_account(account)
    finally:
        conn.close()


@router.put("/accounts/{account_id}", response_model=AccountOut)
def update_account(account_id: int, account: AccountUpdate):
    conn = get_db()
    try:
        repo = AccountRepository(conn)
        service = AccountService(repo)
        updated_account = service.update_account(account_id, account)
        if updated_account is None:
            raise HTTPException(status_code=404, detail="Account not found")
        # Update balance after account update
        account_dict = updated_account.model_dump()
        account_dict['balance'] = service.get_account_balance(account_id)
        return AccountOut(**account_dict)
    finally:
        conn.close()


@router.delete("/accounts/{account_id}")
def delete_account(account_id: int):
    conn = get_db()
    try:
        repo = AccountRepository(conn)
        service = AccountService(repo)
        deleted = service.delete_account(account_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Account not found")
        return {"deleted": account_id}
    finally:
        conn.close()