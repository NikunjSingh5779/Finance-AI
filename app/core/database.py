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

from app.core.auth import auth_required, get_current_user_id

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

ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS recurring_item_id BIGINT;

CREATE TABLE IF NOT EXISTS recurring_items (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID NOT NULL DEFAULT auth.uid(),
    name            TEXT NOT NULL,
    amount          DOUBLE PRECISION NOT NULL CHECK(amount > 0),
    type            TEXT NOT NULL CHECK(type IN ('income','expense')),
    category        TEXT NOT NULL,
    frequency       TEXT NOT NULL CHECK(frequency IN ('weekly','monthly','yearly')),
    next_due_date   TEXT NOT NULL,
    schedule_day    INTEGER NOT NULL CHECK(schedule_day BETWEEN 1 AND 31),
    schedule_month  INTEGER CHECK(schedule_month BETWEEN 1 AND 12),
    account_id      BIGINT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    is_archived     BOOLEAN NOT NULL DEFAULT FALSE,
    last_recorded_due_date TEXT,
    created         TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT recurring_item_account_user_fk
        FOREIGN KEY (account_id, user_id)
        REFERENCES accounts(id, user_id),
    UNIQUE(id, user_id)
);

ALTER TABLE recurring_items
    ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_recurring_items_user_archive_due
    ON recurring_items(user_id, is_archived, is_active, next_due_date);

CREATE INDEX IF NOT EXISTS idx_transactions_created
    ON transactions(created DESC, id DESC);

CREATE TABLE IF NOT EXISTS ai_conversations (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL DEFAULT auth.uid(),
    title       TEXT NOT NULL DEFAULT 'New chat',
    summary     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(id, user_id)
);

CREATE TABLE IF NOT EXISTS ai_messages (
    id              BIGSERIAL PRIMARY KEY,
    conversation_id BIGINT NOT NULL,
    user_id         UUID NOT NULL DEFAULT auth.uid(),
    role            TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content         TEXT NOT NULL,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ai_message_conversation_user_fk
        FOREIGN KEY (conversation_id, user_id)
        REFERENCES ai_conversations(id, user_id)
        ON DELETE CASCADE
);

ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON ai_conversations, ai_messages TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

DROP POLICY IF EXISTS ai_conversations_select_own ON ai_conversations;
DROP POLICY IF EXISTS ai_conversations_insert_own ON ai_conversations;
DROP POLICY IF EXISTS ai_conversations_update_own ON ai_conversations;
DROP POLICY IF EXISTS ai_conversations_delete_own ON ai_conversations;
CREATE POLICY ai_conversations_select_own ON ai_conversations
    FOR SELECT TO authenticated
    USING ((select auth.uid()) = user_id);
CREATE POLICY ai_conversations_insert_own ON ai_conversations
    FOR INSERT TO authenticated
    WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY ai_conversations_update_own ON ai_conversations
    FOR UPDATE TO authenticated
    USING ((select auth.uid()) = user_id)
    WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY ai_conversations_delete_own ON ai_conversations
    FOR DELETE TO authenticated
    USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS ai_messages_select_own ON ai_messages;
DROP POLICY IF EXISTS ai_messages_insert_own ON ai_messages;
DROP POLICY IF EXISTS ai_messages_update_own ON ai_messages;
DROP POLICY IF EXISTS ai_messages_delete_own ON ai_messages;
CREATE POLICY ai_messages_select_own ON ai_messages
    FOR SELECT TO authenticated
    USING ((select auth.uid()) = user_id);
CREATE POLICY ai_messages_insert_own ON ai_messages
    FOR INSERT TO authenticated
    WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY ai_messages_update_own ON ai_messages
    FOR UPDATE TO authenticated
    USING ((select auth.uid()) = user_id)
    WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY ai_messages_delete_own ON ai_messages
    FOR DELETE TO authenticated
    USING ((select auth.uid()) = user_id);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_updated
    ON ai_conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_user_created
    ON ai_messages(conversation_id, user_id, created_at);
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
CREATE INDEX IF NOT EXISTS idx_recurring_items_user_due
    ON recurring_items(user_id, is_active, next_due_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_recurring_occurrence
    ON transactions(user_id, recurring_item_id, date)
    WHERE recurring_item_id IS NOT NULL;

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_items ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON accounts, transactions, budgets, goals, recurring_items
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

DROP POLICY IF EXISTS recurring_items_select_own ON recurring_items;
DROP POLICY IF EXISTS recurring_items_insert_own ON recurring_items;
DROP POLICY IF EXISTS recurring_items_update_own ON recurring_items;
DROP POLICY IF EXISTS recurring_items_delete_own ON recurring_items;
CREATE POLICY recurring_items_select_own ON recurring_items
    FOR SELECT TO authenticated
    USING ((select auth.uid()) = user_id);
CREATE POLICY recurring_items_insert_own ON recurring_items
    FOR INSERT TO authenticated
    WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY recurring_items_update_own ON recurring_items
    FOR UPDATE TO authenticated
    USING ((select auth.uid()) = user_id)
    WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY recurring_items_delete_own ON recurring_items
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
        # This connection is created per request and closed by the controller.
        # Session-scoped settings survive repository commits (imports commit rows
        # individually) while remaining isolated to this connection.
        conn.execute("SET ROLE authenticated")
        conn.execute(
            "SELECT set_config('request.jwt.claim.sub', %s, false)",
            (user_id,),
        )
        conn.execute(
            "SELECT set_config('request.jwt.claims', %s, false)",
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
    if auth_required() and not using_postgres():
        raise RuntimeError(
            "AUTH_REQUIRED=true requires DATABASE_URL; "
            "production multi-user mode cannot use SQLite."
        )

    if using_postgres():
        return SQLiteCompatConnection(_connect_postgres())

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
            for statement in POSTGRES_SCHEMA.split(";"):
                sql = statement.strip()
                if sql:
                    conn.execute(sql)
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
                category  TEXT    NOT NULL UNIQUE,
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
            CREATE TABLE IF NOT EXISTS recurring_items (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id         TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
                name            TEXT NOT NULL,
                amount          REAL NOT NULL CHECK(amount > 0),
                type            TEXT NOT NULL CHECK(type IN ('income','expense')),
                category        TEXT NOT NULL,
                frequency       TEXT NOT NULL CHECK(frequency IN ('weekly','monthly','yearly')),
                next_due_date   TEXT NOT NULL,
                schedule_day    INTEGER NOT NULL CHECK(schedule_day BETWEEN 1 AND 31),
                schedule_month  INTEGER CHECK(schedule_month BETWEEN 1 AND 12),
                account_id      INTEGER REFERENCES accounts(id),
                is_active       INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
                is_archived     INTEGER NOT NULL DEFAULT 0 CHECK(is_archived IN (0,1)),
                last_recorded_due_date TEXT,
                created         TEXT DEFAULT (datetime('now'))
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
            CREATE INDEX IF NOT EXISTS idx_recurring_items_user_due
                ON recurring_items(user_id, is_active, next_due_date);
            CREATE INDEX IF NOT EXISTS idx_recurring_items_user_archive_due
                ON recurring_items(user_id, is_archived, is_active, next_due_date);
            CREATE INDEX IF NOT EXISTS idx_transactions_created
                ON transactions(created DESC, id DESC);
            CREATE TABLE IF NOT EXISTS ai_conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
                title TEXT NOT NULL DEFAULT 'New chat',
                summary TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(id, user_id)
            );

            CREATE TABLE IF NOT EXISTS ai_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER NOT NULL,
                user_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
                role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
                content TEXT NOT NULL,
                metadata TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (conversation_id, user_id)
                    REFERENCES ai_conversations(id, user_id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_updated
                ON ai_conversations(user_id, updated_at);
            CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_user_created
                ON ai_messages(conversation_id, user_id, created_at);
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

    if "recurring_item_id" not in transaction_columns:
        conn.execute(
            "ALTER TABLE transactions ADD COLUMN recurring_item_id INTEGER"
        )

    conn.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_recurring_occurrence
        ON transactions(user_id, recurring_item_id, date)
        WHERE recurring_item_id IS NOT NULL
        """
    )
    recurring_columns = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(recurring_items)").fetchall()
    }
    if "is_archived" not in recurring_columns:
        conn.execute(
            "ALTER TABLE recurring_items ADD COLUMN is_archived "
            "INTEGER NOT NULL DEFAULT 0 CHECK(is_archived IN (0,1))"
        )

    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_recurring_items_user_due
        ON recurring_items(user_id, is_active, next_due_date)
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_recurring_items_user_archive_due
        ON recurring_items(user_id, is_archived, is_active, next_due_date)
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_transactions_created
        ON transactions(created DESC, id DESC)
        """
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
