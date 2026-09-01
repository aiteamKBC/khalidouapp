from __future__ import annotations

from datetime import UTC, datetime, timedelta
from ipaddress import ip_address
import logging
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx

from app.core.config import settings
from app.models import Device

logger = logging.getLogger(__name__)

# Country-level overrides make the business rule explicit.  In particular,
# Egypt must use Cairo and all UK addresses must follow London's DST rules.
COUNTRY_TIMEZONES = {
    "EG": "Africa/Cairo",
    "GB": "Europe/London",
}


def valid_timezone(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return ZoneInfo(value).key
    except (ZoneInfoNotFoundError, ValueError):
        return None


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _is_public_ip(value: str | None) -> bool:
    if not value:
        return False
    try:
        return ip_address(value).is_global
    except ValueError:
        return False


def lookup_ip_location(client_ip: str) -> tuple[str, str | None] | None:
    """Resolve an IP to ISO country code and an IANA timezone.

    Failure is deliberately non-fatal: tracking must continue using the
    device-reported timezone or the employee profile.
    """
    if not settings.ip_geolocation_url or not _is_public_ip(client_ip):
        return None
    url = settings.ip_geolocation_url.replace("{ip}", client_ip)
    try:
        response = httpx.get(
            url,
            params={"fields": "success,country_code,timezone"},
            timeout=settings.ip_geolocation_timeout_seconds,
            follow_redirects=False,
        )
        response.raise_for_status()
        payload: dict[str, Any] = response.json()
    except (httpx.HTTPError, ValueError, TypeError):
        logger.warning("IP geolocation lookup failed", extra={"client_ip": client_ip})
        return None

    if payload.get("success") is not True:
        return None
    country_code = str(payload.get("country_code") or "").strip().upper()
    if len(country_code) != 2:
        return None
    timezone_payload = payload.get("timezone")
    timezone_name = (
        timezone_payload.get("id")
        if isinstance(timezone_payload, dict)
        else timezone_payload
    )
    resolved_timezone = COUNTRY_TIMEZONES.get(country_code) or valid_timezone(
        str(timezone_name or "")
    )
    return country_code, resolved_timezone


def refresh_device_location(
    device: Device,
    *,
    client_ip: str | None,
    reported_timezone: str | None,
    employee_timezone: str | None,
    now: datetime | None = None,
) -> bool:
    """Refresh a device's effective timezone and return whether it changed."""
    checked_at = _as_utc(now or datetime.now(UTC)) or datetime.now(UTC)
    previous_timezone = valid_timezone(device.timezone)
    normalized_reported = valid_timezone(reported_timezone)
    if normalized_reported:
        device.reported_timezone = normalized_reported

    ip_changed = bool(client_ip and client_ip != device.last_ip_address)
    last_checked = _as_utc(device.timezone_checked_at)
    retry_due = (
        last_checked is None
        or checked_at - last_checked
        >= timedelta(minutes=settings.ip_geolocation_retry_minutes)
    )
    needs_ip_lookup = _is_public_ip(client_ip) and (
        ip_changed
        or (device.timezone_source != "ip_geolocation" and retry_due)
    )

    location = lookup_ip_location(client_ip) if needs_ip_lookup and client_ip else None
    if needs_ip_lookup:
        device.timezone_checked_at = checked_at
    if client_ip:
        device.last_ip_address = client_ip

    if location is not None:
        country_code, located_timezone = location
        device.country_code = country_code
        if located_timezone:
            device.timezone = located_timezone
            device.timezone_source = "ip_geolocation"
            return previous_timezone != located_timezone

    # Preserve a successful IP result while the public IP is unchanged.  A
    # transient provider failure must not replace it with a misconfigured OS
    # timezone.  When the network changed, however, stale country data is not
    # safe and the normal fallbacks are used.
    if (
        not ip_changed
        and device.timezone_source == "ip_geolocation"
        and previous_timezone
    ):
        return False

    fallback_timezone = (
        normalized_reported
        or valid_timezone(device.reported_timezone)
        or valid_timezone(employee_timezone)
        or "UTC"
    )
    device.timezone = fallback_timezone
    device.country_code = None
    device.timezone_source = (
        "device_timezone"
        if normalized_reported or valid_timezone(device.reported_timezone)
        else "employee_profile"
    )
    return previous_timezone != fallback_timezone
