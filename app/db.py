import sqlite3
from typing import Iterator

from .config import DATABASE_PATH
from .models import SCHEMA_STATEMENTS


def _ensure_resources_booking_type(conn: sqlite3.Connection) -> None:
    columns = conn.execute("PRAGMA table_info(resources);").fetchall()
    if any(col["name"] == "booking_type" for col in columns):
        return
    conn.execute(
        "ALTER TABLE resources ADD COLUMN booking_type TEXT NOT NULL DEFAULT 'time-slot'"
    )
    conn.commit()


def create_connection(path: str = DATABASE_PATH) -> sqlite3.Connection:
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    for stmt in SCHEMA_STATEMENTS:
        conn.execute(stmt)
    conn.commit()
    _ensure_resources_booking_type(conn)


def get_db() -> Iterator[sqlite3.Connection]:
    conn = create_connection()
    try:
        yield conn
    finally:
        conn.close()
