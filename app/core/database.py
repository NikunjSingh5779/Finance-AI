import os
import sqlite3


def get_db():
    conn = sqlite3.connect(os.getenv("DB_PATH", "finance.db"))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    try:
        # Create tables with IF NOT EXISTS for safety
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS transactions (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                type        TEXT    NOT NULL CHECK(type IN ('income','expense')),
                amount      REAL    NOT NULL,
                description TEXT    NOT NULL,
                category    TEXT    NOT NULL,
                date        TEXT    NOT NULL,
                created     TEXT    DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS budgets (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                category  TEXT    UNIQUE NOT NULL,
                limit_amt REAL    NOT NULL
            );

            CREATE TABLE IF NOT EXISTS accounts (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                name      TEXT    NOT NULL,
                balance   REAL    NOT NULL DEFAULT 0.0,
                type      TEXT    NOT NULL DEFAULT 'checking'
            );
        """)

        # Safe migrations for existing databases
        _run_migrations(conn)
        conn.commit()
    finally:
        conn.close()


def _run_migrations(conn):
    """Run database migrations safely with proper error handling."""
    try:
        # Migration 1: Add account_id column to transactions if missing
        cols = [r[1] for r in conn.execute("PRAGMA table_info(transactions)").fetchall()]
        if 'account_id' not in cols:
            conn.execute("ALTER TABLE transactions ADD COLUMN account_id INTEGER REFERENCES accounts(id)")

        # Migration 2: Rename 'desc' column to 'description' for existing DBs
        if 'desc' in cols and 'description' not in cols:
            conn.execute("ALTER TABLE transactions RENAME COLUMN desc TO description")

        # Migration 3: Add type column to accounts if missing
        account_cols = [r[1] for r in conn.execute("PRAGMA table_info(accounts)").fetchall()]
        if 'type' not in account_cols:
            conn.execute("ALTER TABLE accounts ADD COLUMN type TEXT NOT NULL DEFAULT 'checking'")
    except sqlite3.OperationalError as e:
        # Log migration errors but don't crash - tables might be in unexpected state
        print(f"Migration warning: {e}")
        # Continue - tables might still be usable
