"""Daily Dhuhr and Asr times, and breaks anchored to them.

A break rule may carry ``anchor: "dhuhr" | "asr"`` instead of fixed clock
times. It then starts at that day's adhan and lasts ``minutes``, so the break
follows the prayer through the year without anyone editing schedules.

Times use the standard astronomical formulas (the PrayTimes.org algorithm):
Dhuhr is solar noon and Asr uses the standard (Shafi'i) shadow ratio of 1,
which is what the Egyptian General Authority of Survey publishes. The
location defaults to Tanta and is configured with PRAYER_LATITUDE /
PRAYER_LONGITUDE.
"""

from __future__ import annotations

import math
from datetime import UTC, date, datetime, time, timedelta
from functools import lru_cache
from zoneinfo import ZoneInfo

from app.core.config import get_settings

PRAYER_ANCHORS = ("dhuhr", "asr")


def _sin(degrees: float) -> float:
    return math.sin(math.radians(degrees))


def _cos(degrees: float) -> float:
    return math.cos(math.radians(degrees))


def _tan(degrees: float) -> float:
    return math.tan(math.radians(degrees))


def _fix(value: float, modulus: float) -> float:
    value %= modulus
    return value + modulus if value < 0 else value


def _julian_day(day: date) -> float:
    year, month = day.year, day.month
    if month <= 2:
        year -= 1
        month += 12
    a = year // 100
    b = 2 - a + a // 4
    return (
        math.floor(365.25 * (year + 4716))
        + math.floor(30.6001 * (month + 1))
        + day.day
        + b
        - 1524.5
    )


def _sun_position(julian_day: float) -> tuple[float, float]:
    """(declination in degrees, equation of time in hours)."""
    d = julian_day - 2451545.0
    g = _fix(357.529 + 0.98560028 * d, 360)
    q = _fix(280.459 + 0.98564736 * d, 360)
    ecliptic_longitude = _fix(q + 1.915 * _sin(g) + 0.020 * _sin(2 * g), 360)
    obliquity = 23.439 - 0.00000036 * d
    right_ascension = (
        math.degrees(
            math.atan2(_cos(obliquity) * _sin(ecliptic_longitude), _cos(ecliptic_longitude))
        )
        / 15
    )
    declination = math.degrees(math.asin(_sin(obliquity) * _sin(ecliptic_longitude)))
    equation_of_time = q / 15 - _fix(right_ascension, 24)
    return declination, equation_of_time


def _solar_hours_utc(day: date, latitude: float, longitude: float) -> tuple[float, float]:
    """Dhuhr and Asr as fractional UTC hours on ``day``."""
    base = _julian_day(day) - longitude / (15 * 24)

    def mid_day(fraction: float) -> float:
        _, equation_of_time = _sun_position(base + fraction)
        return _fix(12 - equation_of_time, 24)

    dhuhr_local = mid_day(12 / 24)
    # Asr: when an object's shadow equals its length plus its noon shadow.
    asr_local = 15.0
    for _ in range(2):
        declination, _ = _sun_position(base + asr_local / 24)
        altitude = math.degrees(math.atan(1 / (1 + _tan(abs(latitude - declination)))))
        cosine = (_sin(altitude) - _sin(declination) * _sin(latitude)) / (
            _cos(declination) * _cos(latitude)
        )
        hour_angle = math.degrees(math.acos(max(-1.0, min(1.0, cosine)))) / 15
        asr_local = mid_day(asr_local / 24) + hour_angle
    offset = longitude / 15
    return dhuhr_local - offset, asr_local - offset


@lru_cache(maxsize=1024)
def _prayer_instants(day: date, latitude: float, longitude: float) -> dict[str, datetime]:
    midnight = datetime.combine(day, time(0), tzinfo=UTC)
    dhuhr_hours, asr_hours = _solar_hours_utc(day, latitude, longitude)
    instants = {}
    for name, hours in (("dhuhr", dhuhr_hours), ("asr", asr_hours)):
        instant = midnight + timedelta(hours=hours)
        # Published timetables are per minute; never start a break before the adhan.
        if instant.second or instant.microsecond:
            instant = instant.replace(second=0, microsecond=0) + timedelta(minutes=1)
        instants[name] = instant
    return instants


def prayer_times(day: date, zone: ZoneInfo | str) -> dict[str, time]:
    """Local Dhuhr and Asr clock times for ``day`` in ``zone``.

    ``day`` is the local calendar date; the solar calculation uses the same
    date, which is correct for any zone within a few hours of the location.
    """
    zone = ZoneInfo(zone) if isinstance(zone, str) else zone
    settings = get_settings()
    instants = _prayer_instants(day, settings.prayer_latitude, settings.prayer_longitude)
    return {name: value.astimezone(zone).time().replace(tzinfo=None) for name, value in instants.items()}


def is_prayer_anchored(rule: dict) -> bool:
    return rule.get("anchor") in PRAYER_ANCHORS


def resolve_break_rules(rules: list[dict] | None, day: date, zone: ZoneInfo | str) -> list[dict]:
    """Copy of ``rules`` with anchored breaks given that day's start and end time."""
    if not rules:
        return []
    if not any(is_prayer_anchored(rule) for rule in rules):
        return list(rules)
    times = prayer_times(day, zone)
    resolved = []
    for rule in rules:
        if not is_prayer_anchored(rule):
            resolved.append(rule)
            continue
        start = datetime.combine(day, times[rule["anchor"]])
        end = start + timedelta(minutes=int(rule.get("minutes") or 0))
        if end.date() != day:
            continue
        resolved.append(
            {
                **rule,
                "start_time": start.strftime("%H:%M"),
                "end_time": end.strftime("%H:%M"),
            }
        )
    return resolved
