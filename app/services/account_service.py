from typing import List

from app.core.exceptions import AccountDeletionError, AccountNotFoundError
from app.repositories.account_repository import AccountRepository
from app.schemas.account import AccountCreate, AccountOut, AccountUpdate


class AccountService:
    """Business rules for account lifecycle and balances."""

    def __init__(self, repository: AccountRepository):
        self.repository = repository

    def list_accounts(self) -> List[AccountOut]:
        accounts = self.repository.list()
        result: list[AccountOut] = []
        for account in accounts:
            current = self.repository.get_balance(account.id)
            result.append(account.model_copy(update={
                "current_balance": current,
            })
        return result

    def get_account(self, account_id: int) -> AccountOut:
        account = self.repository.get(account_id)
        if account is None:
            raise AccountNotFoundError(account_id)
        current = self.repository.get_balance(account_id)
        return account.model_copy(update={
            "current_balance": current,
        })

    def create_account(self, account: AccountCreate) -> AccountOut:
        created = self.repository.create(account)
        current = self.repository.get_balance(created.id)
        return created.model_copy(update={
            "current_balance": current,
        })

    def update_account(self, account_id: int, account: AccountUpdate) -> AccountOut:
        updated = self.repository.update(account_id, account)
        if updated is None:
            raise AccountNotFoundError(account_id)
        current = self.repository.get_balance(account_id)
        return updated.model_copy(update={
            "current_balance": current,
        })

    def delete_account(self, account_id: int) -> bool:
        if self.repository.get(account_id) is None:
            raise AccountNotFoundError(account_id)

        linked = self.repository.count_transactions(account_id)
        if linked:
            raise AccountDeletionError(account_id, linked)

        return self.repository.delete(account_id)

    def get_account_balance(self, account_id: int) -> float:
        if self.repository.get(account_id) is None:
            raise AccountNotFoundError(account_id)
        return self.repository.get_balance(account_id)
