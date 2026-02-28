import sqlite3

import app.db as db
from app.auth import RFID_CACHE, RfidEntry, create_session
from app.models import row_to_dict


def test_db_migration_helpers_add_missing_columns():
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE resources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            price_cents INTEGER NOT NULL DEFAULT 0,
            is_billable INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE apartments (
            id TEXT PRIMARY KEY,
            password_hash TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1
        )
        """
    )
    conn.commit()

    db._ensure_resources_booking_type(conn)
    db._ensure_resource_schedule_columns(conn)
    db._ensure_resource_access_columns(conn)
    db._ensure_apartment_columns(conn)

    resource_columns = {
        row["name"] for row in conn.execute("PRAGMA table_info(resources);").fetchall()
    }
    apartment_columns = {
        row["name"] for row in conn.execute("PRAGMA table_info(apartments);").fetchall()
    }

    assert "booking_type" in resource_columns
    assert "slot_duration_minutes" in resource_columns
    assert "slot_start_hour" in resource_columns
    assert "slot_end_hour" in resource_columns
    assert "max_future_days" in resource_columns
    assert "max_bookings" in resource_columns
    assert "allow_houses" in resource_columns
    assert "deny_apartment_ids" in resource_columns
    assert "house" in apartment_columns
    assert "lgh_internal" in apartment_columns
    assert "skv_lgh" in apartment_columns
    assert "access_groups" in apartment_columns
    conn.close()


def test_get_db_closes_connection(monkeypatch):
    class _FakeConn:
        def __init__(self):
            self.closed = False

        def close(self):
            self.closed = True

    fake = _FakeConn()
    monkeypatch.setattr(db, "create_connection", lambda: fake)

    generator = db.get_db()
    assert next(generator) is fake
    generator.close()
    assert fake.closed is True


def test_row_to_dict_handles_none_and_row(db_conn, seeded_apartment):
    row = db_conn.execute("SELECT * FROM apartments WHERE id = ?", (seeded_apartment,)).fetchone()
    assert row_to_dict(None) == {}
    assert row_to_dict(row)["id"] == seeded_apartment


def test_require_session_returns_unauthorized_without_cookie(client):
    response = client.get("/resources")
    assert response.status_code == 401
    assert response.json()["detail"] == "unauthorized"


def test_rfid_login_rejects_inactive_apartment(client, db_conn):
    apartment_id = "1-1201"
    db_conn.execute(
        """
        INSERT INTO apartments (id, password_hash, is_active, house, lgh_internal, skv_lgh, access_groups)
        VALUES (?, ?, 0, ?, ?, ?, ?)
        """,
        (apartment_id, "hash", "1", "1013", "1201", "Boende"),
    )
    db_conn.commit()
    RFID_CACHE["INACTIVE"] = RfidEntry(
        apartment_id=apartment_id,
        house="1",
        lgh_internal="1013",
        skv_lgh="1201",
        active=True,
        access_groups=["Boende"],
    )

    response = client.post("/rfid-login", json={"uid": "INACTIVE"})
    assert response.status_code == 401
    assert response.json()["detail"] == "inactive_apartment"


def test_bookings_cancel_book_forbidden_and_health_endpoint(
    client, db_conn, seeded_apartment, seeded_resource
):
    token = create_session(db_conn, seeded_apartment, is_admin=False)
    db_conn.execute(
        """
        INSERT INTO bookings (apartment_id, resource_id, start_time, end_time, is_billable)
        VALUES (?, ?, ?, ?, 0)
        """,
        (
            seeded_apartment,
            seeded_resource,
            "2026-03-05T08:00:00+00:00",
            "2026-03-05T09:00:00+00:00",
        ),
    )
    db_conn.commit()

    bookings_response = client.get("/bookings", cookies={"session": token})
    assert bookings_response.status_code == 200
    assert len(bookings_response.json()["bookings"]) == 1

    forbidden_book = client.post(
        "/book",
        json={
            "apartment_id": "DIFFERENT-APARTMENT",
            "resource_id": seeded_resource,
            "start_time": "2026-03-05T10:00:00+00:00",
            "end_time": "2026-03-05T11:00:00+00:00",
            "is_billable": False,
        },
        cookies={"session": token},
    )
    assert forbidden_book.status_code == 403
    assert forbidden_book.json()["detail"] == "forbidden"

    cancel_missing = client.request(
        "DELETE",
        "/cancel",
        json={"booking_id": 999999},
        cookies={"session": token},
    )
    assert cancel_missing.status_code == 404
    assert cancel_missing.json()["detail"] == "not_found"

    health_response = client.get("/health")
    assert health_response.status_code == 200
    assert health_response.json()["status"] == "ok"
