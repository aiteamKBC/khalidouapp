"""Read-only report of false-overtime sessions from unsupported desktop agents.

Version 1.1.95 and older credited a multi-hour sleep/hibernate freeze as active
work (commit 09a209b). On resume, the cumulative ``active_seconds`` counter
jumps by roughly the frozen duration, which the workday timeline used to treat
as observed work — often surfacing as overnight overtime.

This script finds the affected sessions WITHOUT changing anything. For each
session it looks for a heartbeat gap larger than ``--gap-minutes`` where the
active counter jumped by at least ``--min-coverage`` of the gap, reported by an
agent at or below ``--max-version`` (default 1.1.95). It reports the employee,
session, work date, gap window, active jump, the screenshot/activity evidence
that actually exists inside the gap, and the recorded overtime for that day.

No database writes, no attendance recomputation, no migrations. Run against a
copy/read replica for review before applying any attendance correction.

Usage:
    python -m scripts.dry_run_false_overtime --pretty
    python -m scripts.dry_run_false_overtime --start 2026-09-01 --end 2026-09-30
"""

from __future__ import annotations

import argparse
import json
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database.session import get_sessionmaker
from app.models import (
    ActivityEvent,
    DailyAttendance,
    Employee,
    OvertimeRecord,
    Screenshot,
    WorkSession,
)
from app.services.agent_versions import parse_agent_version

REMEDIATION = (
    "For each finding, an authorized admin (timesheets.manage) should open the "
    "employee's day (Employee Monitoring or the Attendance page), click 'Correct "
    "attendance', set the corrected start to the first verified activity time, "
    "keep the payable adjustment at 0 unless there is a specific reason, and save "
    "with a reason noting the version-1.1.95 sleep/hibernate incident. Recalculation "
    "reclassifies the frozen gap as untracked and the false overtime disappears; the "
    "raw sessions, heartbeats, screenshots, and activity events are preserved. If the "
    "session is still running, end it at the verified boundary first (administrative "
    "close), then correct the day. If overtime already has a pending or paid decision, "
    "review/reject or recalculate that overtime instead of leaving conflicting payroll "
    "state."
)


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _counter(payload: Any, key: str) -> int | None:
    if not isinstance(payload, dict):
        return None
    value = payload.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return max(0, int(value))


def _payload_version(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None
    value = payload.get("agent_version")
    return value if isinstance(value, str) else None


def find_findings(
    db: Session,
    *,
    start: date | None,
    end: date | None,
    gap_minutes: int,
    min_coverage: float,
    max_version: str,
) -> list[dict[str, Any]]:
    max_parsed = parse_agent_version(max_version)
    gap_seconds_threshold = gap_minutes * 60

    session_stmt = select(WorkSession).order_by(WorkSession.started_at)
    if start is not None:
        session_stmt = session_stmt.where(
            WorkSession.started_at >= datetime.combine(start, time.min, tzinfo=UTC)
        )
    if end is not None:
        session_stmt = session_stmt.where(
            WorkSession.started_at
            < datetime.combine(end + timedelta(days=1), time.min, tzinfo=UTC)
        )

    findings: list[dict[str, Any]] = []
    for session in db.scalars(session_stmt).all():
        heartbeats = db.execute(
            select(ActivityEvent.event_timestamp, ActivityEvent.payload)
            .where(
                ActivityEvent.session_id == session.id,
                ActivityEvent.event_type == "heartbeat",
            )
            .order_by(ActivityEvent.event_timestamp, ActivityEvent.created_at)
        ).all()
        if len(heartbeats) < 2:
            continue

        for (prev_at, prev_payload), (next_at, next_payload) in zip(
            heartbeats, heartbeats[1:], strict=False
        ):
            gap_seconds = int((_utc(next_at) - _utc(prev_at)).total_seconds())
            if gap_seconds < gap_seconds_threshold:
                continue
            reported_version = _payload_version(next_payload) or _payload_version(prev_payload)
            parsed = parse_agent_version(reported_version)
            # Only a known release at or below the target range is suspect.
            if parsed is None or max_parsed is None or parsed > max_parsed:
                continue
            prev_active = _counter(prev_payload, "active_seconds")
            next_active = _counter(next_payload, "active_seconds")
            if prev_active is None or next_active is None:
                continue
            active_jump = max(0, next_active - prev_active)
            coverage = active_jump / gap_seconds if gap_seconds else 0.0
            if coverage < min_coverage:
                continue

            gap_start = _utc(prev_at)
            gap_end = _utc(next_at)
            screenshot_count = int(
                db.scalar(
                    select(func.count(Screenshot.id)).where(
                        Screenshot.employee_id == session.employee_id,
                        Screenshot.deleted_at.is_(None),
                        Screenshot.captured_at > gap_start,
                        Screenshot.captured_at < gap_end,
                    )
                )
                or 0
            )
            activity_in_gap = db.scalar(
                select(ActivityEvent.id)
                .where(
                    ActivityEvent.session_id == session.id,
                    ActivityEvent.event_type != "heartbeat",
                    ActivityEvent.event_timestamp > gap_start,
                    ActivityEvent.event_timestamp < gap_end,
                )
                .limit(1)
            )
            overtime = db.scalar(
                select(OvertimeRecord.recorded_extra_seconds).where(
                    OvertimeRecord.work_session_id == session.id
                )
            )
            employee = db.get(Employee, session.employee_id)
            work_date = _utc(session.started_at).date()
            daily = db.scalar(
                select(DailyAttendance.recorded_overtime_seconds).where(
                    DailyAttendance.employee_id == session.employee_id,
                    DailyAttendance.work_date == work_date,
                )
            )

            findings.append(
                {
                    "employee_id": str(session.employee_id),
                    "employee_name": employee.name if employee else None,
                    "session_id": str(session.id),
                    "work_date": work_date.isoformat(),
                    "reported_agent_version": reported_version,
                    "gap_start": gap_start.isoformat(),
                    "gap_end": gap_end.isoformat(),
                    "gap_seconds": gap_seconds,
                    "active_jump_seconds": active_jump,
                    "coverage_ratio": round(coverage, 3),
                    "screenshots_in_gap": screenshot_count,
                    "has_screenshot_evidence": screenshot_count > 0,
                    "has_activity_evidence": activity_in_gap is not None,
                    "session_recorded_overtime_seconds": int(overtime or 0),
                    "day_recorded_overtime_seconds": int(daily or 0),
                    "session_still_open": session.ended_at is None,
                }
            )
    return findings


def dry_run(
    db: Session,
    *,
    start: date | None,
    end: date | None,
    gap_minutes: int,
    min_coverage: float,
    max_version: str,
) -> dict[str, Any]:
    findings = find_findings(
        db,
        start=start,
        end=end,
        gap_minutes=gap_minutes,
        min_coverage=min_coverage,
        max_version=max_version,
    )
    return {
        "summary": {
            "findings": len(findings),
            "affected_sessions": len({item["session_id"] for item in findings}),
            "affected_employees": len({item["employee_id"] for item in findings}),
            "criteria": {
                "max_agent_version": max_version,
                "min_gap_minutes": gap_minutes,
                "min_active_coverage": min_coverage,
                "start": start.isoformat() if start else None,
                "end": end.isoformat() if end else None,
            },
            "note": (
                "This dry run made no changes. The runtime safeguard already "
                "reclassifies these gaps as untracked going forward; existing "
                "attendance rows are only corrected when an admin applies a "
                "correction."
            ),
            "remediation": REMEDIATION,
        },
        "findings": findings,
    }


def _parse_date(value: str | None) -> date | None:
    return date.fromisoformat(value) if value else None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", default=None, help="Earliest session start date (YYYY-MM-DD).")
    parser.add_argument("--end", default=None, help="Latest session start date (YYYY-MM-DD).")
    parser.add_argument(
        "--gap-minutes", type=int, default=30, help="Minimum heartbeat gap to flag (default 30)."
    )
    parser.add_argument(
        "--min-coverage",
        type=float,
        default=0.5,
        help="Minimum active-jump / gap ratio to flag (default 0.5).",
    )
    parser.add_argument(
        "--max-version",
        default="1.1.95",
        help="Highest agent version treated as unsupported (default 1.1.95).",
    )
    parser.add_argument("--pretty", action="store_true", help="Indent the JSON output.")
    args = parser.parse_args()
    session_factory = get_sessionmaker()
    with session_factory() as db:
        report = dry_run(
            db,
            start=_parse_date(args.start),
            end=_parse_date(args.end),
            gap_minutes=args.gap_minutes,
            min_coverage=args.min_coverage,
            max_version=args.max_version,
        )
    print(json.dumps(report, indent=2 if args.pretty else None, default=str))


if __name__ == "__main__":
    main()
