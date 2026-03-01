import app.resource_config as resource_config


def test_derive_booking_yaml_url_from_csv_rejects_invalid_shapes():
    assert (
        resource_config._derive_booking_yaml_url_from_csv("https://example.com/rfid_tags.csv")
        is None
    )
    assert (
        resource_config._derive_booking_yaml_url_from_csv("https://api.github.com/repos/acme/repo")
        is None
    )
    assert (
        resource_config._derive_booking_yaml_url_from_csv(
            "https://api.github.com/repos/acme/repo/git/rfid_tags.csv?ref=main"
        )
        is None
    )


def test_cost_and_number_parsing_helpers_cover_edge_cases():
    assert resource_config._to_amount("not a number") is None
    assert resource_config._to_amount("12,5 kr") == 12.5
    assert resource_config._price_cents_from_cost({"foo": "x", "bar": "99"}) == 9900
    assert resource_config._to_positive_int(0, 7) == 7
    assert resource_config._max_future_days("nope") == 30
    assert resource_config._hour_in_range(42, 6, min_value=0, max_value=23) == 6


def test_string_list_and_extract_helpers_cover_nonstandard_input():
    assert resource_config._to_string_list("not-a-list") == []
    assert resource_config._to_string_list([" a ", "", "A"]) == ["a"]
    assert resource_config._extract_bookable_objects([{"name": "x"}, {"other": 1}]) == [
        {"name": "x"},
        {"other": 1},
    ]
    assert resource_config._extract_bookable_objects({"bookable_objects": "bad"}) == []
    assert resource_config._extract_bookable_objects("bad-payload") == []


def test_load_booking_objects_handles_fetch_and_yaml_errors(db_conn, monkeypatch):
    monkeypatch.setattr(
        resource_config,
        "fetch_text",
        lambda url, github_token: (_ for _ in ()).throw(RuntimeError("network")),
    )
    assert (
        resource_config.load_booking_objects(db_conn, config_url="https://example.com/booking.yaml")
        == 0
    )

    monkeypatch.setattr(resource_config, "fetch_text", lambda url, github_token: "[")
    assert (
        resource_config.load_booking_objects(db_conn, config_url="https://example.com/booking.yaml")
        == 0
    )


def test_load_booking_objects_skips_missing_name_and_repairs_invalid_slot_window(
    db_conn, monkeypatch
):
    yaml_payload = """
bookable_objects:
  - type: hourslots
    start_time: 7
    end_time: 10
  - name: Bad window
    type: hourslots
    start_time: 20
    end_time: 10
"""

    monkeypatch.setattr(resource_config, "fetch_text", lambda url, github_token: yaml_payload)
    inserted = resource_config.load_booking_objects(
        db_conn, config_url="https://example.com/booking.yaml"
    )
    assert inserted == 1

    row = db_conn.execute(
        "SELECT name, slot_start_hour, slot_end_hour FROM resources WHERE name = ?",
        ("Bad window",),
    ).fetchone()
    assert row is not None
    assert row["slot_start_hour"] == 6
    assert row["slot_end_hour"] == 22
