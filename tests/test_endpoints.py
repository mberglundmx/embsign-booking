from datetime import datetime, timezone

from app.auth import RFID_CACHE, create_session


def test_rfid_login_success(client, db_conn, seeded_apartment):
    RFID_CACHE["UID123"] = (seeded_apartment, True)
    response = client.post("/rfid-login", json={"uid": "UID123"})
    assert response.status_code == 200
    assert response.json()["booking_url"] == "/booking"
    assert "session" in response.cookies


def test_rfid_login_invalid(client):
    response = client.post("/rfid-login", json={"uid": "UNKNOWN"})
    assert response.status_code == 401


def test_mobile_login_success(client, seeded_apartment):
    response = client.post(
        "/mobile-login",
        json={"apartment_id": seeded_apartment, "password": "secret"},
    )
    assert response.status_code == 200
    assert "session" in response.cookies


def test_mobile_login_invalid(client, seeded_apartment):
    response = client.post(
        "/mobile-login",
        json={"apartment_id": seeded_apartment, "password": "wrong"},
    )
    assert response.status_code == 401


def test_slots_excludes_booked(client, db_conn, seeded_apartment, seeded_resource):
    token = create_session(db_conn, seeded_apartment, is_admin=False)
    start = datetime(2026, 2, 28, 6, 0, tzinfo=timezone.utc).isoformat()
    end = datetime(2026, 2, 28, 7, 0, tzinfo=timezone.utc).isoformat()
    db_conn.execute(
        """
        INSERT INTO bookings (apartment_id, resource_id, start_time, end_time, is_billable)
        VALUES (?, ?, ?, ?, 0)
        """,
        (seeded_apartment, seeded_resource, start, end),
    )
    db_conn.commit()
    response = client.get(
        "/slots",
        params={"resource_id": seeded_resource, "date": "2026-02-28"},
        cookies={"session": token},
    )
    assert response.status_code == 200
    slots = response.json()["slots"]
    booked_slot = next(
        (slot for slot in slots if slot["start_time"] == start and slot["end_time"] == end),
        None,
    )
    assert booked_slot is not None
    assert booked_slot["is_booked"] is True


def test_book_and_cancel(client, db_conn, seeded_apartment, seeded_resource):
    token = create_session(db_conn, seeded_apartment, is_admin=False)
    start = datetime(2026, 2, 28, 8, 0, tzinfo=timezone.utc).isoformat()
    end = datetime(2026, 2, 28, 9, 0, tzinfo=timezone.utc).isoformat()
    response = client.post(
        "/book",
        json={
            "apartment_id": seeded_apartment,
            "resource_id": seeded_resource,
            "start_time": start,
            "end_time": end,
            "is_billable": False,
        },
        cookies={"session": token},
    )
    assert response.status_code == 200
    booking_id = response.json()["booking_id"]
    cancel = client.request(
        "DELETE",
        "/cancel",
        json={"booking_id": booking_id},
        cookies={"session": token},
    )
    assert cancel.status_code == 200


def test_book_overlap_conflict(client, db_conn, seeded_apartment, seeded_resource):
    token = create_session(db_conn, seeded_apartment, is_admin=False)
    start = datetime(2026, 2, 28, 10, 0, tzinfo=timezone.utc).isoformat()
    end = datetime(2026, 2, 28, 11, 0, tzinfo=timezone.utc).isoformat()
    response = client.post(
        "/book",
        json={
            "apartment_id": seeded_apartment,
            "resource_id": seeded_resource,
            "start_time": start,
            "end_time": end,
            "is_billable": False,
        },
        cookies={"session": token},
    )
    assert response.status_code == 200
    conflict = client.post(
        "/book",
        json={
            "apartment_id": seeded_apartment,
            "resource_id": seeded_resource,
            "start_time": start,
            "end_time": end,
            "is_billable": False,
        },
        cookies={"session": token},
    )
    assert conflict.status_code == 409


def test_admin_calendar_requires_admin(client, db_conn, seeded_apartment, seeded_resource):
    user_token = create_session(db_conn, seeded_apartment, is_admin=False)
    response = client.get("/admin/calendar", cookies={"session": user_token})
    assert response.status_code == 403

    admin_token = create_session(db_conn, seeded_apartment, is_admin=True)
    response = client.get("/admin/calendar", cookies={"session": admin_token})
    assert response.status_code == 200
    assert "bookings" in response.json()
