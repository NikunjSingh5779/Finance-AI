"""Migrate a single-user FinanceAI SQLite database into Supabase/PostgreSQL.

Usage:
  SOURCE_DB_PATH=finance.db DATABASE_URL=... TARGET_USER_ID=<uuid>   python scripts/migrate_sqlite_to_postgres.py

The target schema must already exist. This script preserves integer IDs and
assigns every existing record to TARGET_USER_ID.
"""

from __future__ import annotations

import os
import sqlite3
import sys
from pathlib import Path

import psycopg


TABLES = ("accounts", "transactions", "budgets", "goals")


def env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def main() -> int:
    source = Path(os.getenv("SOURCE_DB_PATH", "finance.db")).expanduser()
    database_url = env("DATABASE_URL")
    user_id = env("TARGET_USER_ID")

    if not source.exists():
        raise SystemExit(f"SQLite database not found: {source}")

    sqlite_conn = sqlite3.connect(str(source))
    sqlite_conn.row_factory = sqlite3.Row
    pg = psycopg.connect(database_url)

    try:
        for table in TABLES:
            rows = sqlite_conn.execute(f"SELECT * FROM {table}").fetchall()
            if not rows:
                continue

            if table == "accounts":
                for row in rows:
                    pg.execute(
                        """
                        INSERT INTO accounts (id, user_id, name, balance, type)
                        VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE SET
                          user_id = excluded.user_id,
                          name = excluded.name,
                          balance = excluded.balance,
                          type = excluded.type
                        """,
                        (
                            row["id"],
                            user_id,
                            row["name"],
                            row["balance"],
                            row["type"],
                        ),
                    )
            elif table == "transactions":
                for row in rows:
                    pg.execute(
                        """
                        INSERT INTO transactions
                          (id, user_id, type, amount, description, category, date,
                           created, account_id)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE SET
                          user_id = excluded.user_id,
                          type = excluded.type,
                          amount = excluded.amount,
                          description = excluded.description,
                          category = excluded.category,
                          date = excluded.date,
                          account_id = excluded.account_id
                        """,
                        (
                            row["id"],
                            user_id,
                            row["type"],
                            row["amount"],
                            row["description"],
                            row["category"],
                            row["date"],
                            row["created"],
                            row["account_id"],
                        ),
                    )
            elif table == "budgets":
                for row in rows:
                    pg.execute(
                        """
                        INSERT INTO budgets (id, user_id, category, limit_amt)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE SET
                          user_id = excluded.user_id,
                          category = excluded.category,
                          limit_amt = excluded.limit_amt
                        """,
                        (row["id"], user_id, row["category"], row["limit_amt"]),
                    )
            elif table == "goals":
                for row in rows:
                    pg.execute(
                        """
                        INSERT INTO goals
                          (id, user_id, name, target_amount, current_amount,
                           target_date, category, created)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE SET
                          user_id = excluded.user_id,
                          name = excluded.name,
                          target_amount = excluded.target_amount,
                          current_amount = excluded.current_amount,
                          target_date = excluded.target_date,
                          category = excluded.category
                        """,
                        (
                            row["id"],
                            user_id,
                            row["name"],
                            row["target_amount"],
                            row["current_amount"],
                            row["target_date"],
                            row["category"],
                            row["created"],
                        ),
                    )

        for table in TABLES:
            pg.execute(
                f"SELECT setval(pg_get_serial_sequence('public.{table}', 'id'), "
                f"COALESCE((SELECT MAX(id) FROM public.{table}), 1), true)"
            )

        pg.commit()

        for table in TABLES:
            count = pg.execute(
                f"SELECT COUNT(*) AS count FROM public.{table} WHERE user_id = %s",
                (user_id,),
            ).fetchone()["count"]
            print(f"{table}: {count} rows migrated")

    except Exception:
        pg.rollback()
        raise
    finally:
        sqlite_conn.close()
        pg.close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
