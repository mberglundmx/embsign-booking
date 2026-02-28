import app.resource_config as resource_config


SAMPLE_BOOKING_YAML = """
bookable_objects:
  - name: Tvättstuga Hus 1
    type: hourslots
    cost: 0
  - name: Gästlägenhet
    type: daily
    cost:
      weekday: 200
      weekend: 300
"""


def test_load_booking_objects_inserts_only_missing_resources(db_conn, monkeypatch):
    db_conn.execute(
        """
        INSERT INTO resources (name, booking_type, is_active, price_cents, is_billable)
        VALUES (?, ?, 1, ?, ?)
        """,
        ("Tvättstuga Hus 1", "time-slot", 0, 0),
    )
    db_conn.commit()

    calls = {}

    def fake_fetch(url: str, github_token: str | None):
        calls["url"] = url
        calls["token"] = github_token
        return SAMPLE_BOOKING_YAML

    monkeypatch.setattr(resource_config, "CONFIG_URL", "https://example.com/booking.yaml")
    monkeypatch.setattr(resource_config, "CSV_URL", None)
    monkeypatch.setattr(resource_config, "fetch_text", fake_fetch)

    inserted = resource_config.load_booking_objects(db_conn)
    assert inserted == 1
    assert calls["url"] == "https://example.com/booking.yaml"

    rows = db_conn.execute(
        "SELECT name, booking_type, price_cents, is_billable FROM resources ORDER BY name"
    ).fetchall()
    assert len(rows) == 2
    assert rows[0]["name"] == "Gästlägenhet"
    assert rows[0]["booking_type"] == "full-day"
    assert rows[0]["price_cents"] == 20000
    assert rows[0]["is_billable"] == 1
    assert rows[1]["name"] == "Tvättstuga Hus 1"


def test_load_booking_objects_derives_booking_yaml_url_from_csv_url(db_conn, monkeypatch):
    calls = {}

    def fake_fetch(url: str, github_token: str | None):
        calls["url"] = url
        return "bookable_objects: []"

    monkeypatch.setattr(resource_config, "CONFIG_URL", None)
    monkeypatch.setattr(
        resource_config,
        "CSV_URL",
        "https://github.com/acme/brf/blob/main/rfid_tags.csv",
    )
    monkeypatch.setattr(resource_config, "fetch_text", fake_fetch)

    inserted = resource_config.load_booking_objects(db_conn)
    assert inserted == 0
    assert (
        calls["url"]
        == "https://api.github.com/repos/acme/brf/contents/booking.yaml?ref=main"
    )


def test_load_booking_objects_does_nothing_without_urls(db_conn, monkeypatch):
    called = {"fetch": False}

    def fake_fetch(url: str, github_token: str | None):
        called["fetch"] = True
        return ""

    monkeypatch.setattr(resource_config, "CONFIG_URL", None)
    monkeypatch.setattr(resource_config, "CSV_URL", None)
    monkeypatch.setattr(resource_config, "fetch_text", fake_fetch)

    inserted = resource_config.load_booking_objects(db_conn)
    assert inserted == 0
    assert called["fetch"] is False
