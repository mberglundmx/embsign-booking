from typing import Any, Dict


SCHEMA_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS apartments (
        id TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        house TEXT,
        lgh_internal TEXT,
        skv_lgh TEXT,
        access_groups TEXT
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS resources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        booking_type TEXT NOT NULL DEFAULT 'time-slot',
        slot_duration_minutes INTEGER NOT NULL DEFAULT 60,
        slot_start_hour INTEGER NOT NULL DEFAULT 6,
        slot_end_hour INTEGER NOT NULL DEFAULT 22,
        max_future_days INTEGER NOT NULL DEFAULT 30,
        is_active INTEGER NOT NULL DEFAULT 1,
        price_cents INTEGER NOT NULL DEFAULT 0,
        is_billable INTEGER NOT NULL DEFAULT 0
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        apartment_id TEXT NOT NULL,
        resource_id INTEGER NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        is_billable INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (apartment_id) REFERENCES apartments(id) ON DELETE CASCADE,
        FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_bookings_resource_time
        ON bookings(resource_id, start_time, end_time);
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_bookings_apartment_time
        ON bookings(apartment_id, start_time, end_time);
    """,
    """
    CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        apartment_id TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        FOREIGN KEY (apartment_id) REFERENCES apartments(id) ON DELETE CASCADE
    );
    """,
]


def row_to_dict(row: Any) -> Dict[str, Any]:
    if row is None:
        return {}
    return dict(row)
