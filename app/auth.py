import hashlib
import hmac
import logging
import re
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from .config import CSV_URL, GITHUB_TOKEN, SESSION_TTL_SECONDS
from .github_content import fetch_text

logger = logging.getLogger(__name__)

_LGH_PATTERN = re.compile(r"(\d+)-\s*LGH\s*(\d+)\s*/\s*(\d+)", re.IGNORECASE)


@dataclass
class RfidEntry:
    apartment_id: str
    house: str
    lgh_internal: str
    skv_lgh: str
    active: bool
    access_groups: List[str] = field(default_factory=list)


RFID_CACHE: Dict[str, RfidEntry] = {}


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


def parse_apartment_name(name: str) -> Optional[Dict[str, str]]:
    """Parse an apartment identifier from the CSV Namn field.

    Handles patterns like:
      '1-LGH1013 /1201 tag1'
      '6- Lgh 1173/1705 EM Fredrik'
      '4-LGH 1084/1308 EM K'
    """
    m = _LGH_PATTERN.match(name)
    if not m:
        return None
    return {
        "house": m.group(1),
        "lgh_internal": m.group(2),
        "skv_lgh": m.group(3),
    }


def _build_apartment_id(house: str, skv_lgh: str) -> str:
    return f"{house}-{skv_lgh}"


def load_rfid_cache() -> None:
    if not CSV_URL:
        logger.warning("RFID CSV_URL not configured; cache not loaded")
        return

    try:
        raw = fetch_text(CSV_URL, github_token=GITHUB_TOKEN)
    except Exception:
        logger.exception("Failed to fetch RFID CSV from %s", CSV_URL)
        return

    lines = raw.splitlines()
    if not lines:
        return

    cache: Dict[str, RfidEntry] = {}
    for line in lines[1:]:
        fields = line.split(";")
        if len(fields) < 8:
            continue

        name = fields[0].strip()
        rfid_uid = fields[2].strip()
        status_str = fields[3].strip()
        access_groups_raw = fields[7].strip()

        if not rfid_uid:
            continue

        parsed = parse_apartment_name(name)
        if not parsed:
            continue

        active = status_str == "0"
        access_groups = [
            g.strip() for g in access_groups_raw.split("|") if g.strip()
        ]
        apartment_id = _build_apartment_id(parsed["house"], parsed["skv_lgh"])

        cache[rfid_uid] = RfidEntry(
            apartment_id=apartment_id,
            house=parsed["house"],
            lgh_internal=parsed["lgh_internal"],
            skv_lgh=parsed["skv_lgh"],
            active=active,
            access_groups=access_groups,
        )

    RFID_CACHE.clear()
    RFID_CACHE.update(cache)
    logger.info("Loaded %d RFID entries into cache", len(cache))


def lookup_rfid(uid: str) -> Optional[RfidEntry]:
    return RFID_CACHE.get(uid)


def ensure_apartment(conn, entry: RfidEntry) -> None:
    """Create the apartment row if it does not exist yet."""
    row = conn.execute(
        "SELECT id FROM apartments WHERE id = ?", (entry.apartment_id,)
    ).fetchone()
    if row is not None:
        return
    random_pw = secrets.token_urlsafe(24)
    conn.execute(
        """
        INSERT INTO apartments (id, password_hash, is_active, house, lgh_internal, skv_lgh, access_groups)
        VALUES (?, ?, 1, ?, ?, ?, ?)
        """,
        (
            entry.apartment_id,
            hash_password(random_pw),
            entry.house,
            entry.lgh_internal,
            entry.skv_lgh,
            "|".join(entry.access_groups),
        ),
    )
    conn.commit()
    logger.info("Auto-created apartment %s (house=%s, lgh=%s, skv=%s)",
                entry.apartment_id, entry.house, entry.lgh_internal, entry.skv_lgh)


def check_rate_limit() -> None:
    return
