import logging
import os
import sqlite3

logger = logging.getLogger(__name__)


def get_db() -> sqlite3.Connection:
    """Open a SQLite connection with consistent safety settings."""
    conn = sqlite3.connect(
        os.getenv("DB_PATH", "finance.db"),
        timeout=10,
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 10000")
    return conn


def init_db() -> None:
    """Create the schema and apply idempotent migrations."""
    conn = get_db()
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS transactions (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
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
                category  TEXT    UNIQUE NOT NULL,
                limit_amt REAL    NOT NULL CHECK(limit_amt > 0)
            );

            CREATE TABLE IF NOT EXISTS accounts (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                name      TEXT    NOT NULL,
                balance   REAL    NOT NULL DEFAULT 0.0,
                type      TEXT    NOT NULL DEFAULT 'checking'
                    CHECK(type IN ('checking','savings','credit','cash','investment'))
            );

            CREATE TABLE IF NOT EXISTS goals (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                name            TEXT    NOT NULL,
                target_amount   REAL    NOT NULL CHECK(target_amount > 0),
                current_amount  REAL    NOT NULL DEFAULT 0 CHECK(current_amount >= 0),
                target_date     TEXT,
                category        TEXT    NOT NULL DEFAULT 'Savings',
                created         TEXT    DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_goals_target_date
                ON goals(target_date);

            CREATE INDEX IF NOT EXISTS idx_transactions_date
                ON transactions(date);
            CREATE INDEX IF NOT EXISTS idx_transactions_category
                ON transactions(category);
            CREATE INDEX IF NOT EXISTS idx_transactions_account
                ON transactions(account_id);
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
    """Apply safe, idempotent migrations to older FinanceAI databases."""
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
