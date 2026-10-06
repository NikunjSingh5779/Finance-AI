from typing import List, Optional
from app.repositories.transaction_repository import TransactionRepository
from app.schemas.transaction import TransactionCreate, TransactionUpdate, TransactionOut
from app.core.exceptions import TransactionNotFoundError

class TransactionService:
    def __init__(self, repository: TransactionRepository):
        self.repository = repository

    def list_transactions(self, skip: int = 0, limit: int = 100) -> List[TransactionOut]:
        return self.repository.list(skip=skip, limit=limit)

    def get_transaction(self, transaction_id: int) -> TransactionOut:
        transaction = self.repository.get(transaction_id)
        if transaction is None:
            raise TransactionNotFoundError(f"Transaction with id {transaction_id} not found")
        return transaction

    def create_transaction(self, transaction: TransactionCreate) -> TransactionOut:
        return self.repository.create(transaction)

    def update_transaction(self, transaction_id: int, transaction: TransactionUpdate) -> TransactionOut:
        updated_transaction = self.repository.update(transaction_id, transaction)
        if updated_transaction is None:
            raise TransactionNotFoundError(f"Transaction with id {transaction_id} not found")
        return updated_transaction

    def delete_transaction(self, transaction_id: int) -> bool:
        deleted = self.repository.delete(transaction_id)
        if not deleted:
            raise TransactionNotFoundError(f"Transaction with id {transaction_id} not found")
        return deleted

    def list_transactions_by_account(self, account_id: int, skip: int = 0, limit: int = 100) -> List[TransactionOut]:
        return self.repository.list_by_account(account_id, skip=skip, limit=limit)

    def list_transactions_by_type(self, transaction_type: str, skip: int = 0, limit: int = 100) -> List[TransactionOut]:
        return self.repository.list_by_type(transaction_type, skip=skip, limit=limit)

    def list_transactions_by_date_range(self, start_date: str, end_date: str, skip: int = 0, limit: int = 100) -> List[TransactionOut]:
        return self.repository.list_by_date_range(start_date, end_date, skip=skip, limit=limit)