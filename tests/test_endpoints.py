from datetime import datetime, timedelta, timezone

import app.booking as booking
from app.auth import RFID_CACHE, RfidEntry, create_session, parse_apartment_name


def test_rfid_login_success(client, db_conn, seeded_apartment):
    RFID_CACHE["UID123"] = RfidEntry(
        apartment_id=seeded_apartment,
        house="1",
        lgh_internal="101",
        skv_lgh="101",
        active=True,
        access_groups=["Boende"],
    )
    response = client.post("/rfid-login", json={"uid": "UID123"})
    assert response.status_code == 200
    assert response.json()["booking_url"] == "/booking"
    assert "session" in response.cookies


def test_rfid_login_auto_creates_apartment(client, db_conn):
    """When a valid RFID tag is scanned but the apartment is not in DB, it should be auto-created."""
    RFID_CACHE["NEWUID"] = RfidEntry(
        apartment_id="1-1201",
        house="1",
        lgh_internal="1013",
        skv_lgh="1201",
        active=True,
        access_groups=["Boende", "Gym Norra gaveln Hus 1"],
    )
    response = client.post("/rfid-login", json={"uid": "NEWUID"})
    assert response.status_code == 200
    assert response.json()["apartment_id"] == "1-1201"
    row = db_conn.execute("SELECT * FROM apartments WHERE id = ?", ("1-1201",)).fetchone()
    assert row is not None
    assert row["house"] == "1"
    assert row["lgh_internal"] == "1013"
    assert row["skv_lgh"] == "1201"
    assert "Boende" in row["access_groups"]


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


def test_mobile_password_update_changes_mobile_login(client, db_conn, seeded_apartment):
    token = create_session(db_conn, seeded_apartment, is_admin=False)
    update_response = client.post(
        "/mobile-password",
        json={"new_password": "new-secret"},
        cookies={"session": token},
    )
    assert update_response.status_code == 200
    assert update_response.json()["status"] == "ok"

    old_login = client.post(
        "/mobile-login",
        json={"apartment_id": seeded_apartment, "password": "secret"},
    )
    assert old_login.status_code == 401

    new_login = client.post(
        "/mobile-login",
        json={"apartment_id": seeded_apartment, "password": "new-secret"},
    )
    assert new_login.status_code == 200


def test_mobile_password_update_rejects_short_password(client, db_conn, seeded_apartment):
    token = create_session(db_conn, seeded_apartment, is_admin=False)
    response = client.post(
        "/mobile-password",
        json={"new_password": "123"},
        cookies={"session": token},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "password_too_short"


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


def test_availability_range_returns_one_entry_per_day(
    client, db_conn, seeded_apartment, seeded_resource, monkeypatch
):
    fixed_now = datetime(2026, 3, 1, 9, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(booking, "_now_utc", lambda: fixed_now)
    db_conn.execute(
        "UPDATE resources SET booking_type = ?, min_future_days = ?, max_future_days = ? WHERE id = ?",
        ("full-day", 0, 30, seeded_resource),
    )
    booked_start = datetime(2026, 3, 5, 0, 0, tzinfo=timezone.utc).isoformat()
    booked_end = datetime(2026, 3, 6, 0, 0, tzinfo=timezone.utc).isoformat()
    db_conn.execute(
        """
        INSERT INTO bookings (apartment_id, resource_id, start_time, end_time, is_billable)
        VALUES (?, ?, ?, ?, 0)
        """,
        (seeded_apartment, seeded_resource, booked_start, booked_end),
    )
    db_conn.commit()

    token = create_session(db_conn, seeded_apartment, is_admin=False)
    response = client.get(
        "/availability-range",
        params={
            "resource_id": seeded_resource,
            "start_date": "2026-03-04",
            "end_date": "2026-03-06",
        },
        cookies={"session": token},
    )
    assert response.status_code == 200
    availability = {item["date"]: item for item in response.json()["availability"]}
    assert list(availability.keys()) == ["2026-03-04", "2026-03-05", "2026-03-06"]
    assert availability["2026-03-04"]["is_available"] is True
    assert availability["2026-03-05"]["is_available"] is False
    assert availability["2026-03-06"]["is_available"] is True


def test_availability_range_rejects_invalid_date_range(
    client, db_conn, seeded_apartment, seeded_resource
):
    token = create_session(db_conn, seeded_apartment, is_admin=False)
    response = client.get(
        "/availability-range",
        params={
            "resource_id": seeded_resource,
            "start_date": "2026-03-06",
            "end_date": "2026-03-05",
        },
        cookies={"session": token},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "invalid_date_range"


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


def test_book_limits_future_bookings_per_resource(
    client, db_conn, seeded_apartment, seeded_resource, monkeypatch
):
    fixed_now = datetime(2026, 2, 1, 9, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(booking, "_now_utc", lambda: fixed_now)
    db_conn.execute(
        "UPDATE resources SET max_bookings = ? WHERE id = ?",
        (2, seeded_resource),
    )
    db_conn.commit()

    token = create_session(db_conn, seeded_apartment, is_admin=False)
    first_start = datetime(2026, 2, 10, 8, 0, tzinfo=timezone.utc).isoformat()
    first_end = datetime(2026, 2, 10, 9, 0, tzinfo=timezone.utc).isoformat()
    second_start = datetime(2026, 2, 10, 9, 0, tzinfo=timezone.utc).isoformat()
    second_end = datetime(2026, 2, 10, 10, 0, tzinfo=timezone.utc).isoformat()
    third_start = datetime(2026, 2, 11, 8, 0, tzinfo=timezone.utc).isoformat()
    third_end = datetime(2026, 2, 11, 9, 0, tzinfo=timezone.utc).isoformat()

    first_response = client.post(
        "/book",
        json={
            "apartment_id": seeded_apartment,
            "resource_id": seeded_resource,
            "start_time": first_start,
            "end_time": first_end,
            "is_billable": False,
        },
        cookies={"session": token},
    )
    assert first_response.status_code == 200

    second_response = client.post(
        "/book",
        json={
            "apartment_id": seeded_apartment,
            "resource_id": seeded_resource,
            "start_time": second_start,
            "end_time": second_end,
            "is_billable": False,
        },
        cookies={"session": token},
    )
    assert second_response.status_code == 200

    third_response = client.post(
        "/book",
        json={
            "apartment_id": seeded_apartment,
            "resource_id": seeded_resource,
            "start_time": third_start,
            "end_time": third_end,
            "is_billable": False,
        },
        cookies={"session": token},
    )
    assert third_response.status_code == 409
    assert third_response.json()["detail"] == "max_bookings_reached"


def test_book_rejects_dates_before_min_future_window(
    client, db_conn, seeded_apartment, seeded_resource, monkeypatch
):
    fixed_now = datetime(2026, 2, 1, 9, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(booking, "_now_utc", lambda: fixed_now)
    db_conn.execute(
        "UPDATE resources SET min_future_days = ?, max_future_days = ? WHERE id = ?",
        (3, 90, seeded_resource),
    )
    db_conn.commit()

    token = create_session(db_conn, seeded_apartment, is_admin=False)
    too_soon_start = (fixed_now + timedelta(days=2, hours=-1)).isoformat()
    too_soon_end = (fixed_now + timedelta(days=2)).isoformat()
    allowed_start = (fixed_now + timedelta(days=3, hours=-1)).isoformat()
    allowed_end = (fixed_now + timedelta(days=3)).isoformat()

    too_soon_response = client.post(
        "/book",
        json={
            "apartment_id": seeded_apartment,
            "resource_id": seeded_resource,
            "start_time": too_soon_start,
            "end_time": too_soon_end,
            "is_billable": False,
        },
        cookies={"session": token},
    )
    assert too_soon_response.status_code == 409
    assert too_soon_response.json()["detail"] == "outside_booking_window"

    allowed_response = client.post(
        "/book",
        json={
            "apartment_id": seeded_apartment,
            "resource_id": seeded_resource,
            "start_time": allowed_start,
            "end_time": allowed_end,
            "is_billable": False,
        },
        cookies={"session": token},
    )
    assert allowed_response.status_code == 200


def test_admin_calendar_requires_admin(client, db_conn, seeded_apartment, seeded_resource):
    user_token = create_session(db_conn, seeded_apartment, is_admin=False)
    response = client.get("/admin/calendar", cookies={"session": user_token})
    assert response.status_code == 403

    admin_token = create_session(db_conn, seeded_apartment, is_admin=True)
    response = client.get("/admin/calendar", cookies={"session": admin_token})
    assert response.status_code == 200
    assert "bookings" in response.json()


class TestParseApartmentName:
    def test_standard_format(self):
        result = parse_apartment_name("1-LGH1013 /1201 tag1")
        assert result == {"house": "1", "lgh_internal": "1013", "skv_lgh": "1201"}

    def test_with_name_suffix(self):
        result = parse_apartment_name("1-LGH1001 /1001 Kor tag1")
        assert result == {"house": "1", "lgh_internal": "1001", "skv_lgh": "1001"}

    def test_space_after_slash(self):
        result = parse_apartment_name("1-LGH1001/ 1005 tag1")
        assert result == {"house": "1", "lgh_internal": "1001", "skv_lgh": "1005"}

    def test_space_before_lgh(self):
        result = parse_apartment_name("4-LGH 1084/1308 EM K")
        assert result == {"house": "4", "lgh_internal": "1084", "skv_lgh": "1308"}

    def test_lowercase_lgh(self):
        result = parse_apartment_name("6- Lgh 1173/1705 EM Fredrik")
        assert result == {"house": "6", "lgh_internal": "1173", "skv_lgh": "1705"}

    def test_non_apartment(self):
        assert parse_apartment_name("Securitas tag1") is None
        assert parse_apartment_name("Städ tag2 iLOQ") is None
        assert parse_apartment_name("") is None
