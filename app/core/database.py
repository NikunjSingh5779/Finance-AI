"""Database connectivity and schema management.

SQLite remains the local-development default. Production deployments can set
DATABASE_URL to use Supabase/PostgreSQL with database-level row isolation.
"""

from __future__ import annotations

import logging
import os
import sqlite3
from pathlib import Path
from typing import Any

from app.core.auth import get_current_user_id

logger = logging.getLogger(__name__)


POSTGRES_SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL DEFAULT auth.uid(),
    name        TEXT NOT NULL,
    balance     DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    type        TEXT NOT NULL DEFAULT 'checking'
        CHECK(type IN ('checking','savings','credit','cash','investment')),
    UNIQUE(id, user_id)
);

CREATE TABLE IF NOT EXISTS transactions (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL DEFAULT auth.uid(),
    type        TEXT NOT NULL CHECK(type IN ('income','expense')),
    amount      DOUBLE PRECISION NOT NULL CHECK(amount > 0),
    description TEXT NOT NULL,
    category    TEXT NOT NULL,
    date        TEXT NOT NULL,
    created     TIMESTAMPTZ DEFAULT NOW(),
    account_id  BIGINT,
    CONSTRAINT transactions_account_user_fk
        FOREIGN KEY (account_id, user_id)
        REFERENCES accounts(id, user_id)
);

CREATE TABLE IF NOT EXISTS budgets (
    id        BIGSERIAL PRIMARY KEY,
    user_id   UUID NOT NULL DEFAULT auth.uid(),
    category  TEXT NOT NULL,
    limit_amt DOUBLE PRECISION NOT NULL CHECK(limit_amt > 0),
    UNIQUE(user_id, category)
);

CREATE TABLE IF NOT EXISTS goals (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID NOT NULL DEFAULT auth.uid(),
    name            TEXT NOT NULL,
    target_amount   DOUBLE PRECISION NOT NULL CHECK(target_amount > 0),
    current_amount  DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK(current_amount >= 0),
    target_date     TEXT,
    category        TEXT NOT NULL DEFAULT 'Savings',
    created         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounts_user_id
    ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id
    ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date
    ON transactions(user_id, date);
CREATE INDEX IF NOT EXISTS idx_transactions_category
    ON transactions(user_id, category);
CREATE INDEX IF NOT EXISTS idx_transactions_account
    ON transactions(user_id, account_id);
CREATE INDEX IF NOT EXISTS idx_budgets_user_id
    ON budgets(user_id);
CREATE INDEX IF NOT EXISTS idx_goals_user_id
    ON goals(user_id);
CREATE INDEX IF NOT EXISTS idx_goals_target_date
    ON goals(user_id, target_date);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON accounts, transactions, budgets, goals
TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

DROP POLICY IF EXISTS accounts_select_own ON accounts;
DROP POLICY IF EXISTS accounts_insert_own ON accounts;
DROP POLICY IF EXISTS accounts_update_own ON accounts;
DROP POLICY IF EXISTS accounts_delete_own ON accounts;
CREATE POLICY accounts_select_own ON accounts
    FOR SELECT TO authenticated
    USING ((select auth.uid()) = user_id);
CREATE POLICY accounts_insert_own ON accounts
    FOR INSERT TO authenticated
    WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY accounts_update_own ON accounts
    FOR UPDATE TO authenticated
    USING ((select auth.uid()) = user_id)
    WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY accounts_delete_own ON accounts
    FOR DELETE TO authenticated
    USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS transactions_select_own ON transactions;
DROP POLICY IF EXISTS transactions_insert_own ON transactions;
DROP POLICY IF EXISTS transactions_update_own ON transactions;
DROP POLICY IF EXISTS transactions_delete_own ON transactions;
CREATE POLICY transactions_select_own ON transactions
    FOR SELECT TO authenticated
    USING ((select auth.uid()) = user_id);
CREATE POLICY transactions_insert_own ON transactions
    FOR INSERT TO authenticated
    WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY transactions_update_own ON transactions
    FOR UPDATE TO authenticated
    USING ((select auth.uid()) = user_id)
    WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY transactions_delete_own ON transactions
    FOR DELETE TO authenticated
    USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS budgets_select_own ON budgets;
DROP POLICY IF EXISTS budgets_insert_own ON budgets;
DROP POLICY IF EXISTS budgets_update_own ON budgets;
DROP POLICY IF EXISTS budgets_delete_own ON budgets;
CREATE POLICY budgets_select_own ON budgets
    FOR SELECT TO authenticated
    USING ((select auth.uid()) = user_id);
CREATE POLICY budgets_insert_own ON budgets
    FOR INSERT TO authenticated
    WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY budgets_update_own ON budgets
    FOR UPDATE TO authenticated
    USING ((select auth.uid()) = user_id)
    WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY budgets_delete_own ON budgets
    FOR DELETE TO authenticated
    USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS goals_select_own ON goals;
DROP POLICY IF EXISTS goals_insert_own ON goals;
DROP POLICY IF EXISTS goals_update_own ON goals;
DROP POLICY IF EXISTS goals_delete_own ON goals;
CREATE POLICY goals_select_own ON goals
    FOR SELECT TO authenticated
    USING ((select auth.uid()) = user_id);
CREATE POLICY goals_insert_own ON goals
    FOR INSERT TO authenticated
    WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY goals_update_own ON goals
    FOR UPDATE TO authenticated
    USING ((select auth.uid()) = user_id)
    WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY goals_delete_own ON goals
    FOR DELETE TO authenticated
    USING ((select auth.uid()) = user_id);
"""


def using_postgres() -> bool:
    return bool(os.getenv("DATABASE_URL", "").strip())


def _dev_user_id() -> str:
    return os.getenv(
        "DEV_USER_ID",
        "00000000-0000-0000-0000-000000000001",
    )


def _connect_postgres() -> Any:
    try:
        import psycopg
        from psycopg.rows import dict_row
    except ImportError as exc:
        raise RuntimeError(
            "PostgreSQL support requires psycopg. Install requirements.txt."
        ) from exc

    conn = psycopg.connect(
        os.environ["DATABASE_URL"],
        row_factory=dict_row,
        connect_timeout=10,
    )
    user_id = get_current_user_id()
    if user_id:
        conn.execute("SET LOCAL ROLE authenticated")
        conn.execute(
            "SELECT set_config('request.jwt.claim.sub', %s, true)",
            (user_id,),
        )
        conn.execute(
            "SELECT set_config('request.jwt.claims', %s, true)",
            ('{"role":"authenticated","sub":"' + user_id + '"}',),
        )
    return conn


class SQLiteCompatConnection:
    """Tiny adapter so repository SQL remains compatible with psycopg."""

    def __init__(self, conn: Any):
        self._conn = conn

    def execute(self, sql: str, params: tuple[Any, ...] | list[Any] = ()):
        return self._conn.execute(sql.replace("?", "%s"), params)

    def commit(self) -> None:
        self._conn.commit()

    def rollback(self) -> None:
        self._conn.rollback()

    def close(self) -> None:
        self._conn.close()


def get_db() -> Any:
    """Open a database connection for the current authenticated request."""
    if using_postgres():
        return _connect_postgres()

    db_path = Path(os.getenv("DB_PATH", "finance.db")).expanduser()
    if db_path.parent != Path("."):
        db_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(db_path), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 10000")
    return conn


def init_db() -> None:
    """Create the database schema and apply idempotent local migrations."""
    if using_postgres():
        conn = _connect_postgres()
        try:
            conn.execute(POSTGRES_SCHEMA)
            conn.commit()
        except Exception:
            conn.rollback()
            logger.exception("PostgreSQL schema initialization failed")
            raise
        finally:
            conn.close()
        return

    conn = get_db()
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS accounts (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id   TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
                name      TEXT NOT NULL,
                balance   REAL    NOT NULL DEFAULT 0.0,
                type      TEXT    NOT NULL DEFAULT 'checking'
                    CHECK(type IN ('checking','savings','credit','cash','investment'))
            );

            CREATE TABLE IF NOT EXISTS transactions (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     TEXT    NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
                type        TEXT    NOT NULL CHECK(type IN ('income','expense')),
                amount      REAL    NOT NULL CHECK(amount > 0),
                description TEXT    NOT NULL,
                category    TEXT    NOT NULL,
                date        TEXT    NOT NULL,
                created     TEXT    DEFAULT (datetime('now')),
                account_id  INTEGER REFERENCES accounts(id)
            );

            CREATE TABLE IF NOT EXISTS budgets (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id   TEXT    NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
                category  TEXT    NOT NULL,
                limit_amt REAL    NOT NULL CHECK(limit_amt > 0)
            );

            CREATE TABLE IF NOT EXISTS goals (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id         TEXT    NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
                name            TEXT    NOT NULL,
                target_amount   REAL    NOT NULL CHECK(target_amount > 0),
                current_amount  REAL    NOT NULL DEFAULT 0 CHECK(current_amount >= 0),
                target_date     TEXT,
                category        TEXT    NOT NULL DEFAULT 'Savings',
                created         TEXT    DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_transactions_date
                ON transactions(date);
            CREATE INDEX IF NOT EXISTS idx_transactions_category
                ON transactions(category);
            CREATE INDEX IF NOT EXISTS idx_transactions_account
                ON transactions(account_id);
            CREATE INDEX IF NOT EXISTS idx_transactions_user_id
                ON transactions(user_id);
            CREATE INDEX IF NOT EXISTS idx_accounts_user_id
                ON accounts(user_id);
            CREATE INDEX IF NOT EXISTS idx_budgets_user_id
                ON budgets(user_id);
            CREATE INDEX IF NOT EXISTS idx_goals_user_id
                ON goals(user_id);
        """
        )
        _run_migrations(conn)
        conn.commit()
    except sqlite3.Error:
        conn.rollback()
        logger.exception("Database initialization failed")
        raise
    finally:
        conn.close()


def _run_migrations(conn: sqlite3.Connection) -> None:
    """Apply safe, idempotent migrations to older SQLite databases."""
    tables = ("transactions", "accounts", "budgets", "goals")
    for table in tables:
        columns = {
            row["name"]
            for row in conn.execute(f"PRAGMA table_info({table})").fetchall()
        }
        if "user_id" not in columns:
            conn.execute(
                f"ALTER TABLE {table} ADD COLUMN user_id TEXT "
                f"NOT NULL DEFAULT '{_dev_user_id()}'"
            )

    transaction_columns = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(transactions)").fetchall()
    }

    if "description" not in transaction_columns and "desc" in transaction_columns:
        conn.execute("ALTER TABLE transactions RENAME COLUMN desc TO description")
        transaction_columns.remove("desc")
        transaction_columns.add("description")

    if "account_id" not in transaction_columns:
        conn.execute(
            "ALTER TABLE transactions ADD COLUMN account_id INTEGER REFERENCES accounts(id)"
        )

    account_columns = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(accounts)").fetchall()
    }
    if "type" not in account_columns:
        conn.execute(
            "ALTER TABLE accounts ADD COLUMN type TEXT NOT NULL DEFAULT 'checking'"
        )

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_budgets_user_id ON budgets(user_id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_goals_user_id ON goals(user_id)"
    )
