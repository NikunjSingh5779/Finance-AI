from typing import Any

from app.repositories.account_repository import AccountRepository


class NetWorthService:
    """Build a derived net-worth snapshot from current account balances."""

    ASSET_TYPES = {"checking", "savings", "cash", "investment"}

    def __init__(self, repository: AccountRepository):
        self.repository = repository

    def snapshot(self) -> dict[str, Any]:
        accounts = self.repository.list()
        assets = []
        liabilities = []
        for account in accounts:
            balance = self.repository.get_balance(account.id)
            item = {
                "id": account.id,
                "name": account.name,
                "type": account.type,
                "balance": round(balance, 2),
            }
            if account.type in self.ASSET_TYPES:
                assets.append(item)
            else:
                liabilities.append(item)

        asset_total = sum(item["balance"] for item in assets)
        liability_total = sum(item["balance"] for item in liabilities)
        return {
            "assets": assets,
            "liabilities": liabilities,
            "asset_total": round(asset_total, 2),
            "liability_total": round(liability_total, 2),
            "net_worth": round(asset_total - liability_total, 2),
            "methodology": (
                "Checking, savings, cash, and investment balances are treated as assets; "
                "credit balances are treated as liabilities."
            ),
        }
