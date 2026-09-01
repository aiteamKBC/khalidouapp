"""repair workdays created by the midnight session rollover

Revision ID: 20260729_000050
Revises: 20260727_000049

A machine left switched on kept sending heartbeats after the employee went
home. At local midnight the old rollover closed the running session at 00:00
and opened a replacement that also started at 00:00, so every unattended hour
was banked as work and the dashboard reported the workday as starting at
12:00 AM.

This migration re-ends those sessions where the employee was last demonstrably
at the keyboard, re-starts the midnight replacements at their first real
activity, and clamps the recorded counters so no session reports more work than
its own duration. Derived daily attendance snapshots for the affected dates are
deleted so they are recalculated from the repaired sessions; the service layer
never recalculates a past date while a snapshot exists.
"""

from datetime import datetime, timedelta
from typing import Sequence, Union
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import sqlalchemy as sa
from alembic import op

revision: str = "20260729_000050"
down_revision: Union[str, None] = "20260727_000049"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Events that prove a worked boundary.  ``idle_started`` is the instant the
# employee stopped interacting, so it is also the correct end of proven work.
WORKED_EVENT_TYPES = {
    "session_started",
    "idle_started",
    "idle_ended",
    "manual_pause_ended",
    "screen_unlocked",
    "system_resumed",
}


def _utc(value: datetime | str) -> datetime:
    from datetime import UTC

    # Postgres hands back aware datetimes; SQLite hands back naive UTC strings.
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _zone(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def _is_local_midnight(value: datetime | None, zone: ZoneInfo) -> bool:
    if value is None:
        return False
    local = _utc(value).astimezone(zone)
    return (local.hour, local.minute, local.second) == (0, 0, 0)


def _worked_timestamps(connection, session_id) -> list[datetime]:
    """Ascending timestamps in this session that prove real work."""
    rows = connection.execute(
        sa.text(
            "SELECT event_type, event_timestamp, payload FROM activity_events "
            "WHERE session_id = :session_id ORDER BY event_timestamp"
        ),
        {"session_id": session_id},
    ).all()
    worked: list[datetime] = []
    for event_type, event_timestamp, payload in rows:
        if event_type in WORKED_EVENT_TYPES:
            worked.append(_utc(event_timestamp))
            continue
        if event_type != "heartbeat":
            continue
        status = None
        if isinstance(payload, dict):
            status = payload.get("status")
        elif isinstance(payload, str):
            # SQLite stores the JSON column as text.
            import json

            try:
                status = (json.loads(payload) or {}).get("status")
            except ValueError:
                status = None
        if status == "active":
            worked.append(_utc(event_timestamp))
    return worked


def upgrade() -> None:
    connection = op.get_bind()
    candidates = connection.execute(
        sa.text(
            "SELECT ws.id, ws.employee_id, ws.started_at, ws.ended_at, ws.timezone, "
            "       ws.active_seconds, ws.idle_seconds, e.timezone AS employee_timezone "
            "FROM work_sessions ws "
            "JOIN employees e ON e.id = ws.employee_id"
        )
    ).all()

    repaired_session_ids: list = []
    affected_days: set[tuple] = set()

    for row in candidates:
        zone = _zone(row.timezone or row.employee_timezone)
        started_at = _utc(row.started_at)
        ended_at = _utc(row.ended_at) if row.ended_at is not None else None
        starts_at_midnight = _is_local_midnight(started_at, zone)
        ends_at_midnight = _is_local_midnight(ended_at, zone)
        if not starts_at_midnight and not ends_at_midnight:
            continue

        worked = _worked_timestamps(connection, row.id)
        new_started_at = started_at
        new_ended_at = ended_at

        if starts_at_midnight and worked:
            # The replacement session opened at 00:00 on a midnight heartbeat.
            # The workday really began at the first proven activity.
            new_started_at = max(started_at, min(worked))
        if ends_at_midnight:
            last_worked = max(worked) if worked else new_started_at
            new_ended_at = max(new_started_at, min(ended_at, last_worked))

        if new_started_at == started_at and new_ended_at == ended_at:
            continue

        updates = {"session_id": row.id, "started_at": new_started_at}
        set_clauses = ["started_at = :started_at"]
        if new_ended_at is not None:
            set_clauses.append("ended_at = :ended_at")
            updates["ended_at"] = new_ended_at
            duration_seconds = max(0, int((new_ended_at - new_started_at).total_seconds()))
            # Never let a session report more work than it lasted.
            set_clauses.append("active_seconds = :active_seconds")
            set_clauses.append("idle_seconds = :idle_seconds")
            updates["active_seconds"] = min(row.active_seconds or 0, duration_seconds)
            updates["idle_seconds"] = min(
                row.idle_seconds or 0,
                max(0, duration_seconds - updates["active_seconds"]),
            )

        connection.execute(
            sa.text(f"UPDATE work_sessions SET {', '.join(set_clauses)} WHERE id = :session_id"),
            updates,
        )
        repaired_session_ids.append(row.id)
        # A repaired session can span two local dates; invalidate both.
        for moment in {new_started_at, new_ended_at or new_started_at, started_at}:
            affected_days.add((row.employee_id, moment.astimezone(zone).date()))

    if not repaired_session_ids:
        return

    # Overtime that a human already approved stays untouched; only the machine
    # recorded figures are cleared so they are re-derived.
    connection.execute(
        sa.text(
            "UPDATE overtime_records SET recorded_extra_seconds = 0 "
            "WHERE status = 'recorded' AND work_session_id IN :ids"
        ).bindparams(sa.bindparam("ids", expanding=True)),
        {"ids": repaired_session_ids},
    )

    for employee_id, work_date in affected_days:
        connection.execute(
            sa.text(
                "DELETE FROM daily_attendance "
                "WHERE employee_id = :employee_id AND work_date = :work_date"
            ),
            {"employee_id": employee_id, "work_date": work_date},
        )
        # Snapshots are also recalculated for the following day when a session
        # used to bleed across midnight into it.
        connection.execute(
            sa.text(
                "DELETE FROM daily_attendance "
                "WHERE employee_id = :employee_id AND work_date = :work_date"
            ),
            {"employee_id": employee_id, "work_date": work_date + timedelta(days=1)},
        )


def downgrade() -> None:
    # The inflated timestamps and counters cannot be reconstructed once the
    # unattended hours have been removed.
    pass
