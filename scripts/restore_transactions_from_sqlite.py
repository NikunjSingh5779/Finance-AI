"""Restore only deleted transactions from the original SQLite backup.

This is intentionally separate from migrate_sqlite_to_postgres.py:
- it never inserts or modifies budgets, accounts, or goals;
- it refuses to run if the target user's transaction rows are not empty;
- it refuses global transaction ID collisions;
- it verifies the source count and restores the original IDs.

PowerShell:
  $env:SOURCE_DB_PATH = (Resolve-Path ".\\finance.db").Path
  $env:TARGET_USER_ID = "<your Supabase Auth user UUID>"
  $env:DATABASE_URL = <securely entered Supabase Session Pooler URL>
  $env:CONFIRM_RESTORE_TRANSACTIONS = "RESTORE_TRANSACTIONS"
  python scripts/restore_transactions_from_sqlite.py
"""

from __future__ import annotations

import os
import sqlite3
import sys
from pathlib import Path
from uuid import UUID

import psycopg
from psycopg.rows import dict_row


def required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def main() -> int:
    source = Path(os.getenv("SOURCE_DB_PATH", "finance.db")).expanduser()
    database_url = required_env("DATABASE_URL")
    user_id = str(UUID(required_env("TARGET_USER_ID")))

    if os.getenv("CONFIRM_RESTORE_TRANSACTIONS", "") != "RESTORE_TRANSACTIONS":
        raise SystemExit(
            "Refusing to restore without CONFIRM_RESTORE_TRANSACTIONS="
            "RESTORE_TRANSACTIONS."
        )
    if not source.is_file():
        raise SystemExit(f"SQLite backup not found: {source}")

    sqlite_conn = sqlite3.connect(str(source))
    sqlite_conn.row_factory = sqlite3.Row
    pg = psycopg.connect(database_url, row_factory=dict_row)

    try:
        source_rows = sqlite_conn.execute(
            """
            SELECT id, type, amount, description, category, date, created, account_id
            FROM transactions
            ORDER BY id
            """
        ).fetchall()
        if not source_rows:
            raise SystemExit("The SQLite backup contains no transactions.")

        existing_for_user = pg.execute(
            "SELECT COUNT(*) AS count FROM public.transactions WHERE user_id = %s",
            (user_id,),
        ).fetchone()["count"]
        if existing_for_user:
            raise SystemExit(
                f"Target user already has {existing_for_user} transactions. "
                "Restore stopped without writing."
            )

        source_ids = [int(row["id"]) for row in source_rows]
        collisions = pg.execute(
            "SELECT COUNT(*) AS count FROM public.transactions WHERE id = ANY(%s)",
            (source_ids,),
        ).fetchone()["count"]
        if collisions:
            raise SystemExit(
                f"{collisions} source transaction ID(s) already exist in PostgreSQL. "
                "Restore stopped to avoid overwriting another record."
            )

        account_rows = pg.execute(
            "SELECT id FROM public.accounts WHERE user_id = %s",
            (user_id,),
        ).fetchall()
        valid_account_ids = {int(row["id"]) for row in account_rows}

        records = []
        detached_account_refs = 0
        for row in source_rows:
            account_id = row["account_id"]
            if account_id is not None and int(account_id) not in valid_account_ids:
                account_id = None
                detached_account_refs += 1

            records.append(
                (
                    int(row["id"]),
                    user_id,
                    row["type"],
                    row["amount"],
                    row["description"],
                    row["category"],
                    row["date"],
                    row["created"],
                    account_id,
                )
            )

        pg.executemany(
            """
            INSERT INTO public.transactions
              (id, user_id, type, amount, description, category, date, created, account_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            records,
        )
        pg.execute(
            """
            SELECT setval(
              pg_get_serial_sequence('public.transactions', 'id'),
              COALESCE((SELECT MAX(id) FROM public.transactions), 1),
              EXISTS(SELECT 1 FROM public.transactions)
            )
            """
        )
        pg.commit()

        restored = pg.execute(
            "SELECT COUNT(*) AS count FROM public.transactions WHERE user_id = %s",
            (user_id,),
        ).fetchone()["count"]
        if restored != len(records):
            raise RuntimeError(
                f"Verification mismatch: expected {len(records)}, found {restored}."
            )

        print(f"transactions restored: {restored}")
        print(f"legacy account references set to None: {detached_account_refs}")
        print("budgets, accounts, and goals were not modified")

    except Exception:
        pg.rollback()
        raise
    finally:
        sqlite_conn.close()
        pg.close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
