from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.api.v1.admin_utils import (
    apply_pagination,
    count_for,
    pagination_meta,
    serialize_activity_event,
)
from app.api.v1.team_auth import apply_employee_scope, ensure_employee_access
from app.core.responses import success_response
from app.database.session import get_db
from app.models import ActivityEvent, AdminUser
from app.services.activity_timeline import local_today
from app.services.attendance import calculate_daily_attendance
from app.services.permissions import require_capability

router = APIRouter(prefix="/activity", tags=["activity"])


def _history_timezone(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def _history_day_bounds(value: date, timezone_name: str | None) -> tuple[datetime, datetime]:
    zone = _history_timezone(timezone_name)
    local_start = datetime.combine(value, time.min, tzinfo=zone)
    return local_start.astimezone(UTC), (local_start + timedelta(days=1)).astimezone(UTC)


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _payload_text(payload: dict, key: str, maximum: int) -> str | None:
    value = payload.get(key)
    if not isinstance(value, str):
        return None
    normalized = " ".join(value.strip().split())
    return normalized[:maximum] or None


def _payload_datetime(payload: dict, key: str) -> datetime | None:
    value = payload.get(key)
    if not isinstance(value, str):
        return None
    try:
        return _as_utc(datetime.fromisoformat(value.replace("Z", "+00:00")))
    except ValueError:
        return None


def build_application_history(
    events: list[ActivityEvent],
    *,
    selected_day: date,
    timezone_name: str | None,
) -> dict:
    day_start, day_end = _history_day_bounds(selected_day, timezone_name)
    entries: list[dict] = []

    for event in events:
        payload = event.payload if isinstance(event.payload, dict) else {}
        process_name = _payload_text(payload, "process_name", 120)
        application_name = _payload_text(payload, "application_name", 160) or process_name
        if not application_name:
            continue

        site_domain = _payload_text(payload, "site_domain", 253)
        if site_domain:
            site_domain = site_domain.lower().removeprefix("www.")
            if any(character.isspace() or character in "/?#@" for character in site_domain):
                site_domain = None

        started_at = _as_utc(event.event_timestamp)
        raw_duration = payload.get("duration_seconds")
        try:
            duration_seconds = max(1, min(300, int(raw_duration)))
        except (TypeError, ValueError):
            duration_seconds = 1
        ended_at = _payload_datetime(payload, "ended_at") or (
            started_at + timedelta(seconds=duration_seconds)
        )
        ended_at = min(
            max(ended_at, started_at + timedelta(seconds=1)),
            started_at + timedelta(seconds=duration_seconds),
            day_end,
        )
        visible_start = max(started_at, day_start)
        if ended_at <= visible_start:
            continue
        visible_seconds = max(1, int((ended_at - visible_start).total_seconds()))

        current = {
            "id": str(event.id),
            "application_name": application_name,
            "process_name": process_name,
            "site_domain": site_domain,
            "started_at": visible_start.isoformat(),
            "ended_at": ended_at.isoformat(),
            "duration_seconds": visible_seconds,
        }
        previous = entries[-1] if entries else None
        if previous:
            previous_end = datetime.fromisoformat(previous["ended_at"])
            gap_seconds = (visible_start - previous_end).total_seconds()
            if (
                previous["application_name"] == application_name
                and previous["site_domain"] == site_domain
                and gap_seconds <= 30
            ):
                previous["ended_at"] = max(previous_end, ended_at).isoformat()
                previous["duration_seconds"] += visible_seconds
                continue
        entries.append(current)

    application_totals: dict[str, int] = {}
    website_totals: dict[str, int] = {}
    for entry in entries:
        application_totals[entry["application_name"]] = (
            application_totals.get(entry["application_name"], 0) + entry["duration_seconds"]
        )
        if entry["site_domain"]:
            website_totals[entry["site_domain"]] = (
                website_totals.get(entry["site_domain"], 0) + entry["duration_seconds"]
            )

    return {
        "date": selected_day.isoformat(),
        "timezone": timezone_name or "UTC",
        "total_seconds": sum(entry["duration_seconds"] for entry in entries),
        "application_count": len(application_totals),
        "website_count": len(website_totals),
        "applications": [
            {"name": name, "duration_seconds": seconds}
            for name, seconds in sorted(
                application_totals.items(), key=lambda item: (-item[1], item[0].lower())
            )
        ],
        "websites": [
            {"domain": domain, "duration_seconds": seconds}
            for domain, seconds in sorted(
                website_totals.items(), key=lambda item: (-item[1], item[0])
            )
        ],
        "items": list(reversed(entries)),
    }


@router.get("/timeline")
def employee_timeline(
    employee_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    day: date | None = None,
    team_id: UUID | None = None,
):
    employee = ensure_employee_access(db, current_admin, employee_id, team_id)
    selected_day = day or local_today(employee.timezone)
    _, timeline = calculate_daily_attendance(
        db,
        employee=employee,
        work_date=selected_day,
        now=datetime.now(UTC),
        persist=False,
    )
    return success_response(
        data=timeline
    )


@router.get("/application-history")
def application_history(
    employee_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    day: date | None = None,
    team_id: UUID | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
):
    require_capability(current_admin, "timesheets.view")
    employee = ensure_employee_access(db, current_admin, employee_id, team_id)
    zone = _history_timezone(employee.timezone)
    selected_day = day or datetime.now(UTC).astimezone(zone).date()
    day_start, day_end = _history_day_bounds(selected_day, employee.timezone)
    events = db.scalars(
        select(ActivityEvent)
        .where(
            ActivityEvent.company_id == current_admin.company_id,
            ActivityEvent.employee_id == employee_id,
            ActivityEvent.event_type == "foreground_activity",
            # Segments are capped at five minutes. Include the small overlap so
            # an application that crossed midnight is visible on both days.
            ActivityEvent.event_timestamp >= day_start - timedelta(minutes=5),
            ActivityEvent.event_timestamp < day_end,
        )
        .order_by(ActivityEvent.event_timestamp, ActivityEvent.created_at)
    ).all()
    history = build_application_history(
        list(events),
        selected_day=selected_day,
        timezone_name=employee.timezone,
    )
    items = history["items"]
    total = len(items)
    start = (page - 1) * page_size
    history["items"] = items[start : start + page_size]
    return success_response(
        data={"employee_id": str(employee_id), **history},
        meta=pagination_meta(total, page, page_size),
    )


@router.get("")
def list_activity(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    employee_id: UUID | None = None,
    team_id: UUID | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
):
    statement = select(ActivityEvent).where(
        ActivityEvent.company_id == current_admin.company_id,
        ActivityEvent.event_type != "foreground_activity",
    )
    statement = apply_employee_scope(
        statement, db, current_admin, ActivityEvent.employee_id, team_id
    )
    if employee_id:
        ensure_employee_access(db, current_admin, employee_id, team_id)
        statement = statement.where(ActivityEvent.employee_id == employee_id)
    statement = statement.order_by(ActivityEvent.event_timestamp.desc())
    total = count_for(db, statement)
    events = db.scalars(apply_pagination(statement, page, page_size)).all()
    return success_response(
        data=[serialize_activity_event(event) for event in events],
        meta=pagination_meta(total, page, page_size),
    )
