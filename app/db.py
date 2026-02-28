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


def _ensure_resource_schedule_columns(conn: sqlite3.Connection) -> None:
    columns = conn.execute("PRAGMA table_info(resources);").fetchall()
    col_names = {col["name"] for col in columns}
    specs = {
        "slot_duration_minutes": "INTEGER NOT NULL DEFAULT 60",
        "slot_start_hour": "INTEGER NOT NULL DEFAULT 6",
        "slot_end_hour": "INTEGER NOT NULL DEFAULT 22",
        "max_future_days": "INTEGER NOT NULL DEFAULT 30",
    }
    for col, spec in specs.items():
        if col not in col_names:
            conn.execute(f"ALTER TABLE resources ADD COLUMN {col} {spec}")
    conn.commit()


def _ensure_apartment_columns(conn: sqlite3.Connection) -> None:
    columns = conn.execute("PRAGMA table_info(apartments);").fetchall()
    col_names = {col["name"] for col in columns}
    for col in ("house", "lgh_internal", "skv_lgh", "access_groups"):
        if col not in col_names:
            conn.execute(f"ALTER TABLE apartments ADD COLUMN {col} TEXT")
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
    _ensure_resource_schedule_columns(conn)
    _ensure_apartment_columns(conn)


def get_db() -> Iterator[sqlite3.Connection]:
    conn = create_connection()
    try:
        yield conn
    finally:
        conn.close()
