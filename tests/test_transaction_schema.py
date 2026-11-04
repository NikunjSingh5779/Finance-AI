from datetime import datetime, timezone

from app.schemas.transaction import TransactionOut


def _transaction(created):
    return TransactionOut(
        id=1,
        type="expense",
        amount=125.5,
        description="Test transaction",
        category="Other",
        date="2026-11-04",
        created=created,
    )


def test_transaction_out_normalizes_postgres_datetime():
    timestamp = datetime(2026, 11, 4, 0, 10, tzinfo=timezone.utc)

    transaction = _transaction(timestamp)

    assert transaction.created == "2026-11-04T00:10:00+00:00"


def test_transaction_out_preserves_sqlite_timestamp_string():
    timestamp = "2026-11-04 00:10:00"

    transaction = _transaction(timestamp)

    assert transaction.created == timestamp
