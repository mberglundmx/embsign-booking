from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional


def parse_dt(value: str) -> datetime:
    return datetime.fromisoformat(value)


def to_iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def has_overlap(conn, resource_id: int, apartment_id: str, start: str, end: str) -> bool:
    row = conn.execute(
        """
        SELECT 1 FROM bookings
        WHERE resource_id = ?
          AND start_time < ?
          AND end_time > ?
        LIMIT 1
        """,
        (resource_id, end, start),
    ).fetchone()
    if row is not None:
        return True
    row = conn.execute(
        """
        SELECT 1 FROM bookings
        WHERE apartment_id = ?
          AND start_time < ?
          AND end_time > ?
        LIMIT 1
        """,
        (apartment_id, end, start),
    ).fetchone()
    return row is not None


def create_booking(
    conn,
    apartment_id: str,
    resource_id: int,
    start_time: str,
    end_time: str,
    is_billable: bool,
) -> int:
    if has_overlap(conn, resource_id, apartment_id, start_time, end_time):
        raise ValueError("overlap")
    cursor = conn.execute(
        """
        INSERT INTO bookings (apartment_id, resource_id, start_time, end_time, is_billable)
        VALUES (?, ?, ?, ?, ?)
        """,
        (apartment_id, resource_id, start_time, end_time, 1 if is_billable else 0),
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
            "SELECT id, booking_type FROM resources WHERE id = ? AND is_active = 1",
            (resource_id,),
        ).fetchall()
    else:
        resources = conn.execute(
            "SELECT id, booking_type FROM resources WHERE is_active = 1",
        ).fetchall()

    date = datetime.fromisoformat(date_str)
    day_start = date.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)

    for resource in resources:
        rid = resource["id"]
        booking_type = resource["booking_type"]
        if booking_type == "full-day":
            start = to_iso(day_start)
            end = to_iso(day_end)
            overlap = conn.execute(
                """
                SELECT 1 FROM bookings
                WHERE resource_id = ?
                  AND start_time < ?
                  AND end_time > ?
                LIMIT 1
                """,
                (rid, end, start),
            ).fetchone()
            results.append(
                {
                    "resource_id": rid,
                    "start_time": start,
                    "end_time": end,
                    "is_booked": overlap is not None,
                }
            )
            continue

        start_of_day = date.replace(hour=6, minute=0, second=0, microsecond=0)
        for hour in range(6, 22):
            start = start_of_day + timedelta(hours=hour - 6)
            end = start + timedelta(hours=1)
            start_iso = to_iso(start)
            end_iso = to_iso(end)
            overlap = conn.execute(
                """
                SELECT 1 FROM bookings
                WHERE resource_id = ?
                  AND start_time < ?
                  AND end_time > ?
                LIMIT 1
                """,
                (rid, end_iso, start_iso),
            ).fetchone()
            results.append(
                {
                    "resource_id": rid,
                    "start_time": start_iso,
                    "end_time": end_iso,
                    "is_booked": overlap is not None,
                }
            )
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
