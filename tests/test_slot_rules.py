from datetime import datetime, timedelta, timezone

import app.booking as booking
from app.auth import create_session


def _insert_resource(
    db_conn,
    *,
    name: str,
    booking_type: str = "time-slot",
    slot_duration_minutes: int = 60,
    slot_start_hour: int = 6,
    slot_end_hour: int = 22,
    max_future_days: int = 30,
    min_future_days: int = 0,
):
    cursor = db_conn.execute(
        """
        INSERT INTO resources (
            name,
            booking_type,
            slot_duration_minutes,
            slot_start_hour,
            slot_end_hour,
            max_future_days,
            min_future_days,
            is_active,
            price_cents,
            is_billable
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 0)
        """,
        (
            name,
            booking_type,
            slot_duration_minutes,
            slot_start_hour,
            slot_end_hour,
            max_future_days,
            min_future_days,
        ),
    )
    db_conn.commit()
    return int(cursor.lastrowid)


def test_time_slots_follow_resource_duration_and_window(client, db_conn, seeded_apartment):
    token = create_session(db_conn, seeded_apartment, is_admin=False)
    resource_id = _insert_resource(
        db_conn,
        name="Tvättstuga Hus 1",
        slot_duration_minutes=120,
        slot_start_hour=8,
        slot_end_hour=20,
    )
    response = client.get(
        "/slots",
        params={"resource_id": resource_id, "date": "2026-03-01"},
        cookies={"session": token},
    )
    assert response.status_code == 200
    slots = response.json()["slots"]
    assert len(slots) == 6
    assert slots[0]["start_time"].endswith("08:00:00+00:00")
    assert slots[0]["end_time"].endswith("10:00:00+00:00")
    assert slots[-1]["start_time"].endswith("18:00:00+00:00")
    assert slots[-1]["end_time"].endswith("20:00:00+00:00")


def test_passed_time_slots_today_are_not_bookable(client, db_conn, seeded_apartment, monkeypatch):
    fixed_now = datetime(2026, 3, 1, 13, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(booking, "_now_utc", lambda: fixed_now)

    token = create_session(db_conn, seeded_apartment, is_admin=False)
    resource_id = _insert_resource(
        db_conn,
        name="Tvättstuga Hus 4",
        slot_duration_minutes=60,
        slot_start_hour=8,
        slot_end_hour=16,
    )
    response = client.get(
        "/slots",
        params={"resource_id": resource_id, "date": "2026-03-01"},
        cookies={"session": token},
    )
    assert response.status_code == 200
    slots = response.json()["slots"]
    slot_by_start = {slot["start_time"]: slot for slot in slots}
    assert slot_by_start["2026-03-01T08:00:00+00:00"]["is_past"] is True
    assert slot_by_start["2026-03-01T12:00:00+00:00"]["is_past"] is True
    assert slot_by_start["2026-03-01T13:00:00+00:00"]["is_past"] is False
    assert slot_by_start["2026-03-01T14:00:00+00:00"]["is_past"] is False


def test_access_control_allow_house_and_deny_apartment(client, db_conn, monkeypatch):
    fixed_now = datetime(2026, 3, 1, 9, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(booking, "_now_utc", lambda: fixed_now)

    db_conn.execute(
        "INSERT INTO apartments (id, password_hash, is_active, house) VALUES (?, ?, 1, ?)",
        ("1-1001", "x", "1"),
    )
    db_conn.execute(
        "INSERT INTO apartments (id, password_hash, is_active, house) VALUES (?, ?, 1, ?)",
        ("2-2001", "x", "2"),
    )
    db_conn.commit()

    denied_resource_id = _insert_resource(
        db_conn,
        name="Gästlägenhet",
        booking_type="full-day",
        max_future_days=90,
    )
    db_conn.execute(
        "UPDATE resources SET deny_apartment_ids = ? WHERE id = ?",
        ("1-1001", denied_resource_id),
    )

    house_one_resource_id = _insert_resource(
        db_conn,
        name="Tvättstuga Hus 3",
        booking_type="time-slot",
        slot_duration_minutes=120,
        slot_start_hour=8,
        slot_end_hour=20,
    )
    db_conn.execute(
        "UPDATE resources SET allow_houses = ? WHERE id = ?",
        ("1", house_one_resource_id),
    )
    db_conn.commit()

    token_house_1 = create_session(db_conn, "1-1001", is_admin=False)
    token_house_2 = create_session(db_conn, "2-2001", is_admin=False)

    resources_house_1 = client.get("/resources", cookies={"session": token_house_1})
    assert resources_house_1.status_code == 200
    names_house_1 = [item["name"] for item in resources_house_1.json()["resources"]]
    assert "Tvättstuga Hus 3" in names_house_1
    assert "Gästlägenhet" not in names_house_1

    resources_house_2 = client.get("/resources", cookies={"session": token_house_2})
    assert resources_house_2.status_code == 200
    names_house_2 = [item["name"] for item in resources_house_2.json()["resources"]]
    assert "Tvättstuga Hus 3" not in names_house_2
    assert "Gästlägenhet" in names_house_2

    denied_slot_response = client.get(
        "/slots",
        params={"resource_id": denied_resource_id, "date": "2026-03-03"},
        cookies={"session": token_house_1},
    )
    assert denied_slot_response.status_code == 200
    assert denied_slot_response.json()["slots"] == []

    denied_book_response = client.post(
        "/book",
        json={
            "apartment_id": "1-1001",
            "resource_id": denied_resource_id,
            "start_time": "2026-03-03T00:00:00+00:00",
            "end_time": "2026-03-04T00:00:00+00:00",
            "is_billable": False,
        },
        cookies={"session": token_house_1},
    )
    assert denied_book_response.status_code == 403


def test_slots_respect_max_future_days(client, db_conn, seeded_apartment, monkeypatch):
    fixed_now = datetime(2026, 3, 1, 9, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(booking, "_now_utc", lambda: fixed_now)

    token = create_session(db_conn, seeded_apartment, is_admin=False)
    resource_id = _insert_resource(
        db_conn,
        name="Tvättstuga Hus 6",
        slot_duration_minutes=60,
        slot_start_hour=8,
        slot_end_hour=12,
        max_future_days=14,
    )

    allowed_date = (fixed_now + timedelta(days=13)).date().isoformat()
    blocked_date = (fixed_now + timedelta(days=14)).date().isoformat()

    allowed_response = client.get(
        "/slots",
        params={"resource_id": resource_id, "date": allowed_date},
        cookies={"session": token},
    )
    assert allowed_response.status_code == 200
    assert len(allowed_response.json()["slots"]) > 0

    blocked_response = client.get(
        "/slots",
        params={"resource_id": resource_id, "date": blocked_date},
        cookies={"session": token},
    )
    assert blocked_response.status_code == 200
    assert blocked_response.json()["slots"] == []


def test_slots_respect_min_future_days(client, db_conn, seeded_apartment, monkeypatch):
    fixed_now = datetime(2026, 3, 1, 9, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(booking, "_now_utc", lambda: fixed_now)

    token = create_session(db_conn, seeded_apartment, is_admin=False)
    resource_id = _insert_resource(
        db_conn,
        name="Gästlägenhet",
        booking_type="full-day",
        max_future_days=90,
        min_future_days=3,
    )

    blocked_date = (fixed_now + timedelta(days=2)).date().isoformat()
    allowed_date = (fixed_now + timedelta(days=3)).date().isoformat()

    blocked_response = client.get(
        "/slots",
        params={"resource_id": resource_id, "date": blocked_date},
        cookies={"session": token},
    )
    assert blocked_response.status_code == 200
    assert blocked_response.json()["slots"] == []

    allowed_response = client.get(
        "/slots",
        params={"resource_id": resource_id, "date": allowed_date},
        cookies={"session": token},
    )
    assert allowed_response.status_code == 200
    assert len(allowed_response.json()["slots"]) == 1


def test_availability_range_respects_min_future_days(
    client, db_conn, seeded_apartment, monkeypatch
):
    fixed_now = datetime(2026, 3, 1, 9, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(booking, "_now_utc", lambda: fixed_now)

    token = create_session(db_conn, seeded_apartment, is_admin=False)
    resource_id = _insert_resource(
        db_conn,
        name="Gästlägenhet",
        booking_type="full-day",
        max_future_days=90,
        min_future_days=3,
    )

    start_date = (fixed_now + timedelta(days=2)).date().isoformat()
    middle_date = (fixed_now + timedelta(days=3)).date().isoformat()
    end_date = (fixed_now + timedelta(days=4)).date().isoformat()

    response = client.get(
        "/availability-range",
        params={
            "resource_id": resource_id,
            "start_date": start_date,
            "end_date": end_date,
        },
        cookies={"session": token},
    )
    assert response.status_code == 200
    availability = {item["date"]: item for item in response.json()["availability"]}
    assert len(availability) == 3
    assert availability[start_date]["is_available"] is False
    assert availability[middle_date]["is_available"] is True
    assert availability[end_date]["is_available"] is True
