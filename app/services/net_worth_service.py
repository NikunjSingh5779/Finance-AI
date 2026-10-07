from calendar import monthrange
from datetime import date

from app.repositories.account_repository import AccountRepository


class NetWorthService:
    """Build current and historical net-worth snapshots from account balances."""

    ASSET_TYPES = {"checking", "savings", "cash", "investment"}

    def __init__(self, repository: AccountRepository):
        self.repository = repository

    def snapshot(self) -> dict:
        accounts = self.repository.list()
        assets = []
        liabilities = []

        for account in accounts:
            balance = self.repository.get_balance(account.id)
            item = {
                "id": account.id,
                "name": account.name,
                "type": account.type,
                "balance": round(abs(balance) if account.type not in self.ASSET_TYPES else balance, 2),
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
                "Checking, savings, cash, and investment balances are treated "
                "as assets; credit balances are treated as liabilities."
            ),
        }

    def history(self, months: int = 12) -> list[dict]:
        months = max(1, min(int(months), 60))
        accounts = self.repository.list()
        today = date.today()
        points = []

        for offset in range(months - 1, -1, -1):
            month_number = today.month - offset
            year = today.year
            while month_number <= 0:
                month_number += 12
                year -= 1

            last_day = monthrange(year, month_number)[1]
            end_date = date(year, month_number, last_day)
            assets = 0.0
            liabilities = 0.0

            for account in accounts:
                balance = self.repository.get_balance_as_of(
                    account.id,
                    end_date.isoformat(),
                )
                if account.type in self.ASSET_TYPES:
                    assets += balance
                else:
                    liabilities += abs(balance)

            points.append({
                "month": f"{year:04d}-{month_number:02d}",
                "asset_total": round(assets, 2),
                "liability_total": round(liabilities, 2),
                "net_worth": round(assets - liabilities, 2),
            })

        return points
