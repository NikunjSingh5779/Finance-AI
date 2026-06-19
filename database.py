import os
import sqlite3


def get_db():
    conn = sqlite3.connect(os.getenv("DB_PATH", "finance.db"))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS transactions (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            type      TEXT    NOT NULL CHECK(type IN ('income','expense')),
            amount    REAL    NOT NULL,
            desc      TEXT    NOT NULL,
            category  TEXT    NOT NULL,
            date      TEXT    NOT NULL,
            created   TEXT    DEFAULT (datetime('now'))
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
    # migrations for existing DBs
    cols = [r[1] for r in conn.execute("PRAGMA table_info(transactions)").fetchall()]
    if 'account_id' not in cols:
        conn.execute("ALTER TABLE transactions ADD COLUMN account_id INTEGER REFERENCES accounts(id)")
    cols = [r[1] for r in conn.execute("PRAGMA table_info(accounts)").fetchall()]
    if 'type' not in cols:
        conn.execute("ALTER TABLE accounts ADD COLUMN type TEXT NOT NULL DEFAULT 'checking'")
    conn.commit()
    conn.close()
