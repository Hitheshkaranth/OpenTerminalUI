from __future__ import annotations

import sqlite3


def configure_sqlite_connection(conn: sqlite3.Connection) -> None:
    # Improve concurrency on local SQLite under mixed read/write workloads.
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    conn.execute("PRAGMA temp_store=MEMORY;")
    conn.execute("PRAGMA busy_timeout=5000;")
