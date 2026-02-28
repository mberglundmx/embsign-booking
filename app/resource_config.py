import logging
import re
from typing import Any
from urllib.parse import urlparse

import yaml

from .config import CONFIG_URL, CSV_URL, GITHUB_TOKEN
from .github_content import fetch_text, github_url_to_api

logger = logging.getLogger(__name__)

_COST_NUMBER_PATTERN = re.compile(r"-?\d+(?:[.,]\d+)?")
_BOOKING_TYPE_MAP = {
    "hourslots": "time-slot",
    "time-slot": "time-slot",
    "daily": "full-day",
    "full-day": "full-day",
}


def _normalize_url(value: str | None) -> str | None:
    if not value:
        return None
    url = value.strip()
    return url or None


def _derive_booking_yaml_url_from_csv(csv_url: str | None) -> str | None:
    source = _normalize_url(csv_url)
    if source is None:
        return None

    api_url = github_url_to_api(source)
    parsed = urlparse(api_url)
    parts = parsed.path.strip("/").split("/")
    if parsed.hostname != "api.github.com":
        return None
    if len(parts) < 6:
        return None
    if parts[0] != "repos" or parts[3] != "contents":
        return None

    updated_path = "/".join(parts[:-1] + ["booking.yaml"])
    query = f"?{parsed.query}" if parsed.query else ""
    return f"{parsed.scheme}://{parsed.netloc}/{updated_path}{query}"


def _resolve_config_url(explicit_url: str | None) -> str | None:
    configured = _normalize_url(explicit_url) or _normalize_url(CONFIG_URL)
    if configured:
        return configured
    return _derive_booking_yaml_url_from_csv(CSV_URL)


def _to_amount(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        match = _COST_NUMBER_PATTERN.search(value.strip())
        if not match:
            return None
        return float(match.group(0).replace(",", "."))
    return None


def _price_cents_from_cost(cost: Any) -> int:
    amount: float | None = None
    if isinstance(cost, dict):
        preferred_keys = ("weekday", "vardag", "default", "weekend", "helg")
        for key in preferred_keys:
            amount = _to_amount(cost.get(key))
            if amount is not None:
                break
        if amount is None:
            for value in cost.values():
                amount = _to_amount(value)
                if amount is not None:
                    break
    else:
        amount = _to_amount(cost)

    if amount is None or amount <= 0:
        return 0
    return int(round(amount * 100))


def _extract_bookable_objects(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        objects = payload.get("bookable_objects")
    elif isinstance(payload, list):
        objects = payload
    else:
        return []

    if not isinstance(objects, list):
        return []
    return [obj for obj in objects if isinstance(obj, dict)]


def _map_booking_type(raw_type: Any) -> str:
    normalized = str(raw_type or "").strip().lower()
    return _BOOKING_TYPE_MAP.get(normalized, "time-slot")


def load_booking_objects(conn, config_url: str | None = None) -> int:
    source_url = _resolve_config_url(config_url)
    if source_url is None:
        logger.info("No CONFIG_URL configured and CSV_URL could not be used for booking.yaml")
        return 0

    try:
        content = fetch_text(source_url, github_token=GITHUB_TOKEN)
    except Exception:
        logger.exception("Failed to fetch booking config from %s", source_url)
        return 0

    try:
        payload = yaml.safe_load(content)
    except yaml.YAMLError:
        logger.exception("Invalid YAML content in booking config: %s", source_url)
        return 0

    objects = _extract_bookable_objects(payload)
    if not objects:
        logger.warning("No bookable_objects found in booking config: %s", source_url)
        return 0

    existing_rows = conn.execute("SELECT name FROM resources").fetchall()
    existing_names = {
        row["name"].strip().casefold()
        for row in existing_rows
        if isinstance(row["name"], str) and row["name"].strip()
    }

    inserted = 0
    for obj in objects:
        name = str(obj.get("name", "")).strip()
        if not name:
            continue

        key = name.casefold()
        if key in existing_names:
            continue

        booking_type = _map_booking_type(obj.get("type"))
        price_cents = _price_cents_from_cost(obj.get("cost"))
        is_billable = 1 if price_cents > 0 else 0
        conn.execute(
            """
            INSERT INTO resources (name, booking_type, is_active, price_cents, is_billable)
            VALUES (?, ?, 1, ?, ?)
            """,
            (name, booking_type, price_cents, is_billable),
        )
        existing_names.add(key)
        inserted += 1

    if inserted > 0:
        conn.commit()
        logger.info("Inserted %d booking objects from %s", inserted, source_url)
    else:
        logger.info("No new booking objects inserted from %s", source_url)
    return inserted
