from typing import List, Optional
from app.repositories.account_repository import AccountRepository
from app.schemas.account import AccountCreate, AccountUpdate, AccountOut
from app.core.exceptions import AccountNotFoundError

class AccountService:
    def __init__(self, repository: AccountRepository):
        self.repository = repository

    def list_accounts(self) -> List[AccountOut]:
        return self.repository.list()

    def get_account(self, account_id: int) -> AccountOut:
        account = self.repository.get(account_id)
        if account is None:
            raise AccountNotFoundError(f"Account with id {account_id} not found")
        return account

    def create_account(self, account: AccountCreate) -> AccountOut:
        return self.repository.create(account)

    def update_account(self, account_id: int, account: AccountUpdate) -> AccountOut:
        updated_account = self.repository.update(account_id, account)
        if updated_account is None:
            raise AccountNotFoundError(f"Account with id {account_id} not found")
        return updated_account

    def delete_account(self, account_id: int) -> bool:
        deleted = self.repository.delete(account_id)
        if not deleted:
            raise AccountNotFoundError(f"Account with id {account_id} not found")
        return deleted

    def get_account_balance(self, account_id: int) -> float:
        return self.repository.get_balance(account_id)