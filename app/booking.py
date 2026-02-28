from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

_APARTMENT_PREFIX_SEPARATOR = "-"


def parse_dt(value: str) -> datetime:
    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    dt = datetime.fromisoformat(normalized)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def to_iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds")


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_range(start: str, end: str) -> tuple[datetime, datetime, str, str]:
    start_dt = parse_dt(start)
    end_dt = parse_dt(end)
    if end_dt <= start_dt:
        raise ValueError("invalid_time_range")
    return start_dt, end_dt, to_iso(start_dt), to_iso(end_dt)


def _load_intervals(conn, query: str, params: tuple) -> List[tuple[datetime, datetime]]:
    rows = conn.execute(query, params).fetchall()
    intervals: List[tuple[datetime, datetime]] = []
    for row in rows:
        try:
            intervals.append((parse_dt(row["start_time"]), parse_dt(row["end_time"])))
        except Exception:
            continue
    return intervals


def _has_overlap_in_intervals(
    intervals: List[tuple[datetime, datetime]],
    start_dt: datetime,
    end_dt: datetime,
) -> bool:
    return any(
        existing_start < end_dt and existing_end > start_dt
        for existing_start, existing_end in intervals
    )


def _normalize_max_bookings(raw: object) -> int:
    try:
        value = int(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 2
    if value <= 0:
        return 2
    return value


def _get_resource_max_bookings(conn, resource_id: int) -> int | None:
    row = conn.execute(
        "SELECT max_bookings FROM resources WHERE id = ? AND is_active = 1",
        (resource_id,),
    ).fetchone()
    if row is None:
        return None
    return _normalize_max_bookings(row["max_bookings"])


def _future_booking_count(conn, apartment_id: str, resource_id: int, now_iso: str) -> int:
    row = conn.execute(
        """
        SELECT COUNT(*) AS count
        FROM bookings
        WHERE apartment_id = ? AND resource_id = ? AND end_time > ?
        """,
        (apartment_id, resource_id, now_iso),
    ).fetchone()
    if row is None:
        return 0
    return int(row["count"])


def _split_rule_values(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [value.strip() for value in raw.split("|") if value.strip()]


def _get_apartment_house(conn, apartment_id: str) -> str | None:
    row = conn.execute("SELECT house FROM apartments WHERE id = ?", (apartment_id,)).fetchone()
    if row is not None:
        house = row["house"]
        if isinstance(house, str) and house.strip():
            return house.strip()
    prefix = apartment_id.split(_APARTMENT_PREFIX_SEPARATOR, 1)[0].strip()
    if prefix.isdigit():
        return prefix
    return None


def _resource_access_allowed(
    resource_row,
    apartment_id: str,
    apartment_house: str | None,
) -> bool:
    deny_apartments = {
        value.casefold() for value in _split_rule_values(resource_row["deny_apartment_ids"])
    }
    if apartment_id.casefold() in deny_apartments:
        return False

    allow_houses = [value.casefold() for value in _split_rule_values(resource_row["allow_houses"])]
    if allow_houses:
        if apartment_house is None:
            return False
        if apartment_house.casefold() not in allow_houses:
            return False
    return True


def can_access_resource(
    conn,
    resource_id: int,
    apartment_id: str,
    is_admin: bool = False,
) -> bool:
    row = conn.execute(
        """
        SELECT id, allow_houses, deny_apartment_ids
        FROM resources
        WHERE id = ? AND is_active = 1
        """,
        (resource_id,),
    ).fetchone()
    if row is None:
        return False
    if is_admin:
        return True
    apartment_house = _get_apartment_house(conn, apartment_id)
    return _resource_access_allowed(row, apartment_id, apartment_house)


def has_overlap(conn, resource_id: int, apartment_id: str, start: str, end: str) -> bool:
    start_dt, end_dt, _, _ = _normalize_range(start, end)
    resource_intervals = _load_intervals(
        conn,
        "SELECT start_time, end_time FROM bookings WHERE resource_id = ?",
        (resource_id,),
    )
    if _has_overlap_in_intervals(resource_intervals, start_dt, end_dt):
        return True

    apartment_intervals = _load_intervals(
        conn,
        "SELECT start_time, end_time FROM bookings WHERE apartment_id = ?",
        (apartment_id,),
    )
    return _has_overlap_in_intervals(apartment_intervals, start_dt, end_dt)


def create_booking(
    conn,
    apartment_id: str,
    resource_id: int,
    start_time: str,
    end_time: str,
    is_billable: bool,
    is_admin: bool = False,
) -> int:
    if not can_access_resource(conn, resource_id, apartment_id, is_admin=is_admin):
        raise PermissionError("resource_forbidden")
    start_dt, end_dt, start_iso, end_iso = _normalize_range(start_time, end_time)
    if has_overlap(conn, resource_id, apartment_id, to_iso(start_dt), to_iso(end_dt)):
        raise ValueError("overlap")
    max_bookings = _get_resource_max_bookings(conn, resource_id)
    if max_bookings is None:
        raise PermissionError("resource_forbidden")
    now_utc = _now_utc()
    if end_dt > now_utc:
        now_iso = to_iso(now_utc)
        if _future_booking_count(conn, apartment_id, resource_id, now_iso) >= max_bookings:
            raise ValueError("max_bookings")
    cursor = conn.execute(
        """
        INSERT INTO bookings (apartment_id, resource_id, start_time, end_time, is_billable)
        VALUES (?, ?, ?, ?, ?)
        """,
        (apartment_id, resource_id, start_iso, end_iso, 1 if is_billable else 0),
    )
    conn.commit()
    return int(cursor.lastrowid)


def cancel_booking(conn, booking_id: int, apartment_id: Optional[str], is_admin: bool) -> bool:
    if is_admin:
        cursor = conn.execute("DELETE FROM bookings WHERE id = ?", (booking_id,))
    else:
        cursor = conn.execute(
            "DELETE FROM bookings WHERE id = ? AND apartment_id = ?",
            (booking_id, apartment_id),
        )
    conn.commit()
    return cursor.rowcount > 0


def list_slots(
    conn,
    resource_id: Optional[int],
    date_str: Optional[str],
    apartment_id: str | None = None,
    is_admin: bool = False,
) -> List[Dict[str, str]]:
    if date_str is None:
        return []

    results: List[Dict[str, str]] = []
    resources = []
    if resource_id is not None:
        resources = conn.execute(
            """
            SELECT id, booking_type, slot_duration_minutes, slot_start_hour, slot_end_hour, max_future_days
                   ,allow_houses, deny_apartment_ids
            FROM resources
            WHERE id = ? AND is_active = 1
            """,
            (resource_id,),
        ).fetchall()
    else:
        resources = conn.execute(
            """
            SELECT id, booking_type, slot_duration_minutes, slot_start_hour, slot_end_hour, max_future_days
                   ,allow_houses, deny_apartment_ids
            FROM resources
            WHERE is_active = 1
            """,
        ).fetchall()

    date = datetime.fromisoformat(date_str)
    day_start = date.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=timezone.utc)
    day_end = day_start + timedelta(days=1)
    now_utc = _now_utc()
    target_day = day_start.date()
    apartment_house = _get_apartment_house(conn, apartment_id) if apartment_id else None

    for resource in resources:
        rid = resource["id"]
        booking_type = resource["booking_type"]
        if not is_admin:
            if apartment_id is None:
                continue
            if not _resource_access_allowed(resource, apartment_id, apartment_house):
                continue
        max_future_days = int(resource["max_future_days"] or 30)
        days_ahead = (target_day - now_utc.date()).days
        if days_ahead >= max_future_days:
            continue

        intervals = _load_intervals(
            conn,
            "SELECT start_time, end_time FROM bookings WHERE resource_id = ?",
            (rid,),
        )

        if booking_type == "full-day":
            start = to_iso(day_start)
            end = to_iso(day_end)
            overlap = _has_overlap_in_intervals(intervals, day_start, day_end)
            is_past = day_end <= now_utc
            results.append(
                {
                    "resource_id": rid,
                    "start_time": start,
                    "end_time": end,
                    "is_booked": bool(overlap),
                    "is_past": bool(is_past),
                }
            )
            continue

        slot_duration_minutes = max(1, int(resource["slot_duration_minutes"] or 60))
        slot_start_hour = int(resource["slot_start_hour"] or 6)
        slot_end_hour = int(resource["slot_end_hour"] or 22)
        if slot_start_hour < 0 or slot_start_hour > 23:
            slot_start_hour = 6
        if slot_end_hour < 1 or slot_end_hour > 24 or slot_end_hour <= slot_start_hour:
            slot_end_hour = 22
            slot_start_hour = 6

        current = day_start + timedelta(hours=slot_start_hour)
        window_end = day_start + timedelta(hours=slot_end_hour)
        while current + timedelta(minutes=slot_duration_minutes) <= window_end:
            start = current
            end = current + timedelta(minutes=slot_duration_minutes)
            start_iso = to_iso(start)
            end_iso = to_iso(end)
            overlap = _has_overlap_in_intervals(intervals, start, end)
            is_past = end <= now_utc
            results.append(
                {
                    "resource_id": rid,
                    "start_time": start_iso,
                    "end_time": end_iso,
                    "is_booked": bool(overlap),
                    "is_past": bool(is_past),
                }
            )
            current = end
    return results


def admin_calendar(conn) -> List[Dict[str, str]]:
    rows = conn.execute(
        """
        SELECT b.id, b.apartment_id, b.resource_id, b.start_time, b.end_time,
               b.is_billable, r.name as resource_name
        FROM bookings b
        JOIN resources r ON r.id = b.resource_id
        ORDER BY b.start_time ASC
        """
    ).fetchall()
    return [dict(row) for row in rows]
