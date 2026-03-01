from datetime import datetime, timedelta, timezone

import app.auth as auth
from app.auth import (
    RFID_CACHE,
    RfidEntry,
    create_session,
    ensure_apartment,
    get_session,
    hash_password,
    load_rfid_cache,
    lookup_rfid,
)


def test_get_session_returns_none_without_token(db_conn):
    assert get_session(db_conn, "") is None


def test_get_session_removes_expired_session(db_conn, seeded_apartment, monkeypatch):
    token = create_session(db_conn, seeded_apartment, is_admin=False)
    expired_at = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
    db_conn.execute(
        "UPDATE sessions SET expires_at = ? WHERE token = ?",
        (expired_at.isoformat(), token),
    )
    db_conn.commit()
    monkeypatch.setattr(auth, "_now", lambda: expired_at + timedelta(seconds=1))

    assert get_session(db_conn, token) is None
    row = db_conn.execute("SELECT token FROM sessions WHERE token = ?", (token,)).fetchone()
    assert row is None


def test_get_session_extends_expiry_on_activity(db_conn, seeded_apartment, monkeypatch):
    created_at = datetime(2026, 1, 1, 9, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(auth, "SESSION_TTL_SECONDS", 120)
    monkeypatch.setattr(auth, "_now", lambda: created_at)
    token = create_session(db_conn, seeded_apartment, is_admin=False)

    seen_at = created_at + timedelta(seconds=45)
    monkeypatch.setattr(auth, "_now", lambda: seen_at)
    session = get_session(db_conn, token)

    assert session is not None
    assert session["last_seen_at"] == seen_at.isoformat()
    assert session["expires_at"] == (seen_at + timedelta(seconds=120)).isoformat()

    row = db_conn.execute(
        "SELECT last_seen_at, expires_at FROM sessions WHERE token = ?",
        (token,),
    ).fetchone()
    assert row is not None
    assert row["last_seen_at"] == seen_at.isoformat()
    assert row["expires_at"] == (seen_at + timedelta(seconds=120)).isoformat()


def test_build_apartment_id_helper():
    assert auth._build_apartment_id("4", "1308") == "4-1308"


def test_ensure_apartment_noop_when_apartment_exists(db_conn):
    apartment_id = "1-1001"
    original_hash = hash_password("existing")
    db_conn.execute(
        """
        INSERT INTO apartments (id, password_hash, is_active, house, lgh_internal, skv_lgh, access_groups)
        VALUES (?, ?, 1, ?, ?, ?, ?)
        """,
        (apartment_id, original_hash, "1", "1001", "1001", "Boende"),
    )
    db_conn.commit()

    ensure_apartment(
        db_conn,
        RfidEntry(
            apartment_id=apartment_id,
            house="9",
            lgh_internal="9999",
            skv_lgh="9999",
            active=True,
            access_groups=["Other"],
        ),
    )

    row = db_conn.execute("SELECT * FROM apartments WHERE id = ?", (apartment_id,)).fetchone()
    assert row is not None
    assert row["password_hash"] == original_hash
    assert row["house"] == "1"


def test_load_rfid_cache_populates_entries_and_skips_invalid(monkeypatch):
    csv_data = "\n".join(
        [
            "Namn;K1;UID;Status;K4;K5;K6;Access",
            "1-LGH1013 /1201 tag1;x;UID123;0;x;x;x; Boende | Gym ",
            "broken row",
            "Securitas tag;x;UID999;0;x;x;x;Boende",
            "1-LGH1001 /1001 tag1;x;;0;x;x;x;Boende",
            "4-LGH 1084/1308 EM K;x;UID777;1;x;x;x; Tvatt ",
        ]
    )

    def fake_fetch(url: str, github_token: str | None):
        assert url == "https://example.com/rfid.csv"
        assert github_token == "secret-token"
        return csv_data

    monkeypatch.setattr(auth, "CSV_URL", "https://example.com/rfid.csv")
    monkeypatch.setattr(auth, "GITHUB_TOKEN", "secret-token")
    monkeypatch.setattr(auth, "fetch_text", fake_fetch)
    RFID_CACHE.clear()

    load_rfid_cache()

    assert set(RFID_CACHE.keys()) == {"UID123", "UID777"}
    assert lookup_rfid("UID123") == RfidEntry(
        apartment_id="1-1201",
        house="1",
        lgh_internal="1013",
        skv_lgh="1201",
        active=True,
        access_groups=["Boende", "Gym"],
    )
    assert lookup_rfid("UID777").active is False


def test_load_rfid_cache_handles_fetch_failures(monkeypatch):
    monkeypatch.setattr(auth, "CSV_URL", "https://example.com/rfid.csv")
    monkeypatch.setattr(auth, "GITHUB_TOKEN", None)
    RFID_CACHE.clear()
    RFID_CACHE["KEEP"] = RfidEntry(
        apartment_id="1-1001",
        house="1",
        lgh_internal="1001",
        skv_lgh="1001",
        active=True,
        access_groups=[],
    )

    def failing_fetch(url: str, github_token: str | None):
        raise RuntimeError("boom")

    monkeypatch.setattr(auth, "fetch_text", failing_fetch)
    load_rfid_cache()
    assert "KEEP" in RFID_CACHE
