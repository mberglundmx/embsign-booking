from datetime import datetime, timezone

import pytest

import app.booking as booking


def _insert_resource(
    db_conn,
    *,
    name: str,
    booking_type: str = "time-slot",
    slot_duration_minutes: int = 60,
    slot_start_hour: int = 6,
    slot_end_hour: int = 22,
    max_future_days: int = 30,
    max_bookings: int = 2,
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
            max_bookings,
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
            max_bookings,
        ),
    )
    db_conn.commit()
    return int(cursor.lastrowid)


def test_parse_dt_and_to_iso_handle_z_and_naive_datetime():
    assert booking.parse_dt("2026-01-01T10:00:00Z").isoformat() == "2026-01-01T10:00:00+00:00"
    assert booking.parse_dt("2026-01-01T11:00:00").isoformat() == "2026-01-01T11:00:00+00:00"
    naive = datetime(2026, 1, 1, 12, 0, 0)
    assert booking.to_iso(naive) == "2026-01-01T12:00:00+00:00"


def test_normalize_range_rejects_invalid_order():
    with pytest.raises(ValueError, match="invalid_time_range"):
        booking._normalize_range("2026-01-01T12:00:00+00:00", "2026-01-01T12:00:00+00:00")


def test_load_intervals_skips_invalid_rows():
    class _Cursor:
        def fetchall(self):
            return [
                {"start_time": "broken", "end_time": "broken"},
                {
                    "start_time": "2026-01-01T10:00:00+00:00",
                    "end_time": "2026-01-01T11:00:00+00:00",
                },
            ]

    class _Conn:
        def execute(self, query, params):
            return _Cursor()

    intervals = booking._load_intervals(_Conn(), "SELECT start_time, end_time FROM bookings", ())
    assert intervals == [
        (
            datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc),
            datetime(2026, 1, 1, 11, 0, tzinfo=timezone.utc),
        )
    ]


def test_normalize_max_bookings_and_resource_lookup(db_conn, seeded_resource):
    db_conn.execute("UPDATE resources SET max_bookings = ? WHERE id = ?", (-1, seeded_resource))
    db_conn.commit()

    assert booking._normalize_max_bookings("nope") == 2
    assert booking._normalize_max_bookings(0) == 2
    assert booking._normalize_max_bookings(5) == 5
    assert booking._get_resource_max_bookings(db_conn, seeded_resource) == 2
    assert booking._get_resource_max_bookings(db_conn, 999999) is None


def test_future_booking_count_returns_zero_when_row_is_missing():
    class _Cursor:
        def fetchone(self):
            return None

    class _Conn:
        def execute(self, query, params):
            return _Cursor()

    assert booking._future_booking_count(_Conn(), "A101", 1, "2026-01-01T00:00:00+00:00") == 0


def test_get_apartment_house_uses_prefix_when_missing_in_db(db_conn):
    db_conn.execute(
        "INSERT INTO apartments (id, password_hash, is_active, house) VALUES (?, ?, 1, ?)",
        ("x-1001", "hash", " "),
    )
    db_conn.commit()

    assert booking._get_apartment_house(db_conn, "3-1201") == "3"
    assert booking._get_apartment_house(db_conn, "x-1001") is None


def test_resource_access_rules_and_admin_bypass(db_conn, seeded_apartment):
    denied_row = {"allow_houses": "1", "deny_apartment_ids": ""}
    assert booking._resource_access_allowed(denied_row, seeded_apartment, None) is False
    assert booking._resource_access_allowed(
        {"allow_houses": "", "deny_apartment_ids": seeded_apartment}, seeded_apartment, "1"
    ) is False

    rid = _insert_resource(db_conn, name="Admin resource")
    assert booking.can_access_resource(db_conn, rid, seeded_apartment, is_admin=True) is True
    assert booking.can_access_resource(db_conn, 999999, seeded_apartment, is_admin=False) is False


def test_create_booking_raises_when_max_bookings_config_missing(
    db_conn, seeded_apartment, monkeypatch
):
    monkeypatch.setattr(booking, "can_access_resource", lambda *args, **kwargs: True)
    monkeypatch.setattr(booking, "_get_resource_max_bookings", lambda *args, **kwargs: None)
    monkeypatch.setattr(booking, "has_overlap", lambda *args, **kwargs: False)

    with pytest.raises(PermissionError, match="resource_forbidden"):
        booking.create_booking(
            db_conn,
            seeded_apartment,
            resource_id=1,
            start_time="2026-03-01T08:00:00+00:00",
            end_time="2026-03-01T09:00:00+00:00",
            is_billable=False,
        )


def test_cancel_booking_as_admin_deletes_other_apartments_booking(
    db_conn, seeded_apartment, seeded_resource
):
    db_conn.execute(
        """
        INSERT INTO bookings (apartment_id, resource_id, start_time, end_time, is_billable)
        VALUES (?, ?, ?, ?, 0)
        """,
        (
            seeded_apartment,
            seeded_resource,
            "2026-03-01T08:00:00+00:00",
            "2026-03-01T09:00:00+00:00",
        ),
    )
    booking_id = int(db_conn.execute("SELECT id FROM bookings").fetchone()["id"])
    db_conn.commit()

    assert booking.cancel_booking(db_conn, booking_id, apartment_id=None, is_admin=True) is True


def test_list_slots_branch_coverage_for_none_and_full_day(db_conn, seeded_apartment, monkeypatch):
    assert booking.list_slots(db_conn, resource_id=None, date_str=None, apartment_id=seeded_apartment) == []

    restricted_resource = _insert_resource(db_conn, name="Restricted")
    no_session_slots = booking.list_slots(
        db_conn,
        resource_id=None,
        date_str="2026-03-02",
        apartment_id=None,
        is_admin=False,
    )
    assert no_session_slots == []

    full_day_resource = _insert_resource(db_conn, name="Guest room", booking_type="full-day")
    invalid_hours_resource = _insert_resource(
        db_conn,
        name="Invalid hours",
        booking_type="time-slot",
        slot_start_hour=25,
        slot_end_hour=0,
    )
    db_conn.execute(
        """
        INSERT INTO bookings (apartment_id, resource_id, start_time, end_time, is_billable)
        VALUES (?, ?, ?, ?, 0)
        """,
        (
            seeded_apartment,
            full_day_resource,
            "2026-03-02T00:00:00+00:00",
            "2026-03-03T00:00:00+00:00",
        ),
    )
    db_conn.commit()
    monkeypatch.setattr(booking, "_now_utc", lambda: datetime(2026, 3, 1, 9, 0, tzinfo=timezone.utc))

    slots = booking.list_slots(
        db_conn,
        resource_id=None,
        date_str="2026-03-02",
        apartment_id=seeded_apartment,
        is_admin=True,
    )

    full_day_slots = [slot for slot in slots if slot["resource_id"] == full_day_resource]
    assert len(full_day_slots) == 1
    assert full_day_slots[0]["is_booked"] is True

    invalid_hour_slots = [slot for slot in slots if slot["resource_id"] == invalid_hours_resource]
    assert invalid_hour_slots[0]["start_time"].endswith("06:00:00+00:00")
    assert invalid_hour_slots[-1]["end_time"].endswith("22:00:00+00:00")
    assert restricted_resource in [slot["resource_id"] for slot in slots]
