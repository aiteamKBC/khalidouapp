"""Read-only production audit for tracking, attendance, and screenshot storage."""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from shutil import disk_usage
from typing import Any
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.database.session import get_sessionmaker
from app.models import ActivityEvent, DailyAttendance, Device, Employee, Screenshot, WorkSession
from app.services.activity_timeline import local_today, open_session_liveness
from app.storage.local import LocalScreenshotStorage

ACTIVE_SESSION_STATUSES = {"active", "idle", "locked", "sleeping"}
MAX_SAMPLES = 100


def _audit_time_ledger_invariants(
    db: Session,
    *,
    employee_name: str | None,
) -> dict[str, Any]:
    session_statement = (
        select(WorkSession, Employee.name, Device.device_name)
        .join(Employee, Employee.id == WorkSession.employee_id)
        .join(Device, Device.id == WorkSession.device_id)
        .where(
            or_(
                WorkSession.ended_at < WorkSession.started_at,
                (
                    WorkSession.ended_at.is_not(None)
                    & (WorkSession.status != "ended")
                ),
            )
        )
        .order_by(WorkSession.started_at.desc())
    )
    invalid_sessions = db.execute(
        _employee_filter(session_statement, employee_name)
    ).all()

    duplicate_statement = (
        select(
            WorkSession.device_id,
            Employee.name,
            Device.device_name,
            func.count(WorkSession.id),
        )
        .join(Employee, Employee.id == WorkSession.employee_id)
        .join(Device, Device.id == WorkSession.device_id)
        .where(WorkSession.ended_at.is_(None))
        .group_by(WorkSession.device_id, Employee.name, Device.device_name)
        .having(func.count(WorkSession.id) > 1)
    )
    duplicate_rows = db.execute(
        _employee_filter(duplicate_statement, employee_name)
    ).all()

    event_bounds_filter = or_(
        ActivityEvent.event_timestamp < WorkSession.started_at,
        (
            WorkSession.ended_at.is_not(None)
            & (ActivityEvent.event_timestamp > WorkSession.ended_at)
        ),
    )
    event_count_statement = (
        select(func.count(ActivityEvent.id))
        .join(WorkSession, WorkSession.id == ActivityEvent.session_id)
        .join(Employee, Employee.id == ActivityEvent.employee_id)
        .where(event_bounds_filter)
    )
    out_of_bounds_event_count = int(
        db.scalar(_employee_filter(event_count_statement, employee_name)) or 0
    )
    event_statement = (
        select(ActivityEvent, WorkSession, Employee.name)
        .join(WorkSession, WorkSession.id == ActivityEvent.session_id)
        .join(Employee, Employee.id == ActivityEvent.employee_id)
        .where(event_bounds_filter)
        .order_by(ActivityEvent.event_timestamp.desc())
        .limit(MAX_SAMPLES)
    )
    out_of_bounds_events = db.execute(
        _employee_filter(event_statement, employee_name)
    ).all()

    return {
        "structural_violation_count": len(invalid_sessions) + len(duplicate_rows),
        "invalid_session_count": len(invalid_sessions),
        "invalid_session_samples": [
            {
                "session_id": str(session.id),
                "employee_name": employee_name_value,
                "device_name": device_name,
                "started_at": _iso(session.started_at),
                "ended_at": _iso(session.ended_at),
                "status": session.status,
            }
            for session, employee_name_value, device_name in invalid_sessions[:MAX_SAMPLES]
        ],
        "duplicate_open_device_count": len(duplicate_rows),
        "duplicate_open_device_samples": [
            {
                "device_id": str(device_id),
                "employee_name": employee_name_value,
                "device_name": device_name,
                "open_session_count": int(count),
            }
            for device_id, employee_name_value, device_name, count in duplicate_rows[:MAX_SAMPLES]
        ],
        # These can include quarantined rows written before revision 54. Read
        # models ignore them and the database trigger prevents new ones.
        "historical_out_of_bounds_event_count": out_of_bounds_event_count,
        "historical_out_of_bounds_event_samples": [
            {
                "event_id": str(event.id),
                "session_id": str(session.id),
                "employee_name": employee_name_value,
                "event_type": event.event_type,
                "event_timestamp": _iso(event.event_timestamp),
                "session_started_at": _iso(session.started_at),
                "session_ended_at": _iso(session.ended_at),
            }
            for event, session, employee_name_value in out_of_bounds_events[:MAX_SAMPLES]
        ],
    }


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat()


def _employee_filter(statement, employee_name: str | None):
    if employee_name:
        return statement.where(Employee.name.ilike(f"%{employee_name.strip()}%"))
    return statement


def _audit_sessions(
    db: Session,
    *,
    now: datetime,
    employee_name: str | None,
) -> tuple[list[dict[str, Any]], set[UUID]]:
    statement = (
        select(WorkSession, Employee.name, Device.device_name)
        .join(Employee, Employee.id == WorkSession.employee_id)
        .join(Device, Device.id == WorkSession.device_id)
        .where(
            WorkSession.ended_at.is_(None),
            WorkSession.status.in_(ACTIVE_SESSION_STATUSES),
        )
        .order_by(Employee.name, WorkSession.started_at)
    )
    rows = db.execute(_employee_filter(statement, employee_name)).all()
    sessions_by_company: dict[UUID, list[WorkSession]] = defaultdict(list)
    session_context: dict[UUID, tuple[str, str]] = {}
    for session, name, device_name in rows:
        sessions_by_company[session.company_id].append(session)
        session_context[session.id] = (name, device_name)

    liveness_by_session = {}
    for company_id, sessions in sessions_by_company.items():
        liveness_by_session.update(
            open_session_liveness(
                db,
                company_id=company_id,
                sessions=sessions,
                now=now,
            )
        )

    fresh_employee_ids: set[UUID] = set()
    result = []
    for sessions in sessions_by_company.values():
        for session in sessions:
            liveness = liveness_by_session[session.id]
            if liveness["is_fresh"]:
                fresh_employee_ids.add(session.employee_id)
            name, device_name = session_context[session.id]
            result.append(
                {
                    "employee_id": str(session.employee_id),
                    "employee_name": name,
                    "device_name": device_name,
                    "session_id": str(session.id),
                    "session_status": session.status,
                    "started_at": _iso(session.started_at),
                    "last_trusted_signal_at": _iso(liveness["last_signal_at"]),
                    "fresh": liveness["is_fresh"],
                    "active_seconds": int(session.active_seconds),
                    "idle_seconds": int(session.idle_seconds),
                }
            )
    return result, fresh_employee_ids


def _audit_materialized_attendance(
    db: Session,
    *,
    now: datetime,
    days: int,
    employee_name: str | None,
    fresh_employee_ids: set[UUID],
) -> list[dict[str, Any]]:
    first_day = now.date() - timedelta(days=max(1, days))
    statement = (
        select(DailyAttendance, Employee.name, Employee.timezone)
        .join(Employee, Employee.id == DailyAttendance.employee_id)
        .where(DailyAttendance.work_date >= first_day)
        .order_by(DailyAttendance.work_date.desc(), Employee.name)
    )
    rows = db.execute(_employee_filter(statement, employee_name)).all()
    result = []
    for attendance, name, timezone_name in rows:
        sources = attendance.calculation_sources or {}
        if not bool(sources.get("is_running", False)):
            continue
        if (
            attendance.work_date == local_today(timezone_name, now)
            and attendance.employee_id in fresh_employee_ids
        ):
            continue
        result.append(
            {
                "employee_id": str(attendance.employee_id),
                "employee_name": name,
                "work_date": attendance.work_date.isoformat(),
                "actual_first_activity_at": _iso(attendance.actual_first_activity_at),
                "actual_last_activity_at": _iso(attendance.actual_last_activity_at),
                "actual_sign_out_at": _iso(attendance.actual_sign_out_at),
                "normal_worked_seconds": int(attendance.normal_worked_seconds),
                "idle_seconds": int(attendance.idle_seconds),
                "total_payable_seconds": int(attendance.total_payable_seconds),
                "calculated_at": _iso(attendance.calculated_at),
                "reason": "materialized_running_without_fresh_session",
            }
        )
    return result


def _audit_screenshot_storage(
    db: Session,
    *,
    now: datetime,
    days: int,
    employee_name: str | None,
) -> dict[str, Any]:
    since = now - timedelta(days=max(1, days))
    storage = LocalScreenshotStorage()
    statement = (
        select(Screenshot, Employee.name)
        .join(Employee, Employee.id == Screenshot.employee_id)
        .where(
            Screenshot.deleted_at.is_(None),
            Screenshot.captured_at >= since,
        )
        .order_by(Screenshot.captured_at.desc())
        .execution_options(yield_per=500)
    )
    rows = db.execute(_employee_filter(statement, employee_name))
    total = 0
    missing_original_count = 0
    missing_originals = []
    thumbnail_backfill_needed = 0
    invalid_path_count = 0
    invalid_paths = []
    for screenshot, name in rows:
        total += 1
        try:
            original = storage.resolve(screenshot.storage_path)
            thumbnail = (
                storage.resolve(screenshot.thumbnail_path)
                if screenshot.thumbnail_path
                else None
            )
        except ValueError:
            invalid_path_count += 1
            if len(invalid_paths) < MAX_SAMPLES:
                invalid_paths.append(
                    {
                        "screenshot_id": str(screenshot.id),
                        "employee_name": name,
                        "captured_at": _iso(screenshot.captured_at),
                    }
                )
            continue
        if not original.is_file():
            missing_original_count += 1
            if len(missing_originals) < MAX_SAMPLES:
                missing_originals.append(
                    {
                        "screenshot_id": str(screenshot.id),
                        "employee_id": str(screenshot.employee_id),
                        "employee_name": name,
                        "captured_at": _iso(screenshot.captured_at),
                        "storage_path": screenshot.storage_path,
                    }
                )
            continue
        if thumbnail is None or not thumbnail.is_file():
            thumbnail_backfill_needed += 1

    root = settings.screenshot_storage_path.resolve()
    if root.is_dir():
        total_bytes, used_bytes, free_bytes = disk_usage(root)
    else:
        total_bytes = used_bytes = free_bytes = 0
    return {
        "lookback_days": days,
        "database_rows_checked": total,
        "missing_original_count": missing_original_count,
        "missing_original_samples": missing_originals,
        "invalid_path_count": invalid_path_count,
        "invalid_path_samples": invalid_paths,
        "thumbnail_backfill_needed": thumbnail_backfill_needed,
        "storage": {
            "root": str(root),
            "root_exists": root.is_dir(),
            "total_bytes": total_bytes,
            "used_bytes": used_bytes,
            "free_bytes": free_bytes,
            "used_percent": round((used_bytes / total_bytes) * 100, 1)
            if total_bytes
            else 0,
        },
    }


def run_audit(*, days: int, employee_name: str | None) -> dict[str, Any]:
    now = datetime.now(UTC)
    with get_sessionmaker()() as db:
        sessions, fresh_employee_ids = _audit_sessions(
            db,
            now=now,
            employee_name=employee_name,
        )
        stale_materialized_attendance = _audit_materialized_attendance(
            db,
            now=now,
            days=days,
            employee_name=employee_name,
            fresh_employee_ids=fresh_employee_ids,
        )
        screenshot_storage = _audit_screenshot_storage(
            db,
            now=now,
            days=days,
            employee_name=employee_name,
        )
        time_ledger = _audit_time_ledger_invariants(
            db,
            employee_name=employee_name,
        )
    return {
        "generated_at": now.isoformat(),
        "employee_filter": employee_name,
        "open_sessions": sessions,
        "open_session_count": len(sessions),
        "stale_open_session_count": sum(
            not session["fresh"] for session in sessions
        ),
        "stale_materialized_attendance": stale_materialized_attendance,
        "stale_materialized_attendance_count": len(stale_materialized_attendance),
        "time_ledger": time_ledger,
        "screenshots": screenshot_storage,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Read-only audit of open tracking sessions, materialized attendance, "
            "and screenshot files."
        )
    )
    parser.add_argument(
        "--days",
        type=int,
        default=7,
        choices=range(1, 366),
        metavar="[1-365]",
    )
    parser.add_argument(
        "--employee",
        help="Optional case-insensitive employee-name filter.",
    )
    parser.add_argument(
        "--fail-on-time-invariant",
        action="store_true",
        help="Exit non-zero when a structural time-ledger invariant is broken.",
    )
    args = parser.parse_args()
    result = run_audit(days=args.days, employee_name=args.employee)
    print(
        json.dumps(result, indent=2, ensure_ascii=False)
    )
    if (
        args.fail_on_time_invariant
        and result["time_ledger"]["structural_violation_count"] > 0
    ):
        raise SystemExit(2)


if __name__ == "__main__":
    main()
