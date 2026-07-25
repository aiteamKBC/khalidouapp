from datetime import UTC, datetime

import app.services.device_location as device_location
from app.models import Device


def _device(**values) -> Device:
    defaults = {
        "timezone": None,
        "reported_timezone": None,
        "country_code": None,
        "timezone_source": None,
        "timezone_checked_at": None,
        "last_ip_address": None,
    }
    defaults.update(values)
    return Device(**defaults)


def test_egyptian_ip_overrides_misconfigured_london_timezone(monkeypatch):
    monkeypatch.setattr(
        device_location,
        "lookup_ip_location",
        lambda _: ("EG", "Africa/Cairo"),
    )
    device = _device(timezone="Europe/London", reported_timezone="Europe/London")

    changed = device_location.refresh_device_location(
        device,
        client_ip="8.8.8.8",
        reported_timezone="Europe/London",
        employee_timezone="Europe/London",
        now=datetime(2026, 7, 25, 8, 0, tzinfo=UTC),
    )

    assert changed is True
    assert device.timezone == "Africa/Cairo"
    assert device.country_code == "EG"
    assert device.timezone_source == "ip_geolocation"


def test_lookup_enforces_country_timezone_for_egypt(monkeypatch):
    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "success": True,
                "country_code": "EG",
                "timezone": {"id": "Europe/London"},
            }

    monkeypatch.setattr(device_location.httpx, "get", lambda *_, **__: Response())

    assert device_location.lookup_ip_location("8.8.8.8") == (
        "EG",
        "Africa/Cairo",
    )


def test_british_ip_uses_london_and_preserves_dst_rules(monkeypatch):
    monkeypatch.setattr(
        device_location,
        "lookup_ip_location",
        lambda _: ("GB", "Europe/London"),
    )
    device = _device(timezone="Africa/Cairo")

    device_location.refresh_device_location(
        device,
        client_ip="1.1.1.1",
        reported_timezone="Africa/Cairo",
        employee_timezone="Africa/Cairo",
    )

    assert device.timezone == "Europe/London"
    assert device.country_code == "GB"
    assert device.timezone_source == "ip_geolocation"


def test_private_ip_uses_valid_device_timezone_without_external_lookup(monkeypatch):
    def fail_if_called(_: str):
        raise AssertionError("Private addresses must not trigger IP geolocation")

    monkeypatch.setattr(device_location, "lookup_ip_location", fail_if_called)
    device = _device()

    device_location.refresh_device_location(
        device,
        client_ip="127.0.0.1",
        reported_timezone="Europe/London",
        employee_timezone="Africa/Cairo",
    )

    assert device.timezone == "Europe/London"
    assert device.country_code is None
    assert device.timezone_source == "device_timezone"


def test_transient_failure_does_not_replace_successful_location(monkeypatch):
    monkeypatch.setattr(device_location, "lookup_ip_location", lambda _: None)
    checked_at = datetime(2026, 7, 25, 8, 0, tzinfo=UTC)
    device = _device(
        timezone="Africa/Cairo",
        reported_timezone="Europe/London",
        country_code="EG",
        timezone_source="ip_geolocation",
        timezone_checked_at=checked_at,
        last_ip_address="8.8.8.8",
    )

    changed = device_location.refresh_device_location(
        device,
        client_ip="8.8.8.8",
        reported_timezone="Europe/London",
        employee_timezone="Europe/London",
        now=checked_at,
    )

    assert changed is False
    assert device.timezone == "Africa/Cairo"
    assert device.country_code == "EG"
    assert device.timezone_source == "ip_geolocation"
