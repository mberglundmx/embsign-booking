import sqlite3

import pytest
from fastapi.testclient import TestClient

from app.auth import RFID_CACHE, hash_password
from app.db import get_db, init_db
from app.main import app


@pytest.fixture()
def db_conn():
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    init_db(conn)
    yield conn
    conn.close()


@pytest.fixture()
def client(db_conn):
    def _get_db():
        yield db_conn

    app.dependency_overrides[get_db] = _get_db
    RFID_CACHE.clear()
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture()
def seeded_apartment(db_conn):
    apartment_id = "A101"
    db_conn.execute(
        "INSERT INTO apartments (id, password_hash, is_active) VALUES (?, ?, 1)",
        (apartment_id, hash_password("secret")),
    )
    db_conn.commit()
    return apartment_id


@pytest.fixture()
def seeded_resource(db_conn):
    cursor = db_conn.execute(
        """
        INSERT INTO resources (name, booking_type, is_active, price_cents, is_billable)
        VALUES (?, ?, 1, 0, 0)
        """,
        ("Tvattstuga 1", "time-slot"),
    )
    db_conn.commit()
    return int(cursor.lastrowid)
