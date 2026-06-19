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
    """)
    conn.commit()
    conn.close()
