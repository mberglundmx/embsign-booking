from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional


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
    return any(existing_start < end_dt and existing_end > start_dt for existing_start, existing_end in intervals)


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
) -> int:
    start_dt, end_dt, start_iso, end_iso = _normalize_range(start_time, end_time)
    if has_overlap(conn, resource_id, apartment_id, to_iso(start_dt), to_iso(end_dt)):
        raise ValueError("overlap")
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
) -> List[Dict[str, str]]:
    if date_str is None:
        return []

    results: List[Dict[str, str]] = []
    resources = []
    if resource_id is not None:
        resources = conn.execute(
            """
            SELECT id, booking_type, slot_duration_minutes, slot_start_hour, slot_end_hour, max_future_days
            FROM resources
            WHERE id = ? AND is_active = 1
            """,
            (resource_id,),
        ).fetchall()
    else:
        resources = conn.execute(
            """
            SELECT id, booking_type, slot_duration_minutes, slot_start_hour, slot_end_hour, max_future_days
            FROM resources
            WHERE is_active = 1
            """,
        ).fetchall()

    date = datetime.fromisoformat(date_str)
    day_start = date.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=timezone.utc)
    day_end = day_start + timedelta(days=1)
    now_utc = _now_utc()
    target_day = day_start.date()

    for resource in resources:
        rid = resource["id"]
        booking_type = resource["booking_type"]
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
                    "is_booked": bool(is_past or overlap),
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
                    "is_booked": bool(is_past or overlap),
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
