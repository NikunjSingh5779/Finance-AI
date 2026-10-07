from typing import List

from app.core.exceptions import TransactionNotFoundError, ValidationError
from app.repositories.transaction_repository import TransactionRepository
from app.schemas.transaction import TransactionCreate, TransactionOut, TransactionUpdate


class TransactionService:
    """Business rules for transaction lifecycle operations."""

    def __init__(self, repository: TransactionRepository):
        self.repository = repository

    def list_transactions(self, skip: int = 0, limit: int = 100) -> List[TransactionOut]:
        if skip < 0:
            raise ValidationError("skip must be >= 0")
        if limit < 1 or limit > 5000:
            raise ValidationError("limit must be between 1 and 5000")
        return self.repository.list(skip=skip, limit=limit)

    def get_transaction(self, transaction_id: int) -> TransactionOut:
        transaction = self.repository.get(transaction_id)
        if transaction is None:
            raise TransactionNotFoundError(transaction_id)
        return transaction

    def create_transaction(self, transaction: TransactionCreate) -> TransactionOut:
        self._validate_account(transaction.account_id)
        return self.repository.create(transaction)

    def update_transaction(
        self, transaction_id: int, transaction: TransactionUpdate
    ) -> TransactionOut:
        self._validate_account(transaction.account_id)
        updated = self.repository.update(transaction_id, transaction)
        if updated is None:
            raise TransactionNotFoundError(transaction_id)
        return updated

    def delete_transaction(self, transaction_id: int) -> bool:
        deleted = self.repository.delete(transaction_id)
        if not deleted:
            raise TransactionNotFoundError(transaction_id)
        return deleted

    def delete_all_transactions(self) -> int:
        return self.repository.delete_all()

    def list_transactions_by_account(
        self, account_id: int, skip: int = 0, limit: int = 100
    ) -> List[TransactionOut]:
        if not self.repository.account_exists(account_id):
            raise ValidationError(f"Account with id {account_id} does not exist")
        return self.repository.list_by_account(account_id, skip=skip, limit=limit)

    def list_transactions_by_type(
        self, transaction_type: str, skip: int = 0, limit: int = 100
    ) -> List[TransactionOut]:
        if transaction_type not in ("income", "expense"):
            raise ValidationError("transaction_type must be 'income' or 'expense'")
        return self.repository.list_by_type(transaction_type, skip=skip, limit=limit)

    def list_transactions_by_date_range(
        self, start_date: str, end_date: str, skip: int = 0, limit: int = 100
    ) -> List[TransactionOut]:
        if start_date > end_date:
            raise ValidationError("start_date must be <= end_date")
        return self.repository.list_by_date_range(
            start_date, end_date, skip=skip, limit=limit
        )

    def _validate_account(self, account_id: int | None) -> None:
        if account_id is not None and not self.repository.account_exists(account_id):
            raise ValidationError(f"Account with id {account_id} does not exist")
