"""repair stale work sessions that span more than one day

Revision ID: 20260803_000053
Revises: 20260730_000052

Some desktop sessions were closed only when the application launched again.
Their delayed terminal timestamp made a single timesheet appear to span several
days. This repair ends those rows at the last proven activity (or their stored
counters), never later than the employee's next local midnight, and clears the
derived attendance cache for recalculation.
"""

from datetime import UTC, datetime, timedelta
import json
from typing import Sequence, Union
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import sqlalchemy as sa
from alembic import op

revision: str = "20260803_000053"
down_revision: Union[str, None] = "20260730_000052"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

WORKED_EVENT_TYPES = {
    "session_started",
    "idle_started",
    "idle_ended",
    "manual_pause_ended",
    "screen_unlocked",
    "system_resumed",
}


def _utc(value: datetime | str) -> datetime:
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _zone(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def _heartbeat_is_active(payload: dict | str | None) -> bool:
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except ValueError:
            return False
    return isinstance(payload, dict) and payload.get("status") == "active"


def _last_proven_activity(connection, session_id) -> datetime | None:
    rows = connection.execute(
        sa.text(
            "SELECT event_type, event_timestamp, payload FROM activity_events "
            "WHERE session_id = :session_id ORDER BY event_timestamp"
        ),
        {"session_id": session_id},
    ).all()
    proven = [
        _utc(event_timestamp)
        for event_type, event_timestamp, payload in rows
        if event_type in WORKED_EVENT_TYPES
        or (event_type == "heartbeat" and _heartbeat_is_active(payload))
    ]
    return max(proven) if proven else None


def upgrade() -> None:
    connection = op.get_bind()
    now = datetime.now(UTC)
    rows = connection.execute(
        sa.text(
            "SELECT ws.id, ws.employee_id, ws.started_at, ws.ended_at, "
            "       ws.timezone, ws.active_seconds, ws.idle_seconds, "
            "       e.timezone AS employee_timezone "
            "FROM work_sessions ws JOIN employees e ON e.id = ws.employee_id"
        )
    ).all()

    for row in rows:
        started_at = _utc(row.started_at)
        recorded_end = _utc(row.ended_at) if row.ended_at is not None else now
        if recorded_end - started_at <= timedelta(days=1):
            continue

        zone = _zone(row.timezone or row.employee_timezone)
        next_local_midnight = datetime.combine(
            started_at.astimezone(zone).date() + timedelta(days=1),
            datetime.min.time(),
            tzinfo=zone,
        ).astimezone(UTC)
        tracked_seconds = max(0, int(row.active_seconds or 0)) + max(
            0, int(row.idle_seconds or 0)
        )
        counter_end = started_at + timedelta(seconds=tracked_seconds)
        last_proven = _last_proven_activity(connection, row.id)
        trusted_end = max(
            started_at,
            counter_end,
            last_proven or started_at,
        )
        trusted_end = min(trusted_end, recorded_end, next_local_midnight)
        duration_seconds = max(0, int((trusted_end - started_at).total_seconds()))
        active_seconds = min(max(0, int(row.active_seconds or 0)), duration_seconds)
        idle_seconds = min(
            max(0, int(row.idle_seconds or 0)),
            max(0, duration_seconds - active_seconds),
        )

        connection.execute(
            sa.text(
                "UPDATE work_sessions SET ended_at = :ended_at, status = :status, "
                "active_seconds = :active_seconds, idle_seconds = :idle_seconds "
                "WHERE id = :session_id"
            ),
            {
                "session_id": row.id,
                "ended_at": trusted_end,
                "status": "ended",
                "active_seconds": active_seconds,
                "idle_seconds": idle_seconds,
            },
        )
        original_end_day = recorded_end.astimezone(zone).date()
        connection.execute(
            sa.text(
                "DELETE FROM daily_attendance WHERE employee_id = :employee_id "
                "AND work_date BETWEEN :start_date AND :end_date"
            ),
            {
                "employee_id": row.employee_id,
                "start_date": started_at.astimezone(zone).date(),
                "end_date": original_end_day,
            },
        )


def downgrade() -> None:
    # Removed unattended time cannot be reconstructed safely.
    pass
