"""enforce time ledger invariants

Revision ID: 20260805_000054
Revises: 20260803_000053

Repairs impossible session bounds and stale overnight sessions, then makes the
rules database-enforced: one open session per device, end cannot precede start,
closed rows cannot be reopened, and an activity event cannot live outside its
session interval.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
import json
from typing import Sequence, Union
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import sqlalchemy as sa
from alembic import op

revision: str = "20260805_000054"
down_revision: Union[str, None] = "20260803_000053"
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


def _last_proven_activity(connection, session_id, *, not_after: datetime) -> datetime | None:
    rows = connection.execute(
        sa.text(
            "SELECT event_type, event_timestamp, payload FROM activity_events "
            "WHERE session_id = :session_id AND event_timestamp <= :not_after "
            "ORDER BY event_timestamp"
        ),
        {"session_id": session_id, "not_after": not_after},
    ).all()
    proven = [
        _utc(event_timestamp)
        for event_type, event_timestamp, payload in rows
        if event_type in WORKED_EVENT_TYPES
        or (event_type == "heartbeat" and _heartbeat_is_active(payload))
    ]
    return max(proven) if proven else None


def _last_session_signal(
    connection,
    session_id,
    *,
    not_before: datetime,
    not_after: datetime,
) -> datetime | None:
    """Recover the latest non-terminal evidence from an impossible session.

    The old end timestamp can predate the new session by days. Bound recovery
    by the next session start so a delayed queue cannot consume another
    session's time.
    """
    value = connection.execute(
        sa.text(
            "SELECT max(event_timestamp) FROM activity_events "
            "WHERE session_id = :session_id "
            "AND event_timestamp >= :not_before "
            "AND event_timestamp <= :not_after "
            "AND event_type NOT IN ('agent_stopped', 'session_ended')"
        ),
        {
            "session_id": session_id,
            "not_before": not_before,
            "not_after": not_after,
        },
    ).scalar_one_or_none()
    return _utc(value) if value is not None else None


def _repair_session(
    connection,
    row,
    *,
    now: datetime,
    forced_end: datetime | None = None,
) -> tuple[bool, datetime | None]:
    started_at = _utc(row.started_at)
    ended_at = _utc(row.ended_at) if row.ended_at is not None else None
    zone = _zone(row.timezone or row.employee_timezone)

    if forced_end is not None:
        ended_at = max(started_at, _utc(forced_end))
    elif ended_at is not None and ended_at < started_at:
        ended_at = started_at
    elif ended_at is None and started_at.astimezone(zone).date() < now.astimezone(zone).date():
        next_midnight = datetime.combine(
            started_at.astimezone(zone).date() + timedelta(days=1),
            datetime.min.time(),
            tzinfo=zone,
        ).astimezone(UTC)
        active_counter_end = started_at + timedelta(seconds=max(0, int(row.active_seconds or 0)))
        last_proven = _last_proven_activity(
            connection,
            row.id,
            not_after=next_midnight,
        )
        ended_at = min(
            next_midnight,
            max(started_at, active_counter_end, last_proven or started_at),
        )

    duration_seconds = (
        max(0, int((ended_at - started_at).total_seconds()))
        if ended_at is not None
        else None
    )
    active_seconds = max(0, int(row.active_seconds or 0))
    idle_seconds = max(0, int(row.idle_seconds or 0))
    if duration_seconds is not None:
        active_seconds = min(active_seconds, duration_seconds)
        idle_seconds = min(idle_seconds, max(0, duration_seconds - active_seconds))
    status = "ended" if ended_at is not None else row.status

    changed = (
        ended_at != (_utc(row.ended_at) if row.ended_at is not None else None)
        or status != row.status
        or active_seconds != int(row.active_seconds or 0)
        or idle_seconds != int(row.idle_seconds or 0)
    )
    if changed:
        connection.execute(
            sa.text(
                "UPDATE work_sessions SET ended_at = :ended_at, status = :status, "
                "active_seconds = :active_seconds, idle_seconds = :idle_seconds "
                "WHERE id = :session_id"
            ),
            {
                "session_id": row.id,
                "ended_at": ended_at,
                "status": status,
                "active_seconds": active_seconds,
                "idle_seconds": idle_seconds,
            },
        )
    return changed, ended_at


def upgrade() -> None:
    connection = op.get_bind()
    if connection.dialect.name == "postgresql":
        # The old API may still be serving while Alembic starts. Block time
        # ledger writes for this short repair transaction so no corrupt row can
        # slip in between the cleanup and constraint creation. Reads continue.
        op.execute(
            "LOCK TABLE work_sessions, activity_events IN SHARE ROW EXCLUSIVE MODE"
        )
    now = datetime.now(UTC)
    rows = connection.execute(
        sa.text(
            "SELECT ws.id, ws.employee_id, ws.device_id, ws.started_at, ws.ended_at, "
            "ws.status, ws.timezone, ws.active_seconds, ws.idle_seconds, "
            "e.timezone AS employee_timezone "
            "FROM work_sessions ws JOIN employees e ON e.id = ws.employee_id "
            "ORDER BY ws.device_id, ws.started_at DESC"
        )
    ).all()

    affected: set[tuple[object, date, date]] = set()
    open_device_seen: dict[object, datetime] = {}
    newer_session_start_by_device: dict[object, datetime] = {}
    for row in rows:
        forced_end = None
        started_at = _utc(row.started_at)
        recorded_end = _utc(row.ended_at) if row.ended_at is not None else None
        if recorded_end is not None and recorded_end < started_at:
            zone = _zone(row.timezone or row.employee_timezone)
            next_midnight = datetime.combine(
                started_at.astimezone(zone).date() + timedelta(days=1),
                datetime.min.time(),
                tzinfo=zone,
            ).astimezone(UTC)
            recovery_limit = min(
                now,
                next_midnight,
                newer_session_start_by_device.get(row.device_id, now),
            )
            forced_end = max(
                started_at,
                _last_session_signal(
                    connection,
                    row.id,
                    not_before=started_at,
                    not_after=max(started_at, recovery_limit),
                )
                or started_at,
            )
        elif row.ended_at is None and row.device_id in open_device_seen:
            # Keep the newest open row. Older duplicates carry no trustworthy
            # end boundary, so close them no later than the newer start.
            newer_start = open_device_seen[row.device_id]
            forced_end = min(
                newer_start,
                _last_proven_activity(connection, row.id, not_after=newer_start)
                or _utc(row.started_at),
            )
        elif row.ended_at is None:
            open_device_seen[row.device_id] = _utc(row.started_at)

        changed, repaired_end = _repair_session(
            connection,
            row,
            now=now,
            forced_end=forced_end,
        )
        if changed:
            zone = _zone(row.timezone or row.employee_timezone)
            start_day = _utc(row.started_at).astimezone(zone).date()
            end_day = (repaired_end or now).astimezone(zone).date()
            affected.add((row.employee_id, start_day, max(start_day, end_day)))
        newer_session_start_by_device[row.device_id] = started_at

    for employee_id, start_day, end_day in affected:
        connection.execute(
            sa.text(
                "DELETE FROM daily_attendance WHERE employee_id = :employee_id "
                "AND work_date BETWEEN :start_date AND :end_date"
            ),
            {
                "employee_id": employee_id,
                "start_date": start_day,
                "end_date": end_day,
            },
        )

    dialect = connection.dialect.name
    if dialect == "postgresql":
        op.create_check_constraint(
            "ck_work_sessions_end_not_before_start",
            "work_sessions",
            "ended_at IS NULL OR ended_at >= started_at",
        )
        op.create_check_constraint(
            "ck_work_sessions_closed_status",
            "work_sessions",
            "ended_at IS NULL OR status = 'ended'",
        )
    op.create_index(
        "uq_work_sessions_device_single_open",
        "work_sessions",
        ["device_id"],
        unique=True,
        postgresql_where=sa.text("ended_at IS NULL"),
        sqlite_where=sa.text("ended_at IS NULL"),
    )

    if dialect != "postgresql":
        return

    op.execute(
        """
        CREATE FUNCTION khaliduo_enforce_activity_event_bounds()
        RETURNS trigger AS $$
        DECLARE
            session_start timestamptz;
            session_end timestamptz;
        BEGIN
            SELECT started_at, ended_at INTO session_start, session_end
            FROM work_sessions WHERE id = NEW.session_id;
            IF NEW.event_timestamp < session_start
               OR (session_end IS NOT NULL AND NEW.event_timestamp > session_end) THEN
                RAISE EXCEPTION 'activity event timestamp is outside session bounds'
                    USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_activity_events_session_bounds
        BEFORE INSERT OR UPDATE OF session_id, event_timestamp ON activity_events
        FOR EACH ROW EXECUTE FUNCTION khaliduo_enforce_activity_event_bounds()
        """
    )
    op.execute(
        """
        CREATE FUNCTION khaliduo_keep_closed_session_immutable()
        RETURNS trigger AS $$
        BEGIN
            IF OLD.ended_at IS NOT NULL AND (
                NEW.started_at IS DISTINCT FROM OLD.started_at
                OR NEW.ended_at IS DISTINCT FROM OLD.ended_at
                OR NEW.status IS DISTINCT FROM OLD.status
                OR NEW.active_seconds IS DISTINCT FROM OLD.active_seconds
                OR NEW.idle_seconds IS DISTINCT FROM OLD.idle_seconds
            ) THEN
                RAISE EXCEPTION 'closed work sessions are immutable'
                    USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_work_sessions_closed_immutable
        BEFORE UPDATE ON work_sessions
        FOR EACH ROW EXECUTE FUNCTION khaliduo_keep_closed_session_immutable()
        """
    )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.dialect.name == "postgresql":
        op.execute("DROP TRIGGER IF EXISTS trg_work_sessions_closed_immutable ON work_sessions")
        op.execute("DROP FUNCTION IF EXISTS khaliduo_keep_closed_session_immutable()")
        op.execute("DROP TRIGGER IF EXISTS trg_activity_events_session_bounds ON activity_events")
        op.execute("DROP FUNCTION IF EXISTS khaliduo_enforce_activity_event_bounds()")
    op.drop_index("uq_work_sessions_device_single_open", table_name="work_sessions")
    if connection.dialect.name == "postgresql":
        op.drop_constraint(
            "ck_work_sessions_closed_status",
            "work_sessions",
            type_="check",
        )
        op.drop_constraint(
            "ck_work_sessions_end_not_before_start",
            "work_sessions",
            type_="check",
        )
