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
            is_active,
            price_cents,
            is_billable
        )
        VALUES (?, ?, ?, ?, ?, ?, 1, 0, 0)
        """,
        (
            name,
            booking_type,
            slot_duration_minutes,
            slot_start_hour,
            slot_end_hour,
            max_future_days,
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


def test_passed_time_slots_today_are_not_bookable(
    client, db_conn, seeded_apartment, monkeypatch
):
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
    booked_by_start = {slot["start_time"]: slot["is_booked"] for slot in slots}
    assert booked_by_start["2026-03-01T08:00:00+00:00"] is True
    assert booked_by_start["2026-03-01T12:00:00+00:00"] is True
    assert booked_by_start["2026-03-01T13:00:00+00:00"] is False
    assert booked_by_start["2026-03-01T14:00:00+00:00"] is False


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
