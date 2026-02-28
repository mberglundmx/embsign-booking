import csv
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional, Tuple
from urllib.request import Request, urlopen

from .config import CSV_URL, GITHUB_TOKEN, SESSION_TTL_SECONDS

RFID_CACHE: Dict[str, Tuple[str, bool]] = {}


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def verify_password(password: str, password_hash: str) -> bool:
    candidate = hash_password(password)
    return hmac.compare_digest(candidate, password_hash)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _to_iso(dt: datetime) -> str:
    return dt.isoformat()


def create_session(conn, apartment_id: str, is_admin: bool) -> str:
    token = secrets.token_urlsafe(32)
    now = _now()
    expires = now + timedelta(seconds=SESSION_TTL_SECONDS)
    conn.execute(
        """
        INSERT INTO sessions (token, apartment_id, is_admin, created_at, last_seen_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            token,
            apartment_id,
            1 if is_admin else 0,
            _to_iso(now),
            _to_iso(now),
            _to_iso(expires),
        ),
    )
    conn.commit()
    return token


def get_session(conn, token: str) -> Optional[Dict[str, str]]:
    if not token:
        return None
    row = conn.execute(
        "SELECT * FROM sessions WHERE token = ?",
        (token,),
    ).fetchone()
    if row is None:
        return None
    expires_at = datetime.fromisoformat(row["expires_at"])
    if _now() > expires_at:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        conn.commit()
        return None
    conn.execute(
        "UPDATE sessions SET last_seen_at = ? WHERE token = ?",
        (_to_iso(_now()), token),
    )
    conn.commit()
    return dict(row)


def load_rfid_cache() -> None:
    if not CSV_URL:
        return
    headers = {}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"token {GITHUB_TOKEN}"
    request = Request(CSV_URL, headers=headers)
    with urlopen(request, timeout=10) as response:
        raw = response.read().decode("utf-8")
    reader = csv.DictReader(raw.splitlines())
    cache: Dict[str, Tuple[str, bool]] = {}
    for row in reader:
        uid = row.get("rfid_uid", "").strip()
        apartment_id = row.get("lgh_id", "").strip()
        active = row.get("active", "true").strip().lower() in {"1", "true", "yes"}
        if uid and apartment_id:
            cache[uid] = (apartment_id, active)
    RFID_CACHE.clear()
    RFID_CACHE.update(cache)


def lookup_rfid(uid: str) -> Optional[Tuple[str, bool]]:
    return RFID_CACHE.get(uid)


def check_rate_limit() -> None:
    # Placeholder for a real rate limiter (e.g. Redis or in-memory buckets).
    return
